BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- Cron is a required platform prerequisite. Keep this check before all DDL so
-- applying the migration cannot leave a half-installed lifecycle workflow.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'pg_cron') THEN
    RAISE EXCEPTION 'Enable the Supabase Cron module (pg_cron) before applying M38';
  END IF;
END;
$$;

CREATE TABLE public.visit_lifecycle_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL UNIQUE REFERENCES public.visits(id) ON DELETE RESTRICT,
  promotor_matricula text NOT NULL REFERENCES public.promotores(matricula) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('promoter_cancelled', 'auto_closed_at_day_end')),
  visit_status_before text NOT NULL CHECK (visit_status_before = 'em_andamento'),
  visit_status_after text NOT NULL CHECK (visit_status_after = 'nao_realizada'),
  actor_type text NOT NULL CHECK (actor_type IN ('promoter', 'system')),
  actor_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  acted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 10 AND 1000),
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence_refs) = 'array'),
  CHECK ((actor_type = 'promoter' AND actor_id IS NOT NULL AND action = 'promoter_cancelled')
      OR (actor_type = 'system' AND actor_id IS NULL AND action = 'auto_closed_at_day_end'))
);

CREATE INDEX visit_lifecycle_audit_promoter_time_idx
  ON public.visit_lifecycle_audit(promotor_matricula, acted_at DESC);
CREATE INDEX visits_open_started_at_expiry_idx
  ON public.visits(started_at, promotor_matricula)
  WHERE status = 'em_andamento' AND completed_at IS NULL AND regularization_status IS NULL;

ALTER TABLE public.visit_lifecycle_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.visit_lifecycle_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.visit_lifecycle_audit TO authenticated;
CREATE POLICY visit_lifecycle_audit_read_scope ON public.visit_lifecycle_audit
  FOR SELECT TO authenticated
  USING (
    attendance_private.active_user()
    AND (promotor_matricula = public.get_auth_promotor_matricula()
      OR attendance_private.staff_can_access(promotor_matricula))
  );

CREATE TABLE attendance_private.visit_lifecycle_authorizations (
  visit_id uuid PRIMARY KEY REFERENCES public.visits(id) ON DELETE CASCADE,
  promotor_matricula text NOT NULL,
  action text NOT NULL CHECK (action IN ('promoter_cancelled', 'auto_closed_at_day_end')),
  actor_type text NOT NULL CHECK (actor_type IN ('promoter', 'system')),
  actor_id uuid,
  reason text NOT NULL,
  authorized_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((actor_type = 'promoter' AND actor_id IS NOT NULL AND action = 'promoter_cancelled')
      OR (actor_type = 'system' AND actor_id IS NULL AND action = 'auto_closed_at_day_end'))
);
ALTER TABLE attendance_private.visit_lifecycle_authorizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON attendance_private.visit_lifecycle_authorizations FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION attendance_private.reject_visit_lifecycle_audit_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'Visit lifecycle audit is immutable' USING ERRCODE = '42501';
END;
$$;
REVOKE ALL ON FUNCTION attendance_private.reject_visit_lifecycle_audit_mutation() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER visit_lifecycle_audit_immutable
  BEFORE UPDATE OR DELETE ON public.visit_lifecycle_audit
  FOR EACH ROW EXECUTE FUNCTION attendance_private.reject_visit_lifecycle_audit_mutation();

