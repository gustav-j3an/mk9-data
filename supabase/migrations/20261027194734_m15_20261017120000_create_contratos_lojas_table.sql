-- ==============================================================================
-- MK9 DATE - MIGRAÇÃO PARA MODELO CONTRATUAL E FREQUÊNCIAS POR LOJA (REVISADA)
-- Arquivo: supabase/migrations/20261017120000_create_contratos_lojas_table.sql
-- Descrição: Cria a tabela public.contratos_lojas, trigger de validação estrita contra
--            sobreposição de vigências ativas/suspensas, políticas RLS granulares (SELECT,
--            INSERT, UPDATE e DELETE restrito a admin), trigger de updated_at e procedure
--            idempotente para conciliação segura a partir das rotas ativas.
-- ==============================================================================

-- 1. CRIAR A TABELA public.contratos_lojas (SE NÃO EXISTIR)
CREATE TABLE IF NOT EXISTS public.contratos_lojas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  industria_codigo TEXT NOT NULL REFERENCES public.industrias(codigo) ON DELETE RESTRICT ON UPDATE CASCADE,
  loja_codigo TEXT NOT NULL REFERENCES public.lojas(codigo) ON DELETE RESTRICT ON UPDATE CASCADE,
  frequencia TEXT NOT NULL DEFAULT 'SEMANAL' CHECK (frequencia IN ('SEMANAL', 'QUINZENAL', 'MENSAL')),
  
  -- Para SEMANAL: quantidade de visitas por semana (1 a 7).
  -- Para QUINZENAL e MENSAL: NULL (pois a frequência quinzenal ou mensal não se mede por visitas por semana).
  visitas_por_semana INTEGER CHECK (
    (frequencia = 'SEMANAL' AND visitas_por_semana IS NOT NULL AND visitas_por_semana >= 1 AND visitas_por_semana <= 7) OR
    (frequencia IN ('QUINZENAL', 'MENSAL') AND visitas_por_semana IS NULL)
  ),
  
  -- Dias previstos de atendimento (quando aplicável contratualmente)
  segunda BOOLEAN NOT NULL DEFAULT FALSE,
  terca BOOLEAN NOT NULL DEFAULT FALSE,
  quarta BOOLEAN NOT NULL DEFAULT FALSE,
  quinta BOOLEAN NOT NULL DEFAULT FALSE,
  sexta BOOLEAN NOT NULL DEFAULT FALSE,
  sabado BOOLEAN NOT NULL DEFAULT FALSE,
  domingo BOOLEAN NOT NULL DEFAULT FALSE,

  -- Ciclo quinzenal aplicável ('PAR_IMPAR', 'SEMANA_1_3', 'SEMANA_2_4', 'QUINZENAL_LIVRE')
  -- Quando frequencia = 'QUINZENAL', ciclo_quinzenal é obrigatório e deve ser um dos valores válidos.
  -- Quando frequencia != 'QUINZENAL', ciclo_quinzenal deve ser estritamente NULL.
  -- Sem default, para não provocar conflito de constraint ao omitir o campo em frequências SEMANAL ou MENSAL.
  ciclo_quinzenal TEXT CHECK (
    (frequencia = 'QUINZENAL' AND ciclo_quinzenal IS NOT NULL AND ciclo_quinzenal IN ('PAR_IMPAR', 'SEMANA_1_3', 'SEMANA_2_4', 'QUINZENAL_LIVRE')) OR
    (frequencia != 'QUINZENAL' AND ciclo_quinzenal IS NULL)
  ),

  -- Vigência Contratual
  data_inicio_vigencia DATE NOT NULL DEFAULT CURRENT_DATE,
  data_fim_vigencia DATE,

  -- Situação Comercial / Contratual:
  -- 'ativo': contrato em plena vigência comercial e operacional.
  -- 'suspenso': contrato temporariamente pausado, mas que preserva reserva da vigência.
  -- 'inativo': contrato cancelado antes de iniciar ou tornado inoperante.
  -- 'encerrado': contrato que cumpriu sua vigência ou foi rescindido, liberando novas vigências posteriores.
  status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'inativo', 'suspenso', 'encerrado')),

  -- Valor comercial por visita (opcional para auditoria e controle financeiro)
  valor_por_visita NUMERIC(10, 2) CHECK (valor_por_visita IS NULL OR valor_por_visita >= 0),

  -- Rastreabilidade e Auditoria
  origem TEXT DEFAULT 'manual' CHECK (origem IN ('manual', 'migracao_rotas', 'importacao_planilha', 'sistema')),
  observacao TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Validação de coerência da vigência
  CONSTRAINT check_vigencia_valida CHECK (data_fim_vigencia IS NULL OR data_fim_vigencia >= data_inicio_vigencia)
);

-- 2. ÍNDICES DE PERFORMANCE E CONSULTA
CREATE INDEX IF NOT EXISTS idx_contratos_industria ON public.contratos_lojas (industria_codigo);
CREATE INDEX IF NOT EXISTS idx_contratos_loja ON public.contratos_lojas (loja_codigo);
CREATE INDEX IF NOT EXISTS idx_contratos_status_vigencia ON public.contratos_lojas (status, data_inicio_vigencia, data_fim_vigencia);

