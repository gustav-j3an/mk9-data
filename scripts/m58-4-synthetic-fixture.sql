CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS auth.users(id uuid PRIMARY KEY);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE OR REPLACE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array($1, '/') $$;
CREATE TABLE IF NOT EXISTS public.profiles(id uuid PRIMARY KEY, name text, email text, role text);
CREATE TABLE IF NOT EXISTS public.promotores(matricula text PRIMARY KEY);
CREATE TABLE IF NOT EXISTS public.industrias(codigo text PRIMARY KEY);
CREATE TABLE IF NOT EXISTS public.lojas(codigo text PRIMARY KEY);
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
CREATE TABLE IF NOT EXISTS storage.objects(bucket_id text, name text);
ALTER TABLE public.visits ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION public.is_admin_or_gestor() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION public.get_auth_promotor_matricula() RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULL::text $$;
CREATE OR REPLACE FUNCTION public.get_auth_industria_codigo() RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULL::text $$;
CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations(version text PRIMARY KEY, statements text[] NOT NULL, name text);
