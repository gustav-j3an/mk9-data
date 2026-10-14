-- ==============================================================================
-- MK9 COMMAND CENTER - ESTRUTURAÇÃO SEGURA DA TABELA DE EQUIPES E POVOAMENTO INICIAL
-- Arquivo: supabase/migrations/20261015100000_create_equipes_table.sql
-- Objetivo: Criação da tabela public.equipes com auto-geração de código único (EQP-XXX),
--           políticas de Row Level Security (RLS) baseadas no padrão RBAC do projeto,
--           e povoamento inicial idempotente e conservador a partir de public.promotores.
-- ==============================================================================

-- 1. SEQUENCE PARA NUMERAÇÃO SEQUENCIAL DE EQUIPES (EQP-XXX)
CREATE SEQUENCE IF NOT EXISTS public.equipes_codigo_seq;

-- 2. TABELA: public.equipes
CREATE TABLE IF NOT EXISTS public.equipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo TEXT UNIQUE NOT NULL,
  nome TEXT UNIQUE NOT NULL,
  regional TEXT,
  supervisor_nome TEXT,
  status TEXT NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa', 'reestruturacao', 'arquivada')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Índices para buscas rápidas, ordenação e filtros da interface
CREATE INDEX IF NOT EXISTS idx_equipes_nome ON public.equipes (nome);
CREATE INDEX IF NOT EXISTS idx_equipes_status ON public.equipes (status);
CREATE INDEX IF NOT EXISTS idx_equipes_regional ON public.equipes (regional);

-- 3. INICIALIZAR SEQUENCE COM BASE NO MAIOR CÓDIGO EXISTENTE (SE HOUVER)
DO $$
DECLARE
  max_num INT;
BEGIN
  SELECT COALESCE(
    MAX(
      NULLIF(regexp_replace(codigo, '^EQP-0*', ''), '')::INTEGER
    ),
    0
  ) INTO max_num
  FROM public.equipes
  WHERE codigo ~ '^EQP-\d+$';

  IF max_num > 0 THEN
    -- Se já existirem códigos no padrão EQP-XXX, a sequence continua a partir do maior
    PERFORM setval('public.equipes_codigo_seq', max_num, true);
  ELSE
    -- Se não houver nenhum código EQP-XXX (ex: tabela vazia ou apenas códigos manuais fora do padrão),
    -- inicializa em 1 com is_called = false para que a primeira chamada de nextval() retorne exatamente 1 (EQP-001)
    PERFORM setval('public.equipes_codigo_seq', 1, false);
  END IF;
END $$;

-- 4. FUNÇÕES DE GERAÇÃO E CONSULTA DE CÓDIGO NO PADRÃO 'EQP-XXX'
-- Função geradora thread-safe e atômica. A atomicidade de nextval() garante que cada transação
-- concorrente receba um número exclusivo, imune a conflitos entre inserts simultâneos.
-- O loop com verificação NOT EXISTS atua como resguardo adicional contra números que possam
-- ter sido consumidos previamente por inserções manuais com códigos no formato EQP-XXX.
-- A constraint UNIQUE (codigo) atua como barreira final intransponível no nível de storage.
CREATE OR REPLACE FUNCTION public.generate_team_code()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  next_num BIGINT;
  candidate_code TEXT;
BEGIN
  LOOP
    next_num := nextval('public.equipes_codigo_seq');
    candidate_code := 'EQP-' || lpad(next_num::text, 3, '0');
    
    -- Verifica se o código candidato já existe na tabela (ex: inserido manualmente fora da sequence)
    IF NOT EXISTS (SELECT 1 FROM public.equipes WHERE codigo = candidate_code) THEN
      RETURN candidate_code;
    END IF;
  END LOOP;
END;
$$;

-- Função read-only de consulta prévia para a interface (UI preview)
-- Garante coerência determinística com a sequence e com códigos manuais existentes:
-- A previsão sempre reflete o maior valor entre a próxima emissão da sequence e (maior código na tabela + 1),
-- pulando quaisquer códigos manuais intermediários já persistidos.
CREATE OR REPLACE FUNCTION public.get_next_team_code()
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_last_val BIGINT;
  v_is_called BOOLEAN;
  next_val BIGINT;
  max_num INT;
  candidate_code TEXT;
BEGIN
  -- 1. Obter o maior número do padrão EQP-XXX já gravado na tabela
  SELECT COALESCE(
    MAX(
      NULLIF(regexp_replace(codigo, '^EQP-0*', ''), '')::INTEGER
    ),
    0
  ) INTO max_num
  FROM public.equipes
  WHERE codigo ~ '^EQP-\d+$';

  -- 2. Inspecionar o estado atual da SEQUENCE
  SELECT s.last_value, s.is_called INTO v_last_val, v_is_called 
  FROM public.equipes_codigo_seq s;

  IF NOT v_is_called THEN
    next_val := v_last_val;
  ELSE
    next_val := v_last_val + 1;
  END IF;

  -- Se existirem códigos manuais maiores na tabela, a previsão deve alinhar-se acima deles
  IF next_val <= max_num THEN
    next_val := max_num + 1;
  END IF;

  -- 3. Garantir que não colida com código pré-existente na tabela
  LOOP
    candidate_code := 'EQP-' || lpad(next_val::text, 3, '0');
    IF NOT EXISTS (SELECT 1 FROM public.equipes WHERE codigo = candidate_code) THEN
      RETURN candidate_code;
    END IF;
    next_val := next_val + 1;
  END LOOP;
