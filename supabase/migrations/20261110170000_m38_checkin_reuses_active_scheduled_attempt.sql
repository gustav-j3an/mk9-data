BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- M37 correctly keeps scheduled rows out of its legacy upsert. Before that
-- legacy lookup, return the already-active scheduled attempt for this same
-- promoter/store/industry/effective date. All M30/M37 identity, industry,
-- route, GPS, operation-mode and lock checks above this point remain intact.
DO $$
DECLARE
  v_definition text;
  v_pattern text := $pattern$  SELECT * INTO result
  FROM public.visits
  WHERE promotor_matricula = matricula
    AND loja_codigo = p_store
    AND industria_codigo = p_industry
    AND data_visita = operational_date
    AND scheduled_date IS NULL
  FOR UPDATE;$pattern$;
  v_expiry_anchor text := '  -- An active weekly retry already owns this effective-day visit.';
  v_expiry_insertion text := $expiry$  -- An active weekly retry already owns this effective-day visit.
  -- M38: expire prior operational-day visits even if the cron worker was delayed.
  PERFORM attendance_private.expire_old_open_visits_for_promoter(matricula);$expiry$;
  v_reuse_guard_anchor text := $reuse_guard$  ORDER BY started_at DESC, id
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    RETURN result;
  END IF;$reuse_guard$;
  v_reuse_guard_insertion text := $reuse_guard_insert$  ORDER BY started_at DESC, id
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    -- M38: reuse is safe only if the promoter has no other open visit.
    IF EXISTS (
      SELECT 1 FROM public.visits v
      WHERE v.promotor_matricula = matricula
        AND v.status = 'em_andamento'
        AND v.regularization_status IS NULL
        AND v.id IS DISTINCT FROM result.id
    ) THEN
      RAISE EXCEPTION 'Another visit is in progress' USING ERRCODE = '42501';
    END IF;
    RETURN result;
  END IF;$reuse_guard_insert$;
  v_active_guard_pattern text := $active_guard$  IF EXISTS (
    SELECT 1 FROM public.visits
    WHERE promotor_matricula = matricula
      AND status = 'em_andamento'
      AND regularization_status IS NULL
      AND data_visita = operational_date
      AND id IS DISTINCT FROM result.id
  ) THEN
    RAISE EXCEPTION 'Another visit is in progress';
  END IF;$active_guard$;
  v_active_guard_replacement text := $active_guard_replacement$  -- M38: enforce one active visit across effective dates.
  IF EXISTS (
    SELECT 1 FROM public.visits
    WHERE promotor_matricula = matricula
      AND status = 'em_andamento'
      AND regularization_status IS NULL
      AND id IS DISTINCT FROM result.id
  ) THEN
    RAISE EXCEPTION 'Another visit is in progress' USING ERRCODE = '42501';
  END IF;$active_guard_replacement$;
  v_replacement text := $replacement$  -- An active weekly retry already owns this effective-day visit.
  SELECT * INTO result
  FROM public.visits
  WHERE promotor_matricula = matricula
    AND loja_codigo = p_store
    AND industria_codigo = p_industry
    AND data_visita = operational_date
    AND scheduled_date IS NOT NULL
    AND status = 'em_andamento'
    AND started_at IS NOT NULL
    AND completed_at IS NULL
    AND regularization_status IS NULL
    AND (p_route IS NULL OR rota_id = p_route)
  ORDER BY started_at DESC, id
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    RETURN result;
  END IF;

  SELECT * INTO result
  FROM public.visits
  WHERE promotor_matricula = matricula
    AND loja_codigo = p_store
    AND industria_codigo = p_industry
    AND data_visita = operational_date
    AND scheduled_date IS NULL
  FOR UPDATE;$replacement$;
BEGIN
  -- Normalize dollar-quoted literals from CRLF checkouts before matching
  -- pg_get_functiondef, whose rendered body uses LF line endings.
  v_pattern := replace(v_pattern, E'\r\n', E'\n');
  v_expiry_anchor := replace(v_expiry_anchor, E'\r\n', E'\n');
  v_expiry_insertion := replace(v_expiry_insertion, E'\r\n', E'\n');
  v_reuse_guard_anchor := replace(v_reuse_guard_anchor, E'\r\n', E'\n');
  v_reuse_guard_insertion := replace(v_reuse_guard_insertion, E'\r\n', E'\n');
  v_active_guard_pattern := replace(v_active_guard_pattern, E'\r\n', E'\n');
  v_active_guard_replacement := replace(v_active_guard_replacement, E'\r\n', E'\n');
  v_replacement := replace(v_replacement, E'\r\n', E'\n');

  SELECT pg_get_functiondef(
    'public.attendance_check_in(text,text,uuid,numeric,numeric,numeric)'::regprocedure
  ) INTO v_definition;
  v_definition := replace(v_definition, E'\r\n', E'\n');

  IF position('An active weekly retry already owns this effective-day visit.' IN v_definition) = 0 THEN
    IF position(v_pattern IN v_definition) = 0 THEN
      RAISE EXCEPTION 'Could not locate the M37 legacy visit lookup in attendance_check_in';
    END IF;
    v_definition := replace(v_definition, v_pattern, v_replacement);
  END IF;

  IF position('M38: expire prior operational-day visits' IN v_definition) = 0 THEN
    IF position(v_expiry_anchor IN v_definition) = 0 THEN
      RAISE EXCEPTION 'Could not locate the active scheduled check-in query for expiry insertion';
    END IF;
    v_definition := replace(v_definition, v_expiry_anchor, v_expiry_insertion);
  END IF;

  IF position('M38: reuse is safe only if the promoter has no other open visit.' IN v_definition) = 0 THEN
    IF position(v_reuse_guard_anchor IN v_definition) = 0 THEN
      RAISE EXCEPTION 'Could not locate the scheduled retry reuse guard';
    END IF;
    v_definition := replace(v_definition, v_reuse_guard_anchor, v_reuse_guard_insertion);
  END IF;

  IF position('M38: enforce one active visit across effective dates.' IN v_definition) = 0 THEN
    IF position(v_active_guard_pattern IN v_definition) = 0 THEN
      RAISE EXCEPTION 'Could not locate the M37 active visit check in attendance_check_in';
    END IF;
    v_definition := replace(v_definition, v_active_guard_pattern, v_active_guard_replacement);
  END IF;

  EXECUTE v_definition;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
