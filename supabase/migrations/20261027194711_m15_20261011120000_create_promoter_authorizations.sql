-- ==============================================================================
-- MK9 COMMAND CENTER - CONTROLE DE AUTORIZAÇÃO INDIVIDUAL POR PROMOTOR
-- Arquivo: supabase/migrations/20261011120000_create_promoter_authorizations.sql
-- Objetivo: Mecanismo explícito de autorização individual por promotor para
--           operação de teste/piloto durante o modo IMPLANTACAO, com trilha de
--           auditoria append-only permanente e proteção de visitas em campo.
-- ==============================================================================

-- 1. TABELA DE ESTADO ATUAL CONSOLIDADO DE AUTORIZAÇÃO
CREATE TABLE IF NOT EXISTS public.promoter_operation_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promotor_matricula text NOT NULL REFERENCES public.promotores(matricula) ON UPDATE CASCADE ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'liberado' CHECK (status IN ('liberado', 'bloqueado')),
  authorized_at timestamp with time zone NOT NULL DEFAULT now(),
  authorized_by uuid REFERENCES public.profiles(id) ON UPDATE CASCADE ON DELETE SET NULL,
  authorized_by_name text,
  authorized_by_email text,
  justification text NOT NULL,
  revoked_at timestamp with time zone,
  revoked_by uuid REFERENCES public.profiles(id) ON UPDATE CASCADE ON DELETE SET NULL,
  revoked_by_name text,
  revoked_by_email text,
  revocation_reason text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT promoter_authorizations_matricula_unique UNIQUE (promotor_matricula)
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_promoter_auth_matricula ON public.promoter_operation_authorizations(promotor_matricula);
CREATE INDEX IF NOT EXISTS idx_promoter_auth_status ON public.promoter_operation_authorizations(status);

-- 2. TABELA DE AUDITORIA PERMANENTE APPEND-ONLY (HISTÓRICO IMUTÁVEL)
CREATE TABLE IF NOT EXISTS public.promoter_operation_authorizations_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_at timestamp with time zone NOT NULL DEFAULT now(),
  promotor_matricula text NOT NULL REFERENCES public.promotores(matricula) ON UPDATE CASCADE ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('LIBERACAO', 'REVOGACAO')),
  previous_status text,
  new_status text NOT NULL,
  changed_by uuid REFERENCES public.profiles(id) ON UPDATE CASCADE ON DELETE SET NULL,
  changed_by_name text,
  changed_by_email text,
  justification text NOT NULL,
  created_at timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_promoter_auth_audit_matricula ON public.promoter_operation_authorizations_audit_log(promotor_matricula);
CREATE INDEX IF NOT EXISTS idx_promoter_auth_audit_event_at ON public.promoter_operation_authorizations_audit_log(event_at DESC);

-- Habilitar RLS
ALTER TABLE public.promoter_operation_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promoter_operation_authorizations_audit_log ENABLE ROW LEVEL SECURITY;

-- 3. POLÍTICAS RLS PARA promoter_operation_authorizations
-- Leitura:
-- - Admin, Gestor e Operador podem ler todas as autorizações
-- - Promotor pode ler apenas o próprio registro de autorização
DROP POLICY IF EXISTS "promoter_auth_select_policy" ON public.promoter_operation_authorizations;
CREATE POLICY "promoter_auth_select_policy"
  ON public.promoter_operation_authorizations
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin_or_gestor()
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'operador'
    OR promotor_matricula = public.get_auth_promotor_matricula()
  );

-- Inserção: apenas Admin e Gestor
DROP POLICY IF EXISTS "promoter_auth_insert_policy" ON public.promoter_operation_authorizations;
CREATE POLICY "promoter_auth_insert_policy"
  ON public.promoter_operation_authorizations
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin_or_gestor());

-- Atualização: apenas Admin e Gestor
DROP POLICY IF EXISTS "promoter_auth_update_policy" ON public.promoter_operation_authorizations;
CREATE POLICY "promoter_auth_update_policy"
  ON public.promoter_operation_authorizations
  FOR UPDATE
  TO authenticated
  USING (public.is_admin_or_gestor())
  WITH CHECK (public.is_admin_or_gestor());

