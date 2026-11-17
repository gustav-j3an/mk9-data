-- ==============================================================================
-- FIXTURE DE PREPARAÇÃO PARA TESTES ISOLADOS (RC1.25)
-- Arquivo: scripts/rc1-25-test-fixture.sql
-- ==============================================================================

-- 1. Extensões e Roles
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Schema auth e permissões para postgres
-- No Supabase CLI (PostgreSQL 17), o schema auth, auth.users e auth.uid() já existem nativamente
-- e pertencem a supabase_admin / supabase_auth_admin. A role postgres precisa apenas de USAGE e privilégios DML.
DO $$
BEGIN
  BEGIN
    EXECUTE 'GRANT USAGE ON SCHEMA auth TO postgres';
    EXECUTE 'GRANT ALL ON TABLE auth.users TO postgres';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END $$;

-- 3. Tabelas fundamentais da aplicação no schema public
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT,
  email TEXT,
  role TEXT DEFAULT 'promotor',
  status TEXT DEFAULT 'ativo',
  promotor_matricula TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.promotores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  matricula TEXT UNIQUE NOT NULL,
  nome TEXT,
  cpf TEXT,
  telefone TEXT,
  cidade TEXT DEFAULT 'São Paulo',
  uf TEXT DEFAULT 'SP',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.industrias (
  codigo TEXT PRIMARY KEY,
  nome TEXT,
  ativo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.lojas (
  codigo TEXT PRIMARY KEY,
  nome TEXT,
  ativo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.promoter_work_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promotor_matricula TEXT REFERENCES public.promotores(matricula),
  dia_semana TEXT,
  hora_inicio TIME,
  hora_fim TIME,
  timezone TEXT DEFAULT 'America/Sao_Paulo',
  ativo BOOLEAN DEFAULT true,
  is_exception BOOLEAN DEFAULT false,
  valid_from DATE,
  valid_to DATE
);

CREATE TABLE IF NOT EXISTS public.rotas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loja_codigo TEXT REFERENCES public.lojas(codigo),
  industria_codigo TEXT REFERENCES public.industrias(codigo),
  promotor_matricula TEXT REFERENCES public.promotores(matricula),
  frequencia TEXT,
  segunda BOOLEAN DEFAULT true,
  terca BOOLEAN DEFAULT true,
  quarta BOOLEAN DEFAULT true,
  quinta BOOLEAN DEFAULT true,
  sexta BOOLEAN DEFAULT true,
  sabado BOOLEAN DEFAULT false,
  domingo BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promotor_matricula TEXT REFERENCES public.promotores(matricula),
  loja_codigo TEXT REFERENCES public.lojas(codigo),
  industria_codigo TEXT REFERENCES public.industrias(codigo),
  data_visita DATE NOT NULL DEFAULT CURRENT_DATE,
  rota_id UUID,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pendente',
  observacao_geral TEXT,
  latitude NUMERIC,
  longitude NUMERIC,
  checkout_latitude NUMERIC,
  checkout_longitude NUMERIC,
  gps_accuracy_meters NUMERIC,
  checkout_accuracy_meters NUMERIC,
  work_schedule_id UUID,
  regularization_status TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Campos presentes no schema de homologação após M37/M38 e usados pelos guards.
ALTER TABLE public.visits ADD COLUMN IF NOT EXISTS scheduled_date DATE;
ALTER TABLE public.visits ADD COLUMN IF NOT EXISTS motivo_nao_realizada TEXT;
ALTER TABLE public.visits ADD COLUMN IF NOT EXISTS attempt_number SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE public.visits ADD COLUMN IF NOT EXISTS occurrence_root_visit_id UUID;

CREATE TABLE IF NOT EXISTS public.visit_checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  item_label TEXT,
  valor_texto TEXT,
  observacao TEXT,
  checked BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_visit_checklist_item UNIQUE (visit_id, item_key)
);

