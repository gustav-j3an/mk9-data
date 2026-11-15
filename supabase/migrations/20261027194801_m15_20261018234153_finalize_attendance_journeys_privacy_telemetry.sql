BEGIN;
CREATE SCHEMA IF NOT EXISTS attendance_private;
REVOKE ALL ON SCHEMA attendance_private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA attendance_private TO authenticated;

-- A gestor linked to a supervisor is scoped to that supervisor's teams.
-- Unlinked gestores retain their existing management role; admin is global.
CREATE FUNCTION attendance_private.staff_can_access(matricula text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT EXISTS (SELECT 1 FROM profiles p WHERE p.id=auth.uid() AND p.status='ativo' AND (
   p.role IN ('admin','operador') OR (p.role='gestor' AND (
     NOT EXISTS (SELECT 1 FROM supervisores s WHERE s.user_id=p.id)
     OR EXISTS (SELECT 1 FROM supervisores s JOIN equipes e ON e.supervisor_id=s.id
       JOIN promotores pr ON (lower(trim(pr.equipe))=lower(trim(e.nome)) OR pr.equipe=e.codigo)
       WHERE s.user_id=p.id AND s.status='ativo' AND e.status='ativa' AND pr.matricula=staff_can_access.matricula)
   ))));
$$;
REVOKE ALL ON FUNCTION attendance_private.staff_can_access(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION attendance_private.staff_can_access(text) TO authenticated;

CREATE FUNCTION attendance_private.can_read_visit(visit_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM visits v JOIN profiles p ON p.id=auth.uid()
 WHERE v.id=visit_id AND p.status='ativo' AND (
   attendance_private.staff_can_access(v.promotor_matricula)
   OR (p.role='promotor' AND p.promotor_matricula=v.promotor_matricula)
   OR (p.role='client_industry' AND p.industria_codigo=v.industria_codigo)));
$$;
REVOKE ALL ON FUNCTION attendance_private.can_read_visit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION attendance_private.can_read_visit(uuid) TO authenticated;

-- Restrictive policies intersect all pre-existing permissive policies.
CREATE POLICY visits_sensitive_scope ON public.visits AS RESTRICTIVE FOR ALL TO authenticated
USING (EXISTS(SELECT 1 FROM profiles p WHERE p.id=auth.uid() AND p.status='ativo' AND (
 attendance_private.staff_can_access(visits.promotor_matricula) OR (p.role='promotor' AND p.promotor_matricula=visits.promotor_matricula))))
WITH CHECK (EXISTS(SELECT 1 FROM profiles p WHERE p.id=auth.uid() AND p.status='ativo' AND (
 attendance_private.staff_can_access(visits.promotor_matricula) OR (p.role='promotor' AND p.promotor_matricula=visits.promotor_matricula))));
CREATE POLICY promoters_sensitive_scope ON public.promotores AS RESTRICTIVE FOR SELECT TO authenticated
USING (attendance_private.staff_can_access(matricula) OR EXISTS(SELECT 1 FROM profiles WHERE id=auth.uid() AND status='ativo' AND role='promotor' AND promotor_matricula=promotores.matricula));
CREATE POLICY profiles_private_read ON public.profiles AS RESTRICTIVE FOR SELECT TO authenticated
USING (id=auth.uid() OR public.is_admin_or_gestor());

-- A deliberately sanitised definer view: the explicit parent predicate is mandatory.
-- Raw tables remain inaccessible to industrial clients. No GPS, CPF, email or phone.
CREATE VIEW public.industry_visits WITH (security_barrier=true) AS
SELECT v.id,v.rota_id,v.promotor_matricula,v.loja_codigo,v.industria_codigo,v.data_visita,
 v.status,v.started_at,v.completed_at,v.created_at,v.updated_at,
 jsonb_build_object('matricula',pr.matricula,'nome',pr.nome) AS promotor,
 jsonb_build_object('codigo',l.codigo,'nome',l.nome,'cidade',l.cidade,'uf',l.uf,'endereco',l.endereco) AS loja,
 jsonb_build_object('codigo',i.codigo,'nome',i.nome) AS industria,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('id',ph.id,'storage_path',ph.storage_path,'tipo_foto',ph.tipo_foto)) FROM visit_photos ph WHERE ph.visit_id=v.id),'[]'::jsonb) AS photos,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('id',o.id,'tipo',o.tipo,'descricao',o.descricao,'resolvido',o.resolvido)) FROM visit_occurrences o WHERE o.visit_id=v.id),'[]'::jsonb) AS occurrences,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('id',pv.id,'produto_nome',pv.produto_nome,'quantidade',pv.quantidade,'data_vencimento',pv.data_vencimento,'lote',pv.lote)) FROM visit_product_validity pv WHERE pv.visit_id=v.id),'[]'::jsonb) AS validity_items
