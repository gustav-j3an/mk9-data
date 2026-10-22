-- Synthetic, schema-only reproduction built from PostgreSQL catalog metadata
-- for project xzmbesqhxcnuokjwrbnw. No production rows or secrets are included.
-- PostgreSQL image used: Supabase postgres 17.11.0.004.

CREATE SCHEMA IF NOT EXISTS attendance_private;
CREATE SCHEMA IF NOT EXISTS auth AUTHORIZATION supabase_auth_admin;
GRANT USAGE ON SCHEMA public, attendance_private, auth TO authenticated;
-- The standalone DB is created from template0; reproduce only the auth.users
-- key contract used by foreign keys (no auth data) and the exact remote auth.uid.
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text UNIQUE);
ALTER TABLE auth.users OWNER TO supabase_auth_admin;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
ALTER FUNCTION auth.uid() OWNER TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

CREATE TABLE public.promotores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), matricula text NOT NULL UNIQUE, nome text NOT NULL,
  cpf text, telefone text, email text, cidade text NOT NULL, uf text NOT NULL,
  supervisor text, equipe text, status text DEFAULT 'ativo' CHECK (status IN ('ativo','inativo','ferias','afastado')),
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.supervisores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), codigo text NOT NULL UNIQUE, nome text NOT NULL,
  email text UNIQUE, telefone text, regional text, status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','inativo','ferias','afastado')),
  user_id uuid REFERENCES auth.users(id), created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.equipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), codigo text NOT NULL UNIQUE, nome text NOT NULL UNIQUE,
  regional text, supervisor_nome text, status text NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa','reestruturacao','arquivada')),
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  supervisor_id uuid REFERENCES public.supervisores(id) ON DELETE SET NULL
);
CREATE TABLE public.industrias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), codigo text NOT NULL UNIQUE, nome text NOT NULL,
  cnpj text, status text DEFAULT 'ativo' CHECK (status IN ('ativo','inativo')), observacao text,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE, email text NOT NULL, name text NOT NULL,
  role text NOT NULL DEFAULT 'operador' CHECK (role IN ('admin','gestor','operador','promotor','client_industry')),
  department text DEFAULT 'Operações MK9', avatar_url text,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  promotor_matricula text REFERENCES public.promotores(matricula) ON UPDATE CASCADE ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','inativo')),
  industria_codigo text REFERENCES public.industrias(codigo) ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE TABLE public.lojas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), codigo text NOT NULL UNIQUE, nome text NOT NULL,
  cnpj text, cidade text NOT NULL, uf text NOT NULL, endereco text, rede text,
  status text DEFAULT 'ativo' CHECK (status IN ('ativo','inativo')), created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.system_settings (
  key text PRIMARY KEY, value jsonb NOT NULL, description text,
  updated_at timestamptz DEFAULT now(), updated_by uuid REFERENCES auth.users(id),
  CONSTRAINT system_settings_valid_keys CHECK (key IN ('operation_mode','official_start_date','attendance_rules'))
);
CREATE TABLE public.promoter_operation_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), promotor_matricula text NOT NULL,
  status text NOT NULL DEFAULT 'liberado' CHECK (status IN ('liberado','bloqueado')), authorized_at timestamptz NOT NULL DEFAULT now(),
  authorized_by uuid REFERENCES public.profiles(id) ON UPDATE CASCADE ON DELETE SET NULL, authorized_by_name text, authorized_by_email text, justification text NOT NULL,
  revoked_at timestamptz, revoked_by uuid REFERENCES public.profiles(id) ON UPDATE CASCADE ON DELETE SET NULL, revoked_by_name text, revoked_by_email text,
  revocation_reason text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  CONSTRAINT promoter_authorizations_matricula_unique UNIQUE(promotor_matricula),
  FOREIGN KEY (promotor_matricula) REFERENCES public.promotores(matricula) ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE TABLE public.promoter_work_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), promotor_matricula text NOT NULL REFERENCES public.promotores(matricula) ON UPDATE CASCADE ON DELETE CASCADE,
  dia_semana text NOT NULL CHECK (dia_semana IN ('segunda','terca','quarta','quinta','sexta','sabado','domingo')),
  hora_inicio time NOT NULL, hora_fim time NOT NULL,
  observacao text, ativo boolean DEFAULT true, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  valid_from date, valid_to date, interval_minutes integer CHECK (interval_minutes >= 0),
  tolerance_minutes integer CHECK (tolerance_minutes >= 0), modalidade text,
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo', is_exception boolean NOT NULL DEFAULT false,
  justification text, work_uf text, work_city text,
  CONSTRAINT schedule_time_range CHECK (hora_fim <> hora_inicio),
  CONSTRAINT schedule_validity CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
  CONSTRAINT journey_work_location CHECK ((work_uf IS NULL OR work_uf ~ '^[A-Z]{2}$') AND (work_city IS NULL OR work_uf IS NOT NULL))
);
CREATE TABLE public.rotas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), codigo_rota text NOT NULL, data date,
  promotor_matricula text NOT NULL REFERENCES public.promotores(matricula) ON UPDATE CASCADE ON DELETE CASCADE,
  loja_codigo text NOT NULL REFERENCES public.lojas(codigo) ON UPDATE CASCADE ON DELETE CASCADE,
  industria_codigo text NOT NULL REFERENCES public.industrias(codigo) ON UPDATE CASCADE ON DELETE CASCADE,
  sequencia integer DEFAULT 1, observacao text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  segunda boolean NOT NULL DEFAULT false, terca boolean NOT NULL DEFAULT false, quarta boolean NOT NULL DEFAULT false,
  quinta boolean NOT NULL DEFAULT false, sexta boolean NOT NULL DEFAULT false, sabado boolean NOT NULL DEFAULT false,
  domingo boolean NOT NULL DEFAULT false, frequencia text NOT NULL DEFAULT 'SEMANAL' CHECK (frequencia IN ('SEMANAL','QUINZENAL')),
  uf text NOT NULL DEFAULT '', CONSTRAINT unique_rota_item UNIQUE(codigo_rota,data,promotor_matricula,loja_codigo,industria_codigo)
);
CREATE TABLE public.visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rota_id uuid REFERENCES public.rotas(id) ON DELETE SET NULL,
  promotor_matricula text NOT NULL REFERENCES public.promotores(matricula) ON UPDATE CASCADE ON DELETE CASCADE,
  loja_codigo text NOT NULL REFERENCES public.lojas(codigo) ON UPDATE CASCADE ON DELETE CASCADE,
  industria_codigo text NOT NULL REFERENCES public.industrias(codigo) ON UPDATE CASCADE ON DELETE CASCADE,
  data_visita date NOT NULL DEFAULT CURRENT_DATE, started_at timestamptz, completed_at timestamptz,
  latitude numeric(10,7), longitude numeric(10,7), status text NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente','em_andamento','concluida','nao_realizada')),
  motivo_nao_realizada text, observacao_geral text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  gps_accuracy_meters numeric CHECK (gps_accuracy_meters >= 0), checkout_latitude numeric CHECK (checkout_latitude BETWEEN -90 AND 90),
  checkout_longitude numeric CHECK (checkout_longitude BETWEEN -180 AND 180), checkout_accuracy_meters numeric CHECK (checkout_accuracy_meters >= 0),
  work_schedule_id uuid REFERENCES public.promoter_work_schedules(id),
  CONSTRAINT visits_promotor_loja_industria_data_unique UNIQUE(promotor_matricula,loja_codigo,industria_codigo,data_visita)
);
CREATE TABLE public.visit_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), visit_id uuid NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
  tipo_foto text NOT NULL CHECK (tipo_foto IN ('fachada','gondola','preco','ponto_extra','ruptura','outros')),
  storage_path text NOT NULL, file_url text NOT NULL, legenda text, created_at timestamptz DEFAULT now()
);
CREATE TABLE public.visit_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), visit_id uuid NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
  item_key text NOT NULL, item_label text NOT NULL, checked boolean DEFAULT false, valor_texto text,
  observacao text, created_at timestamptz DEFAULT now()
);
CREATE TABLE public.visit_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), visit_id uuid NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('ruptura','preco_divergente','falta_espaco','outro')),
  descricao text NOT NULL, resolvido boolean DEFAULT false, created_at timestamptz DEFAULT now()
);
CREATE TABLE public.visit_product_validity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), visit_id uuid NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
  produto_nome text NOT NULL, quantidade integer NOT NULL DEFAULT 1 CHECK (quantidade > 0),
  data_vencimento date NOT NULL, lote text, observacao text, created_at timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.is_admin_or_gestor() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role IN ('admin','gestor'))
