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

-- 8. FUNÇÃO RPC ATÔMICA E SEGURA PARA SALVAR EDIÇÃO DE VISITA COM AUDITORIA (RC1.25)
CREATE OR REPLACE FUNCTION public.save_completed_visit_edit(
  p_visit_id UUID,
  p_observacao_geral TEXT,
  p_checklist_items JSONB,
  p_reason TEXT,
  p_changes_summary JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_visit public.visits%ROWTYPE;
  v_caller_uid UUID;
  v_caller_role TEXT;
  v_caller_matricula TEXT;
  v_item RECORD;
BEGIN
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'Acesso não autenticado' USING ERRCODE = '42501';
  END IF;

  -- Obter role e matrícula do usuário autenticado
  SELECT role, promotor_matricula
  INTO v_caller_role, v_caller_matricula
  FROM public.profiles
  WHERE id = v_caller_uid AND status = 'ativo';

  IF v_caller_role IS NULL THEN
    RAISE EXCEPTION 'Perfil de usuário não encontrado ou inativo' USING ERRCODE = '42501';
  END IF;

  -- Obter a visita existente com lock pessimista
  SELECT *
  INTO v_visit
  FROM public.visits
  WHERE id = p_visit_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Visita % não encontrada', p_visit_id USING ERRCODE = 'P0002';
  END IF;

  -- Validação estrita: somente visitas com status concluida podem ser editadas
  IF v_visit.status <> 'concluida' THEN
    RAISE EXCEPTION 'Apenas visitas concluídas podem ter seus dados revisados neste fluxo' USING ERRCODE = '42501';
  END IF;

  -- Validação estrita de posse / permissão: apenas o promotor titular ou admin/gestor
  IF v_caller_role NOT IN ('admin', 'gestor') AND (v_caller_matricula IS NULL OR v_caller_matricula <> v_visit.promotor_matricula) THEN
    RAISE EXCEPTION 'Você só pode editar visitas realizadas por você mesmo' USING ERRCODE = '42501';
  END IF;

  -- Validação de justificativa obrigatória
  IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'Justificativa de ajuste é obrigatória (mínimo de 5 caracteres)' USING ERRCODE = '23514';
  END IF;

  -- 1. Atualizar campos operacionais em visits (observacao_geral)
  -- Preserva estritamente: loja_codigo, industria_codigo, promotor_matricula, started_at, completed_at, status
  IF p_observacao_geral IS NOT NULL THEN
    UPDATE public.visits
    SET observacao_geral = trim(p_observacao_geral),
        updated_at = clock_timestamp()
    WHERE id = p_visit_id;
  END IF;

  -- 2. Atualizar ou inserir itens de checklist fornecidos no payload atômico
  IF p_checklist_items IS NOT NULL AND jsonb_typeof(p_checklist_items) = 'array' THEN
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_checklist_items) AS x(
      item_key TEXT,
      item_label TEXT,
      valor_texto TEXT,
      observacao TEXT
    )
    LOOP
      INSERT INTO public.visit_checklist_items (
        visit_id,
        item_key,
        item_label,
        valor_texto,
        observacao
      )
      VALUES (
        p_visit_id,
        v_item.item_key,
        COALESCE(v_item.item_label, v_item.item_key),
        trim(COALESCE(v_item.valor_texto, '')),
        trim(COALESCE(v_item.observacao, ''))
      )
      ON CONFLICT (visit_id, item_key)
      DO UPDATE SET
        valor_texto = EXCLUDED.valor_texto,
        observacao = EXCLUDED.observacao,
        updated_at = clock_timestamp();
    END LOOP;
  END IF;

  -- 3. Registrar OBRIGATORIAMENTE no log de auditoria na mesma transação atômica
  INSERT INTO public.visit_edits_audit_log (
    visit_id,
    altered_by_user_id,
    altered_by_matricula,
    field_name,
    old_value,
    new_value,
    reason
  )
  VALUES (
    p_visit_id,
    v_caller_uid,
    COALESCE(v_caller_matricula, 'admin'),
    'completed_visit_edit',
    jsonb_build_object('observacao_geral', v_visit.observacao_geral),
    COALESCE(p_changes_summary, '{}'::jsonb),
    trim(p_reason)
  );

  RETURN jsonb_build_object(
    'success', true,
    'visit_id', p_visit_id,
    'edited_at', clock_timestamp()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.save_completed_visit_edit(UUID, TEXT, JSONB, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_completed_visit_edit(UUID, TEXT, JSONB, TEXT, JSONB) TO authenticated;