FROM public.visits v JOIN public.promotores pr ON pr.matricula=v.promotor_matricula
JOIN public.lojas l ON l.codigo=v.loja_codigo JOIN public.industrias i ON i.codigo=v.industria_codigo
WHERE attendance_private.can_read_visit(v.id);
REVOKE ALL ON public.industry_visits FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.industry_visits TO authenticated;
CREATE VIEW public.industry_promoters WITH (security_barrier=true) AS
SELECT pr.id,pr.matricula,pr.nome FROM public.promotores pr
WHERE attendance_private.staff_can_access(pr.matricula) OR EXISTS(
 SELECT 1 FROM public.profiles p JOIN public.rotas r ON r.industria_codigo=p.industria_codigo
 WHERE p.id=auth.uid() AND p.status='ativo' AND p.role='client_industry' AND r.promotor_matricula=pr.matricula);
REVOKE ALL ON public.industry_promoters FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.industry_promoters TO authenticated;
CREATE VIEW public.industry_visit_photos WITH (security_barrier=true) AS
SELECT ph.id,ph.visit_id,ph.tipo_foto,ph.storage_path,ph.created_at,ph.legenda,to_jsonb(v) AS visit
FROM public.visit_photos ph JOIN public.industry_visits v ON v.id=ph.visit_id;
REVOKE ALL ON public.industry_visit_photos FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.industry_visit_photos TO authenticated;
CREATE POLICY attendance_authorized_photo_storage ON storage.objects FOR SELECT TO authenticated
USING(bucket_id='visit-photos' AND EXISTS(SELECT 1 FROM public.visit_photos ph WHERE ph.storage_path=storage.objects.name AND attendance_private.can_read_visit(ph.visit_id)));

-- Child evidence still uses parent authorisation even when raw visits are hidden.
DROP POLICY IF EXISTS visit_photos_select_policy ON public.visit_photos;
CREATE POLICY visit_photos_select_policy ON public.visit_photos FOR SELECT TO authenticated USING(attendance_private.can_read_visit(visit_id));
DROP POLICY IF EXISTS visit_checklist_items_select_policy ON public.visit_checklist_items;
CREATE POLICY visit_checklist_items_select_policy ON public.visit_checklist_items FOR SELECT TO authenticated USING(attendance_private.can_read_visit(visit_id));
DROP POLICY IF EXISTS visit_occurrences_select_policy ON public.visit_occurrences;
CREATE POLICY visit_occurrences_select_policy ON public.visit_occurrences FOR SELECT TO authenticated USING(attendance_private.can_read_visit(visit_id));
DROP POLICY IF EXISTS visit_product_validity_select_policy ON public.visit_product_validity;
CREATE POLICY visit_product_validity_select_policy ON public.visit_product_validity FOR SELECT TO authenticated USING(attendance_private.can_read_visit(visit_id));

