-- Local/release preparation for reviewed HR registration reconciliation.
-- Never alters public.promotores.matricula, public.supervisores.codigo, UUIDs,
-- routes, visits, or external CRM data. No roster is embedded in this migration.
BEGIN;

CREATE TABLE mk9_rh_private.reconciliation_permissions (
  usuario_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  ativo boolean NOT NULL DEFAULT true,
  concedido_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  concedido_em timestamptz NOT NULL DEFAULT statement_timestamp(),
  referencia text NOT NULL CHECK (length(btrim(referencia)) BETWEEN 3 AND 500),
  revogado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  revogado_em timestamptz,
  CHECK ((ativo AND revogado_em IS NULL) OR (NOT ativo AND revogado_em IS NOT NULL))
);
ALTER TABLE mk9_rh_private.reconciliation_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mk9_rh_private.reconciliation_permissions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON mk9_rh_private.reconciliation_permissions FROM PUBLIC,anon,authenticated;

CREATE TABLE mk9_rh_private.matriculas_rh_reconciliation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matricula_rh text NOT NULL CHECK (length(btrim(matricula_rh)) BETWEEN 1 AND 64 AND matricula_rh=btrim(matricula_rh)),
  nome_rh text NOT NULL CHECK (length(btrim(nome_rh)) BETWEEN 1 AND 200),
  cargo_rh text NOT NULL CHECK (length(btrim(cargo_rh)) BETWEEN 1 AND 120),
  empresa text NOT NULL CHECK (length(btrim(empresa)) BETWEEN 1 AND 120),
  cidade_rh text NOT NULL CHECK (length(btrim(cidade_rh)) BETWEEN 1 AND 120),
  uf_rh text NOT NULL CHECK (length(btrim(uf_rh)) BETWEEN 2 AND 3),
  situacao_rh text NOT NULL CHECK (length(btrim(situacao_rh)) BETWEEN 1 AND 80),
  referencia_fonte text NOT NULL CHECK (length(btrim(referencia_fonte)) BETWEEN 3 AND 300),
  promotor_id uuid REFERENCES public.promotores(id) ON DELETE RESTRICT,
  supervisor_id uuid REFERENCES public.supervisores(id) ON DELETE RESTRICT,
  codigo_interno text,
  estado text NOT NULL DEFAULT 'pendente' CHECK (estado IN ('pendente','aprovada','rejeitada','revisao','aplicada','revertida')),
  observacao_decisao text,
  criado_por uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  criado_em timestamptz NOT NULL DEFAULT statement_timestamp(),
  aprovado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  aprovado_em timestamptz,
  aplicado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  aplicado_em timestamptz,
  revertido_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  revertido_em timestamptz,
  atualizado_em timestamptz NOT NULL DEFAULT statement_timestamp(),
  CHECK (NOT (promotor_id IS NOT NULL AND supervisor_id IS NOT NULL)),
  CHECK ((estado NOT IN ('aprovada','aplicada') OR (promotor_id IS NOT NULL OR supervisor_id IS NOT NULL)) AND
         (estado <> 'aprovada' OR (aprovado_por IS NOT NULL AND aprovado_em IS NOT NULL)) AND
         (estado <> 'aplicada' OR (aprovado_por IS NOT NULL AND aprovado_em IS NOT NULL AND aplicado_por IS NOT NULL AND aplicado_em IS NOT NULL)) AND
         (estado <> 'revertida' OR (revertido_por IS NOT NULL AND revertido_em IS NOT NULL)))
);
CREATE UNIQUE INDEX matriculas_rh_recon_source_unique ON mk9_rh_private.matriculas_rh_reconciliation(matricula_rh);
CREATE UNIQUE INDEX matriculas_rh_recon_approved_promotor_unique
  ON mk9_rh_private.matriculas_rh_reconciliation(promotor_id) WHERE promotor_id IS NOT NULL AND estado IN ('aprovada','aplicada');
CREATE UNIQUE INDEX matriculas_rh_recon_approved_supervisor_unique
  ON mk9_rh_private.matriculas_rh_reconciliation(supervisor_id) WHERE supervisor_id IS NOT NULL AND estado IN ('aprovada','aplicada');
CREATE INDEX matriculas_rh_recon_state_created ON mk9_rh_private.matriculas_rh_reconciliation(estado,criado_em DESC);

