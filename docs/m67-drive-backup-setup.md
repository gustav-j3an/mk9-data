# MK9 DATE — backup criptografado no Google Drive

## O que mudou em relação ao workflow antigo da `main`

O workflow antigo gera um `.tar.gz.gpg` e publica esse arquivo como artifact do GitHub por um dia. Como o repositório `gustav-j3an/mk9-data` é público, artifacts não são um destino privado adequado. A versão M65 substituiu isso por age e um upload HTTPS genérico, mas esperava uma URL de upload assinada que o Google Drive não fornece por meio de um link comum. Esta proposta usa a API oficial do Drive v3, OAuth 2.0 com o escopo limitado `drive.file` e upload retomável. O workflow antigo não deve ser executado.

O novo fluxo mantém o pacote criptografado com `age` antes do envio. Antes de qualquer leitura de produção, a etapa de preflight autentica no Drive, cria (se necessário) a pasta privada `MK9 DATE Production Backups` com a própria aplicação OAuth e verifica que a pasta não está compartilhada publicamente ou com domínio. O upload verifica o status retornado pelo Drive, tamanho, MD5 reportado pelo Drive, SHA-256 guardado como propriedade privada da aplicação e SHA-256 dos bytes baixados novamente. Tokens de acesso, refresh tokens, URLs de sessão retomável, caminhos de credenciais e respostas de erro do Google nunca são escritos nos logs.

O modo `synthetic-test` gera conteúdo fictício, cifra com `age`, envia ao Drive, baixa para conferir os bytes e exclui o objeto de teste. Não fornece credenciais Supabase às etapas. O modo `production-backup` só roda na branch `main`, exige a aprovação do environment `production-backup`, confirmação literal e confirmação manual de destino privado com espaço já disponível.

## Configurar o OAuth do Google

Use um projeto Google Cloud existente ou crie um projeto novo sem associar conta de faturamento. Habilite apenas a **Google Drive API**. Não solicite aumento de quota nem habilite serviços de armazenamento pagos.

1. No Google Cloud Console, selecione o projeto e abra **APIs e serviços → Biblioteca → Google Drive API → Ativar**.
2. Abra **Google Auth Platform → Branding** e configure o nome e os contatos da aplicação de backup.
3. Em **Audience**, escolha `Internal` se a conta for Google Workspace e a política permitir. Para uma conta pessoal, use `External`; adicione a conta de backup como test user durante a configuração. Para uso recorrente, coloque a aplicação em `In production` e complete a verificação OAuth que o Console solicitar. Tokens de refresh de aplicações `External` em `Testing` expiram em 7 dias.
4. Em **Data Access**, declare somente `https://www.googleapis.com/auth/drive.file`. Não solicite `drive`, `drive.readonly` nem acesso a todos os arquivos.
5. Em **Clients → Create client**, crie um OAuth Client ID do tipo **Web application** dedicado a este backup. Em **Authorized redirect URIs**, adicione exatamente `https://developers.google.com/oauthplayground`. Guarde o Client ID e o Client Secret diretamente nos secrets do environment GitHub, sem copiá-los para chat ou arquivos do repositório.
6. No OAuth Playground oficial, em **Settings → Use your own OAuth credentials**, informe o Client ID/Secret criado para este projeto. Deixe **Access type: Offline** e **Force prompt: Consent Screen**. Selecione apenas o escopo `drive.file`, autorize a conta correta e troque o código por tokens. O Playground encaminha as credenciais ao serviço oficial do Google para completar o fluxo; use-o somente se esse fluxo for aceitável para o responsável. Não cole tokens na conversa, em terminal compartilhado ou em logs. Copie o refresh token diretamente para o Secret Store do GitHub e limpe a página/sessão do Playground.
7. No primeiro workflow, o próprio OAuth client cria a pasta privada no Drive da conta autorizada. O escopo `drive.file` permite que o app trabalhe com os arquivos que ele criou. A pasta não deve ser compartilhada com links, grupos ou domínio. Não a mova para um Drive compartilhado.

O uso padrão da API do Drive não tem cobrança adicional. O armazenamento dos arquivos usa a quota existente da conta proprietária. Antes do teste e de cada backup real, confirme no Google Drive que há espaço suficiente para manter o backup novo e a cópia anterior, sem comprar armazenamento. A disponibilidade do espaço dessa conta não pode ser confirmada pelo código. Mantenha a faturação do projeto Cloud desativada; não peça quota adicional. A documentação de quota informa que a API tem um limite diário e que consumo acima dos limites poderá se tornar cobrável mais adiante; o fluxo usa somente poucas chamadas por execução e não solicita aumento.

## Configurar o environment no GitHub

No repositório `gustav-j3an/mk9-data`:

1. Abra **Settings → Environments → New environment** e crie `production-backup`.
2. Em **Deployment protection rules**, habilite **Required reviewers** e adicione o responsável pela produção. Habilite **Prevent self-review** e desabilite **Allow administrators to bypass configured protection rules**.
3. Em **Deployment branches and tags**, selecione **Selected branches and tags** e permita somente `main`.
4. Em **Environment secrets**, crie os secrets abaixo. Digite seus valores diretamente na interface do GitHub; nenhum valor deve ser enviado no chat.