CREATE POLICY attendance_team_records ON public.promoter_attendance_records AS RESTRICTIVE FOR SELECT TO authenticated USING(attendance_private.staff_can_access(promotor_matricula));
CREATE POLICY attendance_team_audit ON public.promoter_attendance_audit_log AS RESTRICTIVE FOR SELECT TO authenticated USING(attendance_private.staff_can_access(promotor_matricula));
CREATE POLICY attendance_team_schedules ON public.promoter_work_schedules AS RESTRICTIVE FOR ALL TO authenticated
USING(attendance_private.staff_can_access(promotor_matricula) OR promotor_matricula=public.get_auth_promotor_matricula())
WITH CHECK(attendance_private.staff_can_access(promotor_matricula));
CREATE POLICY attendance_team_absences ON public.promoter_absences AS RESTRICTIVE FOR ALL TO authenticated
USING(attendance_private.staff_can_access(promotor_matricula) OR promotor_matricula=public.get_auth_promotor_matricula())
WITH CHECK(attendance_private.staff_can_access(promotor_matricula));
-- Also enforce team scope inside the definer override RPC via a trigger.
CREATE FUNCTION attendance_private.guard_override_scope() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF auth.uid() IS NOT NULL AND NOT attendance_private.staff_can_access(NEW.promotor_matricula) THEN RAISE EXCEPTION 'Promoter outside authorised teams' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER attendance_override_scope BEFORE INSERT OR UPDATE ON public.promoter_attendance_records FOR EACH ROW EXECUTE FUNCTION attendance_private.guard_override_scope();
-- Scoped supervisors cannot reassign identities/teams to expand their own access.
CREATE FUNCTION attendance_private.guard_supervisor_assignment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM profiles p JOIN supervisores s ON s.user_id=p.id WHERE p.id=auth.uid() AND p.role='gestor')
 AND (TG_OP='INSERT' OR to_jsonb(NEW)->'equipe' IS DISTINCT FROM to_jsonb(OLD)->'equipe'
 OR to_jsonb(NEW)->'supervisor_id' IS DISTINCT FROM to_jsonb(OLD)->'supervisor_id'
 OR to_jsonb(NEW)->'user_id' IS DISTINCT FROM to_jsonb(OLD)->'user_id') THEN
 RAISE EXCEPTION 'Administrator required to reassign supervisor scope' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_supervisor_assignment BEFORE INSERT OR UPDATE ON public.supervisores FOR EACH ROW EXECUTE FUNCTION attendance_private.guard_supervisor_assignment();
CREATE TRIGGER protect_team_assignment BEFORE INSERT OR UPDATE ON public.equipes FOR EACH ROW EXECUTE FUNCTION attendance_private.guard_supervisor_assignment();
CREATE TRIGGER protect_promoter_assignment BEFORE INSERT OR UPDATE ON public.promotores FOR EACH ROW EXECUTE FUNCTION attendance_private.guard_supervisor_assignment();

-- Versioned journeys: dates supplied by administration, never inferred from visits.
ALTER TABLE public.promoter_work_schedules DROP CONSTRAINT unique_schedule_per_day;
ALTER TABLE public.promoter_work_schedules ADD COLUMN valid_from date, ADD COLUMN valid_to date,
 ADD COLUMN interval_minutes integer CHECK(interval_minutes>=0),
 ADD COLUMN tolerance_minutes integer CHECK(tolerance_minutes>=0),
 ADD COLUMN modalidade text, ADD COLUMN timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
 ADD COLUMN is_exception boolean NOT NULL DEFAULT false,
 ADD COLUMN justification text,
 ADD CONSTRAINT schedule_validity CHECK(valid_to IS NULL OR valid_from IS NULL OR valid_to>=valid_from);
CREATE INDEX attendance_schedule_effective ON public.promoter_work_schedules(promotor_matricula,dia_semana,valid_from,valid_to);
ALTER TABLE public.promoter_absences DROP CONSTRAINT promoter_absences_tipo_check;
ALTER TABLE public.promoter_absences ADD CONSTRAINT promoter_absences_tipo_check CHECK(tipo IN ('folga','ferias','licenca_medica','afastamento','licenca_paternidade','outro','feriado'));

CREATE TABLE public.promoter_journey_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_name text NOT NULL, record_id uuid NOT NULL,
 promotor_matricula text, changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 changed_by uuid REFERENCES auth.users(id), previous_value jsonb, new_value jsonb, justification text NOT NULL
);
ALTER TABLE public.promoter_journey_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.promoter_journey_audit FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.promoter_journey_audit TO authenticated;
CREATE POLICY journey_audit_select ON public.promoter_journey_audit FOR SELECT TO authenticated
USING((attendance_private.staff_can_access(promotor_matricula) OR promotor_matricula IS NULL) AND EXISTS(SELECT 1 FROM profiles WHERE id=auth.uid() AND role IN ('admin','gestor') AND status='ativo'));
CREATE FUNCTION attendance_private.audit_journey() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE reason text;
BEGIN
 reason:=COALESCE(to_jsonb(NEW)->>'justification',to_jsonb(NEW)->>'justificativa','');
 IF auth.uid() IS NOT NULL AND length(trim(reason))<5 THEN RAISE EXCEPTION 'Journey change requires justification'; END IF;
 INSERT INTO promoter_journey_audit(table_name,record_id,promotor_matricula,changed_by,previous_value,new_value,justification)
 VALUES(TG_TABLE_NAME,NEW.id,to_jsonb(NEW)->>'promotor_matricula',auth.uid(),CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,to_jsonb(NEW),reason);
 RETURN NEW;
