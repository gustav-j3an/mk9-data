-- ==============================================================================
-- MK9 COMMAND CENTER - MIGRAÇÃO DE CATÁLOGO DE SKUS E CONFERÊNCIA DE ESTOQUE
-- Arquivo: supabase/migrations/propostas/20261115_rc1_25_skus_and_stock_audits.sql
-- Status: PENDENTE DE APROVAÇÃO (NÃO APLICADA - EM CONFORMIDADE COM REGRA RC1.25)
-- ==============================================================================

-- 1. TABELA DE CATÁLOGO OFICIAL E SUGESTÕES DE SKUs (industria_skus)
CREATE TABLE IF NOT EXISTS public.industria_skus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  industria_codigo TEXT NOT NULL REFERENCES public.industrias(codigo) ON DELETE RESTRICT ON UPDATE CASCADE,
  codigo_sku TEXT NOT NULL,
  nome_produto TEXT NOT NULL,
  ean TEXT,
  status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'inativo', 'pendente', 'rejeitado')),
  origem_cadastro TEXT NOT NULL DEFAULT 'admin_manual' CHECK (origem_cadastro IN ('admin_import', 'admin_manual', 'promotor_sugestao')),
  sugerido_por_matricula TEXT REFERENCES public.promotores(matricula) ON DELETE SET NULL,
  aprovado_por_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  aprovado_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_industria_sku_codigo UNIQUE (industria_codigo, codigo_sku)
);

CREATE INDEX IF NOT EXISTS idx_industria_skus_ind_status ON public.industria_skus(industria_codigo, status);
CREATE INDEX IF NOT EXISTS idx_industria_skus_ean ON public.industria_skus(ean) WHERE ean IS NOT NULL;

-- 2. TABELA DE HISTÓRICO E CONFERÊNCIA DE ESTOQUE POR VISITA/LOJA/SKU (visit_sku_stock_checks)
CREATE TABLE IF NOT EXISTS public.visit_sku_stock_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
  industria_codigo TEXT NOT NULL REFERENCES public.industrias(codigo) ON DELETE RESTRICT ON UPDATE CASCADE,
  loja_codigo TEXT NOT NULL REFERENCES public.lojas(codigo) ON DELETE RESTRICT ON UPDATE CASCADE,
  codigo_sku TEXT NOT NULL,
  data_conferencia DATE NOT NULL,
  quantidade_venda INT NOT NULL DEFAULT 0 CHECK (quantidade_venda >= 0),
  quantidade_deposito INT NOT NULL DEFAULT 0 CHECK (quantidade_deposito >= 0),
  quantidade_reposicao INT NOT NULL DEFAULT 0 CHECK (quantidade_reposicao >= 0),
  quantidade_anterior_venda INT DEFAULT 0,
  quantidade_anterior_deposito INT DEFAULT 0,
  status_conferencia TEXT NOT NULL DEFAULT 'conferido' CHECK (status_conferencia IN ('conferido', 'justificado', 'pendente')),
  justificativa TEXT CHECK (justificativa IN ('nao_encontrado', 'nao_comercializado', 'inacessivel', 'outro')),
  observacao TEXT,
  conferido_por_matricula TEXT NOT NULL REFERENCES public.promotores(matricula),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_visit_sku_check UNIQUE (visit_id, codigo_sku)
);

CREATE INDEX IF NOT EXISTS idx_visit_sku_stock_lookup ON public.visit_sku_stock_checks(industria_codigo, loja_codigo, codigo_sku, data_conferencia DESC);
CREATE INDEX IF NOT EXISTS idx_visit_sku_visit_id ON public.visit_sku_stock_checks(visit_id);

-- 3. TABELA DE AUDITORIA DE EDIÇÃO DE VISITAS CONCLUÍDAS (visit_edits_audit_log)
CREATE TABLE IF NOT EXISTS public.visit_edits_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
  altered_by_user_id UUID NOT NULL REFERENCES auth.users(id),
  altered_by_matricula TEXT,
  field_name TEXT NOT NULL,
  old_value JSONB,
  new_value JSONB,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_visit_edits_audit_visit ON public.visit_edits_audit_log(visit_id, created_at DESC);

-- 4. ATIVAR ROW LEVEL SECURITY (RLS)
ALTER TABLE public.industria_skus ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visit_sku_stock_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visit_edits_audit_log ENABLE ROW LEVEL SECURITY;

-- 5. POLÍTICAS RLS PARA industria_skus
-- Promotores e operadores leem SKUs ativos ou os pendentes sugeridos por eles mesmos
CREATE POLICY "industria_skus_select_policy" ON public.industria_skus
  FOR SELECT TO authenticated
  USING (
    public.is_admin_or_gestor()
    OR status = 'ativo'
    OR (origem_cadastro = 'promotor_sugestao' AND sugerido_por_matricula = public.get_auth_promotor_matricula())
  );

-- Promotores podem inserir apenas como sugestão pendente vinculada à sua matrícula
CREATE POLICY "industria_skus_promoter_insert_policy" ON public.industria_skus
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin_or_gestor()
    OR (
      status = 'pendente'
      AND origem_cadastro = 'promotor_sugestao'
      AND sugerido_por_matricula = public.get_auth_promotor_matricula()
    )
  );

-- Apenas admin e gestor aprovam, alteram ou desativam SKUs
CREATE POLICY "industria_skus_admin_write_policy" ON public.industria_skus
  FOR UPDATE TO authenticated
  USING (public.is_admin_or_gestor())
  WITH CHECK (public.is_admin_or_gestor());

-- 6. POLÍTICAS RLS PARA visit_sku_stock_checks
CREATE POLICY "visit_sku_stock_select_policy" ON public.visit_sku_stock_checks
  FOR SELECT TO authenticated
  USING (
    public.is_admin_or_gestor()
    OR conferido_por_matricula = public.get_auth_promotor_matricula()
  );

CREATE POLICY "visit_sku_stock_write_policy" ON public.visit_sku_stock_checks
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin_or_gestor()
    OR (
      conferido_por_matricula = public.get_auth_promotor_matricula()
      AND EXISTS (
        SELECT 1 FROM public.visits v
        WHERE v.id = visit_id
          AND v.promotor_matricula = public.get_auth_promotor_matricula()
      )
    )
  );

CREATE POLICY "visit_sku_stock_update_policy" ON public.visit_sku_stock_checks
  FOR UPDATE TO authenticated
  USING (
    public.is_admin_or_gestor()
    OR (
      conferido_por_matricula = public.get_auth_promotor_matricula()
      AND EXISTS (
        SELECT 1 FROM public.visits v
        WHERE v.id = visit_id
          AND v.promotor_matricula = public.get_auth_promotor_matricula()
      )
    )
  )
  WITH CHECK (
    public.is_admin_or_gestor()
    OR conferido_por_matricula = public.get_auth_promotor_matricula()
  );

-- 7. POLÍTICAS RLS PARA visit_edits_audit_log (APPEND-ONLY)
CREATE POLICY "visit_edits_audit_select_policy" ON public.visit_edits_audit_log
  FOR SELECT TO authenticated
  USING (
    public.is_admin_or_gestor()
    OR altered_by_matricula = public.get_auth_promotor_matricula()
  );

CREATE POLICY "visit_edits_audit_insert_policy" ON public.visit_edits_audit_log
  FOR INSERT TO authenticated
  WITH CHECK (
    altered_by_user_id = auth.uid()
  );
