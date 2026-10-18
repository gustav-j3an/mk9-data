-- ==============================================================================
-- MK9 DATE - PROPOSTA DE MIGRAÇÃO: ALINHAMENTO DA PROCEDURE DE SINCRONIZAÇÃO
-- Arquivo: supabase/migrations/propostas/20261018160000_proposal_sync_contratos_with_data_inicio.sql
-- Status: PROPOSTA LOCAL / NÃO EXECUTADA NO BANCO DE DADOS
-- 
-- PRÉ-REQUISITO OBRIGATÓRIO DE DEPLOY:
--   A migration "20261018150000_add_data_inicio_operacao_to_industrias.sql" DEVE
--   ter sido aplicada com sucesso no banco de dados ANTES da aplicação desta migration.
-- 
-- Regras de Negócio e Integridade:
--   1. KING (IND-013) & Demais Indústrias: Nenhuma vigência comercial pode ser inventada
--      via CURRENT_DATE. Ambas exigem formalmente industrias.data_inicio_operacao.
--   2. Se data_inicio_operacao estiver ausente, a criação é bloqueada e contabilizada
--      como pendência em rotas_sem_data_inicio_ignoradas.
--   3. KING mantém contrato comercial contínuo com vigência aberta (data_fim_vigencia = NULL).
--      O ciclo de apuração 23 a 22 NÃO deve encerrar ou recriar contratos mensalmente.
--   4. Idempotência: Preserva contratos ativos e suspensos existentes sem sobrescrita.
--   5. Bloqueio de Conflitos: Rotas divergentes na mesma loja continuam ignoradas.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.sync_contratos_from_rotas()
RETURNS TABLE (
  total_rotas_analisadas INTEGER,
  contratos_criados INTEGER,
  rotas_conflitantes_ignoradas INTEGER,
  rotas_sem_data_inicio_ignoradas INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_total INTEGER := 0;
  v_criados INTEGER := 0;
  v_conflitos INTEGER := 0;
  v_sem_data INTEGER := 0;
  v_has_col BOOLEAN := FALSE;
  r RECORD;
BEGIN
  -- 1. Verificar privilégios de execução: apenas administradores ou gestores
  IF NOT (public.is_admin_or_gestor()) THEN
    RAISE EXCEPTION 'Acesso negado: apenas administradores e gestores podem executar a sincronizacao contratual.';
  END IF;

  -- 2. Verificar se a coluna data_inicio_operacao já existe na tabela industrias
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'industrias'
      AND column_name = 'data_inicio_operacao'
  ) INTO v_has_col;

  -- 3. Percorrer agrupamento de rotas por indústria e loja
  FOR r IN (
    SELECT 
      rot.industria_codigo,
      rot.loja_codigo,
      MAX(rot.frequencia) as frequencia,
      BOOL_OR(rot.segunda) as segunda,
      BOOL_OR(rot.terca) as terca,
      BOOL_OR(rot.quarta) as quarta,
      BOOL_OR(rot.quinta) as quinta,
      BOOL_OR(rot.sexta) as sexta,
      BOOL_OR(rot.sabado) as sabado,
      BOOL_OR(rot.domingo) as domingo,
      COUNT(DISTINCT rot.frequencia) as freq_distinct_count,
      COUNT(*) as total_rotas_grupo
    FROM public.rotas rot
    WHERE rot.industria_codigo IS NOT NULL 
      AND rot.loja_codigo IS NOT NULL
    GROUP BY rot.industria_codigo, rot.loja_codigo
  ) LOOP
    v_total := v_total + 1;

    -- Conflito de frequências diferentes cadastradas para a mesma loja/indústria
    IF r.freq_distinct_count > 1 THEN
      v_conflitos := v_conflitos + 1;
      CONTINUE;
    END IF;

    -- Se já existir contrato para este par (ativo ou suspenso), não duplica
    IF EXISTS (
      SELECT 1 FROM public.contratos_lojas c
      WHERE c.industria_codigo = r.industria_codigo
        AND c.loja_codigo = r.loja_codigo
        AND c.status IN ('ativo', 'suspenso')
    ) THEN
      CONTINUE;
    END IF;

    -- Resolução da data de início da vigência comercial
    DECLARE
      v_data_inicio DATE := NULL;
      v_freq TEXT := COALESCE(r.frequencia, 'SEMANAL');
      v_dias_semana INTEGER := (
        (CASE WHEN r.segunda THEN 1 ELSE 0 END) +
        (CASE WHEN r.terca THEN 1 ELSE 0 END) +
        (CASE WHEN r.quarta THEN 1 ELSE 0 END) +
        (CASE WHEN r.quinta THEN 1 ELSE 0 END) +
        (CASE WHEN r.sexta THEN 1 ELSE 0 END) +
        (CASE WHEN r.sabado THEN 1 ELSE 0 END) +
        (CASE WHEN r.domingo THEN 1 ELSE 0 END)
      );
      v_visitas_semana INTEGER := NULL;
    BEGIN
      -- Recuperar data_inicio_operacao se a coluna existir
      IF v_has_col THEN
        EXECUTE 'SELECT data_inicio_operacao FROM public.industrias WHERE codigo = $1'
        INTO v_data_inicio
        USING r.industria_codigo;
      END IF;

      -- Regra Comercial Específica por Indústria:
      -- Nenhuma indústria (nem KING nem demais) pode ter início de vigência inventado via CURRENT_DATE.
      -- Se data_inicio_operacao estiver ausente, bloqueia a criação e contabiliza como pendência.
      IF v_data_inicio IS NULL THEN
        v_sem_data := v_sem_data + 1;
        CONTINUE; -- Bloqueia criação sem data de início da operação comercial formalizada
      END IF;

      -- Estruturação de frequência operacional
      IF v_freq = 'SEMANAL' THEN
        v_visitas_semana := CASE WHEN v_dias_semana > 0 THEN v_dias_semana ELSE 1 END;
      ELSE
        v_visitas_semana := NULL;
      END IF;

      -- Inserção do contrato comercial contínuo
      INSERT INTO public.contratos_lojas (
        industria_codigo,
        loja_codigo,
        frequencia,
        visitas_por_semana,
        segunda,
        terca,
        quarta,
        quinta,
        sexta,
        sabado,
        domingo,
        ciclo_quinzenal,
        data_inicio_vigencia,
        data_fim_vigencia,
        status,
        origem,
        observacao
      ) VALUES (
        r.industria_codigo,
        r.loja_codigo,
        v_freq,
        v_visitas_semana,
        COALESCE(r.segunda, false),
        COALESCE(r.terca, false),
        COALESCE(r.quarta, false),
        COALESCE(r.quinta, false),
        COALESCE(r.sexta, false),
        COALESCE(r.sabado, false),
        COALESCE(r.domingo, false),
        CASE WHEN v_freq = 'QUINZENAL' THEN 'QUINZENAL_LIVRE' ELSE NULL END,
        v_data_inicio,
        NULL, -- Contrato contínuo com vigência aberta
        'ativo',
        'migracao_rotas',
        'Contrato gerado a partir da malha de rotas ativas (Etapa H3)'
      );

      v_criados := v_criados + 1;
    END;
  END LOOP;

  RETURN QUERY SELECT v_total, v_criados, v_conflitos, v_sem_data;
END;
$$;

-- Revogar permissão pública por padrão e conceder apenas a authenticated
REVOKE EXECUTE ON FUNCTION public.sync_contratos_from_rotas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_contratos_from_rotas() TO authenticated;

