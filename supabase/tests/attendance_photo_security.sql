-- Synthetic-only; runner wraps everything in ROLLBACK. All access assertions
-- execute as authenticated/anon, never as the fixture administrator.
CREATE FUNCTION pg_temp.photo_assert(ok boolean,message text) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%',message; END IF; END $$;
SELECT set_config('request.jwt.claim.sub','',true);
INSERT INTO auth.users(id,email)
SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'photo-'||n||'@example.invalid'
FROM generate_series(951,958) n;
INSERT INTO public.profiles(id,email,name,role,status)
SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'photo-'||n||'@example.invalid','Synthetic photo user',
 (ARRAY['admin','gestor','promotor','promotor','client_industry','client_industry','admin','operador'])[n-950],
 CASE WHEN n=957 THEN 'inativo' ELSE 'ativo' END FROM generate_series(951,958) n
ON CONFLICT(id) DO UPDATE SET role=EXCLUDED.role,status=EXCLUDED.status;
INSERT INTO industrias(codigo,nome,status) VALUES('SEC_PHOTO_A','Synthetic A','ativo'),('SEC_PHOTO_B','Synthetic B','ativo');
INSERT INTO lojas(codigo,nome,cidade,uf,status) VALUES('SEC_PHOTO_STORE','Synthetic store','Synthetic','SP','ativo');
INSERT INTO supervisores(id,nome,status,user_id) VALUES('00000000-0000-4000-8000-000000000969','Synthetic supervisor','ativo','00000000-0000-4000-8000-000000000952');
INSERT INTO equipes(nome,status,supervisor_id) VALUES('SEC_PHOTO_TEAM','ativa','00000000-0000-4000-8000-000000000969');
INSERT INTO promotores(matricula,nome,cidade,uf,status,equipe)
VALUES('SEC_PHOTO_A','Synthetic promoter A','Synthetic','SP','ativo','SEC_PHOTO_TEAM'),('SEC_PHOTO_B','Synthetic promoter B','Synthetic','SP','ativo',NULL);
UPDATE profiles SET promotor_matricula='SEC_PHOTO_A' WHERE id='00000000-0000-4000-8000-000000000953';
UPDATE profiles SET promotor_matricula='SEC_PHOTO_B' WHERE id='00000000-0000-4000-8000-000000000954';
UPDATE profiles SET industria_codigo='SEC_PHOTO_A' WHERE id='00000000-0000-4000-8000-000000000955';
UPDATE profiles SET industria_codigo='SEC_PHOTO_B' WHERE id='00000000-0000-4000-8000-000000000956';
INSERT INTO rotas(codigo_rota,promotor_matricula,loja_codigo,industria_codigo,frequencia,uf,segunda,terca,quarta,quinta,sexta,sabado,domingo)
VALUES('SEC_PHOTO_RA','SEC_PHOTO_A','SEC_PHOTO_STORE','SEC_PHOTO_A','SEMANAL','SP',true,false,false,false,false,false,false),
('SEC_PHOTO_RB','SEC_PHOTO_B','SEC_PHOTO_STORE','SEC_PHOTO_B','SEMANAL','SP',true,false,false,false,false,false,false);
INSERT INTO visits(id,promotor_matricula,loja_codigo,industria_codigo,data_visita,status,started_at)
VALUES('00000000-0000-4000-8000-000000000961','SEC_PHOTO_A','SEC_PHOTO_STORE','SEC_PHOTO_A','2026-10-17','em_andamento','2026-10-17T12:00:00Z'),
('00000000-0000-4000-8000-000000000962','SEC_PHOTO_B','SEC_PHOTO_STORE','SEC_PHOTO_B','2026-10-17','em_andamento','2026-10-17T12:00:00Z');
INSERT INTO storage.buckets(id,name,public) VALUES('visit-photos','visit-photos',false) ON CONFLICT(id) DO NOTHING;
INSERT INTO storage.objects(bucket_id,name) VALUES
('visit-photos','visits/00000000-0000-4000-8000-000000000961/a.jpg'),
('visit-photos','visits/00000000-0000-4000-8000-000000000961/staged.jpg'),
('visit-photos','visits/00000000-0000-4000-8000-000000000962/b.jpg'),
('visit-photos','SEC_PHOTO_legacy.jpg'),('visit-photos','SEC_PHOTO_unrelated.jpg');
INSERT INTO visit_photos(visit_id,tipo_foto,storage_path,file_url) VALUES
('00000000-0000-4000-8000-000000000961','fachada','visits/00000000-0000-4000-8000-000000000961/a.jpg','synthetic'),
('00000000-0000-4000-8000-000000000962','fachada','visits/00000000-0000-4000-8000-000000000962/b.jpg','synthetic'),
('00000000-0000-4000-8000-000000000961','fachada','SEC_PHOTO_legacy.jpg','synthetic');

