-- Synthetic local database coverage. Never run against linked/production DB.
BEGIN;
CREATE FUNCTION pg_temp.vr_assert(ok boolean, message text) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%', message; END IF; END $$;

SELECT set_config('request.jwt.claim.sub', '', true);
SELECT pg_temp.vr_assert(
  date '2026-10-22' - CASE WHEN time '06:00' < time '22:00' AND time '02:00' < time '06:00' THEN 1 ELSE 0 END = date '2026-10-21',
  'overnight schedule assigns 02:00 to the previous operational date'
);
INSERT INTO auth.users(id,email) VALUES
 ('00000000-0000-4000-8000-000000001101','vr-admin@example.invalid'),
 ('00000000-0000-4000-8000-000000001102','vr-supervisor@example.invalid'),
 ('00000000-0000-4000-8000-000000001103','vr-promoter@example.invalid'),
 ('00000000-0000-4000-8000-000000001104','vr-outsider@example.invalid'),
 ('00000000-0000-4000-8000-000000001105','vr-other-promoter@example.invalid')
ON CONFLICT(id) DO NOTHING;
INSERT INTO public.profiles(id,email,name,role,status) VALUES
 ('00000000-0000-4000-8000-000000001101','vr-admin@example.invalid','VR Admin','admin','ativo'),
 ('00000000-0000-4000-8000-000000001102','vr-supervisor@example.invalid','VR Supervisor','gestor','ativo'),
 ('00000000-0000-4000-8000-000000001103','vr-promoter@example.invalid','VR Promoter','promotor','ativo'),
 ('00000000-0000-4000-8000-000000001104','vr-outsider@example.invalid','VR Outsider','gestor','ativo'),
 ('00000000-0000-4000-8000-000000001105','vr-other-promoter@example.invalid','VR Other Promoter','promotor','ativo')
ON CONFLICT(id) DO UPDATE SET role=EXCLUDED.role,status=EXCLUDED.status;
INSERT INTO public.promotores(matricula,nome,cidade,uf,status,equipe) VALUES
 ('VR-REG-A','VR Promoter','Synthetic','SP','ativo','VR-TEAM'),
 ('VR-REG-B','VR Other Promoter','Synthetic','SP','ativo','SP')
ON CONFLICT(matricula) DO UPDATE SET equipe=EXCLUDED.equipe;
UPDATE public.profiles SET promotor_matricula='VR-REG-A' WHERE id='00000000-0000-4000-8000-000000001103';
UPDATE public.profiles SET promotor_matricula='VR-REG-B' WHERE id='00000000-0000-4000-8000-000000001105';
INSERT INTO public.supervisores(id,codigo,nome,status,user_id) VALUES
 ('00000000-0000-4000-8000-000000001106','VR-SUP-A','VR Supervisor','ativo','00000000-0000-4000-8000-000000001102'),
 ('00000000-0000-4000-8000-000000001107','VR-SUP-B','VR Other Supervisor','ativo','00000000-0000-4000-8000-000000001104')
ON CONFLICT(id) DO NOTHING;
INSERT INTO public.equipes(codigo,nome,status,supervisor_id) VALUES
 ('VR-CODE-A','VR-TEAM','ativa','00000000-0000-4000-8000-000000001106'),
 ('VR-CODE-B','VR-OTHER-TEAM','ativa','00000000-0000-4000-8000-000000001107')
ON CONFLICT(nome) DO NOTHING;
UPDATE public.promotores SET equipe='VR-OTHER-TEAM' WHERE matricula='VR-REG-B';
INSERT INTO public.industrias(codigo,nome,status) VALUES ('VR-IND','VR Industry','ativo') ON CONFLICT(codigo) DO NOTHING;
INSERT INTO public.lojas(codigo,nome,cidade,uf,status) VALUES
 ('VR-STORE-A','VR Store A','Synthetic','SP','ativo'),('VR-STORE-B','VR Store B','Synthetic','SP','ativo')
