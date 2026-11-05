-- ==============================================================================
-- MISSÃO 30 — MK9 DATE | SINCRONIZAÇÃO DE INDÚSTRIAS INATIVAS COM ROTAS FIXAS
-- ==============================================================================
-- Migration de referência para revisão e homologação.
-- NÃO APLICAR AUTOMATICAMENTE SEM AUTORIZAÇÃO EXPRESSA.
--
-- Objetivos:
-- 1. Fornecer uma RPC atômica segura ('inactivate_industry_and_suspend_routes')
--    que inativa a indústria e suspende (encerra logicamente com motivo rastreável)
--    todas as rotas ativas vinculadas, em uma única transação no banco de dados.
-- 2. Fornecer uma RPC para reativação explícita e controlada de rotas que foram
--    suspensas exclusivamente pela inativação da indústria ('reactivate_industry_routes').
-- 3. Adicionar coluna opcional 'motivo_encerramento' na tabela 'public.rotas' para
--    distinção estruturada e auditável de rotas encerradas manualmente vs por inativação de indústria.
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

  -- Localizar a indústria
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

  -- 1. Atualizar indústria para inativo
  UPDATE public.industrias
  SET status = 'inativo',
      updated_at = v_closed_at
  WHERE id = p_industria_id;

  -- 2. Suspender rotas atualmente ativas vinculadas à indústria (sem exclusão física)
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

-- 4. Trigger de proteção automática no banco de dados (Missão 34)
-- Impede contorno por UPDATE direto, importação ou mutações em lote:
-- Quando qualquer indústria tiver seu status atualizado para 'inativo',
-- todas as suas rotas ativas são automaticamente suspensas de forma atômica no PostgreSQL.
CREATE OR REPLACE FUNCTION public.trg_auto_suspend_routes_on_industry_inactivation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_closed_at TIMESTAMPTZ := NOW();
  v_has_motivo_col BOOLEAN := FALSE;
BEGIN
  -- Se o status foi alterado para inativo (ou já era inativo e permanece inativo com rotas ainda ativas)
  IF (NEW.status = 'inativo' AND (OLD.status IS DISTINCT FROM 'inativo' OR OLD.status = 'inativo')) THEN
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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_industrias_inactivation_sync_routes ON public.industrias;
CREATE TRIGGER trg_industrias_inactivation_sync_routes
AFTER UPDATE OF status ON public.industrias
FOR EACH ROW
EXECUTE FUNCTION public.trg_auto_suspend_routes_on_industry_inactivation();