END;
$$;

-- Permissões das funções auxiliares
GRANT EXECUTE ON FUNCTION public.generate_team_code() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_next_team_code() TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.equipes_codigo_seq TO authenticated;

-- 5. TRIGGER BEFORE INSERT PARA AUTO-PREENCHIMENTO DO CÓDIGO
-- Se o código for omitido ou vazio, gera automaticamente no padrão EQP-XXX via generate_team_code().
-- Se um código for fornecido manualmente (inclusive fora do padrão EQP-XXX), preserva o valor intacto,
-- apenas aplicando normalização (UPPER e TRIM).
CREATE OR REPLACE FUNCTION public.set_equipe_codigo_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.codigo IS NULL OR trim(NEW.codigo) = '' THEN
    NEW.codigo := public.generate_team_code();
  ELSE
    NEW.codigo := upper(trim(NEW.codigo));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_set_equipe_codigo ON public.equipes;
CREATE TRIGGER trigger_set_equipe_codigo
  BEFORE INSERT ON public.equipes
  FOR EACH ROW
  EXECUTE FUNCTION public.set_equipe_codigo_trigger();

-- 6. TRIGGER PARA ATUALIZAÇÃO AUTOMÁTICA DE updated_at
CREATE OR REPLACE FUNCTION public.set_equipes_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_equipes_updated_at ON public.equipes;
CREATE TRIGGER trigger_equipes_updated_at
  BEFORE UPDATE ON public.equipes
  FOR EACH ROW
  EXECUTE FUNCTION public.set_equipes_updated_at();

-- 7. CONFIGURAÇÃO DE SEGURANÇA E POLÍTICAS RLS (ROW LEVEL SECURITY)
ALTER TABLE public.equipes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "equipes_select_policy" ON public.equipes;
DROP POLICY IF EXISTS "equipes_write_policy" ON public.equipes;

-- Leitura: Qualquer usuário autenticado pode consultar as equipes (necessário para filtros, rotas e promotores)
CREATE POLICY "equipes_select_policy"
  ON public.equipes
  FOR SELECT
  TO authenticated
  USING (true);

-- Escrita: Somente Admin e Gestor (RBAC estrito verificado via public.is_admin_or_gestor())
CREATE POLICY "equipes_write_policy"
  ON public.equipes
  FOR ALL
  TO authenticated
  USING (public.is_admin_or_gestor())
  WITH CHECK (public.is_admin_or_gestor());

-- 8. POVOAMENTO INICIAL IDEMPOTENTE E CONSERVADOR
-- Extrai equipes distintas reais já cadastradas na base de promotores.
-- Estratégia conservadora:
--   - Não inventa nem força valores padrão (sem 'SP' arbitrário).
--   - Se todos os promotores da equipe tiverem o mesmo UF (COUNT(DISTINCT) = 1), assume esse UF como regional.
--   - Se houver divergência entre UFs ou for nulo, regional permanece NULL para preenchimento manual pelo gestor.
--   - Se todos os promotores da equipe tiverem o mesmo supervisor (COUNT(DISTINCT) = 1), assume esse supervisor.
--   - Se houver divergência ou for nulo, supervisor_nome permanece NULL para não associar supervisor incorreto.
--   - ON CONFLICT (nome) DO NOTHING garante que equipes já cadastradas nunca sejam sobrescritas.
--   - A geração do código EQP-XXX é delegada ao trigger 'trigger_set_equipe_codigo', evitando consumo
--     desnecessário da sequence quando a linha for descartada pelo ON CONFLICT.
DO $$
DECLARE
  max_num INT;
BEGIN
  IF EXISTS (
    SELECT 1 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'promotores'
  ) THEN
    INSERT INTO public.equipes (nome, regional, supervisor_nome, status)
    SELECT
      TRIM(p.equipe) AS nome,
      CASE 
        WHEN COUNT(DISTINCT NULLIF(TRIM(p.uf), '')) = 1 
        THEN MAX(NULLIF(TRIM(p.uf), ''))
        ELSE NULL 
      END AS regional,
      CASE 
        WHEN COUNT(DISTINCT NULLIF(TRIM(p.supervisor), '')) = 1 
        THEN MAX(NULLIF(TRIM(p.supervisor), ''))
        ELSE NULL 
      END AS supervisor_nome,
      'ativa' AS status
    FROM public.promotores p
    WHERE p.equipe IS NOT NULL 
      AND TRIM(p.equipe) <> ''
    GROUP BY TRIM(p.equipe)
    ON CONFLICT (nome) DO NOTHING;

    -- Re-sincronizar sequence com base nos códigos finais gerados após a carga
    SELECT COALESCE(
      MAX(
        NULLIF(regexp_replace(codigo, '^EQP-0*', ''), '')::INTEGER
      ),
      0
    ) INTO max_num
    FROM public.equipes
    WHERE codigo ~ '^EQP-\d+$';

    IF max_num > 0 THEN
      PERFORM setval('public.equipes_codigo_seq', max_num, true);
    ELSE
      PERFORM setval('public.equipes_codigo_seq', 1, false);
    END IF;
  END IF;
END $$;
