#!/usr/bin/env bash
set -euo pipefail

readonly PORT='55439'
readonly TARGET='mk9_prod_restore_rc1251_final_v3'
readonly LOG_FILE='/var/lib/postgresql/17/main/log'

if [[ "$(id -u)" != '0' ]]; then
  echo 'STOP: run only as root so systemd can restart the local cluster.' >&2
  exit 2
fi
psql_as_postgres() { runuser -u postgres -- psql "$@"; }
mode="${1:-}"
current="$(psql_as_postgres -X -p "$PORT" -d postgres -Atqc "SELECT current_setting('cron.database_name')")"
launch="$(psql_as_postgres -X -p "$PORT" -d postgres -Atqc "SELECT current_setting('cron.launch_active_jobs')")"
if [[ "$launch" != 'off' ]]; then
  echo 'STOP: cron.launch_active_jobs must remain off.' >&2
  exit 2
fi

case "$mode" in
  enable)
    source="$(psql_as_postgres -X -p "$PORT" -d postgres -Atqc "SELECT source FROM pg_settings WHERE name='cron.database_name'")"
    if [[ "$current" != 'postgres' || "$source" != 'configuration file' ]]; then
      echo 'STOP: initial cron.database_name differs from the recorded local configuration.' >&2
      exit 2
    fi
    other="$(psql_as_postgres -X -p "$PORT" -d postgres -Atqc "SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND datname IS NOT NULL AND backend_type <> 'pg_cron launcher'")"
    if [[ "$other" != '0' ]]; then
      echo 'STOP: other database sessions are active; refusing cluster restart.' >&2
      exit 2
    fi
    psql_as_postgres -X -p "$PORT" -d postgres -v ON_ERROR_STOP=1 -c "ALTER SYSTEM SET cron.database_name = '${TARGET}'" >/dev/null
    if ! systemctl restart postgresql@17-main; then
      echo 'FAILED: local PostgreSQL restart did not complete; inspect local cluster status.' >&2
      exit 1
    fi
    [[ "$(psql_as_postgres -X -p "$PORT" -d postgres -Atqc "SELECT current_setting('cron.database_name') || '|' || current_setting('cron.launch_active_jobs')")" == "${TARGET}|off" ]]
    echo "CRON_TARGET_ENABLED target=${TARGET} launch_active_jobs=off"
    ;;
  disable)
    if [[ "$current" != "$TARGET" ]]; then
      echo 'STOP: cron.database_name is not the temporary rehearsal target.' >&2
      exit 2
    fi
    psql_as_postgres -X -p "$PORT" -d postgres -v ON_ERROR_STOP=1 -c 'ALTER SYSTEM RESET cron.database_name' >/dev/null
    if ! systemctl restart postgresql@17-main; then
      echo 'FAILED: restoring the original local cron target did not complete.' >&2
      exit 1
    fi
    [[ "$(psql_as_postgres -X -p "$PORT" -d postgres -Atqc "SELECT current_setting('cron.database_name') || '|' || current_setting('cron.launch_active_jobs')")" == 'postgres|off' ]]
    echo 'CRON_TARGET_RESTORED target=postgres launch_active_jobs=off'
    ;;
  *)
    echo 'Usage: rc1-25-52-local-cron-target.sh enable|disable' >&2
    exit 2
    ;;
esac
