-- ==============================================================================
-- MK9 DATE - RECUPERAÇÃO INTEGRAL DE VISITAS PROGRAMADAS NA SEMANA
-- Migration: supabase/migrations/20261108100000_m37_integral_weekly_recovery.sql
-- Missão 37.52: Permite que múltiplas ocorrências programadas distintas da mesma
-- loja e indústria (ex: segunda, quarta, quinta) sejam recuperadas no mesmo dia efetivo.
-- Substitui a restrição genérica por loja/indústria/dia por uma restrição por ocorrência
-- programada única (promotor_matricula, rota_id, scheduled_date).
-- ==============================================================================

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- 1. Substituir a constraint rígida (promotor, loja, industria, data_visita)
-- por uma constraint com predicação ou índice único parcial que permita múltiplas
-- recuperações de datas programadas distintas no mesmo dia efetivo, mantendo a
-- proteção para visitas avulsas / regulares (onde scheduled_date IS NULL).

DO $$
BEGIN
  -- Se a constraint de tabela única existir, ajustamos para suportar múltiplas recuperações
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.visits'::regclass
      AND conname = 'visits_promotor_loja_industria_data_unique'
  ) THEN
    ALTER TABLE public.visits
      DROP CONSTRAINT visits_promotor_loja_industria_data_unique;
  END IF;
END $$;

-- Índice para visitas regulares/avulsas do dia (sem scheduled_date): apenas 1 por loja/indústria/dia
CREATE UNIQUE INDEX IF NOT EXISTS visits_regular_promoter_store_industry_date_unique
  ON public.visits (promotor_matricula, loja_codigo, industria_codigo, data_visita)
  WHERE scheduled_date IS NULL;

-- Índice para visitas programadas/recuperadas: garante que a mesma ocorrência programada
-- de uma rota nunca seja duplicada, independentemente de quando foi executada.
CREATE UNIQUE INDEX IF NOT EXISTS visits_promoter_route_scheduled_date_unique
  ON public.visits (promotor_matricula, rota_id, scheduled_date)
  WHERE scheduled_date IS NOT NULL AND rota_id IS NOT NULL;

-- 2. Atualização da RPC attendance_private.attendance_start_scheduled_occurrence
-- para não barrar outra ocorrência programada na mesma data efetiva quando a scheduled_date for distinta.

CREATE OR REPLACE FUNCTION attendance_private.attendance_start_scheduled_occurrence(
  p_route uuid,
  p_scheduled_date date,
  p_action text,
  p_lat numeric DEFAULT NULL,
  p_lng numeric DEFAULT NULL,
  p_accuracy numeric DEFAULT NULL
)
RETURNS public.visits
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_matricula text;
  v_today date;
  v_week_start date;
  v_week_end date;
  v_route public.rotas;
  v_work_schedule public.promoter_work_schedules;
  v_existing public.visits;
  v_today_visit public.visits;
  v_result public.visits;
  v_effective_date date;
  v_route_day_active boolean;
  v_operation_mode text;
  v_official_start_date text;
