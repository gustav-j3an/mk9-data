SET TIME ZONE 'UTC';

CREATE FUNCTION pg_temp.mk9_backup_inventory() RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  r record;
  row_total bigint;
  row_digest text;
  seq_last_value text;
  seq_is_called boolean;
  table_rows jsonb := '[]'::jsonb;
  schemas jsonb;
  schema_privileges jsonb;
  sequences jsonb := '[]'::jsonb;
  default_privileges jsonb;
  role_memberships jsonb;
  constraints jsonb;
  indexes jsonb;
  types jsonb;
  policies jsonb;
  functions jsonb;
  aggregates jsonb;
  roles jsonb;
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
    ORDER BY n.nspname, c.relname
  LOOP
    EXECUTE format($query$
      WITH row_hashes AS MATERIALIZED (
        SELECT encode(sha256(convert_to(to_jsonb(t)::text, 'UTF8')), 'hex') AS row_digest FROM %I.%I AS t
      ), ranked AS (
        SELECT row_digest, ((row_number() OVER (ORDER BY row_digest COLLATE "C") - 1) / 10000)::bigint AS chunk_number
        FROM row_hashes
      ), chunks AS (
        SELECT chunk_number, encode(sha256(convert_to(string_agg(row_digest, '' ORDER BY row_digest COLLATE "C"), 'UTF8')), 'hex') AS chunk_digest
        FROM ranked GROUP BY chunk_number
      )
      SELECT (SELECT count(*) FROM row_hashes),
             encode(sha256(convert_to(coalesce((SELECT string_agg(chunk_digest, '' ORDER BY chunk_number) FROM chunks), ''), 'UTF8')), 'hex')
    $query$, r.schema_name, r.table_name) INTO row_total, row_digest;
    table_rows := table_rows || jsonb_build_array(jsonb_build_object(
      'schema', r.schema_name, 'table', r.table_name, 'rows', row_total, 'data_sha256', row_digest,
      'owner', r.owner_name, 'acl', r.acl,
      'rls', r.row_security, 'force_rls', r.force_row_security
    ));
  END LOOP;

  SELECT coalesce(jsonb_agg(nspname ORDER BY nspname), '[]'::jsonb) INTO schemas
  FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname <> 'information_schema';

  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'schema', n.nspname, 'owner', pg_get_userbyid(n.nspowner), 'acl', coalesce(n.nspacl::text, '')
    ) ORDER BY n.nspname), '[]'::jsonb) INTO schema_privileges
  FROM pg_namespace n
  WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema';

  FOR r IN
    SELECT n.nspname AS schema_name, c.relname AS sequence_name,
           pg_get_userbyid(c.relowner) AS owner_name, coalesce(c.relacl::text, '') AS acl,
           s.seqtypid::regtype::text AS sequence_type,
           s.seqstart, s.seqincrement, s.seqmin, s.seqmax, s.seqcache, s.seqcycle
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_sequence s ON s.seqrelid = c.oid
    WHERE c.relkind = 'S' AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
    ORDER BY n.nspname, c.relname
  LOOP
    EXECUTE format('SELECT last_value::text, is_called FROM %I.%I', r.schema_name, r.sequence_name)
      INTO seq_last_value, seq_is_called;
    sequences := sequences || jsonb_build_array(jsonb_build_object(
      'schema', r.schema_name, 'name', r.sequence_name, 'owner', r.owner_name, 'acl', r.acl,
      'data_type', r.sequence_type,
      'start', r.seqstart, 'increment', r.seqincrement, 'min', r.seqmin, 'max', r.seqmax,
      'cache', r.seqcache, 'cycle', r.seqcycle, 'last_value', seq_last_value, 'is_called', seq_is_called
    ));
  END LOOP;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'owner', pg_get_userbyid(d.defaclrole),
      'schema', CASE WHEN d.defaclnamespace = 0 THEN NULL ELSE n.nspname END,
      'object_type', d.defaclobjtype, 'acl', coalesce(d.defaclacl::text, '')
    ) ORDER BY pg_get_userbyid(d.defaclrole), n.nspname, d.defaclobjtype), '[]'::jsonb)
    INTO default_privileges
  FROM pg_default_acl d
  LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'role', granted.rolname, 'member', member.rolname, 'grantor', grantor.rolname,
      'admin_option', m.admin_option, 'inherit_option', m.inherit_option, 'set_option', m.set_option
    ) ORDER BY granted.rolname, member.rolname, grantor.rolname), '[]'::jsonb)
    INTO role_memberships
  FROM pg_auth_members m
  JOIN pg_roles granted ON granted.oid = m.roleid
  JOIN pg_roles member ON member.oid = m.member
  JOIN pg_roles grantor ON grantor.oid = m.grantor;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'schema', schemaname, 'table', tablename, 'name', policyname,
      'permissive', permissive, 'roles', pol.roles, 'command', cmd,
      'using', qual, 'check', with_check
    ) ORDER BY schemaname, tablename, policyname), '[]'::jsonb) INTO policies
  FROM pg_policies pol WHERE schemaname !~ '^pg_' AND schemaname <> 'information_schema';

  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'schema', n.nspname, 'name', p.proname,
      'identity_arguments', pg_get_function_identity_arguments(p.oid),
      'definition_sha256', encode(sha256(convert_to(pg_get_functiondef(p.oid), 'UTF8')), 'hex'),
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
      'schema', n.nspname, 'name', p.proname,
      'identity_arguments', pg_get_function_identity_arguments(p.oid),
      'owner', pg_get_userbyid(p.proowner), 'acl', coalesce(p.proacl::text, ''),
      'transition_function', a.aggtransfn::regprocedure::text,
      'final_function', a.aggfinalfn::regprocedure::text,
      'combine_function', a.aggcombinefn::regprocedure::text,
      'serial_function', a.aggserialfn::regprocedure::text,
      'deserial_function', a.aggdeserialfn::regprocedure::text,
      'moving_transition_function', a.aggmtransfn::regprocedure::text,
      'moving_inverse_transition_function', a.aggminvtransfn::regprocedure::text,
      'moving_final_function', a.aggmfinalfn::regprocedure::text,
      'transition_type', a.aggtranstype::regtype::text, 'initial_value', a.agginitval,
      'moving_transition_type', a.aggmtranstype::regtype::text,
      'moving_initial_value', a.aggminitval, 'transition_space', a.aggtransspace,
      'moving_transition_space', a.aggmtransspace, 'sort_operator', a.aggsortop::regoperator::text,
      'final_extra', a.aggfinalextra, 'final_modify', a.aggfinalmodify,
      'moving_final_extra', a.aggmfinalextra, 'moving_final_modify', a.aggmfinalmodify,
      'kind', a.aggkind, 'direct_arguments', a.aggnumdirectargs
    ) ORDER BY n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)), '[]'::jsonb)
    INTO aggregates
  FROM pg_proc p
  JOIN pg_aggregate a ON a.aggfnoid = p.oid
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend d
      WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
    );

  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'name', rolname, 'superuser', rolsuper, 'inherit', rolinherit,
      'create_role', rolcreaterole, 'create_database', rolcreatedb,
      'login', rolcanlogin, 'replication', rolreplication, 'bypass_rls', rolbypassrls,
      'connection_limit', rolconnlimit, 'valid_until', rolvaliduntil,
      'settings', coalesce(rolconfig, ARRAY[]::text[])
    ) ORDER BY rolname), '[]'::jsonb)
    INTO roles
  FROM pg_roles
  WHERE rolname NOT IN (
    'supabase_admin', 'supabase_auth_admin', 'supabase_storage_admin',
    'supabase_functions_admin', 'supabase_read_only_user', 'supabase_replication_admin',
    'authenticator', 'pg_database_owner', 'pg_read_all_data', 'pg_write_all_data'
  );

  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'schema', n.nspname, 'relation_or_domain', coalesce(c.relname, t.typname), 'name', con.conname,
      'type', con.contype, 'definition', pg_get_constraintdef(con.oid, true),
      'validated', con.convalidated, 'deferrable', con.condeferrable,
      'initially_deferred', con.condeferred, 'local', con.conislocal,
      'inheritance_count', con.coninhcount, 'no_inherit', con.connoinherit
    ) ORDER BY n.nspname, coalesce(c.relname, t.typname), con.conname), '[]'::jsonb)
    INTO constraints
  FROM pg_constraint con
  LEFT JOIN pg_class c ON c.oid = con.conrelid AND con.conrelid <> 0
  LEFT JOIN pg_type t ON t.oid = con.contypid AND con.contypid <> 0
  JOIN pg_namespace n ON n.oid = coalesce(c.relnamespace, t.typnamespace)
  WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema';

  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'schema', n.nspname, 'table', base.relname, 'name', idx.relname,
      'definition', pg_get_indexdef(i.indexrelid), 'valid', i.indisvalid,
      'ready', i.indisready, 'unique', i.indisunique, 'primary', i.indisprimary,
      'nulls_not_distinct', i.indnullsnotdistinct, 'key_attributes', i.indnkeyatts,
      'attributes', i.indnatts, 'exclusion', i.indisexclusion,
      'immediate', i.indimmediate, 'clustered', i.indisclustered,
      'replica_identity', i.indisreplident, 'live', i.indislive,
      'owner', pg_get_userbyid(idx.relowner),
      'acl', coalesce(idx.relacl::text, '')
    ) ORDER BY n.nspname, base.relname, idx.relname), '[]'::jsonb)
    INTO indexes
  FROM pg_index i
  JOIN pg_class base ON base.oid = i.indrelid
  JOIN pg_class idx ON idx.oid = i.indexrelid
  JOIN pg_namespace n ON n.oid = base.relnamespace
  WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema';

  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'schema', n.nspname, 'name', t.typname, 'kind', t.typtype,
      'owner', pg_get_userbyid(t.typowner), 'acl', coalesce(t.typacl::text, ''),
      'base_type', t.typbasetype::regtype::text, 'not_null', t.typnotnull,
      'default', t.typdefault,
      'enum_labels', CASE WHEN t.typtype = 'e' THEN (
        SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder)
        FROM pg_enum e WHERE e.enumtypid = t.oid
      ) ELSE NULL END
    ) ORDER BY n.nspname, t.typname), '[]'::jsonb)
    INTO types
  FROM pg_type t
  JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE t.typtype IN ('d', 'e', 'c', 'r', 'm')
    AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend d
      WHERE d.classid = 'pg_type'::regclass AND d.objid = t.oid AND d.deptype = 'e'
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
      'definition_sha256', encode(sha256(convert_to(pg_get_viewdef(c.oid, true), 'UTF8')), 'hex'),
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
    'schemas', schemas, 'schema_privileges', schema_privileges,
    'tables_and_row_counts', table_rows, 'constraints', constraints,
    'indexes', indexes, 'types', types, 'sequences', sequences,
    'default_privileges', default_privileges, 'role_memberships', role_memberships,
    'policies', policies, 'functions', functions, 'aggregates', aggregates, 'roles', roles,
    'triggers', triggers, 'views', views, 'extensions', extensions
  );
END;
$$;

SELECT pg_temp.mk9_backup_inventory();
