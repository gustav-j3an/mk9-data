-- Mission 37.2: require an active route and prevent reuse of regularized visits.
-- Apply after 20261106140000_m37_pending_visit_active_route_guard.sql.
-- Existing visit rows, planned dates and historical execution dates are unchanged.
BEGIN;
CREATE OR REPLACE FUNCTION public.attendance_check_in(
  p_store text,
  p_industry text,
  p_route uuid DEFAULT NULL,
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
  matricula text;
  result public.visits;
  schedule public.promoter_work_schedules;
  operational_date date;
  v_ind_status text;
  v_active_route_id uuid;
BEGIN
  -- Verificar promotor autenticado e ativo
  SELECT p.promotor_matricula INTO matricula
  FROM public.profiles p
  WHERE p.id = auth.uid() AND p.role = 'promotor' AND p.status = 'ativo';

  IF matricula IS NULL THEN
    RAISE EXCEPTION 'Promoter identity required' USING ERRCODE = '42501';
  END IF;

  -- Match the promoter -> industry -> route lock order used by scheduled check-ins.
  PERFORM pg_advisory_xact_lock(hashtextextended(matricula, 1));

  -- Validação estrita da Indústria: deve existir e possuir status exatamente 'ativo' (Missão 30.6)
  SELECT i.status INTO v_ind_status
  FROM public.industrias i
  WHERE i.codigo = p_industry
  FOR SHARE;

  IF NOT FOUND OR v_ind_status IS NULL OR v_ind_status <> 'ativo' THEN
    RAISE EXCEPTION 'Industry is not active or does not exist' USING ERRCODE = '42501';
  END IF;

  -- Require an active assignment. When p_route is omitted, allow the legacy
  -- route-less flow only if at least one matching active route exists.
  IF p_route IS NULL THEN
    SELECT r.id INTO v_active_route_id
    FROM public.rotas r
    WHERE r.promotor_matricula = matricula
      AND r.loja_codigo = p_store
      AND r.industria_codigo = p_industry
      AND r.encerrada_em IS NULL
    ORDER BY r.id
    LIMIT 1
    FOR SHARE;
  ELSE
    SELECT r.id INTO v_active_route_id
    FROM public.rotas r
    WHERE r.id = p_route
      AND r.promotor_matricula = matricula
      AND r.loja_codigo = p_store
      AND r.industria_codigo = p_industry
      AND r.encerrada_em IS NULL
    FOR SHARE;
  END IF;

  IF v_active_route_id IS NULL THEN
    RAISE EXCEPTION 'Store outside active promoter assignment' USING ERRCODE = '42501';
  END IF;

  -- Modo de operação
  IF (SELECT value #>> '{}' FROM public.system_settings WHERE key = 'operation_mode') = 'IMPLANTACAO'
     AND NOT public.is_promotor_authorized(matricula) THEN
    RAISE EXCEPTION 'Promoter not released for operation' USING ERRCODE = '42501';
  END IF;

  -- Validação de GPS
  IF (p_lat IS NULL) <> (p_lng IS NULL)
     OR p_lat NOT BETWEEN -90 AND 90
     OR p_lng NOT BETWEEN -180 AND 180
     OR p_accuracy < 0
     OR p_accuracy = 'NaN'::numeric THEN
    RAISE EXCEPTION 'Invalid GPS';
  END IF;

  operational_date := (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date;

  SELECT s.* INTO schedule
  FROM public.promoter_work_schedules s
  CROSS JOIN LATERAL (
    SELECT (clock_timestamp() AT TIME ZONE s.timezone)::date -
      CASE WHEN s.hora_fim < s.hora_inicio AND (clock_timestamp() AT TIME ZONE s.timezone)::time < s.hora_fim THEN 1 ELSE 0 END AS d
  ) local_day
  WHERE s.promotor_matricula = matricula
    AND s.ativo
    AND (s.valid_from IS NULL OR s.valid_from <= local_day.d)
    AND (s.valid_to IS NULL OR s.valid_to >= local_day.d)
    AND s.dia_semana = (ARRAY['domingo','segunda','terca','quarta','quinta','sexta','sabado'])[extract(dow FROM local_day.d)::int + 1]
  ORDER BY s.is_exception DESC, s.valid_from DESC NULLS LAST
  LIMIT 1;

  IF schedule.id IS NOT NULL THEN
    operational_date := (clock_timestamp() AT TIME ZONE schedule.timezone)::date -
      CASE WHEN schedule.hora_fim < schedule.hora_inicio AND (clock_timestamp() AT TIME ZONE schedule.timezone)::time < schedule.hora_fim THEN 1 ELSE 0 END;
  END IF;

  SELECT * INTO result
  FROM public.visits
  WHERE promotor_matricula = matricula
    AND loja_codigo = p_store
    AND industria_codigo = p_industry
    AND data_visita = operational_date
  FOR UPDATE;

  IF FOUND AND result.regularization_status IS NOT NULL THEN
    RAISE EXCEPTION 'This visit occurrence was already regularized' USING ERRCODE = '23505';
  END IF;

  IF FOUND AND result.status = 'concluida' THEN
    RAISE EXCEPTION 'This scheduled visit occurrence is already closed' USING ERRCODE = '23505';
  END IF;

  IF FOUND AND result.started_at IS NOT NULL THEN
    IF result.status = 'em_andamento' THEN
      RETURN result;
    END IF;
    RAISE EXCEPTION 'This scheduled visit occurrence is already closed' USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.visits
    WHERE promotor_matricula = matricula
      AND status = 'em_andamento'
      AND regularization_status IS NULL
      AND data_visita = operational_date
      AND id IS DISTINCT FROM result.id
  ) THEN
    RAISE EXCEPTION 'Another visit is in progress';
  END IF;


  INSERT INTO public.visits(
    promotor_matricula,
    loja_codigo,
    industria_codigo,
    data_visita,
    rota_id,
    started_at,
    latitude,
    longitude,
    gps_accuracy_meters,
    status,
    work_schedule_id
  )
  VALUES (
    matricula,
    p_store,
    p_industry,
    operational_date,
    p_route,
    clock_timestamp(),
    p_lat,
    p_lng,
    p_accuracy,
    'em_andamento',
    schedule.id
  )
  ON CONFLICT (promotor_matricula, loja_codigo, industria_codigo, data_visita)
  DO UPDATE SET
    started_at = EXCLUDED.started_at,
    latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude,
    gps_accuracy_meters = EXCLUDED.gps_accuracy_meters,
    status = EXCLUDED.status,
    work_schedule_id = EXCLUDED.work_schedule_id
  WHERE visits.regularization_status IS NULL
    AND visits.status IN ('pendente', 'nao_realizada')
  RETURNING * INTO result;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This visit occurrence is already closed or regularized' USING ERRCODE = '23505';
  END IF;

  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.attendance_check_in(text, text, uuid, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attendance_check_in(text, text, uuid, numeric, numeric, numeric) TO authenticated;

COMMIT;
