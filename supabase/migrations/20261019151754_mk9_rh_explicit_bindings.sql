-- PREPARED ONLY. Apply to an isolated local database for validation; never remotely without approval.
-- Verified source key types: public.promotores.id uuid, public.profiles.id uuid.
BEGIN;
CREATE SCHEMA IF NOT EXISTS mk9_rh_private;
REVOKE ALL ON SCHEMA mk9_rh_private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA mk9_rh_private TO authenticated;

CREATE TABLE public.mk9_identidades (
  promotor_id uuid PRIMARY KEY REFERENCES public.promotores(id) ON DELETE CASCADE,
  usuario_id uuid UNIQUE REFERENCES public.profiles(id) ON DELETE SET NULL,
  estado text NOT NULL DEFAULT 'pendente' CHECK (estado IN ('pendente','aprovado','revogado')),
  aprovado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  aprovado_em timestamptz,
  referencia text NOT NULL CHECK (length(btrim(referencia)) BETWEEN 3 AND 500),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CHECK (estado <> 'aprovado' OR aprovado_em IS NOT NULL)
);

CREATE TABLE public.mk9_alocacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Keep historical reservations if an operational person is deleted; never block that deletion.
  promotor_id uuid REFERENCES public.mk9_identidades(promotor_id) ON DELETE SET NULL,
  projeto_externo_id uuid NOT NULL CHECK (projeto_externo_id IN (
    '950edb7d-b94f-4555-9e5a-16fb5aa857a3','600da4d2-4aab-47d6-a81c-3e7a38d717ed',
    '1186bb9a-b1b4-4d2b-a8af-4b34646a3a72','b6f69345-c38e-47be-be0f-f17827fe20bf',
    '65f7e80f-f615-4ceb-9b8d-80db170735dc','5d1a46e3-012c-4ab3-a575-834f5ad6a954',
    '89bccfec-5f8e-4925-8702-6af0d984d5bf','46af0780-7b27-4541-92a4-35777992eb6b')),
  matricula_externa text NOT NULL CHECK (length(matricula_externa) BETWEEN 1 AND 200 AND matricula_externa=btrim(matricula_externa)),
  ocorrencias_desde date NOT NULL,
  ocorrencias_ate date,
  valido_desde timestamptz NOT NULL,
  valido_ate timestamptz,
  estado text NOT NULL DEFAULT 'pendente' CHECK (estado IN ('pendente','aprovado','revogado')),
  aprovado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  aprovado_em timestamptz,
  referencia text NOT NULL CHECK (length(btrim(referencia)) BETWEEN 3 AND 500),
  versao bigint NOT NULL DEFAULT 1,
  historico jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(historico)='array'),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (promotor_id,projeto_externo_id),
  -- Deliberately permanent reservation, including revoked rows: no silent identity reuse.
  UNIQUE (projeto_externo_id,matricula_externa),
  CHECK (ocorrencias_ate IS NULL OR ocorrencias_ate>=ocorrencias_desde),
  CHECK (valido_ate IS NULL OR valido_ate>valido_desde),
  CHECK (estado <> 'aprovado' OR aprovado_em IS NOT NULL)
);

CREATE TABLE public.mk9_acessos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  alocacao_id uuid NOT NULL REFERENCES public.mk9_alocacoes(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('supervisao','gestao')),
  estado text NOT NULL DEFAULT 'pendente' CHECK (estado IN ('pendente','aprovado','revogado')),
  valido_desde timestamptz NOT NULL,
  valido_ate timestamptz,
  aprovado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  aprovado_em timestamptz,
  referencia text NOT NULL CHECK (length(btrim(referencia)) BETWEEN 3 AND 500),
  versao bigint NOT NULL DEFAULT 1,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (usuario_id,alocacao_id,tipo),
  CHECK (valido_ate IS NULL OR valido_ate>valido_desde),
  CHECK (estado <> 'aprovado' OR aprovado_em IS NOT NULL)
);
CREATE INDEX mk9_alocacoes_promotor_estado ON public.mk9_alocacoes(promotor_id,estado);
CREATE INDEX mk9_acessos_usuario_tipo_estado ON public.mk9_acessos(usuario_id,tipo,estado);
CREATE INDEX mk9_acessos_alocacao ON public.mk9_acessos(alocacao_id);
CREATE INDEX mk9_identidades_aprovador ON public.mk9_identidades(aprovado_por);
CREATE INDEX mk9_alocacoes_aprovador ON public.mk9_alocacoes(aprovado_por);
CREATE INDEX mk9_acessos_aprovador ON public.mk9_acessos(aprovado_por);