-- Even a later accidental broad permissive policy must not reopen this bucket.
CREATE POLICY synthetic_adversarial_storage ON storage.objects FOR ALL TO authenticated USING(true) WITH CHECK(true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000955',true);
SELECT pg_temp.photo_assert(EXISTS(SELECT 1 FROM storage.objects WHERE name='SEC_PHOTO_legacy.jpg'),'industry legacy photo must stay readable');
SELECT pg_temp.photo_assert(NOT EXISTS(SELECT 1 FROM storage.objects WHERE name LIKE '%/b.jpg' OR name LIKE '%/staged.jpg' OR name='SEC_PHOTO_unrelated.jpg'),'industry must not see other client, unlinked upload or orphan');
SELECT pg_temp.photo_assert((SELECT count(*)=1 FROM industry_routes WHERE codigo_rota LIKE 'SEC_PHOTO_%'),'sanitised route scope');
SELECT pg_temp.photo_assert((SELECT promotor->>'nome'='Synthetic promoter A' FROM industry_routes WHERE codigo_rota='SEC_PHOTO_RA'),'sanitised route preserves promoter name');
SELECT pg_temp.photo_assert(NOT EXISTS(SELECT 1 FROM promotores),'industry cannot read raw PII');
SELECT pg_temp.photo_assert((SELECT count(*)=2 FROM industry_visit_photos WHERE visit->>'industria_codigo'='SEC_PHOTO_A'),'JSON evidence filter and legacy photo');
DO $$ BEGIN BEGIN
 INSERT INTO storage.objects(bucket_id,name) VALUES('visit-photos','visits/00000000-0000-4000-8000-000000000961/industry.jpg');
 RAISE EXCEPTION 'industry upload allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000956',true);
SELECT pg_temp.photo_assert(NOT EXISTS(SELECT 1 FROM storage.objects WHERE name='SEC_PHOTO_legacy.jpg' OR name LIKE '%/a.jpg'),'second industry isolated');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000953',true);
SELECT pg_temp.photo_assert(EXISTS(SELECT 1 FROM storage.objects WHERE name LIKE '%/staged.jpg'),'owner can sign before metadata insert');
SELECT pg_temp.photo_assert(NOT EXISTS(SELECT 1 FROM storage.objects WHERE name LIKE '%/b.jpg'),'promoter cannot read peer photo');
INSERT INTO storage.objects(bucket_id,name) VALUES('visit-photos','visits/00000000-0000-4000-8000-000000000961/new.jpg');
INSERT INTO visit_photos(visit_id,tipo_foto,storage_path,file_url)
VALUES('00000000-0000-4000-8000-000000000961','fachada','visits/00000000-0000-4000-8000-000000000961/new.jpg','synthetic');
DO $$ BEGIN BEGIN
 INSERT INTO visit_photos(visit_id,tipo_foto,storage_path,file_url)
 VALUES('00000000-0000-4000-8000-000000000961','fachada','visits/00000000-0000-4000-8000-000000000962/b.jpg','synthetic');
 RAISE EXCEPTION 'foreign object relabel allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
 UPDATE visit_photos SET storage_path='visits/00000000-0000-4000-8000-000000000962/b.jpg' WHERE storage_path LIKE '%/new.jpg';
 RAISE EXCEPTION 'original reference update allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;