END $$;
CREATE TRIGGER audit_work_schedule AFTER INSERT OR UPDATE ON public.promoter_work_schedules FOR EACH ROW EXECUTE FUNCTION attendance_private.audit_journey();
CREATE TRIGGER audit_absence AFTER INSERT OR UPDATE ON public.promoter_absences FOR EACH ROW EXECUTE FUNCTION attendance_private.audit_journey();
REVOKE INSERT,UPDATE,DELETE ON public.promoter_work_schedules FROM authenticated;

CREATE FUNCTION public.set_promoter_work_schedule(p_matricula text,p_day text,p_start time,p_end time,p_from date,p_interval integer,p_tolerance integer,p_timezone text,p_modalidade text,p_reason text,p_exception boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result uuid;
BEGIN
 IF NOT attendance_private.staff_can_access(p_matricula) OR NOT EXISTS(SELECT 1 FROM profiles WHERE id=auth.uid() AND status='ativo' AND role IN ('admin','gestor')) THEN RAISE EXCEPTION 'Not authorised' USING ERRCODE='42501'; END IF;
 IF p_from IS NULL OR length(trim(p_reason))<5 OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=p_timezone) THEN RAISE EXCEPTION 'Invalid journey configuration'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_matricula||':'||p_day,0));
 IF EXISTS(SELECT 1 FROM promoter_work_schedules WHERE promotor_matricula=p_matricula AND dia_semana=p_day AND ativo AND is_exception=p_exception AND (CASE WHEN p_exception THEN valid_from=p_from ELSE valid_from>=p_from END)) THEN RAISE EXCEPTION 'Use a later effective date; historical versions cannot be overwritten'; END IF;
 IF p_interval IS NOT NULL AND p_interval>=extract(epoch FROM (CASE WHEN p_end>p_start THEN p_end-p_start ELSE p_end-p_start+interval '24 hours' END))/60 THEN RAISE EXCEPTION 'Break exceeds journey duration'; END IF;
 IF NOT p_exception THEN UPDATE promoter_work_schedules SET valid_to=p_from-1,justification=p_reason WHERE promotor_matricula=p_matricula AND dia_semana=p_day AND ativo AND NOT is_exception AND (valid_to IS NULL OR valid_to>=p_from); END IF;
 INSERT INTO promoter_work_schedules(promotor_matricula,dia_semana,hora_inicio,hora_fim,valid_from,valid_to,interval_minutes,tolerance_minutes,timezone,modalidade,justification,is_exception)
 VALUES(p_matricula,p_day,p_start,p_end,p_from,CASE WHEN p_exception THEN p_from ELSE NULL END,p_interval,p_tolerance,p_timezone,p_modalidade,p_reason,p_exception) RETURNING id INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.set_promoter_work_schedule(text,text,time,time,date,integer,integer,text,text,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_promoter_work_schedule(text,text,time,time,date,integer,integer,text,text,text,boolean) TO authenticated;

CREATE TABLE public.promoter_work_schedule_templates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nome text NOT NULL UNIQUE,
 hora_inicio time NOT NULL,hora_fim time NOT NULL CHECK(hora_fim<>hora_inicio),
 interval_minutes integer CHECK(interval_minutes>=0),tolerance_minutes integer CHECK(tolerance_minutes>=0),
 timezone text NOT NULL,modalidade text,justification text NOT NULL CHECK(length(trim(justification))>=5)
);
CREATE TABLE public.attendance_holidays (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),data date NOT NULL,nome text NOT NULL,uf text,cidade text,
 behavior text NOT NULL CHECK(behavior IN ('follow_schedule','off','work')),
 justification text NOT NULL CHECK(length(trim(justification))>=5),CHECK(cidade IS NULL OR uf IS NOT NULL)
);
CREATE INDEX attendance_holiday_date_location ON public.attendance_holidays(data,uf,cidade);
ALTER TABLE public.promoter_work_schedule_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_holidays ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.promoter_work_schedule_templates,public.attendance_holidays FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.promoter_work_schedule_templates,public.attendance_holidays TO authenticated;
CREATE POLICY template_read ON public.promoter_work_schedule_templates FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM profiles WHERE id=auth.uid() AND status='ativo' AND role IN ('admin','gestor')));
CREATE POLICY template_write ON public.promoter_work_schedule_templates FOR ALL TO authenticated USING(EXISTS(SELECT 1 FROM profiles WHERE id=auth.uid() AND status='ativo' AND role='admin')) WITH CHECK(EXISTS(SELECT 1 FROM profiles WHERE id=auth.uid() AND status='ativo' AND role='admin'));
CREATE POLICY holiday_read ON public.attendance_holidays FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM profiles WHERE id=auth.uid() AND status='ativo' AND role IN ('admin','gestor','operador','promotor')));
CREATE POLICY holiday_write ON public.attendance_holidays FOR ALL TO authenticated USING(EXISTS(SELECT 1 FROM profiles WHERE id=auth.uid() AND status='ativo' AND role='admin')) WITH CHECK(EXISTS(SELECT 1 FROM profiles WHERE id=auth.uid() AND status='ativo' AND role='admin'));
CREATE TRIGGER audit_journey_template AFTER INSERT OR UPDATE ON public.promoter_work_schedule_templates FOR EACH ROW EXECUTE FUNCTION attendance_private.audit_journey();
CREATE TRIGGER audit_holiday AFTER INSERT OR UPDATE ON public.attendance_holidays FOR EACH ROW EXECUTE FUNCTION attendance_private.audit_journey();
CREATE FUNCTION public.set_attendance_rules(p_timezone text,p_close time,p_tolerance integer,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE old_value jsonb; new_value jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM profiles WHERE id=auth.uid() AND role='admin' AND status='ativo') THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
 IF length(trim(p_reason))<5 OR p_reason IS NULL OR p_tolerance<0 OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=p_timezone) THEN RAISE EXCEPTION 'Invalid attendance rules'; END IF;
 SELECT value INTO old_value FROM system_settings WHERE key='attendance_rules' FOR UPDATE;
 new_value:=jsonb_build_object('timezone',p_timezone,'day_close_time',CASE WHEN p_close IS NOT NULL THEN to_char(p_close,'HH24:MI') ELSE NULL END,'late_tolerance_minutes',p_tolerance);
 UPDATE system_settings SET value=new_value,updated_at=clock_timestamp(),updated_by=auth.uid() WHERE key='attendance_rules';
 INSERT INTO promoter_journey_audit(table_name,record_id,changed_by,previous_value,new_value,justification)
 VALUES('system_settings',gen_random_uuid(),auth.uid(),old_value,new_value,p_reason);
 RETURN jsonb_build_object('success',true);
