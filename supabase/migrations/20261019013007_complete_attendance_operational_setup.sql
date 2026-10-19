BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='60s';
ALTER TABLE public.promoter_work_schedule_templates ADD COLUMN days text[] NOT NULL DEFAULT '{}'
 CHECK(days <@ ARRAY['domingo','segunda','terca','quarta','quinta','sexta','sabado']::text[]);

CREATE FUNCTION public.apply_attendance_journeys(p_matriculas text[],p_days text[],p_start time,p_end time,
 p_from date,p_to date,p_interval integer,p_tolerance integer,p_timezone text,p_modalidade text,
 p_reason text,p_exception boolean,p_work_uf text,p_work_city text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE m text; d text; role_name text; next_from date; end_date date; existing uuid; affected integer:=0;
BEGIN
 SELECT role INTO role_name FROM profiles WHERE id=auth.uid() AND status='ativo';
 IF role_name IS NULL OR role_name NOT IN ('admin','gestor') THEN RAISE EXCEPTION 'Administrator or authorised manager required' USING ERRCODE='42501'; END IF;
 IF p_matriculas IS NULL OR cardinality(p_matriculas) NOT BETWEEN 1 AND 500 OR array_position(p_matriculas,NULL) IS NOT NULL
 OR p_days IS NULL OR cardinality(p_days) NOT BETWEEN 1 AND 7 OR array_position(p_days,NULL) IS NOT NULL
 OR NOT p_days <@ ARRAY['domingo','segunda','terca','quarta','quinta','sexta','sabado']::text[]
 OR (SELECT count(DISTINCT x) FROM unnest(p_days) x)<>cardinality(p_days)
 OR (SELECT count(DISTINCT x) FROM unnest(p_matriculas) x)<>cardinality(p_matriculas)
 OR p_from IS NULL OR p_start IS NULL OR p_end IS NULL OR p_start=p_end OR p_to<p_from
 OR p_interval<0 OR p_tolerance<0 OR p_interval>=((extract(epoch FROM (p_end-p_start))/60)::integer+1440)%1440
 OR length(trim(COALESCE(p_reason,'')))<5 OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=p_timezone)
 THEN RAISE EXCEPTION 'Invalid journey selection, dates, interval or justification'; END IF;
 IF cardinality(p_matriculas)>1 AND role_name<>'admin' THEN RAISE EXCEPTION 'Administrator required for bulk assignment' USING ERRCODE='42501'; END IF;
 IF p_exception AND (cardinality(p_days)<>1 OR p_days[1]<>(ARRAY['domingo','segunda','terca','quarta','quinta','sexta','sabado'])[extract(dow FROM p_from)::integer+1] OR (p_to IS NOT NULL AND p_to<>p_from)) THEN RAISE EXCEPTION 'Exception must match exactly one operational date'; END IF;
 FOR m IN SELECT x FROM unnest(p_matriculas) x ORDER BY x LOOP
  IF NOT attendance_private.staff_can_access(m) OR NOT EXISTS(SELECT 1 FROM promotores WHERE matricula=m AND status='ativo') THEN RAISE EXCEPTION 'Promoter unavailable or outside authorised scope' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(m,3));
  FOREACH d IN ARRAY p_days LOOP
   end_date:=CASE WHEN p_exception THEN p_from ELSE p_to END;
   IF NOT p_exception THEN
    SELECT min(valid_from) INTO next_from FROM promoter_work_schedules WHERE promotor_matricula=m AND dia_semana=d AND ativo AND NOT is_exception AND valid_from>p_from;
    IF next_from IS NOT NULL THEN
     IF p_to IS NOT NULL AND p_to>=next_from THEN RAISE EXCEPTION 'Journey overlaps a future version'; END IF;
     end_date:=COALESCE(p_to,next_from-1);
    END IF;
    UPDATE promoter_work_schedules SET valid_to=p_from-1,justification=p_reason
    WHERE promotor_matricula=m AND dia_semana=d AND ativo AND NOT is_exception
    AND (valid_from IS NULL OR valid_from<p_from) AND (valid_to IS NULL OR valid_to>=p_from);
   END IF;
   SELECT id INTO existing FROM promoter_work_schedules WHERE promotor_matricula=m AND dia_semana=d AND ativo AND is_exception=p_exception AND valid_from=p_from FOR UPDATE;
   IF existing IS NOT NULL THEN
    UPDATE promoter_work_schedules SET hora_inicio=p_start,hora_fim=p_end,valid_to=end_date,interval_minutes=p_interval,tolerance_minutes=p_tolerance,
     timezone=p_timezone,modalidade=p_modalidade,justification=p_reason,work_uf=NULLIF(upper(trim(p_work_uf)),''),work_city=NULLIF(trim(p_work_city),'') WHERE id=existing;
   ELSE
    INSERT INTO promoter_work_schedules(promotor_matricula,dia_semana,hora_inicio,hora_fim,valid_from,valid_to,interval_minutes,tolerance_minutes,timezone,modalidade,justification,is_exception,work_uf,work_city)
    VALUES(m,d,p_start,p_end,p_from,end_date,p_interval,p_tolerance,p_timezone,p_modalidade,p_reason,p_exception,NULLIF(upper(trim(p_work_uf)),''),NULLIF(trim(p_work_city),''));
   END IF;
   affected:=affected+1;
  END LOOP;
 END LOOP;
 RETURN jsonb_build_object('success',true,'affected',affected);
