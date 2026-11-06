-- ==============================================================================
-- MISSÃO 30 / 34 / 36A — MK9 DATE | SINCRONIZAÇÃO DE INDÚSTRIAS INATIVAS COM ROTAS FIXAS
-- ==============================================================================
-- Migration de referência para revisão e homologação.
-- NÃO APLICAR AUTOMATICAMENTE SEM AUTORIZAÇÃO EXPRESSA.
--
-- Objetivos:
-- 1. Fornecer uma RPC atômica segura ('inactivate_industry_and_suspend_routes')
--    que inativa a indústria e suspende (encerra logicamente com motivo rastreável)
--    todas as rotas ativas vinculadas, em uma única transação no banco de dados,
--    retornando a contagem real de rotas suspensas sem operações redundantes.
-- 2. Fornecer uma RPC para reativação explícita e controlada de rotas que foram
--    suspensas exclusivamente pela inativação da indústria ('reactivate_industry_routes').
-- 3. Adicionar coluna opcional 'motivo_encerramento' na tabela 'public.rotas' para
--    distinção estruturada e auditável de rotas encerradas manualmente vs por inativação de indústria.
-- 4. Trigger automático 'trg_industrias_inactivation_sync_routes' para suspender rotas
--    caso a indústria seja inativada diretamente (com verificação de pré-existência para evitar redundância).
-- 5. Trigger de proteção transacional 'trg_rotas_prevent_inactive_industry' para
--    bloquear criação (INSERT) e reativação (UPDATE encerrada_em) de rotas vinculadas a indústrias inativas.
-- ==============================================================================

-- 1. Coluna motivo_encerramento (opcional / evolutiva)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'rotas' 
      AND column_name = 'motivo_encerramento'
  ) THEN
    ALTER TABLE public.rotas ADD COLUMN motivo_encerramento TEXT;
  END IF;
END $$;

