-- ==============================================================================
-- MK9 COMMAND CENTER - INFRAESTRUTURA DE CONFIGURAÇÃO OPERACIONAL E AUDITORIA
-- Arquivo: supabase/migrations/20261010_create_system_settings_and_audit.sql
-- Descrição: Criação da tabela system_settings, system_settings_audit_log e RPC transacional
-- ==============================================================================

-- 1. TABELA DE CONFIGURAÇÕES GLOBAIS DO SISTEMA
CREATE TABLE IF NOT EXISTS public.system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id),
  CONSTRAINT system_settings_valid_keys CHECK (
    key IN ('operation_mode', 'official_start_date')
  )
);

-- Inserção idempotente dos valores iniciais seguros (Modo IMPLANTACAO)
INSERT INTO public.system_settings (key, value, description)
VALUES 
  ('operation_mode', '"IMPLANTACAO"'::jsonb, 'Modo operacional global: IMPLANTACAO ou OPERACAO_OFICIAL'),
  ('official_start_date', 'null'::jsonb, 'Data de início oficial das atividades operacionais (YYYY-MM-DD)')
ON CONFLICT (key) DO NOTHING;

-- 2. TABELA DE TRILHA DE AUDITORIA DE CONFIGURAÇÕES OPERACIONAIS
CREATE TABLE IF NOT EXISTS public.system_settings_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changed_by UUID REFERENCES auth.users(id),
  changed_by_name TEXT,
  changed_by_email TEXT,
  previous_mode TEXT NOT NULL,
  new_mode TEXT NOT NULL,
  previous_start_date DATE,
  new_start_date DATE,
  justification TEXT NOT NULL
);

-- Criar índice para ordenação rápida do histórico de auditoria
CREATE INDEX IF NOT EXISTS idx_system_settings_audit_log_changed_at 
  ON public.system_settings_audit_log (changed_at DESC);

-- 3. HABILITAR ROW LEVEL SECURITY (RLS)
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings_audit_log ENABLE ROW LEVEL SECURITY;

-- 3.1 POLÍTICAS PARA system_settings
-- Leitura permitida para todos os usuários autenticados da plataforma
DROP POLICY IF EXISTS "system_settings_select_authenticated" ON public.system_settings;
CREATE POLICY "system_settings_select_authenticated"
  ON public.system_settings
  FOR SELECT
  TO authenticated
  USING (true);

-- Bloqueio rigoroso de modificações diretas (INSERT, UPDATE, DELETE) por clientes
-- A escrita é permitida EXCLUSIVAMENTE via função RPC SECURITY DEFINER
DROP POLICY IF EXISTS "system_settings_block_direct_insert" ON public.system_settings;
CREATE POLICY "system_settings_block_direct_insert"
  ON public.system_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (false);

DROP POLICY IF EXISTS "system_settings_block_direct_update" ON public.system_settings;
CREATE POLICY "system_settings_block_direct_update"
  ON public.system_settings
  FOR UPDATE
  TO authenticated
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "system_settings_block_direct_delete" ON public.system_settings;
CREATE POLICY "system_settings_block_direct_delete"
  ON public.system_settings
  FOR DELETE
  TO authenticated
  USING (false);

-- 3.2 POLÍTICAS PARA system_settings_audit_log
-- Leitura permitida apenas para Admin e Gestor
DROP POLICY IF EXISTS "system_settings_audit_select_admin_gestor" ON public.system_settings_audit_log;
CREATE POLICY "system_settings_audit_select_admin_gestor"
  ON public.system_settings_audit_log
  FOR SELECT
  TO authenticated
  USING (public.is_admin_or_gestor());

-- Bloqueio rigoroso de modificação direta do log de auditoria
DROP POLICY IF EXISTS "system_settings_audit_block_direct_write" ON public.system_settings_audit_log;
CREATE POLICY "system_settings_audit_block_direct_write"
  ON public.system_settings_audit_log
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

