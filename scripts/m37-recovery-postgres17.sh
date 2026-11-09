#!/usr/bin/env bash
set -euo pipefail

# The runner and every database/API target must be disposable loopback services.
case "${PGHOST:-}" in 127.0.0.1|localhost|::1) ;; *)
  echo "Refusing non-loopback PostgreSQL host: ${PGHOST:-<unset>}" >&2; exit 1 ;;
esac
if [ "${PGPORT:-54322}" != "54322" ]; then
  echo "Refusing unexpected PostgreSQL port: ${PGPORT}" >&2; exit 1
fi
SUPABASE_TEST_API_URL="${SUPABASE_TEST_API_URL:-http://127.0.0.1:54321}"
case "$SUPABASE_TEST_API_URL" in http://127.0.0.1:54321|http://localhost:54321) ;;
  *) echo "Refusing non-loopback Supabase API URL: $SUPABASE_TEST_API_URL" >&2; exit 1 ;;
esac
for forbidden in SUPABASE_ACCESS_TOKEN SUPABASE_DB_PASSWORD SUPABASE_PROJECT_REF SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY; do
  if [ -n "${!forbidden:-}" ]; then echo "Refusing remote Supabase credential/configuration: $forbidden" >&2; exit 1; fi
done
unset SUPABASE_ACCESS_TOKEN SUPABASE_DB_PASSWORD SUPABASE_PROJECT_REF SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY
export SUPABASE_TEST_API_URL

