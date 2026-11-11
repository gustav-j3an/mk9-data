# Backup de homologação pelo GitHub Actions

O workflow manual prepara uma exportação da homologação `tafjceemuetqjyngresg` em runner hospedado pelo GitHub. Usa clientes PostgreSQL 17, Supabase CLI `3.1.0`, Docker no runner e uma stack Supabase descartável para validações separadas do banco e do Storage. Não aplica migrations, não habilita extensões remotas e não grava na origem.

O job só pode rodar na branch `codex/m42.2-m39-session-pooler`. Requer o Environment protegido `homologation-backup`, credenciais de homologação, frase GPG forte e confirmação manual sobre o artifact. O workflow só tem `workflow_dispatch`, permissão `contents: read` e não usa tokens de deploy. Nenhuma execução foi iniciada nesta missão.

## Conexão e proteções

O banco é aceito somente se a URL usar o host exato definido em `SUPABASE_POOLER_HOST`, usuário `postgres.tafjceemuetqjyngresg`, banco `postgres`, porta `5432` (Session Pooler) e `sslmode=verify-full&sslrootcert=system`. O hostname precisa ser copiado do Connect > Session pooler do projeto de homologação e cadastrado como variável do Environment protegido; o código não deriva host pela região. Hosts desconhecidos, modo transaction, URL direta, produção e parâmetros extras ou TLS fraco são rejeitados antes de conectar.

O driver libpq recebe o usuário extraído da URL através de `PGUSER`; o script não o substitui por `postgres`. A conexão usa `verify-full` e o bundle de CAs do sistema, falhando fechada se o certificado não for confiável. A versão 3.1.0 do CLI adiciona verificação do certificado Supabase nos comandos de banco; a execução controlada ainda precisa validar o caminho completo pelo container do CLI e pela Session Pooler.

## Configuração necessária

Configure o Environment `homologation-backup` para exigir aprovação de revisor e permitir somente a branch de trabalho após revisão. Não configure valores de produção.

**Environment variables**

- `SUPABASE_PROJECT_REF` — `tafjceemuetqjyngresg`.
- `SUPABASE_PROJECT_URL` — `https://tafjceemuetqjyngresg.supabase.co`.
- `SUPABASE_POOLER_HOST` — hostname exato copiado do Connect > Session pooler no projeto de homologação.

**Environment secrets**

- `SUPABASE_DB_URL` — URL Session Pooler IPv4 com usuário `postgres.tafjceemuetqjyngresg`, porta `5432`, banco `postgres`, `sslmode=verify-full` e `sslrootcert=system`.
- `SUPABASE_SERVICE_ROLE_KEY` — chave de serviço desse projeto; claim `ref` deve ser `tafjceemuetqjyngresg`.
- `BACKUP_GPG_PASSPHRASE` — frase aleatória exclusiva com no mínimo 32 bytes e sem CR/LF. Guarde uma cópia protegida fora do GitHub.

O preflight valida branch, referências, endpoint da API, host pooler configurado, URL, usuário, porta, banco, TLS, claim da chave e confirmação manual antes da conexão. Nenhum segredo é impresso.

## Armazenamento

Este repositório é público. O artifact cifrado é retido por **1 dia** e pode estar acessível a pessoas com permissão sobre o repositório ou a execução. Não é armazenamento privado permanente. O único arquivo enviado é o `.tar.gz.gpg`; dumps, dados Auth, objetos Storage e checksums em claro não são publicados como artifact.

O repositório privado `mk9-date-homologation-backups` possui uma implementação independente baseada em release privado e cifragem age. Ela não foi alterada nem recebeu dados nesta missão. Em leitura da API do GitHub, havia três ativos cifrados e o workflow mais recente (#11) terminou com sucesso e registra `partial_approved`; dois ativos anteriores registram `partial_failed`, e os três deixam Storage pendente. Isso comprova armazenamento de dumps cifrados e uma validação parcial aprovada, mas não recuperação completa de banco e Storage; os arquivos não foram baixados ou descriptografados nesta revisão.

O runbook desse repositório informa limite de 2 GiB por ativo e nenhum limite agregado de armazenamento de releases documentado; o plano e a cobrança da conta não foram confirmados. Ele também alerta que minutos/uso de Actions e egress Supabase precisam ser conferidos antes da execução. A implementação atual desse repositório valida o pooler por um padrão que incorpora `sa-east-1`; não a reutilize para uma futura execução sem trocar isso por um hostname exato obtido de configuração confiável.

## Execução manual futura

A primeira execução `workflow_dispatch` depende de o workflow estar disponível na branch padrão e das regras do Environment permitirem a branch revisada. Após essa preparação:

1. Abra **Actions > MK9 homologation backup and restore validation > Run workflow** e selecione a branch revisada.
2. Informe `tafjceemuetqjyngresg` e confirme explicitamente o acesso ao artifact cifrado.
3. Aguarde preflight, exportação, verificações em stack descartável, cifragem e checksums. Uma falha interrompe o upload.
4. Baixe o artifact e descriptografe somente em ambiente protegido, com a frase GPG guardada separadamente. Não use a frase em argumentos de linha de comando nem coloque dados descriptografados em pastas sincronizadas, logs, issues, PRs ou no repositório.

Não execute antes de confirmar visualmente no Dashboard a identidade do projeto e o host e configurar o Environment protegido. O primeiro ensaio controlado deve confirmar o caminho TLS completo no runner, incluindo o `pg_dump` em container do CLI e a Session Pooler.

## Conteúdo e limites da recuperação

O pacote inclui dump PostgreSQL customizado, roles, histórico de migrations, inventário de objetos/dados/permissões e bytes e manifesto do Storage. A verificação restaura o banco e o Storage em etapas separadas na stack descartável; não demonstra uma restauração integrada entre banco/Auth/Storage, nem uma restauração num projeto Supabase real. O Storage restaurado pela API local não recria usuários Auth nem reassocia `owner_id`. Configurações Auth do painel — OAuth, SMTP, redirects, CAPTCHA e MFA — não estão cobertas.

Nenhum backup real foi executado ou restaurado nesta missão. Antes de declarar recuperação integral, ainda é necessário um ensaio integrado suficiente e uma estratégia aprovada para autenticação/configuração do projeto. Divergências dos schemas gerenciados entre origem e stack local interrompem o processo antes de disponibilizar artifact.
