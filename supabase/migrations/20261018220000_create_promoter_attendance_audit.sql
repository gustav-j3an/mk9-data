-- ==============================================================================
-- MK9 DATE - REGISTROS MANUAIS DE PRESENÇA COM TRILHA DE AUDITORIA
-- Arquivo: supabase/migrations/20261018220000_create_promoter_attendance_audit.sql
-- Objetivo:
--   1. Persistir ajustes manuais de presença sem alterar visits/telemetria original;
--   2. Registrar responsável, horário, valor anterior, valor novo e justificativa;
--   3. Restringir mutações a admin/gestor via RPC SECURITY DEFINER;
--   4. Incluir regras operacionais de fechamento em system_settings, sem inventar escalas.
-- ==============================================================================

BEGIN;

-- 1. Ampliar chaves permitidas de system_settings com regras de presença (JSON)
ALTER TABLE public.system_settings DROP CONSTRAINT IF EXISTS system_settings_valid_keys;
ALTER TABLE public.system_settings
  ADD CONSTRAINT system_settings_valid_keys CHECK (
    key IN ('operation_mode', 'official_start_date', 'attendance_rules')
  );

INSERT INTO public.system_settings (key, value, description)
VALUES (
  'attendance_rules',
  jsonb_build_object(
    'timezone', 'America/Sao_Paulo',
    'day_close_time', NULL,
    'late_tolerance_minutes', NULL,
    'expected_checkin_time', NULL,
    'geofence_radius_meters', NULL
  ),
  'Regras de fechamento e telemetria do Controle de Presença. expected_checkin_time nulo evita inventar horário de expediente.'
)
ON CONFLICT (key) DO NOTHING;

-- 2. Tabela de ajustes manuais (não substitui visits)
CREATE TABLE IF NOT EXISTS public.promoter_attendance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promotor_matricula TEXT NOT NULL REFERENCES public.promotores(matricula) ON DELETE CASCADE ON UPDATE CASCADE,
  data_operacional DATE NOT NULL,
  override_status TEXT NOT NULL CHECK (
    override_status IN ('presente', 'falta', 'atestado_pendente', 'atestado_aprovado', 'sem_registro')
  ),
  medical_days INTEGER CHECK (medical_days IS NULL OR (medical_days >= 1 AND medical_days <= 30)),
  justification TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (promotor_matricula, data_operacional)
);

CREATE INDEX IF NOT EXISTS idx_promoter_attendance_records_data
  ON public.promoter_attendance_records (data_operacional, promotor_matricula);

-- 3. Trilha de auditoria imutável pelo cliente
CREATE TABLE IF NOT EXISTS public.promoter_attendance_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id UUID REFERENCES public.promoter_attendance_records(id) ON DELETE SET NULL,
  promotor_matricula TEXT NOT NULL,
  data_operacional DATE NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_by_name TEXT,
  changed_by_email TEXT,
  previous_value JSONB,
  new_value JSONB NOT NULL,
  justification TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_promoter_attendance_audit_changed_at
  ON public.promoter_attendance_audit_log (changed_at DESC);

ALTER TABLE public.promoter_attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promoter_attendance_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "promoter_attendance_records_select" ON public.promoter_attendance_records;
CREATE POLICY "promoter_attendance_records_select"
  ON public.promoter_attendance_records
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin_or_gestor()
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'operador'
  );

DROP POLICY IF EXISTS "promoter_attendance_records_block_direct_write" ON public.promoter_attendance_records;
CREATE POLICY "promoter_attendance_records_block_direct_write"
  ON public.promoter_attendance_records
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "promoter_attendance_audit_select" ON public.promoter_attendance_audit_log;
CREATE POLICY "promoter_attendance_audit_select"
  ON public.promoter_attendance_audit_log
  FOR SELECT
  TO authenticated
  USING (public.is_admin_or_gestor());

DROP POLICY IF EXISTS "promoter_attendance_audit_block_direct_write" ON public.promoter_attendance_audit_log;
CREATE POLICY "promoter_attendance_audit_block_direct_write"
  ON public.promoter_attendance_audit_log
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

REVOKE ALL ON public.promoter_attendance_records FROM anon;
REVOKE ALL ON public.promoter_attendance_audit_log FROM anon;
GRANT SELECT ON public.promoter_attendance_records TO authenticated;
GRANT SELECT ON public.promoter_attendance_audit_log TO authenticated;

