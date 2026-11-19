\set ON_ERROR_STOP on
-- Read-only catalog fingerprints for the exact RC1.25/M37/M38 tables.
WITH target(relname) AS (
  VALUES ('industria_skus'), ('visit_checklist_items'), ('visit_edits_audit_log'),
         ('visit_occurrences'), ('visit_product_validity'),
         ('visit_regularization_audit'), ('visit_sku_stock_checks'), ('visits')
), relations AS (
  SELECT c.oid, c.relname, c.relrowsecurity
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN target t ON t.relname = c.relname
  WHERE n.nspname = 'public'
)
SELECT r.relname,
       (SELECT count(*) FROM information_schema.columns c
        WHERE c.table_schema = 'public' AND c.table_name = r.relname) AS columns,
       md5(coalesce((SELECT string_agg(c.column_name || ':' || c.data_type || ':' || c.is_nullable || ':' || coalesce(c.column_default, ''), '|'
                     ORDER BY c.ordinal_position)
                     FROM information_schema.columns c
                     WHERE c.table_schema = 'public' AND c.table_name = r.relname), '')) AS columns_md5,
       (SELECT count(*) FROM pg_constraint c WHERE c.conrelid = r.oid) AS constraints,
       md5(coalesce((SELECT string_agg(c.conname || ':' || pg_get_constraintdef(c.oid, true), '|'
                     ORDER BY c.conname) FROM pg_constraint c WHERE c.conrelid = r.oid), '')) AS constraints_md5,
       (SELECT count(*) FROM pg_index i WHERE i.indrelid = r.oid) AS indexes,
       md5(coalesce((SELECT string_agg(i.indexrelid::regclass::text || ':' || pg_get_indexdef(i.indexrelid), '|'
                     ORDER BY i.indexrelid::regclass::text) FROM pg_index i WHERE i.indrelid = r.oid), '')) AS indexes_md5,
       (SELECT count(*) FROM pg_policy p WHERE p.polrelid = r.oid) AS policies,
       md5(coalesce((SELECT string_agg(p.polname || ':' || p.polcmd::text || ':' || p.polpermissive::text || ':' ||
                     coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ':' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''), '|'
                     ORDER BY p.polname) FROM pg_policy p WHERE p.polrelid = r.oid), '')) AS policies_md5,
       (SELECT count(*) FROM pg_trigger g WHERE g.tgrelid = r.oid AND NOT g.tgisinternal) AS triggers,
       md5(coalesce((SELECT string_agg(g.tgname || ':' || pg_get_triggerdef(g.oid, true), '|'
                     ORDER BY g.tgname) FROM pg_trigger g WHERE g.tgrelid = r.oid AND NOT g.tgisinternal), '')) AS triggers_md5,
       r.relrowsecurity AS rls_enabled
FROM relations r
ORDER BY r.relname;

SELECT 'ledger=' || count(*)::text || '|visits=' || (SELECT count(*) FROM public.visits)::text
FROM supabase_migrations.schema_migrations;

SELECT p.polrelid::regclass::text AS relation,
       p.polname,
       p.polcmd::text AS command,
       p.polpermissive AS permissive,
       array_to_string(ARRAY(SELECT rolname FROM pg_roles WHERE oid = ANY(p.polroles) ORDER BY rolname), ',') AS roles,
       pg_get_expr(p.polqual, p.polrelid) AS using_expression,
       pg_get_expr(p.polwithcheck, p.polrelid) AS check_expression
FROM pg_policy p
WHERE p.polname = 'm18_active_session'
  AND p.polrelid IN (
    'public.visits'::regclass, 'public.visit_checklist_items'::regclass,
    'public.visit_occurrences'::regclass, 'public.visit_regularization_audit'::regclass,
    'public.visit_product_validity'::regclass
  )
ORDER BY relation;

WITH target(relname) AS (
  VALUES ('industria_skus'), ('visit_checklist_items'), ('visit_edits_audit_log'),
         ('visit_occurrences'), ('visit_product_validity'),
         ('visit_regularization_audit'), ('visit_sku_stock_checks'), ('visits')
), used AS (
  SELECT DISTINCT p.oid
  FROM pg_trigger g
  JOIN pg_class c ON c.oid = g.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN target t ON t.relname = c.relname
  JOIN pg_proc p ON p.oid = g.tgfoid
  WHERE n.nspname = 'public' AND NOT g.tgisinternal
  UNION
  SELECT p.oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE (n.nspname = 'public' AND p.proname IN ('attendance_check_in', 'attendance_check_out', 'save_completed_visit_edit'))
     OR (n.nspname = 'attendance_private' AND p.proname = 'active_user')
)
SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS identity_args,
       md5(replace(p.prosrc, chr(13), '')) AS normalized_body_md5, p.prosecdef, p.provolatile,
       coalesce(array_to_string(p.proconfig, ','), '') AS config
FROM used u
JOIN pg_proc p ON p.oid = u.oid
JOIN pg_namespace n ON n.oid = p.pronamespace
ORDER BY n.nspname, p.proname, identity_args;
