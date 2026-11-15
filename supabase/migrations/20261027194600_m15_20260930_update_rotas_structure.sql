-- ==============================================================================
-- MK9 COMMAND CENTER - MIGRAÇÃO PARA REESTRUTURAÇÃO OPERACIONAL DE ROTAS FIXAS
-- ==============================================================================

-- Reestruturar rotas de forma segura
DO $$ 
BEGIN
  -- 1. Remover colunas obsoletas 'data' e 'sequencia' se existirem
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='rotas' AND column_name='data') THEN
    ALTER TABLE public.rotas DROP COLUMN data;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='rotas' AND column_name='sequencia') THEN
    ALTER TABLE public.rotas DROP COLUMN sequencia;
  END IF;

  -- 2. Garantir coluna codigo_rota se não existir
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='rotas' AND column_name='codigo_rota') THEN
    ALTER TABLE public.rotas ADD COLUMN codigo_rota TEXT DEFAULT 'ROT-PADRAO';
  END IF;

  -- 3. Adicionar coluna uf se não existir
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='rotas' AND column_name='uf') THEN
    ALTER TABLE public.rotas ADD COLUMN uf TEXT;
  END IF;

  -- 4. Adicionar coluna frequencia se não existir
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='rotas' AND column_name='frequencia') THEN
    ALTER TABLE public.rotas ADD COLUMN frequencia TEXT DEFAULT 'SEMANAL' CHECK (frequencia IN ('SEMANAL', 'QUINZENAL'));
  END IF;

  -- 5. Adicionar colunas dos dias da semana (booleanos)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='rotas' AND column_name='segunda') THEN
    ALTER TABLE public.rotas ADD COLUMN segunda BOOLEAN DEFAULT FALSE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='rotas' AND column_name='terca') THEN
    ALTER TABLE public.rotas ADD COLUMN terca BOOLEAN DEFAULT FALSE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='rotas' AND column_name='quarta') THEN
    ALTER TABLE public.rotas ADD COLUMN quarta BOOLEAN DEFAULT FALSE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='rotas' AND column_name='quinta') THEN
    ALTER TABLE public.rotas ADD COLUMN quinta BOOLEAN DEFAULT FALSE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='rotas' AND column_name='sexta') THEN
    ALTER TABLE public.rotas ADD COLUMN sexta BOOLEAN DEFAULT FALSE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='rotas' AND column_name='sabado') THEN
    ALTER TABLE public.rotas ADD COLUMN sabado BOOLEAN DEFAULT FALSE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='rotas' AND column_name='domingo') THEN
    ALTER TABLE public.rotas ADD COLUMN domingo BOOLEAN DEFAULT FALSE;
  END IF;
END $$;

-- Drop de constraint antiga se existir
ALTER TABLE public.rotas DROP CONSTRAINT IF EXISTS unique_rota_item;

-- Criar chave de unicidade baseada em promotor, loja e industria
ALTER TABLE public.rotas DROP CONSTRAINT IF EXISTS unique_rota_fixa_item;
ALTER TABLE public.rotas ADD CONSTRAINT unique_rota_fixa_item UNIQUE (promotor_matricula, loja_codigo, industria_codigo);