CREATE FUNCTION mk9_rh_private.guard_binding() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
  IF NEW.estado='aprovado' AND NEW.aprovado_por IS NULL THEN
    -- FK SET NULL on deletion of an approver must not break existing account deletion.
    IF TG_OP='UPDATE' AND OLD.aprovado_por IS NOT NULL THEN NEW.estado:='revogado';
    ELSE RAISE EXCEPTION 'Approval requires a responsible profile' USING ERRCODE='23514'; END IF;
  END IF;
  IF TG_OP='UPDATE' THEN
    IF TG_TABLE_NAME='mk9_identidades' THEN
      IF NEW.promotor_id<>OLD.promotor_id OR (OLD.usuario_id IS NOT NULL AND NEW.usuario_id IS NOT NULL AND NEW.usuario_id<>OLD.usuario_id) THEN
        RAISE EXCEPTION 'Identity reassignment requires separate administrative review' USING ERRCODE='23514';
      END IF;
    ELSIF TG_TABLE_NAME='mk9_alocacoes' THEN
      IF (NEW.projeto_externo_id,NEW.matricula_externa) IS DISTINCT FROM (OLD.projeto_externo_id,OLD.matricula_externa)
        OR (NEW.promotor_id IS NOT NULL AND NEW.promotor_id IS DISTINCT FROM OLD.promotor_id) THEN
        RAISE EXCEPTION 'External identity is immutable' USING ERRCODE='23514';
      END IF;
      IF NEW.promotor_id IS NULL THEN NEW.estado:='revogado'; END IF;
      NEW.versao:=OLD.versao+1;
      NEW.historico:=OLD.historico || jsonb_build_array(jsonb_build_object('em',statement_timestamp(),'autor',auth.uid(),'antes',to_jsonb(OLD)-'historico','depois',to_jsonb(NEW)-'historico'));
    ELSE
      IF (NEW.usuario_id,NEW.alocacao_id,NEW.tipo) IS DISTINCT FROM (OLD.usuario_id,OLD.alocacao_id,OLD.tipo) THEN
        RAISE EXCEPTION 'Access target is immutable' USING ERRCODE='23514';
      END IF;
      NEW.versao:=OLD.versao+1;
    END IF;
  ELSIF TG_TABLE_NAME='mk9_alocacoes' THEN
    IF NEW.promotor_id IS NULL THEN RAISE EXCEPTION 'Local identity required' USING ERRCODE='23514'; END IF;
    NEW.historico:=jsonb_build_array(jsonb_build_object('em',statement_timestamp(),'autor',auth.uid(),'depois',to_jsonb(NEW)-'historico'));
  END IF;
  NEW.atualizado_em:=statement_timestamp();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION mk9_rh_private.guard_binding() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER mk9_identidades_guard BEFORE INSERT OR UPDATE ON public.mk9_identidades FOR EACH ROW EXECUTE FUNCTION mk9_rh_private.guard_binding();
CREATE TRIGGER mk9_alocacoes_guard BEFORE INSERT OR UPDATE ON public.mk9_alocacoes FOR EACH ROW EXECUTE FUNCTION mk9_rh_private.guard_binding();
CREATE TRIGGER mk9_acessos_guard BEFORE INSERT OR UPDATE ON public.mk9_acessos FOR EACH ROW EXECUTE FUNCTION mk9_rh_private.guard_binding();

