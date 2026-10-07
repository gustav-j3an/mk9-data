-- ==============================================================================
-- MK9 COMMAND CENTER - MIGRAÇÃO PARA CONTROLE DE VALIDADE E VENCIMENTO DE PRODUTOS
-- Arquivo: supabase/migrations/20261007_create_visit_product_validity.sql
-- ETAPA 4 - Tabela public.visit_product_validity, Índices e Políticas RLS
-- ==============================================================================

-- 1. Criar Tabela public.visit_product_validity
CREATE TABLE IF NOT EXISTS public.visit_product_validity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
  produto_nome TEXT NOT NULL,
  quantidade INTEGER NOT NULL DEFAULT 1 CHECK (quantidade > 0),
  data_vencimento DATE NOT NULL,
  lote TEXT,
  observacao TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Índices de Desempenho
CREATE INDEX IF NOT EXISTS idx_visit_product_validity_visit_id ON public.visit_product_validity(visit_id);
CREATE INDEX IF NOT EXISTS idx_visit_product_validity_data_vencimento ON public.visit_product_validity(data_vencimento);

-- 3. Habilitar RLS (Row Level Security)
ALTER TABLE public.visit_product_validity ENABLE ROW LEVEL SECURITY;

-- 4. Remover Políticas Anteriores (se houver)
DROP POLICY IF EXISTS "visit_product_validity_select_policy" ON public.visit_product_validity;
DROP POLICY IF EXISTS "visit_product_validity_write_policy" ON public.visit_product_validity;

-- 5. Política SELECT: Admin, Gestor e Operador lêem todas; Promotor lê apenas registros de suas próprias visitas
CREATE POLICY "visit_product_validity_select_policy"
  ON public.visit_product_validity
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.visits v
      WHERE v.id = visit_product_validity.visit_id
      AND (
        public.is_admin_or_gestor()
        OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'operador'
        OR v.promotor_matricula = public.get_auth_promotor_matricula()
      )
    )
  );

-- 6. Política WRITE (INSERT/UPDATE/DELETE): Admin e Gestor podem tudo; Promotor pode apenas nas suas próprias visitas
CREATE POLICY "visit_product_validity_write_policy"
  ON public.visit_product_validity
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.visits v
      WHERE v.id = visit_product_validity.visit_id
      AND (
        public.is_admin_or_gestor()
        OR v.promotor_matricula = public.get_auth_promotor_matricula()
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.visits v
      WHERE v.id = visit_product_validity.visit_id
      AND (
        public.is_admin_or_gestor()
        OR v.promotor_matricula = public.get_auth_promotor_matricula()
      )
    )
  );
