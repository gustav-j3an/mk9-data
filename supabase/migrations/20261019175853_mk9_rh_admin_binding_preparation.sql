-- Local preparation only: this adds no outbound API calls and never approves a binding.
BEGIN;

CREATE TABLE IF NOT EXISTS mk9_rh_private.admin_permissions (
  usuario_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  ativo boolean NOT NULL DEFAULT true,
  concedido_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  concedido_em timestamptz NOT NULL DEFAULT statement_timestamp(),
  referencia text NOT NULL CHECK (length(btrim(referencia)) BETWEEN 3 AND 500),
  revogado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  revogado_em timestamptz,
  CHECK ((ativo AND revogado_em IS NULL) OR (NOT ativo AND revogado_em IS NOT NULL))
);
ALTER TABLE mk9_rh_private.admin_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mk9_rh_private.admin_permissions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON mk9_rh_private.admin_permissions FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION mk9_rh_private.require_admin()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE caller uuid := (select auth.uid());
BEGIN
  IF caller IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN mk9_rh_private.admin_permissions ap ON ap.usuario_id=p.id AND ap.ativo
    WHERE p.id=caller AND p.role='admin' AND p.status='ativo'
  ) THEN
    RAISE EXCEPTION 'Explicit MK9 RH integration administrator permission required' USING ERRCODE='42501';
  END IF;
  RETURN caller;
END;
$$;
REVOKE ALL ON FUNCTION mk9_rh_private.require_admin() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION mk9_rh_private.require_admin() TO authenticated;

CREATE OR REPLACE FUNCTION mk9_rh_private.can_manage_bindings()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN mk9_rh_private.admin_permissions ap ON ap.usuario_id=p.id AND ap.ativo
    WHERE p.id=(select auth.uid()) AND p.role='admin' AND p.status='ativo'
  );
$$;
REVOKE ALL ON FUNCTION mk9_rh_private.can_manage_bindings() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION mk9_rh_private.can_manage_bindings() TO authenticated;