-- 3. TRIGGER DE VALIDAÇÃO ESTREITA CONTRA SOBREPOSIÇÃO TEMPORAL DE VIGÊNCIAS
-- Garante que para a mesma indústria e loja NÃO existam dois contratos com status 'ativo' ou 'suspenso'
-- cujos períodos [data_inicio_vigencia, data_fim_vigencia] se sobreponham.
-- Trata data_fim_vigencia IS NULL como infinito ('infinity'::date).
-- Contratos com status 'encerrado' ou 'inativo' NÃO bloqueiam novas vigências.
CREATE OR REPLACE FUNCTION public.check_contratos_vigencia_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_fim_novo DATE := COALESCE(NEW.data_fim_vigencia, '9999-12-31'::date);
  v_conflito_id UUID;
  v_loja_exists BOOLEAN;
BEGIN
  -- Apenas valida sobreposição se o contrato estiver 'ativo' ou 'suspenso'
  IF NEW.status IN ('ativo', 'suspenso') THEN
    -- 1. Serialização de Concorrência Transacional (Pessimistic Lock):
    -- Bloqueia a linha da loja correspondente via FOR UPDATE.
    -- Se duas transações simultâneas tentarem inserir ou atualizar contratos para a mesma loja,
    -- a segunda transação é pausada e aguarda o commit da primeira, garantindo que
    -- a consulta de sobreposição abaixo enxergue o registro recém-inserido/atualizado (sem race conditions).
    SELECT EXISTS (
      SELECT 1 FROM public.lojas
      WHERE codigo = NEW.loja_codigo
      FOR UPDATE
    ) INTO v_loja_exists;

    -- Se a loja informada não existir, a foreign key barrará a transação,
    -- mas tratamos preventivamente aqui para clareza
    IF NOT v_loja_exists THEN
      RAISE EXCEPTION 'Loja com código "%" não encontrada ao validar vigência contratual.', NEW.loja_codigo;
    END IF;

    -- 2. Verificação de Sobreposição Temporal após adquirir o lock:
    SELECT id INTO v_conflito_id
    FROM public.contratos_lojas
    WHERE industria_codigo = NEW.industria_codigo
      AND loja_codigo = NEW.loja_codigo
      AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND status IN ('ativo', 'suspenso')
      AND (
        -- Sobreposição de intervalos fechados/abertos [inicio, fim]:
        -- Intervalo A sobrepõe Intervalo B se: max(inicio_A, inicio_B) <= min(fim_A, fim_B)
        GREATEST(NEW.data_inicio_vigencia, data_inicio_vigencia) <= LEAST(v_fim_novo, COALESCE(data_fim_vigencia, '9999-12-31'::date))
      )
    LIMIT 1;

    IF v_conflito_id IS NOT NULL THEN
      RAISE EXCEPTION 'Conflito de vigência contratual: já existe contrato ativo ou suspenso (ID %) para a indústria % e loja % no período informado.',
        v_conflito_id, NEW.industria_codigo, NEW.loja_codigo;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_check_contratos_vigencia_overlap ON public.contratos_lojas;
CREATE TRIGGER trigger_check_contratos_vigencia_overlap
  BEFORE INSERT OR UPDATE ON public.contratos_lojas
  FOR EACH ROW
  EXECUTE FUNCTION public.check_contratos_vigencia_overlap();

-- 4. TRIGGER DE ATUALIZAÇÃO AUTOMÁTICA DE updated_at
-- Não necessita de SECURITY DEFINER pois apenas manipula a variável NEW da própria linha em memória
CREATE OR REPLACE FUNCTION public.handle_contratos_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_contratos_updated_at ON public.contratos_lojas;
CREATE TRIGGER trigger_contratos_updated_at
  BEFORE UPDATE ON public.contratos_lojas
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_contratos_updated_at();

-- 5. HABILITAR ROW LEVEL SECURITY (RLS)
ALTER TABLE public.contratos_lojas ENABLE ROW LEVEL SECURITY;

-- 6. POLÍTICAS DE RLS SEGURAS E SEPARADAS POR OPERAÇÃO (CRUD)

-- 6.1 SELECT (Leitura):
-- Admin, Gestor e Operador: leitura irrestrita.
-- Client Industry: leitura ESTRITAMENTE restrita aos contratos de sua própria indústria.
-- Promotor: leitura apenas dos contratos de lojas onde possui rota atribuída.
DROP POLICY IF EXISTS "contratos_lojas_select_policy" ON public.contratos_lojas;
CREATE POLICY "contratos_lojas_select_policy"
  ON public.contratos_lojas
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin_or_gestor()
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'operador'
    OR industria_codigo = public.get_auth_industria_codigo()
    OR (
      (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'promotor'
      AND EXISTS (
        SELECT 1 FROM public.rotas r
        WHERE r.loja_codigo = contratos_lojas.loja_codigo
          AND r.industria_codigo = contratos_lojas.industria_codigo
          AND r.promotor_matricula = public.get_auth_promotor_matricula()
      )
    )
  );

