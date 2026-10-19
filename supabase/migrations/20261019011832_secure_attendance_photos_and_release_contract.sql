-- Additive release correction. Requires the seven attendance migrations.
-- Does not rewrite historical rows or turn off RLS. Execute before the new UI.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='60s';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM storage.buckets WHERE id='visit-photos' AND public) THEN
 RAISE EXCEPTION 'visit-photos must be private; review bucket configuration before deployment'; END IF;
 IF EXISTS(SELECT 1 FROM public.visit_photos GROUP BY storage_path HAVING count(DISTINCT visit_id)>1) THEN
 RAISE EXCEPTION 'Shared historical photo paths require review before deployment'; END IF;
END $$;

CREATE FUNCTION attendance_private.photo_upload_allowed(object_name text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.visits v JOIN public.profiles p ON p.id=auth.uid()
 WHERE p.status='ativo' AND object_name ~ '^visits/[0-9a-fA-F-]{36}/[^/]+$'
 AND split_part(object_name,'/',2)=v.id::text AND (
   (p.role='promotor' AND p.promotor_matricula=v.promotor_matricula AND v.status='em_andamento')
   OR (p.role IN ('admin','gestor') AND attendance_private.staff_can_access(v.promotor_matricula))));
$$;
CREATE FUNCTION attendance_private.photo_read_allowed(object_name text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT attendance_private.photo_upload_allowed(object_name) OR EXISTS(
 SELECT 1 FROM public.visit_photos ph WHERE ph.storage_path=object_name
 AND attendance_private.can_read_visit(ph.visit_id));
$$;
REVOKE ALL ON FUNCTION attendance_private.photo_upload_allowed(text),attendance_private.photo_read_allowed(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION attendance_private.photo_upload_allowed(text),attendance_private.photo_read_allowed(text) TO authenticated;

-- Restrictive guards neutralise ANY broad legacy permissive policy, including
-- policies whose names differ between local and production. Other buckets keep
-- their existing policies. Unauthenticated users cannot enter this bucket.
CREATE POLICY attendance_photo_read_guard ON storage.objects AS RESTRICTIVE
 FOR SELECT TO PUBLIC USING(bucket_id<>'visit-photos' OR
 (auth.uid() IS NOT NULL AND attendance_private.photo_read_allowed(name)));
CREATE POLICY attendance_photo_insert_guard ON storage.objects AS RESTRICTIVE
 FOR INSERT TO PUBLIC WITH CHECK(bucket_id<>'visit-photos' OR
 (auth.uid() IS NOT NULL AND attendance_private.photo_upload_allowed(name)));
CREATE POLICY attendance_photo_update_guard ON storage.objects AS RESTRICTIVE
 FOR UPDATE TO PUBLIC USING(bucket_id<>'visit-photos' OR
 (auth.uid() IS NOT NULL AND attendance_private.photo_upload_allowed(name)))
 WITH CHECK(bucket_id<>'visit-photos' OR
 (auth.uid() IS NOT NULL AND attendance_private.photo_upload_allowed(name)));
CREATE POLICY attendance_photo_delete_guard ON storage.objects AS RESTRICTIVE
 FOR DELETE TO PUBLIC USING(bucket_id<>'visit-photos' OR
 (auth.uid() IS NOT NULL AND attendance_private.photo_upload_allowed(name)));
-- Needed to sign a just-uploaded object before its metadata INSERT, and clean
-- up one's failed upload. These grants remain intersected with all guards.
CREATE POLICY attendance_photo_owner_read ON storage.objects FOR SELECT TO authenticated
 USING(bucket_id='visit-photos' AND attendance_private.photo_read_allowed(name));
CREATE POLICY attendance_photo_owner_insert ON storage.objects FOR INSERT TO authenticated
 WITH CHECK(bucket_id='visit-photos' AND attendance_private.photo_upload_allowed(name));
CREATE POLICY attendance_photo_owner_cleanup ON storage.objects FOR DELETE TO authenticated
 USING(bucket_id='visit-photos' AND attendance_private.photo_upload_allowed(name));

-- A photo reference cannot be used to relabel somebody else's object as one's
-- own. Existing legacy paths remain readable; only new references are canonical.
CREATE POLICY attendance_photo_metadata_read ON public.visit_photos AS RESTRICTIVE
 FOR SELECT TO authenticated USING(attendance_private.can_read_visit(visit_id));
CREATE POLICY attendance_photo_metadata_insert ON public.visit_photos AS RESTRICTIVE
 FOR INSERT TO authenticated WITH CHECK(
 split_part(storage_path,'/',2)=visit_id::text AND attendance_private.photo_upload_allowed(storage_path));
CREATE POLICY attendance_photo_metadata_update ON public.visit_photos AS RESTRICTIVE
 FOR UPDATE TO authenticated USING(attendance_private.photo_upload_allowed(storage_path))
 WITH CHECK(split_part(storage_path,'/',2)=visit_id::text AND attendance_private.photo_upload_allowed(storage_path));
CREATE POLICY attendance_photo_metadata_delete ON public.visit_photos AS RESTRICTIVE
 FOR DELETE TO authenticated USING(attendance_private.photo_upload_allowed(storage_path));
CREATE FUNCTION attendance_private.protect_photo_reference() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF (NEW.visit_id,NEW.storage_path) IS DISTINCT FROM (OLD.visit_id,OLD.storage_path) THEN
 RAISE EXCEPTION 'Original photo reference is immutable' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION attendance_private.protect_photo_reference() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER protect_photo_reference BEFORE UPDATE ON public.visit_photos
 FOR EACH ROW EXECUTE FUNCTION attendance_private.protect_photo_reference();

-- Application DML stays unchanged. RLS cannot protect these DDL-like privileges.
REVOKE TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON ALL TABLES IN SCHEMA public FROM PUBLIC,anon,authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON TABLES FROM PUBLIC,anon,authenticated;
-- Global defaults combine additively with schema defaults; remove only these
-- unnecessary privileges, never SELECT/INSERT/UPDATE/DELETE.
ALTER DEFAULT PRIVILEGES REVOKE TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON TABLES FROM PUBLIC,anon,authenticated;
DO $$ DECLARE creator record; BEGIN
 FOR creator IN SELECT DISTINCT r.rolname,n.nspname FROM pg_default_acl d
 JOIN pg_roles r ON r.oid=d.defaclrole LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
 CROSS JOIN LATERAL aclexplode(d.defaclacl) a
 WHERE d.defaclobjtype='r' AND (d.defaclnamespace=0 OR n.nspname='public')
 AND a.privilege_type IN ('TRUNCATE','REFERENCES','TRIGGER','MAINTAIN')
 AND (a.grantee=0 OR a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon','authenticated')))
 LOOP
   IF NOT pg_has_role(current_user,creator.rolname,'USAGE') THEN
     RAISE EXCEPTION 'Default privilege owner % requires an authorised owner-run correction before this release',creator.rolname;
   END IF;
   EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I %s REVOKE TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON TABLES FROM PUBLIC,anon,authenticated',
     creator.rolname,CASE WHEN creator.nspname IS NULL THEN '' ELSE 'IN SCHEMA public' END);
 END LOOP;
END $$;

-- Parent route projection avoids raw-promoter embeds blocked by sensitive RLS.
CREATE VIEW public.industry_routes WITH(security_barrier=true) AS
SELECT r.id,r.codigo_rota,(to_jsonb(r)->>'data')::date AS data,
 (to_jsonb(r)->>'sequencia')::integer AS sequencia,
 r.promotor_matricula,r.loja_codigo,r.industria_codigo,r.frequencia,r.uf,
 r.segunda,r.terca,r.quarta,r.quinta,r.sexta,r.sabado,r.domingo,
 r.observacao,r.created_at,r.updated_at,
 jsonb_build_object('matricula',pr.matricula,'nome',pr.nome) AS promotor,
 jsonb_build_object('codigo',l.codigo,'nome',l.nome,'cidade',l.cidade,'uf',l.uf) AS loja,
 jsonb_build_object('codigo',i.codigo,'nome',i.nome) AS industria
FROM public.rotas r JOIN public.promotores pr ON pr.matricula=r.promotor_matricula
JOIN public.lojas l ON l.codigo=r.loja_codigo JOIN public.industrias i ON i.codigo=r.industria_codigo
WHERE attendance_private.staff_can_access(r.promotor_matricula) OR EXISTS(
 SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.status='ativo' AND
 ((p.role='client_industry' AND p.industria_codigo=r.industria_codigo)
 OR (p.role='promotor' AND p.promotor_matricula=r.promotor_matricula)));
REVOKE ALL ON public.industry_routes FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.industry_routes TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