CREATE TABLE IF NOT EXISTS public.visit_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
  photo_url TEXT,
  categoria TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.visit_occurrences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
  tipo TEXT,
  descricao TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.visit_product_validity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
  produto_nome TEXT,
  data_validade DATE,
  quantidade INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visit_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visit_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visit_occurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visit_product_validity ENABLE ROW LEVEL SECURITY;

-- 6. Funções utilitárias de RBAC
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND status = 'ativo'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin_or_gestor()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('admin', 'gestor') AND status = 'ativo'
  );
$$;

CREATE OR REPLACE FUNCTION public.get_auth_promotor_matricula()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT promotor_matricula FROM public.profiles
  WHERE id = auth.uid() AND status = 'ativo' LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_auth_industria_codigo()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT NULL::TEXT;
$$;

-- 7. Schema attendance_private
CREATE SCHEMA IF NOT EXISTS attendance_private;

CREATE TABLE IF NOT EXISTS attendance_private.scheduled_recovery_authorizations (
  visit_id UUID PRIMARY KEY REFERENCES public.visits(id) ON DELETE CASCADE,
  promotor_matricula TEXT NOT NULL,
  data_visita DATE NOT NULL,
  scheduled_date DATE NOT NULL,
  authorized_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE attendance_private.scheduled_recovery_authorizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON attendance_private.scheduled_recovery_authorizations FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS attendance_private.visit_lifecycle_authorizations (
  visit_id UUID PRIMARY KEY REFERENCES public.visits(id) ON DELETE CASCADE,
  promotor_matricula TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('promoter_cancelled', 'auto_closed_at_day_end')),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('promoter', 'system')),
  actor_id UUID,
  reason TEXT NOT NULL,
  authorized_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK ((actor_type = 'promoter' AND actor_id IS NOT NULL AND action = 'promoter_cancelled')
      OR (actor_type = 'system' AND actor_id IS NULL AND action = 'auto_closed_at_day_end'))
);
ALTER TABLE attendance_private.visit_lifecycle_authorizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON attendance_private.visit_lifecycle_authorizations FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION attendance_private.is_visit_in_current_operational_day(p_visit_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.visits
    WHERE id = p_visit_id AND data_visita = CURRENT_DATE
  );
$$;

CREATE OR REPLACE FUNCTION attendance_private.staff_can_access(p_promotor_matricula TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.is_admin_or_gestor();
$$;

CREATE OR REPLACE FUNCTION attendance_private.promoter_can_write_visit(p_visit_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.visits v
    WHERE v.id = p_visit_id
      AND v.promotor_matricula = public.get_auth_promotor_matricula()
      AND v.status = 'em_andamento'
  );
$$;

CREATE OR REPLACE FUNCTION attendance_private.active_user()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.status = 'ativo'
  );
$$;

-- Policies represent the authenticated promoter/staff scope from homologation.
DROP POLICY IF EXISTS rc1_25_visits_select ON public.visits;
CREATE POLICY rc1_25_visits_select ON public.visits
  FOR SELECT TO authenticated
  USING (public.is_admin_or_gestor() OR promotor_matricula = public.get_auth_promotor_matricula());

DROP POLICY IF EXISTS rc1_25_visits_update ON public.visits;
CREATE POLICY rc1_25_visits_update ON public.visits
  FOR UPDATE TO authenticated
  USING (public.is_admin_or_gestor() OR promotor_matricula = public.get_auth_promotor_matricula())
  WITH CHECK (public.is_admin_or_gestor() OR promotor_matricula = public.get_auth_promotor_matricula());

DROP POLICY IF EXISTS rc1_25_visits_active_profile ON public.visits;
CREATE POLICY rc1_25_visits_active_profile ON public.visits
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (attendance_private.active_user())
  WITH CHECK (attendance_private.active_user());

-- 8. Configurações do sistema e autorizações operacionais (compatibilidade com attendance_check_in)
CREATE TABLE IF NOT EXISTS public.system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO public.system_settings (key, value)
VALUES ('operation_mode', '"OPERACAO_OFICIAL"'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.is_promotor_authorized(p_matricula TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT true;
$$;

-- 9. Concessão de privilégios públicos para papéis de aplicação
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role;
