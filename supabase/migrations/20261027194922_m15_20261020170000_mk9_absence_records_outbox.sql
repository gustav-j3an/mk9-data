-- Persist local absence drafts and prepare a future CRM outbox. No external write is performed.
BEGIN;

CREATE TABLE public.mk9_absence_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alocacao_id uuid NOT NULL REFERENCES public.mk9_alocacoes(id) ON DELETE RESTRICT,
  promotor_id uuid NOT NULL,
  colaborador_nome text NOT NULL CHECK (length(btrim(colaborador_nome)) BETWEEN 1 AND 200),
  matricula_interna text NOT NULL,
  matricula_externa text NOT NULL,
  projeto_crm uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('Falta','Atestado')),
  data_inicio date NOT NULL,
  data_fim date NOT NULL,
  previsao_retorno date NOT NULL,
  justificativa text NOT NULL CHECK (length(btrim(justificativa)) BETWEEN 1 AND 500),
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','pronto_para_envio')),
  responsavel_id uuid NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT statement_timestamp(),
  atualizado_em timestamptz NOT NULL DEFAULT statement_timestamp(),
  CHECK (data_inicio <= data_fim AND data_fim <= previsao_retorno),
  CONSTRAINT mk9_absence_records_no_duplicate UNIQUE (alocacao_id,tipo,data_inicio,data_fim)
);
CREATE INDEX mk9_absence_records_responsavel_created ON public.mk9_absence_records(responsavel_id,criado_em DESC);
CREATE INDEX mk9_absence_records_status ON public.mk9_absence_records(status,criado_em);
ALTER TABLE public.mk9_absence_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mk9_absence_records FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.mk9_absence_records FROM PUBLIC,anon,authenticated;
CREATE POLICY mk9_absence_records_deny_direct ON public.mk9_absence_records AS RESTRICTIVE
  FOR ALL TO authenticated USING(false) WITH CHECK(false);

CREATE TABLE public.mk9_absence_send_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id uuid NOT NULL REFERENCES public.mk9_absence_records(id) ON DELETE RESTRICT,
  idempotency_key uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  status text NOT NULL DEFAULT 'aguardando_homologacao'
    CHECK (status IN ('aguardando_homologacao','na_fila','processando','sucesso','erro','retentativa')),
  request_reference text,
  response_status integer CHECK (response_status BETWEEN 100 AND 599),
  error_code text CHECK (error_code IS NULL OR length(error_code)<=80),
  error_message text CHECK (error_message IS NULL OR length(error_message)<=500),
  tentativas integer NOT NULL DEFAULT 0 CHECK (tentativas>=0),
  criado_em timestamptz NOT NULL DEFAULT statement_timestamp(),
  atualizado_em timestamptz NOT NULL DEFAULT statement_timestamp(),
  UNIQUE(record_id)
);
CREATE INDEX mk9_absence_send_attempts_record ON public.mk9_absence_send_attempts(record_id,criado_em DESC);
ALTER TABLE public.mk9_absence_send_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mk9_absence_send_attempts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.mk9_absence_send_attempts FROM PUBLIC,anon,authenticated;
CREATE POLICY mk9_absence_attempts_deny_direct ON public.mk9_absence_send_attempts AS RESTRICTIVE
  FOR ALL TO authenticated USING(false) WITH CHECK(false);

CREATE TABLE public.mk9_absence_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  record_id uuid NOT NULL REFERENCES public.mk9_absence_records(id) ON DELETE RESTRICT,
  autor_id uuid NOT NULL,
  acao text NOT NULL CHECK (acao IN ('criado','editado','enfileirado','resultado_envio')),
  campos_alterados text[] NOT NULL DEFAULT '{}',
  criado_em timestamptz NOT NULL DEFAULT statement_timestamp()
);
CREATE INDEX mk9_absence_audit_record ON public.mk9_absence_audit(record_id,criado_em DESC);
ALTER TABLE public.mk9_absence_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mk9_absence_audit FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.mk9_absence_audit FROM PUBLIC,anon,authenticated;
CREATE POLICY mk9_absence_audit_deny_direct ON public.mk9_absence_audit AS RESTRICTIVE
  FOR ALL TO authenticated USING(false) WITH CHECK(false);

