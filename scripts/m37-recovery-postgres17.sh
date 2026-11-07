#!/usr/bin/env bash
set -euo pipefail

psql -X -v ON_ERROR_STOP=1 -Atqc "SELECT current_setting('server_version_num')::int BETWEEN 170000 AND 179999" | grep -qx t
echo "PostgreSQL $(psql -X -v ON_ERROR_STOP=1 -Atqc 'SHOW server_version')"

echo "=== SUPABASE CLI INSPECTION & VALIDATION ==="
echo "Supabase CLI version: $(supabase --version)"
echo "--- supabase migration --help ---"
supabase migration --help || true
echo "--- supabase migration up --help ---"
supabase migration up --help || true
echo "--- supabase db push --help ---"
supabase db push --help || true
echo "--- supabase migration list --help ---"
supabase migration list --help || true

# Garantir existência da tabela oficial do ledger no PostgreSQL
psql -X -v ON_ERROR_STOP=1 -Atqc "
  CREATE SCHEMA IF NOT EXISTS supabase_migrations;
  CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
    version text NOT NULL PRIMARY KEY,
    statements text[],
    name text
  );
"
echo "supabase_migrations.schema_migrations structure verified."
echo "============================================="

apply_migration() {
  local migration="$1"
  echo "Migration: $(basename "$migration")"
  if grep -Eq '^[[:space:]]*BEGIN;[[:space:]]*$' "$migration"; then
    # Files with their own BEGIN/COMMIT must contain no SQL after COMMIT.
    grep -Eq '^[[:space:]]*COMMIT;[[:space:]]*$' "$migration"
    if awk '/^[[:space:]]*COMMIT;[[:space:]]*$/ { ended=1; next } ended && $0 !~ /^[[:space:]]*($|--)/ { exit 1 }' "$migration"; then
      psql -X -v ON_ERROR_STOP=1 -f "$migration" >/dev/null
    else
      echo "SQL follows COMMIT in $migration" >&2
      return 1
    fi
  else
    psql -X -v ON_ERROR_STOP=1 -1 -f "$migration" >/dev/null
  fi
}

# Use the actual repository migrations. A missing Supabase dependency is a hard failure;
# this runner deliberately does not fabricate auth/storage objects or disable body checks.
baseline=(
  supabase/migrations/20260930_create_import_tables.sql
  supabase/migrations/20260930_create_profiles.sql
  supabase/migrations/20260930_add_status_to_profiles.sql
  supabase/migrations/20260930_update_rotas_structure.sql
)
while IFS= read -r migration; do
  baseline+=("$migration")
done < <(find supabase/migrations -maxdepth 1 -type f -name '*.sql' | sort | awk -F/ '$NF < "20261024" && $NF !~ /^20260930_/')
for migration in "${baseline[@]}"; do
  apply_migration "$migration"
done

# Establish the exact pre-migration function state from the captured homologation
# definitions, then compare it with the post-recovery state on this same server.
psql -X -v ON_ERROR_STOP=1 -f docs/m37.4-homologation-function-recovery.sql >/dev/null
snapshot_query="SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid),
 pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig, p.proacl,
 md5(p.prosrc), md5(pg_get_functiondef(p.oid))
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE (n.nspname='public' AND p.proname='attendance_check_in')
 OR (n.nspname='attendance_private' AND p.proname='attendance_start_scheduled_occurrence')
 OR (n.nspname='public' AND p.proname='check_visit_promotor_update_integrity')
 ORDER BY n.nspname, p.proname"
before_snapshot="$(mktemp)"
before_schema="$(mktemp)"
trap 'rm -f "$before_snapshot" "$before_schema"' EXIT
psql -X -v ON_ERROR_STOP=1 -Atqc "$snapshot_query" > "$before_snapshot"
psql -X -v ON_ERROR_STOP=1 -Atqc "SELECT n.nspname,p.relname,p.relkind FROM pg_class p JOIN pg_namespace n ON n.oid=p.relnamespace WHERE n.nspname IN ('public','attendance_private') ORDER BY 1,2,3" > "$before_schema"
test "$(wc -l < "$before_snapshot")" -eq 3