END $$;
REVOKE ALL ON FUNCTION public.set_attendance_rules(text,time,integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_attendance_rules(text,time,integer,text) TO authenticated;

-- Existing latitude/longitude always describe check-in. Checkout has its own fields.
ALTER TABLE public.visits ADD COLUMN gps_accuracy_meters numeric CHECK(gps_accuracy_meters>=0),
 ADD COLUMN checkout_latitude numeric CHECK(checkout_latitude BETWEEN -90 AND 90),
 ADD COLUMN checkout_longitude numeric CHECK(checkout_longitude BETWEEN -180 AND 180),
 ADD COLUMN checkout_accuracy_meters numeric CHECK(checkout_accuracy_meters>=0),
 ADD COLUMN work_schedule_id uuid REFERENCES public.promoter_work_schedules(id);
CREATE FUNCTION attendance_private.preserve_visit_telemetry() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN
   IF OLD.started_at IS NOT NULL THEN RAISE EXCEPTION 'Recorded visits cannot be deleted' USING ERRCODE='42501'; END IF;
   RETURN OLD;
 END IF;
 IF auth.uid() IS NOT NULL THEN
   IF TG_OP='INSERT' OR OLD.started_at IS NULL THEN
     IF NEW.started_at IS NOT NULL THEN NEW.started_at:=clock_timestamp(); END IF;
   END IF;
   IF TG_OP='INSERT' OR OLD.completed_at IS NULL THEN
     IF NEW.completed_at IS NOT NULL THEN NEW.completed_at:=clock_timestamp(); END IF;
   END IF;
 END IF;
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
CREATE TRIGGER preserve_visit_telemetry BEFORE INSERT OR UPDATE OR DELETE ON public.visits FOR EACH ROW EXECUTE FUNCTION attendance_private.preserve_visit_telemetry();
-- Keep the legacy integrity guard, allowing only the previously missing first start.
CREATE OR REPLACE FUNCTION public.check_visit_promotor_update_integrity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF auth.uid() IS NULL AND session_user IN ('postgres','supabase_admin') THEN RETURN NEW; END IF;
 IF public.is_admin_or_gestor() THEN RETURN NEW; END IF;
 IF OLD.promotor_matricula IS DISTINCT FROM public.get_auth_promotor_matricula() OR public.get_auth_promotor_matricula() IS NULL THEN RAISE EXCEPTION 'Visit not owned by authenticated promoter' USING ERRCODE='42501'; END IF;
 IF (NEW.promotor_matricula,NEW.loja_codigo,NEW.industria_codigo,NEW.rota_id,NEW.data_visita) IS DISTINCT FROM (OLD.promotor_matricula,OLD.loja_codigo,OLD.industria_codigo,OLD.rota_id,OLD.data_visita) THEN RAISE EXCEPTION 'Visit identity is immutable' USING ERRCODE='42501'; END IF;
 IF OLD.started_at IS NOT NULL AND NEW.started_at IS DISTINCT FROM OLD.started_at THEN RAISE EXCEPTION 'Check-in is immutable' USING ERRCODE='42501'; END IF;
 IF OLD.status IN ('concluida','nao_realizada') THEN RAISE EXCEPTION 'Closed visits cannot be changed by promoter' USING ERRCODE='42501'; END IF;
 IF NEW.status IS DISTINCT FROM OLD.status AND NOT ((OLD.status='pendente' AND NEW.status='em_andamento' AND OLD.started_at IS NULL) OR (OLD.status='em_andamento' AND NEW.status='concluida')) THEN RAISE EXCEPTION 'Invalid visit transition'; END IF;
 IF NEW.status='concluida' AND (NEW.completed_at IS NULL OR NEW.started_at IS NULL OR NEW.completed_at<NEW.started_at) THEN RAISE EXCEPTION 'Invalid checkout sequence'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.check_visit_promotor_update_integrity() FROM PUBLIC,anon;

CREATE FUNCTION public.attendance_check_in(p_store text,p_industry text,p_route uuid DEFAULT NULL,p_lat numeric DEFAULT NULL,p_lng numeric DEFAULT NULL,p_accuracy numeric DEFAULT NULL)
RETURNS public.visits LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE matricula text; result visits; schedule promoter_work_schedules; operational_date date;
BEGIN
 SELECT p.promotor_matricula INTO matricula FROM profiles p WHERE p.id=auth.uid() AND p.role='promotor' AND p.status='ativo';
 IF matricula IS NULL THEN RAISE EXCEPTION 'Promoter identity required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM rotas WHERE promotor_matricula=matricula AND loja_codigo=p_store AND industria_codigo=p_industry) THEN RAISE EXCEPTION 'Store outside promoter assignment' USING ERRCODE='42501'; END IF;
 IF (SELECT value #>> '{}' FROM system_settings WHERE key='operation_mode')='IMPLANTACAO' AND NOT public.is_promotor_authorized(matricula) THEN RAISE EXCEPTION 'Promoter not released for operation' USING ERRCODE='42501'; END IF;
 IF (p_lat IS NULL) <> (p_lng IS NULL) OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 OR p_accuracy<0 OR p_accuracy='NaN'::numeric THEN RAISE EXCEPTION 'Invalid GPS'; END IF;
 operational_date:=(clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date;
 SELECT s.* INTO schedule FROM promoter_work_schedules s
 CROSS JOIN LATERAL(SELECT (clock_timestamp() AT TIME ZONE s.timezone)::date - CASE WHEN s.hora_fim<s.hora_inicio AND (clock_timestamp() AT TIME ZONE s.timezone)::time<s.hora_fim THEN 1 ELSE 0 END AS d) local_day
 WHERE s.promotor_matricula=matricula AND s.ativo
 AND (s.valid_from IS NULL OR s.valid_from<=local_day.d) AND (s.valid_to IS NULL OR s.valid_to>=local_day.d)
 AND s.dia_semana=(ARRAY['domingo','segunda','terca','quarta','quinta','sexta','sabado'])[extract(dow from local_day.d)::int+1]
 ORDER BY s.is_exception DESC,s.valid_from DESC NULLS LAST LIMIT 1;
 IF schedule.id IS NOT NULL THEN operational_date:=(clock_timestamp() AT TIME ZONE schedule.timezone)::date - CASE WHEN schedule.hora_fim<schedule.hora_inicio AND (clock_timestamp() AT TIME ZONE schedule.timezone)::time<schedule.hora_fim THEN 1 ELSE 0 END; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(matricula,1));
 SELECT * INTO result FROM visits WHERE promotor_matricula=matricula AND loja_codigo=p_store AND industria_codigo=p_industry AND data_visita=operational_date;
 IF FOUND AND result.started_at IS NOT NULL THEN RETURN result; END IF;
 IF EXISTS(SELECT 1 FROM visits WHERE promotor_matricula=matricula AND status='em_andamento' AND id IS DISTINCT FROM result.id) THEN RAISE EXCEPTION 'Another visit is in progress'; END IF;
 IF p_route IS NOT NULL AND NOT EXISTS(SELECT 1 FROM rotas WHERE id=p_route AND promotor_matricula=matricula AND loja_codigo=p_store AND industria_codigo=p_industry) THEN RAISE EXCEPTION 'Invalid route'; END IF;
 INSERT INTO visits(promotor_matricula,loja_codigo,industria_codigo,data_visita,rota_id,started_at,latitude,longitude,gps_accuracy_meters,status,work_schedule_id)
 VALUES(matricula,p_store,p_industry,operational_date,p_route,clock_timestamp(),p_lat,p_lng,p_accuracy,'em_andamento',schedule.id)
 ON CONFLICT(promotor_matricula,loja_codigo,industria_codigo,data_visita) DO UPDATE
 SET started_at=EXCLUDED.started_at,latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,gps_accuracy_meters=EXCLUDED.gps_accuracy_meters,status=EXCLUDED.status,work_schedule_id=EXCLUDED.work_schedule_id
 RETURNING * INTO result;
 RETURN result;
END $$;
CREATE FUNCTION public.attendance_check_out(p_visit uuid,p_lat numeric DEFAULT NULL,p_lng numeric DEFAULT NULL,p_accuracy numeric DEFAULT NULL,p_observation text DEFAULT NULL)
RETURNS public.visits LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result visits;
BEGIN
 SELECT v.* INTO result FROM visits v JOIN profiles p ON p.id=auth.uid() WHERE v.id=p_visit AND p.role='promotor' AND p.status='ativo' AND p.promotor_matricula=v.promotor_matricula FOR UPDATE OF v;
 IF NOT FOUND THEN RAISE EXCEPTION 'Visit not authorised' USING ERRCODE='42501'; END IF;
 IF result.completed_at IS NOT NULL THEN RETURN result; END IF;
 IF result.started_at IS NULL OR result.status<>'em_andamento' THEN RAISE EXCEPTION 'Visit has no active check-in'; END IF;
 IF (p_lat IS NULL) <> (p_lng IS NULL) OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 OR p_accuracy<0 OR p_accuracy='NaN'::numeric THEN RAISE EXCEPTION 'Invalid GPS'; END IF;
 UPDATE visits SET completed_at=clock_timestamp(),status='concluida',checkout_latitude=p_lat,checkout_longitude=p_lng,checkout_accuracy_meters=p_accuracy,observacao_geral=p_observation,updated_at=clock_timestamp() WHERE id=p_visit RETURNING * INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.attendance_check_in(text,text,uuid,numeric,numeric,numeric),public.attendance_check_out(uuid,numeric,numeric,numeric,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.attendance_check_in(text,text,uuid,numeric,numeric,numeric),public.attendance_check_out(uuid,numeric,numeric,numeric,text) TO authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA attendance_private FROM PUBLIC,anon;
NOTIFY pgrst,'reload schema';
COMMIT;
