-- RC1.25.49 controlled reconciliation package for the partial 20261022152449 state.
-- Source migration SHA-256: 02ED53B872D22DB731E2269F5B0673A810B566A8FDB0640400A4CF7E60F4311C
-- This file is not a historical migration. Compose it only into one psql -1 transaction
-- with the pending migrations and their corresponding ledger INSERTs on a disposable local restore.
-- It never changes or deletes visit rows and refuses to run if catalog fingerprints differ.

DO $$
DECLARE
  v_count integer;
  v_hash text;
  v_args text;
  v_secdef boolean;
  v_volatility text;
  r record;
  h record;
BEGIN
  IF to_regclass('public.visit_regularization_audit') IS NULL THEN
    RAISE EXCEPTION 'RECONCILE_PRECONDITION: audit table absent; this package targets only the captured partial state';
  END IF;
  SELECT md5(string_agg(attname||':'||format_type(atttypid,atttypmod)||':'||attnotnull::text||':'||coalesce(pg_get_expr(adbin,adrelid),''),',' ORDER BY attnum))
    INTO v_hash
  FROM pg_attribute LEFT JOIN pg_attrdef ON adrelid=attrelid AND adnum=attnum
  WHERE attrelid='public.visit_regularization_audit'::regclass AND attnum>0 AND NOT attisdropped;
  IF v_hash IS DISTINCT FROM '6425adb73730a9c5a44fe00afd1ac571' THEN
    RAISE EXCEPTION 'RECONCILE_PRECONDITION: audit table columns/defaults differ';
  END IF;
  SELECT md5(string_agg(conname||':'||contype::text||':'||pg_get_constraintdef(oid),',' ORDER BY conname))
    INTO v_hash FROM pg_constraint WHERE conrelid='public.visit_regularization_audit'::regclass;
  IF v_hash IS DISTINCT FROM '39ebef1a6998fac6458716b42070f8da' THEN
    RAISE EXCEPTION 'RECONCILE_PRECONDITION: audit table constraints/FKs differ';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.visits'::regclass AND attname='regularization_status' AND atttypid='text'::regtype AND NOT attnotnull)
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.visits'::regclass AND conname='visits_regularization_status_check' AND md5(pg_get_constraintdef(oid))='ec2609d7819fa3ef6a5c0750e32ac04d') THEN
    RAISE EXCEPTION 'RECONCILE_PRECONDITION: visits.regularization_status column/check differs';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='visit_regularization_audit_promoter_time_idx' AND md5(indexdef)='b60c29fc024f756c680848b03747e173') THEN
    RAISE EXCEPTION 'RECONCILE_PRECONDITION: audit index definition differs';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='public.visit_regularization_audit'::regclass AND relrowsecurity)
     OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='public.visit_checklist_items'::regclass AND relrowsecurity)
     OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='public.visit_occurrences'::regclass AND relrowsecurity)
     OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='public.visit_product_validity'::regclass AND relrowsecurity) THEN
    RAISE EXCEPTION 'RECONCILE_PRECONDITION: RLS is not enabled on every target table';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND
      ((tgrelid='public.visit_regularization_audit'::regclass AND tgname='visit_regularization_audit_immutable') OR
       (tgrelid='public.visits'::regclass AND tgname='guard_visit_regularization_update'))) <> 2
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.visit_regularization_audit'::regclass AND tgname='visit_regularization_audit_immutable' AND md5(pg_get_triggerdef(oid))='50d07e2d33c87545327e596dc1036957')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.visits'::regclass AND tgname='guard_visit_regularization_update' AND md5(pg_get_triggerdef(oid))='c350e5ff2f3538b3063d1b49564a722e') THEN
    RAISE EXCEPTION 'RECONCILE_PRECONDITION: regularization trigger definitions differ';
  END IF;
  IF (SELECT count(*) FROM pg_policy WHERE polrelid='public.visit_regularization_audit'::regclass AND polname='visit_regularization_audit_read_scope') <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.visit_regularization_audit'::regclass AND polname='visit_regularization_audit_read_scope' AND polcmd='r' AND polpermissive AND polroles=ARRAY[(SELECT oid FROM pg_roles WHERE rolname='authenticated')]::oid[] AND md5(pg_get_expr(polqual,polrelid))='179d3eb0faf96c1351d231bf21158816') THEN
    RAISE EXCEPTION 'RECONCILE_PRECONDITION: existing audit policy differs from canonical definition';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polname IN (
    'visit_checklist_insert_current_visit','visit_checklist_update_current_visit','visit_checklist_delete_current_visit',
    'visit_occurrences_insert_current_visit','visit_occurrences_update_current_visit','visit_occurrences_delete_current_visit',
    'visit_validity_insert_current_visit','visit_validity_update_current_visit','visit_validity_delete_current_visit')) THEN
    RAISE EXCEPTION 'RECONCILE_PRECONDITION: one or more supposedly missing policies already exist';
  END IF;
  -- Authorization helpers referenced by the new RLS predicates and RPCs are
  -- pinned too; matching object names alone is not sufficient.
  FOR h IN SELECT * FROM (VALUES
    ('attendance_private','staff_can_access','matricula text','0c62babea2c61b3a06c50057a6057349',true,'s'),
    ('public','is_admin_or_gestor','','e46a9927b9aa984b968605e92e9ba72f',true,'s'),
    ('public','get_auth_promotor_matricula','','7c174e25df9e6403bd838dc40299adac',true,'s'),
    -- The pending authorization/reconciliation prefix has already replaced this helper.
    ('public','is_promotor_authorized','p_matricula text','f51a16b28f70a2c5a8d61a459113d0c4',true,'s'),
    ('auth','uid','','987669c5db67125372fe409ba45ecaed',false,'s')
  ) AS helpers(schema_name,function_name,identity_args,body_hash,security_definer,volatility)
  LOOP
    SELECT count(*), min(md5(regexp_replace(p.prosrc,'^\s+|\s+$','','g'))),
           min(pg_get_function_identity_arguments(p.oid)),
           bool_and(p.prosecdef), min(p.provolatile::text)
      INTO v_count,v_hash,v_args,v_secdef,v_volatility
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname=h.schema_name AND p.proname=h.function_name;
    IF v_count <> 1 OR v_hash IS DISTINCT FROM h.body_hash
       OR v_args IS DISTINCT FROM h.identity_args
       OR v_secdef IS DISTINCT FROM h.security_definer
       OR v_volatility IS DISTINCT FROM h.volatility THEN
      RAISE EXCEPTION 'RECONCILE_PRECONDITION: authorization helper %.% differs',h.schema_name,h.function_name;
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
    ('attendance_private','reject_visit_regularization_audit_mutation','','b265dc82af58a9b256b1d5e0c4cba80f'),
    ('attendance_private','is_visit_in_current_operational_day','p_visit_id uuid',NULL),
    ('attendance_private','is_visit_from_an_earlier_operational_day','p_visit_id uuid','ada1350aae69981978f7822c009d395b'),
    ('attendance_private','promoter_can_write_visit','p_visit_id uuid',NULL),
    -- The preceding 20261011120000 migration replaces this function before reconciliation.
    ('public','check_visit_promotor_update_integrity','','cfb1f75f5df6d8eb1c82a98da8a47698'),
    ('attendance_private','photo_upload_allowed','object_name text','9a0387016e748950a7ef1682c0c2b691'),
    ('attendance_private','guard_visit_regularization_update','','0a94adec0a1d0ef73aa79b69b9b40536'),
    ('attendance_private','regularize_old_open_visit','p_visit_id uuid, p_action text, p_reason text','67615da3fc2f0526ae06cdec14908648'),
    ('public','attendance_regularize_visit','p_visit_id uuid, p_action text, p_reason text','194db630b7a8fbe6c4820541711990cd'),
    ('public','attendance_check_in','p_store text, p_industry text, p_route uuid, p_lat numeric, p_lng numeric, p_accuracy numeric','0037583338f80a5b785960b2bef3f87d'),
    ('public','attendance_check_out','p_visit uuid, p_lat numeric, p_lng numeric, p_accuracy numeric, p_observation text','60178320b9b713dfc97012208bbc7fd3')
  ) AS expected(schema_name,function_name,identity_args,prior_hash)
  LOOP
    SELECT count(*), min(md5(regexp_replace(p.prosrc,'^\s+|\s+$','','g')))
      INTO v_count,v_hash FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname=r.schema_name AND p.proname=r.function_name;
    IF v_count=1 AND (SELECT pg_get_function_identity_arguments(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=r.schema_name AND p.proname=r.function_name LIMIT 1) IS DISTINCT FROM r.identity_args THEN
      RAISE EXCEPTION 'RECONCILE_PRECONDITION: function signature differs for %.%',r.schema_name,r.function_name;
    END IF;
    IF r.prior_hash IS NULL THEN
      IF v_count <> 0 THEN RAISE EXCEPTION 'RECONCILE_PRECONDITION: expected missing function %.%',r.schema_name,r.function_name; END IF;
    ELSIF v_count <> 1 OR v_hash IS DISTINCT FROM r.prior_hash THEN
      RAISE EXCEPTION 'RECONCILE_PRECONDITION: unexpected definition for %.%',r.schema_name,r.function_name;
    END IF;
  END LOOP;
END;
$$;

-- Reapply canonical DDL only after the exact captured baseline above was matched.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- Administrative resolution is deliberately separate from the operational
-- visit status, so no historical checkout telemetry or completed KPI is forged.
-- Existing visits column and check were fingerprinted above; no DDL is needed here.
-- Existing audit table, constraints and index were fingerprinted above; no DDL is needed here.
ALTER TABLE public.visit_regularization_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.visit_regularization_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.visit_regularization_audit TO authenticated;
DROP POLICY IF EXISTS visit_regularization_audit_read_scope ON public.visit_regularization_audit;
CREATE POLICY visit_regularization_audit_read_scope ON public.visit_regularization_audit
  FOR SELECT TO authenticated
  USING (
    attendance_private.staff_can_access(promotor_matricula)
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.status = 'ativo' AND p.role IN ('admin', 'gestor')
    )
  );

