-- Synthetic local database contract test. All permission changes are rolled back.
BEGIN;
DO $$
DECLARE admin_id uuid;
BEGIN
  SELECT id INTO admin_id FROM public.profiles
   WHERE role='admin' AND status='ativo' ORDER BY id LIMIT 1;
  IF admin_id IS NULL THEN RAISE EXCEPTION 'An active synthetic local admin is required'; END IF;
  PERFORM set_config('request.jwt.claim.sub',admin_id::text,true);
  IF public.mk9_faltas_atestados_can_prepare() THEN
    RAISE EXCEPTION 'Permission must not be granted to every administrator';
  END IF;
END $$;

SET LOCAL ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM * FROM public.mk9_faltas_atestados_bindings();
    RAISE EXCEPTION 'Unauthorized binding list was returned';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM * FROM mk9_rh_private.absence_prepare_permissions;
    RAISE EXCEPTION 'Raw permission table is exposed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

DO $$
DECLARE admin_id uuid := auth.uid();
BEGIN
  INSERT INTO mk9_rh_private.absence_prepare_permissions(usuario_id,ativo,concedido_por,referencia)
    VALUES(admin_id,true,admin_id,'SYNTHETIC LOCAL PERMISSION TEST');
END $$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE row_count integer;
BEGIN
  IF NOT public.mk9_faltas_atestados_can_prepare() THEN
    RAISE EXCEPTION 'Explicit capability was not recognized';
  END IF;
  SELECT count(*) INTO row_count FROM public.mk9_faltas_atestados_bindings();
  IF row_count>2000 THEN RAISE EXCEPTION 'Binding response exceeded its safe bound'; END IF;
END $$;
RESET ROLE;

UPDATE mk9_rh_private.absence_prepare_permissions
SET ativo=false,revogado_por=auth.uid(),revogado_em=statement_timestamp()
WHERE usuario_id=auth.uid();
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  IF public.mk9_faltas_atestados_can_prepare() THEN
    RAISE EXCEPTION 'Revoked capability remained active';
  END IF;
  BEGIN
    PERFORM * FROM public.mk9_faltas_atestados_bindings();
    RAISE EXCEPTION 'Revoked capability returned bindings';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
ROLLBACK;

SELECT 'PASS: explicit grant required, binding reads denied without capability, and revocation takes effect' AS result;