$$;
CREATE OR REPLACE FUNCTION public.get_auth_promotor_matricula() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT promotor_matricula FROM public.profiles WHERE id=auth.uid()
$$;
CREATE OR REPLACE FUNCTION public.get_auth_industria_codigo() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT industria_codigo FROM public.profiles WHERE id=auth.uid()
$$;
CREATE OR REPLACE FUNCTION public.is_promotor_authorized(p_matricula text) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_mode text; v_is_auth boolean;
BEGIN
  IF p_matricula IS NULL OR trim(p_matricula)='' THEN RETURN false; END IF;
  SELECT value INTO v_mode FROM public.system_settings WHERE key='operation_mode';
  IF v_mode='OPERACAO_OFICIAL' THEN RETURN true; END IF;
  SELECT EXISTS(SELECT 1 FROM public.promoter_operation_authorizations WHERE promotor_matricula=p_matricula AND status='liberado') INTO v_is_auth;
  RETURN coalesce(v_is_auth,false);
END $$;
CREATE OR REPLACE FUNCTION attendance_private.staff_can_access(matricula text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.status='ativo' AND (
   p.role IN ('admin','operador') OR (p.role='gestor' AND (
     NOT EXISTS (SELECT 1 FROM public.supervisores s WHERE s.user_id=p.id)
     OR EXISTS (SELECT 1 FROM public.supervisores s JOIN public.equipes e ON e.supervisor_id=s.id
       JOIN public.promotores pr ON (lower(trim(pr.equipe))=lower(trim(e.nome)) OR pr.equipe=e.codigo)
       WHERE s.user_id=p.id AND s.status='ativo' AND e.status='ativa' AND pr.matricula=staff_can_access.matricula)
   ))))
