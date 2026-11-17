-- ==============================================================================
-- SUÍTE DE TESTES FUNCIONAIS REAIS EM POSTGRESQL 17 (RC1.25)
-- Arquivo: scripts/rc1-25-postgres17-validation.sql
-- ==============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- Criar contexto de testes isolado
CREATE SCHEMA IF NOT EXISTS rc1_25_test;

-- 1. Setup de identidades e instâncias de teste
DO $$
DECLARE
  v_promotor_uid UUID := gen_random_uuid();
  v_other_promotor_uid UUID := gen_random_uuid();
  v_admin_uid UUID := gen_random_uuid();
  v_ind_code TEXT := 'TEST_IND_RC25';
  v_ind_other_code TEXT := 'TEST_IND_OTHER_RC25';
  v_store_code TEXT := 'TEST_STORE_RC25';
  v_store_code_2 TEXT := 'TEST_STORE_RC25_2';
  v_store_code_3 TEXT := 'TEST_STORE_RC25_3';
  v_store_code_4 TEXT := 'TEST_STORE_RC25_4';
  v_sku_active TEXT := 'SKU_ACTIVE_001';
  v_sku_active_2 TEXT := 'SKU_ACTIVE_002';
  v_visit_open UUID := gen_random_uuid();
  v_visit_no_catalog UUID := gen_random_uuid();
  v_visit_completed UUID := gen_random_uuid();
  v_visit_other UUID := gen_random_uuid();
  v_visit_recovery UUID := gen_random_uuid();
  v_visit_cancel UUID := gen_random_uuid();
  v_token UUID;
  v_res JSONB;
  v_err_caught BOOLEAN := false;
  v_affected_rows INTEGER := 0;