CREATE TABLE mk9_rh_private.matriculas_rh_reconciliation_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reconciliation_id uuid NOT NULL REFERENCES mk9_rh_private.matriculas_rh_reconciliation(id) ON DELETE RESTRICT,
  autor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  acao text NOT NULL CHECK (acao IN ('importada','associada','aprovada','rejeitada','revisao','aplicada','revertida')),
  referencia text NOT NULL CHECK (length(btrim(referencia)) BETWEEN 3 AND 500),
  antes jsonb,
  depois jsonb NOT NULL,
  ocorrido_em timestamptz NOT NULL DEFAULT statement_timestamp()
);
CREATE INDEX matriculas_rh_recon_audit_record ON mk9_rh_private.matriculas_rh_reconciliation_audit(reconciliation_id,ocorrido_em DESC);

ALTER TABLE mk9_rh_private.matriculas_rh_reconciliation ENABLE ROW LEVEL SECURITY;
ALTER TABLE mk9_rh_private.matriculas_rh_reconciliation FORCE ROW LEVEL SECURITY;
ALTER TABLE mk9_rh_private.matriculas_rh_reconciliation_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE mk9_rh_private.matriculas_rh_reconciliation_audit FORCE ROW LEVEL SECURITY;
REVOKE ALL ON mk9_rh_private.matriculas_rh_reconciliation,mk9_rh_private.matriculas_rh_reconciliation_audit FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION mk9_rh_private.require_reconciliation_admin()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $$
DECLARE caller uuid := (SELECT auth.uid());
BEGIN
  IF caller IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles p JOIN mk9_rh_private.reconciliation_permissions rp ON rp.usuario_id=p.id
    WHERE p.id=caller AND p.role='admin' AND p.status='ativo' AND rp.ativo AND rp.revogado_em IS NULL
  ) THEN RAISE EXCEPTION 'Specific RH reconciliation permission required' USING ERRCODE='42501'; END IF;
  RETURN caller;
END;
$$;
REVOKE ALL ON FUNCTION mk9_rh_private.require_reconciliation_admin() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION mk9_rh_private.require_reconciliation_admin() TO authenticated;

CREATE OR REPLACE FUNCTION mk9_rh_private.can_manage_reconciliation()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles p JOIN mk9_rh_private.reconciliation_permissions rp ON rp.usuario_id=p.id
    WHERE p.id=(SELECT auth.uid()) AND p.role='admin' AND p.status='ativo' AND rp.ativo AND rp.revogado_em IS NULL);
$$;
REVOKE ALL ON FUNCTION mk9_rh_private.can_manage_reconciliation() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION mk9_rh_private.can_manage_reconciliation() TO authenticated;

