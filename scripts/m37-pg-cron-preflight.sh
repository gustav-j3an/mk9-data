#!/usr/bin/env bash
set -euo pipefail

assert_psql_true() {
  local description="$1"
  local query="$2"
  local result
  if ! result="$(psql -X -v ON_ERROR_STOP=1 -Atqc "$query")"; then
    echo "ERROR: Could not evaluate pg_cron preflight: $description" >&2
    return 1
  fi
  if [[ "$result" != t ]]; then
    echo "ERROR: pg_cron preflight failed: $description (actual result: ${result:-empty})" >&2
    return 1
  fi
}

# These read-only diagnostics deliberately precede every assertion so a failed
# prerequisite still leaves the server's effective pg_cron configuration in CI.
# Only the named settings and pg_cron catalog rows are emitted; no environment
# variables, connection strings, or credentials are printed.
echo "=== PostgreSQL 17 pg_cron configuration diagnostics (read-only) ==="
psql -X -v ON_ERROR_STOP=1 <<'SQL'
SELECT current_setting('server_version') AS postgres_version,
       current_setting('server_version_num') AS postgres_version_num;

SELECT name, setting, source, sourcefile, pending_restart
FROM pg_settings
WHERE name IN ('shared_preload_libraries', 'cron.database_name')
ORDER BY name;

SELECT coalesce(current_setting('cron.database_name', true), '<absent>') AS cron_database_name;

SELECT name, default_version, installed_version
FROM pg_available_extensions
WHERE name = 'pg_cron';

SELECT extname, extversion
FROM pg_extension
WHERE extname = 'pg_cron';
SQL

assert_psql_true "server is PostgreSQL 17" \
  "SELECT current_setting('server_version_num')::int BETWEEN 170000 AND 179999"
assert_psql_true "pg_cron control files are available in this PostgreSQL image" \
  "SELECT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name='pg_cron')"
assert_psql_true "pg_cron is loaded through shared_preload_libraries" \
  "SELECT EXISTS (SELECT 1 FROM unnest(string_to_array(current_setting('shared_preload_libraries'), ',')) AS library(name) WHERE btrim(library.name) = 'pg_cron')"
assert_psql_true "pg_cron is configured for the disposable current database" \
  "SELECT coalesce(current_setting('cron.database_name', true) = current_database(), false)"

psql -X -v ON_ERROR_STOP=1 -c 'CREATE EXTENSION IF NOT EXISTS pg_cron'

assert_psql_true "pg_cron is installed in the disposable database" \
  "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron')"
assert_psql_true "pg_cron exposes cron.schedule, cron.unschedule and cron.job" \
  "SELECT to_regnamespace('cron') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='cron' AND p.proname='schedule') AND EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='cron' AND p.proname='unschedule') AND to_regclass('cron.job') IS NOT NULL"
assert_psql_true "pg_cron still targets the disposable current database" \
  "SELECT coalesce(current_setting('cron.database_name', true) = current_database(), false)"

echo "Verified PostgreSQL 17 pg_cron availability, preload, installation and scheduler objects."
