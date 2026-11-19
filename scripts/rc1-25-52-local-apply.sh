#!/usr/bin/env bash
set -euo pipefail

readonly DB='mk9_prod_restore_rc1251_final_v3'
readonly PORT='55439'
readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
readonly PACKAGE="${REPO_ROOT}/docs/releases/RC1.25.52_production_package.sql"

if [[ "$(id -un)" != 'postgres' ]]; then
  echo 'STOP: run only as the local postgres account.' >&2
  exit 2
fi
if [[ ! -r "$PACKAGE" ]]; then
  echo "STOP: package not readable: $PACKAGE" >&2
  exit 2
fi
if [[ "$(psql -X -p "$PORT" -d "$DB" -Atqc 'SELECT count(*) FROM public.visits')" != '43' ]]; then
  echo 'STOP: rehearsal database must contain the expected 43 visits.' >&2
  exit 2
fi
if [[ "$(psql -X -p "$PORT" -d "$DB" -Atqc 'SELECT count(*) FROM supabase_migrations.schema_migrations')" != '17' ]]; then
  echo 'STOP: rehearsal ledger must be at the approved 17-entry baseline.' >&2
  exit 2
fi
if [[ "$(psql -X -p "$PORT" -d "$DB" -Atqc "SELECT current_setting('cron.launch_active_jobs', true)")" != 'off' ]]; then
  echo 'STOP: cron.launch_active_jobs must remain off.' >&2
  exit 2
fi

# The package has no transaction control of its own; -1 and ON_ERROR_STOP make
# all DDL and matching ledger entries commit or roll back as one unit.
psql -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=terse --single-transaction \
  -p "$PORT" -d "$DB" -f "$PACKAGE"
psql -X -p "$PORT" -d "$DB" -Atqc \
  "SELECT 'visits=' || (SELECT count(*) FROM public.visits) || '|ledger=' || (SELECT count(*) FROM supabase_migrations.schema_migrations) || '|cron=' || current_setting('cron.launch_active_jobs', true)"
