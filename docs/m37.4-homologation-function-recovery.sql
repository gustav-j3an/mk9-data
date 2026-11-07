-- Snapshot somente leitura da homologação tafjceemuetqjyngresg em 2026-11-07.
-- Uso exclusivo em recuperação autorizada após conferir os hashes e ACLs no ambiente alvo.
-- Não executar automaticamente. Não altera o ledger de migrations.
BEGIN;
CREATE OR REPLACE FUNCTION attendance_private.attendance_start_scheduled_occurrence(p_route uuid, p_scheduled_date date, p_action text, p_lat numeric DEFAULT NULL::numeric, p_lng numeric DEFAULT NULL::numeric, p_accuracy numeric DEFAULT NULL::numeric)
 RETURNS public.visits
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_matricula text;
  v_today date;
  v_week_start date;
  v_week_end date;
  v_route public.rotas;
  v_work_schedule public.promoter_work_schedules;
  v_existing public.visits;
  v_result public.visits;
  v_effective_date date;
  v_route_day_active boolean;
  v_operation_mode text;
  v_official_start_date text;
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

  -- Match attendance_check_in's effective operational date, including the
  -- promoter's captured timezone and overnight schedule handling.
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
  SELECT r.* INTO v_route
  FROM public.rotas r
  WHERE r.id = p_route AND r.promotor_matricula = v_matricula
    AND (r.encerrada_em IS NULL OR r.encerrada_em::date >= p_scheduled_date)
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
  ORDER BY v.created_at DESC NULLS LAST LIMIT 1;
  IF FOUND AND (v_existing.status IN ('concluida', 'em_andamento') OR v_existing.started_at IS NOT NULL) THEN
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

  -- attendance_check_in upserts by promoter/store/industry/effective date, not by
  -- route. Lock and reject that same key here so a different route at the same
  -- store cannot reuse the row and attach this occurrence to the wrong audit.
  SELECT v.* INTO v_existing FROM public.visits v
  WHERE v.promotor_matricula = v_matricula
    AND v.loja_codigo = v_route.loja_codigo
    AND v.industria_codigo = v_route.industria_codigo
    AND v.data_visita = v_effective_date
  FOR UPDATE;
  IF FOUND THEN
    RAISE EXCEPTION 'A visit for this store and industry already exists today' USING ERRCODE = '23505';
  END IF;

  v_result := public.attendance_check_in(v_route.loja_codigo, v_route.industria_codigo, p_route, p_lat, p_lng, p_accuracy);
  IF v_result.promotor_matricula IS DISTINCT FROM v_matricula
     OR v_result.rota_id IS DISTINCT FROM p_route
     OR v_result.data_visita IS DISTINCT FROM v_effective_date THEN
    RAISE EXCEPTION 'Check-in did not create the expected route occurrence' USING ERRCODE = '23505';
  END IF;
  UPDATE public.visits SET scheduled_date = p_scheduled_date
  WHERE id = v_result.id RETURNING * INTO v_result;

  INSERT INTO public.visit_schedule_actions(route_id, visit_id, promotor_matricula, scheduled_date, action, performed_by)
  VALUES (p_route, v_result.id, v_matricula, p_scheduled_date, p_action, auth.uid());
  RETURN v_result;
END;
$function$;
CREATE OR REPLACE FUNCTION public.attendance_check_in(p_store text, p_industry text, p_route uuid DEFAULT NULL::uuid, p_lat numeric DEFAULT NULL::numeric, p_lng numeric DEFAULT NULL::numeric, p_accuracy numeric DEFAULT NULL::numeric)
 RETURNS public.visits
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
END $function$;

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
DROP TABLE IF EXISTS attendance_private.scheduled_recovery_authorizations;

REVOKE ALL ON FUNCTION attendance_private.attendance_start_scheduled_occurrence(uuid, date, text, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION attendance_private.attendance_start_scheduled_occurrence(uuid, date, text, numeric, numeric, numeric) TO authenticated;
REVOKE ALL ON FUNCTION public.attendance_check_in(text, text, uuid, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.attendance_check_in(text, text, uuid, numeric, numeric, numeric) TO authenticated, service_role;
COMMIT;
