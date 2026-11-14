# M65 — Backup e recuperação isolada

## O que o backup cobre

O workflow manual `.github/workflows/supabase-production-backup.yml` só roda na `main`, requer o ambiente protegido `production-backup`, a confirmação `BACKUP_PRODUCTION` e confirmação de destino privado sem cobrança incremental. Não o execute sem autorização do responsável pela produção. Nenhum segredo deve ser impresso em logs.

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
- segredo `AGE_RECIPIENT` como chave pública `age1...` cuja chave privada está guardada offline;
- variável `BACKUP_DESTINATION_HOST` e segredo `BACKUP_UPLOAD_URL`: host e URL HTTPS assinada para PUT de um destino privado já existente, fora do GitHub e fora do projeto Supabase de produção. A URL deve permitir apenas escrita no objeto de backup escolhido.

Gere a URL assinada imediatamente antes da execução, com validade suficiente para o job e apontando para uma chave/objeto única da execução. Não reutilize uma URL que sobrescreva o backup anterior. Remova ou rotacione a URL assinada após o envio.

Configure no environment `production-backup` pelo menos um revisor obrigatório (pessoa responsável pela produção) e proteja-o para permitir execução apenas a partir de `main`. Sem essa proteção o job não deve ser usado.

O workflow criptografa com age antes de enviar o pacote diretamente ao destino privado configurado. Não usa artefatos GitHub; o repositório é público e artefatos poderiam ser baixados por pessoas com acesso ao repositório. Configure o ciclo de retenção no destino para preservar pelo menos a cópia atual e uma anterior. O runner apaga as cópias locais ao final e imprime somente o SHA-256 do pacote criptografado.

## Custo e retenção

O runner padrão de GitHub Actions é gratuito em repositórios públicos. O custo total ainda depende do destino externo: use um recurso privado já existente, sem cobrança incremental, e confirme isso antes de marcar `confirm_private_zero_cost_destination`. Não crie projeto/serviço para esta operação. Valide o SHA-256 após download e mantenha a retenção definida no destino. Não use Git, logs ou artefatos GitHub como destino.

Este backup do banco não cobre configurações externas do projeto, provedores OAuth/SMTP, chaves API, configuração de Auth, políticas de retenção, nem as configurações dos buckets. Registre essas configurações em inventário protegido separado, sem incluir chaves privadas.

## Validar integridade e restaurar em PostgreSQL 17 descartável

1. Baixe o objeto criptografado do destino privado usando acesso autorizado e preserve o arquivo `.age` original em local seguro. Compare o SHA-256 com o valor registrado na execução.
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

O workflow deste PR não executa backup, não descriptografa dados reais e não restaura produção/homologação. A validação automatizada M65 usa apenas fixture sintética PostgreSQL 17 para policy e restauração. O ensaio de recuperação de dados reais permanece pendente de autorização explícita e destino descartável autorizado.
