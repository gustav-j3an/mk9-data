-- RC1.25.42 corrective migration for server-derived visit edit diffs.
-- Source snapshot: staging project tafjceemuetqjyngresg, PG 17.11, 2026-11-18.
-- This file is the 58th staging migration, not a replay of M37/M38/RC1.25.
BEGIN;

DO $preflight$
DECLARE v_pg text; v_cron text;
BEGIN
  v_pg := current_setting('server_version');
  IF split_part(v_pg, '.', 1) <> '17' THEN
    RAISE EXCEPTION 'Expected PostgreSQL 17, found %', v_pg;
  END IF;
  SELECT e.extversion INTO v_cron FROM pg_catalog.pg_extension e WHERE e.extname='pg_cron';
  IF v_cron IS DISTINCT FROM '1.6.4' THEN
    RAISE EXCEPTION 'Expected pg_cron 1.6.4, found %', coalesce(v_cron,'missing');
  END IF;
  IF to_regclass('public.visit_edits_audit_log') IS NULL
     OR to_regclass('public.visit_checklist_items') IS NULL
     OR to_regclass('public.visits') IS NULL THEN
    RAISE EXCEPTION 'Required RC1.25.42 base tables are missing';
  END IF;
END
$preflight$;

ALTER TABLE public.visit_edits_audit_log
  ADD COLUMN IF NOT EXISTS changes_summary jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid='public.visit_edits_audit_log'::regclass
      AND conname='visit_edits_audit_changes_summary_array'
  ) THEN
    ALTER TABLE public.visit_edits_audit_log
      ADD CONSTRAINT visit_edits_audit_changes_summary_array
      CHECK (jsonb_typeof(changes_summary) = 'array');
  END IF;
END
$constraint$;

