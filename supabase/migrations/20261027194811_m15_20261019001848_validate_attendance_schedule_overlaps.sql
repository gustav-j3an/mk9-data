BEGIN;
CREATE FUNCTION attendance_private.guard_schedule_overlap() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE new_start integer; new_end integer;
BEGIN
 new_start:=(array_position(ARRAY['domingo','segunda','terca','quarta','quinta','sexta','sabado'],NEW.dia_semana)-1)*1440+extract(epoch FROM NEW.hora_inicio)::integer/60;
 new_end:=(array_position(ARRAY['domingo','segunda','terca','quarta','quinta','sexta','sabado'],NEW.dia_semana)-1)*1440+extract(epoch FROM NEW.hora_fim)::integer/60+CASE WHEN NEW.hora_fim<NEW.hora_inicio THEN 1440 ELSE 0 END;
 IF NEW.ativo AND EXISTS(
 SELECT 1 FROM promoter_work_schedules s CROSS JOIN unnest(ARRAY[-10080,0,10080]) AS offset_minutes
 WHERE s.promotor_matricula=NEW.promotor_matricula AND s.ativo AND s.id IS DISTINCT FROM NEW.id
 AND NOT(s.dia_semana=NEW.dia_semana AND s.is_exception IS DISTINCT FROM NEW.is_exception)
 AND daterange(COALESCE(s.valid_from,'-infinity'::date),s.valid_to+CASE WHEN s.hora_fim<s.hora_inicio THEN 2 ELSE 1 END,'[)') && daterange(COALESCE(NEW.valid_from,'-infinity'::date),NEW.valid_to+CASE WHEN NEW.hora_fim<NEW.hora_inicio THEN 2 ELSE 1 END,'[)')
 AND (array_position(ARRAY['domingo','segunda','terca','quarta','quinta','sexta','sabado'],s.dia_semana)-1)*1440+extract(epoch FROM s.hora_inicio)::integer/60+offset_minutes<new_end
 AND (array_position(ARRAY['domingo','segunda','terca','quarta','quinta','sexta','sabado'],s.dia_semana)-1)*1440+extract(epoch FROM s.hora_fim)::integer/60+CASE WHEN s.hora_fim<s.hora_inicio THEN 1440 ELSE 0 END+offset_minutes>new_start)
 THEN RAISE EXCEPTION 'Journey overlaps another shift, including overnight carry'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER prevent_schedule_overlap BEFORE INSERT OR UPDATE ON public.promoter_work_schedules FOR EACH ROW EXECUTE FUNCTION attendance_private.guard_schedule_overlap();
-- Operational users receive only the classification, never free-text medical reasons.
CREATE POLICY override_private_reasons ON public.promoter_attendance_records AS RESTRICTIVE FOR SELECT TO authenticated
USING(EXISTS(SELECT 1 FROM profiles WHERE id=auth.uid() AND status='ativo' AND role IN ('admin','gestor')));
CREATE VIEW public.attendance_override_summary WITH(security_barrier=true) AS
SELECT r.id,r.promotor_matricula,r.data_operacional,r.override_status,r.medical_days
FROM public.promoter_attendance_records r WHERE attendance_private.staff_can_access(r.promotor_matricula);
REVOKE ALL ON public.attendance_override_summary FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.attendance_override_summary TO authenticated;
CREATE POLICY journey_global_audit_private ON public.promoter_journey_audit AS RESTRICTIVE FOR SELECT TO authenticated
USING(promotor_matricula IS NOT NULL OR public.is_admin());
NOTIFY pgrst,'reload schema';
COMMIT;
