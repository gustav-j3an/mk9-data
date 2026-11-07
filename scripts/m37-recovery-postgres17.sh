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
# Inserir no ledger as versões do histórico remoto da homologação para provar
# que versões remotas pré-existentes ausentes do workdir temporário NÃO bloqueiam o CLI.
psql -X -v ON_ERROR_STOP=1 -Atqc "
  INSERT INTO supabase_migrations.schema_migrations(version, name) VALUES
    ('20261018235500', 'soft_delete_fixed_routes'),
    ('20261019001109', 'lock_attendance_telemetry_and_scope'),
    ('20261019001848', 'validate_attendance_schedule_overlaps'),
    ('20261019004947', 'add_attendance_work_location'),
    ('20261019011832', 'secure_attendance_photos_and_release_contract'),
    ('20261019013007', 'complete_attendance_operational_setup'),
    ('20261019151754', 'mk9_rh_explicit_bindings'),
    ('20261019175853', 'mk9_rh_admin_binding_preparation'),
    ('20261020160000', 'add_whatsapp_group_link_to_industrias'),
    ('20261020170000', 'mk9_absence_records_outbox'),
    ('20261021100000', 'mk9_rh_reconciliation'),
    ('20261021120000', 'mk9_absence_attachments'),
    ('20261022152449', 'mk9_date_visit_regularization_and_checkin_scope'),
    ('20261023142837', 'promoter_scheduled_visit_actions')
  ON CONFLICT (version) DO NOTHING;
"
echo "Homologation baseline ledger simulated with $(psql -X -v ON_ERROR_STOP=1 -Atqc 'SELECT count(*) FROM supabase_migrations.schema_migrations;') recorded versions."

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
# MISSÃO 37.16: RECONCILIAÇÃO SEGURA DE HISTÓRICO COM O SUPABASE CLI 3.0.0
# Popula o workdir com as migrations canônicas já reconhecidas no ledger da homologação
# e adiciona cumulativamente as 5 novas migrations M30/M37.
# Isso garante que:
#  1. O Supabase CLI encontra todas as versões remotas pré-existentes do ledger.
#  2. Nenhuma migration histórica é reaplicada (o CLI reconhece que já estão no ledger).
#  3. Nenhuma migration legada divergente/irregular entra no workspace.
#  4. Exclusivamente as 5 migrations M30/M37 são executadas e registradas.
# -----------------------------------------------------------------------------
echo "=== SUPABASE CLI RECONCILED HISTORICAL WORKDIR (M37.16) ==="
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

mkdir -p "$cli_test_dir/supabase/migrations"

# Copiar estritamente as 14 migrations históricas reconhecidas pelo ledger da homologação
# Exclui 20261020160000_mk9_faltas_atestados_prepare_permission.sql para evitar colisão de versão.
historical_migrations=(
  supabase/migrations/20261018235500_soft_delete_fixed_routes.sql
  supabase/migrations/20261019001109_lock_attendance_telemetry_and_scope.sql
  supabase/migrations/20261019001848_validate_attendance_schedule_overlaps.sql
  supabase/migrations/20261019004947_add_attendance_work_location.sql
  supabase/migrations/20261019011832_secure_attendance_photos_and_release_contract.sql
  supabase/migrations/20261019013007_complete_attendance_operational_setup.sql
  supabase/migrations/20261019151754_mk9_rh_explicit_bindings.sql
  supabase/migrations/20261019175853_mk9_rh_admin_binding_preparation.sql
  supabase/migrations/20261020160000_add_whatsapp_group_link_to_industrias.sql
  supabase/migrations/20261020170000_mk9_absence_records_outbox.sql
  supabase/migrations/20261021100000_mk9_rh_reconciliation.sql
  supabase/migrations/20261021120000_mk9_absence_attachments.sql
  supabase/migrations/20261022152449_mk9_date_visit_regularization_and_checkin_scope.sql
  supabase/migrations/20261023142837_promoter_scheduled_visit_actions.sql
)

for hist in "${historical_migrations[@]}"; do
  cp "$hist" "$cli_test_dir/supabase/migrations/"
done

# Validar que existem exatamente 14 arquivos históricos e que nenhuma versão se repete
hist_count="$(ls "$cli_test_dir/supabase/migrations" | wc -l)"
if [ "$hist_count" -ne 14 ]; then
  echo "ERROR: Expected exactly 14 historical migrations in workdir, found $hist_count" >&2
  exit 1
fi

unique_hist_versions="$(ls "$cli_test_dir/supabase/migrations" | cut -d_ -f1 | sort -u | wc -l)"
if [ "$unique_hist_versions" -ne 14 ]; then
  echo "ERROR: Duplicate version detected among historical migrations! Unique: $unique_hist_versions vs Total: 14" >&2
  exit 1
fi

echo "Historical migrations populated in workdir: $(ls "$cli_test_dir/supabase/migrations" | wc -l) files."
echo "Migration list before new migrations:"
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

  # Garantir existência e adicionar cumulativamente a migration atual no diretório de migrations do workdir isolado
  mkdir -p "$cli_test_dir/supabase/migrations"
  cp "$migration" "$cli_test_dir/supabase/migrations/"

  # Validar que o arquivo foi copiado para o workdir
  test -f "$cli_test_dir/supabase/migrations/$mig_basename"

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