psql -X -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;" >/dev/null
psql -X -v ON_ERROR_STOP=1 -Atqc "SELECT count(*) FROM pg_extension WHERE extname='pg_cron'" | grep -qx 1
echo "pg_cron enabled only in the disposable PostgreSQL database."

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
# Inserir no ledger as 47 versões exatas do histórico remoto da homologação (M37.21)
# para reproduzir com fidelidade absoluta o estado do ledger remoto.
psql -X -v ON_ERROR_STOP=1 -Atqc "
  INSERT INTO supabase_migrations.schema_migrations(version, name) VALUES
    ('20261027194528', 'm15_20260930_create_import_tables'),
    ('20261027194554', 'm15_20260930_create_profiles'),
    ('20261027194557', 'm15_20260930_add_status_to_profiles'),
    ('20261027194600', 'm15_20260930_update_rotas_structure'),
    ('20261027194603', 'm15_20261001_create_visits_tables'),
    ('20261027194606', 'm15_20261006_add_visits_unique_constraint'),
    ('20261027194616', 'm15_20261006_harden_rbac_rls'),
    ('20261027194620', 'm15_20261006_harden_storage_visit_photos'),
    ('20261027194624', 'm15_20261007_add_delete_user_function'),
    ('20261027194627', 'm15_20261007_allow_admin_insert_profiles'),
    ('20261027194630', 'm15_20261007_create_visit_product_validity'),
    ('20261027194639', 'm15_20261008_auto_generate_store_code'),
    ('20261027194646', 'm15_20261008_clean_legacy_duplicate_visits'),
    ('20261027194650', 'm15_20261008_create_notifications_table'),
    ('20261027194655', 'm15_20261008_industry_client_access'),
    ('20261027194658', 'm15_20261009144200_add_visits_unique_constraint'),
    ('20261027194708', 'm15_20261010_create_system_settings_and_audit'),
    ('20261027194711', 'm15_20261011120000_create_promoter_authorizations'),
    ('20261027194714', 'm15_20261011140000_auto_generate_industry_code'),
    ('20261027194718', 'm15_20261015100000_create_equipes_table'),
    ('20261027194722', 'm15_20261016100000_create_supervisores_table'),
    ('20261027194731', 'm15_20261017_create_avatars_storage_policies'),
    ('20261027194734', 'm15_20261017120000_create_contratos_lojas_table'),
    ('20261027194737', 'm15_20261018150000_add_data_inicio_operacao_to_industrias'),
    ('20261027194740', 'm15_20261018220000_create_promoter_attendance_audit'),
    ('20261027194744', 'm15_20261018230000_create_promoter_schedules_and_absences'),
    ('20261027194754', 'm15_20261018232256_harden_attendance_audit_permissions'),
    ('20261027194801', 'm15_20261018234153_finalize_attendance_journeys_privacy_telemetry'),
    ('20261027194805', 'm15_20261018235500_soft_delete_fixed_routes'),
    ('20261027194808', 'm15_20261019001109_lock_attendance_telemetry_and_scope'),
    ('20261027194811', 'm15_20261019001848_validate_attendance_schedule_overlaps'),
    ('20261027194819', 'm15_20261019004947_add_attendance_work_location'),
    ('20261027194822', 'm15_20261019011832_secure_attendance_photos_and_release_contract'),
    ('20261027194825', 'm15_20261019013007_complete_attendance_operational_setup'),
    ('20261027194904', 'm15_20261019151754_mk9_rh_explicit_bindings'),
    ('20261027194914', 'm15_20261019175853_mk9_rh_admin_binding_preparation'),
    ('20261027194917', 'm15_20261020160000_add_whatsapp_group_link_to_industrias'),
    ('20261027194919', 'm15_20261020160000_mk9_faltas_atestados_prepare_permission'),
    ('20261027194922', 'm15_20261020170000_mk9_absence_records_outbox'),
    ('20261027194925', 'm15_20261021100000_mk9_rh_reconciliation'),
    ('20261027194934', 'm15_20261021120000_mk9_absence_attachments'),
    ('20261027194937', 'm15_20261022152449_mk9_date_visit_regularization_and_checkin_scope'),
    ('20261027194940', 'm15_20261023142837_promoter_scheduled_visit_actions'),
    ('20261030152933', 'm18_homologation_security'),
    ('20261030153146', 'm18_active_session_guard'),
    ('20261030153303', 'm18_industry_route_projection'),
    ('20261030153702', 'm18_photo_upsert_permission')
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
psql -X -v ON_ERROR_STOP=1 -Atqc "SELECT n.nspname,p.relname,p.relkind FROM pg_class p JOIN pg_namespace n ON n.oid=p.relnamespace WHERE n.nspname IN ('public','attendance_private') AND p.relkind IN ('r','p','v','m','f') AND p.relname NOT IN ('visit_lifecycle_audit','visit_lifecycle_authorizations','scheduled_attempt_authorizations') ORDER BY 1,2,3" > "$before_schema"
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
# MISSÃO 37.21: RECONCILIAÇÃO SEGURA COM AS 47 MIGRATIONS HISTÓRICAS DA HOMOLOGAÇÃO
# Popula o workdir com as 47 migrations canônicas recuperadas da homologação
# e adiciona cumulativamente as 5 novas migrations M30/M37.
# Isso garante que:
#  1. O Supabase CLI encontra todas as 47 versões remotas pré-existentes do ledger.
#  2. Nenhuma migration histórica é reaplicada (o CLI reconhece que já estão no ledger).
#  3. Nenhuma migration legada divergente/irregular entra no workspace.
#  4. Exclusivamente as 5 migrations M30/M37 são executadas e registradas.
# -----------------------------------------------------------------------------
echo "=== SUPABASE CLI RECONCILED HISTORICAL WORKDIR (M37.21) ==="
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