$$;
CREATE OR REPLACE FUNCTION attendance_private.can_read_visit(visit_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.visits v JOIN public.profiles p ON p.id=auth.uid() WHERE v.id=visit_id AND p.status='ativo' AND (
   attendance_private.staff_can_access(v.promotor_matricula) OR (p.role='promotor' AND p.promotor_matricula=v.promotor_matricula)
   OR (p.role='client_industry' AND p.industria_codigo=v.industria_codigo)))
$$;
CREATE OR REPLACE FUNCTION attendance_private.photo_upload_allowed(object_name text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.visits v JOIN public.profiles p ON p.id=auth.uid() WHERE p.status='ativo'
   AND object_name ~ '^visits/[0-9a-fA-F-]{36}/[^/]+$' AND split_part(object_name,'/',2)=v.id::text AND (
     (p.role='promotor' AND p.promotor_matricula=v.promotor_matricula AND v.status='em_andamento')
     OR (p.role IN ('admin','gestor') AND attendance_private.staff_can_access(v.promotor_matricula))))
$$;
CREATE OR REPLACE FUNCTION public.check_visit_promotor_update_integrity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
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
CREATE OR REPLACE FUNCTION attendance_private.preserve_visit_telemetry() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN IF OLD.started_at IS NOT NULL THEN RAISE EXCEPTION 'Recorded visits cannot be deleted' USING ERRCODE='42501'; END IF; RETURN OLD; END IF;
 IF current_user='authenticated' THEN
   IF (TG_OP='INSERT' OR OLD.started_at IS NULL) AND NEW.started_at IS NOT NULL THEN RAISE EXCEPTION 'Use authenticated check-in RPC' USING ERRCODE='42501'; END IF;
   IF (TG_OP='INSERT' OR OLD.completed_at IS NULL) AND NEW.completed_at IS NOT NULL THEN RAISE EXCEPTION 'Use authenticated checkout RPC' USING ERRCODE='42501'; END IF;
 END IF;
 IF auth.uid() IS NOT NULL THEN
   IF (TG_OP='INSERT' OR OLD.started_at IS NULL) AND NEW.started_at IS NOT NULL THEN NEW.started_at:=clock_timestamp(); END IF;
   IF (TG_OP='INSERT' OR OLD.completed_at IS NULL) AND NEW.completed_at IS NOT NULL THEN NEW.completed_at:=clock_timestamp(); END IF;
 END IF;
 IF NEW.gps_accuracy_meters IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) OR NEW.checkout_accuracy_meters IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) THEN RAISE EXCEPTION 'Invalid GPS accuracy'; END IF;
 IF TG_OP='UPDATE' AND OLD.started_at IS NOT NULL AND (NEW.started_at,NEW.latitude,NEW.longitude,NEW.gps_accuracy_meters,NEW.promotor_matricula,NEW.data_visita,NEW.loja_codigo,NEW.industria_codigo,NEW.work_schedule_id) IS DISTINCT FROM (OLD.started_at,OLD.latitude,OLD.longitude,OLD.gps_accuracy_meters,OLD.promotor_matricula,OLD.data_visita,OLD.loja_codigo,OLD.industria_codigo,OLD.work_schedule_id) THEN RAISE EXCEPTION 'Original check-in telemetry is immutable' USING ERRCODE='42501'; END IF;
 IF TG_OP='UPDATE' AND OLD.completed_at IS NOT NULL AND (NEW.completed_at,NEW.checkout_latitude,NEW.checkout_longitude,NEW.checkout_accuracy_meters) IS DISTINCT FROM (OLD.completed_at,OLD.checkout_latitude,OLD.checkout_longitude,OLD.checkout_accuracy_meters) THEN RAISE EXCEPTION 'Original checkout telemetry is immutable' USING ERRCODE='42501'; END IF;
 IF NEW.completed_at IS NOT NULL AND (NEW.started_at IS NULL OR NEW.completed_at<NEW.started_at) THEN RAISE EXCEPTION 'Invalid checkout sequence'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER preserve_visit_telemetry BEFORE INSERT OR DELETE OR UPDATE ON public.visits FOR EACH ROW EXECUTE FUNCTION attendance_private.preserve_visit_telemetry();