-- 2. Função atômica para inativação de indústria com suspensão de rotas ativas
CREATE OR REPLACE FUNCTION public.inactivate_industry_and_suspend_routes(
  p_industria_id UUID,
  p_motivo TEXT DEFAULT 'Inativação da indústria'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_industria RECORD;
  v_closed_at TIMESTAMPTZ := NOW();
  v_routes_affected INT := 0;
  v_has_motivo_col BOOLEAN := FALSE;
BEGIN
  -- Verificar permissão de gestão
  IF NOT (public.is_admin_or_gestor()) THEN
    RAISE EXCEPTION 'Acesso não autorizado. Apenas administradores e gestores podem suspender rotas por indústria.'
      USING ERRCODE = '42501';
  END IF;

  -- Localizar e travar a indústria para garantir isolamento e atomicidade
  SELECT id, codigo, nome, status INTO v_industria
  FROM public.industrias
  WHERE id = p_industria_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Indústria não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  -- Verificar existência da coluna motivo_encerramento
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'rotas' AND column_name = 'motivo_encerramento'
  ) INTO v_has_motivo_col;

  -- 1. Suspender rotas atualmente ativas vinculadas à indústria PRIMEIRO
  -- (Garante captura real da contagem de rotas suspensas sem que o trigger pós-update interfira na contagem)
  IF v_has_motivo_col THEN
    EXECUTE '
      UPDATE public.rotas
      SET encerrada_em = $1,
          motivo_encerramento = $2,
          observacao = CASE 
            WHEN observacao IS NULL OR trim(observacao) = '''' THEN ''[SUSPENSO: INATIVAÇÃO DA INDÚSTRIA] '' || $2
            WHEN observacao ILIKE ''%[SUSPENSO: INATIVAÇÃO DA INDÚSTRIA]%'' THEN observacao
            ELSE observacao || '' | [SUSPENSO: INATIVAÇÃO DA INDÚSTRIA] '' || $2
          END,
          updated_at = $1
      WHERE industria_codigo = $3
        AND encerrada_em IS NULL
    ' USING v_closed_at, p_motivo, v_industria.codigo;
  ELSE
    UPDATE public.rotas
    SET encerrada_em = v_closed_at,
        observacao = CASE 
          WHEN observacao IS NULL OR trim(observacao) = '' THEN '[SUSPENSO: INATIVAÇÃO DA INDÚSTRIA] ' || p_motivo
          WHEN observacao ILIKE '%[SUSPENSO: INATIVAÇÃO DA INDÚSTRIA]%' THEN observacao
          ELSE observacao || ' | [SUSPENSO: INATIVAÇÃO DA INDÚSTRIA] ' || p_motivo
        END,
        updated_at = v_closed_at
    WHERE industria_codigo = v_industria.codigo
      AND encerrada_em IS NULL;
  END IF;

  GET DIAGNOSTICS v_routes_affected = ROW_COUNT;

  -- 2. Atualizar status da indústria para inativo
  UPDATE public.industrias
  SET status = 'inativo',
      updated_at = v_closed_at
  WHERE id = p_industria_id;

  RETURN jsonb_build_object(
    'success', true,
    'industria_id', v_industria.id,
    'industria_codigo', v_industria.codigo,
    'industria_nome', v_industria.nome,
    'rotas_suspensas', v_routes_affected,
    'timestamp', v_closed_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.inactivate_industry_and_suspend_routes(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inactivate_industry_and_suspend_routes(UUID, TEXT) TO authenticated;

-- 3. Função para reativação explícita e controlada de rotas suspensas pela indústria
CREATE OR REPLACE FUNCTION public.reactivate_industry_routes(
  p_industria_id UUID,
  p_route_ids UUID[] DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_industria RECORD;
  v_routes_reactivated INT := 0;
  v_has_motivo_col BOOLEAN := FALSE;
BEGIN
  IF NOT (public.is_admin_or_gestor()) THEN
    RAISE EXCEPTION 'Acesso não autorizado.' USING ERRCODE = '42501';
  END IF;

  SELECT id, codigo, nome, status INTO v_industria
  FROM public.industrias
  WHERE id = p_industria_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Indústria não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF v_industria.status <> 'ativo' THEN
    RAISE EXCEPTION 'Não é permitido reativar rotas de uma indústria inativa. Reative a indústria primeiro.' USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'rotas' AND column_name = 'motivo_encerramento'
  ) INTO v_has_motivo_col;

  -- Reativa apenas rotas da indústria que foram suspensas por motivo de inativação da indústria
  IF p_route_ids IS NOT NULL AND array_length(p_route_ids, 1) > 0 THEN
    IF v_has_motivo_col THEN
      EXECUTE '
        UPDATE public.rotas
        SET encerrada_em = NULL,
            motivo_encerramento = NULL,
            updated_at = NOW()
        WHERE industria_codigo = $1
          AND encerrada_em IS NOT NULL
          AND id = ANY($2)
          AND (
            motivo_encerramento ILIKE ''%inativação da indústria%''
            OR observacao ILIKE ''%[SUSPENSO: INATIVAÇÃO DA INDÚSTRIA]%''
          )
      ' USING v_industria.codigo, p_route_ids;
    ELSE
      UPDATE public.rotas
      SET encerrada_em = NULL,
          updated_at = NOW()
      WHERE industria_codigo = v_industria.codigo
        AND encerrada_em IS NOT NULL
        AND id = ANY(p_route_ids)
        AND observacao ILIKE '%[SUSPENSO: INATIVAÇÃO DA INDÚSTRIA]%';
    END IF;
  ELSE
    IF v_has_motivo_col THEN
      EXECUTE '
        UPDATE public.rotas
        SET encerrada_em = NULL,
            motivo_encerramento = NULL,
            updated_at = NOW()
        WHERE industria_codigo = $1
          AND encerrada_em IS NOT NULL
          AND (
            motivo_encerramento ILIKE ''%inativação da indústria%''
            OR observacao ILIKE ''%[SUSPENSO: INATIVAÇÃO DA INDÚSTRIA]%''
          )
      ' USING v_industria.codigo;
    ELSE
      UPDATE public.rotas
      SET encerrada_em = NULL,
          updated_at = NOW()
      WHERE industria_codigo = v_industria.codigo
        AND encerrada_em IS NOT NULL
        AND observacao ILIKE '%[SUSPENSO: INATIVAÇÃO DA INDÚSTRIA]%';
    END IF;
  END IF;

  GET DIAGNOSTICS v_routes_reactivated = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'industria_codigo', v_industria.codigo,
    'rotas_reativadas', v_routes_reactivated
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reactivate_industry_routes(UUID, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reactivate_industry_routes(UUID, UUID[]) TO authenticated;

-- 4. Trigger de sincronização automática ao inativar indústria diretamente (Missão 34 / 36A)
-- Impede contorno por UPDATE direto, importação ou mutações em lote:
-- Quando qualquer indústria tiver seu status atualizado para 'inativo',
-- todas as suas rotas ativas são suspensas de forma atômica no PostgreSQL.
-- Inclui verificação prévia de rotas ativas para evitar execuções redundantes.
CREATE OR REPLACE FUNCTION public.trg_auto_suspend_routes_on_industry_inactivation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_closed_at TIMESTAMPTZ := NOW();
  v_has_motivo_col BOOLEAN := FALSE;
  v_active_routes_count INT := 0;
BEGIN
  -- Se o status foi alterado para inativo (ou permanece inativo em atualização explícita)
  IF (NEW.status = 'inativo' AND (OLD.status IS DISTINCT FROM 'inativo' OR OLD.status = 'inativo')) THEN
    -- Evitar operação redundante caso as rotas ativas já tenham sido suspensas (ex: via RPC)
    SELECT count(*) INTO v_active_routes_count
    FROM public.rotas
    WHERE industria_codigo = NEW.codigo
      AND encerrada_em IS NULL;

    IF v_active_routes_count > 0 THEN
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'rotas' AND column_name = 'motivo_encerramento'
      ) INTO v_has_motivo_col;

      IF v_has_motivo_col THEN
        EXECUTE '
          UPDATE public.rotas
          SET encerrada_em = $1,
              motivo_encerramento = ''Inativação da indústria'',
              observacao = CASE 
                WHEN observacao IS NULL OR trim(observacao) = '''' THEN ''[SUSPENSO: INATIVAÇÃO DA INDÚSTRIA] Inativação da indústria''
                WHEN observacao ILIKE ''%[SUSPENSO: INATIVAÇÃO DA INDÚSTRIA]%'' THEN observacao
                ELSE observacao || '' | [SUSPENSO: INATIVAÇÃO DA INDÚSTRIA] Inativação da indústria''
              END,
              updated_at = $1
          WHERE industria_codigo = $2
            AND encerrada_em IS NULL
        ' USING v_closed_at, NEW.codigo;
      ELSE
        UPDATE public.rotas
        SET encerrada_em = v_closed_at,
            observacao = CASE 
              WHEN observacao IS NULL OR trim(observacao) = '' THEN '[SUSPENSO: INATIVAÇÃO DA INDÚSTRIA] Inativação da indústria'
              WHEN observacao ILIKE '%[SUSPENSO: INATIVAÇÃO DA INDÚSTRIA]%' THEN observacao
              ELSE observacao || ' | [SUSPENSO: INATIVAÇÃO DA INDÚSTRIA] Inativação da indústria'
            END,
            updated_at = v_closed_at
        WHERE industria_codigo = NEW.codigo
          AND encerrada_em IS NULL;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_industrias_inactivation_sync_routes ON public.industrias;