DROP FUNCTION IF EXISTS public.mk9_rh_admin_bindings();
DROP FUNCTION IF EXISTS mk9_rh_private.list_bindings();
CREATE OR REPLACE FUNCTION mk9_rh_private.list_bindings(p_promotor_id uuid)
RETURNS TABLE(
  promotor_id uuid, matricula_local text, nome_local text,
  usuario_id uuid, usuario_nome text, identidade_estado text,
  identidade_aprovador uuid, identidade_aprovador_nome text, identidade_aprovado_em timestamptz,
  alocacao_id uuid, projeto_externo_id uuid, matricula_externa text,
  ocorrencias_desde date, ocorrencias_ate date, valido_desde timestamptz, valido_ate timestamptz,
  alocacao_estado text, alocacao_aprovador uuid, alocacao_aprovador_nome text,
  alocacao_aprovado_em timestamptz, referencia text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM mk9_rh_private.require_admin();
  IF p_promotor_id IS NULL THEN RAISE EXCEPTION 'Promoter is required' USING ERRCODE='22023'; END IF;
  RETURN QUERY
  SELECT pr.id,pr.matricula,pr.nome,i.usuario_id,account.name,i.estado,
    i.aprovado_por,identity_approver.name,i.aprovado_em,
    a.id,a.projeto_externo_id,a.matricula_externa,a.ocorrencias_desde,a.ocorrencias_ate,
    a.valido_desde,a.valido_ate,a.estado,a.aprovado_por,allocation_approver.name,a.aprovado_em,a.referencia
  FROM public.promotores pr
  LEFT JOIN public.mk9_identidades i ON i.promotor_id=pr.id
  LEFT JOIN public.profiles account ON account.id=i.usuario_id
  LEFT JOIN public.profiles identity_approver ON identity_approver.id=i.aprovado_por
  LEFT JOIN public.mk9_alocacoes a ON a.promotor_id=pr.id
  LEFT JOIN public.profiles allocation_approver ON allocation_approver.id=a.aprovado_por
  WHERE pr.id=p_promotor_id
  ORDER BY pr.nome,a.projeto_externo_id,a.matricula_externa;
END;
$$;
REVOKE ALL ON FUNCTION mk9_rh_private.list_bindings(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION mk9_rh_private.list_bindings(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION mk9_rh_private.prepare_allocation(
  p_promotor_id uuid,
  p_projeto_externo_id uuid,
  p_matricula_externa text,
  p_ocorrencias_desde date,
  p_ocorrencias_ate date,
  p_valido_desde timestamptz,
  p_valido_ate timestamptz,
  p_referencia text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE caller uuid; local_matricula text; identity_id uuid; user_count integer; allocation_id uuid;
BEGIN
  caller := mk9_rh_private.require_admin();
  IF p_promotor_id IS NULL OR p_projeto_externo_id IS NULL
     OR p_matricula_externa IS NULL OR p_matricula_externa='' OR p_matricula_externa<>btrim(p_matricula_externa)
     OR p_ocorrencias_desde IS NULL OR (p_ocorrencias_ate IS NOT NULL AND p_ocorrencias_ate<p_ocorrencias_desde)
     OR p_valido_desde IS NULL OR (p_valido_ate IS NOT NULL AND p_valido_ate<=p_valido_desde)
     OR p_referencia IS NULL OR length(btrim(p_referencia)) NOT BETWEEN 3 AND 500
  THEN RAISE EXCEPTION 'Invalid pending allocation input' USING ERRCODE='22023'; END IF;

  SELECT pr.matricula INTO local_matricula FROM public.promotores pr WHERE pr.id=p_promotor_id FOR KEY SHARE;
  IF local_matricula IS NULL THEN RAISE EXCEPTION 'Promoter not found' USING ERRCODE='P0002'; END IF;
  SELECT count(*) INTO user_count FROM public.profiles pf
    WHERE to_jsonb(pf)->>'promotor_matricula'=local_matricula AND pf.role='promotor' AND pf.status='ativo';
  IF user_count>1 THEN RAISE EXCEPTION 'Promoter account relationship is ambiguous' USING ERRCODE='23505'; END IF;

  SELECT i.promotor_id INTO identity_id FROM public.mk9_identidades i WHERE i.promotor_id=p_promotor_id;
  IF EXISTS(SELECT 1 FROM public.mk9_identidades i WHERE i.promotor_id=p_promotor_id AND i.estado='revogado') THEN
    RAISE EXCEPTION 'Revoked identity cannot be reused' USING ERRCODE='23514';
  END IF;
  IF identity_id IS NULL THEN
    INSERT INTO public.mk9_identidades(promotor_id,usuario_id,estado,referencia)
    SELECT p_promotor_id,
      (SELECT pf.id FROM public.profiles pf
       WHERE to_jsonb(pf)->>'promotor_matricula'=local_matricula AND pf.role='promotor' AND pf.status='ativo'),
      'pendente',p_referencia
    RETURNING promotor_id INTO identity_id;
  END IF;
  -- Existing identity rows are deliberately not reassigned or approved by this workflow.
  INSERT INTO public.mk9_alocacoes(
    promotor_id,projeto_externo_id,matricula_externa,ocorrencias_desde,ocorrencias_ate,
    valido_desde,valido_ate,estado,referencia
  ) VALUES (
    p_promotor_id,p_projeto_externo_id,p_matricula_externa,p_ocorrencias_desde,p_ocorrencias_ate,
    p_valido_desde,p_valido_ate,'pendente',p_referencia
  ) RETURNING id INTO allocation_id;
  RETURN allocation_id;
END;
$$;
REVOKE ALL ON FUNCTION mk9_rh_private.prepare_allocation(uuid,uuid,text,date,date,timestamptz,timestamptz,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION mk9_rh_private.prepare_allocation(uuid,uuid,text,date,date,timestamptz,timestamptz,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.mk9_rh_admin_can_manage()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
AS $$ SELECT mk9_rh_private.can_manage_bindings(); $$;
REVOKE ALL ON FUNCTION public.mk9_rh_admin_can_manage() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mk9_rh_admin_can_manage() TO authenticated;

CREATE OR REPLACE FUNCTION public.mk9_rh_admin_bindings(p_promotor_id uuid)
RETURNS TABLE(
  promotor_id uuid, matricula_local text, nome_local text,
  usuario_id uuid, usuario_nome text, identidade_estado text,
  identidade_aprovador uuid, identidade_aprovador_nome text, identidade_aprovado_em timestamptz,
  alocacao_id uuid, projeto_externo_id uuid, matricula_externa text,
  ocorrencias_desde date, ocorrencias_ate date, valido_desde timestamptz, valido_ate timestamptz,
  alocacao_estado text, alocacao_aprovador uuid, alocacao_aprovador_nome text,
  alocacao_aprovado_em timestamptz, referencia text
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
AS $$ SELECT * FROM mk9_rh_private.list_bindings(p_promotor_id); $$;
REVOKE ALL ON FUNCTION public.mk9_rh_admin_bindings(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mk9_rh_admin_bindings(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.mk9_rh_admin_prepare_allocation(
  p_promotor_id uuid,p_projeto_externo_id uuid,p_matricula_externa text,
  p_ocorrencias_desde date,p_ocorrencias_ate date,p_valido_desde timestamptz,
  p_valido_ate timestamptz,p_referencia text
) RETURNS uuid
LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT mk9_rh_private.prepare_allocation(
  p_promotor_id,p_projeto_externo_id,p_matricula_externa,p_ocorrencias_desde,p_ocorrencias_ate,
  p_valido_desde,p_valido_ate,p_referencia); $$;
REVOKE ALL ON FUNCTION public.mk9_rh_admin_prepare_allocation(uuid,uuid,text,date,date,timestamptz,timestamptz,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mk9_rh_admin_prepare_allocation(uuid,uuid,text,date,date,timestamptz,timestamptz,text) TO authenticated;

CREATE OR REPLACE FUNCTION mk9_rh_private.resolve_attendance(p_matricula_local text,p_data date)
RETURNS TABLE(status text,alocacoes_validas integer,projeto_externo_id uuid,matricula_externa text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE promotor uuid; caller_role text; identity_state text; total_valid integer; caller uuid;
BEGIN
  caller := (select auth.uid());
  SELECT p.role INTO caller_role FROM public.profiles p WHERE p.id=caller AND p.status='ativo';
  IF caller_role IS NULL OR caller_role NOT IN ('admin','gestor') OR p_matricula_local IS NULL OR p_data IS NULL THEN
    RAISE EXCEPTION 'Attendance integration scope is not authorised' USING ERRCODE='42501';
  END IF;
  IF caller_role='admin' AND NOT mk9_rh_private.can_manage_bindings() THEN
    RAISE EXCEPTION 'Explicit MK9 RH integration administrator permission required' USING ERRCODE='42501';
  END IF;
  SELECT pr.id INTO promotor FROM public.promotores pr WHERE pr.matricula=p_matricula_local;
  IF promotor IS NULL THEN RAISE EXCEPTION 'Promoter not found' USING ERRCODE='P0002'; END IF;
  IF caller_role='gestor' AND NOT EXISTS(
    SELECT 1 FROM public.mk9_alocacoes a JOIN public.mk9_acessos g ON g.alocacao_id=a.id
    WHERE a.promotor_id=promotor AND a.estado='aprovado' AND a.aprovado_por IS NOT NULL
      AND a.valido_desde<=statement_timestamp() AND (a.valido_ate IS NULL OR statement_timestamp()<a.valido_ate)
      AND a.ocorrencias_desde<=p_data AND (a.ocorrencias_ate IS NULL OR p_data<=a.ocorrencias_ate)
      AND g.usuario_id=caller AND g.tipo IN ('supervisao','gestao') AND g.estado='aprovado' AND g.aprovado_por IS NOT NULL
      AND g.valido_desde<=statement_timestamp() AND (g.valido_ate IS NULL OR statement_timestamp()<g.valido_ate)
  ) THEN RAISE EXCEPTION 'No explicit integration access to this promoter allocation' USING ERRCODE='42501'; END IF;
  SELECT i.estado INTO identity_state FROM public.mk9_identidades i WHERE i.promotor_id=promotor;
  IF identity_state IS NULL THEN
    RETURN QUERY SELECT 'sem_identidade'::text,0,NULL::uuid,NULL::text; RETURN;
  ELSIF identity_state<>'aprovado' THEN
    RETURN QUERY SELECT CASE WHEN identity_state='revogado' THEN 'revogado' ELSE 'pendente' END,0,NULL::uuid,NULL::text; RETURN;
  END IF;
  SELECT count(*)::integer INTO total_valid FROM public.mk9_alocacoes a
   WHERE a.promotor_id=promotor AND a.estado='aprovado' AND a.aprovado_por IS NOT NULL
     AND a.valido_desde<=statement_timestamp() AND (a.valido_ate IS NULL OR statement_timestamp()<a.valido_ate)
     AND a.ocorrencias_desde<=p_data AND (a.ocorrencias_ate IS NULL OR p_data<=a.ocorrencias_ate);
  IF total_valid>1 THEN
    RETURN QUERY SELECT 'ambiguo'::text,total_valid,NULL::uuid,NULL::text; RETURN;
  ELSIF total_valid=1 THEN
    RETURN QUERY SELECT 'pronto'::text,1,a.projeto_externo_id,a.matricula_externa
      FROM public.mk9_alocacoes a
      WHERE a.promotor_id=promotor AND a.estado='aprovado' AND a.aprovado_por IS NOT NULL
        AND a.valido_desde<=statement_timestamp() AND (a.valido_ate IS NULL OR statement_timestamp()<a.valido_ate)
        AND a.ocorrencias_desde<=p_data AND (a.ocorrencias_ate IS NULL OR p_data<=a.ocorrencias_ate)
        AND (caller_role='admin' OR EXISTS(SELECT 1 FROM public.mk9_acessos g WHERE g.alocacao_id=a.id AND g.usuario_id=caller
          AND g.tipo IN ('supervisao','gestao') AND g.estado='aprovado' AND g.aprovado_por IS NOT NULL
          AND g.valido_desde<=statement_timestamp() AND (g.valido_ate IS NULL OR statement_timestamp()<g.valido_ate)));
    RETURN;
  END IF;
  IF EXISTS(SELECT 1 FROM public.mk9_alocacoes a WHERE a.promotor_id=promotor AND a.estado='pendente'
    AND (caller_role='admin' OR EXISTS(SELECT 1 FROM public.mk9_acessos g WHERE g.alocacao_id=a.id AND g.usuario_id=caller
      AND g.tipo IN ('supervisao','gestao') AND g.estado='aprovado' AND g.aprovado_por IS NOT NULL
      AND g.valido_desde<=statement_timestamp() AND (g.valido_ate IS NULL OR statement_timestamp()<g.valido_ate)))) THEN
    RETURN QUERY SELECT 'pendente'::text,0,NULL::uuid,NULL::text; RETURN;
  ELSIF EXISTS(SELECT 1 FROM public.mk9_alocacoes a WHERE a.promotor_id=promotor AND a.estado='revogado'
    AND (caller_role='admin' OR EXISTS(SELECT 1 FROM public.mk9_acessos g WHERE g.alocacao_id=a.id AND g.usuario_id=caller
      AND g.tipo IN ('supervisao','gestao') AND g.estado='aprovado' AND g.aprovado_por IS NOT NULL
      AND g.valido_desde<=statement_timestamp() AND (g.valido_ate IS NULL OR statement_timestamp()<g.valido_ate)))) THEN
    RETURN QUERY SELECT 'revogado'::text,0,NULL::uuid,NULL::text; RETURN;
  ELSIF EXISTS(SELECT 1 FROM public.mk9_alocacoes a WHERE a.promotor_id=promotor AND a.estado='aprovado'
    AND (caller_role='admin' OR EXISTS(SELECT 1 FROM public.mk9_acessos g WHERE g.alocacao_id=a.id AND g.usuario_id=caller
      AND g.tipo IN ('supervisao','gestao') AND g.estado='aprovado' AND g.aprovado_por IS NOT NULL
      AND g.valido_desde<=statement_timestamp() AND (g.valido_ate IS NULL OR statement_timestamp()<g.valido_ate)))) THEN
    RETURN QUERY SELECT 'fora_vigencia_ou_janela'::text,0,NULL::uuid,NULL::text; RETURN;
  END IF;
  RETURN QUERY SELECT 'sem_alocacao'::text,0,NULL::uuid,NULL::text;
END;
$$;
REVOKE ALL ON FUNCTION mk9_rh_private.resolve_attendance(text,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION mk9_rh_private.resolve_attendance(text,date) TO authenticated;

CREATE OR REPLACE FUNCTION public.mk9_rh_resolve_attendance(p_matricula_local text,p_data date)
RETURNS TABLE(status text,alocacoes_validas integer,projeto_externo_id uuid,matricula_externa text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
AS $$ SELECT * FROM mk9_rh_private.resolve_attendance(p_matricula_local,p_data); $$;
REVOKE ALL ON FUNCTION public.mk9_rh_resolve_attendance(text,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mk9_rh_resolve_attendance(text,date) TO authenticated;

COMMIT;
