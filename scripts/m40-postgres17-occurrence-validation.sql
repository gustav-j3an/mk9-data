\set ON_ERROR_STOP on

BEGIN;

-- Synthetic-only RC1.25.64 regression. All fixtures, recovery, checkout, and
-- assertions are rolled back at the end of this script.
DO $$
DECLARE
  v_user uuid := 'e6400000-0000-4000-8000-000000000040';
  v_route uuid := 'e6400000-0000-4000-8000-000000000041';
  v_route_other uuid := 'e6400000-0000-4000-8000-000000000042';
  v_thursday_root uuid := 'e6400000-0000-4000-8000-000000000043';
  v_friday_visit uuid := 'e6400000-0000-4000-8000-000000000044';
  v_thursday_root_other uuid := 'e6400000-0000-4000-8000-000000000046';
  v_recovered public.visits;
  v_checked_out public.visits;
  v_matricula text := 'M40_SYNTHETIC_PROMOTER';
  v_store text := 'M40_SYNTHETIC_STORE';
  v_industry text := 'M40_SYNTHETIC_INDUSTRY';
  v_thursday date := (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date - 1;
  v_friday date := (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_error text;
  v_photo_count integer;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_user, v_user::text || '@example.invalid');
  INSERT INTO public.promotores (matricula, nome, cidade, uf)
    VALUES (v_matricula, 'Synthetic M40 Promoter', 'Cidade de teste', 'SP');
  UPDATE public.profiles SET role = 'promotor', status = 'ativo', promotor_matricula = v_matricula
    WHERE id = v_user;
  INSERT INTO public.promoter_operation_authorizations (promotor_matricula, justification)
    VALUES (v_matricula, 'synthetic M40 recovery fixture authorization');
  INSERT INTO public.industrias (codigo, nome) VALUES (v_industry, 'Synthetic M40 Industry');
  INSERT INTO public.lojas (codigo, nome, cidade, uf) VALUES (v_store, 'Synthetic M40 Store', 'Cidade de teste', 'SP');
  INSERT INTO public.lojas (codigo, nome, cidade, uf)
    VALUES (v_store || '_OTHER', 'Synthetic M40 Other Store', 'Cidade de teste', 'SP');
  INSERT INTO public.rotas (
    id, codigo_rota, promotor_matricula, loja_codigo, industria_codigo,
    quinta, sexta
  ) VALUES
    (v_route, 'M40_SYNTHETIC_THU', v_matricula, v_store, v_industry, true, true),
    (v_route_other, 'M40_SYNTHETIC_OTHER', v_matricula, v_store || '_OTHER', v_industry, true, true);
  INSERT INTO public.visits (
    id, promotor_matricula, loja_codigo, industria_codigo, data_visita, scheduled_date,
    rota_id, started_at, completed_at, status, attempt_number
  ) VALUES
    (v_friday_visit, v_matricula, v_store, v_industry, v_friday, v_friday,
     v_route, clock_timestamp() - interval '2 hours', clock_timestamp() - interval '1 hour', 'concluida', 1),
    (v_thursday_root, v_matricula, v_store, v_industry, v_thursday, v_thursday,
     v_route, clock_timestamp() - interval '1 day', NULL, 'nao_realizada', 1),
    (v_thursday_root_other, v_matricula, v_store || '_OTHER', v_industry, v_thursday, v_thursday,
     v_route_other, clock_timestamp() - interval '1 day', NULL, 'nao_realizada', 1);
  INSERT INTO public.visit_lifecycle_audit (
    visit_id, promotor_matricula, action, visit_status_before, visit_status_after,
    actor_type, actor_id, reason, evidence_refs
  ) VALUES (
    v_thursday_root, v_matricula, 'promoter_cancelled', 'em_andamento', 'nao_realizada',
    'promoter', v_user, 'synthetic M40 cancellation evidence', '["m40-synthetic"]'::jsonb
  ), (
    v_thursday_root_other, v_matricula, 'promoter_cancelled', 'em_andamento', 'nao_realizada',
    'promoter', v_user, 'synthetic second occurrence cancellation', '[]'::jsonb
  );
  INSERT INTO public.visit_photos (visit_id, tipo_foto, storage_path, file_url, legenda)
    VALUES (v_thursday_root, 'fachada', 'm40/synthetic-thursday.jpg',
      'https://example.invalid/m40/synthetic-thursday.jpg', 'Evidence to preserve');

END;
$$;

-- The lab restore omits ACLs; supply only the wrapper schema visibility needed
-- to call public RPCs. This grant is transaction-scoped and rolled back below.
GRANT USAGE ON SCHEMA attendance_private TO authenticated;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = 'e6400000-0000-4000-8000-000000000040';
SET LOCAL "request.jwt.claim.role" = 'authenticated';

DO $$
DECLARE
  v_route uuid := 'e6400000-0000-4000-8000-000000000041';
  v_route_other uuid := 'e6400000-0000-4000-8000-000000000042';
  v_thursday_root uuid := 'e6400000-0000-4000-8000-000000000043';
  v_thursday date := (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date - 1;
  v_friday date := (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_recovered public.visits;
  v_checked_out public.visits;
  v_error text;
  v_photo_count integer;
BEGIN

  -- Real scheduled-occurrence RPC: a completed Friday attendance must not
  -- suppress the distinct pending Thursday occurrence at the same store.
  v_recovered := public.attendance_start_scheduled_occurrence(
    v_route, v_thursday, 'recover', NULL, NULL, NULL
  );
  IF v_recovered.id IS NULL OR v_recovered.status <> 'em_andamento'
     OR v_recovered.scheduled_date <> v_thursday
     OR v_recovered.data_visita <> v_friday
     OR v_recovered.occurrence_root_visit_id <> v_thursday_root
     OR v_recovered.attempt_number <> 2 THEN
    RAISE EXCEPTION 'M40 failed to recover the distinct Thursday occurrence alongside Friday completion';
  END IF;

  -- Complete by the actual checkout RPC; no direct UPDATE of public.visits.
  v_checked_out := public.attendance_check_out(v_recovered.id, NULL, NULL, NULL, 'synthetic M40 checkout');
  IF v_checked_out.status <> 'concluida' OR v_checked_out.completed_at IS NULL THEN
    RAISE EXCEPTION 'Actual attendance_check_out RPC did not complete the recovered attempt';
  END IF;
  RAISE NOTICE 'PASS: Friday completed + Thursday pending; recovery and actual checkout RPC; prior photo/audit preserved.';

  -- A second recovery of the completed Thursday occurrence must be rejected.
  BEGIN
    PERFORM public.attendance_start_scheduled_occurrence(v_route, v_thursday, 'recover', NULL, NULL, NULL);
    RAISE EXCEPTION 'M40 allowed a second recovery of the completed Thursday occurrence';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS: completed Thursday occurrence cannot be recovered twice: %', SQLERRM;
  END;

  -- A different cancelled occurrence remains blocked while another visit for
  -- this promoter is active, independent of route/store/date.
  PERFORM public.attendance_check_in(
    'M40_SYNTHETIC_STORE_OTHER', 'M40_SYNTHETIC_INDUSTRY', v_route_other, NULL, NULL, NULL
  );
  BEGIN
    PERFORM public.attendance_start_scheduled_occurrence(v_route_other, v_thursday, 'recover', NULL, NULL, NULL);
    RAISE EXCEPTION 'M40 allowed recovery while another visit was in progress';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error <> 'Another visit is in progress' THEN RAISE; END IF;
    RAISE NOTICE 'PASS: recovery blocked while another visit is in progress.';
  END;
END;
$$;

RESET ROLE;
DO $$
DECLARE
  v_root uuid := 'e6400000-0000-4000-8000-000000000043';
  v_photo_count integer;
BEGIN
  SELECT count(*) INTO v_photo_count FROM public.visit_photos WHERE visit_id = v_root;
  IF v_photo_count <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.visit_lifecycle_audit
    WHERE visit_id = v_root AND action = 'promoter_cancelled'
  ) THEN
    RAISE EXCEPTION 'Prior occurrence evidence changed during recovery';
  END IF;
  RAISE NOTICE 'PASS: prior photo and cancellation audit remain unchanged.';
END;
$$;

ROLLBACK;
