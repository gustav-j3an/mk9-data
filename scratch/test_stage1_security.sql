-- ==============================================================================
-- TESTE RIGOROSO DE SEGURANÇA E TRANSAÇÃO - ETAPA 1 (MODO DE IMPLANTAÇÃO)
-- ==============================================================================

DO $$
DECLARE
  v_admin_id UUID := 'd6c3bc2c-3286-4dd3-ade3-e98fd008919e'; -- gustavj3anmk9@gmail.com (admin)
  v_promo_id UUID := 'f0c3eb38-9daa-4e38-bef7-7bdbd85faf54'; -- promotormk9@gmail.com (promotor)
  v_res JSONB;
  v_initial_audit_count INT;
  v_audit_count INT;
  v_current_mode TEXT;
  v_current_date TEXT;
  v_error_caught BOOLEAN;
BEGIN
  RAISE NOTICE '=======================================================';
  RAISE NOTICE 'INICIANDO SUÍTE DE TESTES DE SEGURANÇA E TRANSAÇÃO';
  RAISE NOTICE '=======================================================';

  SELECT COUNT(*) INTO v_initial_audit_count FROM public.system_settings_audit_log;

  -- ----------------------------------------------------------------------------
  -- TESTE 1: USUÁRIO NÃO AUTENTICADO (ANÔNIMO)
  -- ----------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', '', true);
  v_error_caught := FALSE;
  BEGIN
    PERFORM public.set_operation_mode('OPERACAO_OFICIAL', '2026-10-15'::date, 'Tentativa anônima');
  EXCEPTION WHEN OTHERS THEN
    v_error_caught := TRUE;
    RAISE NOTICE '[OK] Teste 1 passou: Usuário anônimo bloqueado com sucesso (Erro: %)', SQLERRM;
  END;
  IF NOT v_error_caught THEN
    RAISE EXCEPTION 'FALHA NO TESTE 1: Usuário anônimo conseguiu executar a RPC!';
  END IF;

  -- ----------------------------------------------------------------------------
  -- TESTE 2: PROMOTOR TENTANDO ALTERAR CONFIGURAÇÃO
  -- ----------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_promo_id::text, true);
  v_error_caught := FALSE;
  BEGIN
    PERFORM public.set_operation_mode('OPERACAO_OFICIAL', '2026-10-15'::date, 'Tentativa promotor');
  EXCEPTION WHEN OTHERS THEN
    v_error_caught := TRUE;
    RAISE NOTICE '[OK] Teste 2 passou: Promotor bloqueado com sucesso (Erro: %)', SQLERRM;
  END;
  IF NOT v_error_caught THEN
    RAISE EXCEPTION 'FALHA NO TESTE 2: Promotor conseguiu executar a RPC!';
  END IF;

  -- ----------------------------------------------------------------------------
  -- TESTE 3: ADMIN TENTANDO MODO INVÁLIDO
  -- ----------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);
  v_error_caught := FALSE;
  BEGIN
    PERFORM public.set_operation_mode('MODO_INEXISTENTE', '2026-10-15'::date, 'Justificativa de teste');
  EXCEPTION WHEN OTHERS THEN
    v_error_caught := TRUE;
    RAISE NOTICE '[OK] Teste 3 passou: Modo inválido rejeitado com sucesso (Erro: %)', SQLERRM;
  END;
  IF NOT v_error_caught THEN
    RAISE EXCEPTION 'FALHA NO TESTE 3: Modo inválido foi aceito!';
  END IF;

  -- ----------------------------------------------------------------------------
  -- TESTE 4: ADMIN TENTANDO ALTERAR SEM JUSTIFICATIVA (OU JUSTIFICATIVA CURTA)
  -- ----------------------------------------------------------------------------
  v_error_caught := FALSE;
  BEGIN
    PERFORM public.set_operation_mode('OPERACAO_OFICIAL', '2026-10-15'::date, 'abc');
  EXCEPTION WHEN OTHERS THEN
    v_error_caught := TRUE;
    RAISE NOTICE '[OK] Teste 4 passou: Justificativa curta/ausente rejeitada (Erro: %)', SQLERRM;
  END;
  IF NOT v_error_caught THEN
    RAISE EXCEPTION 'FALHA NO TESTE 4: Justificativa ausente foi aceita!';
  END IF;

  -- ----------------------------------------------------------------------------
  -- TESTE 5: ADMIN TENTANDO ATIVAR OPERACAO_OFICIAL SEM DATA DE INÍCIO
  -- ----------------------------------------------------------------------------
  v_error_caught := FALSE;
  BEGIN
    PERFORM public.set_operation_mode('OPERACAO_OFICIAL', NULL, 'Tentando ativar oficial sem data');
  EXCEPTION WHEN OTHERS THEN
    v_error_caught := TRUE;
    RAISE NOTICE '[OK] Teste 5 passou: Ativação oficial sem data rejeitada (Erro: %)', SQLERRM;
  END;
  IF NOT v_error_caught THEN
    RAISE EXCEPTION 'FALHA NO TESTE 5: OPERACAO_OFICIAL ativada sem data!';
  END IF;

  -- ----------------------------------------------------------------------------
  -- TESTE 6: ADMIN ATIVANDO OPERACAO_OFICIAL COM DADOS VÁLIDOS (SUCESSO ATÔMICO)
  -- ----------------------------------------------------------------------------
  v_res := public.set_operation_mode('OPERACAO_OFICIAL', '2026-10-15'::date, 'Início oficial autorizado pela diretoria MK9');
  RAISE NOTICE '[OK] Teste 6 passou: RPC retornou: %', v_res;

  -- Verificar integridade pós-ativação
  SELECT trim(both '"' from value::text) INTO v_current_mode FROM public.system_settings WHERE key = 'operation_mode';
  SELECT trim(both '"' from value::text) INTO v_current_date FROM public.system_settings WHERE key = 'official_start_date';
  IF v_current_mode <> 'OPERACAO_OFICIAL' OR v_current_date <> '2026-10-15' THEN
    RAISE EXCEPTION 'FALHA NO TESTE 6: system_settings inconsistente! mode=%, date=%', v_current_mode, v_current_date;
  END IF;

  -- ----------------------------------------------------------------------------
  -- TESTE 7: ADMIN RETORNANDO AO MODO IMPLANTACAO COM JUSTIFICATIVA
  -- ----------------------------------------------------------------------------
  v_res := public.set_operation_mode('IMPLANTACAO', NULL, 'Retorno temporário para homologação de novos cadastros');
  RAISE NOTICE '[OK] Teste 7 passou: Retorno para IMPLANTACAO executado: %', v_res;

  SELECT trim(both '"' from value::text) INTO v_current_mode FROM public.system_settings WHERE key = 'operation_mode';
  SELECT trim(both '"' from value::text) INTO v_current_date FROM public.system_settings WHERE key = 'official_start_date';
  IF v_current_mode <> 'IMPLANTACAO' OR v_current_date <> 'null' THEN
    RAISE EXCEPTION 'FALHA NO TESTE 7: system_settings não retornou a IMPLANTACAO! mode=%, date=%', v_current_mode, v_current_date;
  END IF;

  -- ----------------------------------------------------------------------------
  -- TESTE 8: VERIFICAR AUDITORIA COMPLETA
  -- ----------------------------------------------------------------------------
  SELECT COUNT(*) INTO v_audit_count FROM public.system_settings_audit_log;
  IF v_audit_count <> v_initial_audit_count + 2 THEN
    RAISE EXCEPTION 'FALHA NO TESTE 8: Log de auditoria incompleto! Esperado: %, Encontrado: %', v_initial_audit_count + 2, v_audit_count;
  END IF;
  RAISE NOTICE '[OK] Teste 8 passou: Trilha de auditoria registrou exatamente os 2 eventos com sucesso.';

  -- ----------------------------------------------------------------------------
  -- TESTE 9: SIMULAR FALHA NO MEIO DA TRANSAÇÃO E CONFIRMAR ROLLBACK
  -- ----------------------------------------------------------------------------
  BEGIN
    -- Forçar erro tentando atualizar para oficial sem data
    PERFORM public.set_operation_mode('OPERACAO_OFICIAL', NULL, 'Essa transação deve falhar e rolar tudo de volta');
  EXCEPTION WHEN OTHERS THEN
    -- Erro esperado
  END;

  -- Confirmar que o modo permanece IMPLANTACAO e a auditoria não teve novo registro órfão
  SELECT trim(both '"' from value::text) INTO v_current_mode FROM public.system_settings WHERE key = 'operation_mode';
  SELECT COUNT(*) INTO v_audit_count FROM public.system_settings_audit_log;
  IF v_current_mode <> 'IMPLANTACAO' OR v_audit_count <> v_initial_audit_count + 2 THEN
    RAISE EXCEPTION 'FALHA NO TESTE 9: Rollback falhou! mode=%, audit_count=%', v_current_mode, v_audit_count;
  END IF;
  RAISE NOTICE '[OK] Teste 9 passou: Rollback transacional comprovado sem estados inconsistentes.';

  RAISE NOTICE '=======================================================';
  RAISE NOTICE 'TODOS OS 9 TESTES DE SEGURANÇA FORAM APROVADOS COM SUCESSO!';
  RAISE NOTICE '=======================================================';
END $$;
