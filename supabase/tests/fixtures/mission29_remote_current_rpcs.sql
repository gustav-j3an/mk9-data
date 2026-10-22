-- Exact relevant RPC/trigger definitions captured from remote pg_catalog.
CREATE OR REPLACE FUNCTION public.attendance_check_in(
 p_store text, p_industry text, p_route uuid DEFAULT NULL, p_lat numeric DEFAULT NULL,
 p_lng numeric DEFAULT NULL, p_accuracy numeric DEFAULT NULL
) RETURNS public.visits
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
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
 SELECT * INTO result FROM public.visits WHERE promotor_matricula=matricula AND loja_codigo=p_store AND industria_codigo=p_industry AND data_visita=operational_date;
 IF FOUND AND result.started_at IS NOT NULL THEN RETURN result; END IF;
 IF EXISTS(SELECT 1 FROM public.visits WHERE promotor_matricula=matricula AND status='em_andamento' AND id IS DISTINCT FROM result.id) THEN RAISE EXCEPTION 'Another visit is in progress'; END IF;
 IF p_route IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.rotas WHERE id=p_route AND promotor_matricula=matricula AND loja_codigo=p_store AND industria_codigo=p_industry) THEN RAISE EXCEPTION 'Invalid route'; END IF;
 INSERT INTO public.visits(promotor_matricula,loja_codigo,industria_codigo,data_visita,rota_id,started_at,latitude,longitude,gps_accuracy_meters,status,work_schedule_id)
 VALUES(matricula,p_store,p_industry,operational_date,p_route,clock_timestamp(),p_lat,p_lng,p_accuracy,'em_andamento',schedule.id)
 ON CONFLICT(promotor_matricula,loja_codigo,industria_codigo,data_visita) DO UPDATE
 SET started_at=EXCLUDED.started_at,latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,gps_accuracy_meters=EXCLUDED.gps_accuracy_meters,status=EXCLUDED.status,work_schedule_id=EXCLUDED.work_schedule_id
 RETURNING * INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.attendance_check_in(text,text,uuid,numeric,numeric,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.attendance_check_in(text,text,uuid,numeric,numeric,numeric) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.attendance_check_out(
 p_visit uuid,p_lat numeric DEFAULT NULL,p_lng numeric DEFAULT NULL,p_accuracy numeric DEFAULT NULL,p_observation text DEFAULT NULL
) RETURNS public.visits
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE result public.visits;
BEGIN
 SELECT v.* INTO result FROM public.visits v JOIN public.profiles p ON p.id=auth.uid()
 WHERE v.id=p_visit AND p.role='promotor' AND p.status='ativo' AND p.promotor_matricula=v.promotor_matricula FOR UPDATE OF v;
 IF NOT FOUND THEN RAISE EXCEPTION 'Visit not authorised' USING ERRCODE='42501'; END IF;
 IF result.completed_at IS NOT NULL THEN RETURN result; END IF;
 IF result.started_at IS NULL OR result.status<>'em_andamento' THEN RAISE EXCEPTION 'Visit has no active check-in'; END IF;
 IF (p_lat IS NULL) <> (p_lng IS NULL) OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 OR p_accuracy<0 OR p_accuracy='NaN'::numeric THEN RAISE EXCEPTION 'Invalid GPS'; END IF;
 UPDATE public.visits SET completed_at=clock_timestamp(),status='concluida',checkout_latitude=p_lat,checkout_longitude=p_lng,checkout_accuracy_meters=p_accuracy,observacao_geral=p_observation,updated_at=clock_timestamp() WHERE id=p_visit RETURNING * INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.attendance_check_out(uuid,numeric,numeric,numeric,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.attendance_check_out(uuid,numeric,numeric,numeric,text) TO authenticated,service_role;
