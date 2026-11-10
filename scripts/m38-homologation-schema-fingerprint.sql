-- Read-only fingerprint of the catalog facts M38 depends on before its rollout.
-- Run unchanged against the homologation project and the disposable PostgreSQL 17
-- state after the six already-applied M30/M37 migrations.
WITH facts(k, v) AS (
  SELECT 'function:' || n.nspname || '.' || p.proname,
         oidvectortypes(p.proargtypes) || '|' || pg_get_userbyid(p.proowner) || '|' ||
         p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig, ','), '') || '|' ||
         coalesce(p.proacl::text, '') || '|' || md5(pg_get_functiondef(p.oid))
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE (n.nspname = 'public' AND p.proname IN ('attendance_check_in', 'check_visit_promotor_update_integrity'))
     OR (n.nspname = 'attendance_private' AND p.proname = 'attendance_start_scheduled_occurrence')

  UNION ALL
  SELECT 'index:' || tablename || ':' || indexname, indexdef
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename IN ('visits', 'visit_schedule_actions', 'rotas', 'profiles', 'industrias')

  UNION ALL
  SELECT 'column:' || table_name || ':' || column_name,
         data_type || '|' || is_nullable || '|' || coalesce(column_default, '')
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name IN ('visits', 'visit_schedule_actions', 'rotas', 'profiles', 'industrias')

  UNION ALL
  SELECT 'relation:' || c.relname,
         c.relkind::text || '|' || c.relrowsecurity::text || '|' || c.relforcerowsecurity::text
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN ('visits', 'visit_schedule_actions', 'rotas', 'profiles', 'industrias')

  UNION ALL
  SELECT 'policy:' || tablename || ':' || policyname,
         permissive || '|' || array_to_string(roles, ',') || '|' || cmd || '|' ||
         coalesce(qual, '') || '|' || coalesce(with_check, '')
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('visits', 'visit_schedule_actions', 'rotas', 'profiles', 'industrias')

  UNION ALL
  SELECT 'trigger:' || c.relname || ':' || t.tgname, pg_get_triggerdef(t.oid)
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN ('visits', 'visit_schedule_actions', 'rotas', 'profiles', 'industrias')
    AND NOT t.tgisinternal

  UNION ALL
  SELECT 'constraint:' || c.relname || ':' || con.conname, pg_get_constraintdef(con.oid)
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN ('visits', 'visit_schedule_actions', 'rotas', 'profiles', 'industrias')
)
SELECT count(*) AS fact_count,
       encode(sha256(convert_to(string_agg(k || '=' || v, E'\n' ORDER BY k, v), 'UTF8')), 'hex') AS fingerprint
FROM facts;
