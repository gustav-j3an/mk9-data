#!/usr/bin/env bash
set -euo pipefail

psql -X -v ON_ERROR_STOP=1 -Atqc "SELECT current_setting('server_version_num')::int BETWEEN 170000 AND 179999" | grep -qx t
echo "PostgreSQL $(psql -X -v ON_ERROR_STOP=1 -Atqc 'SHOW server_version')"

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
 ORDER BY n.nspname, p.proname"
before_snapshot="$(mktemp)"
before_schema="$(mktemp)"
trap 'rm -f "$before_snapshot" "$before_schema"' EXIT
psql -X -v ON_ERROR_STOP=1 -Atqc "$snapshot_query" > "$before_snapshot"
psql -X -v ON_ERROR_STOP=1 -Atqc "SELECT n.nspname,p.relname,p.relkind FROM pg_class p JOIN pg_namespace n ON n.oid=p.relnamespace WHERE n.nspname IN ('public','attendance_private') ORDER BY 1,2,3" > "$before_schema"
test "$(wc -l < "$before_snapshot")" -eq 2

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

migrations=(
  supabase/migrations/20261105165500_m30_harden_industry_active_checkin.sql
  supabase/migrations/20261106131614_m30_serialize_industry_checkin.sql
  supabase/migrations/20261106140000_m37_pending_visit_active_route_guard.sql
  supabase/migrations/20261106150000_m37_checkin_route_and_conflict_guard.sql
)
for migration in "${migrations[@]}"; do
  apply_migration "$migration"
  psql -X -v ON_ERROR_STOP=1 -Atqc "SELECT count(*) = 2 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE (n.nspname='public' AND p.proname='attendance_check_in') OR (n.nspname='attendance_private' AND p.proname='attendance_start_scheduled_occurrence')" | grep -qx t
done
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

psql -X -v ON_ERROR_STOP=1 -f docs/m37.4-homologation-function-recovery.sql >/dev/null
psql -X -v ON_ERROR_STOP=1 -Atqc "$snapshot_query" | diff -u "$before_snapshot" -
psql -X -v ON_ERROR_STOP=1 -Atqc "SELECT n.nspname,p.relname,p.relkind FROM pg_class p JOIN pg_namespace n ON n.oid=p.relnamespace WHERE n.nspname IN ('public','attendance_private') ORDER BY 1,2,3" | diff -u "$before_schema" -
psql -X -v ON_ERROR_STOP=1 -Atqc "
WITH expected(schema_name, function_name, expected_md5, expected_acl) AS (
 VALUES
 ('attendance_private','attendance_start_scheduled_occurrence','f7741ffc813a80dc10c86e90ec634a6e','{postgres=X/postgres,authenticated=X/postgres}'),
 ('public','attendance_check_in','39dd2b79c48b4e808d81e22aa1140e3e','{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}')
)
SELECT e.schema_name || '.' || e.function_name,
  'catalog=' || (pg_get_userbyid(p.proowner)='postgres'
    AND p.prosecdef
    AND p.proconfig = ARRAY['search_path=\"\"']::text[]
    AND p.proacl::text=e.expected_acl
    AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
    AND has_function_privilege('authenticated',p.oid,'EXECUTE'))::text,
  'homologation_text_hash=' || (md5(pg_get_functiondef(p.oid))=e.expected_md5)::text,
  'actual_hash=' || md5(pg_get_functiondef(p.oid))
FROM expected e JOIN pg_namespace n ON n.nspname=e.schema_name
JOIN pg_proc p ON p.pronamespace=n.oid AND p.proname=e.function_name;
"
psql -X -v ON_ERROR_STOP=1 -Atqc "
WITH expected(schema_name, function_name, expected_acl) AS (
 VALUES
 ('attendance_private','attendance_start_scheduled_occurrence','{postgres=X/postgres,authenticated=X/postgres}'),
 ('public','attendance_check_in','{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}')
)
SELECT count(*) = 2 AND bool_and(pg_get_userbyid(p.proowner)='postgres'
 AND p.prosecdef AND p.proconfig = ARRAY['search_path=\"\"']::text[]
 AND p.proacl::text=e.expected_acl
 AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
 AND has_function_privilege('authenticated',p.oid,'EXECUTE'))
FROM expected e JOIN pg_namespace n ON n.nspname=e.schema_name
JOIN pg_proc p ON p.pronamespace=n.oid AND p.proname=e.function_name;
" | grep -qx t

echo 'Recovery catalog checks passed on PostgreSQL 17.'
