BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- 1. Tabela interna de autorizações transacionais em attendance_private
CREATE TABLE IF NOT EXISTS attendance_private.scheduled_recovery_authorizations (
  visit_id uuid PRIMARY KEY,
  promotor_matricula text NOT NULL,
  data_visita date NOT NULL,
  scheduled_date date NOT NULL,
  authorized_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE attendance_private.scheduled_recovery_authorizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON attendance_private.scheduled_recovery_authorizations FROM PUBLIC, anon, authenticated;

-- 2. Atualização de public.check_visit_promotor_update_integrity
CREATE OR REPLACE FUNCTION public.check_visit_promotor_update_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_authorized boolean := false;
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

-- 3. Atualização de attendance_private.attendance_start_scheduled_occurrence
CREATE OR REPLACE FUNCTION attendance_private.attendance_start_scheduled_occurrence(
  p_route uuid,
  p_scheduled_date date,
  p_action text,
  p_lat numeric DEFAULT NULL::numeric,
  p_lng numeric DEFAULT NULL::numeric,
  p_accuracy numeric DEFAULT NULL::numeric
)
RETURNS public.visits
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_matricula text;
  v_today date;
  v_week_start date;
  v_week_end date;
  v_route public.rotas;
  v_work_schedule public.promoter_work_schedules;
  v_existing public.visits;
  v_today_visit public.visits;
  v_result public.visits;
  v_effective_date date;
  v_route_day_active boolean;
  v_operation_mode text;
  v_official_start_date text;
  v_ind_status text;
  v_industry_code text;
BEGIN
  SELECT p.promotor_matricula INTO v_matricula
  FROM public.profiles p
  WHERE p.id = auth.uid() AND p.role = 'promotor' AND p.status = 'ativo';
  IF v_matricula IS NULL THEN
    RAISE EXCEPTION 'Promoter identity required' USING ERRCODE = '42501';
  END IF;

  v_today := (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_effective_date := v_today;
  v_week_start := v_today - (extract(isodow FROM v_today)::integer - 1);
  v_week_end := v_week_start + 6;

  IF p_action IS NULL OR p_action NOT IN ('advance', 'recover') THEN
    RAISE EXCEPTION 'Invalid scheduled visit action' USING ERRCODE = '22023';
  END IF;

  IF p_route IS NULL OR p_scheduled_date IS NULL THEN
    RAISE EXCEPTION 'Route and scheduled date are required' USING ERRCODE = '22023';
  END IF;

  IF (p_action = 'advance' AND (p_scheduled_date <= v_today OR p_scheduled_date > v_week_end))
     OR (p_action = 'recover' AND (p_scheduled_date < v_week_start OR p_scheduled_date >= v_today)) THEN
    RAISE EXCEPTION 'Scheduled date is outside the recoverable current week' USING ERRCODE = '22023';
  END IF;

  SELECT s.* INTO v_work_schedule
  FROM public.promoter_work_schedules s
  CROSS JOIN LATERAL (
    SELECT (clock_timestamp() AT TIME ZONE s.timezone)::date
      - CASE
          WHEN s.hora_fim < s.hora_inicio
           AND (clock_timestamp() AT TIME ZONE s.timezone)::time < s.hora_fim THEN 1
          ELSE 0
        END AS operational_date
  ) local_day
  WHERE s.promotor_matricula = v_matricula
    AND s.ativo
    AND (s.valid_from IS NULL OR s.valid_from <= local_day.operational_date)
    AND (s.valid_to IS NULL OR s.valid_to >= local_day.operational_date)
    AND s.dia_semana = (ARRAY['domingo','segunda','terca','quarta','quinta','sexta','sabado'])[extract(dow FROM local_day.operational_date)::integer + 1]
  ORDER BY s.is_exception DESC, s.valid_from DESC NULLS LAST
  LIMIT 1;

  IF v_work_schedule.id IS NOT NULL THEN
    v_effective_date := (clock_timestamp() AT TIME ZONE v_work_schedule.timezone)::date
      - CASE
          WHEN v_work_schedule.hora_fim < v_work_schedule.hora_inicio
           AND (clock_timestamp() AT TIME ZONE v_work_schedule.timezone)::time < v_work_schedule.hora_fim THEN 1
          ELSE 0
        END;
  END IF;

  -- 1. Lock transacional do promotor
  PERFORM pg_advisory_xact_lock(hashtextextended(v_matricula, 1));

  -- 2. Identificação da indústria vinculada à rota sem lock prévio
  SELECT r.industria_codigo INTO v_industry_code
  FROM public.rotas r
  WHERE r.id = p_route AND r.promotor_matricula = v_matricula;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Route is not active or is outside promoter assignment' USING ERRCODE = '42501';
  END IF;

  -- 3. Validação e bloqueio da indústria ativa com FOR SHARE (ordem segura M30.9)
  SELECT i.status INTO v_ind_status
  FROM public.industrias i
  WHERE i.codigo = v_industry_code
  FOR SHARE;

  IF NOT FOUND OR v_ind_status IS NULL OR v_ind_status <> 'ativo' THEN
    RAISE EXCEPTION 'Industry is not active or does not exist' USING ERRCODE = '42501';
  END IF;

  -- 4. Validação e bloqueio da rota correspondente com regra estrita de encerramento
  SELECT r.* INTO v_route
  FROM public.rotas r
  WHERE r.id = p_route AND r.promotor_matricula = v_matricula
    AND r.industria_codigo = v_industry_code
    AND r.encerrada_em IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Route is not active or is outside promoter assignment' USING ERRCODE = '42501';
  END IF;

  v_route_day_active := CASE extract(dow FROM p_scheduled_date)::integer
    WHEN 0 THEN coalesce(v_route.domingo, false)
    WHEN 1 THEN coalesce(v_route.segunda, false)
    WHEN 2 THEN coalesce(v_route.terca, false)
    WHEN 3 THEN coalesce(v_route.quarta, false)
    WHEN 4 THEN coalesce(v_route.quinta, false)
    WHEN 5 THEN coalesce(v_route.sexta, false)
    WHEN 6 THEN coalesce(v_route.sabado, false)
  END;

  IF NOT coalesce(v_route_day_active, false) THEN
    RAISE EXCEPTION 'Route is not scheduled for that weekday' USING ERRCODE = '22023';
  END IF;

  IF upper(coalesce(v_route.frequencia, 'SEMANAL')) <> 'SEMANAL' THEN
    RAISE EXCEPTION 'Quinzenal occurrences require an authoritative server schedule before they can be advanced or recovered' USING ERRCODE = '22023';
  END IF;

  -- 5. Validação de modo de operação
  SELECT s.value #>> '{}' INTO v_operation_mode
  FROM public.system_settings s
  WHERE s.key = 'operation_mode';

  IF v_operation_mode = 'IMPLANTACAO' AND NOT public.is_promotor_authorized(v_matricula) THEN
    RAISE EXCEPTION 'Promoter not released for operation' USING ERRCODE = '42501';
  END IF;

  IF v_operation_mode = 'OPERACAO_OFICIAL' THEN
    SELECT s.value #>> '{}' INTO v_official_start_date
    FROM public.system_settings s
    WHERE s.key = 'official_start_date';

    IF v_official_start_date IS NULL OR v_official_start_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       OR p_scheduled_date < v_official_start_date::date THEN
      RAISE EXCEPTION 'Scheduled occurrence is before the official operation start' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.visit_schedule_actions a
    WHERE a.promotor_matricula = v_matricula AND a.route_id = p_route
      AND a.scheduled_date = p_scheduled_date
  ) THEN
    RAISE EXCEPTION 'This scheduled occurrence was already advanced or recovered' USING ERRCODE = '23505';
  END IF;

  SELECT v.* INTO v_existing FROM public.visits v
  WHERE v.promotor_matricula = v_matricula AND v.rota_id = p_route
    AND (v.scheduled_date = p_scheduled_date OR (v.scheduled_date IS NULL AND v.data_visita = p_scheduled_date))
  ORDER BY v.created_at DESC NULLS LAST LIMIT 1 FOR UPDATE;

  IF FOUND AND (v_existing.status IN ('concluida', 'em_andamento')
    OR v_existing.started_at IS NOT NULL OR v_existing.completed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'This scheduled occurrence already has an execution' USING ERRCODE = '23505';
  END IF;

  IF FOUND AND v_existing.regularization_status IS NOT NULL THEN
    RAISE EXCEPTION 'This scheduled occurrence was already regularized' USING ERRCODE = '23505';
  END IF;

  -- Verificação ampla de evidências em todas as tabelas relacionadas
  IF FOUND AND (
    EXISTS (SELECT 1 FROM public.visit_checklist_items ci WHERE ci.visit_id = v_existing.id)
    OR EXISTS (SELECT 1 FROM public.visit_photos ph WHERE ph.visit_id = v_existing.id)
    OR EXISTS (SELECT 1 FROM public.visit_occurrences vo WHERE vo.visit_id = v_existing.id)
    OR EXISTS (SELECT 1 FROM public.visit_product_validity pv WHERE pv.visit_id = v_existing.id)
  ) THEN
    RAISE EXCEPTION 'This scheduled occurrence already has recorded evidence' USING ERRCODE = '23505';
  END IF;

  IF p_action = 'advance' AND FOUND AND v_existing.status = 'nao_realizada' THEN
    RAISE EXCEPTION 'A future occurrence already marked as not performed cannot be advanced' USING ERRCODE = '23505';
  END IF;

  IF p_action = 'recover' AND FOUND AND (v_existing.status IS NULL OR v_existing.status NOT IN ('pendente', 'nao_realizada')) THEN
    RAISE EXCEPTION 'Only a missed occurrence can be recovered' USING ERRCODE = '22023';
  END IF;

  SELECT v.* INTO v_today_visit FROM public.visits v
  WHERE v.promotor_matricula = v_matricula
    AND v.loja_codigo = v_route.loja_codigo
    AND v.industria_codigo = v_route.industria_codigo
    AND v.data_visita = v_effective_date
  FOR UPDATE;

  IF FOUND AND (v_existing.id IS NULL OR v_today_visit.id IS DISTINCT FROM v_existing.id) THEN
    RAISE EXCEPTION 'A visit for this store and industry already exists today' USING ERRCODE = '23505';
  END IF;

  IF v_existing.id IS NOT NULL THEN
    IF (p_lat IS NULL) <> (p_lng IS NULL)
       OR p_lat NOT BETWEEN -90 AND 90
       OR p_lng NOT BETWEEN -180 AND 180
       OR p_accuracy < 0
       OR p_accuracy = 'NaN'::numeric THEN
      RAISE EXCEPTION 'Invalid GPS';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.visits v
      WHERE v.promotor_matricula = v_matricula
        AND v.status = 'em_andamento'
        AND v.regularization_status IS NULL
        AND v.data_visita = v_effective_date
        AND v.id IS DISTINCT FROM v_existing.id
    ) THEN
      RAISE EXCEPTION 'Another visit is in progress';
    END IF;

    INSERT INTO attendance_private.scheduled_recovery_authorizations (
      visit_id, promotor_matricula, data_visita, scheduled_date
    ) VALUES (
      v_existing.id, v_matricula, v_effective_date, p_scheduled_date
    ) ON CONFLICT (visit_id) DO UPDATE SET
      data_visita = EXCLUDED.data_visita,
      scheduled_date = EXCLUDED.scheduled_date,
      authorized_at = clock_timestamp();

    UPDATE public.visits SET
      scheduled_date = p_scheduled_date,
      data_visita = v_effective_date,
      status = 'em_andamento',
      started_at = clock_timestamp(),
      latitude = p_lat,
      longitude = p_lng,
      gps_accuracy_meters = p_accuracy,
      work_schedule_id = v_work_schedule.id
    WHERE id = v_existing.id
      AND status IN ('pendente', 'nao_realizada')
      AND regularization_status IS NULL
      AND started_at IS NULL
      AND completed_at IS NULL
    RETURNING * INTO v_result;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'This scheduled occurrence changed before check-in' USING ERRCODE = '23505';
    END IF;
  ELSE
    v_result := public.attendance_check_in(v_route.loja_codigo, v_route.industria_codigo, p_route, p_lat, p_lng, p_accuracy);

    IF v_result.promotor_matricula IS DISTINCT FROM v_matricula
       OR v_result.rota_id IS DISTINCT FROM p_route
       OR v_result.data_visita IS DISTINCT FROM v_effective_date THEN
      RAISE EXCEPTION 'Check-in did not create the expected route occurrence' USING ERRCODE = '23505';
    END IF;

    UPDATE public.visits SET scheduled_date = p_scheduled_date
    WHERE id = v_result.id RETURNING * INTO v_result;
  END IF;

  INSERT INTO public.visit_schedule_actions(route_id, visit_id, promotor_matricula, scheduled_date, action, performed_by)
  VALUES (p_route, v_result.id, v_matricula, p_scheduled_date, p_action, auth.uid());

  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION attendance_private.attendance_start_scheduled_occurrence(uuid, date, text, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION attendance_private.attendance_start_scheduled_occurrence(uuid, date, text, numeric, numeric, numeric) TO authenticated;

COMMIT;
