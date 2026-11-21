-- RC1.25.66: audited full edit of completed visit content.
-- Operational identity/status/timestamps remain immutable; original photo objects
-- are append-only and are never removed by this workflow.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $preflight$
BEGIN
  IF split_part(current_setting('server_version'), '.', 1) <> '17' THEN
    RAISE EXCEPTION 'RC1.25.66 requires PostgreSQL 17';
  END IF;
  IF to_regclass('public.visit_edits_audit_log') IS NULL
     OR to_regclass('public.visit_sku_stock_checks') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname='attendance_private') THEN
    RAISE EXCEPTION 'Required completed-visit edit schema is missing';
  END IF;
END
$preflight$;

CREATE TABLE attendance_private.completed_visit_edit_authorizations (
  token uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '15 minutes'),
  consumed_at timestamptz,
  CONSTRAINT completed_visit_edit_auth_expiry CHECK (expires_at > created_at)
);
CREATE INDEX completed_visit_edit_auth_visit_expiry_idx
  ON attendance_private.completed_visit_edit_authorizations(visit_id, expires_at DESC);
REVOKE ALL ON attendance_private.completed_visit_edit_authorizations FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION attendance_private.photo_upload_allowed(object_name text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.visits v
    JOIN public.profiles p ON p.id = auth.uid() AND p.status = 'ativo'
    WHERE (
      (
        object_name ~ '^visits/[0-9a-fA-F-]{36}/[^/]+$'
        AND v.status = 'em_andamento'
        AND v.regularization_status IS NULL
        AND attendance_private.is_visit_in_current_operational_day(v.id)
        AND p.role = 'promotor'
        AND p.promotor_matricula = v.promotor_matricula
      )
      OR (
        object_name ~ '^visits/[0-9a-fA-F-]{36}/[^/]+$'
        AND p.role IN ('admin', 'gestor')
        AND attendance_private.staff_can_access(v.promotor_matricula)
      )
      OR (
        object_name ~ '^visits/[0-9a-fA-F-]{36}/edits/[0-9a-fA-F-]{36}/[^/]+$'
        AND v.status = 'concluida'
        AND v.regularization_status IS NULL
        AND (
          (p.role = 'promotor' AND p.promotor_matricula = v.promotor_matricula)
          OR (p.role IN ('admin', 'gestor') AND attendance_private.staff_can_access(v.promotor_matricula))
        )
        AND EXISTS (
          SELECT 1 FROM attendance_private.completed_visit_edit_authorizations a
          WHERE a.visit_id = v.id
            AND a.actor_user_id = p.id
            AND a.token::text = split_part(object_name, '/', 4)
            AND a.consumed_at IS NULL
            AND a.expires_at > clock_timestamp()
        )
      )
    )
      AND split_part(object_name, '/', 2) = v.id::text
  );
