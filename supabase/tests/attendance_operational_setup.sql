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