BEGIN
  RAISE NOTICE '=== INICIANDO TESTES FUNCIONAIS REAIS EM POSTGRESQL 17 ===';

  -- Inserir dados base
  INSERT INTO auth.users (id) VALUES (v_promotor_uid), (v_other_promotor_uid), (v_admin_uid);
  INSERT INTO public.promotores (matricula) VALUES ('PROM_RC25_1'), ('PROM_RC25_2');
  INSERT INTO public.profiles (id, role, status, promotor_matricula) VALUES 
    (v_promotor_uid, 'promotor', 'ativo', 'PROM_RC25_1'),
    (v_other_promotor_uid, 'promotor', 'ativo', 'PROM_RC25_2'),
    (v_admin_uid, 'admin', 'ativo', NULL);

  INSERT INTO public.industrias (codigo) VALUES (v_ind_code);
  INSERT INTO public.industrias (codigo) VALUES (v_ind_other_code);
  INSERT INTO public.lojas (codigo) VALUES (v_store_code), (v_store_code_2), (v_store_code_3), (v_store_code_4);

  -- Inserir SKUs no catálogo da indústria
  INSERT INTO public.industria_skus (industria_codigo, codigo_sku, nome_produto, status, origem_cadastro)
  VALUES (v_ind_code, v_sku_active, 'Produto Teste Ativo 1', 'ativo', 'admin_manual'),
         (v_ind_code, v_sku_active_2, 'Produto Teste Ativo 2', 'ativo', 'admin_manual');

  -- Inserir visitas de teste (cada visita do promotor em loja/indústria distinta para unicidade operacional)
  INSERT INTO public.visits (id, promotor_matricula, loja_codigo, industria_codigo, data_visita, started_at, status, observacao_geral)
  VALUES (v_visit_open, 'PROM_RC25_1', v_store_code, v_ind_code, CURRENT_DATE, clock_timestamp(), 'em_andamento', 'Visita Aberta');

  INSERT INTO public.visits (id, promotor_matricula, loja_codigo, industria_codigo, data_visita, started_at, status)
  VALUES (v_visit_no_catalog, 'PROM_RC25_1', v_store_code, v_ind_other_code, CURRENT_DATE, clock_timestamp(), 'em_andamento');

  INSERT INTO public.visits (id, promotor_matricula, loja_codigo, industria_codigo, data_visita, started_at, completed_at, status, observacao_geral)
  VALUES (v_visit_completed, 'PROM_RC25_1', v_store_code_2, v_ind_code, CURRENT_DATE, clock_timestamp() - interval '2 hours', clock_timestamp() - interval '1 hour', 'concluida', 'Visita Concluida Original');

  INSERT INTO public.visits (id, promotor_matricula, loja_codigo, industria_codigo, data_visita, started_at, completed_at, status, observacao_geral)
  VALUES (v_visit_other, 'PROM_RC25_2', v_store_code, v_ind_code, CURRENT_DATE, clock_timestamp() - interval '2 hours', clock_timestamp() - interval '1 hour', 'concluida', 'Visita Outro Promotor');

  INSERT INTO public.visits (id, promotor_matricula, loja_codigo, industria_codigo, data_visita, scheduled_date, status)
  VALUES (v_visit_recovery, 'PROM_RC25_1', v_store_code_3, v_ind_code, CURRENT_DATE, CURRENT_DATE, 'pendente');

  INSERT INTO public.visits (id, promotor_matricula, loja_codigo, industria_codigo, data_visita, started_at, status)
  VALUES (v_visit_cancel, 'PROM_RC25_1', v_store_code_4, v_ind_code, CURRENT_DATE, clock_timestamp(), 'em_andamento');

  -- Simular autenticação como promotor titular (PROM_RC25_1)
  EXECUTE format('SET LOCAL "request.jwt.claim.sub" = %L', v_promotor_uid::text);
  EXECUTE format('SET LOCAL "request.jwt.claim.role" = %L', 'authenticated');
  SET LOCAL ROLE authenticated;

  -- --------------------------------------------------------------------------
  -- TESTE 1: Bloqueio de alteração direta sem RPC
  -- --------------------------------------------------------------------------
  v_err_caught := false;
  BEGIN
    UPDATE public.visits
    SET observacao_geral = 'Tentativa de Hack Direto'
    WHERE id = v_visit_completed;
  EXCEPTION WHEN OTHERS THEN
    v_err_caught := true;
    RAISE NOTICE 'TESTE 1 OK: Alteração direta sem RPC bloqueada: %', SQLERRM;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'FALHA NO TESTE 1: Alteração direta em visita concluída permitida indevidamente!';
  END IF;

  -- --------------------------------------------------------------------------
  -- TESTE 2: Edição autorizada via RPC save_completed_visit_edit
  -- --------------------------------------------------------------------------
  v_res := public.save_completed_visit_edit(
    v_visit_completed,
    'Observacao Atualizada com Sucesso',
    '[{"item_key":"ponto_extra","item_label":"Ponto Extra","valor_texto":"Sim","observacao":"Negociado"}]'::jsonb,
    'Justificativa valida de teste com mais de 5 caracteres',
    '{}'::jsonb
  );

  IF (v_res ->> 'success')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'FALHA NO TESTE 2: RPC save_completed_visit_edit falhou!';
  END IF;

  IF (SELECT observacao_geral FROM public.visits WHERE id = v_visit_completed) <> 'Observacao Atualizada com Sucesso' THEN
    RAISE EXCEPTION 'FALHA NO TESTE 2: Valor de observacao_geral não atualizado!';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.visit_edits_audit_log
    WHERE visit_id = v_visit_completed
      AND token_consumed_at IS NOT NULL
      AND altered_by_user_id = v_promotor_uid
  ) THEN
    RAISE EXCEPTION 'FALHA NO TESTE 2: Registro de auditoria ou consumo de token não gravado!';
  END IF;
  RAISE NOTICE 'TESTE 2 OK: Edição autorizada via RPC e auditoria consumida com sucesso.';

  -- --------------------------------------------------------------------------
  -- TESTE 3: Tentativa de reutilizar token já consumido
  -- --------------------------------------------------------------------------
  SELECT authorization_token INTO v_token
  FROM public.visit_edits_audit_log
  WHERE visit_id = v_visit_completed
  ORDER BY created_at DESC LIMIT 1;

  v_err_caught := false;
  BEGIN
    PERFORM pg_catalog.set_config('mk9.current_audit_token', v_token::text, true);
    UPDATE public.visits
    SET observacao_geral = 'Tentativa de Reutilizacao de Token'
    WHERE id = v_visit_completed;
  EXCEPTION WHEN OTHERS THEN
    v_err_caught := true;
    RAISE NOTICE 'TESTE 3 OK: Reutilização de token bloqueada: %', SQLERRM;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'FALHA NO TESTE 3: Reutilização de token de autorização aceita indevidamente!';
  END IF;

  -- --------------------------------------------------------------------------
  -- TESTE 4: Edição de visita de outro promotor
  -- --------------------------------------------------------------------------
  v_err_caught := false;
  BEGIN
    PERFORM public.save_completed_visit_edit(
      v_visit_other,
      'Tentando editar visita alheia',
      '[]'::jsonb,
      'Justificativa para visita de terceiro',
      '{}'::jsonb
    );
  EXCEPTION WHEN OTHERS THEN
    v_err_caught := true;
    RAISE NOTICE 'TESTE 4 OK: Edição de visita alheia bloqueada: %', SQLERRM;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'FALHA NO TESTE 4: Promotor conseguiu editar visita de outro promotor!';
  END IF;

  -- --------------------------------------------------------------------------
  -- TESTE 5: Tentativa de alterar campos protegidos (check-in, checkout, loja)
  -- --------------------------------------------------------------------------
  v_err_caught := false;
  BEGIN
    UPDATE public.visits
    SET started_at = clock_timestamp()
    WHERE id = v_visit_completed;
  EXCEPTION WHEN OTHERS THEN
    v_err_caught := true;
    RAISE NOTICE 'TESTE 5 OK: Alteração de check-in bloqueada: %', SQLERRM;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'FALHA NO TESTE 5: Check-in pôde ser alterado!';
  END IF;

  -- --------------------------------------------------------------------------
  -- TESTE 6: Tentativa de finalizar visita aberta com SKUs ativos pendentes
  -- --------------------------------------------------------------------------
  v_err_caught := false;
  BEGIN
    UPDATE public.visits
    SET status = 'concluida',
        completed_at = clock_timestamp()
    WHERE id = v_visit_open;
  EXCEPTION WHEN OTHERS THEN
    v_err_caught := true;
    RAISE NOTICE 'TESTE 6 OK: Finalização sem conferir SKUs ativos bloqueada: %', SQLERRM;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'FALHA NO TESTE 6: Visita com SKUs pendentes foi concluída sem conferência!';
  END IF;

  -- --------------------------------------------------------------------------
  -- TESTE 7: Conferência obrigatória de SKUs e checkout bem-sucedido
  -- --------------------------------------------------------------------------
  INSERT INTO public.visit_sku_stock_checks (
    visit_id, industria_codigo, loja_codigo, codigo_sku, data_conferencia,
    quantidade_venda, quantidade_deposito, quantidade_reposicao, status_conferencia, conferido_por_matricula
  ) VALUES 
    (v_visit_open, v_ind_code, v_store_code, v_sku_active, CURRENT_DATE, 10, 20, 5, 'conferido', 'PROM_RC25_1'),
    (v_visit_open, v_ind_code, v_store_code, v_sku_active_2, CURRENT_DATE, 0, 0, 0, 'justificado', 'PROM_RC25_1');

  -- Atualizar a justificativa do segundo SKU
  UPDATE public.visit_sku_stock_checks
  SET justificativa = 'nao_comercializado'
  WHERE visit_id = v_visit_open AND codigo_sku = v_sku_active_2;

  -- Agora o checkout da visita deve passar sem exceções
  UPDATE public.visits
  SET status = 'concluida',
      completed_at = clock_timestamp()
  WHERE id = v_visit_open;

  IF (SELECT status FROM public.visits WHERE id = v_visit_open) <> 'concluida' THEN
    RAISE EXCEPTION 'FALHA NO TESTE 7: Visita com todos SKUs conferidos não pôde ser concluída!';
  END IF;
  RAISE NOTICE 'TESTE 7 OK: Todos os SKUs conferidos e checkout efetuado com sucesso.';

  UPDATE public.visits
  SET status = 'concluida', completed_at = clock_timestamp()
  WHERE id = v_visit_no_catalog;
  IF (SELECT status FROM public.visits WHERE id = v_visit_no_catalog) <> 'concluida' THEN
    RAISE EXCEPTION 'Checkout without a catalog was blocked';
  END IF;
  RAISE NOTICE 'TESTE 8 OK: Checkout sem catalogo continua permitido.';

  -- --------------------------------------------------------------------------
  -- TESTE 9: Tentativa de adulterar conferência de SKU após visita concluída
  -- --------------------------------------------------------------------------
  v_err_caught := false;
  BEGIN
    UPDATE public.visit_sku_stock_checks
    SET quantidade_venda = 999
    WHERE visit_id = v_visit_open AND codigo_sku = v_sku_active;
    GET DIAGNOSTICS v_affected_rows = ROW_COUNT;
    IF v_affected_rows = 0 THEN v_err_caught := true; END IF;
  EXCEPTION WHEN OTHERS THEN
    v_err_caught := true;
    RAISE NOTICE 'TESTE 9 OK: Adulteração de estoque pós-checkout bloqueada: %', SQLERRM;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'FALHA NO TESTE 9: Estoque de visita concluída pôde ser alterado pelo promotor!';
  END IF;

  -- --------------------------------------------------------------------------
  RAISE NOTICE 'TESTE 9 OK: RLS/trigger bloqueou estoque apos checkout.';

  -- TESTE 10: Falha de auditoria com rollback na RPC
  -- --------------------------------------------------------------------------
  v_err_caught := false;
  BEGIN
    PERFORM public.save_completed_visit_edit(
      v_visit_completed,
      'Nova observacao que deve abortar',
      '[]'::jsonb,
      'curt', -- Menos de 5 caracteres: viola validação
      '{}'::jsonb
    );
  EXCEPTION WHEN OTHERS THEN
    v_err_caught := true;
    RAISE NOTICE 'TESTE 10 OK: Justificativa curta abortou com rollback: %', SQLERRM;
  END;
  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'FALHA NO TESTE 10: Justificativa inválida não abortou a RPC!';
  END IF;

  IF (SELECT observacao_geral FROM public.visits WHERE id = v_visit_completed) = 'Nova observacao que deve abortar' THEN
    RAISE EXCEPTION 'FALHA NO TESTE 10: Rollback não desfez alteração em visits!';
  END IF;

  RAISE NOTICE 'TESTE 10 OK: RPC preservou atomicidade no erro.';

  -- TESTE 11: Escritas diretas e sugestões fora da indústria ativa são bloqueadas.
  v_err_caught := false;
  BEGIN
    INSERT INTO public.visit_edits_audit_log (visit_id, altered_by_user_id, field_name)
    VALUES (v_visit_completed, v_promotor_uid, 'fake_edit');
  EXCEPTION WHEN insufficient_privilege THEN
    v_err_caught := true;
  END;
  IF NOT v_err_caught THEN RAISE EXCEPTION 'Direct audit insertion was not blocked'; END IF;
  RAISE NOTICE 'TESTE 11 OK: ACL bloqueou escrita direta na auditoria.';

  v_err_caught := false;
  BEGIN
    INSERT INTO public.industria_skus (
      industria_codigo, codigo_sku, nome_produto, status, origem_cadastro, sugerido_por_matricula
    ) VALUES (v_ind_other_code, 'SKU_CROSS_INDUSTRY', 'Invalid suggestion', 'pendente', 'promotor_sugestao', 'PROM_RC25_1');
  EXCEPTION WHEN insufficient_privilege THEN
    v_err_caught := true;
  END;
  IF NOT v_err_caught THEN RAISE EXCEPTION 'Cross-industry SKU suggestion was not blocked by RLS'; END IF;
  RAISE NOTICE 'TESTE 12 OK: RLS bloqueou sugestao para industria sem visita ativa.';

  SET LOCAL ROLE postgres;
  INSERT INTO attendance_private.scheduled_recovery_authorizations (
    visit_id, promotor_matricula, data_visita, scheduled_date
  ) VALUES (v_visit_recovery, 'PROM_RC25_1', CURRENT_DATE, CURRENT_DATE);

  UPDATE public.visits
  SET status = 'em_andamento', started_at = clock_timestamp()
  WHERE id = v_visit_recovery;

  IF (SELECT status FROM public.visits WHERE id = v_visit_recovery) <> 'em_andamento'
     OR EXISTS (SELECT 1 FROM attendance_private.scheduled_recovery_authorizations WHERE visit_id = v_visit_recovery) THEN
    RAISE EXCEPTION 'FALHA NO TESTE 13: Recuperação M37 não autorizada ou autorização não consumida';
  END IF;
  RAISE NOTICE 'TESTE 13 OK: Recuperação M37 e consumo da autorização preservados.';

  -- TESTE 14: Cancelamento M38 continua exigindo autorização de ciclo de vida.
  SET LOCAL ROLE postgres;
  INSERT INTO attendance_private.visit_lifecycle_authorizations (
    visit_id, promotor_matricula, action, actor_type, actor_id, reason
  ) VALUES (
    v_visit_cancel, 'PROM_RC25_1', 'promoter_cancelled', 'promoter', v_promotor_uid,
    'teste de cancelamento autorizado'
  );

  UPDATE public.visits
  SET status = 'nao_realizada',
      motivo_nao_realizada = 'Cancelada pelo promotor: teste de cancelamento autorizado'
  WHERE id = v_visit_cancel;

  IF (SELECT status FROM public.visits WHERE id = v_visit_cancel) <> 'nao_realizada'
     OR EXISTS (SELECT 1 FROM attendance_private.visit_lifecycle_authorizations WHERE visit_id = v_visit_cancel) THEN
    RAISE EXCEPTION 'FALHA NO TESTE 14: Cancelamento M38 não autorizado ou autorização não consumida';
  END IF;
  RAISE NOTICE 'TESTE 14 OK: Cancelamento M38 e consumo da autorização preservados.';

  RAISE NOTICE '=== TODOS OS 14 TESTES FUNCIONAIS REAIS EM POSTGRESQL 17 PASSARAM COM SUCESSO! ===';
END $$;

ROLLBACK;