$$;
REVOKE ALL ON FUNCTION attendance_private.photo_upload_allowed(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION attendance_private.photo_upload_allowed(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.begin_completed_visit_edit(p_visit_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_matricula text;
  v_visit public.visits%ROWTYPE;
  v_token uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Acesso não autenticado' USING ERRCODE = '42501'; END IF;
  SELECT p.role, p.promotor_matricula INTO v_role, v_matricula
  FROM public.profiles p WHERE p.id = v_uid AND p.status = 'ativo';
  IF v_role IS NULL OR v_role NOT IN ('admin', 'gestor', 'promotor') THEN
    RAISE EXCEPTION 'Perfil ativo sem permissão para revisar atendimentos' USING ERRCODE = '42501';
  END IF;
  SELECT v.* INTO v_visit FROM public.visits v WHERE v.id = p_visit_id FOR UPDATE;
  IF NOT FOUND OR v_visit.status <> 'concluida' OR v_visit.regularization_status IS NOT NULL THEN
    RAISE EXCEPTION 'Somente atendimentos concluídos e não regularizados podem ser editados' USING ERRCODE = '42501';
  END IF;
  IF v_role NOT IN ('admin', 'gestor')
     AND (v_matricula IS NULL OR v_matricula IS DISTINCT FROM v_visit.promotor_matricula) THEN
    RAISE EXCEPTION 'Promotor só pode editar atendimento próprio' USING ERRCODE = '42501';
  END IF;

  IF v_role IN ('admin', 'gestor') AND NOT attendance_private.staff_can_access(v_visit.promotor_matricula) THEN
    RAISE EXCEPTION 'Atendimento fora do escopo autorizado do operador' USING ERRCODE = '42501';
  END IF;

  DELETE FROM attendance_private.completed_visit_edit_authorizations a
  WHERE a.expires_at <= clock_timestamp() OR a.consumed_at IS NOT NULL;
  INSERT INTO attendance_private.completed_visit_edit_authorizations(visit_id, actor_user_id)
  VALUES (p_visit_id, v_uid) RETURNING token INTO v_token;
  RETURN jsonb_build_object('edit_token', v_token, 'expires_in_seconds', 900);
END;
$$;
REVOKE ALL ON FUNCTION public.begin_completed_visit_edit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.begin_completed_visit_edit(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_completed_visit_full_edit(
  p_visit_id uuid,
  p_edit_token uuid,
  p_payload jsonb,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_matricula text;
  v_visit public.visits%ROWTYPE;
  v_auth attendance_private.completed_visit_edit_authorizations%ROWTYPE;
  v_old_state jsonb;
  v_new_state jsonb;
  v_changes jsonb := '[]'::jsonb;
  v_entry record;
  v_item jsonb;
  v_photo jsonb;
  v_path text;
  v_new_obs text;
  v_audit_id uuid;
  v_edited_at timestamptz := clock_timestamp();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Acesso não autenticado' USING ERRCODE = '42501'; END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Dados de edição inválidos' USING ERRCODE = '22023';
  END IF;
  IF p_payload - ARRAY['observacao_geral','checklist_items','validity_items','sku_stock_checks','occurrences','photos']::text[] <> '{}'::jsonb THEN
    RAISE EXCEPTION 'O formulário contém campos não permitidos' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 5 OR length(trim(p_reason)) > 1000 THEN
    RAISE EXCEPTION 'Justificativa obrigatória (5 a 1000 caracteres)' USING ERRCODE = '23514';
  END IF;

  SELECT p.role, p.promotor_matricula INTO v_role, v_matricula
  FROM public.profiles p WHERE p.id = v_uid AND p.status = 'ativo';
  IF v_role IS NULL OR v_role NOT IN ('admin','gestor','promotor') THEN
    RAISE EXCEPTION 'Perfil ativo sem permissão para revisar atendimentos' USING ERRCODE = '42501';
  END IF;
  SELECT v.* INTO v_visit FROM public.visits v WHERE v.id = p_visit_id FOR UPDATE;
  IF NOT FOUND OR v_visit.status <> 'concluida' OR v_visit.regularization_status IS NOT NULL THEN
    RAISE EXCEPTION 'Somente atendimentos concluídos e não regularizados podem ser editados' USING ERRCODE = '42501';
  END IF;
  IF v_role NOT IN ('admin','gestor')
     AND (v_matricula IS NULL OR v_matricula IS DISTINCT FROM v_visit.promotor_matricula) THEN
    RAISE EXCEPTION 'Promotor só pode editar atendimento próprio' USING ERRCODE = '42501';
  END IF;
  IF v_role IN ('admin','gestor') AND NOT attendance_private.staff_can_access(v_visit.promotor_matricula) THEN
    RAISE EXCEPTION 'Atendimento fora do escopo autorizado do operador' USING ERRCODE = '42501';
  END IF;
  SELECT a.* INTO v_auth
  FROM attendance_private.completed_visit_edit_authorizations a
  WHERE a.token = p_edit_token AND a.visit_id = p_visit_id AND a.actor_user_id = v_uid
    AND a.consumed_at IS NULL AND a.expires_at > clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Autorização de edição expirada ou inválida' USING ERRCODE = '42501'; END IF;

  IF p_payload ? 'observacao_geral' AND jsonb_typeof(p_payload->'observacao_geral') NOT IN ('string','null') THEN
    RAISE EXCEPTION 'Observação geral inválida' USING ERRCODE = '22023';
  END IF;
  IF p_payload ? 'checklist_items' AND jsonb_typeof(p_payload->'checklist_items') <> 'array' THEN
    RAISE EXCEPTION 'Checklist deve ser uma lista' USING ERRCODE = '22023';
  END IF;
  IF p_payload ? 'checklist_items' AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_payload->'checklist_items') e(value)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.visit_checklist_items c
      WHERE c.visit_id=p_visit_id AND c.item_key=e.value->>'item_key'
    )
  ) THEN
    RAISE EXCEPTION 'The edit can only change checklist entries already recorded for this visit' USING ERRCODE = '22023';
  END IF;
  IF p_payload ? 'validity_items' AND jsonb_typeof(p_payload->'validity_items') <> 'array' THEN
    RAISE EXCEPTION 'Validades devem ser uma lista' USING ERRCODE = '22023';
  END IF;
  IF p_payload ? 'sku_stock_checks' AND jsonb_typeof(p_payload->'sku_stock_checks') <> 'array' THEN
    RAISE EXCEPTION 'Conferências de SKU devem ser uma lista' USING ERRCODE = '22023';
  END IF;
  IF p_payload ? 'occurrences' AND jsonb_typeof(p_payload->'occurrences') <> 'array' THEN
    RAISE EXCEPTION 'Ocorrências devem ser uma lista' USING ERRCODE = '22023';
  END IF;
  IF p_payload ? 'photos' AND jsonb_typeof(p_payload->'photos') <> 'array' THEN
    RAISE EXCEPTION 'Evidências devem ser uma lista' USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_build_object(
    'observacao_geral', v.observacao_geral,
    'checklist_items', coalesce((SELECT jsonb_agg(to_jsonb(c) - 'created_at' - 'updated_at' ORDER BY c.item_key) FROM public.visit_checklist_items c WHERE c.visit_id = p_visit_id), '[]'::jsonb),
    'validity_items', coalesce((SELECT jsonb_agg(to_jsonb(x) - 'created_at' ORDER BY x.id) FROM public.visit_product_validity x WHERE x.visit_id = p_visit_id), '[]'::jsonb),
    'sku_stock_checks', coalesce((SELECT jsonb_agg(to_jsonb(s) - 'created_at' - 'updated_at' ORDER BY s.codigo_sku) FROM public.visit_sku_stock_checks s WHERE s.visit_id = p_visit_id), '[]'::jsonb),
    'occurrences', coalesce((SELECT jsonb_agg(to_jsonb(o) - 'created_at' ORDER BY o.id) FROM public.visit_occurrences o WHERE o.visit_id = p_visit_id), '[]'::jsonb),
    'photos', coalesce((SELECT jsonb_agg(to_jsonb(ph) - 'created_at' ORDER BY ph.id) FROM public.visit_photos ph WHERE ph.visit_id = p_visit_id), '[]'::jsonb)
  ) INTO v_old_state FROM public.visits v WHERE v.id = p_visit_id;

  v_new_obs := CASE WHEN p_payload ? 'observacao_geral' THEN nullif(trim(p_payload->>'observacao_geral'), '') ELSE v_visit.observacao_geral END;
  INSERT INTO public.visit_edits_audit_log(
    visit_id, altered_by_user_id, altered_by_matricula, field_name, old_value, new_value,
    changes_summary, reason, authorization_token, token_consumed_at
  ) VALUES (
    p_visit_id, v_uid, coalesce(v_matricula,'admin'), 'completed_visit_edit',
    jsonb_build_object('observacao_geral',v_visit.observacao_geral,'state',v_old_state),
    jsonb_build_object('observacao_geral',v_new_obs,'state',v_old_state),
    '[]'::jsonb, trim(p_reason), p_edit_token, NULL
  ) RETURNING id INTO v_audit_id;

  PERFORM pg_catalog.set_config('mk9.current_audit_token', p_edit_token::text, true);
  -- Always perform this guarded no-op-capable update so the existing visits
  -- integrity trigger atomically consumes the single-use audit token.
  UPDATE public.visits SET observacao_geral = v_new_obs, updated_at = v_edited_at WHERE id = p_visit_id;

  IF p_payload ? 'checklist_items' THEN
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'checklist_items') e(value)
      WHERE jsonb_typeof(e.value) <> 'object' OR nullif(trim(e.value->>'item_key'),'') IS NULL
        OR jsonb_typeof(e.value->'item_key') <> 'string'
        OR jsonb_typeof(e.value->'item_label') NOT IN ('string','null')
        OR jsonb_typeof(e.value->'checked') NOT IN ('boolean','null')
        OR jsonb_typeof(e.value->'valor_texto') NOT IN ('string','null')
        OR jsonb_typeof(e.value->'observacao') NOT IN ('string','null')) THEN
      RAISE EXCEPTION 'Item de checklist inválido' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'checklist_items') e(value)
      GROUP BY e.value->>'item_key' HAVING count(*) > 1) THEN
      RAISE EXCEPTION 'Checklist contém chave duplicada' USING ERRCODE = '22023';
    END IF;
    DELETE FROM public.visit_checklist_items c WHERE c.visit_id = p_visit_id
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'checklist_items') e(value) WHERE e.value->>'item_key' = c.item_key);
    INSERT INTO public.visit_checklist_items(visit_id,item_key,item_label,checked,valor_texto,observacao,updated_at)
    SELECT p_visit_id, trim(e.value->>'item_key'), coalesce(nullif(trim(e.value->>'item_label'),''),trim(e.value->>'item_key')),
      coalesce((e.value->>'checked')::boolean,false), e.value->>'valor_texto', e.value->>'observacao', v_edited_at
    FROM jsonb_array_elements(p_payload->'checklist_items') e(value)
    ON CONFLICT (visit_id,item_key) DO UPDATE SET item_label=excluded.item_label,checked=excluded.checked,
      valor_texto=excluded.valor_texto,observacao=excluded.observacao,updated_at=v_edited_at;
  END IF;

  IF p_payload ? 'validity_items' THEN
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'validity_items') e(value)
      WHERE jsonb_typeof(e.value) <> 'object' OR nullif(trim(e.value->>'produto_nome'),'') IS NULL
        OR coalesce(e.value->>'quantidade','') !~ '^[0-9]+$'
        OR coalesce(e.value->>'data_vencimento','') !~ '^\d{4}-\d{2}-\d{2}$') THEN
      RAISE EXCEPTION 'Registro de validade inválido' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'validity_items') e(value)
      WHERE nullif(e.value->>'id','') IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.visit_product_validity x WHERE x.id=(e.value->>'id')::uuid AND x.visit_id=p_visit_id)) THEN
      RAISE EXCEPTION 'Registro de validade não pertence ao atendimento' USING ERRCODE = '42501';
    END IF;
    DELETE FROM public.visit_product_validity x WHERE x.visit_id=p_visit_id
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'validity_items') e(value) WHERE e.value->>'id'=x.id::text);
    FOR v_entry IN SELECT value FROM jsonb_array_elements(p_payload->'validity_items') LOOP
      IF nullif(v_entry.value->>'id','') IS NULL THEN
        INSERT INTO public.visit_product_validity(visit_id,produto_nome,quantidade,data_vencimento,lote,observacao)
        VALUES (p_visit_id,trim(v_entry.value->>'produto_nome'),(v_entry.value->>'quantidade')::integer,(v_entry.value->>'data_vencimento')::date,
          nullif(trim(v_entry.value->>'lote'),''),nullif(trim(v_entry.value->>'observacao'),''));
      ELSE
        UPDATE public.visit_product_validity SET produto_nome=trim(v_entry.value->>'produto_nome'),quantidade=(v_entry.value->>'quantidade')::integer,
          data_vencimento=(v_entry.value->>'data_vencimento')::date,lote=nullif(trim(v_entry.value->>'lote'),''),
          observacao=nullif(trim(v_entry.value->>'observacao'),'')
        WHERE id=(v_entry.value->>'id')::uuid AND visit_id=p_visit_id;
      END IF;
    END LOOP;
  END IF;

  IF p_payload ? 'occurrences' THEN
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'occurrences') e(value)
      WHERE jsonb_typeof(e.value) <> 'object' OR e.value->>'tipo' NOT IN ('ruptura','preco_divergente','falta_espaco','outro')
        OR nullif(trim(e.value->>'descricao'),'') IS NULL
        OR jsonb_typeof(e.value->'resolvido') NOT IN ('boolean','null')) THEN
      RAISE EXCEPTION 'Ocorrência inválida' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'occurrences') e(value)
      WHERE nullif(e.value->>'id','') IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.visit_occurrences o WHERE o.id=(e.value->>'id')::uuid AND o.visit_id=p_visit_id)) THEN
      RAISE EXCEPTION 'Ocorrência não pertence ao atendimento' USING ERRCODE = '42501';
    END IF;
    DELETE FROM public.visit_occurrences o WHERE o.visit_id=p_visit_id
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'occurrences') e(value) WHERE e.value->>'id'=o.id::text);
    FOR v_entry IN SELECT value FROM jsonb_array_elements(p_payload->'occurrences') LOOP
      IF nullif(v_entry.value->>'id','') IS NULL THEN
        INSERT INTO public.visit_occurrences(visit_id,tipo,descricao,resolvido)
        VALUES (p_visit_id,v_entry.value->>'tipo',trim(v_entry.value->>'descricao'),coalesce((v_entry.value->>'resolvido')::boolean,false));
      ELSE
        UPDATE public.visit_occurrences SET tipo=v_entry.value->>'tipo',descricao=trim(v_entry.value->>'descricao'),
          resolvido=coalesce((v_entry.value->>'resolvido')::boolean,false)
        WHERE id=(v_entry.value->>'id')::uuid AND visit_id=p_visit_id;
      END IF;
    END LOOP;
  END IF;

  IF p_payload ? 'sku_stock_checks' THEN
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'sku_stock_checks') e(value)
      WHERE jsonb_typeof(e.value) <> 'object' OR nullif(trim(e.value->>'codigo_sku'),'') IS NULL
        OR coalesce(e.value->>'quantidade_venda','') !~ '^[0-9]+$'
        OR coalesce(e.value->>'quantidade_deposito','') !~ '^[0-9]+$'
        OR coalesce(e.value->>'quantidade_reposicao','') !~ '^[0-9]+$'
        OR e.value->>'status_conferencia' IS NULL
        OR e.value->>'status_conferencia' NOT IN ('conferido','justificado','pendente')) THEN
      RAISE EXCEPTION 'Conferência de SKU inválida' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'sku_stock_checks') e(value)
      GROUP BY e.value->>'codigo_sku' HAVING count(*) > 1) THEN
      RAISE EXCEPTION 'Conferência contém SKU duplicado' USING ERRCODE = '22023';
    END IF;
    DELETE FROM public.visit_sku_stock_checks s WHERE s.visit_id=p_visit_id
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'sku_stock_checks') e(value) WHERE e.value->>'codigo_sku'=s.codigo_sku);
    INSERT INTO public.visit_sku_stock_checks(
      visit_id,industria_codigo,loja_codigo,codigo_sku,data_conferencia,quantidade_venda,quantidade_deposito,
      quantidade_reposicao,quantidade_anterior_venda,quantidade_anterior_deposito,status_conferencia,justificativa,observacao,conferido_por_matricula
    )
    SELECT p_visit_id,v_visit.industria_codigo,v_visit.loja_codigo,trim(e.value->>'codigo_sku'),v_visit.data_visita,
      (e.value->>'quantidade_venda')::integer,(e.value->>'quantidade_deposito')::integer,(e.value->>'quantidade_reposicao')::integer,
      0,0,
      e.value->>'status_conferencia',nullif(e.value->>'justificativa',''),nullif(trim(e.value->>'observacao'),''),v_visit.promotor_matricula
    FROM jsonb_array_elements(p_payload->'sku_stock_checks') e(value)
    ON CONFLICT (visit_id,codigo_sku) DO UPDATE SET quantidade_venda=excluded.quantidade_venda,
      quantidade_deposito=excluded.quantidade_deposito,quantidade_reposicao=excluded.quantidade_reposicao,
      status_conferencia=excluded.status_conferencia,justificativa=excluded.justificativa,observacao=excluded.observacao,
      updated_at=v_edited_at;
  END IF;

  IF p_payload ? 'photos' THEN
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'photos') e(value)
      WHERE jsonb_typeof(e.value) <> 'object' OR e.value->>'tipo_foto' NOT IN ('fachada','gondola','preco','ponto_extra','ruptura','outros')) THEN
      RAISE EXCEPTION 'Metadados da fotografia inválidos' USING ERRCODE = '22023';
    END IF;
    FOR v_photo IN SELECT value FROM jsonb_array_elements(p_payload->'photos') LOOP
      IF nullif(v_photo->>'id','') IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.visit_photos ph WHERE ph.id=(v_photo->>'id')::uuid AND ph.visit_id=p_visit_id) THEN
          RAISE EXCEPTION 'Fotografia não pertence ao atendimento' USING ERRCODE = '42501';
        END IF;
        UPDATE public.visit_photos SET tipo_foto=v_photo->>'tipo_foto',legenda=nullif(trim(v_photo->>'legenda'),'')
        WHERE id=(v_photo->>'id')::uuid AND visit_id=p_visit_id;
      ELSE
        v_path := v_photo->>'storage_path';
        IF v_path IS NULL OR v_path !~ ('^visits/' || p_visit_id::text || '/edits/' || p_edit_token::text || '/[^/]+$')
           OR NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id='visit-photos' AND o.name=v_path) THEN
          RAISE EXCEPTION 'Nova evidência não corresponde ao token desta edição' USING ERRCODE = '42501';
        END IF;
        INSERT INTO public.visit_photos(visit_id,tipo_foto,storage_path,file_url,legenda)
        VALUES (p_visit_id,v_photo->>'tipo_foto',v_path,v_path,nullif(trim(v_photo->>'legenda'),''));
      END IF;
    END LOOP;
  END IF;

  SELECT jsonb_build_object(
    'observacao_geral', v.observacao_geral,
    'checklist_items', coalesce((SELECT jsonb_agg(to_jsonb(c) - 'created_at' - 'updated_at' ORDER BY c.item_key) FROM public.visit_checklist_items c WHERE c.visit_id=p_visit_id),'[]'::jsonb),
    'validity_items', coalesce((SELECT jsonb_agg(to_jsonb(x) - 'created_at' ORDER BY x.id) FROM public.visit_product_validity x WHERE x.visit_id=p_visit_id),'[]'::jsonb),
    'sku_stock_checks', coalesce((SELECT jsonb_agg(to_jsonb(s) - 'created_at' - 'updated_at' ORDER BY s.codigo_sku) FROM public.visit_sku_stock_checks s WHERE s.visit_id=p_visit_id),'[]'::jsonb),
    'occurrences', coalesce((SELECT jsonb_agg(to_jsonb(o) - 'created_at' ORDER BY o.id) FROM public.visit_occurrences o WHERE o.visit_id=p_visit_id),'[]'::jsonb),
    'photos', coalesce((SELECT jsonb_agg(to_jsonb(ph) - 'created_at' ORDER BY ph.id) FROM public.visit_photos ph WHERE ph.visit_id=p_visit_id),'[]'::jsonb)
  ) INTO v_new_state FROM public.visits v WHERE v.id=p_visit_id;

  FOR v_entry IN SELECT key,value FROM jsonb_each(v_old_state) LOOP
    IF v_entry.value IS DISTINCT FROM v_new_state->v_entry.key THEN
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field',v_entry.key,'old_value',v_entry.value,'new_value',v_new_state->v_entry.key
      ));
    END IF;
  END LOOP;
  IF v_changes = '[]'::jsonb THEN
    RAISE EXCEPTION 'Nenhuma alteração foi feita' USING ERRCODE = '22023';
  END IF;

  UPDATE public.visit_edits_audit_log
  SET new_value=jsonb_build_object('observacao_geral',v_new_obs,'state',v_new_state),changes_summary=v_changes
  WHERE id=v_audit_id;
  UPDATE attendance_private.completed_visit_edit_authorizations SET consumed_at=v_edited_at
  WHERE token=p_edit_token AND actor_user_id=v_uid AND visit_id=p_visit_id;

  IF EXISTS (SELECT 1 FROM public.visits v WHERE v.id=p_visit_id
    AND (v.status IS DISTINCT FROM 'concluida' OR v.completed_at IS DISTINCT FROM v_visit.completed_at
      OR v.started_at IS DISTINCT FROM v_visit.started_at OR v.promotor_matricula IS DISTINCT FROM v_visit.promotor_matricula
      OR v.loja_codigo IS DISTINCT FROM v_visit.loja_codigo OR v.industria_codigo IS DISTINCT FROM v_visit.industria_codigo
      OR v.data_visita IS DISTINCT FROM v_visit.data_visita OR v.rota_id IS DISTINCT FROM v_visit.rota_id)) THEN
    RAISE EXCEPTION 'A edição não pode alterar a identidade operacional ou reabrir o atendimento' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object('success',true,'visit_id',p_visit_id,'edited_at',v_edited_at,'changes_summary',v_changes);
