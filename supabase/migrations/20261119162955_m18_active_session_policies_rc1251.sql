-- RC1.25 release reconciliation: restore the M18 active-session guards
-- observed in homologation but absent from the production backup snapshot.
-- This is a new migration; historical migration files remain unchanged.
BEGIN;

DO $preflight$
DECLARE
  v_count integer;
  v_body_hash text;
  v_security_definer boolean;
  v_search_path text;
BEGIN
  IF to_regclass('public.visits') IS NULL
     OR to_regclass('public.visit_checklist_items') IS NULL
     OR to_regclass('public.visit_occurrences') IS NULL
     OR to_regclass('public.visit_regularization_audit') IS NULL
     OR to_regclass('public.visit_product_validity') IS NULL THEN
    RAISE EXCEPTION 'M18 preflight: expected target table is missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c
    WHERE c.oid IN (
      'public.visits'::regclass,
      'public.visit_checklist_items'::regclass,
      'public.visit_occurrences'::regclass,
      'public.visit_regularization_audit'::regclass,
      'public.visit_product_validity'::regclass
    ) AND NOT c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'M18 preflight: RLS must be enabled on every target table';
  END IF;
  SELECT count(*), min(md5(regexp_replace(p.prosrc, '^\\s+|\\s+$', '', 'g'))),
         bool_and(p.prosecdef), min(array_to_string(p.proconfig, ','))
    INTO v_count, v_body_hash, v_security_definer, v_search_path
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'attendance_private' AND p.proname = 'active_user'
    AND pg_get_function_identity_arguments(p.oid) = '';
  IF v_count <> 1 OR v_body_hash IS DISTINCT FROM '989a2601a72a231be4494f627ecf1e4b'
     OR v_security_definer IS DISTINCT FROM true
     OR position('search_path=""' in coalesce(v_search_path, '')) = 0 THEN
    RAISE EXCEPTION 'M18 preflight: attendance_private.active_user() does not match the reviewed definition';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policy p
    WHERE p.polname = 'm18_active_session'
      AND p.polrelid IN (
        'public.visits'::regclass,
        'public.visit_checklist_items'::regclass,
        'public.visit_occurrences'::regclass,
        'public.visit_regularization_audit'::regclass,
        'public.visit_product_validity'::regclass
      )
  ) THEN
    RAISE EXCEPTION 'M18 preflight: an active-session policy already exists; inspect drift before applying';
  END IF;
END
$preflight$;

CREATE POLICY m18_active_session ON public.visits
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (attendance_private.active_user())
  WITH CHECK (attendance_private.active_user());

CREATE POLICY m18_active_session ON public.visit_checklist_items
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (attendance_private.active_user())
  WITH CHECK (attendance_private.active_user());

CREATE POLICY m18_active_session ON public.visit_occurrences
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (attendance_private.active_user())
  WITH CHECK (attendance_private.active_user());

CREATE POLICY m18_active_session ON public.visit_regularization_audit
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (attendance_private.active_user())
  WITH CHECK (attendance_private.active_user());

CREATE POLICY m18_active_session ON public.visit_product_validity
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (attendance_private.active_user())
  WITH CHECK (attendance_private.active_user());

DO $postflight$
DECLARE
  v_bad integer;
BEGIN
  SELECT count(*) INTO v_bad
  FROM (VALUES
    ('public.visits'::regclass),
    ('public.visit_checklist_items'::regclass),
    ('public.visit_occurrences'::regclass),
    ('public.visit_regularization_audit'::regclass),
    ('public.visit_product_validity'::regclass)
  ) expected(relid)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_policy p
    WHERE p.polrelid = expected.relid
      AND p.polname = 'm18_active_session'
      AND p.polcmd = '*'
      AND NOT p.polpermissive
      AND p.polroles = ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'authenticated')]::oid[]
      AND pg_get_expr(p.polqual, p.polrelid) = 'attendance_private.active_user()'
      AND pg_get_expr(p.polwithcheck, p.polrelid) = 'attendance_private.active_user()'
  );
  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'M18 postflight: expected restrictive policy definitions are missing or differ';
  END IF;
END
$postflight$;

COMMIT;
