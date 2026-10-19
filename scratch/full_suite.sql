BEGIN;
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

-- Run after attendance_photo_security.sql, within the same rollback transaction.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000951',true);
INSERT INTO promoter_work_schedule_templates(nome,hora_inicio,hora_fim,timezone,days,justification)
VALUES('SEC_OPERATION_MODEL','08:00','17:00','America/Sao_Paulo',ARRAY['segunda','terca'],'Synthetic approved model');
SELECT public.apply_attendance_journeys(ARRAY['SEC_PHOTO_A','SEC_PHOTO_B'],ARRAY['segunda','terca'],'08:00','17:00','2026-10-19','2026-11-30',60,NULL,'America/Sao_Paulo','CLT parcial','Synthetic bulk configuration',false,'SP','Synthetic');
SELECT pg_temp.photo_assert((SELECT count(*)=4 FROM promoter_work_schedules WHERE promotor_matricula LIKE 'SEC_PHOTO_%'),'bulk creates exactly two days for two promoters');
SELECT pg_temp.photo_assert((SELECT bool_and(tolerance_minutes IS NULL) FROM promoter_work_schedules WHERE promotor_matricula LIKE 'SEC_PHOTO_%'),'bulk never invents tolerance');
SELECT pg_temp.photo_assert((SELECT count(*)=4 FROM promoter_journey_audit WHERE table_name='promoter_work_schedules' AND promotor_matricula LIKE 'SEC_PHOTO_%' AND changed_by=auth.uid()),'bulk history contains actor and every row');
SELECT public.apply_attendance_journeys(ARRAY['SEC_PHOTO_A'],ARRAY['segunda'],'09:00','18:00','2026-10-26',NULL,60,10,'America/Sao_Paulo','Freelancer','Synthetic version change',false,'SP','Synthetic');
SELECT pg_temp.photo_assert(EXISTS(SELECT 1 FROM promoter_work_schedules WHERE promotor_matricula='SEC_PHOTO_A' AND dia_semana='segunda' AND valid_from='2026-10-19' AND valid_to='2026-10-25'),'previous version retains earlier dates');
SELECT public.apply_attendance_journeys(ARRAY['SEC_PHOTO_A'],ARRAY['segunda'],'09:30','18:30','2026-10-26',NULL,60,10,'America/Sao_Paulo','Freelancer','Synthetic same-date correction',false,'SP','Synthetic');
SELECT pg_temp.photo_assert((SELECT count(*)=1 FROM promoter_work_schedules WHERE promotor_matricula='SEC_PHOTO_A' AND dia_semana='segunda' AND valid_from='2026-10-26'),'same effective date updates without duplication');
SELECT pg_temp.photo_assert(EXISTS(SELECT 1 FROM promoter_journey_audit WHERE promotor_matricula='SEC_PHOTO_A' AND previous_value->>'hora_inicio'='09:00:00' AND new_value->>'hora_inicio'='09:30:00'),'history retains old and new times');
DO $$ DECLARE rows_before integer; history_before integer; BEGIN
 SELECT count(*) INTO rows_before FROM promoter_work_schedules;
 SELECT count(*) INTO history_before FROM promoter_journey_audit;
 BEGIN
  PERFORM public.apply_attendance_journeys(ARRAY['SEC_PHOTO_A','ZZZ_UNKNOWN'],ARRAY['quarta'],'08:00','17:00','2026-10-19',NULL,60,10,'America/Sao_Paulo',NULL,'Synthetic atomic rollback',false,NULL,NULL);
  RAISE EXCEPTION 'invalid promoter accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM pg_temp.photo_assert((SELECT count(*)=rows_before FROM promoter_work_schedules),'failed batch leaves no partial journey');
 PERFORM pg_temp.photo_assert((SELECT count(*)=history_before FROM promoter_journey_audit),'failed batch leaves no partial audit');
 BEGIN
  PERFORM public.apply_attendance_journeys(ARRAY['SEC_PHOTO_A'],ARRAY['segunda'],'08:00','17:00','2026-10-20','2026-11-30',60,10,'America/Sao_Paulo',NULL,'Synthetic future conflict',false,NULL,NULL);
  RAISE EXCEPTION 'future version overlap accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='future version overlap accepted' THEN RAISE; END IF; END;
