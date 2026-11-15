-- ==============================================================================
-- FIXTURE DE PREPARAÇÃO PARA TESTES ISOLADOS (RC1.25)
-- Arquivo: scripts/rc1-25-test-fixture.sql
-- ==============================================================================

-- 1. Extensões e Roles
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Schema auth e auth.users
-- No Supabase CLI, o schema auth e a tabela auth.users já existem e pertencem a supabase_admin.
-- Garantimos as permissões DML para o usuário postgres inserir usuários de teste.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'auth') THEN
    CREATE SCHEMA auth;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY
);

-- Conceder permissões para o role postgres poder popular auth.users em testes
GRANT USAGE ON SCHEMA auth TO postgres;
GRANT ALL ON TABLE auth.users TO postgres;

-- 3. Schema storage
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'storage') THEN
    CREATE SCHEMA storage;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS storage.objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id TEXT,
  name TEXT,
  owner UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA storage TO postgres;
GRANT ALL ON TABLE storage.objects TO postgres;

CREATE OR REPLACE FUNCTION storage.foldername(text)
RETURNS TEXT[] LANGUAGE sql IMMUTABLE AS $$
  SELECT string_to_array($1, '/')
$$;

-- 4. Funções auxiliares auth e perfil (caso não existam no container)
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID
$$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.role', true), '')
$$;

-- 5. Tabelas fundamentais da aplicação
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
  matricula TEXT PRIMARY KEY,
  nome TEXT,
  cpf TEXT,
  telefone TEXT,
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