CREATE TRIGGER trg_industrias_inactivation_sync_routes
AFTER UPDATE OF status ON public.industrias
FOR EACH ROW
EXECUTE FUNCTION public.trg_auto_suspend_routes_on_industry_inactivation();

REVOKE ALL ON FUNCTION public.trg_auto_suspend_routes_on_industry_inactivation() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trg_auto_suspend_routes_on_industry_inactivation() TO authenticated;

-- 5. Trigger de proteção transacional contra criação e reativação de rotas para indústrias inativas (Missão 36A)
-- Garante proteção estrita em nível de banco de dados contra:
-- a) INSERT de rota ativa (encerrada_em IS NULL) vinculada a indústria inativa.
-- b) UPDATE reativando rota (encerrada_em tornando-se NULL) cuja indústria esteja inativa.
-- c) UPDATE alterando o industria_codigo de rota ativa para indústria inativa.
CREATE OR REPLACE FUNCTION public.trg_prevent_active_route_for_inactive_industry()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ind_status TEXT;
BEGIN
  -- A verificação aplica-se apenas quando a rota for ou se tornar ativa
  IF NEW.encerrada_em IS NULL THEN
    SELECT status INTO v_ind_status
    FROM public.industrias
    WHERE codigo = NEW.industria_codigo;

    IF FOUND AND v_ind_status = 'inativo' THEN
      RAISE EXCEPTION 'Operação bloqueada: não é permitido criar ou reativar rotas vinculadas a uma indústria inativa (indústria: %).', NEW.industria_codigo
        USING ERRCODE = '22023';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rotas_prevent_inactive_industry ON public.rotas;
CREATE TRIGGER trg_rotas_prevent_inactive_industry
BEFORE INSERT OR UPDATE OF encerrada_em, industria_codigo ON public.rotas
FOR EACH ROW
EXECUTE FUNCTION public.trg_prevent_active_route_for_inactive_industry();

REVOKE ALL ON FUNCTION public.trg_prevent_active_route_for_inactive_industry() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trg_prevent_active_route_for_inactive_industry() TO authenticated;
