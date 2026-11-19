#!/usr/bin/env bash
set -euo pipefail
umask 077

readonly DUMP='/var/lib/postgresql/mk9-private-backups/mk9-production-20261119T144813Z.dump'
readonly EXPECTED_SHA='96aa0653d2ccf15f15486c07477bbbc8c88f42ff7c29129f98628e908a2d930d'
readonly DB='mk9_prod_restore_rc1251_final_v3'
readonly PORT='55439'

if [[ "$(id -un)" != 'postgres' ]]; then
  echo 'STOP: run only as the local postgres account.' >&2
  exit 2
fi
if [[ ! -r "$DUMP" ]]; then
  echo 'STOP: approved local source dump is not readable.' >&2
  exit 2
fi
actual_sha="$(sha256sum "$DUMP" | awk '{print $1}')"
if [[ "$actual_sha" != "$EXPECTED_SHA" ]]; then
  echo 'STOP: original backup checksum differs from the approved value.' >&2
  exit 2
fi
db_exists="$(psql -X -p "$PORT" -d postgres -Atqc "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname='${DB}')")"
if [[ "$(psql -X -p "$PORT" -d postgres -Atqc "SELECT current_setting('server_version_num')::int / 10000")" != '17' ]]; then
  echo 'STOP: local cluster must be PostgreSQL 17.' >&2
  exit 2
fi
if [[ "$(psql -X -p "$PORT" -d postgres -Atqc "SELECT current_setting('cron.launch_active_jobs', true)")" != 'off' ]]; then
  echo 'STOP: cron.launch_active_jobs must be off before restore.' >&2
  exit 2
fi
if [[ "$(psql -X -p "$PORT" -d postgres -Atqc "SELECT current_setting('cron.database_name', true)")" != "$DB" ]]; then
  echo 'STOP: pg_cron must be temporarily targeted at the local clone before restoring its extension.' >&2
  exit 2
fi

toc="$(mktemp /tmp/rc1252-toc.XXXXXX)"
restore_log="$(mktemp /tmp/rc1252-restore.XXXXXX)"
trap 'rm -f -- "$toc" "${toc}.filtered"' EXIT
pg_restore --list "$DUMP" > "$toc"
toc_total="$(wc -l < "$toc" | tr -d ' ')"
# The local Debian cluster does not ship Supabase Vault. Omit only its schema,
# extension metadata, and table data; this makes the rehearsal non-parity by design.
grep -vi 'vault' "$toc" > "${toc}.filtered"
toc_included="$(wc -l < "${toc}.filtered" | tr -d ' ')"
mv -- "${toc}.filtered" "$toc"

if [[ "$db_exists" == 't' ]]; then
  user_objects="$(psql -X -p "$PORT" -d "$DB" -Atqc "SELECT count(*) FROM pg_class WHERE relnamespace NOT IN ('pg_catalog'::regnamespace,'information_schema'::regnamespace) AND relkind IN ('r','p','v','m','S','f')")"
  if [[ "$user_objects" != '0' ]]; then
    echo "STOP: ${DB} exists with local objects; refusing to replace it." >&2
    exit 2
  fi
  echo "RESUME: ${DB} exists but has no restored relations after the prior atomic failure."
else
  createdb -p "$PORT" "$DB" 2>"$restore_log"
fi
if ! pg_restore --exit-on-error --single-transaction --no-owner --no-privileges \
    --use-list="$toc" -p "$PORT" -d "$DB" "$DUMP" >/dev/null 2>"$restore_log"; then
  echo "RESTORE_FAILED: private diagnostic log retained at ${restore_log}. Do not share its contents." >&2
  exit 1
fi

visits="$(psql -X -p "$PORT" -d "$DB" -Atqc 'SELECT count(*) FROM public.visits')"
ledger="$(psql -X -p "$PORT" -d "$DB" -Atqc 'SELECT count(*) FROM supabase_migrations.schema_migrations')"
cron="$(psql -X -p "$PORT" -d "$DB" -Atqc "SELECT current_setting('cron.launch_active_jobs', true)")"
if [[ "$visits" != '43' || "$ledger" != '17' || "$cron" != 'off' ]]; then
  echo 'RESTORE_POSTCHECK_FAILED: database retained for inspection; do not proceed to migrations.' >&2
  exit 1
fi
printf 'RESTORE_OK db=%s visits=%s ledger=%s cron.launch_active_jobs=%s toc=%s/%s vault_entries_excluded=%s sha256=%s\n' \
  "$DB" "$visits" "$ledger" "$cron" "$toc_included" "$toc_total" "$((toc_total-toc_included))" "$actual_sha"
rm -f -- "$restore_log"
