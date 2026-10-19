-- ==============================================================================
-- MK9 DATE - FOLGAS, EXPEDIENTES E PROGRAMAÇÃO DE TRABALHO
-- Arquivo: supabase/migrations/20261018230000_create_promoter_schedules_and_absences.sql
-- Objetivo:
--   1. Tabela de folgas programadas (vacation, ferias, afastamento)
--   2. Tabela de expedientes (horários de trabalho por promotor)
--   3. Suporte a diferentes tipos de ausência com data início/fim
--   4. Integração com regras de presença para diferenciar folga de falta
-- ==============================================================================

BEGIN;

-- 1. TABELA DE FOLGAS E AFASTAMENTOS (promoter_absences)
-- Armazena folgas programadas, férias, licenças médicas, afastamentos, etc.
CREATE TABLE IF NOT EXISTS public.promoter_absences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promotor_matricula TEXT NOT NULL REFERENCES public.promotores(matricula) ON DELETE CASCADE ON UPDATE CASCADE,
  tipo TEXT NOT NULL CHECK (
    tipo IN ('folga', 'ferias', 'licenca_medica', 'afastamento', 'licenca_paternidade', 'outro')
  ),
  data_inicio DATE NOT NULL,
  data_fim DATE NOT NULL,
  motivo TEXT,
  justificativa TEXT,
  aprovado_por TEXT, -- Nome ou matrícula do aprovador
  data_aprovacao DATE,
  observacao TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Constraint: data_fim >= data_inicio
  CONSTRAINT absences_date_range CHECK (data_fim >= data_inicio)
);

-- Índices para consultas de folgas por período e promotor
CREATE INDEX IF NOT EXISTS idx_promoter_absences_matricula ON public.promoter_absences (promotor_matricula);
CREATE INDEX IF NOT EXISTS idx_promoter_absences_periodo ON public.promoter_absences (data_inicio, data_fim);
CREATE INDEX IF NOT EXISTS idx_promoter_absences_tipo ON public.promoter_absences (tipo);

-- 2. TABELA DE EXPEDIENTES (promoter_work_schedules)
-- Define horários de trabalho padrão por promotor (opcional, para validação de atrasos)
CREATE TABLE IF NOT EXISTS public.promoter_work_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promotor_matricula TEXT NOT NULL REFERENCES public.promotores(matricula) ON DELETE CASCADE ON UPDATE CASCADE,
  dia_semana TEXT NOT NULL CHECK (
    dia_semana IN ('segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo')
  ),
  hora_inicio TIME NOT NULL,
  hora_fim TIME NOT NULL,
  observacao TEXT,
  ativo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraint: hora_fim > hora_inicio
  CONSTRAINT schedule_time_range CHECK (hora_fim <> hora_inicio),

  -- Unicidade: um promotor não pode ter dois expedientes no mesmo dia da semana
  CONSTRAINT unique_schedule_per_day UNIQUE (promotor_matricula, dia_semana)
);

-- Índices para consultas de expedientes
CREATE INDEX IF NOT EXISTS idx_promoter_work_schedules_matricula ON public.promoter_work_schedules (promotor_matricula);
CREATE INDEX IF NOT EXISTS idx_promoter_work_schedules_dia ON public.promoter_work_schedules (dia_semana);

-- 3. TRIGGER PARA ATUALIZAÇÃO AUTOMÁTICA DE updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_absences_updated_at ON public.promoter_absences;
CREATE TRIGGER trigger_absences_updated_at
  BEFORE UPDATE ON public.promoter_absences
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at_trigger();

DROP TRIGGER IF EXISTS trigger_schedules_updated_at ON public.promoter_work_schedules;
CREATE TRIGGER trigger_schedules_updated_at
  BEFORE UPDATE ON public.promoter_work_schedules
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at_trigger();