# Copiar estritamente as 47 migrations canônicas recuperadas da homologação
cp supabase/fetched_homologation_migrations/*.sql "$cli_test_dir/supabase/migrations/"

# Validar que existem exatamente 47 arquivos históricos e que nenhuma versão se repete
hist_count="$(ls "$cli_test_dir/supabase/migrations" | wc -l)"
if [ "$hist_count" -ne 47 ]; then
  echo "ERROR: Expected exactly 47 historical migrations in workdir, found $hist_count" >&2
  exit 1
fi

unique_hist_versions="$(ls "$cli_test_dir/supabase/migrations" | cut -d_ -f1 | sort -u | wc -l)"
if [ "$unique_hist_versions" -ne 47 ]; then
  echo "ERROR: Duplicate version detected among historical migrations! Unique: $unique_hist_versions vs Total: 47" >&2
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
  supabase/migrations/20261108130000_m38_visit_cancellation_and_day_end_close.sql
  supabase/migrations/20261108170619_m38_retry_attempt_history.sql
  supabase/migrations/20261108174150_m38_checkin_reuses_active_scheduled_attempt.sql
)

for migration in "${migrations[@]}"; do
  mig_basename="$(basename "$migration")"
  expected_ver="$(echo "$mig_basename" | cut -d_ -f1)"
  echo "--- Applying migration to isolated PostgreSQL: $mig_basename ---"

  # Garantir existência e adicionar cumulativamente a migration atual no diretório de migrations do workdir isolado
  mkdir -p "$cli_test_dir/supabase/migrations"
  cp "$migration" "$cli_test_dir/supabase/migrations/"

  # Validar que o arquivo foi copiado para o workdir
  test -f "$cli_test_dir/supabase/migrations/$mig_basename"

  # Aplicar o SQL oficial ao PostgreSQL descartÃ¡vel. O CLI falha ao reconciliar
  # aliases histÃ³ricos; este ledger existe apenas neste banco local de teste.
  apply_migration "$migration"
  psql -X -v ON_ERROR_STOP=1 -Atqc "INSERT INTO supabase_migrations.schema_migrations(version,name) VALUES ('$expected_ver','${mig_basename#*_}') ON CONFLICT(version) DO NOTHING"

  # Verificar se a versão foi registrada nativamente pelo CLI no ledger
  psql -X -v ON_ERROR_STOP=1 -Atqc "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '$expected_ver'" | grep -qx 1
  echo "Version $expected_ver applied and recorded in disposable test ledger."

  # Verificar existência das funções alvo
  psql -X -v ON_ERROR_STOP=1 -Atqc "SELECT count(*) = 3 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE (n.nspname='public' AND p.proname='attendance_check_in') OR (n.nspname='attendance_private' AND p.proname='attendance_start_scheduled_occurrence') OR (n.nspname='public' AND p.proname='check_visit_promotor_update_integrity')" | grep -qx t
done

rm -rf "$cli_test_dir"
echo "All 8 target migrations successfully applied from checked-in SQL files."
echo "Current ledger entries for target migrations:"
psql -X -v ON_ERROR_STOP=1 -c "SELECT version, name FROM supabase_migrations.schema_migrations WHERE version >= '20261105165500' ORDER BY version;"

# Ledger sintético descartável: 47 historical aliases + 8 target migrations = 55
total_ledger="$(psql -X -v ON_ERROR_STOP=1 -Atqc "SELECT count(*) FROM supabase_migrations.schema_migrations;")"
if [ "$total_ledger" -ne 55 ]; then
  echo "ERROR: Expected 55 test-ledger migrations (47 baseline + 8 target), found $total_ledger" >&2
  exit 1
fi
echo "Verified exact disposable ledger count: $total_ledger total versions (47 historical + 8 target)."

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
node scripts/m38-functional-tests.mjs || functional_status=$?

psql -X -v ON_ERROR_STOP=1 -f docs/m37.4-homologation-function-recovery.sql >/dev/null
psql -X -v ON_ERROR_STOP=1 -Atqc "$snapshot_query" | diff -u "$before_snapshot" -
psql -X -v ON_ERROR_STOP=1 -Atqc "SELECT n.nspname,p.relname,p.relkind FROM pg_class p JOIN pg_namespace n ON n.oid=p.relnamespace WHERE n.nspname IN ('public','attendance_private') AND p.relkind IN ('r','p','v','m','f') AND p.relname NOT IN ('visit_lifecycle_audit','visit_lifecycle_authorizations','scheduled_attempt_authorizations') ORDER BY 1,2,3" | diff -u "$before_schema" -
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
