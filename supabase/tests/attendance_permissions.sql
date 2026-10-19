-- Local PostgreSQL only. The runner wraps migrations and fixtures in ROLLBACK.
CREATE FUNCTION pg_temp.assert_true(ok boolean, message text) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%', message; END IF; END $$;

INSERT INTO auth.users(id, email) VALUES
 ('00000000-0000-4000-8000-000000000901', 'attendance-admin@example.invalid'),
 ('00000000-0000-4000-8000-000000000902', 'attendance-operator@example.invalid'),
 ('00000000-0000-4000-8000-000000000903', 'attendance-promoter@example.invalid'),
 ('00000000-0000-4000-8000-000000000904', 'attendance-inactive@example.invalid'),
 ('00000000-0000-4000-8000-000000000905', 'attendance-escalation@example.invalid'),
 ('00000000-0000-4000-8000-000000000906', 'attendance-manager@example.invalid');
INSERT INTO public.profiles(id, email, name, role, status) VALUES
 ('00000000-0000-4000-8000-000000000901', 'attendance-admin@example.invalid', 'Test Admin', 'admin', 'ativo'),
 ('00000000-0000-4000-8000-000000000902', 'attendance-operator@example.invalid', 'Test Operator', 'operador', 'ativo'),
 ('00000000-0000-4000-8000-000000000903', 'attendance-promoter@example.invalid', 'Test Promoter', 'promotor', 'ativo'),
 ('00000000-0000-4000-8000-000000000904', 'attendance-inactive@example.invalid', 'Test Inactive', 'admin', 'inativo'),
 ('00000000-0000-4000-8000-000000000906', 'attendance-manager@example.invalid', 'Test Manager', 'gestor', 'ativo')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status;
DELETE FROM public.profiles WHERE id = '00000000-0000-4000-8000-000000000905';
INSERT INTO public.promotores(matricula, nome, cidade, uf, status) VALUES ('TEST_ATTENDANCE_901', 'Test Attendance', 'Test City', 'SP', 'ativo'), ('TEST_ATTENDANCE_902', 'Other Attendance', 'Test City', 'SP', 'ativo');
INSERT INTO public.industrias(codigo,nome,status) VALUES ('TEST_ATTENDANCE_IND','Test Industry','ativo');
INSERT INTO public.lojas(codigo,nome,cidade,uf,status) VALUES ('TEST_ATTENDANCE_STORE','Test Store','Test City','SP','ativo');
INSERT INTO public.visits(promotor_matricula,loja_codigo,industria_codigo,data_visita,status,started_at,latitude,longitude)
SELECT 'TEST_ATTENDANCE_901',codigo,'TEST_ATTENDANCE_IND','2026-10-19','em_andamento','2026-10-19T11:00:00Z',-23.55,-46.63 FROM public.lojas WHERE nome='Test Store';
CREATE TEMP TABLE original_visits AS SELECT * FROM public.visits;
UPDATE public.profiles SET promotor_matricula = 'TEST_ATTENDANCE_901' WHERE id = '00000000-0000-4000-8000-000000000903';
INSERT INTO public.promoter_absences(promotor_matricula,tipo,data_inicio,data_fim,data_aprovacao)
VALUES ('TEST_ATTENDANCE_901','folga','2026-10-19','2026-10-19','2026-10-18'), ('TEST_ATTENDANCE_902','folga','2026-10-19','2026-10-19','2026-10-18');
INSERT INTO public.promoter_work_schedules(promotor_matricula,dia_semana,hora_inicio,hora_fim)
VALUES ('TEST_ATTENDANCE_901','segunda','08:00','17:00'), ('TEST_ATTENDANCE_902','segunda','08:00','17:00');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000901',true);
SELECT public.set_promoter_attendance_override('TEST_ATTENDANCE_901','2026-10-19','presente','First manual reason',NULL);
SELECT public.set_promoter_attendance_override('TEST_ATTENDANCE_901','2026-10-19','atestado_aprovado','Second manual reason',2);
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.promoter_attendance_records WHERE promotor_matricula='TEST_ATTENDANCE_901'), 'one record per day');
SELECT pg_temp.assert_true((SELECT count(*) = 2 FROM public.promoter_attendance_audit_log WHERE promotor_matricula='TEST_ATTENDANCE_901'), 'two audit entries');
SELECT pg_temp.assert_true(EXISTS(SELECT 1 FROM public.promoter_attendance_audit_log WHERE promotor_matricula='TEST_ATTENDANCE_901' AND previous_value->>'override_status'='presente' AND new_value->>'override_status'='atestado_aprovado' AND changed_by='00000000-0000-4000-8000-000000000901' AND changed_at IS NOT NULL AND justification='Second manual reason'), 'old/new values and actor');
DO $$ BEGIN
  BEGIN
    DELETE FROM public.promoter_attendance_audit_log;
    RAISE EXCEPTION 'direct audit delete was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.promoter_attendance_records SET override_status='falta';
    RAISE EXCEPTION 'direct record update was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.set_promoter_attendance_override('TEST_ATTENDANCE_901','2026-10-19','falta','x',NULL);
    RAISE EXCEPTION 'short justification was allowed';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'short justification was allowed' THEN RAISE; END IF; END;
