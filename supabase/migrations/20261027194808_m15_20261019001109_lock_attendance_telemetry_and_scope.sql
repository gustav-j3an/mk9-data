BEGIN;
CREATE OR REPLACE FUNCTION attendance_private.preserve_visit_telemetry() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN
   IF OLD.started_at IS NOT NULL THEN RAISE EXCEPTION 'Recorded visits cannot be deleted' USING ERRCODE='42501'; END IF;
   RETURN OLD;
 END IF;
 IF current_user='authenticated' THEN
   IF (TG_OP='INSERT' OR OLD.started_at IS NULL) AND NEW.started_at IS NOT NULL THEN RAISE EXCEPTION 'Use authenticated check-in RPC' USING ERRCODE='42501'; END IF;
   IF (TG_OP='INSERT' OR OLD.completed_at IS NULL) AND NEW.completed_at IS NOT NULL THEN RAISE EXCEPTION 'Use authenticated checkout RPC' USING ERRCODE='42501'; END IF;
 END IF;
 IF auth.uid() IS NOT NULL THEN
   IF (TG_OP='INSERT' OR OLD.started_at IS NULL) AND NEW.started_at IS NOT NULL THEN NEW.started_at:=clock_timestamp(); END IF;
   IF (TG_OP='INSERT' OR OLD.completed_at IS NULL) AND NEW.completed_at IS NOT NULL THEN NEW.completed_at:=clock_timestamp(); END IF;
 END IF;
 IF NEW.gps_accuracy_meters IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) OR NEW.checkout_accuracy_meters IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) THEN RAISE EXCEPTION 'Invalid GPS accuracy'; END IF;
 IF TG_OP='UPDATE' AND OLD.started_at IS NOT NULL AND
   (NEW.started_at,NEW.latitude,NEW.longitude,NEW.gps_accuracy_meters,NEW.promotor_matricula,NEW.data_visita,NEW.loja_codigo,NEW.industria_codigo,NEW.work_schedule_id)
   IS DISTINCT FROM (OLD.started_at,OLD.latitude,OLD.longitude,OLD.gps_accuracy_meters,OLD.promotor_matricula,OLD.data_visita,OLD.loja_codigo,OLD.industria_codigo,OLD.work_schedule_id)
 THEN RAISE EXCEPTION 'Original check-in telemetry is immutable' USING ERRCODE='42501'; END IF;
 IF TG_OP='UPDATE' AND OLD.completed_at IS NOT NULL AND
   (NEW.completed_at,NEW.checkout_latitude,NEW.checkout_longitude,NEW.checkout_accuracy_meters) IS DISTINCT FROM (OLD.completed_at,OLD.checkout_latitude,OLD.checkout_longitude,OLD.checkout_accuracy_meters)
 THEN RAISE EXCEPTION 'Original checkout telemetry is immutable' USING ERRCODE='42501'; END IF;
 IF NEW.completed_at IS NOT NULL AND (NEW.started_at IS NULL OR NEW.completed_at<NEW.started_at) THEN RAISE EXCEPTION 'Invalid checkout sequence'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION attendance_private.guard_supervisor_assignment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM profiles p JOIN supervisores s ON s.user_id=p.id WHERE p.id=auth.uid() AND p.role='gestor')
 AND (TG_OP IN ('INSERT','DELETE') OR to_jsonb(NEW)->'equipe' IS DISTINCT FROM to_jsonb(OLD)->'equipe'
 OR to_jsonb(NEW)->'supervisor_id' IS DISTINCT FROM to_jsonb(OLD)->'supervisor_id'
 OR to_jsonb(NEW)->'user_id' IS DISTINCT FROM to_jsonb(OLD)->'user_id'
 OR to_jsonb(NEW)->'nome' IS DISTINCT FROM to_jsonb(OLD)->'nome'
 OR to_jsonb(NEW)->'codigo' IS DISTINCT FROM to_jsonb(OLD)->'codigo'
 OR (TG_TABLE_NAME='supervisores' AND to_jsonb(NEW)->'status' IS DISTINCT FROM to_jsonb(OLD)->'status'))
 THEN RAISE EXCEPTION 'Administrator required to reassign supervisor scope' USING ERRCODE='42501'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_supervisor_deletion BEFORE DELETE ON public.supervisores FOR EACH ROW EXECUTE FUNCTION attendance_private.guard_supervisor_assignment();
CREATE POLICY route_team_scope ON public.rotas AS RESTRICTIVE FOR ALL TO authenticated
USING(attendance_private.staff_can_access(promotor_matricula) OR EXISTS(SELECT 1 FROM profiles p WHERE p.id=auth.uid() AND p.status='ativo' AND ((p.role='promotor' AND p.promotor_matricula=rotas.promotor_matricula) OR (p.role='client_industry' AND p.industria_codigo=rotas.industria_codigo))))
WITH CHECK(attendance_private.staff_can_access(promotor_matricula));

CREATE FUNCTION attendance_private.audit_assignment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF (to_jsonb(OLD)->'equipe',to_jsonb(OLD)->'supervisor_id',to_jsonb(OLD)->'user_id') IS DISTINCT FROM (to_jsonb(NEW)->'equipe',to_jsonb(NEW)->'supervisor_id',to_jsonb(NEW)->'user_id') THEN
 INSERT INTO promoter_journey_audit(table_name,record_id,promotor_matricula,changed_by,previous_value,new_value,justification)
 VALUES(TG_TABLE_NAME,NEW.id,to_jsonb(NEW)->>'matricula',auth.uid(),
 jsonb_build_object('equipe',to_jsonb(OLD)->'equipe','supervisor_id',to_jsonb(OLD)->'supervisor_id','user_id',to_jsonb(OLD)->'user_id'),
 jsonb_build_object('equipe',to_jsonb(NEW)->'equipe','supervisor_id',to_jsonb(NEW)->'supervisor_id','user_id',to_jsonb(NEW)->'user_id'),'Vínculo alterado na gestão administrativa');
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER audit_team_assignment AFTER UPDATE ON public.equipes FOR EACH ROW EXECUTE FUNCTION attendance_private.audit_assignment();
CREATE TRIGGER audit_supervisor_assignment AFTER UPDATE ON public.supervisores FOR EACH ROW EXECUTE FUNCTION attendance_private.audit_assignment();
CREATE TRIGGER audit_promoter_assignment AFTER UPDATE ON public.promotores FOR EACH ROW EXECUTE FUNCTION attendance_private.audit_assignment();
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA attendance_private FROM PUBLIC,anon;
NOTIFY pgrst,'reload schema';
COMMIT;