ALTER TABLE public.mk9_identidades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mk9_identidades FORCE ROW LEVEL SECURITY;
ALTER TABLE public.mk9_alocacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mk9_alocacoes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.mk9_acessos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mk9_acessos FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.mk9_identidades,public.mk9_alocacoes,public.mk9_acessos FROM PUBLIC,anon,authenticated;
-- Explicit restrictive policies defend against a future accidental table grant.
CREATE POLICY mk9_identidades_deny ON public.mk9_identidades AS RESTRICTIVE FOR ALL TO authenticated USING(false) WITH CHECK(false);
CREATE POLICY mk9_alocacoes_deny ON public.mk9_alocacoes AS RESTRICTIVE FOR ALL TO authenticated USING(false) WITH CHECK(false);
CREATE POLICY mk9_acessos_deny ON public.mk9_acessos AS RESTRICTIVE FOR ALL TO authenticated USING(false) WITH CHECK(false);

-- Narrow privileged read boundary: needed to resolve RH grants independently from operational
-- RLS. Never use operational roles, metadata, team names, user-supplied identities or service keys.
-- This private schema is NOT an exposed API schema. No raw table access is granted.
CREATE FUNCTION mk9_rh_private.scope(p_view text)
RETURNS TABLE(alocacao_id uuid,promotor_id uuid,matricula_local text,nome_local text,
  projeto_id uuid,matricula_externa text,ocorrencias_desde date,ocorrencias_ate date,supervisor_nome text,promotor_ativo boolean,versao text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT a.id,i.promotor_id,pr.matricula,pr.nome,a.projeto_externo_id,a.matricula_externa,
        a.ocorrencias_desde,a.ocorrencias_ate,
        CASE p_view WHEN 'team' THEN coalesce(caller.name,'Supervisão RH') WHEN 'management' THEN coalesce((
          SELECT string_agg(DISTINCT pf.name,', ' ORDER BY pf.name) FROM public.mk9_acessos sg
          JOIN public.profiles pf ON pf.id=sg.usuario_id AND pf.status='ativo'
          WHERE sg.alocacao_id=a.id AND sg.tipo='supervisao' AND sg.estado='aprovado' AND sg.aprovado_por IS NOT NULL
            AND sg.valido_desde<=statement_timestamp() AND (sg.valido_ate IS NULL OR statement_timestamp()<sg.valido_ate)
        ),'Sem responsável de RH') ELSE '' END,pr.status='ativo',
        concat(a.versao,':',a.atualizado_em,':',i.atualizado_em,':',coalesce(g.versao::text,''),':',coalesce(g.atualizado_em::text,''))
 FROM public.mk9_alocacoes a
 JOIN public.mk9_identidades i ON i.promotor_id=a.promotor_id
 JOIN public.promotores pr ON pr.id=i.promotor_id
 JOIN public.profiles caller ON caller.id=auth.uid() AND caller.status='ativo'
 LEFT JOIN public.mk9_acessos g ON g.alocacao_id=a.id AND g.usuario_id=auth.uid()
   AND g.tipo=CASE p_view WHEN 'team' THEN 'supervisao' WHEN 'management' THEN 'gestao' END
   AND g.estado='aprovado' AND g.aprovado_por IS NOT NULL
   AND g.valido_desde<=statement_timestamp() AND (g.valido_ate IS NULL OR statement_timestamp()<g.valido_ate)
 WHERE auth.uid() IS NOT NULL AND p_view IN ('mine','team','management')
   AND i.estado='aprovado' AND i.aprovado_por IS NOT NULL
   AND a.estado='aprovado' AND a.aprovado_por IS NOT NULL
   AND a.valido_desde<=statement_timestamp() AND (a.valido_ate IS NULL OR statement_timestamp()<a.valido_ate)
   AND ((p_view='mine' AND i.usuario_id=auth.uid()) OR (p_view IN ('team','management') AND g.id IS NOT NULL));
$$;
REVOKE ALL ON FUNCTION mk9_rh_private.scope(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION mk9_rh_private.scope(text) TO authenticated;

CREATE FUNCTION public.mk9_rh_scope(p_view text)
RETURNS TABLE(alocacao_id uuid,promotor_id uuid,matricula_local text,nome_local text,
  projeto_id uuid,matricula_externa text,ocorrencias_desde date,ocorrencias_ate date,supervisor_nome text,promotor_ativo boolean,versao text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
  SELECT * FROM mk9_rh_private.scope(p_view);
$$;
REVOKE ALL ON FUNCTION public.mk9_rh_scope(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mk9_rh_scope(text) TO authenticated;
COMMIT;
