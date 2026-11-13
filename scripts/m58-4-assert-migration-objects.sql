DO $m58$
DECLARE
  actual_count integer;
  item record;
  policy_row record;
  policy_names text[];
BEGIN
  -- 20261009144200: exact unique key, order, and backing index.
  SELECT count(*) INTO actual_count FROM pg_constraint
  WHERE conrelid = 'public.visits'::regclass
    AND conname = 'visits_promotor_loja_industria_data_unique'
    AND contype = 'u'
    AND pg_get_constraintdef(oid) = 'UNIQUE (promotor_matricula, loja_codigo, industria_codigo, data_visita)';
  IF actual_count <> 1 THEN RAISE EXCEPTION 'M58_4_VISITS_UNIQUE_CONSTRAINT_MISMATCH'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class x ON x.oid=i.indexrelid
    WHERE i.indrelid='public.visits'::regclass AND x.relname='visits_promotor_loja_industria_data_unique'
      AND i.indisunique AND i.indisvalid AND i.indisready AND i.indnkeyatts=4) THEN
    RAISE EXCEPTION 'M58_4_VISITS_UNIQUE_INDEX_MISMATCH';
  END IF;

  -- Exact table column counts plus type/nullability/default anchors per migration.
  FOR item IN SELECT * FROM (VALUES
    ('system_settings', 5), ('system_settings_audit_log', 10),
    ('promoter_operation_authorizations', 15), ('promoter_operation_authorizations_audit_log', 11),
    ('contratos_lojas', 21)
  ) AS expected(table_name, column_count)
  LOOP
    SELECT count(*) INTO actual_count FROM information_schema.columns
    WHERE table_schema='public' AND table_name=item.table_name;
    IF actual_count <> item.column_count THEN RAISE EXCEPTION 'M58_4_COLUMN_COUNT_MISMATCH:%', item.table_name; END IF;
  END LOOP;
  FOR item IN SELECT * FROM (VALUES
    ('system_settings', ARRAY['key','value','description','updated_at','updated_by']::text[]),
    ('system_settings_audit_log', ARRAY['id','changed_at','changed_by','changed_by_name','changed_by_email','previous_mode','new_mode','previous_start_date','new_start_date','justification']::text[]),
    ('promoter_operation_authorizations', ARRAY['id','promotor_matricula','status','authorized_at','authorized_by','authorized_by_name','authorized_by_email','justification','revoked_at','revoked_by','revoked_by_name','revoked_by_email','revocation_reason','created_at','updated_at']::text[]),
    ('promoter_operation_authorizations_audit_log', ARRAY['id','event_at','promotor_matricula','action','previous_status','new_status','changed_by','changed_by_name','changed_by_email','justification','created_at']::text[]),
    ('contratos_lojas', ARRAY['id','industria_codigo','loja_codigo','frequencia','visitas_por_semana','segunda','terca','quarta','quinta','sexta','sabado','domingo','ciclo_quinzenal','data_inicio_vigencia','data_fim_vigencia','status','valor_por_visita','origem','observacao','created_at','updated_at']::text[])
  ) AS expected(table_name, column_names)
  LOOP
    IF (SELECT array_agg(column_name::text ORDER BY ordinal_position) FROM information_schema.columns
      WHERE table_schema='public' AND table_name=item.table_name) IS DISTINCT FROM item.column_names THEN
      RAISE EXCEPTION 'M58_4_COLUMN_SET_MISMATCH:%', item.table_name;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='system_settings' AND column_name='key' AND data_type='text' AND is_nullable='NO')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='system_settings' AND column_name='value' AND data_type='jsonb' AND is_nullable='NO')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='system_settings' AND column_name='updated_by' AND udt_name='uuid') THEN
    RAISE EXCEPTION 'M58_4_SYSTEM_SETTINGS_COLUMN_MISMATCH';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='system_settings_audit_log' AND column_name='justification' AND data_type='text' AND is_nullable='NO')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='system_settings_audit_log' AND column_name='previous_start_date' AND data_type='date') THEN
    RAISE EXCEPTION 'M58_4_SYSTEM_SETTINGS_AUDIT_COLUMN_MISMATCH';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='promoter_operation_authorizations' AND column_name='status' AND column_default LIKE '%liberado%')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='promoter_operation_authorizations' AND column_name='promotor_matricula' AND is_nullable='NO')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='promoter_operation_authorizations_audit_log' AND column_name='action' AND is_nullable='NO') THEN
    RAISE EXCEPTION 'M58_4_PROMOTER_AUTH_COLUMN_MISMATCH';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contratos_lojas' AND column_name='frequencia' AND column_default LIKE '%SEMANAL%')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contratos_lojas' AND column_name='visitas_por_semana' AND data_type='integer')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contratos_lojas' AND column_name='ciclo_quinzenal' AND data_type='text')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contratos_lojas' AND column_name='data_inicio_vigencia' AND data_type='date' AND is_nullable='NO') THEN
    RAISE EXCEPTION 'M58_4_CONTRACT_COLUMN_MISMATCH';
  END IF;

  -- Exact constraints, foreign-key cardinality and migration-created indexes.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.system_settings'::regclass AND conname='system_settings_valid_keys' AND contype='c' AND pg_get_constraintdef(oid) LIKE '%operation_mode%' AND pg_get_constraintdef(oid) LIKE '%official_start_date%')
     OR (SELECT count(*) FROM pg_constraint WHERE conrelid='public.promoter_operation_authorizations'::regclass AND contype='f') <> 3
     OR (SELECT count(*) FROM pg_constraint WHERE conrelid='public.promoter_operation_authorizations_audit_log'::regclass AND contype='f') <> 2
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.promoter_operation_authorizations'::regclass AND conname='promoter_authorizations_matricula_unique' AND pg_get_constraintdef(oid)='UNIQUE (promotor_matricula)')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.contratos_lojas'::regclass AND conname='check_vigencia_valida' AND contype='c' AND pg_get_constraintdef(oid) LIKE '%data_fim_vigencia IS NULL%' AND pg_get_constraintdef(oid) LIKE '%data_fim_vigencia >= data_inicio_vigencia%')
     OR (SELECT count(*) FROM pg_constraint WHERE conrelid='public.contratos_lojas'::regclass AND contype='c') <> 7 THEN
    RAISE EXCEPTION 'M58_4_CONSTRAINT_DEFINITION_MISMATCH';
  END IF;
  FOR item IN SELECT * FROM (VALUES
    ('system_settings_audit_log','idx_system_settings_audit_log_changed_at'),
    ('promoter_operation_authorizations','idx_promoter_auth_matricula'),
    ('promoter_operation_authorizations','idx_promoter_auth_status'),
    ('promoter_operation_authorizations_audit_log','idx_promoter_auth_audit_matricula'),
    ('promoter_operation_authorizations_audit_log','idx_promoter_auth_audit_event_at'),
    ('contratos_lojas','idx_contratos_industria'), ('contratos_lojas','idx_contratos_loja'),
    ('contratos_lojas','idx_contratos_status_vigencia')
  ) AS expected(table_name,index_name)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename=item.table_name AND indexname=item.index_name) THEN
      RAISE EXCEPTION 'M58_4_EXPECTED_INDEX_MISSING:%', item.index_name;
    END IF;
  END LOOP;
  FOR item IN SELECT * FROM (VALUES
    ('system_settings_audit_log', ARRAY['idx_system_settings_audit_log_changed_at','system_settings_audit_log_pkey']::text[]),
    ('promoter_operation_authorizations', ARRAY['idx_promoter_auth_matricula','idx_promoter_auth_status','promoter_authorizations_matricula_unique','promoter_operation_authorizations_pkey']::text[]),
    ('promoter_operation_authorizations_audit_log', ARRAY['idx_promoter_auth_audit_event_at','idx_promoter_auth_audit_matricula','promoter_operation_authorizations_audit_log_pkey']::text[]),
    ('contratos_lojas', ARRAY['contratos_lojas_pkey','idx_contratos_industria','idx_contratos_loja','idx_contratos_status_vigencia']::text[])
  ) AS expected(table_name,index_names)
  LOOP
    IF (SELECT array_agg(indexname::text ORDER BY indexname) FROM pg_indexes WHERE schemaname='public' AND tablename=item.table_name)
      IS DISTINCT FROM item.index_names THEN
      RAISE EXCEPTION 'M58_4_INDEX_SET_MISMATCH:%', item.table_name;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='system_settings_audit_log' AND indexname='idx_system_settings_audit_log_changed_at' AND indexdef LIKE '%(changed_at DESC)%')
     OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='promoter_operation_authorizations_audit_log' AND indexname='idx_promoter_auth_audit_event_at' AND indexdef LIKE '%(event_at DESC)%')
     OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='contratos_lojas' AND indexname='idx_contratos_status_vigencia' AND indexdef LIKE '%(status, data_inicio_vigencia, data_fim_vigencia)%') THEN
    RAISE EXCEPTION 'M58_4_INDEX_DEFINITION_MISMATCH';
  END IF;

  -- RLS must be enabled and forced-RLS must retain the migration's expected false setting.
  FOR item IN SELECT * FROM (VALUES
    ('system_settings'), ('system_settings_audit_log'),
    ('promoter_operation_authorizations'), ('promoter_operation_authorizations_audit_log'),
    ('visits'), ('visit_checklist_items'), ('visit_photos'), ('visit_occurrences'),
    ('visit_product_validity'), ('contratos_lojas')
  ) AS expected(table_name)
  LOOP
    IF COALESCE((SELECT relrowsecurity AND NOT relforcerowsecurity FROM pg_class WHERE oid=format('public.%I', item.table_name)::regclass), false) IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'M58_4_RLS_STATE_MISMATCH:%', item.table_name;
    END IF;
  END LOOP;
  IF COALESCE((SELECT relrowsecurity AND NOT relforcerowsecurity FROM pg_class WHERE oid='storage.objects'::regclass), false) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'M58_4_STORAGE_RLS_STATE_MISMATCH';
  END IF;

  -- The set and command/role scope of migration policies must match exactly on these relations.
  FOR item IN SELECT * FROM (VALUES
    ('public','system_settings',4,ARRAY['system_settings_block_direct_delete','system_settings_block_direct_insert','system_settings_block_direct_update','system_settings_select_authenticated']::text[]),
    ('public','system_settings_audit_log',2,ARRAY['system_settings_audit_block_direct_write','system_settings_audit_select_admin_gestor']::text[]),
    ('public','promoter_operation_authorizations',3,ARRAY['promoter_auth_insert_policy','promoter_auth_select_policy','promoter_auth_update_policy']::text[]),
    ('public','promoter_operation_authorizations_audit_log',2,ARRAY['promoter_auth_audit_block_direct_write','promoter_auth_audit_select_policy']::text[]),
    ('public','visits',1,ARRAY['visits_insert_policy']::text[]),
    ('public','visit_checklist_items',1,ARRAY['visit_checklist_items_write_policy']::text[]),
    ('public','visit_photos',1,ARRAY['visit_photos_write_policy']::text[]),
    ('public','visit_occurrences',1,ARRAY['visit_occurrences_write_policy']::text[]),
    ('public','visit_product_validity',1,ARRAY['visit_product_validity_write_policy']::text[]),
    ('public','contratos_lojas',4,ARRAY['contratos_lojas_delete_policy','contratos_lojas_insert_policy','contratos_lojas_select_policy','contratos_lojas_update_policy']::text[]),
    ('storage','objects',4,ARRAY['Avatars user delete policy','Avatars user insert policy','Avatars user select policy','Avatars user update policy']::text[])
  ) AS expected(schema_name,table_name,policy_count,policy_names)
  LOOP
    SELECT count(*), coalesce(array_agg(policyname::text ORDER BY policyname), ARRAY[]::text[])
      INTO actual_count, policy_names FROM pg_policies
      WHERE schemaname=item.schema_name AND tablename=item.table_name;
    IF actual_count <> item.policy_count OR policy_names <> item.policy_names THEN
      RAISE EXCEPTION 'M58_4_POLICY_SET_MISMATCH:%:%', item.schema_name, item.table_name;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname=item.schema_name AND tablename=item.table_name
      AND (permissive <> 'PERMISSIVE' OR roles <> ARRAY['authenticated']::name[])) THEN
      RAISE EXCEPTION 'M58_4_POLICY_ROLE_OR_PERMISSIVE_MISMATCH:%:%', item.schema_name, item.table_name;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='system_settings' AND policyname='system_settings_select_authenticated' AND cmd='SELECT' AND qual='true')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='system_settings' AND policyname='system_settings_block_direct_insert' AND cmd='INSERT' AND with_check='false')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='system_settings' AND policyname='system_settings_block_direct_update' AND cmd='UPDATE' AND qual='false' AND with_check='false')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='system_settings' AND policyname='system_settings_block_direct_delete' AND cmd='DELETE' AND qual='false')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='system_settings_audit_log' AND policyname='system_settings_audit_select_admin_gestor' AND qual LIKE '%is_admin_or_gestor%')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='system_settings_audit_log' AND policyname='system_settings_audit_block_direct_write' AND cmd='ALL' AND qual='false' AND with_check='false') THEN
    RAISE EXCEPTION 'M58_4_SYSTEM_SETTINGS_POLICY_DEFINITION_MISMATCH';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='promoter_operation_authorizations' AND policyname='promoter_auth_select_policy' AND cmd='SELECT' AND qual LIKE '%get_auth_promotor_matricula%' AND qual LIKE '%operador%')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='promoter_operation_authorizations' AND policyname='promoter_auth_insert_policy' AND cmd='INSERT' AND with_check LIKE '%is_admin_or_gestor%')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='promoter_operation_authorizations' AND policyname='promoter_auth_update_policy' AND cmd='UPDATE' AND qual LIKE '%is_admin_or_gestor%' AND with_check LIKE '%is_admin_or_gestor%')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='promoter_operation_authorizations_audit_log' AND policyname='promoter_auth_audit_block_direct_write' AND cmd='ALL' AND qual='false' AND with_check='false')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='visits' AND policyname='visits_insert_policy' AND cmd='INSERT' AND with_check LIKE '%is_promotor_authorized%' AND with_check LIKE '%get_auth_promotor_matricula%') THEN
    RAISE EXCEPTION 'M58_4_PROMOTER_POLICY_DEFINITION_MISMATCH';
  END IF;
  FOR item IN SELECT * FROM (VALUES
    ('visit_checklist_items','visit_checklist_items_write_policy'),('visit_photos','visit_photos_write_policy'),
    ('visit_occurrences','visit_occurrences_write_policy'),('visit_product_validity','visit_product_validity_write_policy')
  ) AS expected(table_name,policy_name)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=item.table_name AND policyname=item.policy_name AND cmd='ALL'
      AND qual LIKE '%em_andamento%' AND qual LIKE '%get_auth_promotor_matricula%'
      AND with_check LIKE '%em_andamento%' AND with_check LIKE '%get_auth_promotor_matricula%') THEN
      RAISE EXCEPTION 'M58_4_CHILD_VISIT_POLICY_DEFINITION_MISMATCH:%', item.table_name;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Avatars user select policy' AND cmd='SELECT' AND qual LIKE '%bucket_id%' AND qual LIKE '%avatars%' AND qual LIKE '%foldername%' AND qual LIKE '%is_admin_or_gestor%')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Avatars user insert policy' AND cmd='INSERT' AND with_check LIKE '%bucket_id%' AND with_check LIKE '%avatars%' AND with_check LIKE '%foldername%' AND with_check LIKE '%auth.uid%')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Avatars user update policy' AND cmd='UPDATE' AND qual LIKE '%foldername%' AND with_check LIKE '%foldername%')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Avatars user delete policy' AND cmd='DELETE' AND qual LIKE '%bucket_id%' AND qual LIKE '%avatars%' AND qual LIKE '%foldername%' AND qual LIKE '%auth.uid%') THEN
    RAISE EXCEPTION 'M58_4_AVATAR_POLICY_DEFINITION_MISMATCH';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='contratos_lojas' AND policyname='contratos_lojas_select_policy' AND cmd='SELECT' AND qual LIKE '%get_auth_industria_codigo%' AND qual LIKE '%get_auth_promotor_matricula%')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='contratos_lojas' AND policyname='contratos_lojas_insert_policy' AND cmd='INSERT' AND with_check LIKE '%is_admin_or_gestor%' AND with_check LIKE '%operador%')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='contratos_lojas' AND policyname='contratos_lojas_update_policy' AND cmd='UPDATE' AND qual LIKE '%operador%' AND with_check LIKE '%operador%')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='contratos_lojas' AND policyname='contratos_lojas_delete_policy' AND cmd='DELETE' AND qual LIKE '%admin%') THEN
    RAISE EXCEPTION 'M58_4_CONTRACT_POLICY_DEFINITION_MISMATCH';
  END IF;

  -- Function security attributes, trigger bindings, and role grants/revocations.
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.set_operation_mode(text,date,text)'::regprocedure
    AND prosecdef AND proconfig @> ARRAY['search_path=public, auth, pg_temp'])
     OR NOT has_function_privilege('authenticated','public.set_operation_mode(text,date,text)','EXECUTE')
     OR has_function_privilege('anon','public.set_operation_mode(text,date,text)','EXECUTE') THEN
    RAISE EXCEPTION 'M58_4_OPERATION_MODE_SECURITY_OR_ACL_MISMATCH';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.is_promotor_authorized(text)'::regprocedure AND prosecdef AND provolatile='s' AND proconfig @> ARRAY['search_path=public, pg_temp'])
     OR NOT has_function_privilege('authenticated','public.is_promotor_authorized(text)','EXECUTE')
     OR has_function_privilege('anon','public.is_promotor_authorized(text)','EXECUTE')
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.check_visit_promotor_update_integrity()'::regprocedure AND prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp'])
     OR NOT has_function_privilege('authenticated','public.set_promoter_authorization(text,text,text)','EXECUTE')
     OR has_function_privilege('anon','public.set_promoter_authorization(text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'M58_4_PROMOTER_RPC_SECURITY_OR_ACL_MISMATCH';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.industrias'::regclass AND conname='industrias_codigo_key' AND contype='u' AND pg_get_constraintdef(oid)='UNIQUE (codigo)')
     OR NOT EXISTS (SELECT 1 FROM pg_sequence WHERE seqrelid='public.industrias_codigo_seq'::regclass AND seqstart=1 AND seqincrement=1)
     OR NOT has_sequence_privilege('authenticated','public.industrias_codigo_seq','USAGE')
     OR NOT has_sequence_privilege('authenticated','public.industrias_codigo_seq','SELECT')
     OR NOT has_function_privilege('authenticated','public.generate_industry_code()','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.get_next_industry_code()','EXECUTE') THEN
    RAISE EXCEPTION 'M58_4_INDUSTRY_SEQUENCE_OR_ACL_MISMATCH';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.generate_industry_code()'::regprocedure AND prosecdef AND proconfig IS NULL)
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.get_next_industry_code()'::regprocedure AND prosecdef AND provolatile='s' AND proconfig IS NULL)
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.set_industria_codigo_trigger()'::regprocedure AND prosecdef AND proconfig IS NULL) THEN
    RAISE EXCEPTION 'M58_4_INDUSTRY_FUNCTION_SECURITY_MISMATCH';
  END IF;
  SELECT count(*) INTO actual_count FROM pg_trigger WHERE tgrelid='public.visits'::regclass AND NOT tgisinternal;
  IF actual_count <> 1 OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.visits'::regclass AND tgname='trg_visit_promotor_update_integrity' AND (tgtype & 2)=2 AND (tgtype & 16)=16 AND tgfoid='public.check_visit_promotor_update_integrity()'::regprocedure) THEN
    RAISE EXCEPTION 'M58_4_VISIT_TRIGGER_DEFINITION_MISMATCH';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.industrias'::regclass AND NOT tgisinternal) <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.industrias'::regclass AND tgname='trigger_set_industria_codigo' AND (tgtype & 2)=2 AND (tgtype & 4)=4 AND (tgtype & 1)=1 AND tgfoid='public.set_industria_codigo_trigger()'::regprocedure) THEN
    RAISE EXCEPTION 'M58_4_INDUSTRY_TRIGGER_DEFINITION_MISMATCH';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.contratos_lojas'::regclass AND NOT tgisinternal) <> 2 THEN
    RAISE EXCEPTION 'M58_4_CONTRACT_TRIGGER_COUNT_MISMATCH';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.contratos_lojas'::regclass AND tgname='trigger_check_contratos_vigencia_overlap' AND (tgtype & 2)=2 AND tgfoid='public.check_contratos_vigencia_overlap()'::regprocedure)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.contratos_lojas'::regclass AND tgname='trigger_contratos_updated_at' AND (tgtype & 2)=2 AND (tgtype & 16)=16 AND tgfoid='public.handle_contratos_updated_at()'::regprocedure) THEN
    RAISE EXCEPTION 'M58_4_CONTRACT_TRIGGER_DEFINITION_MISMATCH';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.check_contratos_vigencia_overlap()'::regprocedure AND prosecdef AND proconfig @> ARRAY['search_path=pg_catalog, public'])
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.handle_contratos_updated_at()'::regprocedure AND NOT prosecdef AND proconfig @> ARRAY['search_path=pg_catalog, public'])
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.sync_contratos_from_rotas()'::regprocedure AND prosecdef AND proconfig @> ARRAY['search_path=pg_catalog, public']) THEN
    RAISE EXCEPTION 'M58_4_CONTRACT_FUNCTION_SECURITY_MISMATCH';
  END IF;
  IF NOT has_function_privilege('authenticated','public.sync_contratos_from_rotas()','EXECUTE') THEN
    RAISE EXCEPTION 'M58_4_CONTRACT_SYNC_AUTHENTICATED_EXECUTE_MISSING';
  END IF;
  IF has_function_privilege('service_role','public.sync_contratos_from_rotas()','EXECUTE') THEN
    RAISE EXCEPTION 'M58_4_CONTRACT_SYNC_SERVICE_ROLE_EXECUTE_UNEXPECTED';
  END IF;
  IF has_function_privilege('anon','public.sync_contratos_from_rotas()','EXECUTE') THEN
    RAISE EXCEPTION 'M58_4_CONTRACT_SYNC_ANON_EXECUTE_UNEXPECTED'
      USING DETAIL = format('effective_anon_execute=true; acl=%s; direct_anon_execute=%s; public_execute=%s; anon_inherits_authenticated=%s',
        (SELECT proacl::text FROM pg_proc WHERE oid='public.sync_contratos_from_rotas()'::regprocedure),
        (SELECT EXISTS (SELECT 1 FROM aclexplode(COALESCE(proacl, acldefault('f',proowner))) a
          WHERE a.grantee=(SELECT oid FROM pg_roles WHERE rolname='anon') AND a.privilege_type='EXECUTE')
          FROM pg_proc WHERE oid='public.sync_contratos_from_rotas()'::regprocedure),
        (SELECT EXISTS (SELECT 1 FROM aclexplode(COALESCE(proacl, acldefault('f',proowner))) a
          WHERE a.grantee=0 AND a.privilege_type='EXECUTE')
          FROM pg_proc WHERE oid='public.sync_contratos_from_rotas()'::regprocedure),
        pg_has_role('anon','authenticated','USAGE'));
  END IF;
  IF has_function_privilege('anon','public.check_contratos_vigencia_overlap()','EXECUTE') THEN
    RAISE EXCEPTION 'M58_4_CONTRACT_OVERLAP_TRIGGER_ANON_EXECUTE_UNEXPECTED'
      USING DETAIL = format('effective_anon_execute=true; acl=%s; direct_anon_execute=%s; public_execute=%s; anon_inherits_authenticated=%s',
        (SELECT proacl::text FROM pg_proc WHERE oid='public.check_contratos_vigencia_overlap()'::regprocedure),
        (SELECT EXISTS (SELECT 1 FROM aclexplode(COALESCE(proacl, acldefault('f',proowner))) a
          WHERE a.grantee=(SELECT oid FROM pg_roles WHERE rolname='anon') AND a.privilege_type='EXECUTE')
          FROM pg_proc WHERE oid='public.check_contratos_vigencia_overlap()'::regprocedure),
        (SELECT EXISTS (SELECT 1 FROM aclexplode(COALESCE(proacl, acldefault('f',proowner))) a
          WHERE a.grantee=0 AND a.privilege_type='EXECUTE')
          FROM pg_proc WHERE oid='public.check_contratos_vigencia_overlap()'::regprocedure),
        pg_has_role('anon','authenticated','USAGE'));
  END IF;
  IF has_function_privilege('authenticated','public.check_contratos_vigencia_overlap()','EXECUTE')
     OR has_function_privilege('service_role','public.check_contratos_vigencia_overlap()','EXECUTE') THEN
    RAISE EXCEPTION 'M58_4_CONTRACT_OVERLAP_TRIGGER_API_ROLE_EXECUTE_UNEXPECTED';
  END IF;
  IF has_function_privilege('anon','public.handle_contratos_updated_at()','EXECUTE') THEN
    RAISE EXCEPTION 'M58_4_CONTRACT_UPDATED_AT_TRIGGER_ANON_EXECUTE_UNEXPECTED'
      USING DETAIL = format('effective_anon_execute=true; acl=%s; direct_anon_execute=%s; public_execute=%s; anon_inherits_authenticated=%s',
        (SELECT proacl::text FROM pg_proc WHERE oid='public.handle_contratos_updated_at()'::regprocedure),
        (SELECT EXISTS (SELECT 1 FROM aclexplode(COALESCE(proacl, acldefault('f',proowner))) a
          WHERE a.grantee=(SELECT oid FROM pg_roles WHERE rolname='anon') AND a.privilege_type='EXECUTE')
          FROM pg_proc WHERE oid='public.handle_contratos_updated_at()'::regprocedure),
        (SELECT EXISTS (SELECT 1 FROM aclexplode(COALESCE(proacl, acldefault('f',proowner))) a
          WHERE a.grantee=0 AND a.privilege_type='EXECUTE')
          FROM pg_proc WHERE oid='public.handle_contratos_updated_at()'::regprocedure),
        pg_has_role('anon','authenticated','USAGE'));
  END IF;
  IF has_function_privilege('authenticated','public.handle_contratos_updated_at()','EXECUTE')
     OR has_function_privilege('service_role','public.handle_contratos_updated_at()','EXECUTE') THEN
    RAISE EXCEPTION 'M58_4_CONTRACT_UPDATED_AT_TRIGGER_API_ROLE_EXECUTE_UNEXPECTED';
  END IF;
END
$m58$;
