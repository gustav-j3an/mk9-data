-- ==============================================================================
-- MK9 COMMAND CENTER - ESTRUTURAÇÃO DA GESTÃO DE SUPERVISORES E VÍNCULO COM EQUIPES
-- Arquivo: supabase/migrations/20261016100000_create_supervisores_table.sql
-- Objetivo:
--   1. Criação da tabela public.supervisores com código único (SUP-XXX);
--   2. Sequence e geração segura/atômica de códigos via trigger e RPC de preview;
--   3. Vínculo estruturado opcional supervisor_id em public.equipes (mantendo supervisor_nome);
--   4. Políticas de Row Level Security (RLS) alinhadas ao RBAC do projeto;
--   5. Povoamento inicial idempotente e conservador a partir de promotores e equipes;
--   6. Hardening de permissões (bloqueio total a anon, restrição a authenticated).
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. SEQUENCE PARA NUMERAÇÃO SEQUENCIAL DE SUPERVISORES (SUP-XXX)
-- ------------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.supervisores_codigo_seq;

-- ------------------------------------------------------------------------------
-- 2. TABELA: public.supervisores
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.supervisores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo TEXT UNIQUE NOT NULL,
  nome TEXT NOT NULL,
  email TEXT UNIQUE,
  telefone TEXT,
  regional TEXT,
  status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'inativo', 'ferias', 'afastado')),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Índices para buscas rápidas, ordenação e filtros
CREATE INDEX IF NOT EXISTS idx_supervisores_nome ON public.supervisores (nome);
CREATE INDEX IF NOT EXISTS idx_supervisores_status ON public.supervisores (status);
CREATE INDEX IF NOT EXISTS idx_supervisores_regional ON public.supervisores (regional);
CREATE INDEX IF NOT EXISTS idx_supervisores_user_id ON public.supervisores (user_id);

-- ------------------------------------------------------------------------------
-- 3. INICIALIZAR SEQUENCE COM BASE NO MAIOR CÓDIGO EXISTENTE
-- ------------------------------------------------------------------------------
DO $$
DECLARE
  max_num INT;
BEGIN
  SELECT COALESCE(
    MAX(
      NULLIF(regexp_replace(codigo, '^SUP-0*', ''), '')::INTEGER
    ),
    0
  ) INTO max_num
  FROM public.supervisores
  WHERE codigo ~ '^SUP-\d+$';

  IF max_num > 0 THEN
    PERFORM setval('public.supervisores_codigo_seq', max_num, true);
  ELSE
    PERFORM setval('public.supervisores_codigo_seq', 1, false);
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 4. FUNÇÕES DE GERAÇÃO E CONSULTA DE CÓDIGO NO PADRÃO 'SUP-XXX'
-- ------------------------------------------------------------------------------
-- 4.1 Geradora atômica (invocada internamente pelo trigger em SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.generate_supervisor_code()
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
    next_num := nextval('public.supervisores_codigo_seq');
    candidate_code := 'SUP-' || lpad(next_num::text, 3, '0');
    
    IF NOT EXISTS (SELECT 1 FROM public.supervisores WHERE codigo = candidate_code) THEN
      RETURN candidate_code;
    END IF;
  END LOOP;
END;
$$;

-- 4.2 Função de pré-visualização read-only determinística para o frontend
CREATE OR REPLACE FUNCTION public.get_next_supervisor_code()
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
  SELECT COALESCE(
    MAX(
      NULLIF(regexp_replace(codigo, '^SUP-0*', ''), '')::INTEGER
    ),
    0
  ) INTO max_num
  FROM public.supervisores
  WHERE codigo ~ '^SUP-\d+$';

  SELECT s.last_value, s.is_called INTO v_last_val, v_is_called 
  FROM public.supervisores_codigo_seq s;

  IF NOT v_is_called THEN
    next_val := v_last_val;
  ELSE
    next_val := v_last_val + 1;
  END IF;

  IF next_val <= max_num THEN
    next_val := max_num + 1;
  END IF;

  LOOP
    candidate_code := 'SUP-' || lpad(next_val::text, 3, '0');
    IF NOT EXISTS (SELECT 1 FROM public.supervisores WHERE codigo = candidate_code) THEN
      RETURN candidate_code;
    END IF;
    next_val := next_val + 1;
  END LOOP;
END;
$$;

-- ------------------------------------------------------------------------------
-- 5. TRIGGERS: AUTO-PREENCHIMENTO DO CÓDIGO E TIMESTAMP
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_supervisor_codigo_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.codigo IS NULL OR trim(NEW.codigo) = '' THEN
    NEW.codigo := public.generate_supervisor_code();
  ELSE
    NEW.codigo := upper(trim(NEW.codigo));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_set_supervisor_codigo ON public.supervisores;
CREATE TRIGGER trigger_set_supervisor_codigo
  BEFORE INSERT ON public.supervisores
  FOR EACH ROW
  EXECUTE FUNCTION public.set_supervisor_codigo_trigger();

CREATE OR REPLACE FUNCTION public.set_supervisores_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_supervisores_updated_at ON public.supervisores;
CREATE TRIGGER trigger_supervisores_updated_at
  BEFORE UPDATE ON public.supervisores
  FOR EACH ROW
  EXECUTE FUNCTION public.set_supervisores_updated_at();

-- ------------------------------------------------------------------------------
-- 6. VÍNCULO ESTRUTURADO EM public.equipes (COM RETROCOMPATIBILIDADE)
-- ------------------------------------------------------------------------------
-- Adicionar coluna supervisor_id se não existir
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'equipes' AND column_name = 'supervisor_id'
  ) THEN
    ALTER TABLE public.equipes 
      ADD COLUMN supervisor_id UUID REFERENCES public.supervisores(id) ON DELETE SET NULL;
    
    CREATE INDEX IF NOT EXISTS idx_equipes_supervisor_id ON public.equipes (supervisor_id);
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 7. CONFIGURAÇÃO DE SEGURANÇA E POLÍTICAS RLS (ROW LEVEL SECURITY)
-- ------------------------------------------------------------------------------
ALTER TABLE public.supervisores ENABLE ROW LEVEL SECURITY;