SELECT pg_temp.photo_assert(NOT attendance_private.photo_upload_allowed('visits/not-a-uuid/x.jpg'),'malformed path denied without unsafe UUID cast');
SELECT pg_temp.photo_assert(NOT attendance_private.photo_upload_allowed('visits/00000000-0000-4000-8000-000000000962/evil.jpg'),'foreign upload denied');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000952',true);
SELECT pg_temp.photo_assert(NOT EXISTS(SELECT 1 FROM storage.objects WHERE name LIKE '%/b.jpg'),'supervisor cannot read outside team');
SELECT pg_temp.photo_assert(EXISTS(SELECT 1 FROM storage.objects WHERE name LIKE '%/a.jpg'),'supervisor reads own team');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000951',true);
SELECT pg_temp.photo_assert(EXISTS(SELECT 1 FROM storage.objects WHERE name LIKE '%/a.jpg') AND EXISTS(SELECT 1 FROM storage.objects WHERE name LIKE '%/b.jpg'),'active admin reads authorised operational photos');
SELECT pg_temp.photo_assert(NOT EXISTS(SELECT 1 FROM storage.objects WHERE name='SEC_PHOTO_unrelated.jpg'),'even admin read requires visit evidence');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000958',true);
SELECT pg_temp.photo_assert(EXISTS(SELECT 1 FROM storage.objects WHERE name LIKE '%/b.jpg'),'operator read preserved');
SELECT pg_temp.photo_assert(NOT attendance_private.photo_upload_allowed('visits/00000000-0000-4000-8000-000000000961/operator.jpg'),'operator cannot upload');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000957',true);
SELECT pg_temp.photo_assert(NOT EXISTS(SELECT 1 FROM storage.objects WHERE name LIKE '%/a.jpg' OR name LIKE '%/b.jpg'),'inactive admin denied');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000999',true);
SELECT pg_temp.photo_assert(NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='visit-photos'),'missing profile denied despite permissive policy');
RESET ROLE;
CREATE TABLE public.synthetic_photo_future_table(id integer);
SELECT pg_temp.photo_assert(NOT EXISTS(
 SELECT 1 FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
 WHERE (d.defaclnamespace=0 OR d.defaclnamespace='public'::regnamespace)
 AND d.defaclobjtype='r' AND a.privilege_type IN ('TRUNCATE','REFERENCES','TRIGGER','MAINTAIN')
 AND (a.grantee=0 OR a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon','authenticated')))),
 'all cached migration creators have safe default ACLs');
SELECT pg_temp.photo_assert(NOT EXISTS(
 SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 CROSS JOIN (VALUES('anon'),('authenticated')) r(role)
 WHERE n.nspname='public' AND c.relkind IN ('r','p') AND
 (has_table_privilege(r.role,c.oid,'TRUNCATE') OR has_table_privilege(r.role,c.oid,'TRIGGER') OR has_table_privilege(r.role,c.oid,'REFERENCES') OR has_table_privilege(r.role,c.oid,'MAINTAIN'))),'excessive current/future table privileges removed');
SET LOCAL ROLE anon;
SELECT pg_temp.photo_assert(NOT has_schema_privilege(current_user,'attendance_private','USAGE'),'anonymous private schema denied');
RESET ROLE;
SELECT pg_temp.photo_assert(NOT has_function_privilege('anon','attendance_private.photo_upload_allowed(text)','EXECUTE'),'anonymous upload helper denied');
SELECT 'photo isolation, canonical upload, legacy reads, route/evidence contracts and least privileges passed' AS result;