ON CONFLICT(codigo) DO NOTHING;
INSERT INTO public.rotas(codigo_rota,promotor_matricula,loja_codigo,industria_codigo,frequencia,uf,segunda,terca,quarta,quinta,sexta,sabado,domingo)
VALUES ('VR-ROUTE-A','VR-REG-A','VR-STORE-A','VR-IND','SEMANAL','SP',true,true,true,true,true,true,true),
       ('VR-ROUTE-B','VR-REG-A','VR-STORE-B','VR-IND','SEMANAL','SP',true,true,true,true,true,true,true),
       ('VR-ROUTE-OTHER','VR-REG-B','VR-STORE-A','VR-IND','SEMANAL','SP',true,true,true,true,true,true,true);
INSERT INTO public.promoter_operation_authorizations(promotor_matricula,status,justification)
VALUES ('VR-REG-A','liberado','Synthetic local visit regularization test'),('VR-REG-B','liberado','Synthetic local visit regularization test')
ON CONFLICT(promotor_matricula) DO UPDATE SET status=EXCLUDED.status;
WITH operational AS (
  SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date
    - CASE WHEN time '06:00' < time '22:00' AND (now() AT TIME ZONE 'America/Sao_Paulo')::time < time '06:00' THEN 1 ELSE 0 END AS d
)
INSERT INTO public.promoter_work_schedules(id,promotor_matricula,dia_semana,hora_inicio,hora_fim,ativo,timezone,is_exception)
SELECT '00000000-0000-4000-8000-000000001108','VR-REG-A',
  (ARRAY['domingo','segunda','terca','quarta','quinta','sexta','sabado'])[extract(dow FROM d)::int+1],
  time '22:00',time '06:00',true,'America/Sao_Paulo',false FROM operational;

INSERT INTO public.visits(id,promotor_matricula,loja_codigo,industria_codigo,data_visita,started_at,status)
VALUES
 ('00000000-0000-4000-8000-000000001111','VR-REG-A','VR-STORE-A','VR-IND',(now() AT TIME ZONE 'America/Sao_Paulo')::date-3,now()-interval '3 days','em_andamento'),
 ('00000000-0000-4000-8000-000000001112','VR-REG-A','VR-STORE-B','VR-IND',(now() AT TIME ZONE 'America/Sao_Paulo')::date-3,now()-interval '3 days','em_andamento'),
 ('00000000-0000-4000-8000-000000001113','VR-REG-B','VR-STORE-A','VR-IND',(now() AT TIME ZONE 'America/Sao_Paulo')::date-3,now()-interval '3 days','em_andamento'),
 ('00000000-0000-4000-8000-000000001114','VR-REG-B','VR-STORE-B','VR-IND',(now() AT TIME ZONE 'America/Sao_Paulo')::date-3,now()-interval '3 days','em_andamento');
INSERT INTO public.visit_photos(visit_id,tipo_foto,storage_path,file_url,legenda)
VALUES ('00000000-0000-4000-8000-000000001112','fachada','synthetic/vr-proof.jpg','synthetic','Existing proof');
INSERT INTO public.visit_checklist_items(visit_id,item_key,item_label,checked,valor_texto)
VALUES ('00000000-0000-4000-8000-000000001112','proof','Existing completed item',true,''),
       ('00000000-0000-4000-8000-000000001114','old','Old visit item',false,'');
CREATE TEMP TABLE vr_original AS SELECT id,status,started_at,completed_at,latitude,longitude,checkout_latitude,checkout_longitude FROM public.visits WHERE id IN ('00000000-0000-4000-8000-000000001111','00000000-0000-4000-8000-000000001112');
CREATE TEMP TABLE vr_evidence_original AS
SELECT v.id,
  (SELECT count(*) FROM public.visit_photos ph WHERE ph.visit_id=v.id) AS photos,
  (SELECT count(*) FROM public.visit_checklist_items ci WHERE ci.visit_id=v.id) AS checklist,
  (SELECT count(*) FROM public.visit_occurrences o WHERE o.visit_id=v.id) AS occurrences,
  (SELECT count(*) FROM public.visit_product_validity pv WHERE pv.visit_id=v.id) AS validity