-- Hardening de privilégios SQL:
REVOKE ALL ON TABLE public.supervisores FROM anon;
REVOKE ALL ON TABLE public.supervisores FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.supervisores TO authenticated;
GRANT ALL ON TABLE public.supervisores TO service_role;

-- Hardening da sequence:
REVOKE ALL ON SEQUENCE public.supervisores_codigo_seq FROM anon;
REVOKE ALL ON SEQUENCE public.supervisores_codigo_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.supervisores_codigo_seq FROM authenticated;
GRANT ALL ON SEQUENCE public.supervisores_codigo_seq TO service_role;

-- Hardening das rotinas:
REVOKE ALL ON FUNCTION public.generate_supervisor_code() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_supervisor_codigo_trigger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_supervisores_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_next_supervisor_code() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_next_supervisor_code() TO authenticated, service_role;

-- Políticas RLS:
DROP POLICY IF EXISTS "supervisores_select_policy" ON public.supervisores;
DROP POLICY IF EXISTS "supervisores_write_policy" ON public.supervisores;

-- Leitura: Qualquer usuário autenticado (necessário para selects de equipes e filtros)
CREATE POLICY "supervisores_select_policy"
  ON public.supervisores
  FOR SELECT
  TO authenticated
  USING (true);

-- Escrita: Somente Admin e Gestor (RBAC estrito)
CREATE POLICY "supervisores_write_policy"
  ON public.supervisores
  FOR ALL
  TO authenticated
  USING (public.is_admin_or_gestor())
  WITH CHECK (public.is_admin_or_gestor());

-- ------------------------------------------------------------------------------
-- 8. POVOAMENTO INICIAL IDEMPOTENTE E CONSERVADOR
-- ------------------------------------------------------------------------------
-- Extrai nomes distintos de supervisores já presentes em public.promotores e public.equipes
DO $$
DECLARE
  max_num INT;
BEGIN
  -- 1. Povoar supervisores únicos a partir de promotores e equipes
  WITH nomes_supervisores AS (
    SELECT DISTINCT TRIM(supervisor) AS nome_limpo
    FROM public.promotores
    WHERE supervisor IS NOT NULL AND TRIM(supervisor) <> '' AND TRIM(supervisor) <> 'Nenhum'
    UNION
    SELECT DISTINCT TRIM(supervisor_nome) AS nome_limpo
    FROM public.equipes
    WHERE supervisor_nome IS NOT NULL AND TRIM(supervisor_nome) <> '' AND TRIM(supervisor_nome) <> 'Nenhum'
  )
  INSERT INTO public.supervisores (nome, regional, status)
  SELECT 
    ns.nome_limpo AS nome,
    -- Obter regional se houver consenso na base de promotores
    (
      SELECT CASE WHEN COUNT(DISTINCT NULLIF(TRIM(p.uf), '')) = 1 THEN MAX(NULLIF(TRIM(p.uf), '')) ELSE NULL END
      FROM public.promotores p
      WHERE TRIM(p.supervisor) = ns.nome_limpo
    ) AS regional,
    'ativo' AS status
  FROM nomes_supervisores ns
  WHERE NOT EXISTS (
    SELECT 1 FROM public.supervisores s WHERE LOWER(TRIM(s.nome)) = LOWER(TRIM(ns.nome_limpo))
  );

  -- 2. Vincular supervisor_id nas equipes existentes onde supervisor_nome confere
  UPDATE public.equipes e
  SET supervisor_id = s.id
  FROM public.supervisores s
  WHERE e.supervisor_id IS NULL
    AND e.supervisor_nome IS NOT NULL
    AND LOWER(TRIM(e.supervisor_nome)) = LOWER(TRIM(s.nome));

  -- 3. Re-sincronizar sequence com base nos códigos finais gerados
  SELECT COALESCE(
    MAX(
      NULLIF(regexp_replace(codigo, '^SUP-0*', ''), '')::INTEGER
    ),
    0
  ) INTO max_num
  FROM public.supervisores
  WHERE codigo ~ '^SUP-\d+$';

  IF max_num > 0 THEN
    PERFORM setval('public.supervisores_codigo_seq', max_num, true);
  ELSE
    PERFORM setval('public.supervisores_codigo_seq', 1, false);
  END IF;
END $$;

COMMIT;