-- Exclusão física: PROIBIDA para preservar o estado (sem política de DELETE)
DROP POLICY IF EXISTS "promoter_auth_write_policy" ON public.promoter_operation_authorizations;
DROP POLICY IF EXISTS "promoter_auth_delete_policy" ON public.promoter_operation_authorizations;

-- 4. POLÍTICAS RLS PARA promoter_operation_authorizations_audit_log
-- Leitura permitida para Admin e Gestor
DROP POLICY IF EXISTS "promoter_auth_audit_select_policy" ON public.promoter_operation_authorizations_audit_log;
CREATE POLICY "promoter_auth_audit_select_policy"
  ON public.promoter_operation_authorizations_audit_log
  FOR SELECT
  TO authenticated
  USING (public.is_admin_or_gestor());

-- Escrita direta PROIBIDA (exclusiva via RPC SECURITY DEFINER)
DROP POLICY IF EXISTS "promoter_auth_audit_block_direct_write" ON public.promoter_operation_authorizations_audit_log;
CREATE POLICY "promoter_auth_audit_block_direct_write"
  ON public.promoter_operation_authorizations_audit_log
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

-- 5. FUNÇÃO AUXILIAR DE VERIFICAÇÃO DE AUTORIZAÇÃO
CREATE OR REPLACE FUNCTION public.is_promotor_authorized(p_matricula text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mode text;
  v_is_auth boolean;
BEGIN
  -- Se a matrícula for nula ou vazia, não está autorizado
  IF p_matricula IS NULL OR trim(p_matricula) = '' THEN
    RETURN false;
  END IF;

  -- Obter modo atual da tabela system_settings (default: IMPLANTACAO)
  SELECT value INTO v_mode
  FROM public.system_settings
  WHERE key = 'operation_mode';

  -- Se o sistema já estiver em OPERACAO_OFICIAL, todos os promotores com matrícula operam normalmente
  IF v_mode = 'OPERACAO_OFICIAL' THEN
    RETURN true;
  END IF;

  -- Se estiver em IMPLANTACAO, verifica se existe autorização ativa com status 'liberado'
  SELECT EXISTS (
    SELECT 1
    FROM public.promoter_operation_authorizations
    WHERE promotor_matricula = p_matricula
      AND status = 'liberado'
  ) INTO v_is_auth;

  RETURN coalesce(v_is_auth, false);
END;
$$;

-- Privilégios de execução estritos
REVOKE ALL ON FUNCTION public.is_promotor_authorized(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_promotor_authorized(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_promotor_authorized(text) TO authenticated;

-- 6. REGRAS DE HARDENING DE INTEGRIDADE PARA public.visits E TABELAS FILHAS
-- 6.1 Atualizar a política visits_insert_policy em public.visits:
-- Garante que promotores só possam criar novas visitas se forem os donos da matrícula
-- E se estiverem autorizados individualmente (ou em operação oficial)
DROP POLICY IF EXISTS "visits_insert_policy" ON public.visits;
CREATE POLICY "visits_insert_policy"
  ON public.visits
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_admin_or_gestor()
    OR (
      promotor_matricula = public.get_auth_promotor_matricula()
      AND public.is_promotor_authorized(promotor_matricula)
    )
  );

-- 6.2 Trigger de Integridade para Bloqueio de Alteração de Campos Críticos em public.visits
-- Impede que chamadas REST diretas de promotores alterem loja, rota, data, matricula ou started_at
CREATE OR REPLACE FUNCTION public.check_visit_promotor_update_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_auth_matricula text;
BEGIN
  -- Se for Admin ou Gestor, permite alterações administrativas
  IF public.is_admin_or_gestor() THEN
    RETURN NEW;
  END IF;

  v_auth_matricula := public.get_auth_promotor_matricula();

  -- Se o usuário autenticado não possui matrícula vinculada, proíbe alteração
  IF v_auth_matricula IS NULL THEN
    RAISE EXCEPTION 'Acesso negado: Usuário sem matrícula de promotor vinculada.';
  END IF;

  -- Se a visita pertencer à matrícula autenticada do promotor
  IF OLD.promotor_matricula IS NOT NULL AND OLD.promotor_matricula = v_auth_matricula THEN
    -- 1. Proibir alteração de chave de rota, loja, indústria, matrícula, data e horário de início
    -- Utilizando consistentemente IS DISTINCT FROM para evitar bypass por valores NULL
    IF NEW.promotor_matricula IS DISTINCT FROM OLD.promotor_matricula THEN
      RAISE EXCEPTION 'Violação de segurança: Não é permitido alterar a matrícula da visita.';
    END IF;
    IF NEW.loja_codigo IS DISTINCT FROM OLD.loja_codigo THEN
      RAISE EXCEPTION 'Violação de segurança: Não é permitido alterar a loja da visita.';
    END IF;
    IF NEW.industria_codigo IS DISTINCT FROM OLD.industria_codigo THEN
      RAISE EXCEPTION 'Violação de segurança: Não é permitido alterar a indústria da visita.';
    END IF;
    IF NEW.rota_id IS DISTINCT FROM OLD.rota_id THEN
      RAISE EXCEPTION 'Violação de segurança: Não é permitido alterar o vínculo de rota da visita.';
    END IF;
    IF NEW.data_visita IS DISTINCT FROM OLD.data_visita THEN
      RAISE EXCEPTION 'Violação de segurança: Não é permitido alterar a data da visita.';
    END IF;
    IF NEW.started_at IS DISTINCT FROM OLD.started_at THEN
      RAISE EXCEPTION 'Violação de segurança: Não é permitido alterar o horário de início da visita.';
    END IF;

    -- 2. Proibir alteração ou reabertura de visita que já foi 'concluida'
    IF OLD.status = 'concluida' THEN
      RAISE EXCEPTION 'Operação negada: Visita já concluída não pode ser alterada pelo promotor.';
    END IF;

    -- 3. Proibir alteração de visita marcada como 'nao_realizada'
    IF OLD.status = 'nao_realizada' THEN
      RAISE EXCEPTION 'Operação negada: Visita justificada como não realizada não pode ser alterada pelo promotor.';
    END IF;

    -- 4. Controle estrito de transição de status para o promotor:
    -- O promotor só pode manter 'em_andamento' ou transitar para 'concluida' (checkout)
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NOT (OLD.status = 'em_andamento' AND NEW.status = 'concluida') THEN
        RAISE EXCEPTION 'Violação de segurança: Transição de status inválida para o promotor (de % para %).', OLD.status, NEW.status;
      END IF;
    END IF;

    -- 5. Validação de completed_at no checkout:
    -- Quando concluída, completed_at é obrigatório e não pode ser retroativo ao início
    IF NEW.status = 'concluida' THEN
      IF NEW.completed_at IS NULL THEN
        RAISE EXCEPTION 'Operação negada: Horário de conclusão (completed_at) é obrigatório ao concluir a visita.';
      END IF;
      IF OLD.started_at IS NOT NULL AND NEW.completed_at < OLD.started_at THEN
        RAISE EXCEPTION 'Violação de integridade: Horário de conclusão não pode ser anterior ao início da visita.';
      END IF;
    END IF;
  ELSE
    -- Se a visita não pertence ao promotor autenticado, proíbe mutação
    RAISE EXCEPTION 'Acesso negado: Você só pode atualizar visitas associadas à sua própria matrícula.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_visit_promotor_update_integrity ON public.visits;
CREATE TRIGGER trg_visit_promotor_update_integrity
  BEFORE UPDATE ON public.visits
  FOR EACH ROW
  EXECUTE FUNCTION public.check_visit_promotor_update_integrity();

-- 6.3 Hardening das Tabelas Filhas (Proteção contra inserção/alteração em visitas já concluídas)
-- a) visit_checklist_items: apenas visitas em andamento do próprio promotor
DROP POLICY IF EXISTS "visit_checklist_items_write_policy" ON public.visit_checklist_items;
CREATE POLICY "visit_checklist_items_write_policy"
  ON public.visit_checklist_items
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.visits v
      WHERE v.id = visit_checklist_items.visit_id
      AND (
        public.is_admin_or_gestor()
        OR (
          v.promotor_matricula = public.get_auth_promotor_matricula()
          AND v.status = 'em_andamento'
        )
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.visits v
      WHERE v.id = visit_checklist_items.visit_id
      AND (
        public.is_admin_or_gestor()
        OR (
          v.promotor_matricula = public.get_auth_promotor_matricula()
          AND v.status = 'em_andamento'
        )
      )
    )
  );

