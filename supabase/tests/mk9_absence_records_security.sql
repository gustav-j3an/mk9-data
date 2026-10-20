-- Synthetic local end-to-end test. Run only on the local disposable database; all rows roll back.
BEGIN;
INSERT INTO public.profiles(id,name,role,status) VALUES
 ('71000000-0000-0000-0000-000000000001','Absence test user','admin','ativo');
INSERT INTO public.promotores(id,matricula,nome,status,equipe) VALUES
 ('72000000-0000-0000-0000-000000000001','PRM-ABS-LOCAL','Colaborador sintético','ativo','Equipe teste');
INSERT INTO public.mk9_identidades(promotor_id,estado,aprovado_por,aprovado_em,referencia) VALUES
 ('72000000-0000-0000-0000-000000000001','aprovado','71000000-0000-0000-0000-000000000001',now(),'Teste sintético local');
INSERT INTO public.mk9_alocacoes(id,promotor_id,projeto_externo_id,matricula_externa,ocorrencias_desde,valido_desde,estado,aprovado_por,aprovado_em,referencia) VALUES
 ('73000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000001','65f7e80f-f615-4ceb-9b8d-80db170735dc','EXT-ABS-001',current_date-1,now()-interval '1 day','aprovado','71000000-0000-0000-0000-000000000001',now(),'Teste sintético local');
INSERT INTO mk9_rh_private.absence_prepare_permissions(usuario_id,ativo,concedido_por,referencia)
 VALUES('71000000-0000-0000-0000-000000000001',true,'71000000-0000-0000-0000-000000000001','Teste sintético local');
CREATE TEMP TABLE operational_before AS SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY id)::text,'')) AS fingerprint FROM public.promotores p;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
DO $$
DECLARE created public.mk9_absence_records%ROWTYPE; edited public.mk9_absence_records%ROWTYPE;
        queued uuid; queued_again uuid; row_count integer;
BEGIN
  created := public.mk9_faltas_atestados_save_draft(
    '73000000-0000-0000-0000-000000000001','Atestado',current_date,current_date,current_date,'Repouso recomendado.');
  IF created.colaborador_nome<>'Colaborador sintético' OR created.matricula_interna<>'PRM-ABS-LOCAL' OR created.matricula_externa<>'EXT-ABS-001'
    OR created.projeto_crm<>'65f7e80f-f615-4ceb-9b8d-80db170735dc'::uuid OR created.status<>'rascunho'
    OR created.responsavel_id<>auth.uid() THEN RAISE EXCEPTION 'Saved launch did not resolve its approved binding'; END IF;
  edited := public.mk9_faltas_atestados_save_draft(
    created.alocacao_id,'Falta',current_date,current_date,current_date,'Justificativa editada.',created.id);
  IF edited.id<>created.id OR edited.tipo<>'Falta' OR edited.justificativa<>'Justificativa editada.' THEN RAISE EXCEPTION 'Draft edit failed'; END IF;
  SELECT count(*) INTO row_count FROM public.mk9_faltas_atestados_local_records() WHERE id=created.id;
  IF row_count<>1 THEN RAISE EXCEPTION 'Saved local record was not readable by its owner'; END IF;
  BEGIN
    PERFORM public.mk9_faltas_atestados_save_draft(created.alocacao_id,'Falta',current_date,current_date,current_date,'Duplicado.');
    RAISE EXCEPTION 'Duplicate occurrence accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN
    PERFORM public.mk9_faltas_atestados_save_draft(created.alocacao_id,'Falta',current_date,current_date-2,current_date,'Datas inválidas.');
    RAISE EXCEPTION 'Invalid period accepted';
  EXCEPTION WHEN invalid_parameter_value OR check_violation THEN NULL; END;
  queued := public.mk9_faltas_atestados_enqueue_draft(created.id);
  queued_again := public.mk9_faltas_atestados_enqueue_draft(created.id);
  IF queued<>queued_again THEN RAISE EXCEPTION 'Outbox idempotency key changed for the same record'; END IF;
  BEGIN
    PERFORM public.mk9_faltas_atestados_save_draft(created.alocacao_id,'Falta',current_date,current_date-2,current_date,'Datas inválidas.');
    RAISE EXCEPTION 'Invalid period accepted';
  EXCEPTION WHEN invalid_parameter_value OR check_violation THEN NULL; END;
END $$;
RESET ROLE;
-- Audit tables are private; assert records are emitted through the privileged writer in the test transaction.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.mk9_absence_records WHERE justificativa='Justificativa editada.') THEN RAISE EXCEPTION 'Edited local record missing'; END IF;
  IF (SELECT count(*) FROM public.mk9_absence_audit) < 2 THEN RAISE EXCEPTION 'Create/edit audit entries missing'; END IF;
END $$;
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  BEGIN PERFORM * FROM public.mk9_absence_records; RAISE EXCEPTION 'Direct table read bypassed RPC boundary';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO public.mk9_absence_records(alocacao_id,promotor_id,colaborador_nome,matricula_interna,matricula_externa,projeto_crm,tipo,data_inicio,data_fim,previsao_retorno,justificativa,responsavel_id)
    VALUES('73000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000001','Forged','FORGED','FORGED','65f7e80f-f615-4ceb-9b8d-80db170735dc','Falta',current_date,current_date,current_date,'Forged',auth.uid());
    RAISE EXCEPTION 'Direct table write bypassed RPC boundary';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

UPDATE public.mk9_alocacoes SET estado='revogado' WHERE id='73000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  BEGIN PERFORM public.mk9_faltas_atestados_save_draft('73000000-0000-0000-0000-000000000001','Falta',current_date,current_date,current_date,'Revogado.');
    RAISE EXCEPTION 'Revoked binding accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

DO $$
BEGIN
  IF (SELECT fingerprint FROM operational_before)<>(SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY id)::text,'')) FROM public.promotores p)
    THEN RAISE EXCEPTION 'Operational attendance data changed'; END IF;
END $$;
ROLLBACK;
SELECT 'PASS: local absence create/edit, server-resolved binding, permissions, RLS, dates, duplicate guard, audit, idempotent outbox and operational independence' AS result;
