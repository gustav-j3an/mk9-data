-- Previous fixture script has returned to postgres; everything still rolls back.
SELECT set_config('request.jwt.claim.sub','',true);
SELECT pg_temp.assert_true((SELECT count(*) FROM public.industry_visits)=0,'anonymous uid has no view access');
INSERT INTO auth.users(id,email) VALUES('00000000-0000-4000-8000-000000000907','attendance-industry@example.invalid');
INSERT INTO public.profiles(id,email,name,role,status,industria_codigo)
VALUES('00000000-0000-4000-8000-000000000907','attendance-industry@example.invalid','Test Industry','client_industry','ativo','TEST_ATTENDANCE_IND')
ON CONFLICT(id) DO UPDATE SET role=EXCLUDED.role,industria_codigo=EXCLUDED.industria_codigo;
INSERT INTO public.industrias(codigo,nome,status) VALUES('TEST_ATTENDANCE_OTHER','Other Industry','ativo');
INSERT INTO public.visits(promotor_matricula,loja_codigo,industria_codigo,data_visita,status)
SELECT 'TEST_ATTENDANCE_902',codigo,'TEST_ATTENDANCE_OTHER','2026-10-19','pendente' FROM public.lojas WHERE nome='Test Store';
INSERT INTO public.supervisores(id,nome,status,user_id) VALUES('00000000-0000-4000-8000-000000000908','Test Supervisor','ativo','00000000-0000-4000-8000-000000000906');
INSERT INTO public.equipes(nome,status,supervisor_id) VALUES('TEST_ATTENDANCE_TEAM','ativa','00000000-0000-4000-8000-000000000908');
UPDATE public.promotores SET equipe='TEST_ATTENDANCE_TEAM' WHERE matricula='TEST_ATTENDANCE_901';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000907',true);
SELECT pg_temp.assert_true((SELECT count(*) FROM visits)=0,'industrial direct raw visits denied');
SELECT pg_temp.assert_true((SELECT count(*) FROM promotores)=0,'industrial direct personal data denied');
SELECT pg_temp.assert_true((SELECT count(*) FROM industry_visits)=1,'industry only own operation');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM industry_visits v WHERE to_jsonb(v) ? 'latitude' OR to_jsonb(v) ? 'longitude'),'sanitised view has no GPS');
SELECT pg_temp.assert_true((SELECT count(*) FROM industry_visits WHERE industria_codigo='TEST_ATTENDANCE_OTHER')=0,'cross-industry view access denied');
DO $$ BEGIN BEGIN PERFORM public.set_promoter_attendance_override('TEST_ATTENDANCE_901','2026-10-19','presente','Industry attempt',NULL); RAISE EXCEPTION 'industry write allowed'; EXCEPTION WHEN raise_exception THEN IF SQLERRM='industry write allowed' THEN RAISE; END IF; END; END $$;

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000906',true);
SELECT pg_temp.assert_true((SELECT count(*) FROM promotores WHERE matricula='TEST_ATTENDANCE_902')=0,'supervisor cannot read unrelated promoter');
SELECT pg_temp.assert_true((SELECT count(*) FROM promoter_attendance_records WHERE promotor_matricula='TEST_ATTENDANCE_902')=0,'supervisor cannot read unrelated attendance');
DO $$ BEGIN BEGIN PERFORM public.set_promoter_attendance_override('TEST_ATTENDANCE_902','2026-10-19','falta','Wrong team attempt',NULL); RAISE EXCEPTION 'out of team write allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;
SELECT public.set_promoter_attendance_override('TEST_ATTENDANCE_901','2026-10-19','presente','Supervisor own team',NULL);
DO $$ BEGIN BEGIN UPDATE public.supervisores SET user_id=NULL WHERE id='00000000-0000-4000-8000-000000000908'; RAISE EXCEPTION 'supervisor self unscoping allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000901',true);
SELECT public.set_promoter_work_schedule('TEST_ATTENDANCE_901','segunda','09:00','18:00','2026-11-01',60,10,'America/Sao_Paulo','CLT','Approved revised journey');
SELECT pg_temp.assert_true(EXISTS(SELECT 1 FROM promoter_work_schedules WHERE promotor_matricula='TEST_ATTENDANCE_901' AND hora_inicio='08:00' AND valid_to='2026-10-31'),'prior journey retained');
SELECT pg_temp.assert_true((SELECT count(*) FROM promoter_journey_audit WHERE promotor_matricula='TEST_ATTENDANCE_901')>=2,'version change audited');
DO $$ BEGIN BEGIN UPDATE public.visits SET latitude=0 WHERE promotor_matricula='TEST_ATTENDANCE_901'; RAISE EXCEPTION 'telemetry update allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;
RESET ROLE;
SELECT 'finalisation security checks passed' AS result;
-- Record a real local RPC sequence, retaining the first event on retry.
SELECT set_config('request.jwt.claim.sub','',true);
INSERT INTO public.rotas(codigo_rota,promotor_matricula,loja_codigo,industria_codigo,uf)
SELECT 'TEST_ATTENDANCE_RPC','TEST_ATTENDANCE_901',codigo,'TEST_ATTENDANCE_IND','SP' FROM public.lojas WHERE nome='Test Store';
INSERT INTO public.promoter_operation_authorizations(promotor_matricula,status,justification)
VALUES('TEST_ATTENDANCE_901','liberado','Local fixture authorisation') ON CONFLICT(promotor_matricula) DO NOTHING;
-- Fixture visit is from a different operational date; close it as trusted setup.
UPDATE public.visits SET status='concluida',completed_at=started_at+interval '1 minute'
WHERE promotor_matricula='TEST_ATTENDANCE_901' AND status='em_andamento';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000903',true);
CREATE TEMP TABLE rpc_first AS SELECT (public.attendance_check_in((SELECT codigo FROM public.lojas WHERE nome='Test Store'),'TEST_ATTENDANCE_IND',NULL,-23.55,-46.63,12)).*;
CREATE TEMP TABLE rpc_retry AS SELECT (public.attendance_check_in((SELECT codigo FROM public.lojas WHERE nome='Test Store'),'TEST_ATTENDANCE_IND',NULL,-23.56,-46.64,20)).*;
SELECT pg_temp.assert_true((SELECT a.id=b.id AND a.started_at=b.started_at AND a.latitude=b.latitude FROM rpc_first a,rpc_retry b),'repeated check-in is idempotent');
CREATE TEMP TABLE rpc_checkout AS SELECT (public.attendance_check_out((SELECT id FROM rpc_first),-23.56,-46.64,18,'Local checkout test')).*;
SELECT pg_temp.assert_true((SELECT c.started_at=a.started_at AND c.latitude=a.latitude AND c.gps_accuracy_meters=12 AND c.checkout_accuracy_meters=18 AND c.completed_at>=a.started_at FROM rpc_checkout c,rpc_first a),'checkout preserves check-in and records separate accuracy');
SELECT public.attendance_check_out((SELECT id FROM rpc_first),NULL,NULL,NULL,'Retry');
RESET ROLE;
SELECT 'idempotent check-in and checkout checks passed' AS result;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000901',true);
SELECT public.set_promoter_work_schedule('TEST_ATTENDANCE_901','terca','22:00','06:00','2026-11-01',60,10,'America/Sao_Paulo','Other','Approved night journey');
DO $$ BEGIN BEGIN PERFORM public.set_promoter_work_schedule('TEST_ATTENDANCE_901','quarta','05:00','12:00','2026-11-01',30,10,'America/Sao_Paulo','Other','Conflict must be rejected'); RAISE EXCEPTION 'overlap allowed'; EXCEPTION WHEN raise_exception THEN IF SQLERRM='overlap allowed' THEN RAISE; END IF; END; END $$;
INSERT INTO public.promoter_work_schedule_templates(nome,hora_inicio,hora_fim,timezone,justification) VALUES('TEST_ATTENDANCE_TEMPLATE','09:00','16:00','America/Sao_Paulo','Reusable synthetic template');
INSERT INTO public.attendance_holidays(data,nome,behavior,justification) VALUES('2026-11-02','TEST_ATTENDANCE_HOLIDAY','follow_schedule','Explicit holiday behavior');
SELECT public.set_attendance_rules('America/Sao_Paulo','23:59',NULL,'Null tolerance stays unconfigured');
SELECT pg_temp.assert_true((SELECT value->'late_tolerance_minutes'='null'::jsonb FROM system_settings WHERE key='attendance_rules'),'no invented tolerance');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000906',true);
DO $$ BEGIN BEGIN DELETE FROM supervisores WHERE id='00000000-0000-4000-8000-000000000908'; RAISE EXCEPTION 'supervisor removal bypass allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;
RESET ROLE;
SELECT 'journey templates, holiday configuration and overlap checks passed' AS result;
