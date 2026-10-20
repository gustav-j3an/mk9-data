-- ONLY for a NEW empty disposable database in the verified local Docker container.
-- These UUID-key stubs mirror the verified referenced key types, not production data.
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE TABLE public.profiles(id uuid PRIMARY KEY,name text,role text,status text,promotor_matricula text);
CREATE TABLE public.promotores(id uuid PRIMARY KEY,matricula text UNIQUE NOT NULL,nome text,status text,equipe text,supervisor text);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.profiles,public.promotores FROM authenticated,anon;
