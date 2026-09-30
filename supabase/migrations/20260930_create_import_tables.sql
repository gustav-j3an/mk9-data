-- ==============================================================================
-- MK9 COMMAND CENTER - MIGRAÇÃO PARA MÓDULO DE IMPORTAÇÃO DE PLANILHAS E HISTÓRICO
-- ==============================================================================

-- 1. Tabela de Indústrias (industrias)
CREATE TABLE IF NOT EXISTS public.industrias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo TEXT UNIQUE NOT NULL,
  nome TEXT NOT NULL,
  cnpj TEXT,
  status TEXT DEFAULT 'ativo' CHECK (status IN ('ativo', 'inativo')),
  observacao TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Tabela de Lojas (lojas)
CREATE TABLE IF NOT EXISTS public.lojas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo TEXT UNIQUE NOT NULL,
  nome TEXT NOT NULL,
  cnpj TEXT,
  cidade TEXT NOT NULL,
  uf TEXT NOT NULL,
  endereco TEXT,
  rede TEXT,
  status TEXT DEFAULT 'ativo' CHECK (status IN ('ativo', 'inativo')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Tabela de Promotores (promotores)
CREATE TABLE IF NOT EXISTS public.promotores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  matricula TEXT UNIQUE NOT NULL,
  nome TEXT NOT NULL,
  cpf TEXT,
  telefone TEXT,
  email TEXT,
  cidade TEXT NOT NULL,
  uf TEXT NOT NULL,
  supervisor TEXT,
  equipe TEXT,
  status TEXT DEFAULT 'ativo' CHECK (status IN ('ativo', 'inativo', 'ferias', 'afastado')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Tabela de Rotas (rotas)
CREATE TABLE IF NOT EXISTS public.rotas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo_rota TEXT NOT NULL,
  data DATE NOT NULL,
  promotor_matricula TEXT NOT NULL REFERENCES public.promotores(matricula) ON DELETE CASCADE ON UPDATE CASCADE,
  loja_codigo TEXT NOT NULL REFERENCES public.lojas(codigo) ON DELETE CASCADE ON UPDATE CASCADE,
  industria_codigo TEXT NOT NULL REFERENCES public.industrias(codigo) ON DELETE CASCADE ON UPDATE CASCADE,
  sequencia INT DEFAULT 1,
  observacao TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_rota_item UNIQUE (codigo_rota, data, promotor_matricula, loja_codigo, industria_codigo)
);

-- 5. Tabela de Histórico de Importações (import_history)
CREATE TABLE IF NOT EXISTS public.import_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo TEXT NOT NULL CHECK (tipo IN ('industrias', 'lojas', 'promotores', 'rotas')),
  filename TEXT NOT NULL,
  imported_by_id UUID REFERENCES auth.users(id),
  imported_by_email TEXT NOT NULL,
  imported_by_name TEXT,
  rows_total INT NOT NULL DEFAULT 0,
  rows_accepted INT NOT NULL DEFAULT 0,
  rows_rejected INT NOT NULL DEFAULT 0,
  is_upsert BOOLEAN DEFAULT FALSE,
  errors_summary JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Habilitar RLS em todas as tabelas criadas
ALTER TABLE public.industrias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lojas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_history ENABLE ROW LEVEL SECURITY;

-- Políticas de RLS (Leitura para autenticados, Inserção/Atualização para autenticados)
CREATE POLICY "Permitir leitura de industrias para autenticados" ON public.industrias FOR SELECT TO authenticated USING (true);
CREATE POLICY "Permitir escrita de industrias para autenticados" ON public.industrias FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Permitir leitura de lojas para autenticados" ON public.lojas FOR SELECT TO authenticated USING (true);
CREATE POLICY "Permitir escrita de lojas para autenticados" ON public.lojas FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Permitir leitura de promotores para autenticados" ON public.promotores FOR SELECT TO authenticated USING (true);
CREATE POLICY "Permitir escrita de promotores para autenticados" ON public.promotores FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Permitir leitura de rotas para autenticados" ON public.rotas FOR SELECT TO authenticated USING (true);
CREATE POLICY "Permitir escrita de rotas para autenticados" ON public.rotas FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Permitir leitura do historico para autenticados" ON public.import_history FOR SELECT TO authenticated USING (true);
CREATE POLICY "Permitir insercao no historico para autenticados" ON public.import_history FOR INSERT TO authenticated WITH CHECK (auth.uid() = imported_by_id OR true);