END $$;
REVOKE ALL ON FUNCTION public.apply_attendance_journeys(text[],text[],time,time,date,date,integer,integer,text,text,text,boolean,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.apply_attendance_journeys(text[],text[],time,time,date,date,integer,integer,text,text,text,boolean,text,text) TO authenticated;

CREATE FUNCTION public.assign_attendance_supervisor(p_matriculas text[],p_team text,p_supervisor uuid,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE team_row equipes; supervisor_row supervisores; m text; old_row promotores;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM profiles WHERE id=auth.uid() AND status='ativo' AND role='admin') THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
 IF p_matriculas IS NULL OR cardinality(p_matriculas) NOT BETWEEN 1 AND 500 OR array_position(p_matriculas,NULL) IS NOT NULL OR length(trim(COALESCE(p_reason,'')))<5 THEN RAISE EXCEPTION 'Selection and justification required'; END IF;
 SELECT * INTO team_row FROM equipes WHERE codigo=p_team AND status='ativa' FOR UPDATE;
 SELECT * INTO supervisor_row FROM supervisores WHERE id=p_supervisor AND status='ativo';
 IF team_row.id IS NULL OR supervisor_row.id IS NULL THEN RAISE EXCEPTION 'Active team and supervisor required'; END IF;
 IF team_row.supervisor_id IS NOT NULL AND team_row.supervisor_id<>p_supervisor THEN RAISE EXCEPTION 'Team already has another supervisor; change its manager in team management'; END IF;
 UPDATE equipes SET supervisor_id=p_supervisor,supervisor_nome=supervisor_row.nome WHERE id=team_row.id;
 FOR m IN SELECT DISTINCT x FROM unnest(p_matriculas) x ORDER BY x LOOP
  SELECT * INTO old_row FROM promotores WHERE matricula=m AND status='ativo' FOR UPDATE;
  IF old_row.id IS NULL THEN RAISE EXCEPTION 'Active promoter required'; END IF;
  UPDATE promotores SET equipe=team_row.nome,supervisor=supervisor_row.nome WHERE id=old_row.id;
  INSERT INTO promoter_journey_audit(table_name,record_id,promotor_matricula,changed_by,previous_value,new_value,justification)
  VALUES('attendance_supervisor_assignment',old_row.id,m,auth.uid(),jsonb_build_object('equipe',old_row.equipe,'supervisor',old_row.supervisor),
   jsonb_build_object('equipe',team_row.nome,'supervisor_id',p_supervisor,'supervisor',supervisor_row.nome),p_reason);
 END LOOP;
 RETURN jsonb_build_object('success',true);
END $$;
REVOKE ALL ON FUNCTION public.assign_attendance_supervisor(text[],text,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.assign_attendance_supervisor(text[],text,uuid,text) TO authenticated;

CREATE FUNCTION attendance_private.reset_absence_approval() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.key='attendance_rules' AND (NEW.value-ARRAY['automatic_absence_approved','approved_by','approved_at']) IS DISTINCT FROM (OLD.value-ARRAY['automatic_absence_approved','approved_by','approved_at']) THEN
 NEW.value:=(NEW.value-ARRAY['approved_by','approved_at'])||jsonb_build_object('automatic_absence_approved',false); END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION attendance_private.reset_absence_approval() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER attendance_rules_require_reapproval BEFORE UPDATE ON system_settings FOR EACH ROW EXECUTE FUNCTION attendance_private.reset_absence_approval();
CREATE FUNCTION public.approve_attendance_closure(p_approved boolean,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE old_value jsonb; updated jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM profiles WHERE id=auth.uid() AND status='ativo' AND role='admin') THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
 IF p_approved IS NULL OR length(trim(COALESCE(p_reason,'')))<5 THEN RAISE EXCEPTION 'Explicit approval and justification required'; END IF;
 SELECT value INTO old_value FROM system_settings WHERE key='attendance_rules' FOR UPDATE;
 IF old_value IS NULL OR (p_approved AND (old_value->>'day_close_time' IS NULL OR old_value->>'late_tolerance_minutes' IS NULL)) THEN RAISE EXCEPTION 'Closing time and tolerance must be configured before approval'; END IF;
 updated:=old_value||jsonb_build_object('automatic_absence_approved',p_approved,'approved_by',auth.uid(),'approved_at',clock_timestamp());
 UPDATE system_settings SET value=updated,updated_by=auth.uid(),updated_at=clock_timestamp() WHERE key='attendance_rules';
 INSERT INTO promoter_journey_audit(table_name,record_id,changed_by,previous_value,new_value,justification)
 VALUES('attendance_closure_approval',gen_random_uuid(),auth.uid(),old_value,updated,p_reason);
 RETURN jsonb_build_object('success',true);
END $$;
REVOKE ALL ON FUNCTION public.approve_attendance_closure(boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.approve_attendance_closure(boolean,text) TO authenticated;
CREATE FUNCTION public.attendance_setup_status() RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('version',9,'administration_available',true)
 WHERE EXISTS(SELECT 1 FROM profiles WHERE id=auth.uid() AND status='ativo' AND role IN ('admin','gestor','operador'));
$$;
REVOKE ALL ON FUNCTION public.attendance_setup_status() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.attendance_setup_status() TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