# Inject a deterministic error into disposable copies to verify both transaction
# forms: an external psql transaction (M30) and an explicit SQL transaction (M37).
for failure_case in external internal; do
  failed_copy="$(mktemp)"
  if [ "$failure_case" = external ]; then
    cat supabase/migrations/20261105165500_m30_harden_industry_active_checkin.sql > "$failed_copy"
    printf '\nSELECT 1/0;\n' >> "$failed_copy"
    if psql -X -v ON_ERROR_STOP=1 -1 -f "$failed_copy" >/dev/null 2>&1; then
      echo 'Expected M30 failure was accepted' >&2; exit 1
    fi
  else
    awk '/^[[:space:]]*COMMIT;[[:space:]]*$/ { print "SELECT 1/0;" } { print }' \
      supabase/migrations/20261106140000_m37_pending_visit_active_route_guard.sql > "$failed_copy"
    if psql -X -v ON_ERROR_STOP=1 -f "$failed_copy" >/dev/null 2>&1; then
      echo 'Expected M37 failure was accepted' >&2; exit 1
    fi
  fi
  rm -f "$failed_copy"
  psql -X -v ON_ERROR_STOP=1 -Atqc "$snapshot_query" | diff -u "$before_snapshot" -
  echo "Intermediate $failure_case failure rolled back."
done

# -----------------------------------------------------------------------------
# MISSÃO 37.13: PROVAR APLICAÇÃO ISOLADA DAS 5 MIGRATIONS VIA SUPABASE CLI 3.0.0
# Utiliza subdiretórios de trabalho (--workdir) com supabase/config.toml inicializado,
# contendo estritamente uma migration por etapa no diretório supabase/migrations.
# Isso garante que:
#  1. Nenhuma migration legada seja descoberta ou executada pelo CLI.
#  2. O Supabase CLI registra automaticamente cada versão no ledger oficial.
#  3. O teste não utiliza comandos psql manuais nem 'migration repair' para o ledger.
# -----------------------------------------------------------------------------
echo "=== SUPABASE CLI ISOLATED MIGRATION APPLICATION (M37.13) ==="
cli_test_dir="$(mktemp -d)"
echo "Created temporary CLI isolated root: $cli_test_dir"

# Inicializar estrutura de projeto Supabase no diretório temporário
(
  cd "$cli_test_dir"
  supabase init --force >/dev/null
  # Ajustar a porta e versão no config.toml do workdir para corresponder ao stack local
  sed -i "s/^major_version = .*/major_version = 17/" supabase/config.toml
  sed -i "s/^port = 54322/port = ${PGPORT:-54322}/" supabase/config.toml
)

echo "Initial migration list in isolated workdir:"
supabase migration list --workdir "$cli_test_dir" || true

migrations=(
  supabase/migrations/20261105165500_m30_harden_industry_active_checkin.sql
  supabase/migrations/20261106131614_m30_serialize_industry_checkin.sql
  supabase/migrations/20261106140000_m37_pending_visit_active_route_guard.sql
  supabase/migrations/20261106150000_m37_checkin_route_and_conflict_guard.sql
  supabase/migrations/20261107140000_m37_reconcile_materialized_pending_recovery.sql
)

for migration in "${migrations[@]}"; do
  mig_basename="$(basename "$migration")"
  expected_ver="$(echo "$mig_basename" | cut -d_ -f1)"
  echo "--- Applying migration via Supabase CLI in isolation: $mig_basename ---"

  # Limpar e colocar apenas a migration atual no diretório de migrations do workdir isolado
  rm -rf "$cli_test_dir/supabase/migrations"
  mkdir -p "$cli_test_dir/supabase/migrations"
  cp "$migration" "$cli_test_dir/supabase/migrations/"

  # Validar que apenas 1 arquivo existe no workdir
  file_count="$(find "$cli_test_dir/supabase/migrations" -maxdepth 1 -type f -name '*.sql' | wc -l)"
  if [ "$file_count" -ne 1 ]; then
    echo "ERROR: Expected exactly 1 migration file in isolated workdir, found $file_count" >&2
    exit 1
  fi

  # Aplicar via Supabase CLI oficial
  supabase migration up --workdir "$cli_test_dir"

  # Verificar se a versão foi registrada nativamente pelo CLI no ledger
  psql -X -v ON_ERROR_STOP=1 -Atqc "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '$expected_ver'" | grep -qx 1
  echo "Version $expected_ver successfully recorded in ledger by Supabase CLI."

  # Verificar existência das funções alvo
  psql -X -v ON_ERROR_STOP=1 -Atqc "SELECT count(*) = 3 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE (n.nspname='public' AND p.proname='attendance_check_in') OR (n.nspname='attendance_private' AND p.proname='attendance_start_scheduled_occurrence') OR (n.nspname='public' AND p.proname='check_visit_promotor_update_integrity')" | grep -qx t
