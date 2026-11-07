#!/usr/bin/env bash
set -euo pipefail

psql -X -v ON_ERROR_STOP=1 -Atqc "SELECT current_setting('server_version_num')::int BETWEEN 170000 AND 179999" | grep -qx t

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
done < <(find supabase/migrations -maxdepth 1 -type f -name '*.sql' | sort | awk -F/ '$NF < "20261101" && $NF !~ /^20260930_/')
for migration in "${baseline[@]}"; do
  echo "Baseline: $(basename "$migration")"
  psql -X -v ON_ERROR_STOP=1 -1 -f "$migration" >/dev/null
done

migrations=(
  supabase/migrations/20261105165500_m30_harden_industry_active_checkin.sql
  supabase/migrations/20261106131614_m30_serialize_industry_checkin.sql
  supabase/migrations/20261106140000_m37_pending_visit_active_route_guard.sql
  supabase/migrations/20261106150000_m37_checkin_route_and_conflict_guard.sql
)
for migration in "${migrations[@]}"; do
  echo "Target: $(basename "$migration")"
  # Each file is atomic; on failure stop without treating its stage as applied.
  psql -X -v ON_ERROR_STOP=1 -1 -f "$migration" >/dev/null
  psql -X -v ON_ERROR_STOP=1 -Atqc "SELECT count(*) = 2 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE (n.nspname='public' AND p.proname='attendance_check_in') OR (n.nspname='attendance_private' AND p.proname='attendance_start_scheduled_occurrence')" | grep -qx t
done

psql -X -v ON_ERROR_STOP=1 -f docs/m37.4-homologation-function-recovery.sql >/dev/null
psql -X -v ON_ERROR_STOP=1 -Atqc "
WITH expected(schema_name, function_name, expected_md5, expected_acl) AS (
 VALUES
 ('attendance_private','attendance_start_scheduled_occurrence','f7741ffc813a80dc10c86e90ec634a6e','{postgres=X/postgres,authenticated=X/postgres}'),
 ('public','attendance_check_in','39dd2b79c48b4e808d81e22aa1140e3e','{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}')
)
SELECT count(*) = 2 AND bool_and(
  pg_get_userbyid(p.proowner)='postgres'
  AND p.prosecdef
  AND p.proconfig = ARRAY['search_path=\"\"']::text[]
  AND p.proacl::text=e.expected_acl
  AND md5(pg_get_functiondef(p.oid))=e.expected_md5
  AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
  AND has_function_privilege('authenticated',p.oid,'EXECUTE')
) FROM expected e JOIN pg_namespace n ON n.nspname=e.schema_name
JOIN pg_proc p ON p.pronamespace=n.oid AND p.proname=e.function_name;
" | grep -qx t

echo 'Recovery catalog checks passed on PostgreSQL 17.'