-- This worker is called by pg_cron and by the check-in path. Its criterion is
-- the Sao Paulo calendar day of the original start instant, not elapsed hours
-- and not the current promoter work schedule.
CREATE OR REPLACE FUNCTION attendance_private.expire_old_open_visits_for_promoter(p_promotor_matricula text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_visit_id uuid;
  v_visit public.visits;
  v_reason constant text := 'Não finalizada até o encerramento do dia operacional';
  v_cutoff timestamptz := (((clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date)::timestamp AT TIME ZONE 'America/Sao_Paulo');
  v_evidence_refs jsonb;
  v_audit_id uuid;
  v_closed integer := 0;
BEGIN
  IF p_promotor_matricula IS NULL THEN RETURN 0; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_promotor_matricula, 1));

  FOR v_visit_id IN
    SELECT v.id
    FROM public.visits v
    WHERE v.promotor_matricula = p_promotor_matricula
      AND v.status = 'em_andamento'
      AND v.started_at IS NOT NULL
      AND v.completed_at IS NULL
      AND v.regularization_status IS NULL
      AND v.started_at < v_cutoff
    ORDER BY v.started_at, v.id
  LOOP
    SELECT v.* INTO v_visit
    FROM public.visits v
    WHERE v.id = v_visit_id
      AND v.promotor_matricula = p_promotor_matricula
      AND v.status = 'em_andamento'
      AND v.started_at IS NOT NULL
      AND v.completed_at IS NULL
      AND v.regularization_status IS NULL
      AND v.started_at < v_cutoff
    FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;

    SELECT coalesce(jsonb_agg(evidence_ref), '[]'::jsonb) INTO v_evidence_refs
    FROM (
      SELECT jsonb_build_object('type', 'photo', 'id', ph.id) AS evidence_ref FROM public.visit_photos ph WHERE ph.visit_id = v_visit.id
      UNION ALL SELECT jsonb_build_object('type', 'checklist', 'id', ci.id) FROM public.visit_checklist_items ci WHERE ci.visit_id = v_visit.id
      UNION ALL SELECT jsonb_build_object('type', 'occurrence', 'id', vo.id) FROM public.visit_occurrences vo WHERE vo.visit_id = v_visit.id
      UNION ALL SELECT jsonb_build_object('type', 'validity', 'id', pv.id) FROM public.visit_product_validity pv WHERE pv.visit_id = v_visit.id
    ) evidence;

    INSERT INTO public.visit_lifecycle_audit (
      visit_id, promotor_matricula, action, visit_status_before, visit_status_after,
      actor_type, actor_id, reason, evidence_refs
    ) VALUES (
      v_visit.id, v_visit.promotor_matricula, 'auto_closed_at_day_end',
      v_visit.status, 'nao_realizada', 'system', NULL, v_reason, v_evidence_refs
    ) ON CONFLICT (visit_id) DO NOTHING
    RETURNING id INTO v_audit_id;
    IF v_audit_id IS NULL THEN
      RAISE EXCEPTION 'Open visit already has a lifecycle audit; refusing an unaudited close' USING ERRCODE = '23505';
    END IF;

    INSERT INTO attendance_private.visit_lifecycle_authorizations (
      visit_id, promotor_matricula, action, actor_type, actor_id, reason
    ) VALUES (v_visit.id, v_visit.promotor_matricula, 'auto_closed_at_day_end', 'system', NULL, v_reason);

    UPDATE public.visits
    SET status = 'nao_realizada',
        motivo_nao_realizada = v_reason,
        updated_at = clock_timestamp()
    WHERE id = v_visit.id AND status = 'em_andamento' AND completed_at IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Visit changed while its day-end closure was being recorded' USING ERRCODE = '40001';
    END IF;

    INSERT INTO public.visit_occurrences(visit_id, tipo, descricao)
    VALUES (v_visit.id, 'outro', 'Encerramento automático: ' || v_reason);
    v_closed := v_closed + 1;
  END LOOP;
  RETURN v_closed;