-- b) visit_photos: apenas visitas em andamento do próprio promotor
DROP POLICY IF EXISTS "visit_photos_write_policy" ON public.visit_photos;
CREATE POLICY "visit_photos_write_policy"
  ON public.visit_photos
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.visits v
      WHERE v.id = visit_photos.visit_id
      AND (
        public.is_admin_or_gestor()
        OR (
          v.promotor_matricula = public.get_auth_promotor_matricula()
          AND v.status = 'em_andamento'
        )
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.visits v
      WHERE v.id = visit_photos.visit_id
      AND (
        public.is_admin_or_gestor()
        OR (
          v.promotor_matricula = public.get_auth_promotor_matricula()
          AND v.status = 'em_andamento'
        )
      )
    )
  );

-- c) visit_occurrences: apenas visitas em andamento do próprio promotor
DROP POLICY IF EXISTS "visit_occurrences_write_policy" ON public.visit_occurrences;
CREATE POLICY "visit_occurrences_write_policy"
  ON public.visit_occurrences
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.visits v
      WHERE v.id = visit_occurrences.visit_id
      AND (
        public.is_admin_or_gestor()
        OR (
          v.promotor_matricula = public.get_auth_promotor_matricula()
          AND v.status = 'em_andamento'
        )
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.visits v
      WHERE v.id = visit_occurrences.visit_id
      AND (
        public.is_admin_or_gestor()
        OR (
          v.promotor_matricula = public.get_auth_promotor_matricula()
          AND v.status = 'em_andamento'
        )
      )
    )
  );

