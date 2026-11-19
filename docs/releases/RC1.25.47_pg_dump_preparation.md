# RC1.25.47 — preparação de backup lógico com pg_dump

**Estado: procedimento preparado; conexão e exportação não executadas.** O firewall do WSL continua com `output drop`, e o administrador ainda não autorizou explicitamente iniciar conexão ou transferir dados. Não usar este documento como autorização para conectar.

## Ferramentas observadas

Na distribuição Debian 13 WSL, `pg_dump`, `pg_restore` e `psql` são PostgreSQL **17.12**. O cluster de ensaio está local em `127.0.0.1:55439`. O `pg_dump` 17 oferece saída `custom` (`-Fc`, adequada a `pg_restore`, comprimida por padrão) e texto SQL (`-Fp`). Foi consultada a documentação oficial do PostgreSQL 17; sem `--jobs`, o dump usa uma conexão. O utilitário obtém locks compartilhados `ACCESS SHARE`, compatíveis com operações normais de leitura/escrita; alterações DDL concorrentes podem fazê-lo abortar. Recomenda-se `--lock-wait-timeout=10s` e nova janela se ocorrer timeout, nunca insistência em horário de contenção.

## Conexão — somente após autorização específica

Obter no painel do projeto `xzmbesqhxcnuokjwrbnw` → **Connect** a string do **Session pooler**. O modo Session usa a porta `5432`; a string contém o hostname e usuário `postgres.<project-ref>`. A conexão direta `db.<ref>.supabase.co:5432` é opção apenas se a rede possuir IPv6 ou o projeto tiver IPv4 habilitado. Não compor o hostname manualmente nem usar transaction pooler (`6543`) para este procedimento.

Supabase recomenda TLS. Preferir `sslmode=verify-full` e o CA do banco obtido em Database Settings. `sslmode=require` cifra, mas não verifica a identidade do servidor; não usar sozinho quando a validação completa do certificado estiver disponível.

Guardar parâmetros sem senha em `/var/lib/postgresql/.pg_service.conf`, propriedade `postgres:postgres`, modo `0600`:

```ini
[mk9-production-backup]
host=<HOST_SESSION_POOLER_COPIADO_DO_PAINEL>
port=5432
dbname=postgres
user=postgres.xzmbesqhxcnuokjwrbnw
sslmode=verify-full
sslrootcert=<CAMINHO_DO_CA_DO_SUPABASE>
connect_timeout=10
```

A senha, apenas depois de autorização, fica em `/var/lib/postgresql/.pgpass`, mesmo proprietário e modo `0600`, linha no formato `host:5432:postgres:postgres.xzmbesqhxcnuokjwrbnw:senha`, escapando `:` e `\` conforme o formato libpq. Nunca passar senha em URL, argumento de processo, shell history, variável exportada ou log. Alternativa interativa é permitir que o cliente solicite a senha no terminal; não redirecionar nem registrar a entrada.

O laboratório está protegido por nftables (`inet filter output policy drop`, loopback permitido). **Não mudar nem desativar agora.** Se houver autorização administrativa futura para a conexão, resolver previamente os endereços do host pooler por procedimento aprovado e, após confirmar que cada regra corresponde apenas a um destino aprovado, adicionar permissão temporária e estreita de saída TCP/5432. Exemplo ilustrativo para substituir pelo IP confirmado (não executar como está):

```bash
sudo nft add rule inet filter output ip daddr <POOLER_IPV4_CONFIRMADO> tcp dport 5432 accept comment "mk9 authorized dump"
sudo nft -a list chain inet filter output
# Após o dump, remover somente o handle anotado da regra temporária:
sudo nft delete rule inet filter output handle <HANDLE_DA_REGRA_TEMPORARIA>
```

Para IPv6, a família do destino é `ip6 daddr`. Preservar todas as regras existentes, registrar o handle da regra temporária e removê-la imediatamente ao terminar. Não abrir DNS geral, egress irrestrito ou qualquer acesso a outros destinos. Se não for possível identificar e limitar o destino sem enfraquecer a política, não conectar.

## Arquivo de backup e integridade

Armazenar apenas no filesystem Linux da distro, fora do checkout Git, em `/var/lib/postgresql/mk9-private-backups`, com diretório `postgres:postgres` em modo `0700`; aplicar `umask 077`; arquivo final e checksum ficam em modo `0600`. Não gravar em `/mnt/c`, no repositório, `OpenBot\Shared`, nem em pasta sincronizada. Essas permissões limitam acesso no guest, mas não comprovam criptografia do disco virtual Windows; verificar BitLocker/controles do host antes de reter dados reais.

Exemplo a ser executado somente após autorização e confirmação do host/certificado:

```bash
umask 077
sudo install -d -o postgres -g postgres -m 0700 /var/lib/postgresql/mk9-private-backups
backup_dir=/var/lib/postgresql/mk9-private-backups
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
partial="$backup_dir/.mk9-production-$stamp.partial"
final="$backup_dir/mk9-production-$stamp.dump"
sudo -u postgres env PGSERVICEFILE=/var/lib/postgresql/.pg_service.conf \
  PGPASSFILE=/var/lib/postgresql/.pgpass \
  pg_dump --dbname='service=mk9-production-backup' --format=custom \
  --no-owner --no-privileges --lock-wait-timeout=10s --file="$partial"
