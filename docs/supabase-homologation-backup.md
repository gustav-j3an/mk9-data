# Backup de homologação pelo GitHub Actions

O workflow manual gera um backup da homologação `tafjceemuetqjyngresg` em runner hospedado pelo GitHub. Ele usa ferramentas PostgreSQL 17, Supabase CLI `3.0.0`, Docker e uma stack Supabase descartável para validar separadamente a restauração do banco e do Storage. Não aplica migrations, não habilita `pg_cron` e não grava na origem.

O job só roda na branch `codex/m38-backup-actions` e exige o Environment protegido `homologation-backup`, as três credenciais de homologação, uma senha GPG forte e a confirmação manual de que o artifact criptografado ficará no GitHub. O workflow só tem `workflow_dispatch`, permissão de repositório `contents: read` e não usa tokens de deploy.

## Aviso sobre o armazenamento

Este repositório é público. O artifact fica associado à execução do GitHub Actions e pode ser acessível conforme as permissões e regras do GitHub para o repositório. Ele não deve ser tratado como armazenamento privado permanente. A retenção configurada é de **1 dia**; depois, o artifact expira. O único arquivo enviado é o `.tar.gz.gpg` cifrado; nenhum dump, dado Auth, foto, manifesto ou checksum em texto aberto é enviado como artifact.

A senha GPG fica em um GitHub Environment Secret e deve ter pelo menos 32 bytes, sem quebra de linha. Mantenha uma cópia de recuperação da senha em local separado e protegido. Sem essa senha, não será possível descriptografar o arquivo. Mesmo cifrado, o artifact pode ser baixado por pessoas que tenham acesso à execução/repositório, então proteja a senha e não reutilize uma senha de outros sistemas.

## Configuração necessária

Crie o Environment `homologation-backup`, exija aprovação de pelo menos um revisor, limite a branch de deployment a `codex/m38-backup-actions` e proteja a branch com revisão.

**Environment variables**

- `SUPABASE_PROJECT_REF` — `tafjceemuetqjyngresg`.
- `SUPABASE_PROJECT_URL` — URL da API desse projeto de homologação.

**Environment secrets**

- `SUPABASE_DB_URL` — conexão direta PostgreSQL da homologação, usuário `postgres`, banco `postgres`, com TLS.
- `SUPABASE_SERVICE_ROLE_KEY` — chave de serviço da homologação; a claim `ref` precisa ser `tafjceemuetqjyngresg`.
- `BACKUP_GPG_PASSPHRASE` — frase aleatória exclusiva, com no mínimo 32 bytes e sem CR/LF. Guarde a cópia de recuperação fora do GitHub.

Não configure valores ou credenciais de produção. O preflight confere o ref, a URL e o host exatos, a claim da chave, a branch, a conexão TLS e a confirmação manual antes de conectar à origem.

## Execução e download

O arquivo do workflow precisa estar na branch padrão antes que o GitHub aceite a primeira execução `workflow_dispatch` e exiba o botão **Run workflow**. A integração na branch padrão exige PR revisada; esta branch de trabalho não a faz automaticamente.

Depois que o workflow estiver na branch padrão e o Environment estiver configurado:

1. Abra **Actions → MK9 homologation backup and restore validation → Run workflow**.
2. Selecione `codex/m38-backup-actions`.
3. Informe `tafjceemuetqjyngresg` e marque a confirmação de acesso ao artifact criptografado.
4. Aguarde a execução concluir. Falha em exportação, comparação, restauração, criptografia ou checksums impede a etapa de upload.
5. Na página da execução concluída, em **Artifacts**, baixe `mk9-homologation-backup-<run-id>-<attempt>`. Extraia o ZIP do artifact; dentro estará somente o arquivo `.tar.gz.gpg`.
6. Com a cópia protegida da frase GPG, descriptografe e extraia localmente. Por exemplo, salve a senha em um arquivo temporário protegido fora do repositório, com permissão de leitura apenas para você, e execute:

   ```bash
   gpg --batch --quiet --pinentry-mode loopback --passphrase-file /caminho/seguro/gpg-passphrase --decrypt mk9-backup.tar.gz.gpg > mk9-backup.tar.gz
   mkdir -m 700 mk9-backup-extraido
   tar -xzf mk9-backup.tar.gz -C mk9-backup-extraido
   (cd mk9-backup-extraido && sha256sum --check SHA256SUMS)
   ```

   Apague a cópia temporária da senha com segurança depois. Não use a senha em argumentos de linha de comando nem salve os arquivos descriptografados em pastas sincronizadas ou compartilhadas.

Não coloque o conteúdo descriptografado em issues, PRs, artifacts, logs ou no repositório. O workflow não inicia automaticamente em push, PR, agendamento ou deploy.

## Conteúdo e validação

O arquivo cifrado reúne um dump PostgreSQL custom-format, exportação separada de roles e histórico de migrations, inventário de schemas/dados/permissões e bytes e manifesto do Storage. O inventário compara dados e objetos PostgreSQL; a restauração do banco ocorre em `mk9_backup_restore`. A validação de Storage é separada: recria buckets/objetos pela API local, aplica metadados na base padrão `postgres` da stack descartável e compara o inventário e hashes dos bytes. Essas verificações não constituem uma restauração integrada com as tabelas de Storage do dump na mesma base. A restauração em projeto Supabase real não está implementada.

O manifesto mantém os IDs de proprietário, mas a validação isolada do Storage não recria usuários Auth nem reassocia `owner_id` na API local. Configurações Auth que vivem no painel Supabase — como OAuth, SMTP, redirects, CAPTCHA e MFA — também não são cobertas pelo dump PostgreSQL. Use um procedimento de recuperação separado, revisado e específico para o projeto antes de qualquer restauração real.

## Limitações

Não há armazenamento privado permanente, versionamento ou garantia de recuperação no GitHub Artifacts. O artifact expira após um dia e pode estar disponível a usuários com permissões sobre o repositório/execução. Artifacts dependem das políticas e limites do GitHub. Nenhum backup foi executado por esta implementação; o primeiro run real ainda precisa confirmar funcionamento do GPG, do Supabase CLI e da restauração no runner hospedado. Divergências entre schemas gerenciados na origem e na stack local interrompem o processo antes do upload.
