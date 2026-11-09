CREATE FUNCTION pg_temp.mk9_backup_inventory() RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  r record;
  row_total bigint;
  row_digest text;
  table_rows jsonb := '[]'::jsonb;
  tables jsonb;
  schemas jsonb;
  policies jsonb;
  functions jsonb;
  triggers jsonb;
  views jsonb;
  extensions jsonb;
BEGIN
  FOR r IN
    SELECT n.nspname AS schema_name, c.relname AS table_name,
           pg_get_userbyid(c.relowner) AS owner_name,
           coalesce(c.relacl::text, '') AS acl,
           c.relrowsecurity AS row_security,
           c.relforcerowsecurity AS force_row_security
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p')
      AND n.nspname !~ '^pg_'
      AND n.nspname <> 'information_schema'
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e'
      )
    ORDER BY n.nspname, c.relname
  LOOP
    EXECUTE format($query$
      WITH row_hashes AS MATERIALIZED (
        SELECT md5(to_jsonb(t)::text) AS row_digest FROM %I.%I AS t
      ), ranked AS (
        SELECT row_digest, ((row_number() OVER (ORDER BY row_digest) - 1) / 10000)::bigint AS chunk_number
        FROM row_hashes
      ), chunks AS (
        SELECT chunk_number, md5(string_agg(row_digest, '' ORDER BY row_digest)) AS chunk_digest
        FROM ranked GROUP BY chunk_number
      )
      SELECT (SELECT count(*) FROM row_hashes),
             md5(coalesce((SELECT string_agg(chunk_digest, '' ORDER BY chunk_number) FROM chunks), ''))
    $query$, r.schema_name, r.table_name) INTO row_total, row_digest;
    table_rows := table_rows || jsonb_build_array(jsonb_build_object(
      'schema', r.schema_name, 'table', r.table_name, 'rows', row_total, 'data_md5', row_digest,
      'owner', r.owner_name, 'acl', r.acl,
      'rls', r.row_security, 'force_rls', r.force_row_security
    ));
  END LOOP;

  SELECT coalesce(jsonb_agg(nspname ORDER BY nspname), '[]'::jsonb) INTO schemas
  FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname <> 'information_schema';

  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'schema', schemaname, 'table', tablename, 'name', policyname,
      'permissive', permissive, 'roles', roles, 'command', cmd,
      'using', qual, 'check', with_check
    ) ORDER BY schemaname, tablename, policyname), '[]'::jsonb) INTO policies
  FROM pg_policies WHERE schemaname !~ '^pg_' AND schemaname <> 'information_schema';

  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'schema', n.nspname, 'name', p.proname,
      'identity_arguments', pg_get_function_identity_arguments(p.oid),
      'definition_md5', md5(pg_get_functiondef(p.oid)),
      'security_definer', p.prosecdef,
      'config', coalesce(p.proconfig, ARRAY[]::text[]),
      'owner', pg_get_userbyid(p.proowner), 'acl', coalesce(p.proacl::text, '')
    ) ORDER BY n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)), '[]'::jsonb) INTO functions
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.prokind IN ('f', 'p', 'w')
    AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend d
      WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
    );

  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'schema', n.nspname, 'table', c.relname, 'name', t.tgname,
      'enabled', t.tgenabled, 'definition', pg_get_triggerdef(t.oid, true)
    ) ORDER BY n.nspname, c.relname, t.tgname), '[]'::jsonb) INTO triggers
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE NOT t.tgisinternal
    AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema';

  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'schema', n.nspname, 'name', c.relname,
      'definition_md5', md5(pg_get_viewdef(c.oid, true)),
      'owner', pg_get_userbyid(c.relowner), 'acl', coalesce(c.relacl::text, '')
    ) ORDER BY n.nspname, c.relname), '[]'::jsonb) INTO views
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('v', 'm')
    AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend d
      WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e'
    );

  SELECT coalesce(jsonb_agg(jsonb_build_object('name', extname, 'version', extversion) ORDER BY extname), '[]'::jsonb)
    INTO extensions FROM pg_extension;

  RETURN jsonb_build_object(
    'schemas', schemas, 'tables_and_row_counts', table_rows,
    'policies', policies, 'functions', functions,
    'triggers', triggers, 'views', views, 'extensions', extensions
  );
END;
$$;

SELECT pg_temp.mk9_backup_inventory();