ALTER TABLE public.visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visit_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visit_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visit_occurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visit_product_validity ENABLE ROW LEVEL SECURITY;
CREATE POLICY visits_select_policy ON public.visits FOR SELECT TO authenticated USING (public.is_admin_or_gestor() OR (SELECT role FROM public.profiles WHERE id=auth.uid())='operador' OR promotor_matricula=public.get_auth_promotor_matricula() OR industria_codigo=public.get_auth_industria_codigo());
CREATE POLICY visits_insert_policy ON public.visits FOR INSERT TO authenticated WITH CHECK (public.is_admin_or_gestor() OR promotor_matricula=public.get_auth_promotor_matricula());
CREATE POLICY visits_update_policy ON public.visits FOR UPDATE TO authenticated USING (public.is_admin_or_gestor() OR promotor_matricula=public.get_auth_promotor_matricula()) WITH CHECK (public.is_admin_or_gestor() OR promotor_matricula=public.get_auth_promotor_matricula());
CREATE POLICY visits_delete_policy ON public.visits FOR DELETE TO authenticated USING (public.is_admin_or_gestor());
CREATE POLICY visits_sensitive_scope ON public.visits AS RESTRICTIVE FOR ALL TO authenticated USING (EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.status='ativo' AND (attendance_private.staff_can_access(visits.promotor_matricula) OR (p.role='promotor' AND p.promotor_matricula=visits.promotor_matricula)))) WITH CHECK (EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.status='ativo' AND (attendance_private.staff_can_access(visits.promotor_matricula) OR (p.role='promotor' AND p.promotor_matricula=visits.promotor_matricula))));
CREATE POLICY rotas_select_policy ON public.rotas FOR SELECT TO authenticated USING (public.is_admin_or_gestor() OR (SELECT role FROM public.profiles WHERE id=auth.uid())='operador' OR promotor_matricula=public.get_auth_promotor_matricula() OR industria_codigo=public.get_auth_industria_codigo());
CREATE POLICY rotas_write_policy ON public.rotas FOR ALL TO authenticated USING (public.is_admin_or_gestor()) WITH CHECK (public.is_admin_or_gestor());
CREATE POLICY route_team_scope ON public.rotas AS RESTRICTIVE FOR ALL TO authenticated USING (attendance_private.staff_can_access(promotor_matricula) OR EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.status='ativo' AND ((p.role='promotor' AND p.promotor_matricula=rotas.promotor_matricula) OR (p.role='client_industry' AND p.industria_codigo=rotas.industria_codigo)))) WITH CHECK (attendance_private.staff_can_access(promotor_matricula));
CREATE POLICY visit_photos_select_policy ON public.visit_photos FOR SELECT TO authenticated USING (attendance_private.can_read_visit(visit_id));
CREATE POLICY visit_photos_write_policy ON public.visit_photos FOR ALL TO authenticated USING (EXISTS(SELECT 1 FROM public.visits v WHERE v.id=visit_id AND (public.is_admin_or_gestor() OR v.promotor_matricula=public.get_auth_promotor_matricula()))) WITH CHECK (EXISTS(SELECT 1 FROM public.visits v WHERE v.id=visit_id AND (public.is_admin_or_gestor() OR v.promotor_matricula=public.get_auth_promotor_matricula())));
CREATE POLICY attendance_photo_metadata_read ON public.visit_photos AS RESTRICTIVE FOR SELECT TO authenticated USING (attendance_private.can_read_visit(visit_id));
CREATE POLICY attendance_photo_metadata_insert ON public.visit_photos AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (split_part(storage_path,'/',2)=visit_id::text AND attendance_private.photo_upload_allowed(storage_path));
CREATE POLICY attendance_photo_metadata_update ON public.visit_photos AS RESTRICTIVE FOR UPDATE TO authenticated USING (attendance_private.photo_upload_allowed(storage_path)) WITH CHECK (split_part(storage_path,'/',2)=visit_id::text AND attendance_private.photo_upload_allowed(storage_path));
CREATE POLICY attendance_photo_metadata_delete ON public.visit_photos AS RESTRICTIVE FOR DELETE TO authenticated USING (attendance_private.photo_upload_allowed(storage_path));
CREATE POLICY visit_checklist_items_select_policy ON public.visit_checklist_items FOR SELECT TO authenticated USING (attendance_private.can_read_visit(visit_id));
CREATE POLICY visit_checklist_items_write_policy ON public.visit_checklist_items FOR ALL TO authenticated USING (EXISTS(SELECT 1 FROM public.visits v WHERE v.id=visit_id AND (public.is_admin_or_gestor() OR v.promotor_matricula=public.get_auth_promotor_matricula()))) WITH CHECK (EXISTS(SELECT 1 FROM public.visits v WHERE v.id=visit_id AND (public.is_admin_or_gestor() OR v.promotor_matricula=public.get_auth_promotor_matricula())));
CREATE POLICY visit_occurrences_select_policy ON public.visit_occurrences FOR SELECT TO authenticated USING (attendance_private.can_read_visit(visit_id));
CREATE POLICY visit_occurrences_write_policy ON public.visit_occurrences FOR ALL TO authenticated USING (EXISTS(SELECT 1 FROM public.visits v WHERE v.id=visit_id AND (public.is_admin_or_gestor() OR v.promotor_matricula=public.get_auth_promotor_matricula()))) WITH CHECK (EXISTS(SELECT 1 FROM public.visits v WHERE v.id=visit_id AND (public.is_admin_or_gestor() OR v.promotor_matricula=public.get_auth_promotor_matricula())));
CREATE POLICY visit_product_validity_select_policy ON public.visit_product_validity FOR SELECT TO authenticated USING (attendance_private.can_read_visit(visit_id));
CREATE POLICY visit_product_validity_write_policy ON public.visit_product_validity FOR ALL TO authenticated USING (EXISTS(SELECT 1 FROM public.visits v WHERE v.id=visit_id AND (public.is_admin_or_gestor() OR v.promotor_matricula=public.get_auth_promotor_matricula()))) WITH CHECK (EXISTS(SELECT 1 FROM public.visits v WHERE v.id=visit_id AND (public.is_admin_or_gestor() OR v.promotor_matricula=public.get_auth_promotor_matricula())));

GRANT SELECT,INSERT,UPDATE,DELETE ON public.visits,public.rotas,public.visit_photos,public.visit_checklist_items,public.visit_occurrences,public.visit_product_validity TO anon,authenticated,service_role;
GRANT SELECT ON public.profiles,public.promotores,public.supervisores,public.equipes,public.industrias,public.lojas,public.system_settings,public.promoter_work_schedules,public.promoter_operation_authorizations TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin_or_gestor(),public.get_auth_promotor_matricula(),public.get_auth_industria_codigo(),public.is_promotor_authorized(text) TO authenticated;
GRANT EXECUTE ON FUNCTION attendance_private.staff_can_access(text),attendance_private.can_read_visit(uuid),attendance_private.photo_upload_allowed(text) TO authenticated;

-- Exact current remote RPC definitions are captured separately in the fixture
-- load script because their catalog text is versioned there for review.
