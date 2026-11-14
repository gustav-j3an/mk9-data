DO $m60$
DECLARE
  attr record;
  visit_trigger_count integer;
BEGIN
  SELECT a.atttypid::regtype AS data_type, a.attnotnull,
         pg_get_expr(d.adbin, d.adrelid) AS default_value
    INTO attr
  FROM pg_attribute a
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE a.attrelid = 'public.visits'::regclass
    AND a.attname = 'scheduled_date' AND NOT a.attisdropped;
  IF NOT FOUND OR attr.data_type <> 'date'::regtype OR attr.attnotnull THEN
    RAISE EXCEPTION 'M60_SCHEDULED_DATE_COLUMN_MISMATCH';
  END IF;

  SELECT a.atttypid::regtype AS data_type, a.attnotnull,
         pg_get_expr(d.adbin, d.adrelid) AS default_value
    INTO attr
  FROM pg_attribute a
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE a.attrelid = 'public.visits'::regclass
    AND a.attname = 'attempt_number' AND NOT a.attisdropped;
  IF NOT FOUND OR attr.data_type <> 'smallint'::regtype OR NOT attr.attnotnull
     OR attr.default_value <> '1' THEN
    RAISE EXCEPTION 'M60_ATTEMPT_NUMBER_COLUMN_MISMATCH';
  END IF;

  SELECT a.atttypid::regtype AS data_type, a.attnotnull
    INTO attr
  FROM pg_attribute a
  WHERE a.attrelid = 'public.visits'::regclass
    AND a.attname = 'occurrence_root_visit_id' AND NOT a.attisdropped;
  IF NOT FOUND OR attr.data_type <> 'uuid'::regtype OR attr.attnotnull THEN
    RAISE EXCEPTION 'M60_OCCURRENCE_ROOT_COLUMN_MISMATCH';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.visits'::regclass
      AND conname = 'visits_attempt_root_consistency_check'
      AND contype = 'c' AND convalidated
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.visits'::regclass
      AND conname = 'visits_attempt_not_self_root_check'
      AND contype = 'c' AND convalidated
  ) THEN
    RAISE EXCEPTION 'M60_VISIT_ATTEMPT_CONSTRAINTS_MISSING';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE i.indrelid = 'public.visits'::regclass
      AND c.relname = 'visits_promoter_route_scheduled_attempt_unique'
      AND i.indisunique AND i.indisvalid AND i.indisready
  ) THEN
    RAISE EXCEPTION 'M60_VISIT_ATTEMPT_UNIQUE_INDEX_MISSING';
  END IF;

  SELECT count(*) INTO visit_trigger_count
  FROM pg_trigger WHERE tgrelid = 'public.visits'::regclass AND NOT tgisinternal;
  IF visit_trigger_count <> 6 THEN
    RAISE EXCEPTION 'M60_VISIT_TRIGGER_COUNT_MISMATCH:%', visit_trigger_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.visits'::regclass
      AND tgname = 'expire_old_visits_before_promoter_checkin'
      AND (tgtype & 1) = 1 AND (tgtype & 2) = 2
      AND (tgtype & 4) = 4 AND (tgtype & 16) = 16
      AND tgfoid = 'attendance_private.expire_before_new_open_visit()'::regprocedure
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.visits'::regclass
      AND tgname = 'guard_scheduled_visit_attempt_insert'
      AND (tgtype & 1) = 1 AND (tgtype & 2) = 2
      AND (tgtype & 4) = 4 AND (tgtype & 16) = 0
      AND tgfoid = 'attendance_private.guard_scheduled_visit_attempt_insert()'::regprocedure
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.visits'::regclass
      AND tgname = 'guard_scheduled_visit_attempt_identity_update'
      AND (tgtype & 1) = 1 AND (tgtype & 2) = 2
      AND (tgtype & 4) = 0 AND (tgtype & 16) = 16
      AND tgfoid = 'attendance_private.guard_scheduled_visit_attempt_identity_update()'::regprocedure
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.visits'::regclass
      AND tgname = 'trg_visit_promotor_update_integrity'
      AND (tgtype & 1) = 1 AND (tgtype & 2) = 2
      AND (tgtype & 4) = 0 AND (tgtype & 16) = 16
      AND tgfoid = 'public.check_visit_promotor_update_integrity()'::regprocedure
  ) THEN
    RAISE EXCEPTION 'M60_VISIT_TRIGGER_BINDING_MISMATCH';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.visits'::regclass
      AND tgname = 'guard_visit_regularization_update'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.visits'::regclass
      AND tgname = 'preserve_visit_telemetry'
  ) THEN
    RAISE EXCEPTION 'M60_SHARED_VISIT_TRIGGER_MISSING';
  END IF;

  IF has_function_privilege('anon', 'public.check_contratos_vigencia_overlap()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.check_contratos_vigencia_overlap()', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.check_contratos_vigencia_overlap()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.handle_contratos_updated_at()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.handle_contratos_updated_at()', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.handle_contratos_updated_at()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.sync_contratos_from_rotas()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.sync_contratos_from_rotas()', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.sync_contratos_from_rotas()', 'EXECUTE') THEN
    RAISE EXCEPTION 'M60_CONTRACT_FUNCTION_EFFECTIVE_ACL_MISMATCH';
  END IF;

  IF has_function_privilege('anon', 'public.generate_industry_code()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.generate_industry_code()', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.generate_industry_code()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.set_industria_codigo_trigger()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.set_industria_codigo_trigger()', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.set_industria_codigo_trigger()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.get_next_industry_code()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_next_industry_code()', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.get_next_industry_code()', 'EXECUTE')
     OR has_sequence_privilege('anon', 'public.industrias_codigo_seq', 'USAGE')
     OR has_sequence_privilege('authenticated', 'public.industrias_codigo_seq', 'USAGE')
     OR has_sequence_privilege('service_role', 'public.industrias_codigo_seq', 'USAGE')
     OR has_sequence_privilege('anon', 'public.industrias_codigo_seq', 'SELECT')
     OR has_sequence_privilege('authenticated', 'public.industrias_codigo_seq', 'SELECT')
     OR has_sequence_privilege('service_role', 'public.industrias_codigo_seq', 'SELECT')
     OR has_sequence_privilege('anon', 'public.industrias_codigo_seq', 'UPDATE')
     OR has_sequence_privilege('authenticated', 'public.industrias_codigo_seq', 'UPDATE')
     OR has_sequence_privilege('service_role', 'public.industrias_codigo_seq', 'UPDATE') THEN
    RAISE EXCEPTION 'M60_INDUSTRY_FUNCTION_OR_SEQUENCE_ACL_MISMATCH';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p,
      LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
    WHERE p.oid IN (
      'public.check_contratos_vigencia_overlap()'::regprocedure,
      'public.handle_contratos_updated_at()'::regprocedure,
      'public.sync_contratos_from_rotas()'::regprocedure,
      'public.generate_industry_code()'::regprocedure,
      'public.set_industria_codigo_trigger()'::regprocedure
    ) AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
  ) OR EXISTS (
    SELECT 1 FROM pg_proc p,
      LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
    WHERE p.oid = 'public.get_next_industry_code()'::regprocedure
      AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'M60_PUBLIC_FUNCTION_GRANT_UNEXPECTED';
  END IF;
END
$m60$;

DO $m60$
DECLARE
  preview text;
  generated text;
BEGIN
  preview := public.get_next_industry_code();
  IF preview <> 'IND-9000000000000000001' THEN
    RAISE EXCEPTION 'M60_SEQUENCE_DID_NOT_BOOTSTRAP_AFTER_EXISTING_CODE:%', preview;
  END IF;

  INSERT INTO public.industrias(codigo, nome)
  VALUES (preview, 'M60 synthetic preview code');

  INSERT INTO public.industrias(codigo, nome)
  VALUES (NULL, 'M60 synthetic trigger-generated code')
  RETURNING codigo INTO generated;
  IF generated <> 'IND-9000000000000000002' THEN
    RAISE EXCEPTION 'M60_TRIGGER_GENERATED_UNEXPECTED_CODE:%', generated;
  END IF;
END
$m60$;

DO $m60$
BEGIN
  IF (SELECT count(*) <> count(DISTINCT codigo) FROM public.industrias) THEN
    RAISE EXCEPTION 'M60_INDUSTRY_CODES_NOT_UNIQUE';
  END IF;
END
$m60$;
