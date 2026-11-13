CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $m58$
BEGIN
  IF to_regclass('auth.users') IS NULL
     OR to_regprocedure('auth.uid()') IS NULL
     OR to_regclass('storage.objects') IS NULL
     OR to_regprocedure('storage.foldername(text)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid=to_regclass('storage.objects') AND relrowsecurity) THEN
    RAISE EXCEPTION 'M58_4_SUPABASE_SYSTEM_OBJECTS_MISSING';
  END IF;
END
$m58$;
CREATE TABLE IF NOT EXISTS public.profiles(id uuid PRIMARY KEY, name text, email text, role text);
CREATE TABLE IF NOT EXISTS public.promotores(matricula text PRIMARY KEY);
CREATE TABLE IF NOT EXISTS public.industrias(codigo text PRIMARY KEY);
CREATE TABLE IF NOT EXISTS public.lojas(codigo text PRIMARY KEY);
INSERT INTO public.industrias(codigo) VALUES ('IND-007'), ('IND-ALPHA-1');
CREATE TABLE IF NOT EXISTS public.rotas(
  loja_codigo text, industria_codigo text, promotor_matricula text, frequencia text,
  segunda boolean, terca boolean, quarta boolean, quinta boolean, sexta boolean, sabado boolean, domingo boolean
);
CREATE TABLE IF NOT EXISTS public.visits(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), promotor_matricula text, loja_codigo text,
  industria_codigo text, data_visita date, rota_id uuid, started_at timestamptz,
  completed_at timestamptz, status text
);
CREATE TABLE IF NOT EXISTS public.visit_checklist_items(visit_id uuid);
CREATE TABLE IF NOT EXISTS public.visit_photos(visit_id uuid);
CREATE TABLE IF NOT EXISTS public.visit_occurrences(visit_id uuid);
CREATE TABLE IF NOT EXISTS public.visit_product_validity(visit_id uuid);
ALTER TABLE public.visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visit_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visit_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visit_occurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visit_product_validity ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION public.is_admin_or_gestor() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION public.get_auth_promotor_matricula() RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULL::text $$;
CREATE OR REPLACE FUNCTION public.get_auth_industria_codigo() RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULL::text $$;
CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations(version text PRIMARY KEY, statements text[] NOT NULL, name text);