-- 4. CONFIGURAÇÃO DE SEGURANÇA E POLÍTICAS RLS
ALTER TABLE public.promoter_absences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promoter_work_schedules ENABLE ROW LEVEL SECURITY;

-- Hardening de privilégios SQL
REVOKE ALL ON TABLE public.promoter_absences FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.promoter_absences TO authenticated;
GRANT ALL ON TABLE public.promoter_absences TO service_role;

REVOKE ALL ON TABLE public.promoter_work_schedules FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.promoter_work_schedules TO authenticated;
GRANT ALL ON TABLE public.promoter_work_schedules TO service_role;

-- Políticas RLS para promoter_absences
DROP POLICY IF EXISTS "absences_select_policy" ON public.promoter_absences;
DROP POLICY IF EXISTS "absences_write_policy" ON public.promoter_absences;

-- Leitura: Admin/Gestor/Operador leem todos; Promotor lê somente suas próprias folgas
CREATE POLICY "absences_select_policy"
  ON public.promoter_absences
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin_or_gestor()
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'operador'
    OR promotor_matricula = public.get_auth_promotor_matricula()
  );

-- Escrita: Apenas Admin e Gestor podem criar/modificar folgas
CREATE POLICY "absences_write_policy"
  ON public.promoter_absences
  FOR ALL
  TO authenticated
  USING (public.is_admin_or_gestor())
  WITH CHECK (public.is_admin_or_gestor());

-- Políticas RLS para promoter_work_schedules
DROP POLICY IF EXISTS "schedules_select_policy" ON public.promoter_work_schedules;
DROP POLICY IF EXISTS "schedules_write_policy" ON public.promoter_work_schedules;

-- Leitura: Admin/Gestor/Operador leem todos; Promotor lê somente seus próprios expedientes
CREATE POLICY "schedules_select_policy"
  ON public.promoter_work_schedules
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin_or_gestor()
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'operador'
    OR promotor_matricula = public.get_auth_promotor_matricula()
  );

-- Escrita: Apenas Admin e Gestor podem criar/modificar expedientes
CREATE POLICY "schedules_write_policy"
  ON public.promoter_work_schedules
  FOR ALL
  TO authenticated
  USING (public.is_admin_or_gestor())
  WITH CHECK (public.is_admin_or_gestor());

-- 5. FUNÇÃO RPC PARA VERIFICAR SE PROMOTOR ESTÁ DE FOLGA EM UMA DATA
CREATE OR REPLACE FUNCTION public.is_promoter_on_absence(
  p_promotor_matricula TEXT,
  p_data DATE
)
RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'tipo', tipo,
        'data_inicio', data_inicio,
        'data_fim', data_fim,
        'motivo', motivo
      )
    ),
    '[]'::jsonb
  )
  FROM public.promoter_absences
  WHERE promotor_matricula = p_promotor_matricula
    AND p_data BETWEEN data_inicio AND data_fim;
$$;

REVOKE ALL ON FUNCTION public.is_promoter_on_absence(TEXT, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_promoter_on_absence(TEXT, DATE) TO authenticated, service_role;

-- 6. FUNÇÃO RPC PARA OBTER EXPEDIENTE DE UM PROMOTOR EM UM DIA DA SEMANA
CREATE OR REPLACE FUNCTION public.get_promoter_schedule(
  p_promotor_matricula TEXT,
  p_dia_semana TEXT
)
RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'dia_semana', dia_semana,
        'hora_inicio', hora_inicio,
        'hora_fim', hora_fim,
        'observacao', observacao,
        'ativo', ativo
      )
    ),
    '[]'::jsonb
  )
  FROM public.promoter_work_schedules
  WHERE promotor_matricula = p_promotor_matricula
    AND dia_semana = p_dia_semana
    AND ativo = TRUE;
$$;

REVOKE ALL ON FUNCTION public.get_promoter_schedule(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_promoter_schedule(TEXT, TEXT) TO authenticated, service_role;

COMMIT;
