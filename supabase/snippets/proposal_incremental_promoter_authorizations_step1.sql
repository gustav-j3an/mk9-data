-- ==============================================================================
-- PROPOSTA INCREMENTAL — ETAPA 1: INFRAESTRUTURA DA RPC DE AUTORIZAÇÃO
-- Arquivo: supabase/snippets/proposal_incremental_promoter_authorizations_step1.sql
-- Objetivo: Corrigir a ausência da RPC public.set_promoter_authorization no
--           Supabase remoto para viabilizar a tela de Permissões do MK9 Command Center,
--           SEM alterar as políticas RLS de visitas (public.visits) nem suas
--           tabelas filhas nesta etapa.
--
-- ATENÇÃO: ARQUIVO APENAS PARA REVISÃO TÉCNICA. NÃO EXECUTAR AUTOMATICAMENTE.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. TABELA DE ESTADO ATUAL CONSOLIDADO DE AUTORIZAÇÃO POR PROMOTOR
-- ------------------------------------------------------------------------------
-- Armazena o registro de status mais recente ('liberado' ou 'bloqueado')
-- por promotor_matricula.
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

-- Índices de consulta rápida
CREATE INDEX IF NOT EXISTS idx_promoter_auth_matricula ON public.promoter_operation_authorizations(promotor_matricula);
CREATE INDEX IF NOT EXISTS idx_promoter_auth_status ON public.promoter_operation_authorizations(status);

-- ------------------------------------------------------------------------------
-- 2. TABELA DE AUDITORIA PERMANENTE APPEND-ONLY (HISTÓRICO IMUTÁVEL)
-- ------------------------------------------------------------------------------
-- Registra todas as ações de concessão e revogação.
-- Inserções diretas de clientes autenticados são bloqueadas por RLS.
CREATE TABLE IF NOT EXISTS public.promoter_operation_authorizations_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_at timestamp with time zone NOT NULL DEFAULT now(),
  promotor_matricula text NOT NULL REFERENCES public.promotores(matricula) ON UPDATE CASCADE ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('LIBERACAO', 'REVOGACAO')),
  previous_status text,
  new_status text NOT NULL,
  changed_by uuid REFERENCES public.profiles(id) ON UPDATE CASCADE ON DELETE SET NULL,
  changed_by_name text,
  changed_by_email text,
  justification text NOT NULL,
  created_at timestamp with time zone DEFAULT now()
);

-- Índices para histórico de auditoria
CREATE INDEX IF NOT EXISTS idx_promoter_auth_audit_matricula ON public.promoter_operation_authorizations_audit_log(promotor_matricula);
CREATE INDEX IF NOT EXISTS idx_promoter_auth_audit_event_at ON public.promoter_operation_authorizations_audit_log(event_at DESC);

-- ------------------------------------------------------------------------------
-- 3. HABILITAR ROW LEVEL SECURITY (RLS)
-- ------------------------------------------------------------------------------
ALTER TABLE public.promoter_operation_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promoter_operation_authorizations_audit_log ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 4. POLÍTICAS DE RLS PARA public.promoter_operation_authorizations
-- ------------------------------------------------------------------------------
-- Leitura:
-- - Admin, Gestor e Operador podem visualizar todos os promotores
-- - Promotor pode visualizar apenas o próprio registro de autorização
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

-- Inserção direta via client restrita a Admin e Gestor (fallback para painel)
DROP POLICY IF EXISTS "promoter_auth_insert_policy" ON public.promoter_operation_authorizations;
CREATE POLICY "promoter_auth_insert_policy"
  ON public.promoter_operation_authorizations
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin_or_gestor());

-- Atualização direta via client restrita a Admin e Gestor
DROP POLICY IF EXISTS "promoter_auth_update_policy" ON public.promoter_operation_authorizations;
CREATE POLICY "promoter_auth_update_policy"
  ON public.promoter_operation_authorizations
  FOR UPDATE
  TO authenticated
  USING (public.is_admin_or_gestor())
  WITH CHECK (public.is_admin_or_gestor());

