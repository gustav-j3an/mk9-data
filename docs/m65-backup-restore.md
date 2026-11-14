# M65 — Backup e recuperação isolada

## O que o backup cobre

O workflow manual `.github/workflows/supabase-production-backup.yml` só roda na `main`, requer o ambiente protegido `production-backup`, a confirmação `BACKUP_PRODUCTION`, confirmação de cota incluída sem overage e repositório privado. Não o execute sem autorização do responsável pela produção. Nenhum segredo deve ser impresso em logs.

O pacote contém:

- `database.dump`: dump lógico custom do banco inteiro, com dados e metadados de Auth/Storage;
- `auth-schema.dump`, `auth-users.jsonl`: esquema Auth separado e usuários exportados via Admin API;
- `storage-schema.dump`, `storage-objects/`, `storage-objects-manifest.jsonl`: metadados SQL, bytes dos objetos e lista com tamanhos;
- `SHA256SUMS`: hashes dos arquivos do pacote antes de criptografar.

Antes da execução, configure no GitHub, no environment protegido `production-backup`:

- variável `SUPABASE_PROJECT_REF=xzmbesqhxcnuokjwrbnw`;
- variável `SUPABASE_PROJECT_URL` do mesmo projeto;
- segredo `SUPABASE_DB_URL` com conexão direta PostgreSQL;
- segredo `SUPABASE_SERVICE_ROLE_KEY` somente para exportar Auth e Storage;
- segredo `AGE_RECIPIENT` como chave pública `age1...` cuja chave privada está guardada offline.

Configure no environment `production-backup` pelo menos um revisor obrigatório (pessoa responsável pela produção) e proteja-o para permitir execução apenas a partir de `main`. Sem essa proteção o job não deve ser usado.

O workflow cria criptografia age antes de gerar o artefato privado com validade de 1 dia. Baixe o artefato e mova-o para armazenamento criptografado aprovado antes do vencimento. O artefato temporário não é retenção de backup. O workflow apaga as cópias em disco do runner ao final; o runner GitHub é efêmero.

## Custo e retenção

O custo zero não pode ser garantido somente pelo código: confirme no painel GitHub que minutos e armazenamento de artefatos cabem na cota incluída e que overage não está habilitado antes de confirmar `confirm_zero_cost_quota`. O gate `private` impede disponibilizar artefatos criptografados em repositório público. Para retenção, mantenha pelo menos a cópia atual e uma anterior em um destino privado já contratado/sem cobrança incremental; valide hashes após download. Remova artefatos temporários após cópia validada. Não use o Git ou logs como destino.

Este backup do banco não cobre configurações externas do projeto, provedores OAuth/SMTP, chaves API, configuração de Auth, políticas de retenção, nem as configurações dos buckets. Registre essas configurações em inventário protegido separado, sem incluir chaves privadas.

## Validar integridade e restaurar em PostgreSQL 17 descartável

1. Baixe o artefato somente da execução aprovada em repositório privado e preserve o arquivo `.age` original em local seguro.
2. Em máquina/ambiente isolado autorizado, descriptografe usando a identidade privada age offline e confirme os hashes antes de importar:

   ```bash
   age -d -i /caminho/protegido/backup.agekey backup.tar.gz.age | tar -tzf - >/dev/null
   age -d -i /caminho/protegido/backup.agekey backup.tar.gz.age | tar -xzf - -C /diretorio-vazio
   cd /diretorio-vazio
   sha256sum -c SHA256SUMS
   ```

3. Inicie PostgreSQL 17 descartável em GitHub Actions ou máquina isolada autorizada. Não conecte endpoints Supabase de produção/homologação e não use credenciais de produção. Restringir rede de saída e apagar o destino ao final.
4. Teste a leitura do dump sem executar comandos SQL exportados:

   ```bash
   pg_restore --list database.dump >/dev/null
   pg_restore --list auth-schema.dump >/dev/null
   pg_restore --list storage-schema.dump >/dev/null
   ```

5. A restauração completa de um dump Supabase pode exigir papéis/extensões e privilégios próprios do ambiente Supabase. Não use `--clean`/`--create` nem aponte para banco existente. Para ensaio real com dados, autorização específica é necessária; crie destino descartável isolado, carregue o dump sem conexões externas, e destrua o destino após validações.
6. Auth: compare contagem e integridade dos usuários exportados com `auth.users` após restauração autorizada, sem exibir emails/metadata. Auth providers, templates, SMTP, MFA/configurações externas exigem validação separada no projeto destino.
7. Storage: compare buckets/configuração via `storage-schema.dump`; valide quantidade, tamanhos e SHA-256 de cada objeto conforme o manifesto/hashes após restauração dos bytes. Restaurar somente metadados SQL não restaura os objetos binários.

O workflow deste PR não executa backup, não descriptografa dados reais e não restaura produção/homologação. A validação automatizada M65 usa apenas fixture sintética PostgreSQL 17 para policy. O ensaio de recuperação de dados reais permanece pendente de autorização explícita e destino descartável autorizado.