END $$;

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000902',true);
DO $$ BEGIN
  BEGIN
    PERFORM public.set_promoter_attendance_override('TEST_ATTENDANCE_901','2026-10-19','falta','Operator attempt',NULL);
    RAISE EXCEPTION 'operator mutation allowed';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM='operator mutation allowed' THEN RAISE; END IF; END;
END $$;
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.promoter_attendance_audit_log), 'operator cannot read audit');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.promoter_attendance_records WHERE promotor_matricula='TEST_ATTENDANCE_901'), 'operator cannot read free-text reasons');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.attendance_override_summary WHERE promotor_matricula='TEST_ATTENDANCE_901'), 'operator reads classification summary');
DO $$ BEGIN
  BEGIN
    UPDATE public.profiles SET promotor_matricula='TEST_ATTENDANCE_902' WHERE id=auth.uid();
    RAISE EXCEPTION 'promoter impersonation allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000903',true);
SELECT pg_temp.assert_true(public.is_promoter_on_absence('TEST_ATTENDANCE_902','2026-10-19')='[]'::jsonb, 'RPC must obey absence RLS');
SELECT pg_temp.assert_true(public.get_promoter_schedule('TEST_ATTENDANCE_902','segunda')='[]'::jsonb, 'RPC must obey schedule RLS');
SELECT pg_temp.assert_true(jsonb_array_length(public.is_promoter_on_absence('TEST_ATTENDANCE_901','2026-10-19'))=1, 'promoter sees own absence');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.promoter_attendance_records), 'promoter cannot read overrides');

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000904',true);
DO $$ BEGIN
  BEGIN
    PERFORM public.set_promoter_attendance_override('TEST_ATTENDANCE_901','2026-10-19','falta','Inactive attempt',NULL);
    RAISE EXCEPTION 'inactive mutation allowed';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM='inactive mutation allowed' THEN RAISE; END IF; END;
END $$;
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.promoter_attendance_records), 'inactive cannot read overrides');

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000905',true);
DO $$ BEGIN
  BEGIN
    INSERT INTO public.profiles(id,email,name,role,status) VALUES ('00000000-0000-4000-8000-000000000905','attendance-escalation@example.invalid','Escalation','admin','ativo');
    RAISE EXCEPTION 'self escalation allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000906',true);
SELECT public.set_promoter_attendance_override('TEST_ATTENDANCE_902','2026-10-19','sem_registro','Manager review',NULL);
SELECT pg_temp.assert_true(EXISTS(SELECT 1 FROM public.promoter_attendance_audit_log WHERE promotor_matricula='TEST_ATTENDANCE_902' AND changed_by=auth.uid()), 'manager may write with audit');
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN
    PERFORM public.set_promoter_attendance_override('TEST_ATTENDANCE_901','2026-10-19','falta','Anonymous attempt',NULL);
    RAISE EXCEPTION 'anonymous mutation allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT 'attendance permission and audit checks passed' AS result;
SELECT pg_temp.assert_true(NOT EXISTS((SELECT * FROM public.visits EXCEPT SELECT * FROM original_visits) UNION ALL (SELECT * FROM original_visits EXCEPT SELECT * FROM public.visits)), 'original telemetry preserved');
