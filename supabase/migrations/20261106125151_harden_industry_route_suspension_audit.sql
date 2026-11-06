-- MISSÃO 30.8 — proteção auditável para suspensões e reativações de rotas.
-- Aplicar depois de 20261105150000_m30_inactivate_industry_routes_sync.sql.
-- Não infere suspensões antigas a partir de texto livre: sem evento estruturado,
-- uma rota encerrada permanece encerrada até decisão administrativa explícita.

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.rotas
  ADD COLUMN IF NOT EXISTS industry_suspension_event_id uuid;

CREATE TABLE IF NOT EXISTS attendance_private.industry_route_sync_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  suspension_batch_id uuid NOT NULL,
  route_id uuid NOT NULL REFERENCES public.rotas(id) ON DELETE RESTRICT,
  industry_id uuid NOT NULL REFERENCES public.industrias(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('suspended', 'reactivated')),
  source_event_id uuid REFERENCES attendance_private.industry_route_sync_audit(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  reason text NOT NULL,
  route_code text,
  store_code text NOT NULL,
  promoter_matricula text NOT NULL,
  closure_at timestamptz NOT NULL,
  previous_motivo_encerramento text,
  previous_observacao text,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT industry_route_sync_audit_event_source CHECK (
    (event_type = 'suspended' AND source_event_id IS NULL)
    OR (event_type = 'reactivated' AND source_event_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS industry_route_sync_audit_reactivation_once
  ON attendance_private.industry_route_sync_audit(source_event_id)
  WHERE event_type = 'reactivated';
CREATE INDEX IF NOT EXISTS industry_route_sync_audit_route_history
  ON attendance_private.industry_route_sync_audit(route_id, occurred_at DESC);

ALTER TABLE attendance_private.industry_route_sync_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON attendance_private.industry_route_sync_audit FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION attendance_private.reject_industry_route_sync_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Industry route synchronization audit is immutable' USING ERRCODE = '42501';
END;
$$;
REVOKE ALL ON FUNCTION attendance_private.reject_industry_route_sync_audit_mutation() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS industry_route_sync_audit_immutable ON attendance_private.industry_route_sync_audit;
CREATE TRIGGER industry_route_sync_audit_immutable
  BEFORE UPDATE OR DELETE ON attendance_private.industry_route_sync_audit
  FOR EACH ROW EXECUTE FUNCTION attendance_private.reject_industry_route_sync_audit_mutation();

CREATE OR REPLACE FUNCTION attendance_private.guard_industry_route_suspension_marker()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.industry_suspension_event_id IS DISTINCT FROM OLD.industry_suspension_event_id
     AND pg_catalog.current_setting('mk9.industry_route_sync_write', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Industry suspension markers can only be changed by the synchronization RPC'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.encerrada_em IS DISTINCT FROM OLD.encerrada_em
     AND pg_catalog.current_setting('mk9.industry_route_sync_write', true) IS DISTINCT FROM 'on' THEN
    NEW.industry_suspension_event_id := NULL;
  END IF;
  IF NEW.motivo_encerramento IS DISTINCT FROM OLD.motivo_encerramento
     AND pg_catalog.current_setting('mk9.industry_route_sync_write', true) IS DISTINCT FROM 'on' THEN
    NEW.industry_suspension_event_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION attendance_private.guard_industry_route_suspension_marker() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS guard_industry_route_suspension_marker ON public.rotas;
CREATE TRIGGER guard_industry_route_suspension_marker
  BEFORE UPDATE OF encerrada_em, motivo_encerramento, industry_suspension_event_id ON public.rotas
  FOR EACH ROW EXECUTE FUNCTION attendance_private.guard_industry_route_suspension_marker();

CREATE OR REPLACE FUNCTION public.inactivate_industry_and_suspend_routes(
  p_industria_id uuid,
  p_motivo text DEFAULT 'Inativação da indústria'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_industry public.industrias;
  v_route public.rotas;
  v_closed_at timestamptz := pg_catalog.clock_timestamp();
  v_batch_id uuid := pg_catalog.gen_random_uuid();
  v_event_id uuid;
  v_actor uuid := auth.uid();
  v_reason text := coalesce(nullif(pg_catalog.btrim(p_motivo), ''), 'Inativação da indústria');
  v_routes_affected integer := 0;
BEGIN
  IF v_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_actor AND p.status = 'ativo' AND p.role IN ('admin', 'gestor')
  ) OR NOT public.is_admin_or_gestor() THEN
    RAISE EXCEPTION 'Acesso não autorizado.' USING ERRCODE = '42501';
  END IF;
  IF p_industria_id IS NULL THEN
    RAISE EXCEPTION 'Indústria obrigatória.' USING ERRCODE = '22023';
  END IF;

  SELECT i.* INTO v_industry
  FROM public.industrias i
  WHERE i.id = p_industria_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Indústria não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.industrias
  SET status = 'inativo', updated_at = v_closed_at
  WHERE id = p_industria_id;

  PERFORM pg_catalog.set_config('mk9.industry_route_sync_write', 'on', true);
  FOR v_route IN
    SELECT r.* FROM public.rotas r
    WHERE r.industria_codigo = v_industry.codigo AND r.encerrada_em IS NULL
    FOR UPDATE
  LOOP
    v_event_id := pg_catalog.gen_random_uuid();
    UPDATE public.rotas
    SET encerrada_em = v_closed_at,
        motivo_encerramento = v_reason,
        industry_suspension_event_id = v_event_id,
        updated_at = v_closed_at
    WHERE id = v_route.id;

    INSERT INTO attendance_private.industry_route_sync_audit (
      id, suspension_batch_id, route_id, industry_id, event_type, source_event_id,
      actor_id, reason, route_code, store_code, promoter_matricula, closure_at,
      previous_motivo_encerramento, previous_observacao
    ) VALUES (
      v_event_id, v_batch_id, v_route.id, v_industry.id, 'suspended', NULL,
      v_actor, v_reason, v_route.codigo_rota, v_route.loja_codigo,
      v_route.promotor_matricula, v_closed_at,
      v_route.motivo_encerramento, v_route.observacao
    );
    v_routes_affected := v_routes_affected + 1;
  END LOOP;

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'industria_id', v_industry.id,
    'industria_codigo', v_industry.codigo,
    'industria_nome', v_industry.nome,
    'rotas_suspensas', v_routes_affected,
    'timestamp', v_closed_at,
    'suspension_batch_id', v_batch_id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.inactivate_industry_and_suspend_routes(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.inactivate_industry_and_suspend_routes(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.reactivate_industry_routes(
  p_industria_id uuid,
  p_route_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_industry public.industrias;
  v_route record;
  v_actor uuid := auth.uid();
  v_routes_reactivated integer := 0;
BEGIN
  IF v_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_actor AND p.status = 'ativo' AND p.role IN ('admin', 'gestor')
  ) OR NOT public.is_admin_or_gestor() THEN
    RAISE EXCEPTION 'Acesso não autorizado.' USING ERRCODE = '42501';
  END IF;
  IF p_industria_id IS NULL THEN
    RAISE EXCEPTION 'Indústria obrigatória.' USING ERRCODE = '22023';
  END IF;

  SELECT i.* INTO v_industry
  FROM public.industrias i
  WHERE i.id = p_industria_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Indústria não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_industry.status IS DISTINCT FROM 'ativo' THEN
    RAISE EXCEPTION 'Reative a indústria antes de reativar suas rotas.' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.set_config('mk9.industry_route_sync_write', 'on', true);
  FOR v_route IN
    SELECT r.id AS route_id, r.encerrada_em, r.industry_suspension_event_id,
           s.id AS suspension_event_id, s.suspension_batch_id, s.closure_at,
           s.route_code, s.store_code, s.promoter_matricula,
           s.previous_motivo_encerramento, s.previous_observacao
    FROM public.rotas r
    JOIN attendance_private.industry_route_sync_audit s
      ON s.id = r.industry_suspension_event_id
     AND s.route_id = r.id
     AND s.industry_id = v_industry.id
     AND s.event_type = 'suspended'
    WHERE r.industria_codigo = v_industry.codigo
      AND r.encerrada_em IS NOT NULL
      AND (p_route_ids IS NULL OR cardinality(p_route_ids) = 0 OR r.id = ANY(p_route_ids))
      AND NOT EXISTS (
        SELECT 1 FROM attendance_private.industry_route_sync_audit re
        WHERE re.event_type = 'reactivated' AND re.source_event_id = s.id
      )
    FOR UPDATE OF r
  LOOP
    UPDATE public.rotas
    SET encerrada_em = NULL,
        motivo_encerramento = v_route.previous_motivo_encerramento,
        industry_suspension_event_id = NULL,
        updated_at = pg_catalog.clock_timestamp()
    WHERE id = v_route.route_id;

    INSERT INTO attendance_private.industry_route_sync_audit (
      suspension_batch_id, route_id, industry_id, event_type, source_event_id,
      actor_id, reason, route_code, store_code, promoter_matricula, closure_at,
      previous_motivo_encerramento, previous_observacao
    ) VALUES (
      v_route.suspension_batch_id, v_route.route_id, v_industry.id, 'reactivated',
      v_route.suspension_event_id, v_actor,
      'Reativação autorizada da suspensão por inativação da indústria',
      v_route.route_code, v_route.store_code, v_route.promoter_matricula,
      v_route.closure_at, v_route.previous_motivo_encerramento,
      v_route.previous_observacao
    );
    v_routes_reactivated := v_routes_reactivated + 1;
  END LOOP;

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'industria_codigo', v_industry.codigo,
    'rotas_reativadas', v_routes_reactivated
  );
END;
$$;
REVOKE ALL ON FUNCTION public.reactivate_industry_routes(uuid, uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reactivate_industry_routes(uuid, uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