CREATE OR REPLACE FUNCTION mk9_rh_private.list_reconciliation()
RETURNS TABLE(
  id uuid, matricula_rh text, nome_rh text, cargo_rh text, empresa text, cidade_rh text, uf_rh text, situacao_rh text,
  referencia_fonte text, promotor_id uuid, supervisor_id uuid, codigo_interno text, nome_mk9 text,
  tipo_mk9 text, cidade_mk9 text, uf_mk9 text, situacao_mk9 text, estado text, observacao_decisao text,
  criado_em timestamptz, aprovado_por uuid, aprovador_nome text, aprovado_em timestamptz, aplicado_em timestamptz
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $$
BEGIN
  PERFORM mk9_rh_private.require_reconciliation_admin();
  RETURN QUERY SELECT r.id,r.matricula_rh,r.nome_rh,r.cargo_rh,r.empresa,r.cidade_rh,r.uf_rh,r.situacao_rh,
    r.referencia_fonte,r.promotor_id,r.supervisor_id,r.codigo_interno,coalesce(p.nome,s.nome),
    CASE WHEN p.id IS NOT NULL THEN 'Promotor' ELSE 'Supervisor' END,
    coalesce(p.cidade,s.regional),p.uf,coalesce(p.status,s.status),r.estado,r.observacao_decisao,
    r.criado_em,r.aprovado_por,ap.name,r.aprovado_em,r.aplicado_em
  FROM mk9_rh_private.matriculas_rh_reconciliation r
  LEFT JOIN public.promotores p ON p.id=r.promotor_id
  LEFT JOIN public.supervisores s ON s.id=r.supervisor_id
  LEFT JOIN public.profiles ap ON ap.id=r.aprovado_por
  ORDER BY r.criado_em DESC,r.matricula_rh;
END;
$$;
REVOKE ALL ON FUNCTION mk9_rh_private.list_reconciliation() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION mk9_rh_private.list_reconciliation() TO authenticated;

CREATE OR REPLACE FUNCTION public.mk9_rh_reconciliation_can_manage()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
AS $$ SELECT mk9_rh_private.can_manage_reconciliation(); $$;
REVOKE ALL ON FUNCTION public.mk9_rh_reconciliation_can_manage() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mk9_rh_reconciliation_can_manage() TO authenticated;

CREATE OR REPLACE FUNCTION public.mk9_rh_reconciliation_list()
RETURNS TABLE(
  id uuid, matricula_rh text, nome_rh text, cargo_rh text, empresa text, cidade_rh text, uf_rh text, situacao_rh text,
  referencia_fonte text, promotor_id uuid, supervisor_id uuid, codigo_interno text, nome_mk9 text,
  tipo_mk9 text, cidade_mk9 text, uf_mk9 text, situacao_mk9 text, estado text, observacao_decisao text,
  criado_em timestamptz, aprovado_por uuid, aprovador_nome text, aprovado_em timestamptz, aplicado_em timestamptz
) LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
AS $$ SELECT * FROM mk9_rh_private.list_reconciliation(); $$;
REVOKE ALL ON FUNCTION public.mk9_rh_reconciliation_list() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mk9_rh_reconciliation_list() TO authenticated;

CREATE OR REPLACE FUNCTION public.mk9_rh_reconciliation_people()
RETURNS TABLE(tipo text,codigo_interno text,identificador uuid,nome text,cidade text,uf text,situacao text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $$
BEGIN
  PERFORM mk9_rh_private.require_reconciliation_admin();
  RETURN QUERY
    SELECT 'promotor'::text,p.matricula,p.id,p.nome,p.cidade,p.uf,p.status FROM public.promotores p
    UNION ALL
    SELECT 'supervisor'::text,s.codigo,s.id,s.nome,NULL::text,NULL::text,s.status FROM public.supervisores s
    ORDER BY 4,2;
END;
$$;
REVOKE ALL ON FUNCTION public.mk9_rh_reconciliation_people() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mk9_rh_reconciliation_people() TO authenticated;

CREATE OR REPLACE FUNCTION public.mk9_rh_reconciliation_import(p_rows jsonb,p_referencia text)
RETURNS TABLE(inseridos integer, atualizados integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE caller uuid; row_data jsonb; row_id uuid; existing_row mk9_rh_private.matriculas_rh_reconciliation%ROWTYPE; ins integer:=0; upd integer:=0;
BEGIN
  caller:=mk9_rh_private.require_reconciliation_admin();
  IF p_rows IS NULL OR jsonb_typeof(p_rows)<>'array' THEN RAISE EXCEPTION 'Roster batch must be an array' USING ERRCODE='22023'; END IF;
  IF jsonb_array_length(p_rows) NOT BETWEEN 1 AND 100
    OR p_referencia IS NULL OR length(btrim(p_referencia)) NOT BETWEEN 3 AND 300 THEN
    RAISE EXCEPTION 'Invalid roster batch' USING ERRCODE='22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_rows) AS rows(value)
    GROUP BY upper(btrim(value->>'matricula_rh')) HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Duplicate HR registration in roster batch' USING ERRCODE='23505';
  END IF;
  FOR row_data IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    row_id:=NULL;
    existing_row:=NULL;
    IF jsonb_typeof(row_data)<>'object' THEN RAISE EXCEPTION 'Roster row must be an object' USING ERRCODE='22023'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(row_data) AS keys(key) WHERE key NOT IN ('matricula_rh','nome_rh','cargo_rh','empresa','cidade_rh','uf_rh','situacao_rh')) THEN
      RAISE EXCEPTION 'Roster contains unsupported fields' USING ERRCODE='22023';
    END IF;
    IF length(btrim(coalesce(row_data->>'matricula_rh',''))) NOT BETWEEN 1 AND 64
      OR length(btrim(coalesce(row_data->>'nome_rh',''))) NOT BETWEEN 1 AND 200
      OR length(btrim(coalesce(row_data->>'cargo_rh',''))) NOT BETWEEN 1 AND 120
      OR length(btrim(coalesce(row_data->>'empresa',''))) NOT BETWEEN 1 AND 120
      OR length(btrim(coalesce(row_data->>'cidade_rh',''))) NOT BETWEEN 1 AND 120
      OR length(btrim(coalesce(row_data->>'uf_rh',''))) NOT BETWEEN 2 AND 3
      OR length(btrim(coalesce(row_data->>'situacao_rh',''))) NOT BETWEEN 1 AND 80 THEN
      RAISE EXCEPTION 'Invalid roster row' USING ERRCODE='22023';
    END IF;
    SELECT * INTO existing_row FROM mk9_rh_private.matriculas_rh_reconciliation
      WHERE matricula_rh=btrim(row_data->>'matricula_rh') FOR UPDATE;
    INSERT INTO mk9_rh_private.matriculas_rh_reconciliation(
      matricula_rh,nome_rh,cargo_rh,empresa,cidade_rh,uf_rh,situacao_rh,referencia_fonte,criado_por
    ) VALUES (
      btrim(row_data->>'matricula_rh'),btrim(row_data->>'nome_rh'),btrim(row_data->>'cargo_rh'),btrim(row_data->>'empresa'),
      btrim(row_data->>'cidade_rh'),upper(btrim(row_data->>'uf_rh')),btrim(row_data->>'situacao_rh'),btrim(p_referencia),caller
    ) ON CONFLICT(matricula_rh) DO UPDATE SET
      nome_rh=EXCLUDED.nome_rh,cargo_rh=EXCLUDED.cargo_rh,empresa=EXCLUDED.empresa,cidade_rh=EXCLUDED.cidade_rh,
      uf_rh=EXCLUDED.uf_rh,situacao_rh=EXCLUDED.situacao_rh,referencia_fonte=EXCLUDED.referencia_fonte,atualizado_em=statement_timestamp()
      WHERE mk9_rh_private.matriculas_rh_reconciliation.estado IN ('pendente','revisao')
        AND mk9_rh_private.matriculas_rh_reconciliation.promotor_id IS NULL
        AND mk9_rh_private.matriculas_rh_reconciliation.supervisor_id IS NULL
    RETURNING id INTO row_id;
    IF row_id IS NULL THEN RAISE EXCEPTION 'Source registration is already reviewed or linked' USING ERRCODE='55000'; END IF;
    IF existing_row.id IS NOT NULL THEN
      upd:=upd+1;
      INSERT INTO mk9_rh_private.matriculas_rh_reconciliation_audit(reconciliation_id,autor_id,acao,referencia,antes,depois)
      SELECT row_id,caller,'importada',btrim(p_referencia),to_jsonb(existing_row)-'criado_por',to_jsonb(r)-'criado_por'
        FROM mk9_rh_private.matriculas_rh_reconciliation r WHERE r.id=row_id;
    ELSE
      ins:=ins+1;
      INSERT INTO mk9_rh_private.matriculas_rh_reconciliation_audit(reconciliation_id,autor_id,acao,referencia,depois)
      SELECT row_id,caller,'importada',btrim(p_referencia),to_jsonb(r) - 'criado_por' FROM mk9_rh_private.matriculas_rh_reconciliation r WHERE r.id=row_id;
    END IF;
  END LOOP;
  RETURN QUERY SELECT ins,upd;
END;
$$;
REVOKE ALL ON FUNCTION public.mk9_rh_reconciliation_import(jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mk9_rh_reconciliation_import(jsonb,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.mk9_rh_reconciliation_decide(
  p_id uuid,p_action text,p_internal_code text,p_referencia text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE caller uuid; rec mk9_rh_private.matriculas_rh_reconciliation%ROWTYPE; promoter_id uuid; supervisor_id uuid;
BEGIN
  caller:=mk9_rh_private.require_reconciliation_admin();
  IF p_id IS NULL OR p_action IS NULL OR p_action NOT IN ('aprovar','rejeitar','revisar') OR length(btrim(coalesce(p_referencia,''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'Invalid reconciliation decision' USING ERRCODE='22023';
  END IF;
  SELECT * INTO rec FROM mk9_rh_private.matriculas_rh_reconciliation WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR rec.estado NOT IN ('pendente','revisao','rejeitada','aprovada') THEN RAISE EXCEPTION 'Reconciliation is not reviewable' USING ERRCODE='55000'; END IF;
  IF p_action='aprovar' THEN
    IF p_internal_code IS NULL OR length(btrim(p_internal_code)) NOT BETWEEN 1 AND 64 THEN RAISE EXCEPTION 'Internal code required' USING ERRCODE='22023'; END IF;
    SELECT id INTO promoter_id FROM public.promotores WHERE matricula=btrim(p_internal_code);
    IF promoter_id IS NULL THEN SELECT id INTO supervisor_id FROM public.supervisores WHERE codigo=btrim(p_internal_code); END IF;
    IF promoter_id IS NULL AND supervisor_id IS NULL THEN RAISE EXCEPTION 'Internal collaborator not found' USING ERRCODE='P0002'; END IF;
    UPDATE mk9_rh_private.matriculas_rh_reconciliation SET promotor_id=promoter_id,supervisor_id=supervisor_id,
      codigo_interno=btrim(p_internal_code),estado='aprovada',observacao_decisao=btrim(p_referencia),
      aprovado_por=caller,aprovado_em=statement_timestamp(),atualizado_em=statement_timestamp() WHERE id=p_id;
  ELSE
    UPDATE mk9_rh_private.matriculas_rh_reconciliation SET estado=CASE p_action WHEN 'rejeitar' THEN 'rejeitada' ELSE 'revisao' END,
      aprovado_por=NULL,aprovado_em=NULL,observacao_decisao=btrim(p_referencia),atualizado_em=statement_timestamp() WHERE id=p_id;
  END IF;
  INSERT INTO mk9_rh_private.matriculas_rh_reconciliation_audit(reconciliation_id,autor_id,acao,referencia,antes,depois)
  VALUES(p_id,caller,CASE p_action WHEN 'aprovar' THEN 'aprovada' WHEN 'rejeitar' THEN 'rejeitada' ELSE 'revisao' END,
    btrim(p_referencia),jsonb_build_object('estado',rec.estado,'codigo_interno',rec.codigo_interno),
    (SELECT to_jsonb(r)-'criado_por' FROM mk9_rh_private.matriculas_rh_reconciliation r WHERE r.id=p_id));
END;
$$;
REVOKE ALL ON FUNCTION public.mk9_rh_reconciliation_decide(uuid,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mk9_rh_reconciliation_decide(uuid,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.mk9_rh_reconciliation_audit(p_id uuid)
RETURNS TABLE(id bigint,autor_nome text,acao text,referencia text,antes jsonb,depois jsonb,ocorrido_em timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $$
BEGIN
  PERFORM mk9_rh_private.require_reconciliation_admin();
  RETURN QUERY SELECT a.id,p.name,a.acao,a.referencia,a.antes,a.depois,a.ocorrido_em
  FROM mk9_rh_private.matriculas_rh_reconciliation_audit a JOIN public.profiles p ON p.id=a.autor_id
  WHERE a.reconciliation_id=p_id ORDER BY a.ocorrido_em DESC,a.id DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.mk9_rh_reconciliation_audit(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mk9_rh_reconciliation_audit(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.mk9_rh_reconciliation_preview()
RETURNS TABLE(aprovadas integer,aplicadas integer,pendentes integer,conflitos integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $$
BEGIN
  PERFORM mk9_rh_private.require_reconciliation_admin();
  RETURN QUERY SELECT count(*) FILTER(WHERE estado='aprovada')::integer,count(*) FILTER(WHERE estado='aplicada')::integer,
    count(*) FILTER(WHERE estado IN ('pendente','revisao'))::integer,
    (SELECT count(*)::integer FROM (
      SELECT matricula_rh FROM mk9_rh_private.matriculas_rh_reconciliation WHERE estado IN ('aprovada','aplicada') GROUP BY matricula_rh HAVING count(*)>1
      UNION ALL SELECT codigo_interno FROM mk9_rh_private.matriculas_rh_reconciliation WHERE estado IN ('aprovada','aplicada') GROUP BY codigo_interno HAVING count(*)>1
    ) d)
  FROM mk9_rh_private.matriculas_rh_reconciliation;
END;
$$;
REVOKE ALL ON FUNCTION public.mk9_rh_reconciliation_preview() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mk9_rh_reconciliation_preview() TO authenticated;

CREATE OR REPLACE FUNCTION public.mk9_rh_reconciliation_apply(p_referencia text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE caller uuid; affected integer;
BEGIN
  caller:=mk9_rh_private.require_reconciliation_admin();
  IF length(btrim(coalesce(p_referencia,''))) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Application reference required' USING ERRCODE='22023'; END IF;
  IF EXISTS (SELECT 1 FROM (
    SELECT matricula_rh FROM mk9_rh_private.matriculas_rh_reconciliation WHERE estado IN ('aprovada','aplicada') GROUP BY matricula_rh HAVING count(*)>1
    UNION ALL SELECT codigo_interno FROM mk9_rh_private.matriculas_rh_reconciliation WHERE estado IN ('aprovada','aplicada') GROUP BY codigo_interno HAVING count(*)>1
  ) d) THEN RAISE EXCEPTION 'Conflicting approved registrations' USING ERRCODE='23505'; END IF;
  WITH applied AS (
    UPDATE mk9_rh_private.matriculas_rh_reconciliation SET estado='aplicada',aplicado_por=caller,aplicado_em=statement_timestamp(),atualizado_em=statement_timestamp()
    WHERE estado='aprovada' RETURNING *
  )
  INSERT INTO mk9_rh_private.matriculas_rh_reconciliation_audit(reconciliation_id,autor_id,acao,referencia,depois)
    SELECT id,caller,'aplicada',btrim(p_referencia),to_jsonb(applied)-'criado_por' FROM applied;
  GET DIAGNOSTICS affected=ROW_COUNT;
  RETURN affected;
END;
$$;
REVOKE ALL ON FUNCTION public.mk9_rh_reconciliation_apply(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mk9_rh_reconciliation_apply(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.mk9_rh_reconciliation_reverse(p_id uuid,p_referencia text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE caller uuid; rec mk9_rh_private.matriculas_rh_reconciliation%ROWTYPE;
BEGIN
  caller:=mk9_rh_private.require_reconciliation_admin();
  IF length(btrim(coalesce(p_referencia,''))) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Reversal reference required' USING ERRCODE='22023'; END IF;
  SELECT * INTO rec FROM mk9_rh_private.matriculas_rh_reconciliation WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR rec.estado<>'aplicada' THEN RAISE EXCEPTION 'Only applied registration can be reversed' USING ERRCODE='55000'; END IF;
  UPDATE mk9_rh_private.matriculas_rh_reconciliation SET estado='revertida',revertido_por=caller,revertido_em=statement_timestamp(),
    observacao_decisao=btrim(p_referencia),atualizado_em=statement_timestamp() WHERE id=p_id;
  INSERT INTO mk9_rh_private.matriculas_rh_reconciliation_audit(reconciliation_id,autor_id,acao,referencia,antes,depois)
  VALUES(p_id,caller,'revertida',btrim(p_referencia),to_jsonb(rec)-'criado_por',(SELECT to_jsonb(r)-'criado_por' FROM mk9_rh_private.matriculas_rh_reconciliation r WHERE r.id=p_id));
END;
$$;
REVOKE ALL ON FUNCTION public.mk9_rh_reconciliation_reverse(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mk9_rh_reconciliation_reverse(uuid,text) TO authenticated;

-- Faltas e Atestados can display only registrations explicitly applied by an
-- authorized reviewer. Pending, rejected and merely approved rows are omitted.
CREATE OR REPLACE FUNCTION public.mk9_faltas_atestados_rh_matriculas()
RETURNS TABLE(promotor_id uuid,matricula_interna text,matricula_rh text,estado text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT mk9_rh_private.can_prepare_absences() THEN
    RAISE EXCEPTION 'faltas_atestados_prepare permission required' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT r.promotor_id,p.matricula,r.matricula_rh,r.estado
  FROM mk9_rh_private.matriculas_rh_reconciliation r
  JOIN public.promotores p ON p.id=r.promotor_id
  WHERE r.estado='aplicada' AND r.promotor_id IS NOT NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.mk9_faltas_atestados_rh_matriculas() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mk9_faltas_atestados_rh_matriculas() TO authenticated;

COMMIT;