FROM public.visits v WHERE v.id='00000000-0000-4000-8000-000000001112';
GRANT SELECT ON vr_original, vr_evidence_original TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000001103',true);
DO $$ BEGIN
  BEGIN PERFORM public.attendance_regularize_visit('00000000-0000-4000-8000-000000001111','closed_without_execution_proof','Promoter attempt');
    RAISE EXCEPTION 'promoter was allowed to regularize';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
DO $$ BEGIN
  BEGIN PERFORM public.attendance_check_out('00000000-0000-4000-8000-000000001111',NULL,NULL,NULL,'old visit attempt');
    RAISE EXCEPTION 'promoter was allowed to close old visit';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000001105',true);
DO $$ BEGIN
  BEGIN UPDATE public.visits SET status='concluida',completed_at=now() WHERE id='00000000-0000-4000-8000-000000001114';
    RAISE EXCEPTION 'promoter direct update of old visit was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
UPDATE public.visit_checklist_items SET checked=true WHERE visit_id='00000000-0000-4000-8000-000000001114';
SELECT pg_temp.vr_assert((SELECT checked=false FROM public.visit_checklist_items WHERE visit_id='00000000-0000-4000-8000-000000001114'),'promoter evidence write on an old visit is denied');

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000001102',true);
SELECT pg_temp.vr_assert((SELECT count(*)=0 FROM public.visits WHERE id='00000000-0000-4000-8000-000000001113'),'supervisor cannot select outside scope');
DO $$ BEGIN
  BEGIN PERFORM public.attendance_regularize_visit('00000000-0000-4000-8000-000000001113','closed_without_execution_proof','Out of scope');
    RAISE EXCEPTION 'supervisor was allowed outside scope';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT public.attendance_regularize_visit('00000000-0000-4000-8000-000000001111','closed_without_execution_proof','No execution evidence');
SELECT pg_temp.vr_assert((SELECT status='em_andamento' AND regularization_status='closed_without_execution_proof' FROM public.visits WHERE id='00000000-0000-4000-8000-000000001111'),'no-proof closure is a separate non-completed state');
SELECT pg_temp.vr_assert((SELECT count(*)=1 FROM public.visit_regularization_audit WHERE visit_id='00000000-0000-4000-8000-000000001111' AND acted_by=auth.uid() AND length(reason)>=5),'audit captures actor and reason');
DO $$ BEGIN
  BEGIN PERFORM public.attendance_regularize_visit('00000000-0000-4000-8000-000000001112','administratively_completed_with_proof','   ');
    RAISE EXCEPTION 'empty reason was accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM='empty reason was accepted' THEN RAISE; END IF; END;
END $$;
SELECT public.attendance_regularize_visit('00000000-0000-4000-8000-000000001112','administratively_completed_with_proof','Evidence reviewed');
SELECT pg_temp.vr_assert((SELECT status='em_andamento' AND regularization_status='administratively_completed_with_proof' FROM public.visits WHERE id='00000000-0000-4000-8000-000000001112'),'admin completion preserves operational status');
SELECT pg_temp.vr_assert((SELECT jsonb_array_length(evidence_refs)>=2 FROM public.visit_regularization_audit WHERE visit_id='00000000-0000-4000-8000-000000001112'),'audit references existing photo and checklist evidence');
SELECT pg_temp.vr_assert(NOT EXISTS(SELECT 1 FROM public.visits v JOIN vr_original o USING(id) WHERE (v.status,v.started_at,v.completed_at,v.latitude,v.longitude,v.checkout_latitude,v.checkout_longitude) IS DISTINCT FROM (o.status,o.started_at,o.completed_at,o.latitude,o.longitude,o.checkout_latitude,o.checkout_longitude)),'regularization preserves operational data');
SELECT pg_temp.vr_assert(NOT EXISTS(
  SELECT 1 FROM vr_evidence_original before
  WHERE before.photos<>(SELECT count(*) FROM public.visit_photos ph WHERE ph.visit_id=before.id)
     OR before.checklist<>(SELECT count(*) FROM public.visit_checklist_items ci WHERE ci.visit_id=before.id)
     OR before.occurrences<>(SELECT count(*) FROM public.visit_occurrences o WHERE o.visit_id=before.id)
     OR before.validity<>(SELECT count(*) FROM public.visit_product_validity pv WHERE pv.visit_id=before.id)
),'regularization preserves existing evidence rows');
DO $$ BEGIN
  BEGIN PERFORM public.attendance_regularize_visit('00000000-0000-4000-8000-000000001112','closed_without_execution_proof','Second action');
    RAISE EXCEPTION 'second decision was accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM='second decision was accepted' THEN RAISE; END IF; END;
