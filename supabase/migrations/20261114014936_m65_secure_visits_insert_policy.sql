-- M65: add an authorization gate that no permissive INSERT policy can bypass.
-- Existing permissive policies keep their current rules; this restrictive
-- policy intersects them for authenticated callers.
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $m65_preflight$
BEGIN
  IF to_regclass('public.visits') IS NULL THEN
    RAISE EXCEPTION 'M65_VISITS_TABLE_MISSING';
  END IF;
  IF to_regprocedure('public.is_promotor_authorized(text)') IS NULL THEN
    RAISE EXCEPTION 'M65_PROMOTER_AUTHORIZATION_FUNCTION_MISSING';
  END IF;
  IF to_regprocedure('public.is_admin_or_gestor()') IS NULL THEN
    RAISE EXCEPTION 'M65_ADMIN_GESTOR_FUNCTION_MISSING';
  END IF;
  IF to_regprocedure('public.get_auth_promotor_matricula()') IS NULL THEN
    RAISE EXCEPTION 'M65_PROMOTER_IDENTITY_FUNCTION_MISSING';
  END IF;
END
$m65_preflight$;

DROP POLICY IF EXISTS visits_insert_promoter_authorization ON public.visits;
CREATE POLICY visits_insert_promoter_authorization
  ON public.visits
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_admin_or_gestor()
    OR (
      promotor_matricula = public.get_auth_promotor_matricula()
      AND public.is_promotor_authorized(promotor_matricula)
    )
  );

COMMIT;