END;
$$;
REVOKE ALL ON FUNCTION attendance_private.expire_old_open_visits_for_promoter(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION attendance_private.expire_old_open_visits()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_promotor text;
  v_closed integer := 0;
  v_cutoff timestamptz := (((clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date)::timestamp AT TIME ZONE 'America/Sao_Paulo');
BEGIN
  FOR v_promotor IN
    SELECT DISTINCT v.promotor_matricula
    FROM public.visits v
    WHERE v.status = 'em_andamento'
      AND v.started_at IS NOT NULL
      AND v.completed_at IS NULL
      AND v.regularization_status IS NULL
      AND v.started_at < v_cutoff
    ORDER BY v.promotor_matricula
  LOOP
    v_closed := v_closed + attendance_private.expire_old_open_visits_for_promoter(v_promotor);
  END LOOP;
  RETURN v_closed;
END;
$$;
REVOKE ALL ON FUNCTION attendance_private.expire_old_open_visits() FROM PUBLIC, anon, authenticated;

-- A check-in remains safe if the scheduled task is delayed: sweep the
-- promoter's expired rows after the promoter/industry/route locks are held.
CREATE OR REPLACE FUNCTION attendance_private.expire_before_new_open_visit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status = 'em_andamento' AND NEW.promotor_matricula = public.get_auth_promotor_matricula() THEN
    IF TG_OP = 'INSERT' THEN
      PERFORM attendance_private.expire_old_open_visits_for_promoter(NEW.promotor_matricula);
    ELSIF OLD.status IS DISTINCT FROM 'em_andamento' THEN
      PERFORM attendance_private.expire_old_open_visits_for_promoter(NEW.promotor_matricula);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION attendance_private.expire_before_new_open_visit() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER expire_old_visits_before_promoter_checkin
  BEFORE INSERT OR UPDATE ON public.visits
  FOR EACH ROW EXECUTE FUNCTION attendance_private.expire_before_new_open_visit();

-- Authorized, atomic transition for promoter cancellation and system expiry.
CREATE OR REPLACE FUNCTION public.check_visit_promotor_update_integrity()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_authorized boolean := false;
  v_lifecycle_action text;
  v_lifecycle_actor_type text;
  v_lifecycle_actor_id uuid;
  v_lifecycle_reason text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    DELETE FROM attendance_private.visit_lifecycle_authorizations a
    WHERE a.visit_id = OLD.id
      AND a.promotor_matricula = OLD.promotor_matricula
      AND ((a.actor_type = 'promoter' AND a.actor_id = auth.uid())
        OR (a.actor_type = 'system' AND a.actor_id IS NULL))
    RETURNING a.action, a.actor_type, a.actor_id, a.reason
      INTO v_lifecycle_action, v_lifecycle_actor_type, v_lifecycle_actor_id, v_lifecycle_reason;
  END IF;

  IF v_lifecycle_action IS NOT NULL THEN
    IF OLD.status <> 'em_andamento' OR NEW.status <> 'nao_realizada'
       OR OLD.started_at IS NULL OR OLD.completed_at IS NOT NULL
       OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
       OR NEW.started_at IS DISTINCT FROM OLD.started_at
       OR NEW.promotor_matricula IS DISTINCT FROM OLD.promotor_matricula
       OR NEW.loja_codigo IS DISTINCT FROM OLD.loja_codigo
       OR NEW.industria_codigo IS DISTINCT FROM OLD.industria_codigo
       OR NEW.rota_id IS DISTINCT FROM OLD.rota_id
       OR NEW.data_visita IS DISTINCT FROM OLD.data_visita
       OR NEW.scheduled_date IS DISTINCT FROM OLD.scheduled_date
       OR NEW.latitude IS DISTINCT FROM OLD.latitude
       OR NEW.longitude IS DISTINCT FROM OLD.longitude
       OR NEW.gps_accuracy_meters IS DISTINCT FROM OLD.gps_accuracy_meters
       OR NEW.checkout_latitude IS DISTINCT FROM OLD.checkout_latitude
       OR NEW.checkout_longitude IS DISTINCT FROM OLD.checkout_longitude
       OR NEW.checkout_accuracy_meters IS DISTINCT FROM OLD.checkout_accuracy_meters
       OR NEW.work_schedule_id IS DISTINCT FROM OLD.work_schedule_id
       OR NEW.regularization_status IS DISTINCT FROM OLD.regularization_status
       OR NEW.observacao_geral IS DISTINCT FROM OLD.observacao_geral
       OR NEW.motivo_nao_realizada IS DISTINCT FROM
          CASE WHEN v_lifecycle_action = 'auto_closed_at_day_end' THEN v_lifecycle_reason
               ELSE 'Cancelada pelo promotor: ' || v_lifecycle_reason END THEN
      RAISE EXCEPTION 'Invalid authorised visit cancellation transition' USING ERRCODE = '42501';
    END IF;

    IF v_lifecycle_action = 'promoter_cancelled'
       AND (v_lifecycle_actor_type <> 'promoter'
         OR v_lifecycle_actor_id IS DISTINCT FROM auth.uid()
         OR OLD.promotor_matricula IS DISTINCT FROM public.get_auth_promotor_matricula()) THEN
      RAISE EXCEPTION 'Visit not owned by authenticated promoter' USING ERRCODE = '42501';
    END IF;
    IF v_lifecycle_action = 'auto_closed_at_day_end'
       AND (v_lifecycle_actor_type <> 'system' OR v_lifecycle_actor_id IS NOT NULL
         OR OLD.started_at >= (((clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date)::timestamp AT TIME ZONE 'America/Sao_Paulo')) THEN
      RAISE EXCEPTION 'Automatic visit closure is not due' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL AND session_user IN ('postgres','supabase_admin') THEN RETURN NEW; END IF;
  IF public.is_admin_or_gestor() THEN RETURN NEW; END IF;
  IF OLD.promotor_matricula IS DISTINCT FROM public.get_auth_promotor_matricula()
     OR public.get_auth_promotor_matricula() IS NULL THEN
    RAISE EXCEPTION 'Visit not owned by authenticated promoter' USING ERRCODE='42501';
  END IF;
  IF OLD.started_at IS NOT NULL AND NOT attendance_private.is_visit_in_current_operational_day(OLD.id) THEN
    RAISE EXCEPTION 'An old visit requires administrative regularization' USING ERRCODE='42501';
  END IF;

  IF to_regclass('attendance_private.scheduled_recovery_authorizations') IS NOT NULL THEN
    DELETE FROM attendance_private.scheduled_recovery_authorizations a
    WHERE a.visit_id = OLD.id
      AND a.promotor_matricula = OLD.promotor_matricula
      AND a.data_visita = NEW.data_visita
      AND a.scheduled_date = NEW.scheduled_date
    RETURNING true INTO v_authorized;
  END IF;

  IF coalesce(v_authorized, false) THEN
    IF (NEW.promotor_matricula,NEW.loja_codigo,NEW.industria_codigo,NEW.rota_id)
       IS DISTINCT FROM (OLD.promotor_matricula,OLD.loja_codigo,OLD.industria_codigo,OLD.rota_id) THEN
      RAISE EXCEPTION 'Visit identity is immutable' USING ERRCODE='42501';
    END IF;
    IF OLD.started_at IS NOT NULL OR OLD.completed_at IS NOT NULL OR OLD.regularization_status IS NOT NULL THEN
      RAISE EXCEPTION 'Only an unstarted occurrence without regularization can be recovered' USING ERRCODE='42501';
    END IF;
    IF OLD.status NOT IN ('pendente', 'nao_realizada') OR NEW.status <> 'em_andamento' OR NEW.started_at IS NULL THEN
      RAISE EXCEPTION 'Invalid scheduled recovery transition' USING ERRCODE='42501';
    END IF;
  ELSE
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
  END IF;

  IF NEW.status='concluida'
     AND (NEW.completed_at IS NULL OR NEW.started_at IS NULL OR NEW.completed_at<NEW.started_at) THEN
    RAISE EXCEPTION 'Invalid checkout sequence';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.check_visit_promotor_update_integrity() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.attendance_cancel_visit(p_visit_id uuid, p_reason text)
RETURNS public.visits
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_matricula text;
  v_visit public.visits;
  v_reason text := trim(regexp_replace(coalesce(p_reason, ''), '\s+', ' ', 'g'));
  v_evidence_refs jsonb;
  v_audit_id uuid;
BEGIN
  SELECT p.promotor_matricula INTO v_matricula
  FROM public.profiles p
  WHERE p.id = auth.uid() AND p.role = 'promotor' AND p.status = 'ativo';
  IF v_matricula IS NULL THEN RAISE EXCEPTION 'Promoter identity required' USING ERRCODE = '42501'; END IF;
  IF p_visit_id IS NULL THEN RAISE EXCEPTION 'Visit not found' USING ERRCODE = '22023'; END IF;
  IF length(v_reason) < 10 OR length(v_reason) > 1000
     OR lower(regexp_replace(v_reason, '\s+', ' ', 'g')) IN ('ok','okay','teste','test','na','n/a','sem motivo','motivo','regularizacao')
     OR v_reason ~* '^(.)\1+$' THEN
    RAISE EXCEPTION 'A specific reason of at least 10 characters is required' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_matricula, 1));
  SELECT v.* INTO v_visit FROM public.visits v
  WHERE v.id = p_visit_id AND v.promotor_matricula = v_matricula
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Visit not authorised' USING ERRCODE = '42501'; END IF;

  -- If the day already rolled over, use the automatic reason and audit record.
  PERFORM attendance_private.expire_old_open_visits_for_promoter(v_matricula);
  SELECT v.* INTO v_visit FROM public.visits v
  WHERE v.id = p_visit_id AND v.promotor_matricula = v_matricula
  FOR UPDATE;
  IF v_visit.status = 'nao_realizada' AND EXISTS (
    SELECT 1 FROM public.visit_lifecycle_audit a WHERE a.visit_id = v_visit.id
  ) THEN RETURN v_visit; END IF;
  IF v_visit.status = 'concluida' OR v_visit.completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Visit already completed' USING ERRCODE = '23505';
  END IF;
  IF v_visit.status <> 'em_andamento' OR v_visit.started_at IS NULL OR v_visit.regularization_status IS NOT NULL THEN
    RAISE EXCEPTION 'Visit is not active' USING ERRCODE = '23505';
  END IF;

  SELECT coalesce(jsonb_agg(evidence_ref), '[]'::jsonb) INTO v_evidence_refs
  FROM (
    SELECT jsonb_build_object('type', 'photo', 'id', ph.id) AS evidence_ref FROM public.visit_photos ph WHERE ph.visit_id = v_visit.id
    UNION ALL SELECT jsonb_build_object('type', 'checklist', 'id', ci.id) FROM public.visit_checklist_items ci WHERE ci.visit_id = v_visit.id
    UNION ALL SELECT jsonb_build_object('type', 'occurrence', 'id', vo.id) FROM public.visit_occurrences vo WHERE vo.visit_id = v_visit.id
    UNION ALL SELECT jsonb_build_object('type', 'validity', 'id', pv.id) FROM public.visit_product_validity pv WHERE pv.visit_id = v_visit.id
  ) evidence;

  INSERT INTO public.visit_lifecycle_audit (
    visit_id, promotor_matricula, action, visit_status_before, visit_status_after,
    actor_type, actor_id, reason, evidence_refs
  ) VALUES (
    v_visit.id, v_visit.promotor_matricula, 'promoter_cancelled',
    v_visit.status, 'nao_realizada', 'promoter', auth.uid(), v_reason, v_evidence_refs
  ) RETURNING id INTO v_audit_id;

  INSERT INTO attendance_private.visit_lifecycle_authorizations (
    visit_id, promotor_matricula, action, actor_type, actor_id, reason
  ) VALUES (v_visit.id, v_visit.promotor_matricula, 'promoter_cancelled', 'promoter', auth.uid(), v_reason);

  UPDATE public.visits
  SET status = 'nao_realizada',
      motivo_nao_realizada = 'Cancelada pelo promotor: ' || v_reason,
      updated_at = clock_timestamp()
  WHERE id = v_visit.id AND status = 'em_andamento' AND completed_at IS NULL
  RETURNING * INTO v_visit;
  IF NOT FOUND THEN RAISE EXCEPTION 'Visit changed while cancellation was being recorded' USING ERRCODE = '40001'; END IF;

  INSERT INTO public.visit_occurrences(visit_id, tipo, descricao)
  VALUES (v_visit.id, 'outro', 'Visita cancelada pelo promotor. Justificativa: ' || v_reason);
  RETURN v_visit;
END;
$$;
REVOKE ALL ON FUNCTION public.attendance_cancel_visit(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attendance_cancel_visit(uuid, text) TO authenticated;

-- Keep the installed recovery implementation intact. The wrapper takes the
-- same promoter -> industry -> route lock order, expires prior-day visits, and
-- then delegates to the M37 implementation for all remaining validation.
ALTER FUNCTION attendance_private.attendance_start_scheduled_occurrence(uuid, date, text, numeric, numeric, numeric)
  RENAME TO attendance_start_scheduled_occurrence_m37_base;
REVOKE ALL ON FUNCTION attendance_private.attendance_start_scheduled_occurrence_m37_base(uuid, date, text, numeric, numeric, numeric)
  FROM PUBLIC, anon, authenticated;

CREATE FUNCTION attendance_private.attendance_start_scheduled_occurrence(
  p_route uuid, p_scheduled_date date, p_action text,
  p_lat numeric DEFAULT NULL, p_lng numeric DEFAULT NULL, p_accuracy numeric DEFAULT NULL
)
RETURNS public.visits
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_matricula text;
  v_industry_code text;
  v_industry_status text;
  v_route public.rotas;
BEGIN
  SELECT p.promotor_matricula INTO v_matricula FROM public.profiles p
  WHERE p.id = auth.uid() AND p.role = 'promotor' AND p.status = 'ativo';
  IF v_matricula IS NULL THEN RAISE EXCEPTION 'Promoter identity required' USING ERRCODE = '42501'; END IF;
  IF p_action IS NULL OR p_action NOT IN ('advance','recover') OR p_route IS NULL OR p_scheduled_date IS NULL THEN
    RAISE EXCEPTION 'Invalid scheduled visit action' USING ERRCODE = '22023';
  END IF;
  IF (p_lat IS NULL) <> (p_lng IS NULL) OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180
     OR p_accuracy < 0 OR p_accuracy IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) THEN
    RAISE EXCEPTION 'Invalid GPS' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_matricula, 1));
  SELECT r.industria_codigo INTO v_industry_code
  FROM public.rotas r WHERE r.id = p_route AND r.promotor_matricula = v_matricula;
  IF NOT FOUND THEN RAISE EXCEPTION 'Route is not active or is outside promoter assignment' USING ERRCODE = '42501'; END IF;
  SELECT i.status INTO v_industry_status FROM public.industrias i WHERE i.codigo = v_industry_code FOR SHARE;
  IF NOT FOUND OR v_industry_status IS DISTINCT FROM 'ativo' THEN
    RAISE EXCEPTION 'Industry is not active or does not exist' USING ERRCODE = '42501';
  END IF;
  SELECT r.* INTO v_route FROM public.rotas r
  WHERE r.id = p_route AND r.promotor_matricula = v_matricula
    AND r.industria_codigo = v_industry_code AND r.encerrada_em IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Route is not active or is outside promoter assignment' USING ERRCODE = '42501'; END IF;

  PERFORM attendance_private.expire_old_open_visits_for_promoter(v_matricula);
  RETURN attendance_private.attendance_start_scheduled_occurrence_m37_base(
    p_route, p_scheduled_date, p_action, p_lat, p_lng, p_accuracy
  );
END;
$$;
REVOKE ALL ON FUNCTION attendance_private.attendance_start_scheduled_occurrence(uuid, date, text, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION attendance_private.attendance_start_scheduled_occurrence(uuid, date, text, numeric, numeric, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.attendance_start_scheduled_occurrence(
  p_route uuid, p_scheduled_date date, p_action text,
  p_lat numeric DEFAULT NULL, p_lng numeric DEFAULT NULL, p_accuracy numeric DEFAULT NULL
)
RETURNS public.visits
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT attendance_private.attendance_start_scheduled_occurrence(
    p_route, p_scheduled_date, p_action, p_lat, p_lng, p_accuracy
  );
$$;
REVOKE ALL ON FUNCTION public.attendance_start_scheduled_occurrence(uuid, date, text, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attendance_start_scheduled_occurrence(uuid, date, text, numeric, numeric, numeric) TO authenticated;

-- One minute cadence bounds rollover delay and uses the function's Sao Paulo
-- date comparison, so the job's own timezone does not change semantics.
SELECT cron.schedule(
  'm38-expire-old-open-visits',
  '* * * * *',
  'SELECT attendance_private.expire_old_open_visits()'
);

NOTIFY pgrst, 'reload schema';
COMMIT;