-- Exclusão física proibida para preservar integridade histórica
DROP POLICY IF EXISTS "promoter_auth_write_policy" ON public.promoter_operation_authorizations;
DROP POLICY IF EXISTS "promoter_auth_delete_policy" ON public.promoter_operation_authorizations;

-- ------------------------------------------------------------------------------
-- 5. POLÍTICAS DE RLS PARA public.promoter_operation_authorizations_audit_log
-- ------------------------------------------------------------------------------
-- Leitura exclusiva para Admin e Gestor
DROP POLICY IF EXISTS "promoter_auth_audit_select_policy" ON public.promoter_operation_authorizations_audit_log;
CREATE POLICY "promoter_auth_audit_select_policy"
  ON public.promoter_operation_authorizations_audit_log
  FOR SELECT
  TO authenticated
  USING (public.is_admin_or_gestor());

-- Escrita direta PROIBIDA para qualquer perfil (somente via RPC SECURITY DEFINER)
DROP POLICY IF EXISTS "promoter_auth_audit_block_direct_write" ON public.promoter_operation_authorizations_audit_log;
CREATE POLICY "promoter_auth_audit_block_direct_write"
  ON public.promoter_operation_authorizations_audit_log
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

-- Privilégios SQL explícitos para defesa em profundidade (impedir qualquer escrita/truncamento via client)
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
ON TABLE public.promoter_operation_authorizations_audit_log
FROM PUBLIC, anon, authenticated;

GRANT SELECT
ON TABLE public.promoter_operation_authorizations_audit_log
TO authenticated;

-- ------------------------------------------------------------------------------
-- 6. FUNÇÃO AUXILIAR DE VERIFICAÇÃO: public.is_promotor_authorized(matricula)
-- ------------------------------------------------------------------------------
-- Disponibilizada para consultas e validações internas.
-- Em OPERACAO_OFICIAL retorna sempre true.
-- Em IMPLANTACAO verifica se há registro 'liberado'.
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
  IF p_matricula IS NULL OR trim(p_matricula) = '' THEN
    RETURN false;
  END IF;

  SELECT value INTO v_mode
  FROM public.system_settings
  WHERE key = 'operation_mode';

  IF v_mode = 'OPERACAO_OFICIAL' THEN
    RETURN true;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.promoter_operation_authorizations
    WHERE promotor_matricula = p_matricula
      AND status = 'liberado'
  ) INTO v_is_auth;

  RETURN coalesce(v_is_auth, false);
END;
$$;

REVOKE ALL ON FUNCTION public.is_promotor_authorized(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_promotor_authorized(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_promotor_authorized(text) TO authenticated;

-- ------------------------------------------------------------------------------
-- 7. FUNÇÃO RPC: public.set_promoter_authorization(...)
-- ------------------------------------------------------------------------------
-- Função invocada pelo frontend (UsersPermissionsView.tsx)
-- Executa com privilégios SECURITY DEFINER para garantir a gravação simultânea
-- do status e da trilha de auditoria append-only.
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

  -- 4. Validação da Justificativa Operacional (mínimo 5 caracteres)
  v_clean_justification := trim(coalesce(p_justification, ''));
  IF length(v_clean_justification) < 5 THEN
    RAISE EXCEPTION 'A justificativa operacional é obrigatória e deve ter pelo menos 5 caracteres.';
  END IF;

  -- 5. Identificação Segura do Chamador Autenticado
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Acesso negado: contexto de usuário não autenticado.';
  END IF;

  SELECT id, name, email INTO v_caller_profile
  FROM public.profiles
  WHERE id = v_caller_id;

  -- 6. Obter status anterior
  SELECT status INTO v_prev_status
  FROM public.promoter_operation_authorizations
  WHERE promotor_matricula = v_clean_matricula;

  v_action := CASE WHEN p_status = 'liberado' THEN 'LIBERACAO' ELSE 'REVOGACAO' END;

  -- 7. Persistir estado consolidado
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

  -- 8. Registro atômico no Log de Auditoria Append-Only
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

REVOKE ALL ON FUNCTION public.set_promoter_authorization(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_promoter_authorization(text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_promoter_authorization(text, text, text) TO authenticated;

-- Notificar o PostgREST para recarregar o schema cache
NOTIFY pgrst, 'reload schema';
