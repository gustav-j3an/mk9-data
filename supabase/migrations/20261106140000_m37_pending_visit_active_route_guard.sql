-- Mission 37.1: block scheduled occurrences on any currently closed route.
-- Apply after 20261106131614_m30_serialize_industry_checkin.sql.
-- Existing visits and their scheduled/planned dates are not modified.
BEGIN;
CREATE OR REPLACE FUNCTION attendance_private.attendance_start_scheduled_occurrence(
  p_route uuid,
  p_scheduled_date date,
  p_action text,
  p_lat numeric DEFAULT NULL,
  p_lng numeric DEFAULT NULL,
  p_accuracy numeric DEFAULT NULL
)
RETURNS public.visits
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_matricula text;
  v_route public.rotas;
  v_work_schedule public.promoter_work_schedules;
  v_today date := (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_effective_date date := (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_week_start date;
  v_week_end date;
  v_route_day_active boolean;
  v_existing public.visits;
  v_pending public.visits;
  v_result public.visits;
  v_operation_mode text;
  v_official_start_date text;
  v_ind_status text;
  v_industry_code text;
BEGIN
  IF p_route IS NULL OR p_scheduled_date IS NULL OR p_action IS NULL THEN
    RAISE EXCEPTION 'Route, scheduled date, and action are required' USING ERRCODE = '22023';
  END IF;
  IF p_action NOT IN ('advance', 'recover') THEN
    RAISE EXCEPTION 'Action must be advance or recover' USING ERRCODE = '22023';
  END IF;

  SELECT p.promotor_matricula INTO v_matricula
  FROM public.profiles p
  WHERE p.id = auth.uid() AND p.role = 'promotor' AND p.status = 'ativo';

  IF v_matricula IS NULL THEN
    RAISE EXCEPTION 'Promoter identity required' USING ERRCODE = '42501';
  END IF;

  -- Boundary checks: current week
  v_week_start := v_today - ((extract(dow FROM v_today)::integer + 6) % 7);
  v_week_end := v_week_start + 6;
  IF (p_action = 'advance' AND (p_scheduled_date <= v_today OR p_scheduled_date > v_week_end))
     OR (p_action = 'recover' AND (p_scheduled_date < v_week_start OR p_scheduled_date >= v_today)) THEN
    RAISE EXCEPTION 'Scheduled date is outside the recoverable current week' USING ERRCODE = '22023';
  END IF;

  -- Local day schedule
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

  PERFORM pg_advisory_xact_lock(hashtextextended(v_matricula, 1));

  -- Ler o código sem lock; em seguida bloquear a indústria antes da rota para manter
  -- a mesma ordem de locks usada pela inativação da indústria.
  SELECT r.industria_codigo INTO v_industry_code
  FROM public.rotas r
  WHERE r.id = p_route AND r.promotor_matricula = v_matricula;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Route is not active or is outside promoter assignment' USING ERRCODE = '42501';
  END IF;

  SELECT i.status INTO v_ind_status
  FROM public.industrias i
  WHERE i.codigo = v_industry_code
  FOR SHARE;

  IF NOT FOUND OR v_ind_status IS NULL OR v_ind_status <> 'ativo' THEN
    RAISE EXCEPTION 'Industry is not active or does not exist' USING ERRCODE = '42501';
  END IF;

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

  SELECT s.value #>> '{}' INTO v_operation_mode FROM public.system_settings s WHERE s.key = 'operation_mode';
  IF v_operation_mode = 'IMPLANTACAO'
     AND NOT public.is_promotor_authorized(v_matricula) THEN
    RAISE EXCEPTION 'Promoter not released for operation' USING ERRCODE = '42501';
  END IF;

  IF v_operation_mode = 'OPERACAO_OFICIAL' THEN
    SELECT s.value #>> '{}' INTO v_official_start_date FROM public.system_settings s WHERE s.key = 'official_start_date';
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

  IF p_action = 'advance' AND FOUND AND v_existing.status = 'nao_realizada' THEN
    RAISE EXCEPTION 'A future occurrence already marked as not performed cannot be advanced' USING ERRCODE = '23505';
  END IF;

  IF p_action = 'recover' AND FOUND AND (v_existing.status IS NULL OR v_existing.status NOT IN ('pendente', 'nao_realizada')) THEN
    RAISE EXCEPTION 'Only a missed occurrence can be recovered' USING ERRCODE = '22023';
  END IF;

  IF FOUND THEN
    v_pending := v_existing;
  END IF;

  SELECT v.* INTO v_existing FROM public.visits v
  WHERE v.promotor_matricula = v_matricula
    AND v.loja_codigo = v_route.loja_codigo
    AND v.industria_codigo = v_route.industria_codigo
    AND v.data_visita = v_effective_date
  FOR UPDATE;

  IF FOUND AND v_existing.id IS DISTINCT FROM v_pending.id THEN
    RAISE EXCEPTION 'A visit for this store and industry already exists today' USING ERRCODE = '23505';
  END IF;

  IF v_pending.id IS NOT NULL THEN
    -- An existing pending occurrence must be started in place. Creating another
    -- visit would collide with its unique scheduled occurrence and leave it stale.
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
        AND v.id IS DISTINCT FROM v_pending.id
    ) THEN
      RAISE EXCEPTION 'Another visit is in progress';
    END IF;
    UPDATE public.visits SET
      scheduled_date = p_scheduled_date,
      data_visita = v_effective_date,
      status = 'em_andamento',
      started_at = clock_timestamp(),
      latitude = p_lat,
      longitude = p_lng,
      gps_accuracy_meters = p_accuracy,
      work_schedule_id = v_work_schedule.id
    WHERE id = v_pending.id
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
  END IF;

  IF v_result.promotor_matricula IS DISTINCT FROM v_matricula
     OR v_result.rota_id IS DISTINCT FROM p_route
     OR v_result.data_visita IS DISTINCT FROM v_effective_date THEN
    RAISE EXCEPTION 'Check-in did not create the expected route occurrence' USING ERRCODE = '23505';
  END IF;

  IF v_pending.id IS NULL THEN
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