END $$;
SELECT public.assign_attendance_supervisor(ARRAY['SEC_PHOTO_A','SEC_PHOTO_B'],(SELECT codigo FROM equipes WHERE nome='SEC_PHOTO_TEAM'),'00000000-0000-4000-8000-000000000969','Synthetic explicit supervisor assignment');
SELECT pg_temp.photo_assert((SELECT count(*)=2 FROM promotores WHERE matricula LIKE 'SEC_PHOTO_%' AND equipe='SEC_PHOTO_TEAM'),'explicit bulk supervision links both promoters to canonical team');
SELECT pg_temp.photo_assert((SELECT count(*)=2 FROM promoter_journey_audit WHERE table_name='attendance_supervisor_assignment' AND changed_by=auth.uid() AND justification='Synthetic explicit supervisor assignment'),'supervision history retains administrator and reason');
SELECT public.set_attendance_rules('America/Sao_Paulo','18:00',10,'Synthetic closure settings');
SELECT pg_temp.photo_assert((SELECT value->'automatic_absence_approved'='false'::jsonb FROM system_settings WHERE key='attendance_rules'),'configuration never implicitly approves absence');
SELECT public.approve_attendance_closure(true,'Synthetic explicit closure approval');
SELECT pg_temp.photo_assert((SELECT value->'automatic_absence_approved'='true'::jsonb FROM system_settings WHERE key='attendance_rules'),'explicit approval persisted');
SELECT public.set_attendance_rules('America/Sao_Paulo','19:00',10,'Synthetic closure changes');
SELECT pg_temp.photo_assert((SELECT value->'automatic_absence_approved'='false'::jsonb FROM system_settings WHERE key='attendance_rules'),'changing rules invalidates prior approval');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000958',true);
SELECT pg_temp.photo_assert((public.attendance_setup_status()->>'version')='9','operator can read readiness without administrative mutation');
DO $$ BEGIN
 BEGIN PERFORM public.approve_attendance_closure(true,'Operator approval attempt'); RAISE EXCEPTION 'operator approval accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.assign_attendance_supervisor(ARRAY['SEC_PHOTO_A'],'SEC_PHOTO_TEAM','00000000-0000-4000-8000-000000000969','Operator assignment attempt'); RAISE EXCEPTION 'operator assignment accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.apply_attendance_journeys(ARRAY['SEC_PHOTO_A'],ARRAY['quarta'],'08:00','17:00','2026-10-19',NULL,NULL,NULL,'America/Sao_Paulo',NULL,'Operator journey attempt',false,NULL,NULL); RAISE EXCEPTION 'operator journey accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
-- Local synthetic setup for RPC linkage; original event data is not rewritten.
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE visits SET status='concluida',completed_at=started_at+interval '1 minute' WHERE promotor_matricula='SEC_PHOTO_A' AND status='em_andamento';
INSERT INTO promoter_operation_authorizations(promotor_matricula,status,justification) VALUES('SEC_PHOTO_A','liberado','Synthetic local operation release');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000951',true);
SELECT public.apply_attendance_journeys(ARRAY['SEC_PHOTO_A'],ARRAY[(ARRAY['domingo','segunda','terca','quarta','quinta','sexta','sabado'])[extract(dow FROM (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date)::integer+1]],'08:00','17:00',(clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date,NULL,60,NULL,'America/Sao_Paulo',NULL,'Synthetic current-date journey',true,'SP','Synthetic');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000953',true);
SELECT pg_temp.photo_assert((public.attendance_check_in('SEC_PHOTO_STORE','SEC_PHOTO_A')).work_schedule_id IS NOT NULL,'check-in links to applicable journey');
RESET ROLE;
SELECT 'operational setup: models, bulk/single versioning, atomicity, audit, supervisor, closure approval and check-in linkage passed' AS result;

ROLLBACK;