-- 4. FUNÇÃO RPC TRANSACIONAL ATÔMICA PARA ALTERAÇÃO DO MODO OPERACIONAL
CREATE OR REPLACE FUNCTION public.set_operation_mode(
  p_new_mode TEXT,
  p_official_start_date DATE DEFAULT NULL,
  p_justification TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_name TEXT;
  v_caller_email TEXT;
  v_prev_mode TEXT;
  v_prev_start_date DATE;
  v_clean_justification TEXT;
  v_target_start_date DATE;
BEGIN
  -- 1. Obter identificador do usuário autenticado no contexto
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Acesso Negado: Usuário não autenticado.';
  END IF;

  -- 2. Validar perfil ADMIN no banco de dados
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso Negado: Apenas administradores podem alterar configurações operacionais do sistema.';
  END IF;

  -- 3. Validar novo modo operacional informado
  IF p_new_mode IS NULL OR p_new_mode NOT IN ('IMPLANTACAO', 'OPERACAO_OFICIAL') THEN
    RAISE EXCEPTION 'Parâmetro inválido: p_new_mode deve ser IMPLANTACAO ou OPERACAO_OFICIAL.';
  END IF;

  -- 4. Validar justificativa (obrigatória para qualquer alteração de estado)
  v_clean_justification := trim(COALESCE(p_justification, ''));
  IF length(v_clean_justification) < 5 THEN
    RAISE EXCEPTION 'Justificativa obrigatória: Informe o motivo da alteração (mínimo de 5 caracteres).';
  END IF;

  -- 5. Validar data oficial de início conforme o modo
  IF p_new_mode = 'OPERACAO_OFICIAL' THEN
    IF p_official_start_date IS NULL THEN
      RAISE EXCEPTION 'Validação falhou: A data oficial de início é obrigatória para ativar OPERACAO_OFICIAL.';
    END IF;
    v_target_start_date := p_official_start_date;
  ELSE
    -- Modo IMPLANTACAO: data pode ser nula ou opcionalmente mantida se informada
    v_target_start_date := p_official_start_date;
  END IF;

  -- 6. Obter valores atuais para auditoria comparativa
  SELECT trim(both '"' from value::text) INTO v_prev_mode
  FROM public.system_settings
  WHERE key = 'operation_mode';

  SELECT NULLIF(trim(both '"' from value::text), 'null')::date INTO v_prev_start_date
  FROM public.system_settings
  WHERE key = 'official_start_date';

  -- Valores padrão caso a tabela ainda não tivesse as linhas
  v_prev_mode := COALESCE(v_prev_mode, 'IMPLANTACAO');

  -- 7. Obter dados do administrador para o registro de auditoria
  SELECT name, email INTO v_caller_name, v_caller_email
  FROM public.profiles
  WHERE id = v_caller_id;

  v_caller_name := COALESCE(v_caller_name, 'Administrador');
  v_caller_email := COALESCE(v_caller_email, 'admin@mk9.com.br');

  -- 8. Execução Transacional Atômica (se qualquer step falhar, tudo sofrerá rollback)
  -- 8.1 Atualizar operation_mode
  INSERT INTO public.system_settings (key, value, updated_at, updated_by)
  VALUES ('operation_mode', to_jsonb(p_new_mode), NOW(), v_caller_id)
  ON CONFLICT (key) DO UPDATE
    SET value = to_jsonb(p_new_mode),
        updated_at = NOW(),
        updated_by = v_caller_id;

  -- 8.2 Atualizar official_start_date
  IF v_target_start_date IS NOT NULL THEN
    INSERT INTO public.system_settings (key, value, updated_at, updated_by)
    VALUES ('official_start_date', to_jsonb(to_char(v_target_start_date, 'YYYY-MM-DD')), NOW(), v_caller_id)
    ON CONFLICT (key) DO UPDATE
      SET value = to_jsonb(to_char(v_target_start_date, 'YYYY-MM-DD')),
          updated_at = NOW(),
          updated_by = v_caller_id;
  ELSE
    INSERT INTO public.system_settings (key, value, updated_at, updated_by)
    VALUES ('official_start_date', 'null'::jsonb, NOW(), v_caller_id)
    ON CONFLICT (key) DO UPDATE
      SET value = 'null'::jsonb,
          updated_at = NOW(),
          updated_by = v_caller_id;
  END IF;

  -- 8.3 Registrar na tabela de auditoria permanente
  INSERT INTO public.system_settings_audit_log (
    changed_at,
    changed_by,
    changed_by_name,
    changed_by_email,
    previous_mode,
    new_mode,
    previous_start_date,
    new_start_date,
    justification
  ) VALUES (
    NOW(),
    v_caller_id,
    v_caller_name,
    v_caller_email,
    v_prev_mode,
    p_new_mode,
    v_prev_start_date,
    v_target_start_date,
    v_clean_justification
  );

  -- 9. Retornar payload com o novo estado consolidado
  RETURN jsonb_build_object(
    'success', true,
    'operation_mode', p_new_mode,
    'official_start_date', v_target_start_date,
    'changed_at', NOW(),
    'changed_by', v_caller_email
  );
END;
$$;

-- 5. AJUSTAR PRIVILÉGIOS DE EXECUÇÃO DA RPC
REVOKE ALL ON FUNCTION public.set_operation_mode(TEXT, DATE, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_operation_mode(TEXT, DATE, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_operation_mode(TEXT, DATE, TEXT) TO authenticated;