-- 4. RPC exclusiva para admin/gestor. Não altera visits nem coordenadas originais.
CREATE OR REPLACE FUNCTION public.set_promoter_attendance_override(
  p_promotor_matricula TEXT,
  p_data_operacional DATE,
  p_override_status TEXT,
  p_justification TEXT,
  p_medical_days INTEGER DEFAULT NULL
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
  v_role TEXT;
  v_clean_justification TEXT;
  v_previous JSONB;
  v_record_id UUID;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Acesso Negado: usuário não autenticado.';
  END IF;

  SELECT role, name, email
    INTO v_role, v_caller_name, v_caller_email
  FROM public.profiles
  WHERE id = v_caller_id;

  IF v_role IS NULL OR v_role NOT IN ('admin', 'gestor') OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = v_caller_id AND status = 'ativo'
  ) THEN
    RAISE EXCEPTION 'Acesso Negado: somente administrador ou gestor podem alterar presença.';
  END IF;

  IF p_promotor_matricula IS NULL OR length(trim(p_promotor_matricula)) = 0 THEN
    RAISE EXCEPTION 'Matrícula do promotor é obrigatória.';
  END IF;

  IF p_data_operacional IS NULL THEN
    RAISE EXCEPTION 'Data operacional é obrigatória.';
  END IF;

  IF p_override_status IS NULL OR p_override_status NOT IN (
    'presente', 'falta', 'atestado_pendente', 'atestado_aprovado', 'sem_registro'
  ) THEN
    RAISE EXCEPTION 'Status de ajuste inválido.';
  END IF;

  v_clean_justification := trim(COALESCE(p_justification, ''));
  IF length(v_clean_justification) < 5 THEN
    RAISE EXCEPTION 'Justificativa obrigatória (mínimo de 5 caracteres).';
  END IF;

  IF p_override_status IN ('atestado_pendente', 'atestado_aprovado') THEN
    IF p_medical_days IS NULL OR p_medical_days < 1 OR p_medical_days > 30 THEN
      RAISE EXCEPTION 'Informe a quantidade de dias do atestado.';
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.promotores WHERE matricula = p_promotor_matricula) THEN
    RAISE EXCEPTION 'Promotor não encontrado.';
  END IF;

  -- Serialize even the first INSERT, so concurrent changes retain the real old value.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_promotor_matricula || ':' || p_data_operacional::text, 0));

  SELECT to_jsonb(r) INTO v_previous
  FROM public.promoter_attendance_records r
  WHERE promotor_matricula = p_promotor_matricula
    AND data_operacional = p_data_operacional;

  INSERT INTO public.promoter_attendance_records (
    promotor_matricula,
    data_operacional,
    override_status,
    medical_days,
    justification,
    created_by,
    updated_by
  )
  VALUES (
    p_promotor_matricula,
    p_data_operacional,
    p_override_status,
    CASE WHEN p_override_status IN ('atestado_pendente', 'atestado_aprovado') THEN p_medical_days ELSE NULL END,
    v_clean_justification,
    v_caller_id,
    v_caller_id
  )
  ON CONFLICT (promotor_matricula, data_operacional) DO UPDATE
    SET override_status = EXCLUDED.override_status,
        medical_days = EXCLUDED.medical_days,
        justification = EXCLUDED.justification,
        updated_at = NOW(),
        updated_by = v_caller_id
  RETURNING id INTO v_record_id;

  INSERT INTO public.promoter_attendance_audit_log (
    record_id,
    promotor_matricula,
    data_operacional,
    changed_by,
    changed_by_name,
    changed_by_email,
    previous_value,
    new_value,
    justification
  )
  VALUES (
    v_record_id,
    p_promotor_matricula,
    p_data_operacional,
    v_caller_id,
    COALESCE(v_caller_name, 'Usuário MK9'),
    COALESCE(v_caller_email, ''),
    v_previous,
    jsonb_build_object(
      'override_status', p_override_status,
      'medical_days', CASE WHEN p_override_status IN ('atestado_pendente', 'atestado_aprovado') THEN p_medical_days ELSE NULL END,
      'justification', v_clean_justification
    ),
    v_clean_justification
  );

  RETURN jsonb_build_object(
    'success', true,
    'record_id', v_record_id,
    'promotor_matricula', p_promotor_matricula,
    'data_operacional', p_data_operacional,
    'override_status', p_override_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_promoter_attendance_override(TEXT, DATE, TEXT, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_promoter_attendance_override(TEXT, DATE, TEXT, TEXT, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_promoter_attendance_override(TEXT, DATE, TEXT, TEXT, INTEGER) TO authenticated;

COMMIT;
