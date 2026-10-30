-- MK9 DATE — REGULARIZACAO ADMINISTRATIVA MINIMA (PRODUCAO)
-- Escopo estrito: adiciona exclusivamente os objetos de regularizacao de visitas antigas
-- NAO altera attendance_check_in, attendance_check_out, triggers de integridade ou policies operacionais.

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- 1. Coluna de decisao administrativa em visits
ALTER TABLE public.visits
  ADD COLUMN IF NOT EXISTS regularization_status text
  CHECK (regularization_status IN ('closed_without_execution_proof', 'administratively_completed_with_proof'));

-- 2. Tabela de auditoria append-only
CREATE TABLE IF NOT EXISTS public.visit_regularization_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL UNIQUE REFERENCES public.visits(id) ON DELETE RESTRICT,
  promotor_matricula text NOT NULL REFERENCES public.promotores(matricula) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('closed_without_execution_proof', 'administratively_completed_with_proof')),
  previous_regularization_status text,
  new_regularization_status text NOT NULL CHECK (new_regularization_status IN ('closed_without_execution_proof', 'administratively_completed_with_proof')),
  visit_status_before text NOT NULL,
  visit_status_after text NOT NULL,
  acted_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  acted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reason text NOT NULL CHECK (
    length(trim(reason)) >= 10
    AND lower(regexp_replace(trim(reason), '\s+', ' ', 'g')) NOT IN ('ok', 'okay', 'teste', 'test', 'na', 'n/a', 'sem motivo', 'motivo', 'regularizacao')
    AND trim(reason) !~* '^(.)\1+$'
  ),
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence_refs) = 'array'),
  CONSTRAINT visit_regularization_action_state CHECK (action = new_regularization_status)
);

CREATE INDEX IF NOT EXISTS visit_regularization_audit_promoter_time_idx
  ON public.visit_regularization_audit(promotor_matricula, acted_at DESC);

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

-- 3. Trigger de imutabilidade da tabela de auditoria
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

-- 4. Helper para verificar se a visita pertence a dia operacional anterior
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

-- 5. Trigger de guarda da coluna regularization_status em visits
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

-- 6. Funcao privada de regularizacao (execucao transacional segura)
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

-- 7. Wrapper publico RPC (SECURITY INVOKER)
CREATE OR REPLACE FUNCTION public.attendance_regularize_visit(p_visit_id uuid, p_action text, p_reason text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT attendance_private.regularize_old_open_visit(p_visit_id, p_action, p_reason);
$$;
REVOKE ALL ON FUNCTION public.attendance_regularize_visit(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attendance_regularize_visit(uuid, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
