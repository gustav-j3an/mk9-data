-- ==============================================================================
-- MK9 COMMAND CENTER - GERAÇÃO AUTOMÁTICA E SEGURA DE CÓDIGO DE LOJA/PDV (LOJ-XXXX)
-- ==============================================================================

-- 1. Garantir constraint UNIQUE na coluna codigo da tabela public.lojas
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conrelid = 'public.lojas'::regclass 
      AND contype = 'u' 
      AND conname = 'lojas_codigo_key'
  ) THEN
    ALTER TABLE public.lojas ADD CONSTRAINT lojas_codigo_key UNIQUE (codigo);
  END IF;
EXCEPTION
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_object THEN NULL;
END $$;

-- 2. Criar a SEQUENCE para numeração das lojas
CREATE SEQUENCE IF NOT EXISTS public.lojas_codigo_seq;

-- 3. Inicializar a SEQUENCE com base no MAIOR número existente na coluna codigo
DO $$
DECLARE
  max_num INT;
BEGIN
  SELECT COALESCE(
    MAX(
      NULLIF(regexp_replace(codigo, '^LOJ-0*', ''), '')::INTEGER
    ),
    0
  ) INTO max_num
  FROM public.lojas
  WHERE codigo ~ '^LOJ-\d+$';

  IF max_num < 438 THEN
    max_num := 438;
  END IF;

  -- Define o valor atual como max_num (com is_called = true)
  -- Assim, a próxima chamada de nextval() gerará max_num + 1 (ex: 439)
  PERFORM setval('public.lojas_codigo_seq', max_num, true);
END $$;

-- 4. Função geradora do próximo código no formato LOJ-XXXX (Atômica e thread-safe)
CREATE OR REPLACE FUNCTION public.generate_store_code()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  next_num BIGINT;
BEGIN
  next_num := nextval('public.lojas_codigo_seq');
  RETURN 'LOJ-' || lpad(next_num::text, 4, '0');
END;
$$;

-- 5. Função RPC para consulta/preview do próximo código no formulário do frontend
CREATE OR REPLACE FUNCTION public.get_next_store_code()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  max_num INT;
  next_num INT;
BEGIN
  SELECT COALESCE(
    MAX(
      NULLIF(regexp_replace(codigo, '^LOJ-0*', ''), '')::INTEGER
    ),
    0
  ) INTO max_num
  FROM public.lojas
  WHERE codigo ~ '^LOJ-\d+$';

  IF max_num < 438 THEN
    next_num := 439;
  ELSE
    next_num := max_num + 1;
  END IF;

  RETURN 'LOJ-' || lpad(next_num::text, 4, '0');
END;
$$;

-- Permissões de execução para as funções e sequence
GRANT EXECUTE ON FUNCTION public.get_next_store_code() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.generate_store_code() TO authenticated, anon;
GRANT USAGE, SELECT ON SEQUENCE public.lojas_codigo_seq TO authenticated, anon;

-- 6. Trigger BEFORE INSERT na tabela public.lojas
CREATE OR REPLACE FUNCTION public.set_loja_codigo_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.codigo IS NULL OR NEW.codigo = '' THEN
    NEW.codigo := public.generate_store_code();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_set_loja_codigo ON public.lojas;
CREATE TRIGGER trigger_set_loja_codigo
  BEFORE INSERT ON public.lojas
  FOR EACH ROW
  EXECUTE FUNCTION public.set_loja_codigo_trigger();

-- 7. Atribuir a função como DEFAULT da coluna codigo em public.lojas
ALTER TABLE public.lojas ALTER COLUMN codigo SET DEFAULT public.generate_store_code();
