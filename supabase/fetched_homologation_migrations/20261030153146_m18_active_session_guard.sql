BEGIN;
-- Prevent inactive profiles from satisfying older permissive operational policies.
CREATE FUNCTION attendance_private.active_user() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND status='ativo');
$$;
REVOKE ALL ON FUNCTION attendance_private.active_user() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION attendance_private.active_user() TO authenticated;
DO $policies$
DECLARE t record;
BEGIN
 FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relrowsecurity AND c.relname<>'profiles'
 LOOP
 EXECUTE format('CREATE POLICY m18_active_session ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (attendance_private.active_user()) WITH CHECK (attendance_private.active_user())', t.relname);
 END LOOP;
END $policies$;
COMMIT;;