BEGIN
  SELECT p.promotor_matricula INTO v_matricula
  FROM public.profiles p
  WHERE p.id = auth.uid() AND p.role = 'promotor' AND p.status = 'ativo';
  IF v_matricula IS NULL THEN
    RAISE EXCEPTION 'Promoter identity required' USING ERRCODE = '42501';
  END IF;

  v_today := (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_effective_date := v_today;
  v_week_start := v_today - (extract(isodow FROM v_today)::integer - 1);
  v_week_end := v_week_start + 6;

  IF p_action IS NULL OR p_action NOT IN ('advance', 'recover') THEN
    RAISE EXCEPTION 'Invalid scheduled visit action' USING ERRCODE = '22023';
  END IF;
  IF p_route IS NULL OR p_scheduled_date IS NULL THEN
    RAISE EXCEPTION 'Route and scheduled date are required' USING ERRCODE = '22023';
  END IF;
  IF (p_action = 'advance' AND (p_scheduled_date <= v_today OR p_scheduled_date > v_week_end))
     OR (p_action = 'recover' AND (p_scheduled_date < v_week_start OR p_scheduled_date >= v_today)) THEN
    RAISE EXCEPTION 'Scheduled date is outside the recoverable current week' USING ERRCODE = '22023';
  END IF;

  -- Obter horário de trabalho
  SELECT s.* INTO v_work_schedule
  FROM public.promoter_work_schedules s
  CROSS JOIN LATERAL (
    SELECT (clock_timestamp() AT TIME ZONE s.timezone)::date
      - CASE
          WHEN s.hora_fim < s.hora_inicio
           AND (clock_timestamp() AT TIME ZONE s.timezone)::time < s.hora_fim THEN 1
          ELSE 0
        END AS operational_date
  ) local_day
  WHERE s.promotor_matricula = v_matricula
    AND s.ativo
    AND (s.valid_from IS NULL OR s.valid_from <= local_day.operational_date)
    AND (s.valid_to IS NULL OR s.valid_to >= local_day.operational_date)
    AND s.dia_semana = (ARRAY['domingo','segunda','terca','quarta','quinta','sexta','sabado'])[extract(dow FROM local_day.operational_date)::integer + 1]
  ORDER BY s.is_exception DESC, s.valid_from DESC NULLS LAST
  LIMIT 1;
  IF v_work_schedule.id IS NOT NULL THEN
    v_effective_date := (clock_timestamp() AT TIME ZONE v_work_schedule.timezone)::date
      - CASE
          WHEN v_work_schedule.hora_fim < v_work_schedule.hora_inicio
           AND (clock_timestamp() AT TIME ZONE v_work_schedule.timezone)::time < v_work_schedule.hora_fim THEN 1
          ELSE 0
        END;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_matricula, 1));

  -- Validar indústria ativa
  IF NOT EXISTS (
    SELECT 1 FROM public.industrias i
    JOIN public.rotas r ON r.industria_codigo = i.codigo
    WHERE r.id = p_route AND i.status = 'ativo'
  ) THEN
    RAISE EXCEPTION 'Industry is not active' USING ERRCODE = '42501';
  END IF;

  SELECT r.* INTO v_route
  FROM public.rotas r
  WHERE r.id = p_route AND r.promotor_matricula = v_matricula
    AND r.encerrada_em IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Route is not active or is outside promoter assignment' USING ERRCODE = '42501';
  END IF;

  v_route_day_active := CASE extract(dow FROM p_scheduled_date)::integer
    WHEN 0 THEN coalesce(v_route.domingo, false)
    WHEN 1 THEN coalesce(v_route.segunda, false)
    WHEN 2 THEN coalesce(v_route.terca, false)
    WHEN 3 THEN coalesce(v_route.quarta, false)
    WHEN 4 THEN coalesce(v_route.quinta, false)
    WHEN 5 THEN coalesce(v_route.sexta, false)
    WHEN 6 THEN coalesce(v_route.sabado, false)
  END;
  IF NOT coalesce(v_route_day_active, false) THEN
    RAISE EXCEPTION 'Route is not scheduled for that weekday' USING ERRCODE = '22023';
  END IF;
  IF upper(coalesce(v_route.frequencia, 'SEMANAL')) <> 'SEMANAL' THEN
    RAISE EXCEPTION 'Quinzenal occurrences require an authoritative server schedule before they can be advanced or recovered' USING ERRCODE = '22023';
  END IF;

  SELECT s.value #>> '{}' INTO v_operation_mode FROM public.system_settings s WHERE s.key = 'operation_mode';
  IF v_operation_mode = 'IMPLANTACAO'
     AND NOT public.is_promotor_authorized(v_matricula) THEN
    RAISE EXCEPTION 'Promoter not released for operation' USING ERRCODE = '42501';
  END IF;
  IF v_operation_mode = 'OPERACAO_OFICIAL' THEN
    SELECT s.value #>> '{}' INTO v_official_start_date FROM public.system_settings s WHERE s.key = 'official_start_date';
    IF v_official_start_date IS NULL OR v_official_start_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       OR p_scheduled_date < v_official_start_date::date THEN
      RAISE EXCEPTION 'Scheduled occurrence is before the official operation start' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- 1. Verifica se esta mesma ocorrência específica (scheduled_date) já foi recuperada
  IF EXISTS (
    SELECT 1 FROM public.visit_schedule_actions a
    WHERE a.promotor_matricula = v_matricula AND a.route_id = p_route
      AND a.scheduled_date = p_scheduled_date
  ) THEN
    RAISE EXCEPTION 'This scheduled occurrence was already advanced or recovered' USING ERRCODE = '23505';
  END IF;

  -- 2. Verifica se a ocorrência programada já possui linha em visits
  SELECT v.* INTO v_existing FROM public.visits v
  WHERE v.promotor_matricula = v_matricula AND v.rota_id = p_route
    AND (v.scheduled_date = p_scheduled_date OR (v.scheduled_date IS NULL AND v.data_visita = p_scheduled_date))
  ORDER BY v.created_at DESC NULLS LAST LIMIT 1 FOR UPDATE;

  IF FOUND AND (v_existing.status IN ('concluida', 'em_andamento')
    OR v_existing.started_at IS NOT NULL OR v_existing.completed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'This scheduled occurrence already has an execution' USING ERRCODE = '23505';
  END IF;

  IF FOUND AND v_existing.regularization_status IS NOT NULL THEN
    RAISE EXCEPTION 'This scheduled occurrence was already regularized' USING ERRCODE = '23505';
  END IF;

  IF FOUND AND (
    EXISTS (SELECT 1 FROM public.visit_checklist_items ci WHERE ci.visit_id = v_existing.id)
    OR EXISTS (SELECT 1 FROM public.visit_photos ph WHERE ph.visit_id = v_existing.id)
    OR EXISTS (SELECT 1 FROM public.visit_occurrences vo WHERE vo.visit_id = v_existing.id)
    OR EXISTS (SELECT 1 FROM public.visit_product_validity pv WHERE pv.visit_id = v_existing.id)
  ) THEN
    RAISE EXCEPTION 'This scheduled occurrence already has recorded evidence' USING ERRCODE = '23505';
  END IF;

  IF p_action = 'advance' AND FOUND AND v_existing.status = 'nao_realizada' THEN
    RAISE EXCEPTION 'A future occurrence already marked as not performed cannot be advanced' USING ERRCODE = '23505';
  END IF;

  IF p_action = 'recover' AND FOUND AND (v_existing.status IS NULL OR v_existing.status NOT IN ('pendente', 'nao_realizada')) THEN
    RAISE EXCEPTION 'Only a missed occurrence can be recovered' USING ERRCODE = '22023';
  END IF;

  -- 3. Nova Regra de Unicidade: Bloqueia somente se já houver outra visita da MESMA ocorrência programada hoje
  -- Permite que outras ocorrências (ex: segunda, quarta) sejam realizadas no mesmo dia efetivo
  SELECT v.* INTO v_today_visit FROM public.visits v
  WHERE v.promotor_matricula = v_matricula
    AND v.rota_id = p_route
    AND v.scheduled_date = p_scheduled_date
    AND v.data_visita = v_effective_date
  FOR UPDATE;

  IF FOUND AND (v_existing.id IS NULL OR v_today_visit.id IS DISTINCT FROM v_existing.id) THEN
    RAISE EXCEPTION 'This scheduled occurrence was already executed today' USING ERRCODE = '23505';
  END IF;

  -- Bloquear início se o promotor já estiver com atendimento em andamento
  IF EXISTS (
    SELECT 1 FROM public.visits v
    WHERE v.promotor_matricula = v_matricula
      AND v.status = 'em_andamento'
      AND v.regularization_status IS NULL
  ) THEN
    RAISE EXCEPTION 'Another visit is in progress' USING ERRCODE = '42501';
  END IF;

  -- Executar check-in ou atualizar visita pendente
  IF v_existing.id IS NOT NULL THEN
    UPDATE public.visits SET
      scheduled_date = p_scheduled_date,
      data_visita = v_effective_date,
      status = 'em_andamento',
      started_at = clock_timestamp(),
      latitude = p_lat,
      longitude = p_lng,
      gps_accuracy_meters = p_accuracy,
      work_schedule_id = v_work_schedule.id
    WHERE id = v_existing.id
      AND status IN ('pendente', 'nao_realizada')
      AND regularization_status IS NULL
      AND started_at IS NULL
      AND completed_at IS NULL
    RETURNING * INTO v_result;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'This scheduled occurrence changed before check-in' USING ERRCODE = '23505';
    END IF;
  ELSE
    INSERT INTO public.visits(
      promotor_matricula,
      loja_codigo,
      industria_codigo,
      data_visita,
      scheduled_date,
      rota_id,
      started_at,
      latitude,
      longitude,
      gps_accuracy_meters,
      status,
      work_schedule_id
    )
    VALUES (
      v_matricula,
      v_route.loja_codigo,
      v_route.industria_codigo,
      v_effective_date,
      p_scheduled_date,
      p_route,
      clock_timestamp(),
      p_lat,
      p_lng,
      p_accuracy,
      'em_andamento',
      v_work_schedule.id
    )
    RETURNING * INTO v_result;
  END IF;

  INSERT INTO public.visit_schedule_actions(route_id, visit_id, promotor_matricula, scheduled_date, action, performed_by)
  VALUES (p_route, v_result.id, v_matricula, p_scheduled_date, p_action, auth.uid());

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION attendance_private.attendance_start_scheduled_occurrence(uuid, date, text, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION attendance_private.attendance_start_scheduled_occurrence(uuid, date, text, numeric, numeric, numeric) TO authenticated;

COMMIT;
