-- ==============================================================================
-- MK9 COMMAND CENTER - GERAÇÃO AUTOMÁTICA E SEGURA DE CÓDIGO DE INDÚSTRIA (IND-XXX)
-- Arquivo: supabase/migrations/20261011140000_auto_generate_industry_code.sql
-- ==============================================================================

-- 1. Garantir constraint UNIQUE na coluna codigo da tabela public.industrias
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conrelid = 'public.industrias'::regclass 
      AND contype = 'u' 
      AND conname = 'industrias_codigo_key'
  ) THEN
    ALTER TABLE public.industrias ADD CONSTRAINT industrias_codigo_key UNIQUE (codigo);
  END IF;
EXCEPTION
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_object THEN NULL;
END $$;

-- 2. Criar SEQUENCE para numeração das indústrias
CREATE SEQUENCE IF NOT EXISTS public.industrias_codigo_seq;

-- 3. Inicializar SEQUENCE com base no MAIOR número existente na coluna codigo
DO $$
DECLARE
  max_num INT;
BEGIN
  SELECT COALESCE(
    MAX(
      NULLIF(regexp_replace(codigo, '^IND-0*', ''), '')::INTEGER
    ),
    0
  ) INTO max_num
  FROM public.industrias
  WHERE codigo ~ '^IND-\d+$';

  IF max_num > 0 THEN
    PERFORM setval('public.industrias_codigo_seq', max_num, true);
  ELSE
    PERFORM setval('public.industrias_codigo_seq', 1, false);
  END IF;
END $$;

-- 4. Função geradora do próximo código no formato IND-XXX (Atômica e thread-safe)
CREATE OR REPLACE FUNCTION public.generate_industry_code()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  next_num BIGINT;
BEGIN
  next_num := nextval('public.industrias_codigo_seq');
  RETURN 'IND-' || lpad(next_num::text, 3, '0');
END;
$$;

-- 5. Função de consulta prévia (read-only) para UI do frontend
CREATE OR REPLACE FUNCTION public.get_next_industry_code()
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_last_val BIGINT;
  v_is_called BOOLEAN;
  next_val BIGINT;
  max_num INT;
BEGIN
  -- Verificar o maior número atual já persistido
  SELECT COALESCE(
    MAX(
      NULLIF(regexp_replace(codigo, '^IND-0*', ''), '')::INTEGER
    ),
    0
  ) INTO max_num
  FROM public.industrias
  WHERE codigo ~ '^IND-\d+$';

  SELECT s.last_value, s.is_called INTO v_last_val, v_is_called 
  FROM public.industrias_codigo_seq s;

  IF NOT v_is_called THEN
    next_val := v_last_val;
  ELSE
    next_val := v_last_val + 1;
  END IF;

  IF next_val <= max_num THEN
    next_val := max_num + 1;
  END IF;

  RETURN 'IND-' || lpad(next_val::text, 3, '0');
END;
$$;

-- Permissões de execução para usuários autenticados
GRANT EXECUTE ON FUNCTION public.generate_industry_code() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_next_industry_code() TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.industrias_codigo_seq TO authenticated;

-- 6. Trigger BEFORE INSERT para preenchimento automático se codigo for nulo ou vazio
CREATE OR REPLACE FUNCTION public.set_industria_codigo_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.codigo IS NULL OR trim(NEW.codigo) = '' THEN
    NEW.codigo := public.generate_industry_code();
  ELSE
    NEW.codigo := upper(trim(NEW.codigo));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_set_industria_codigo ON public.industrias;
CREATE TRIGGER trigger_set_industria_codigo
  BEFORE INSERT ON public.industrias
  FOR EACH ROW
  EXECUTE FUNCTION public.set_industria_codigo_trigger();