| Secret | Origem |
| --- | --- |
| `GOOGLE_OAUTH_CLIENT_ID` | OAuth Client ID dedicado criado no Google Cloud |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Client Secret do mesmo OAuth client |
| `GOOGLE_OAUTH_REFRESH_TOKEN` | Refresh token offline autorizado com escopo `drive.file` |
| `SUPABASE_DB_URL` | Conexão PostgreSQL direta do projeto de produção |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave necessária para exportar usuários Auth e binários Storage |
| `AGE_RECIPIENT` | Chave pública `age1...`; a chave privada correspondente fica offline |

5. Em **Environment variables**, crie:

| Variable | Valor |
| --- | --- |
| `APPROVED_BACKUP_COMMIT` | SHA completo de 40 caracteres do commit da `main` que foi revisado e aprovado para execução do backup |
| `SUPABASE_PROJECT_REF` | `xzmbesqhxcnuokjwrbnw` |
| `SUPABASE_PROJECT_URL` | URL `https://xzmbesqhxcnuokjwrbnw.supabase.co` |
| `GOOGLE_DRIVE_BACKUP_FOLDER_NAME` | `MK9 DATE Production Backups` |

O environment não deve receber acesso a partir de branches de PR. A revisão obrigatória é feita antes de iniciar o job e antes de disponibilizar os secrets ao runner. Atualize `APPROVED_BACKUP_COMMIT` manualmente quando o commit de backup revisado mudar.

## Testar o destino antes da produção

Depois que o PR de infraestrutura estiver revisado e integrado, crie/valide o environment e os secrets. No GitHub, abra **Actions → MK9 production backup to private Google Drive → Run workflow**, selecione `main`, escolha `synthetic-test` e marque a confirmação de armazenamento privado sem compra.

O revisor do environment precisa aprovar a execução. O workflow verifica o commit aprovado, autentica no Drive, garante que a pasta está privada, cria um payload fictício cifrado com `age`, faz upload retomável, confirma tamanho e integridade por download e apaga o arquivo sintético. O log contém apenas resultado, tamanho e SHA-256 do arquivo cifrado. Esta execução não recebe nem usa `SUPABASE_DB_URL` ou `SUPABASE_SERVICE_ROLE_KEY`.

O upload sintético confirma autenticação, permissões e operação de escrita no Drive. Ele não prova que há espaço para um backup de produção grande; o responsável deve confirmar a quota livre e marcar a confirmação somente se já houver espaço sem compra.

## Executar backup de produção

Somente após o teste sintético passar e a revisão obrigatória estar ativa:

1. Confirme que `APPROVED_BACKUP_COMMIT` aponta para exatamente o HEAD aprovado da `main`.
2. Confirme que a pasta do Drive continua privada e tem espaço suficiente para a cópia atual e uma anterior.
3. Em **Actions → MK9 production backup to private Google Drive → Run workflow**, escolha `production-backup`, escreva exatamente `BACKUP_PRODUCTION` e marque a confirmação de destino privado sem custo incremental.
4. Aguarde o responsável aprovar o environment. Sem aprovação, o runner e os secrets não são disponibilizados.
5. Confira apenas o resumo de sucesso e o SHA-256 do arquivo cifrado. Não copie conteúdo do dump aos logs.
6. Preserve a chave privada `age` offline. Ela é necessária para verificar e restaurar o arquivo.

O arquivo contém dump lógico completo do banco, esquema e usuários Auth exportados pela Admin API, esquema Storage, binários de todos os objetos Storage, manifesto de nomes/tamanhos e `SHA256SUMS`. Continua sem cobrir configurações externas de Auth (provedores OAuth, SMTP, templates e MFA), configuração/limites dos buckets, chaves API e configuração do projeto. Mantenha inventário protegido separado para esses itens; não inclua segredos nele.

## Recuperação e retenção

1. Baixe o arquivo `.tar.gz.age` diretamente do Drive privado usando a conta autorizada e compare o SHA-256 com o log de sucesso. O hash não é credencial.
2. Descriptografe em ambiente isolado com a chave privada `age` offline. Confirme os arquivos internos com `sha256sum -c SHA256SUMS`.
3. Restaure somente em instância descartável isolada PostgreSQL 17, sem conexão a produção ou homologação. Não use `--clean`/`--create` contra banco existente. Uma restauração Supabase completa pode exigir papéis e extensões do produto; valide separadamente Auth e Storage.
4. Compare contagem de usuários Auth sem registrar identificadores pessoais. Para Storage, compare manifesto, tamanhos e hashes dos binários. A restauração de metadados SQL sozinha não restaura os bytes do Storage.
5. Mantenha pelo menos a cópia atual e a anterior no Drive privado; apague cópias antigas somente depois de conferir a nova integridade e a restauração.

O workflow não executa restauração real. O teste sintético valida somente o canal de upload e remoção. O ensaio de recuperação com dados reais permanece separado e requer destino descartável, isolado e autorização explícita.
