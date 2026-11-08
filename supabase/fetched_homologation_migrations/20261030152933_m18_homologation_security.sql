-- Homologation only. Applied explicitly via MCP to tafjceemuetqjyngresg.
-- Does not repair or rewrite historical migration records.
BEGIN;
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='admin' AND status='ativo');
$$;
CREATE OR REPLACE FUNCTION public.is_admin_or_gestor() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role IN ('admin','gestor') AND status='ativo');
$$;
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE trusted_role text := NEW.raw_app_meta_data->>'mk9_role';
BEGIN
 -- Only the official administrative Auth API can set app_metadata.
 -- Public signups receive an inactive, unprivileged profile.
 IF trusted_role IS NULL OR trusted_role NOT IN ('admin','gestor','operador','promotor','client_industry') THEN trusted_role := 'operador'; END IF;
 INSERT INTO public.profiles(id,email,name,role,department,status)
 VALUES(NEW.id,NEW.email,coalesce(NEW.raw_user_meta_data->>'full_name',split_part(NEW.email,'@',1)),
 trusted_role,'Homologacao',
 CASE WHEN NEW.raw_app_meta_data->>'mk9_provisioned'='true' THEN 'ativo' ELSE 'inativo' END)
 ON CONFLICT(id) DO UPDATE SET email=EXCLUDED.email,updated_at=now();
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.prevent_role_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF (NEW.id,NEW.role,NEW.status,NEW.promotor_matricula,NEW.industria_codigo)
 IS DISTINCT FROM (OLD.id,OLD.role,OLD.status,OLD.promotor_matricula,OLD.industria_codigo)
 AND auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
 RAISE EXCEPTION 'Only active administrators can change authorization scope' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
-- Keep invoker permissions on helpers used by RLS; remove anonymous RPC exposure.
DO $hardening$
DECLARE f record;
BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature,p.prorettype='trigger'::regtype AS is_trigger,p.proname
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.prosecdef
 LOOP
 EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon',f.signature);
 IF f.is_trigger OR f.proname IN ('generate_store_code','generate_industry_code','generate_team_code','generate_supervisor_code') THEN
 EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated',f.signature);
 END IF;
 END LOOP;
END $hardening$;
ALTER FUNCTION public.generate_store_code() SET search_path=pg_catalog,public,pg_temp;
ALTER FUNCTION public.get_next_store_code() SET search_path=pg_catalog,public,pg_temp;
ALTER FUNCTION public.set_loja_codigo_trigger() SET search_path=pg_catalog,public,pg_temp;
ALTER FUNCTION public.generate_industry_code() SET search_path=pg_catalog,public,pg_temp;
ALTER FUNCTION public.get_next_industry_code() SET search_path=pg_catalog,public,pg_temp;
ALTER FUNCTION public.set_industria_codigo_trigger() SET search_path=pg_catalog,public,pg_temp;
NOTIFY pgrst,'reload schema';
COMMIT;
;
