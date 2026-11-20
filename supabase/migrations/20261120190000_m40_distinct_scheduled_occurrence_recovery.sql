BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- M40 narrows only the same-day duplicate guard to the scheduled occurrence identity.
-- M37/M38/M39 remain immutable. Any active visit for this promoter remains blocked above.
-- Rollback: execute docs/releases/RC1.25.64_M40_rollback.sql to restore the M39 helper.

CREATE OR REPLACE FUNCTION attendance_private.attendance_retry_closed_scheduled_occurrence(
  p_route uuid,
  p_scheduled_date date,
  p_lat numeric,
  p_lng numeric,
  p_accuracy numeric
)
RETURNS public.visits
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_matricula text;
  v_today date := (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_week_start date;
  v_week_end date;
  v_route public.rotas;
  v_work_schedule public.promoter_work_schedules;
  v_industry_code text;
  v_industry_status text;
  v_effective_date date;
  v_route_day_active boolean;
  v_operation_mode text;
  v_official_start_date text;
  v_latest public.visits;
  v_root_id uuid;
  v_attempt_number smallint;
  v_new_id uuid := gen_random_uuid();
  v_result public.visits;
BEGIN
  SELECT p.promotor_matricula INTO v_matricula
  FROM public.profiles p
  WHERE p.id = auth.uid() AND p.role = 'promotor' AND p.status = 'ativo';
  IF v_matricula IS NULL THEN RAISE EXCEPTION 'Promoter identity required' USING ERRCODE = '42501'; END IF;
  IF p_route IS NULL OR p_scheduled_date IS NULL THEN
    RAISE EXCEPTION 'Route and scheduled date are required' USING ERRCODE = '22023';
  END IF;
  v_week_start := v_today - (extract(isodow FROM v_today)::integer - 1);
  v_week_end := v_week_start + 6;
  IF p_scheduled_date < v_week_start OR p_scheduled_date >= v_today OR p_scheduled_date > v_week_end THEN
    RAISE EXCEPTION 'Scheduled date is outside the recoverable current week' USING ERRCODE = '22023';
  END IF;
  IF (p_lat IS NULL) <> (p_lng IS NULL)
     OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180
     OR p_accuracy < 0 OR p_accuracy IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) THEN
    RAISE EXCEPTION 'Invalid GPS' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_matricula, 1));
  SELECT r.industria_codigo INTO v_industry_code
  FROM public.rotas r
  WHERE r.id = p_route AND r.promotor_matricula = v_matricula;
  IF NOT FOUND THEN RAISE EXCEPTION 'Route is outside promoter assignment' USING ERRCODE = '42501'; END IF;
  SELECT i.status INTO v_industry_status
  FROM public.industrias i WHERE i.codigo = v_industry_code FOR SHARE;
  IF NOT FOUND OR v_industry_status IS DISTINCT FROM 'ativo' THEN
    RAISE EXCEPTION 'Industry is not active or does not exist' USING ERRCODE = '42501';
  END IF;
  SELECT r.* INTO v_route FROM public.rotas r
  WHERE r.id = p_route AND r.promotor_matricula = v_matricula
    AND r.industria_codigo = v_industry_code AND r.encerrada_em IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Route is not active or is outside promoter assignment' USING ERRCODE = '42501'; END IF;

  v_route_day_active := CASE extract(dow FROM p_scheduled_date)::integer
    WHEN 0 THEN coalesce(v_route.domingo, false)
    WHEN 1 THEN coalesce(v_route.segunda, false)
    WHEN 2 THEN coalesce(v_route.terca, false)
    WHEN 3 THEN coalesce(v_route.quarta, false)
    WHEN 4 THEN coalesce(v_route.quinta, false)
    WHEN 5 THEN coalesce(v_route.sexta, false)
    WHEN 6 THEN coalesce(v_route.sabado, false)
  END;
  IF NOT coalesce(v_route_day_active, false) THEN RAISE EXCEPTION 'Route is not scheduled for that weekday' USING ERRCODE = '22023'; END IF;
  IF upper(coalesce(v_route.frequencia, 'SEMANAL')) <> 'SEMANAL' THEN
    RAISE EXCEPTION 'Quinzenal occurrences require an authoritative server schedule' USING ERRCODE = '22023';
  END IF;

  SELECT s.value #>> '{}' INTO v_operation_mode FROM public.system_settings s WHERE s.key = 'operation_mode';
  IF v_operation_mode = 'IMPLANTACAO' AND NOT public.is_promotor_authorized(v_matricula) THEN
    RAISE EXCEPTION 'Promoter not released for operation' USING ERRCODE = '42501';
  END IF;
  IF v_operation_mode = 'OPERACAO_OFICIAL' THEN
    SELECT s.value #>> '{}' INTO v_official_start_date FROM public.system_settings s WHERE s.key = 'official_start_date';
    IF v_official_start_date IS NULL OR v_official_start_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       OR p_scheduled_date < v_official_start_date::date THEN
      RAISE EXCEPTION 'Scheduled occurrence is before the official operation start' USING ERRCODE = '22023';
    END IF;
  END IF;

  PERFORM attendance_private.expire_old_open_visits_for_promoter(v_matricula);
  SELECT v.* INTO v_latest FROM public.visits v
  WHERE v.promotor_matricula = v_matricula AND v.rota_id = p_route AND (v.scheduled_date = p_scheduled_date OR (v.scheduled_date IS NULL AND v.data_visita = p_scheduled_date))
  ORDER BY v.attempt_number DESC
  LIMIT 1 FOR UPDATE;
  IF NOT FOUND OR v_latest.status <> 'nao_realizada' OR v_latest.started_at IS NULL
     OR v_latest.completed_at IS NOT NULL OR v_latest.regularization_status IS NOT NULL
     OR NOT EXISTS (
       SELECT 1 FROM public.visit_lifecycle_audit a
       WHERE a.visit_id = v_latest.id AND a.action IN ('promoter_cancelled','auto_closed_at_day_end')
     ) THEN
    RAISE EXCEPTION 'Only a cancelled or automatically closed attempt can be retried' USING ERRCODE = '23505';
  END IF;
  v_root_id := coalesce(v_latest.occurrence_root_visit_id, v_latest.id);
  IF EXISTS (
    SELECT 1 FROM public.visits v
    WHERE v.promotor_matricula = v_matricula AND v.rota_id = p_route AND (v.scheduled_date = p_scheduled_date OR (v.scheduled_date IS NULL AND v.data_visita = p_scheduled_date))
      AND (v.status = 'concluida' OR v.completed_at IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'A completed occurrence cannot be recovered again' USING ERRCODE = '23505';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.visits v
    WHERE v.promotor_matricula = v_matricula AND v.status = 'em_andamento'
      AND v.regularization_status IS NULL
  ) THEN
    RAISE EXCEPTION 'Another visit is in progress' USING ERRCODE = '42501';
  END IF;

  SELECT s.* INTO v_work_schedule
  FROM public.promoter_work_schedules s
  CROSS JOIN LATERAL (
    SELECT (clock_timestamp() AT TIME ZONE s.timezone)::date
      - CASE WHEN s.hora_fim < s.hora_inicio
          AND (clock_timestamp() AT TIME ZONE s.timezone)::time < s.hora_fim THEN 1 ELSE 0 END AS operational_date
  ) local_day
  WHERE s.promotor_matricula = v_matricula AND s.ativo
    AND (s.valid_from IS NULL OR s.valid_from <= local_day.operational_date)
    AND (s.valid_to IS NULL OR s.valid_to >= local_day.operational_date)
    AND s.dia_semana = (ARRAY['domingo','segunda','terca','quarta','quinta','sexta','sabado'])[extract(dow FROM local_day.operational_date)::integer + 1]
  ORDER BY s.is_exception DESC, s.valid_from DESC NULLS LAST LIMIT 1;
  v_effective_date := v_today;
  IF v_work_schedule.id IS NOT NULL THEN
    v_effective_date := (clock_timestamp() AT TIME ZONE v_work_schedule.timezone)::date
      - CASE WHEN v_work_schedule.hora_fim < v_work_schedule.hora_inicio
          AND (clock_timestamp() AT TIME ZONE v_work_schedule.timezone)::time < v_work_schedule.hora_fim THEN 1 ELSE 0 END;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.visits v
    WHERE v.promotor_matricula = v_matricula
      AND v.loja_codigo = v_route.loja_codigo
      AND v.industria_codigo = v_route.industria_codigo
      AND v.data_visita = v_effective_date
      AND coalesce(v.scheduled_date, v.data_visita)
          = coalesce(v_latest.scheduled_date, v_latest.data_visita)
  ) THEN
    RAISE EXCEPTION 'Já existe um atendimento para esta loja e indústria na data operacional atual.' USING ERRCODE = '23505';
  END IF;

  SELECT coalesce(max(v.attempt_number), 1) + 1 INTO v_attempt_number
  FROM public.visits v
  WHERE v.promotor_matricula = v_matricula AND v.rota_id = p_route AND (v.scheduled_date = p_scheduled_date OR (v.scheduled_date IS NULL AND v.data_visita = p_scheduled_date));
  INSERT INTO attendance_private.scheduled_attempt_authorizations (
    visit_id, root_visit_id, promotor_matricula, route_id, scheduled_date, attempt_number
  ) VALUES (v_new_id, v_root_id, v_matricula, p_route, p_scheduled_date, v_attempt_number);

  INSERT INTO public.visits (
    id, promotor_matricula, loja_codigo, industria_codigo, data_visita, scheduled_date,
    rota_id, started_at, latitude, longitude, gps_accuracy_meters, status, work_schedule_id,
    occurrence_root_visit_id, attempt_number
  ) VALUES (
    v_new_id, v_matricula, v_route.loja_codigo, v_route.industria_codigo, v_effective_date, p_scheduled_date,
    p_route, clock_timestamp(), p_lat, p_lng, p_accuracy, 'em_andamento', v_work_schedule.id,
    v_root_id, v_attempt_number
  ) RETURNING * INTO v_result;

  INSERT INTO public.visit_schedule_actions(route_id, visit_id, promotor_matricula, scheduled_date, action, performed_by)
  VALUES (p_route, v_result.id, v_matricula, p_scheduled_date, 'recover', auth.uid());
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION attendance_private.attendance_retry_closed_scheduled_occurrence(uuid, date, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