CREATE OR REPLACE FUNCTION attendance_private.reject_visit_regularization_audit_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'Visit regularization audit is immutable' USING ERRCODE = '42501';
END;
$$;
REVOKE ALL ON FUNCTION attendance_private.reject_visit_regularization_audit_mutation() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS visit_regularization_audit_immutable ON public.visit_regularization_audit;
CREATE TRIGGER visit_regularization_audit_immutable
  BEFORE UPDATE OR DELETE ON public.visit_regularization_audit
  FOR EACH ROW EXECUTE FUNCTION attendance_private.reject_visit_regularization_audit_mutation();

-- Resolve the current operational date using the captured schedule where
-- available; legacy visits retain the documented Sao Paulo fallback.
CREATE OR REPLACE FUNCTION attendance_private.is_visit_in_current_operational_day(p_visit_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.visits v
    LEFT JOIN public.promoter_work_schedules s ON s.id = v.work_schedule_id
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN s.id IS NULL THEN (now() AT TIME ZONE 'America/Sao_Paulo')::date
        ELSE (now() AT TIME ZONE s.timezone)::date
          - CASE
              WHEN s.hora_fim < s.hora_inicio
               AND (now() AT TIME ZONE s.timezone)::time < s.hora_fim THEN 1
              ELSE 0
            END
      END AS operational_date
    ) d
    WHERE v.id = p_visit_id AND v.data_visita = d.operational_date
  );