-- 6.2 INSERT (Criação):
-- Permitido apenas para Admin, Gestor e Operador.
DROP POLICY IF EXISTS "contratos_lojas_insert_policy" ON public.contratos_lojas;
CREATE POLICY "contratos_lojas_insert_policy"
  ON public.contratos_lojas
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_admin_or_gestor()
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'operador'
  );

-- 6.3 UPDATE (Alteração):
-- Permitido para Admin, Gestor e Operador.
DROP POLICY IF EXISTS "contratos_lojas_update_policy" ON public.contratos_lojas;
CREATE POLICY "contratos_lojas_update_policy"
  ON public.contratos_lojas
  FOR UPDATE
  TO authenticated
  USING (
    public.is_admin_or_gestor()
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'operador'
  )
  WITH CHECK (
    public.is_admin_or_gestor()
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'operador'
  );

-- 6.4 DELETE (Exclusão Física):
-- Exclusivo para Administrador (Admin).
-- Gestor, Operador, Promotor e Client Industry NÃO possuem permissão de exclusão física.
DROP POLICY IF EXISTS "contratos_lojas_delete_policy" ON public.contratos_lojas;
DROP POLICY IF EXISTS "contratos_lojas_write_policy" ON public.contratos_lojas;
CREATE POLICY "contratos_lojas_delete_policy"
  ON public.contratos_lojas
  FOR DELETE
  TO authenticated
  USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  );

-- 7. FUNÇÃO AUXILIAR DE AUDITORIA E SINCRONIZAÇÃO/CARGA INICIAL (IDEMPOTENTE)
-- Não executa carga destrutiva. Apenas importa vínculos únicos de rotas que ainda não possuam contrato cadastrado.
CREATE OR REPLACE FUNCTION public.sync_contratos_from_rotas()
RETURNS TABLE (
  total_rotas_analisadas INTEGER,
  contratos_criados INTEGER,
  rotas_conflitantes_ignoradas INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_total INTEGER := 0;
  v_criados INTEGER := 0;
  v_conflitos INTEGER := 0;
  r RECORD;
BEGIN
  -- Verificar permissão de execução: apenas administradores ou gestores
  IF NOT (public.is_admin_or_gestor()) THEN
    RAISE EXCEPTION 'Acesso negado: apenas administradores e gestores podem executar a sincronizacao contratual.';
  END IF;

  -- Percorrer agrupamento de rotas por indústria e loja
  FOR r IN (
    SELECT 
      industria_codigo,
      loja_codigo,
      MAX(frequencia) as frequencia,
      BOOL_OR(segunda) as segunda,
      BOOL_OR(terca) as terca,
      BOOL_OR(quarta) as quarta,
      BOOL_OR(quinta) as quinta,
      BOOL_OR(sexta) as sexta,
      BOOL_OR(sabado) as sabado,
      BOOL_OR(domingo) as domingo,
      COUNT(DISTINCT frequencia) as freq_distinct_count,
      COUNT(*) as total_rotas_grupo
    FROM public.rotas
    WHERE industria_codigo IS NOT NULL AND loja_codigo IS NOT NULL
    GROUP BY industria_codigo, loja_codigo
  ) LOOP
    v_total := v_total + 1;

    -- Se houver conflito de frequências diferentes cadastradas para a mesma loja/indústria, não infere contrato automático
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

    -- Calcular quantidade de dias ativos por semana
    DECLARE
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
      IF v_freq = 'SEMANAL' THEN
        v_visitas_semana := CASE WHEN v_dias_semana > 0 THEN v_dias_semana ELSE 1 END;
      ELSE
        v_visitas_semana := NULL;
      END IF;

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
        CURRENT_DATE,
        NULL,
        'ativo',
        'migracao_rotas',
        'Contrato gerado automaticamente a partir da malha de rotas ativas (Missão 01)'
      );

      v_criados := v_criados + 1;
    END;
  END LOOP;

  RETURN QUERY SELECT v_total, v_criados, v_conflitos;
END;
$$;

-- 8. GESTÃO ESTRITA DE PRIVILÉGIOS DE EXECUÇÃO
-- Por padrão no PostgreSQL, funções recém-criadas concedem EXECUTE ao pseudo-papel PUBLIC.
-- Revogamos explicitamente de PUBLIC para garantir menor privilégio:
REVOKE EXECUTE ON FUNCTION public.check_contratos_vigencia_overlap() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_contratos_updated_at() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_contratos_from_rotas() FROM PUBLIC;

-- Funções acionadas por gatilho (check_contratos_vigencia_overlap e handle_contratos_updated_at)
-- são disparadas internamente pelo PostgreSQL no contexto do comando DML do usuário na tabela.
-- Não requerem nem devem possuir concessão direta a usuários ou endpoints de RPC.
-- Apenas concedemos execução direta em sync_contratos_from_rotas() para 'authenticated'
-- (cuja validação interna bloqueia quem não for admin/gestor):
GRANT EXECUTE ON FUNCTION public.sync_contratos_from_rotas() TO authenticated;

