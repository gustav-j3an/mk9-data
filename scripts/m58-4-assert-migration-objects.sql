DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM pg_constraint WHERE conrelid='public.visits'::regclass AND conname='visits_promotor_loja_industria_data_unique' AND contype='u' AND pg_get_constraintdef(oid) LIKE '%promotor_matricula, loja_codigo, industria_codigo, data_visita%';
  IF n <> 1 THEN RAISE EXCEPTION 'M58_4_VISITS_UNIQUE_CONSTRAINT_MISMATCH'; END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('system_settings','system_settings_audit_log','promoter_operation_authorizations','promoter_operation_authorizations_audit_log','contratos_lojas')) < 30 THEN RAISE EXCEPTION 'M58_4_EXPECTED_COLUMNS_MISSING'; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.system_settings'::regclass) OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.contratos_lojas'::regclass) THEN RAISE EXCEPTION 'M58_4_RLS_NOT_ENABLED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.check_visit_promotor_update_integrity()'::regprocedure AND prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp']) THEN RAISE EXCEPTION 'M58_4_VISIT_TRIGGER_FUNCTION_MISMATCH'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_visit_promotor_update_integrity' AND NOT tgisinternal AND tgfoid='public.check_visit_promotor_update_integrity()'::regprocedure) THEN RAISE EXCEPTION 'M58_4_VISIT_TRIGGER_MISSING'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trigger_set_industria_codigo' AND NOT tgisinternal) THEN RAISE EXCEPTION 'M58_4_INDUSTRY_TRIGGER_MISSING'; END IF;
  IF NOT has_function_privilege('authenticated', 'public.set_operation_mode(text,date,text)', 'EXECUTE') OR has_function_privilege('anon', 'public.set_operation_mode(text,date,text)', 'EXECUTE') THEN RAISE EXCEPTION 'M58_4_OPERATION_MODE_ACL_MISMATCH'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Avatars user select policy' AND cmd='SELECT' AND roles=ARRAY['authenticated'] AND qual LIKE '%bucket_id%avatars%') THEN RAISE EXCEPTION 'M58_4_AVATAR_POLICY_MISMATCH'; END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='contratos_lojas') < 4 THEN RAISE EXCEPTION 'M58_4_CONTRACT_POLICIES_MISSING'; END IF;
END $$;