END $$;

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000001101',true);
DO $$ BEGIN
  BEGIN PERFORM public.attendance_regularize_visit('00000000-0000-4000-8000-000000001114','administratively_completed_with_proof','Evidence review');
    RAISE EXCEPTION 'completion without sufficient evidence was allowed';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM='completion without sufficient evidence was allowed' THEN RAISE; END IF; END;
END $$;
SELECT pg_temp.vr_assert((SELECT regularization_status IS NULL FROM public.visits WHERE id='00000000-0000-4000-8000-000000001114'),'failed completion leaves visit untouched');
SELECT public.attendance_regularize_visit('00000000-0000-4000-8000-000000001113','closed_without_execution_proof','Admin global review');
SELECT pg_temp.vr_assert((SELECT acted_by=auth.uid() FROM public.visit_regularization_audit WHERE visit_id='00000000-0000-4000-8000-000000001113'),'admin global action is audited');

-- The same promoter's old open visits do not block today's check-in; the
-- same-day lock still makes a repeated occurrence idempotent.
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000001103',true);
SELECT pg_temp.vr_assert(NOT attendance_private.photo_upload_allowed('visits/00000000-0000-4000-8000-000000001111/blocked.jpg'),'regularized visits cannot receive new promoter photo evidence');
CREATE TEMP TABLE vr_checkin_first AS SELECT (public.attendance_check_in('VR-STORE-A','VR-IND',NULL,NULL,NULL,NULL)).*;
CREATE TEMP TABLE vr_checkin_retry AS SELECT (public.attendance_check_in('VR-STORE-A','VR-IND',NULL,NULL,NULL,NULL)).*;
SELECT pg_temp.vr_assert((SELECT a.id=b.id AND a.started_at=b.started_at FROM vr_checkin_first a,vr_checkin_retry b),'duplicate occurrence returns the same active visit');
SELECT pg_temp.vr_assert((SELECT work_schedule_id='00000000-0000-4000-8000-000000001108' FROM vr_checkin_first),'check-in captures the overnight schedule');
SELECT pg_temp.vr_assert((SELECT data_visita=(now() AT TIME ZONE 'America/Sao_Paulo')::date - CASE WHEN time '06:00' < time '22:00' AND (now() AT TIME ZONE 'America/Sao_Paulo')::time < time '06:00' THEN 1 ELSE 0 END FROM vr_checkin_first),'check-in uses the overnight operational date');
SELECT pg_temp.vr_assert((SELECT attendance_private.photo_upload_allowed('visits/'||id::text||'/allowed.jpg') FROM vr_checkin_first),'current active visit keeps promoter photo evidence permission');
DO $$ BEGIN
  BEGIN PERFORM public.attendance_check_in('VR-STORE-B','VR-IND',NULL,NULL,NULL,NULL);
    RAISE EXCEPTION 'second active visit on same day was allowed';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM='second active visit on same day was allowed' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
DO $$ BEGIN
  BEGIN UPDATE public.visit_regularization_audit SET reason='Tampered audit entry' WHERE visit_id='00000000-0000-4000-8000-000000001111';
    RAISE EXCEPTION 'audit mutation was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT pg_temp.vr_assert((SELECT reason='No execution evidence' FROM public.visit_regularization_audit WHERE visit_id='00000000-0000-4000-8000-000000001111'),'audit event remains immutable');
ROLLBACK;