$$;
REVOKE ALL ON FUNCTION attendance_private.is_visit_in_current_operational_day(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION attendance_private.is_visit_in_current_operational_day(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION attendance_private.is_visit_from_an_earlier_operational_day(p_visit_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.visits v
    LEFT JOIN public.promoter_work_schedules s ON s.id = v.work_schedule_id
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN s.id IS NULL THEN (now() AT TIME ZONE 'America/Sao_Paulo')::date
        ELSE (now() AT TIME ZONE s.timezone)::date
          - CASE
              WHEN s.hora_fim < s.hora_inicio
               AND (now() AT TIME ZONE s.timezone)::time < s.hora_fim THEN 1
              ELSE 0
            END
      END AS operational_date
    ) d
    WHERE v.id = p_visit_id AND v.data_visita < d.operational_date
  );
$$;
REVOKE ALL ON FUNCTION attendance_private.is_visit_from_an_earlier_operational_day(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION attendance_private.is_visit_from_an_earlier_operational_day(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION attendance_private.promoter_can_write_visit(p_visit_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.visits v
    JOIN public.profiles p ON p.id = auth.uid()
    WHERE v.id = p_visit_id
      AND p.role = 'promotor' AND p.status = 'ativo'
      AND p.promotor_matricula = v.promotor_matricula
      AND v.status = 'em_andamento'
      AND v.regularization_status IS NULL
      AND attendance_private.is_visit_in_current_operational_day(v.id)
  );
$$;
REVOKE ALL ON FUNCTION attendance_private.promoter_can_write_visit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION attendance_private.promoter_can_write_visit(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.check_visit_promotor_update_integrity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL AND session_user IN ('postgres','supabase_admin') THEN RETURN NEW; END IF;
  IF public.is_admin_or_gestor() THEN RETURN NEW; END IF;
  IF OLD.promotor_matricula IS DISTINCT FROM public.get_auth_promotor_matricula()
     OR public.get_auth_promotor_matricula() IS NULL THEN
    RAISE EXCEPTION 'Visit not owned by authenticated promoter' USING ERRCODE='42501';
  END IF;
  IF OLD.started_at IS NOT NULL AND NOT attendance_private.is_visit_in_current_operational_day(OLD.id) THEN
    RAISE EXCEPTION 'An old visit requires administrative regularization' USING ERRCODE='42501';
  END IF;
  IF (NEW.promotor_matricula,NEW.loja_codigo,NEW.industria_codigo,NEW.rota_id,NEW.data_visita)
     IS DISTINCT FROM (OLD.promotor_matricula,OLD.loja_codigo,OLD.industria_codigo,OLD.rota_id,OLD.data_visita) THEN
    RAISE EXCEPTION 'Visit identity is immutable' USING ERRCODE='42501';
  END IF;
  IF OLD.started_at IS NOT NULL AND NEW.started_at IS DISTINCT FROM OLD.started_at THEN
    RAISE EXCEPTION 'Check-in is immutable' USING ERRCODE='42501';
  END IF;
  IF OLD.status IN ('concluida','nao_realizada') THEN
    RAISE EXCEPTION 'Closed visits cannot be changed by promoter' USING ERRCODE='42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT ((OLD.status='pendente' AND NEW.status='em_andamento' AND OLD.started_at IS NULL)
       OR (OLD.status='em_andamento' AND NEW.status='concluida')) THEN
    RAISE EXCEPTION 'Invalid visit transition';
  END IF;
  IF NEW.status='concluida'
     AND (NEW.completed_at IS NULL OR NEW.started_at IS NULL OR NEW.completed_at<NEW.started_at) THEN
    RAISE EXCEPTION 'Invalid checkout sequence';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.check_visit_promotor_update_integrity() FROM PUBLIC, anon;

-- An old or administratively resolved visit is immutable to promoter evidence
-- writes, even if a permissive legacy policy remains installed.
DROP POLICY IF EXISTS visit_checklist_insert_current_visit ON public.visit_checklist_items;
CREATE POLICY visit_checklist_insert_current_visit ON public.visit_checklist_items AS RESTRICTIVE
  FOR INSERT TO authenticated WITH CHECK (
    attendance_private.staff_can_access((SELECT v.promotor_matricula FROM public.visits v WHERE v.id = visit_id))
    OR attendance_private.promoter_can_write_visit(visit_id)
  );
DROP POLICY IF EXISTS visit_checklist_update_current_visit ON public.visit_checklist_items;
CREATE POLICY visit_checklist_update_current_visit ON public.visit_checklist_items AS RESTRICTIVE
  FOR UPDATE TO authenticated
  USING (attendance_private.staff_can_access((SELECT v.promotor_matricula FROM public.visits v WHERE v.id = visit_id)) OR attendance_private.promoter_can_write_visit(visit_id))
  WITH CHECK (attendance_private.staff_can_access((SELECT v.promotor_matricula FROM public.visits v WHERE v.id = visit_id)) OR attendance_private.promoter_can_write_visit(visit_id));
DROP POLICY IF EXISTS visit_checklist_delete_current_visit ON public.visit_checklist_items;
CREATE POLICY visit_checklist_delete_current_visit ON public.visit_checklist_items AS RESTRICTIVE
  FOR DELETE TO authenticated USING (
    attendance_private.staff_can_access((SELECT v.promotor_matricula FROM public.visits v WHERE v.id = visit_id))
    OR attendance_private.promoter_can_write_visit(visit_id)
  );

DROP POLICY IF EXISTS visit_occurrences_insert_current_visit ON public.visit_occurrences;
CREATE POLICY visit_occurrences_insert_current_visit ON public.visit_occurrences AS RESTRICTIVE
  FOR INSERT TO authenticated WITH CHECK (
    attendance_private.staff_can_access((SELECT v.promotor_matricula FROM public.visits v WHERE v.id = visit_id))
    OR attendance_private.promoter_can_write_visit(visit_id)
  );
DROP POLICY IF EXISTS visit_occurrences_update_current_visit ON public.visit_occurrences;
CREATE POLICY visit_occurrences_update_current_visit ON public.visit_occurrences AS RESTRICTIVE
  FOR UPDATE TO authenticated
  USING (attendance_private.staff_can_access((SELECT v.promotor_matricula FROM public.visits v WHERE v.id = visit_id)) OR attendance_private.promoter_can_write_visit(visit_id))
  WITH CHECK (attendance_private.staff_can_access((SELECT v.promotor_matricula FROM public.visits v WHERE v.id = visit_id)) OR attendance_private.promoter_can_write_visit(visit_id));
DROP POLICY IF EXISTS visit_occurrences_delete_current_visit ON public.visit_occurrences;
CREATE POLICY visit_occurrences_delete_current_visit ON public.visit_occurrences AS RESTRICTIVE
  FOR DELETE TO authenticated USING (
    attendance_private.staff_can_access((SELECT v.promotor_matricula FROM public.visits v WHERE v.id = visit_id))
    OR attendance_private.promoter_can_write_visit(visit_id)
  );

DROP POLICY IF EXISTS visit_validity_insert_current_visit ON public.visit_product_validity;
CREATE POLICY visit_validity_insert_current_visit ON public.visit_product_validity AS RESTRICTIVE
  FOR INSERT TO authenticated WITH CHECK (
    attendance_private.staff_can_access((SELECT v.promotor_matricula FROM public.visits v WHERE v.id = visit_id))
    OR attendance_private.promoter_can_write_visit(visit_id)
  );
DROP POLICY IF EXISTS visit_validity_update_current_visit ON public.visit_product_validity;
CREATE POLICY visit_validity_update_current_visit ON public.visit_product_validity AS RESTRICTIVE
  FOR UPDATE TO authenticated
  USING (attendance_private.staff_can_access((SELECT v.promotor_matricula FROM public.visits v WHERE v.id = visit_id)) OR attendance_private.promoter_can_write_visit(visit_id))
  WITH CHECK (attendance_private.staff_can_access((SELECT v.promotor_matricula FROM public.visits v WHERE v.id = visit_id)) OR attendance_private.promoter_can_write_visit(visit_id));
DROP POLICY IF EXISTS visit_validity_delete_current_visit ON public.visit_product_validity;
CREATE POLICY visit_validity_delete_current_visit ON public.visit_product_validity AS RESTRICTIVE
  FOR DELETE TO authenticated USING (
    attendance_private.staff_can_access((SELECT v.promotor_matricula FROM public.visits v WHERE v.id = visit_id))
    OR attendance_private.promoter_can_write_visit(visit_id)
  );

-- Storage uploads are also writes to visit evidence; retain scoped staff access.
CREATE OR REPLACE FUNCTION attendance_private.photo_upload_allowed(object_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.visits v JOIN public.profiles p ON p.id = auth.uid()
    WHERE p.status = 'ativo'
      AND object_name ~ '^visits/[0-9a-fA-F-]{36}/[^/]+$'
      AND split_part(object_name, '/', 2) = v.id::text
      AND (
        (p.role = 'promotor' AND p.promotor_matricula = v.promotor_matricula
          AND v.status = 'em_andamento' AND v.regularization_status IS NULL
          AND attendance_private.is_visit_in_current_operational_day(v.id))
        OR (p.role IN ('admin', 'gestor') AND attendance_private.staff_can_access(v.promotor_matricula))
      )
  );
$$;
REVOKE ALL ON FUNCTION attendance_private.photo_upload_allowed(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION attendance_private.photo_upload_allowed(text) TO authenticated;

CREATE OR REPLACE FUNCTION attendance_private.guard_visit_regularization_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.regularization_status IS DISTINCT FROM OLD.regularization_status THEN
    IF OLD.regularization_status IS NOT NULL OR NEW.regularization_status NOT IN (
      'closed_without_execution_proof', 'administratively_completed_with_proof'
    ) OR (NEW.status, NEW.started_at, NEW.completed_at, NEW.latitude, NEW.longitude,
          NEW.checkout_latitude, NEW.checkout_longitude, NEW.promotor_matricula,
          NEW.loja_codigo, NEW.industria_codigo, NEW.data_visita)
       IS DISTINCT FROM
       (OLD.status, OLD.started_at, OLD.completed_at, OLD.latitude, OLD.longitude,
          OLD.checkout_latitude, OLD.checkout_longitude, OLD.promotor_matricula,
          OLD.loja_codigo, OLD.industria_codigo, OLD.data_visita)
       OR NOT EXISTS (
         SELECT 1 FROM public.visit_regularization_audit a
         WHERE a.visit_id = NEW.id
           AND a.acted_by = auth.uid()
           AND a.new_regularization_status = NEW.regularization_status
           AND a.visit_status_before = OLD.status
           AND a.visit_status_after = NEW.status
       ) THEN
      RAISE EXCEPTION 'Administrative regularization requires an authorised audit event'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION attendance_private.guard_visit_regularization_update() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS guard_visit_regularization_update ON public.visits;
CREATE TRIGGER guard_visit_regularization_update
  BEFORE UPDATE OF regularization_status ON public.visits
  FOR EACH ROW EXECUTE FUNCTION attendance_private.guard_visit_regularization_update();

CREATE OR REPLACE FUNCTION attendance_private.regularize_old_open_visit(p_visit_id uuid, p_action text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v public.visits;
  actor_role text;
  new_resolution text;
  refs jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authenticated staff required' USING ERRCODE = '42501'; END IF;
  SELECT p.role INTO actor_role FROM public.profiles p
    WHERE p.id = auth.uid() AND p.status = 'ativo';
  IF actor_role IS NULL OR NOT (
    actor_role = 'admin' OR (
      actor_role = 'gestor'
      AND EXISTS (SELECT 1 FROM public.supervisores s WHERE s.user_id = auth.uid() AND s.status = 'ativo')
    )
  ) THEN RAISE EXCEPTION 'Authorised administrator or supervisor required' USING ERRCODE = '42501'; END IF;
  IF p_action NOT IN ('closed_without_execution_proof', 'administratively_completed_with_proof') THEN
    RAISE EXCEPTION 'Invalid regularization action';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 10 OR length(p_reason) > 1000
     OR lower(regexp_replace(trim(p_reason), '\s+', ' ', 'g')) IN ('ok', 'okay', 'teste', 'test', 'na', 'n/a', 'sem motivo', 'motivo', 'regularizacao')
     OR trim(p_reason) ~* '^(.)\1+$' THEN
    RAISE EXCEPTION 'A descriptive reason of at least 10 characters is required';
  END IF;

  SELECT v0.* INTO v FROM public.visits v0 WHERE v0.id = p_visit_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Visit not found' USING ERRCODE = 'P0002'; END IF;
  IF v.status <> 'em_andamento' OR v.started_at IS NULL
     OR NOT attendance_private.is_visit_from_an_earlier_operational_day(v.id) THEN
    RAISE EXCEPTION 'Only an old open visit can be regularized';
  END IF;
  IF NOT attendance_private.staff_can_access(v.promotor_matricula) THEN
    RAISE EXCEPTION 'Visit outside authorised supervisor scope' USING ERRCODE = '42501';
  END IF;
  IF v.regularization_status IS NOT NULL THEN RAISE EXCEPTION 'Visit already regularized'; END IF;

  -- Proof criterion: at least one existing photo and one substantive checklist
  -- response. No evidence or operational timestamps are created or edited.
  IF p_action = 'administratively_completed_with_proof' AND (
    NOT EXISTS (SELECT 1 FROM public.visit_photos ph WHERE ph.visit_id = v.id)
    OR NOT EXISTS (
      SELECT 1 FROM public.visit_checklist_items ci WHERE ci.visit_id = v.id
        AND (ci.checked IS TRUE OR NULLIF(trim(ci.valor_texto), '') IS NOT NULL)
    )
  ) THEN RAISE EXCEPTION 'Insufficient existing evidence for administrative completion'; END IF;

  SELECT COALESCE(jsonb_agg(evidence_ref), '[]'::jsonb) INTO refs FROM (
    SELECT jsonb_build_object('type', 'photo', 'id', ph.id) AS evidence_ref FROM public.visit_photos ph WHERE ph.visit_id = v.id
    UNION ALL
    SELECT jsonb_build_object('type', 'checklist', 'id', ci.id) FROM public.visit_checklist_items ci WHERE ci.visit_id = v.id
    UNION ALL
    SELECT jsonb_build_object('type', 'occurrence', 'id', o.id) FROM public.visit_occurrences o WHERE o.visit_id = v.id
    UNION ALL
    SELECT jsonb_build_object('type', 'validity', 'id', pv.id) FROM public.visit_product_validity pv WHERE pv.visit_id = v.id
  ) evidence;
  new_resolution := p_action;

  INSERT INTO public.visit_regularization_audit (
    visit_id, promotor_matricula, action, previous_regularization_status,
    new_regularization_status, visit_status_before, visit_status_after,
    acted_by, reason, evidence_refs
  ) VALUES (
    v.id, v.promotor_matricula, p_action, v.regularization_status,
    new_resolution, v.status, v.status, auth.uid(), trim(p_reason), refs
  );

  UPDATE public.visits SET regularization_status = new_resolution WHERE id = v.id;
  RETURN jsonb_build_object(
    'visit_id', v.id,
    'regularization_status', new_resolution,
    'visit_status', v.status,
    'acted_at', now(),
    'evidence_refs', refs
  );
END;
$$;
REVOKE ALL ON FUNCTION attendance_private.regularize_old_open_visit(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION attendance_private.regularize_old_open_visit(uuid, text, text) TO authenticated;

-- Public invoker wrapper is the PostgREST endpoint; privileged mutation stays
-- in the private schema and independently validates the JWT role and scope.
CREATE OR REPLACE FUNCTION public.attendance_regularize_visit(p_visit_id uuid, p_action text, p_reason text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT attendance_private.regularize_old_open_visit(p_visit_id, p_action, p_reason);
$$;
REVOKE ALL ON FUNCTION public.attendance_regularize_visit(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attendance_regularize_visit(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.attendance_check_in(p_store text,p_industry text,p_route uuid DEFAULT NULL,p_lat numeric DEFAULT NULL,p_lng numeric DEFAULT NULL,p_accuracy numeric DEFAULT NULL)
RETURNS public.visits LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE matricula text; result public.visits; schedule public.promoter_work_schedules; operational_date date;
BEGIN
 SELECT p.promotor_matricula INTO matricula FROM public.profiles p WHERE p.id=auth.uid() AND p.role='promotor' AND p.status='ativo';
 IF matricula IS NULL THEN RAISE EXCEPTION 'Promoter identity required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.rotas WHERE promotor_matricula=matricula AND loja_codigo=p_store AND industria_codigo=p_industry) THEN RAISE EXCEPTION 'Store outside promoter assignment' USING ERRCODE='42501'; END IF;
 IF (SELECT value #>> '{}' FROM public.system_settings WHERE key='operation_mode')='IMPLANTACAO' AND NOT public.is_promotor_authorized(matricula) THEN RAISE EXCEPTION 'Promoter not released for operation' USING ERRCODE='42501'; END IF;
 IF (p_lat IS NULL) <> (p_lng IS NULL) OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 OR p_accuracy<0 OR p_accuracy='NaN'::numeric THEN RAISE EXCEPTION 'Invalid GPS'; END IF;
 operational_date:=(clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date;
 SELECT s.* INTO schedule FROM public.promoter_work_schedules s
 CROSS JOIN LATERAL(SELECT (clock_timestamp() AT TIME ZONE s.timezone)::date - CASE WHEN s.hora_fim<s.hora_inicio AND (clock_timestamp() AT TIME ZONE s.timezone)::time<s.hora_fim THEN 1 ELSE 0 END AS d) local_day
 WHERE s.promotor_matricula=matricula AND s.ativo
 AND (s.valid_from IS NULL OR s.valid_from<=local_day.d) AND (s.valid_to IS NULL OR s.valid_to>=local_day.d)
 AND s.dia_semana=(ARRAY['domingo','segunda','terca','quarta','quinta','sexta','sabado'])[extract(dow from local_day.d)::int+1]
 ORDER BY s.is_exception DESC,s.valid_from DESC NULLS LAST LIMIT 1;
 IF schedule.id IS NOT NULL THEN operational_date:=(clock_timestamp() AT TIME ZONE schedule.timezone)::date - CASE WHEN schedule.hora_fim<schedule.hora_inicio AND (clock_timestamp() AT TIME ZONE schedule.timezone)::time<schedule.hora_fim THEN 1 ELSE 0 END; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(matricula,1));
 SELECT * INTO result FROM public.visits WHERE promotor_matricula=matricula AND loja_codigo=p_store AND industria_codigo=p_industry AND data_visita=operational_date FOR UPDATE;
 IF FOUND AND result.started_at IS NOT NULL THEN
   IF result.status='em_andamento' AND result.regularization_status IS NULL THEN RETURN result; END IF;
   RAISE EXCEPTION 'This scheduled visit occurrence is already closed';
 END IF;
 IF EXISTS(SELECT 1 FROM public.visits WHERE promotor_matricula=matricula AND status='em_andamento' AND regularization_status IS NULL AND data_visita=operational_date AND id IS DISTINCT FROM result.id) THEN RAISE EXCEPTION 'Another visit is in progress'; END IF;
 IF p_route IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.rotas WHERE id=p_route AND promotor_matricula=matricula AND loja_codigo=p_store AND industria_codigo=p_industry) THEN RAISE EXCEPTION 'Invalid route'; END IF;
 INSERT INTO public.visits(promotor_matricula,loja_codigo,industria_codigo,data_visita,rota_id,started_at,latitude,longitude,gps_accuracy_meters,status,work_schedule_id)
 VALUES(matricula,p_store,p_industry,operational_date,p_route,clock_timestamp(),p_lat,p_lng,p_accuracy,'em_andamento',schedule.id)
 ON CONFLICT(promotor_matricula,loja_codigo,industria_codigo,data_visita) DO UPDATE
 SET started_at=EXCLUDED.started_at,latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,gps_accuracy_meters=EXCLUDED.gps_accuracy_meters,status=EXCLUDED.status,work_schedule_id=EXCLUDED.work_schedule_id
 RETURNING * INTO result;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.attendance_check_out(p_visit uuid,p_lat numeric DEFAULT NULL,p_lng numeric DEFAULT NULL,p_accuracy numeric DEFAULT NULL,p_observation text DEFAULT NULL)
RETURNS public.visits LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result public.visits; captured_schedule public.promoter_work_schedules; operational_date date;
BEGIN
 SELECT v.* INTO result FROM public.visits v JOIN public.profiles p ON p.id=auth.uid() WHERE v.id=p_visit AND p.role='promotor' AND p.status='ativo' AND p.promotor_matricula=v.promotor_matricula FOR UPDATE OF v;
 IF NOT FOUND THEN RAISE EXCEPTION 'Visit not authorised' USING ERRCODE='42501'; END IF;
 IF result.completed_at IS NOT NULL THEN RETURN result; END IF;
 IF result.started_at IS NULL OR result.status<>'em_andamento' OR result.regularization_status IS NOT NULL THEN RAISE EXCEPTION 'Visit has no active check-in'; END IF;
 SELECT * INTO captured_schedule FROM public.promoter_work_schedules WHERE id=result.work_schedule_id;
 IF captured_schedule.id IS NULL THEN operational_date:=(clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date;
 ELSE operational_date:=(clock_timestamp() AT TIME ZONE captured_schedule.timezone)::date - CASE WHEN captured_schedule.hora_fim<captured_schedule.hora_inicio AND (clock_timestamp() AT TIME ZONE captured_schedule.timezone)::time<captured_schedule.hora_fim THEN 1 ELSE 0 END; END IF;
 IF result.data_visita<>operational_date THEN RAISE EXCEPTION 'An old visit requires administrative regularization' USING ERRCODE='42501'; END IF;
 IF (p_lat IS NULL) <> (p_lng IS NULL) OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 OR p_accuracy<0 OR p_accuracy='NaN'::numeric THEN RAISE EXCEPTION 'Invalid GPS'; END IF;
 UPDATE public.visits SET completed_at=clock_timestamp(),status='concluida',checkout_latitude=p_lat,checkout_longitude=p_lng,checkout_accuracy_meters=p_accuracy,observacao_geral=p_observation,updated_at=clock_timestamp() WHERE id=p_visit RETURNING * INTO result;
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.attendance_check_in(text,text,uuid,numeric,numeric,numeric), public.attendance_check_out(uuid,numeric,numeric,numeric,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attendance_check_in(text,text,uuid,numeric,numeric,numeric), public.attendance_check_out(uuid,numeric,numeric,numeric,text) TO authenticated;
NOTIFY pgrst, 'reload schema';

DO $$
DECLARE bad_count integer;
BEGIN
  SELECT count(*) INTO bad_count FROM (VALUES
    ('attendance_private','reject_visit_regularization_audit_mutation','','b265dc82af58a9b256b1d5e0c4cba80f'),
    ('attendance_private','is_visit_in_current_operational_day','p_visit_id uuid','9357f83ec3a07fe6ce1a9278eb1a2108'),
    ('attendance_private','is_visit_from_an_earlier_operational_day','p_visit_id uuid','ada1350aae69981978f7822c009d395b'),
    ('attendance_private','promoter_can_write_visit','p_visit_id uuid','c80ec867f7209fe2c765e8b9d5a80517'),
    ('public','check_visit_promotor_update_integrity','','e6fcf0da6ef5aa00a1fa4dcd52139983'),
    ('attendance_private','photo_upload_allowed','object_name text','deb763b7c6ddfdf37d0c091ad88ca773'),
    ('attendance_private','guard_visit_regularization_update','','0a94adec0a1d0ef73aa79b69b9b40536'),
    ('attendance_private','regularize_old_open_visit','p_visit_id uuid, p_action text, p_reason text','0ac6337ccbb51d9533e9e750eb4d1211'),
    ('public','attendance_regularize_visit','p_visit_id uuid, p_action text, p_reason text','194db630b7a8fbe6c4820541711990cd'),
    ('public','attendance_check_in','p_store text, p_industry text, p_route uuid, p_lat numeric, p_lng numeric, p_accuracy numeric','626c89c4b063550c21a48c712d777cd3'),
    ('public','attendance_check_out','p_visit uuid, p_lat numeric, p_lng numeric, p_accuracy numeric, p_observation text','b4c1d6729111119622d6fda48a2fa1e9')
  ) expected(schema_name,function_name,identity_args,body_hash)
  WHERE (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname=expected.schema_name AND p.proname=expected.function_name) <> 1
    OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname=expected.schema_name AND p.proname=expected.function_name
        AND pg_get_function_identity_arguments(p.oid)=expected.identity_args
        AND md5(regexp_replace(p.prosrc,'^\s+|\s+$','','g'))=expected.body_hash);
  IF bad_count <> 0 THEN RAISE EXCEPTION 'RECONCILE_POSTCONDITION: canonical function fingerprints mismatch'; END IF;
  SELECT count(*) INTO bad_count FROM (VALUES
    ('visit_regularization_audit_read_scope','visit_regularization_audit','r',true,'179d3eb0faf96c1351d231bf21158816',NULL),
    ('visit_checklist_insert_current_visit','visit_checklist_items','a',false,NULL,'ce26ef960f5d045febf53e8369ae2e37'),
    ('visit_checklist_update_current_visit','visit_checklist_items','w',false,'ce26ef960f5d045febf53e8369ae2e37','ce26ef960f5d045febf53e8369ae2e37'),
    ('visit_checklist_delete_current_visit','visit_checklist_items','d',false,'ce26ef960f5d045febf53e8369ae2e37',NULL),
    ('visit_occurrences_insert_current_visit','visit_occurrences','a',false,NULL,'0dad74fb07fa1f677d4f19d2a9e9247a'),
    ('visit_occurrences_update_current_visit','visit_occurrences','w',false,'0dad74fb07fa1f677d4f19d2a9e9247a','0dad74fb07fa1f677d4f19d2a9e9247a'),
    ('visit_occurrences_delete_current_visit','visit_occurrences','d',false,'0dad74fb07fa1f677d4f19d2a9e9247a',NULL),
    ('visit_validity_insert_current_visit','visit_product_validity','a',false,NULL,'d8d8999ed373b999da131795136bdd70'),
    ('visit_validity_update_current_visit','visit_product_validity','w',false,'d8d8999ed373b999da131795136bdd70','d8d8999ed373b999da131795136bdd70'),
    ('visit_validity_delete_current_visit','visit_product_validity','d',false,'d8d8999ed373b999da131795136bdd70',NULL)
  ) expected(policy_name,table_name,command,permissive,qual_hash,check_hash)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
    WHERE p.polname=expected.policy_name AND c.relnamespace='public'::regnamespace
      AND c.relname=expected.table_name AND p.polcmd=expected.command
      AND p.polpermissive=expected.permissive
      AND p.polroles=ARRAY[(SELECT oid FROM pg_roles WHERE rolname='authenticated')]::oid[]
      AND coalesce(md5(pg_get_expr(p.polqual,p.polrelid)),'-')=coalesce(expected.qual_hash,'-')
      AND coalesce(md5(pg_get_expr(p.polwithcheck,p.polrelid)),'-')=coalesce(expected.check_hash,'-')
  );
  IF bad_count <> 0 THEN
    RAISE EXCEPTION 'RECONCILE_POSTCONDITION: one or more policy definitions/roles differ';
  END IF;
  IF NOT has_table_privilege('authenticated','public.visit_regularization_audit','SELECT')
     OR has_table_privilege('anon','public.visit_regularization_audit','SELECT') THEN
    RAISE EXCEPTION 'RECONCILE_POSTCONDITION: audit table grants are not least-privilege';
  END IF;
END;
$$;