-- d) visit_product_validity: apenas visitas em andamento do próprio promotor
DROP POLICY IF EXISTS "visit_product_validity_write_policy" ON public.visit_product_validity;
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
        OR (
          v.promotor_matricula = public.get_auth_promotor_matricula()
          AND v.status = 'em_andamento'
        )
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.visits v
      WHERE v.id = visit_product_validity.visit_id
      AND (
        public.is_admin_or_gestor()
        OR (
          v.promotor_matricula = public.get_auth_promotor_matricula()
          AND v.status = 'em_andamento'
        )
      )
    )
  );

-- 7. FUNÇÃO RPC PARA LIBERAR/REVOGAR COM AUDITORIA APPEND-ONLY ATÔMICA
CREATE OR REPLACE FUNCTION public.set_promoter_authorization(
  p_matricula text,
  p_status text,
  p_justification text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id uuid;
  v_caller_profile record;
  v_promotor_exists boolean;
  v_clean_matricula text;
  v_clean_justification text;
  v_prev_status text;
  v_action text;
  v_result record;
BEGIN
  -- 1. Validação de Autorização do Chamador (apenas Admin ou Gestor)
  IF NOT public.is_admin_or_gestor() THEN
    RAISE EXCEPTION 'Acesso negado: apenas administradores e gestores podem autorizar ou revogar promotores.';
  END IF;

  -- 2. Validação de Status
  IF p_status NOT IN ('liberado', 'bloqueado') THEN
    RAISE EXCEPTION 'Status inválido. Utilize "liberado" ou "bloqueado".';
  END IF;

  -- 3. Validação da Matrícula Alvo
  v_clean_matricula := trim(coalesce(p_matricula, ''));
  IF v_clean_matricula = '' THEN
    RAISE EXCEPTION 'Matrícula do promotor não informada.';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.promotores
    WHERE matricula = v_clean_matricula
  ) INTO v_promotor_exists;

  IF NOT v_promotor_exists THEN
    RAISE EXCEPTION 'Promotor com a matrícula "%" não encontrado no cadastro.', v_clean_matricula;
  END IF;

  -- 4. Validação da Justificativa Operacional (Obrigatória, mínimo 5 caracteres)
  v_clean_justification := trim(coalesce(p_justification, ''));
  IF length(v_clean_justification) < 5 THEN
    RAISE EXCEPTION 'A justificativa operacional é obrigatória e deve ter pelo menos 5 caracteres.';
  END IF;

  -- 5. Identificação Segura do Chamador Autenticado a partir de auth.uid()
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Acesso negado: contexto de usuário não autenticado.';
  END IF;

  SELECT id, name, email INTO v_caller_profile
  FROM public.profiles
  WHERE id = v_caller_id;

  -- 6. Obter status anterior para histórico de auditoria
  SELECT status INTO v_prev_status
  FROM public.promoter_operation_authorizations
  WHERE promotor_matricula = v_clean_matricula;

  v_action := CASE WHEN p_status = 'liberado' THEN 'LIBERACAO' ELSE 'REVOGACAO' END;

  -- 7. Operação de Liberação ou Bloqueio no Estado Consolidado
  IF p_status = 'liberado' THEN
    INSERT INTO public.promoter_operation_authorizations (
      promotor_matricula,
      status,
      authorized_at,
      authorized_by,
      authorized_by_name,
      authorized_by_email,
      justification,
      revoked_at,
      revoked_by,
      revoked_by_name,
      revoked_by_email,
      revocation_reason,
      updated_at
    ) VALUES (
      v_clean_matricula,
      'liberado',
      now(),
      v_caller_id,
      v_caller_profile.name,
      v_caller_profile.email,
      v_clean_justification,
      NULL, NULL, NULL, NULL, NULL,
      now()
    )
    ON CONFLICT (promotor_matricula) DO UPDATE SET
      status = 'liberado',
      authorized_at = now(),
      authorized_by = v_caller_id,
      authorized_by_name = v_caller_profile.name,
      authorized_by_email = v_caller_profile.email,
      justification = v_clean_justification,
      revoked_at = NULL,
      revoked_by = NULL,
      revoked_by_name = NULL,
      revoked_by_email = NULL,
      revocation_reason = NULL,
      updated_at = now()
    RETURNING * INTO v_result;
  ELSE
    -- Bloquear / Revogar (preserva authorized_at e authorized_by originais se já existirem)
    INSERT INTO public.promoter_operation_authorizations (
      promotor_matricula,
      status,
      authorized_at,
      authorized_by,
      authorized_by_name,
      authorized_by_email,
      justification,
      revoked_at,
      revoked_by,
      revoked_by_name,
      revoked_by_email,
      revocation_reason,
      updated_at
    ) VALUES (
      v_clean_matricula,
      'bloqueado',
      now(),
      v_caller_id,
      v_caller_profile.name,
      v_caller_profile.email,
      'Bloqueio pré-operacional',
      now(),
      v_caller_id,
      v_caller_profile.name,
      v_caller_profile.email,
      v_clean_justification,
      now()
    )
    ON CONFLICT (promotor_matricula) DO UPDATE SET
      status = 'bloqueado',
      revoked_at = now(),
      revoked_by = v_caller_id,
      revoked_by_name = v_caller_profile.name,
      revoked_by_email = v_caller_profile.email,
      revocation_reason = v_clean_justification,
      updated_at = now()
    RETURNING * INTO v_result;
  END IF;

  -- 8. Inserção Atômica na Tabela de Auditoria Permanente (Append-Only)
  INSERT INTO public.promoter_operation_authorizations_audit_log (
    event_at,
    promotor_matricula,
    action,
    previous_status,
    new_status,
    changed_by,
    changed_by_name,
    changed_by_email,
    justification
  ) VALUES (
    now(),
    v_clean_matricula,
    v_action,
    v_prev_status,
    p_status,
    v_caller_id,
    v_caller_profile.name,
    v_caller_profile.email,
    v_clean_justification
  );

  RETURN jsonb_build_object(
    'success', true,
    'matricula', v_result.promotor_matricula,
    'status', v_result.status,
    'action', v_action,
    'updated_at', v_result.updated_at
  );
END;
$$;

-- Privilégios de execução estritos para a RPC
REVOKE ALL ON FUNCTION public.set_promoter_authorization(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_promoter_authorization(text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_promoter_authorization(text, text, text) TO authenticated;