END;
$$;
REVOKE ALL ON FUNCTION public.save_completed_visit_full_edit(uuid,uuid,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_completed_visit_full_edit(uuid,uuid,jsonb,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_visit_sku_stock_check()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_visit public.visits%ROWTYPE;
  v_token text := nullif(pg_catalog.current_setting('mk9.current_audit_token', true), '');
BEGIN
  SELECT * INTO v_visit FROM public.visits WHERE id=NEW.visit_id FOR UPDATE;
  IF NOT FOUND OR NEW.industria_codigo IS DISTINCT FROM v_visit.industria_codigo
     OR NEW.loja_codigo IS DISTINCT FROM v_visit.loja_codigo
     OR NEW.conferido_por_matricula IS DISTINCT FROM v_visit.promotor_matricula THEN
    RAISE EXCEPTION 'Conferência SKU deve pertencer ao atendimento e promotor titular' USING ERRCODE='42501';
  END IF;
  IF v_visit.status <> 'em_andamento' AND NOT (
    v_visit.status='concluida' AND v_token IS NOT NULL AND EXISTS (
      SELECT 1 FROM attendance_private.completed_visit_edit_authorizations a
      WHERE a.visit_id=v_visit.id AND a.token::text=v_token
        AND a.actor_user_id=auth.uid() AND a.consumed_at IS NULL
        AND a.expires_at > clock_timestamp()
    )
  ) THEN
    RAISE EXCEPTION 'Conferência SKU só pode ser ajustada durante atendimento aberto ou revisão autorizada' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.industria_skus s WHERE s.industria_codigo=NEW.industria_codigo
    AND s.codigo_sku=NEW.codigo_sku AND (s.status='ativo' OR EXISTS (
      SELECT 1 FROM public.visit_sku_stock_checks old_check
      WHERE old_check.id=NEW.id AND old_check.visit_id=NEW.visit_id
        AND old_check.codigo_sku=NEW.codigo_sku))) THEN
    RAISE EXCEPTION 'SKU não pertence ao catálogo desta indústria' USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_visit_sku_stock_check() FROM PUBLIC, anon, authenticated;

DO $postflight$
DECLARE v_def text; v_secdef boolean; v_path text; v_public_exec boolean;
BEGIN
  SELECT pg_get_functiondef(p.oid),p.prosecdef,array_to_string(p.proconfig,',')
    INTO v_def,v_secdef,v_path FROM pg_proc p
    WHERE p.oid='public.save_completed_visit_full_edit(uuid,uuid,jsonb,text)'::regprocedure;
  IF v_secdef IS DISTINCT FROM true OR v_path NOT LIKE '%search_path=""%' THEN
    RAISE EXCEPTION 'Full edit RPC must be SECURITY DEFINER with empty search_path';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p,
      LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
    WHERE p.oid='public.save_completed_visit_full_edit(uuid,uuid,jsonb,text)'::regprocedure
      AND acl.grantee=0 AND acl.privilege_type='EXECUTE'
  ) INTO v_public_exec;
  IF has_function_privilege('anon','public.save_completed_visit_full_edit(uuid,uuid,jsonb,text)'::regprocedure,'EXECUTE')
     OR v_public_exec THEN
    RAISE EXCEPTION 'Full edit RPC must not be executable by anon or PUBLIC';
  END IF;
  IF position('v_visit.status <> ''concluida''' in v_def)=0
     OR position('p_edit_token' in v_def)=0
     OR position('v.rota_id IS DISTINCT FROM v_visit.rota_id' in v_def)=0 THEN
    RAISE EXCEPTION 'Full edit safeguards are missing';
  END IF;
END
$postflight$;

COMMIT;
