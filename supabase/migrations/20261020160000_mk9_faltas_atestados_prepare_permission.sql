-- Acesso individual ao módulo de preparação de ausências.
-- Não cria lançamentos, fila, outbox nem integração de escrita externa.
BEGIN;

CREATE TABLE mk9_rh_private.absence_prepare_permissions (
  usuario_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  ativo boolean NOT NULL DEFAULT true,
  concedido_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  concedido_em timestamptz NOT NULL DEFAULT statement_timestamp(),
  referencia text NOT NULL CHECK (length(btrim(referencia)) BETWEEN 3 AND 500),
  revogado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  revogado_em timestamptz,
  CHECK ((ativo AND revogado_em IS NULL) OR (NOT ativo AND revogado_em IS NOT NULL))
);
ALTER TABLE mk9_rh_private.absence_prepare_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mk9_rh_private.absence_prepare_permissions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON mk9_rh_private.absence_prepare_permissions FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION mk9_rh_private.can_prepare_absences()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN mk9_rh_private.absence_prepare_permissions ap ON ap.usuario_id=p.id
    WHERE p.id=(select auth.uid()) AND p.status='ativo' AND p.role IN ('admin','gestor')
      AND ap.ativo AND ap.revogado_em IS NULL
  );
$$;
REVOKE ALL ON FUNCTION mk9_rh_private.can_prepare_absences() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION mk9_rh_private.can_prepare_absences() TO authenticated;

CREATE OR REPLACE FUNCTION public.mk9_faltas_atestados_can_prepare()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
AS $$ SELECT mk9_rh_private.can_prepare_absences(); $$;
REVOKE ALL ON FUNCTION public.mk9_faltas_atestados_can_prepare() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mk9_faltas_atestados_can_prepare() TO authenticated;

CREATE OR REPLACE FUNCTION mk9_rh_private.list_absence_prepare_bindings()
RETURNS TABLE(
  promotor_id uuid, matricula_interna text, colaborador text,
  equipe text, supervisor text, cidade text, uf text,
  identidade_status text, alocacao_id uuid, projeto_crm uuid,
  matricula_externa text, alocacao_status text,
  ocorrencias_desde date, ocorrencias_ate date,
  valido_desde timestamptz, valido_ate timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $$
BEGIN
  IF NOT mk9_rh_private.can_prepare_absences() THEN
    RAISE EXCEPTION 'faltas_atestados_prepare permission required' USING ERRCODE='42501';
  END IF;
  IF (SELECT count(*) FROM public.mk9_alocacoes) > 2000 THEN
    RAISE EXCEPTION 'Binding list exceeds safe interactive limit' USING ERRCODE='54000';
  END IF;
  RETURN QUERY
    SELECT pr.id,pr.matricula,pr.nome,coalesce(pr.equipe,''),coalesce(pr.supervisor,''),
      coalesce(pr.cidade,''),coalesce(pr.uf,''),i.estado,a.id,a.projeto_externo_id,
      a.matricula_externa,a.estado,a.ocorrencias_desde,a.ocorrencias_ate,a.valido_desde,a.valido_ate
    FROM public.mk9_alocacoes a
    JOIN public.mk9_identidades i ON i.promotor_id=a.promotor_id
    JOIN public.promotores pr ON pr.id=i.promotor_id
    ORDER BY pr.nome,a.projeto_externo_id,a.matricula_externa;
END;
$$;
REVOKE ALL ON FUNCTION mk9_rh_private.list_absence_prepare_bindings() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION mk9_rh_private.list_absence_prepare_bindings() TO authenticated;

CREATE OR REPLACE FUNCTION public.mk9_faltas_atestados_bindings()
RETURNS TABLE(
  promotor_id uuid, matricula_interna text, colaborador text,
  equipe text, supervisor text, cidade text, uf text,
  identidade_status text, alocacao_id uuid, projeto_crm uuid,
  matricula_externa text, alocacao_status text,
  ocorrencias_desde date, ocorrencias_ate date,
  valido_desde timestamptz, valido_ate timestamptz
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
AS $$ SELECT * FROM mk9_rh_private.list_absence_prepare_bindings(); $$;
REVOKE ALL ON FUNCTION public.mk9_faltas_atestados_bindings() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mk9_faltas_atestados_bindings() TO authenticated;

COMMIT;