done

rm -rf "$cli_test_dir"
echo "All 5 target migrations successfully applied via native Supabase CLI."
echo "Current ledger entries for target migrations:"
psql -X -v ON_ERROR_STOP=1 -c "SELECT version, name FROM supabase_migrations.schema_migrations WHERE version >= '20261105165500' ORDER BY version;"

if psql -X -v ON_ERROR_STOP=1 -Atqc "$snapshot_query" | cmp -s "$before_snapshot" -; then
  echo 'Target migrations did not change captured functions' >&2
  exit 1
fi

# A real authenticated role with no promoter identity must be denied.
psql -X -v ON_ERROR_STOP=1 -Atqc "BEGIN; SET LOCAL ROLE authenticated;
 DO \$\$ BEGIN
  PERFORM public.attendance_check_in('synthetic-store','synthetic-industry',NULL,NULL,NULL,NULL);
  RAISE EXCEPTION 'Unauthorized check-in was accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END \$\$;
 ROLLBACK;" >/dev/null
echo 'Unauthorized check-in rejected.'
psql -X -v ON_ERROR_STOP=1 -Atqc "SELECT NOT has_table_privilege('authenticated','public.visit_schedule_actions','SELECT')" | grep -qx t
echo 'Authenticated role has no direct audit table SELECT.'
functional_status=0
node scripts/m37-functional-tests.mjs || functional_status=$?

psql -X -v ON_ERROR_STOP=1 -f docs/m37.4-homologation-function-recovery.sql >/dev/null
psql -X -v ON_ERROR_STOP=1 -Atqc "$snapshot_query" | diff -u "$before_snapshot" -
psql -X -v ON_ERROR_STOP=1 -Atqc "SELECT n.nspname,p.relname,p.relkind FROM pg_class p JOIN pg_namespace n ON n.oid=p.relnamespace WHERE n.nspname IN ('public','attendance_private') ORDER BY 1,2,3" | diff -u "$before_schema" -
psql -X -v ON_ERROR_STOP=1 -Atqc "
WITH expected(schema_name, function_name, expected_md5, expected_acl) AS (
 VALUES
 ('attendance_private','attendance_start_scheduled_occurrence','f7741ffc813a80dc10c86e90ec634a6e','{postgres=X/postgres,authenticated=X/postgres}'),
 ('public','attendance_check_in','39dd2b79c48b4e808d81e22aa1140e3e','{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
 ('public','check_visit_promotor_update_integrity',NULL,'{postgres=X/postgres}')
)
SELECT e.schema_name || '.' || e.function_name,
  'catalog=' || (pg_get_userbyid(p.proowner)='postgres'
    AND p.prosecdef
    AND p.proconfig = ARRAY['search_path=\"\"']::text[]
    AND p.proacl::text=e.expected_acl
    AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
    AND (e.function_name='check_visit_promotor_update_integrity' OR has_function_privilege('authenticated',p.oid,'EXECUTE')))::text,
  'homologation_text_hash=' || (e.expected_md5 IS NULL OR md5(pg_get_functiondef(p.oid))=e.expected_md5)::text,
  'actual_hash=' || md5(pg_get_functiondef(p.oid))
FROM expected e JOIN pg_namespace n ON n.nspname=e.schema_name
JOIN pg_proc p ON p.pronamespace=n.oid AND p.proname=e.function_name;
"
psql -X -v ON_ERROR_STOP=1 -Atqc "
WITH expected(schema_name, function_name, expected_acl) AS (
 VALUES
 ('attendance_private','attendance_start_scheduled_occurrence','{postgres=X/postgres,authenticated=X/postgres}'),
 ('public','attendance_check_in','{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
 ('public','check_visit_promotor_update_integrity','{postgres=X/postgres}')
)
SELECT count(*) = 3 AND bool_and(pg_get_userbyid(p.proowner)='postgres'
 AND p.prosecdef AND p.proconfig = ARRAY['search_path=\"\"']::text[]
 AND p.proacl::text=e.expected_acl
 AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
 AND (e.function_name='check_visit_promotor_update_integrity' OR has_function_privilege('authenticated',p.oid,'EXECUTE')))
FROM expected e JOIN pg_namespace n ON n.nspname=e.schema_name
JOIN pg_proc p ON p.pronamespace=n.oid AND p.proname=e.function_name;
" | grep -qx t

echo 'Recovery catalog checks passed on PostgreSQL 17.'
exit "$functional_status"