CREATE OR REPLACE FUNCTION public.save_completed_visit_edit(p_visit_id uuid, p_observacao_geral text, p_checklist_items jsonb, p_reason text, p_changes_summary jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_visit public.visits%ROWTYPE;
  v_old_state jsonb;
  v_new_state jsonb;
  v_changes jsonb := '[]'::jsonb;
  v_item jsonb;
  v_item_key text;
  v_item_label text;
  v_old_check boolean;
  v_old_text text;
  v_old_note text;
  v_new_check boolean;
  v_new_text text;
  v_new_note text;
  v_old_exists boolean;
  v_saved public.visit_checklist_items%ROWTYPE;
  v_caller_uid uuid;
  v_caller_role text;
  v_caller_matricula text;
  v_new_obs text;
  v_audit_token uuid;
  v_audit_id uuid;
  v_edited_at timestamptz := clock_timestamp();
BEGIN
  -- p_changes_summary remains in the signature for API compatibility only.
  -- It is deliberately never trusted or persisted; the server computes the diff.
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'Acesso não autenticado' USING ERRCODE='42501';
  END IF;

  SELECT p.role, p.promotor_matricula
    INTO v_caller_role, v_caller_matricula
  FROM public.profiles p
  WHERE p.id=v_caller_uid AND p.status='ativo';

  IF v_caller_role IS NULL OR v_caller_role NOT IN ('admin','gestor','promotor') THEN
    RAISE EXCEPTION 'Perfil ativo sem permissão para revisar visitas' USING ERRCODE='42501';
  END IF;

  SELECT v.* INTO v_visit
  FROM public.visits v
  WHERE v.id=p_visit_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Visita não encontrada' USING ERRCODE='P0002';
  END IF;
  IF v_visit.status <> 'concluida' THEN
    RAISE EXCEPTION 'Apenas visitas concluídas podem ser revisadas' USING ERRCODE='42501';
  END IF;
  IF v_caller_role NOT IN ('admin','gestor')
     AND (v_caller_matricula IS NULL OR v_caller_matricula IS DISTINCT FROM v_visit.promotor_matricula) THEN
    RAISE EXCEPTION 'Promotor só pode editar a própria visita' USING ERRCODE='42501';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'Justificativa obrigatória (mínimo de 5 caracteres)' USING ERRCODE='23514';
  END IF;
  IF p_checklist_items IS NOT NULL AND jsonb_typeof(p_checklist_items) <> 'array' THEN
    RAISE EXCEPTION 'Itens de checklist devem ser enviados como uma lista' USING ERRCODE='22023';
  END IF;

  IF p_checklist_items IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_checklist_items) e(value)
      WHERE jsonb_typeof(e.value) <> 'object'
         OR jsonb_typeof(e.value->'item_key') <> 'string'
         OR nullif(trim(e.value->>'item_key'),'') IS NULL
         OR (e.value ? 'checked' AND jsonb_typeof(e.value->'checked') NOT IN ('boolean','null'))
         OR (e.value ? 'valor_texto' AND jsonb_typeof(e.value->'valor_texto') NOT IN ('string','null'))
         OR (e.value ? 'observacao' AND jsonb_typeof(e.value->'observacao') NOT IN ('string','null'))
         OR (e.value ? 'item_label' AND jsonb_typeof(e.value->'item_label') NOT IN ('string','null'))
    ) THEN
      RAISE EXCEPTION 'Checklist contém item ou tipo inválido' USING ERRCODE='22023';
    END IF;

    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_checklist_items) e(value)
      GROUP BY trim(e.value->>'item_key')
      HAVING count(*) > 1
    ) THEN
      RAISE EXCEPTION 'Checklist contém item_key duplicado' USING ERRCODE='22023';
    END IF;
  END IF;

  SELECT jsonb_build_object(
    'observacao_geral', v_visit.observacao_geral,
    'checklist', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'item_key',ci.item_key,'item_label',ci.item_label,'checked',ci.checked,
        'valor_texto',ci.valor_texto,'observacao',ci.observacao
      ) ORDER BY ci.item_key)
      FROM public.visit_checklist_items ci WHERE ci.visit_id=p_visit_id
    ),'[]'::jsonb)
  ) INTO v_old_state;

  v_new_obs := CASE WHEN p_observacao_geral IS NULL
                    THEN v_visit.observacao_geral ELSE trim(p_observacao_geral) END;

  IF v_visit.observacao_geral IS DISTINCT FROM v_new_obs THEN
    v_changes := v_changes || jsonb_build_array(jsonb_build_object(
      'field','observacao_geral',
      'old_value',v_visit.observacao_geral,
      'new_value',v_new_obs
    ));
    v_audit_token := gen_random_uuid();
  END IF;

  -- The audit row must exist before UPDATE because the visits trigger consumes
  -- this single-use token and verifies both old and proposed values.
  INSERT INTO public.visit_edits_audit_log(
    visit_id,altered_by_user_id,altered_by_matricula,field_name,
    old_value,new_value,changes_summary,reason,authorization_token,token_consumed_at
  ) VALUES (
    p_visit_id,v_caller_uid,coalesce(v_caller_matricula,'admin'),'completed_visit_edit',
    jsonb_build_object('observacao_geral',v_visit.observacao_geral,'state',v_old_state),
    jsonb_build_object('observacao_geral',v_new_obs),
    '[]'::jsonb,trim(p_reason),v_audit_token,NULL
  ) RETURNING id INTO v_audit_id;

  IF v_audit_token IS NOT NULL THEN
    PERFORM pg_catalog.set_config('mk9.current_audit_token',v_audit_token::text,true);
    UPDATE public.visits
    SET observacao_geral=v_new_obs, updated_at=v_edited_at
    WHERE id=p_visit_id;
  END IF;

  IF p_checklist_items IS NOT NULL THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_checklist_items)
    LOOP
      v_item_key := trim(v_item->>'item_key');
      v_item_label := coalesce(nullif(trim(v_item->>'item_label'),''),v_item_key);

      SELECT ci.checked,ci.valor_texto,ci.observacao
        INTO v_old_check,v_old_text,v_old_note
      FROM public.visit_checklist_items ci
      WHERE ci.visit_id=p_visit_id AND ci.item_key=v_item_key
      FOR UPDATE;
      v_old_exists := FOUND;

      v_new_check := CASE
        WHEN NOT (v_item ? 'checked') THEN coalesce(v_old_check,false)
        WHEN jsonb_typeof(v_item->'checked')='null' THEN false
        ELSE (v_item->>'checked')::boolean
      END;
      v_new_text := coalesce(v_item->>'valor_texto','');
      v_new_note := coalesce(v_item->>'observacao','');

      INSERT INTO public.visit_checklist_items(
        visit_id,item_key,item_label,checked,valor_texto,observacao
      ) VALUES (
        p_visit_id,v_item_key,v_item_label,v_new_check,v_new_text,v_new_note
      )
      ON CONFLICT(visit_id,item_key) DO UPDATE SET
        checked=EXCLUDED.checked,
        valor_texto=EXCLUDED.valor_texto,
        observacao=EXCLUDED.observacao,
        updated_at=v_edited_at
      RETURNING * INTO v_saved;

      IF v_old_check IS DISTINCT FROM v_saved.checked THEN
        v_changes := v_changes || jsonb_build_array(jsonb_build_object(
          'item_key',v_item_key,'field','checked',
          'old_value',CASE WHEN v_old_exists THEN to_jsonb(v_old_check) ELSE 'null'::jsonb END,
          'new_value',to_jsonb(v_saved.checked)
        ));
      END IF;
      IF v_old_text IS DISTINCT FROM v_saved.valor_texto THEN
        v_changes := v_changes || jsonb_build_array(jsonb_build_object(
          'item_key',v_item_key,'field','valor_texto',
          'old_value',CASE WHEN v_old_exists THEN to_jsonb(v_old_text) ELSE 'null'::jsonb END,
          'new_value',to_jsonb(v_saved.valor_texto)
        ));
      END IF;
      IF v_old_note IS DISTINCT FROM v_saved.observacao THEN
        v_changes := v_changes || jsonb_build_array(jsonb_build_object(
          'item_key',v_item_key,'field','observacao',
          'old_value',CASE WHEN v_old_exists THEN to_jsonb(v_old_note) ELSE 'null'::jsonb END,
          'new_value',to_jsonb(v_saved.observacao)
        ));
      END IF;
    END LOOP;
  END IF;

  SELECT jsonb_build_object(
    'observacao_geral',v.observacao_geral,
    'checklist',coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'item_key',ci.item_key,'item_label',ci.item_label,'checked',ci.checked,
        'valor_texto',ci.valor_texto,'observacao',ci.observacao
      ) ORDER BY ci.item_key)
      FROM public.visit_checklist_items ci WHERE ci.visit_id=p_visit_id
    ),'[]'::jsonb)
  ) INTO v_new_state
  FROM public.visits v WHERE v.id=p_visit_id;

  UPDATE public.visit_edits_audit_log
  SET new_value=v_new_state,
      changes_summary=v_changes
  WHERE id=v_audit_id;

  RETURN jsonb_build_object(
    'success',true,
    'visit_id',p_visit_id,
    'edited_at',v_edited_at,
    'changes_summary',v_changes
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.save_completed_visit_edit(uuid,text,jsonb,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_completed_visit_edit(uuid,text,jsonb,text,jsonb) TO authenticated;

DO $postflight$
DECLARE v_prosecdef boolean; v_search_path text; v_def text; v_type text; v_anon_exec boolean;
BEGIN
  SELECT c.data_type INTO v_type
  FROM information_schema.columns c
  WHERE c.table_schema='public' AND c.table_name='visit_edits_audit_log'
    AND c.column_name='changes_summary';
  IF v_type IS DISTINCT FROM 'jsonb' THEN
    RAISE EXCEPTION 'changes_summary must be jsonb';
  END IF;
  SELECT p.prosecdef, array_to_string(p.proconfig, ','),
         pg_get_functiondef(p.oid)
    INTO v_prosecdef, v_search_path, v_def
  FROM pg_catalog.pg_proc p
  WHERE p.oid='public.save_completed_visit_edit(uuid,text,jsonb,text,jsonb)'::regprocedure;
  SELECT has_function_privilege('anon', 'public.save_completed_visit_edit(uuid,text,jsonb,text,jsonb)'::regprocedure, 'EXECUTE') INTO v_anon_exec;
  IF v_anon_exec THEN
    RAISE EXCEPTION 'anon must not execute the completed-visit edit RPC';
  END IF;
  IF v_prosecdef IS DISTINCT FROM true OR v_search_path NOT LIKE '%search_path=""%' THEN
    RAISE EXCEPTION 'RPC must remain SECURITY DEFINER with empty/fixed search_path';
  END IF;
  IF position('changes_summary=v_changes' in v_def)=0
     OR position('p_changes_summary remains' in v_def)=0 THEN
    RAISE EXCEPTION 'RPC does not show server-derived audit diff behavior';
  END IF;
END
$postflight$;

COMMIT;