CREATE OR REPLACE FUNCTION mk9_rh_private.save_absence_draft(
  p_alocacao_id uuid,p_tipo text,p_data_inicio date,p_data_fim date,
  p_previsao_retorno date,p_justificativa text,p_record_id uuid DEFAULT NULL
) RETURNS public.mk9_absence_records
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE caller uuid := (SELECT auth.uid()); allocation public.mk9_alocacoes%ROWTYPE;
        promoter public.promotores%ROWTYPE; identity_state text; result public.mk9_absence_records%ROWTYPE;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  IF NOT mk9_rh_private.can_prepare_absences() THEN RAISE EXCEPTION 'faltas_atestados_prepare permission required' USING ERRCODE='42501'; END IF;
  IF p_alocacao_id IS NULL OR p_tipo IS NULL OR p_tipo NOT IN ('Falta','Atestado') OR p_data_inicio IS NULL OR p_data_fim IS NULL
    OR p_previsao_retorno IS NULL OR p_data_inicio > p_data_fim OR p_data_fim > p_previsao_retorno
    OR p_justificativa IS NULL OR length(btrim(p_justificativa)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Invalid absence fields' USING ERRCODE='22023';
  END IF;
  SELECT a.* INTO allocation FROM public.mk9_alocacoes a
    JOIN public.mk9_identidades i ON i.promotor_id=a.promotor_id AND i.estado='aprovado' AND i.aprovado_por IS NOT NULL
    WHERE a.id=p_alocacao_id AND a.estado='aprovado' AND a.aprovado_por IS NOT NULL
      AND a.valido_desde<=statement_timestamp() AND (a.valido_ate IS NULL OR statement_timestamp()<a.valido_ate)
      AND p_data_inicio>=a.ocorrencias_desde AND (a.ocorrencias_ate IS NULL OR p_data_fim<=a.ocorrencias_ate);
  IF NOT FOUND THEN RAISE EXCEPTION 'Approved and current CRM binding required' USING ERRCODE='42501'; END IF;
  IF (p_data_inicio::timestamp AT TIME ZONE 'UTC') < allocation.valido_desde
    OR ((p_data_fim+1)::timestamp AT TIME ZONE 'UTC') > coalesce(allocation.valido_ate,'infinity'::timestamptz) THEN
    RAISE EXCEPTION 'Occurrence outside allocation validity' USING ERRCODE='22023';
  END IF;
  SELECT i.estado INTO identity_state FROM public.mk9_identidades i WHERE i.promotor_id=allocation.promotor_id;
  SELECT p.* INTO promoter FROM public.promotores p WHERE p.id=allocation.promotor_id AND p.status='ativo';
  IF identity_state<>'aprovado' OR promoter.id IS NULL THEN RAISE EXCEPTION 'Approved active collaborator required' USING ERRCODE='42501'; END IF;

  IF p_record_id IS NULL THEN
    INSERT INTO public.mk9_absence_records(alocacao_id,promotor_id,colaborador_nome,matricula_interna,matricula_externa,projeto_crm,
      tipo,data_inicio,data_fim,previsao_retorno,justificativa,responsavel_id)
    VALUES(allocation.id,promoter.id,promoter.nome,promoter.matricula,allocation.matricula_externa,allocation.projeto_externo_id,
      p_tipo,p_data_inicio,p_data_fim,p_previsao_retorno,btrim(p_justificativa),caller)
    RETURNING * INTO result;
    INSERT INTO public.mk9_absence_audit(record_id,autor_id,acao,campos_alterados)
      VALUES(result.id,caller,'criado',ARRAY['alocacao_id','tipo','data_inicio','data_fim','previsao_retorno','justificativa']);
  ELSE
    SELECT r.* INTO result FROM public.mk9_absence_records r WHERE r.id=p_record_id AND r.responsavel_id=caller FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Draft not found' USING ERRCODE='P0002'; END IF;
    IF result.status<>'rascunho' THEN RAISE EXCEPTION 'Only drafts can be edited' USING ERRCODE='55000'; END IF;
    UPDATE public.mk9_absence_records SET alocacao_id=allocation.id,promotor_id=promoter.id,colaborador_nome=promoter.nome,
      matricula_interna=promoter.matricula,matricula_externa=allocation.matricula_externa,
      projeto_crm=allocation.projeto_externo_id,tipo=p_tipo,data_inicio=p_data_inicio,data_fim=p_data_fim,
      previsao_retorno=p_previsao_retorno,justificativa=btrim(p_justificativa),atualizado_em=statement_timestamp()
      WHERE id=p_record_id RETURNING * INTO result;
    INSERT INTO public.mk9_absence_audit(record_id,autor_id,acao,campos_alterados)
      VALUES(result.id,caller,'editado',ARRAY['alocacao_id','tipo','data_inicio','data_fim','previsao_retorno','justificativa']);
  END IF;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION mk9_rh_private.save_absence_draft(uuid,text,date,date,date,text,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.mk9_faltas_atestados_save_draft(
  p_alocacao_id uuid,p_tipo text,p_data_inicio date,p_data_fim date,
  p_previsao_retorno date,p_justificativa text,p_record_id uuid DEFAULT NULL
) RETURNS public.mk9_absence_records
LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $$ SELECT * FROM mk9_rh_private.save_absence_draft(p_alocacao_id,p_tipo,p_data_inicio,p_data_fim,p_previsao_retorno,p_justificativa,p_record_id); $$;
REVOKE ALL ON FUNCTION public.mk9_faltas_atestados_save_draft(uuid,text,date,date,date,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mk9_faltas_atestados_save_draft(uuid,text,date,date,date,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.mk9_faltas_atestados_local_records()
RETURNS SETOF public.mk9_absence_records
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  IF NOT mk9_rh_private.can_prepare_absences() THEN RAISE EXCEPTION 'faltas_atestados_prepare permission required' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT r.* FROM public.mk9_absence_records r WHERE r.responsavel_id=auth.uid() ORDER BY r.criado_em DESC LIMIT 500;
END;
$$;
REVOKE ALL ON FUNCTION public.mk9_faltas_atestados_local_records() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mk9_faltas_atestados_local_records() TO authenticated;

CREATE OR REPLACE FUNCTION public.mk9_faltas_atestados_enqueue_draft(p_record_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE record public.mk9_absence_records%ROWTYPE; attempt_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT mk9_rh_private.can_prepare_absences() THEN RAISE EXCEPTION 'Not authorised' USING ERRCODE='42501'; END IF;
  SELECT r.* INTO record FROM public.mk9_absence_records r WHERE r.id=p_record_id AND r.responsavel_id=auth.uid();
  IF NOT FOUND OR record.status NOT IN ('rascunho','pronto_para_envio') THEN RAISE EXCEPTION 'Record is not eligible' USING ERRCODE='55000'; END IF;
  -- Deliberately blocked until an official write contract is homologated. No POST worker exists.
  INSERT INTO public.mk9_absence_send_attempts(record_id,status)
    VALUES(record.id,'aguardando_homologacao')
    ON CONFLICT(record_id) DO UPDATE SET atualizado_em=statement_timestamp()
    RETURNING id INTO attempt_id;
  UPDATE public.mk9_absence_records SET status='pronto_para_envio',atualizado_em=statement_timestamp() WHERE id=record.id;
  INSERT INTO public.mk9_absence_audit(record_id,autor_id,acao,campos_alterados)
    VALUES(record.id,auth.uid(),'enfileirado',ARRAY['status','tentativa_idempotente']);
  RETURN attempt_id;
END;
$$;
REVOKE ALL ON FUNCTION public.mk9_faltas_atestados_enqueue_draft(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mk9_faltas_atestados_enqueue_draft(uuid) TO authenticated;

COMMIT;