sudo -u postgres pg_restore --list "$partial" >/dev/null
sudo chmod 0600 "$partial"
sudo mv -- "$partial" "$final"
sudo sha256sum "$final" | sudo tee "$final.sha256" >/dev/null
sudo chmod 0600 "$final.sha256"
sudo sha256sum --check "$final.sha256"
```

O formato custom é recomendado para restore seletivo/diagnóstico. Para SQL texto, usar `--format=plain --file=...` e validar com `psql`; não tentar `pg_restore` em plain. Para exportar apenas o schema público, adicionar `--schema=public`, sabendo que será um backup parcial e insuficiente para um restore integral do banco. `--no-owner --no-privileges` melhora portabilidade, mas deliberadamente não preserva proprietários/ACLs; isso não é backup integral de papéis/permissões. Um hash local detecta corrupção posterior, mas sozinho não prova autoria, atualidade nem origem: guardar separadamente hora UTC, projeto/ambiente de origem conferido no painel, hostname (sem credencial), comando e hash em registro sem dados de cliente; comparar com hash assinado ou canal de custódia confiável se disponibilizado.

**Escopo:** pg_dump de uma base captura objetos e dados PostgreSQL acessíveis nessa base, não arquivos do Supabase Storage API nem serviços GoTrue, PostgREST, Realtime, Edge Functions ou segredos gerenciados do Vault. Validar privilégios e conteúdo do TOC sem exibir linhas/dados. A CLI `supabase db dump` divide roles/schema/data e exclui schemas gerenciados; esta etapa usa `pg_dump` direto e não deve ser descrita como réplica completa da plataforma Supabase.

## Restore futuro (não executado)

Manter firewall egress drop, `listen_addresses=127.0.0.1`, porta local `55439`, e `cron.launch_active_jobs=off`. Primeiro validar hash e `pg_restore --list`; então criar banco descartável e restaurar sem paralelismo, em uma transação:

```bash
sudo -u postgres createdb -h 127.0.0.1 -p 55439 mk9_prod_restore
sudo -u postgres pg_restore --exit-on-error --single-transaction --no-owner --no-privileges \
  -h 127.0.0.1 -p 55439 -U postgres -d mk9_prod_restore \
  "/var/lib/postgresql/mk9-private-backups/mk9-production-<UTC>.dump"
```

O cluster local não tem `supabase_vault`; usa PostgreSQL 17.12 (produção reportada como 17.11) e pacote `pg_cron` 1.6.8 (produção reportada como 1.6.4). Restauração pode falhar por extensão/schema/role ausente; não contornar removendo objetos do dump sem revisão. Antes de ensaiar migrations, verificar jobs/rotinas restauradas e mantê-los desativados. Restore ainda não está autorizado por este runbook.

## Executor de migration

`scripts/safe-rc1-25-apply.mjs` foi corrigido localmente para remover apenas os limites externos `BEGIN;`/`COMMIT;` da fonte previamente validada por SHA-256 e submeter o DDL mais o `INSERT` do ledger com `psql --single-transaction` (`-1`) e `ON_ERROR_STOP=1`. A pré-verificação agora falha fechada se encontrar objetos RC1.25 sem versão no ledger, em vez de tentar uma reexecução que poderia colidir com políticas não idempotentes; também exige nome exato quando a versão já existe. O erro de subprocesso é suprimido para não expor URL/SQL. O teste unitário verifica a composição e o teste local do cliente `psql -1` demonstrou rollback após erro. Isso não resolve erro semântico pós-commit. O executor continua estritamente limitado à homologação pelas guards existentes e não foi executado contra ambiente remoto algum nesta missão.

## Referências

- [Supabase — conexão ao PostgreSQL](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase — backup e restore via CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
- [PostgreSQL 17 — pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html)
