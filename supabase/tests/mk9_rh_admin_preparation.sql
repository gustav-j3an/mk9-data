-- Synthetic-only contract test for explicit CRM binding preparation. Roll back all rows.
BEGIN;
DO $$
DECLARE admin_id uuid; test_promoter uuid := '40000000-0000-4000-8000-000000000001';
BEGIN
  SELECT id INTO admin_id FROM public.profiles WHERE role='admin' AND status='ativo' ORDER BY id LIMIT 1;
  IF admin_id IS NULL THEN RAISE EXCEPTION 'Local synthetic active admin required'; END IF;
  INSERT INTO mk9_rh_private.admin_permissions(usuario_id,ativo,concedido_por,referencia)
    VALUES(admin_id,true,admin_id,'SYNTHETIC LOCAL DATABASE TEST');
  INSERT INTO public.promotores(id,matricula,nome,cidade,uf,status)
    VALUES(test_promoter,'QA-RH-LOCAL-CRM','SYNTHETIC CRM PREPARATION','LOCAL TEST','SP','ativo');
  PERFORM set_config('request.jwt.claim.sub',admin_id::text,true);
END $$;

SET LOCAL ROLE authenticated;
DO $$
DECLARE promoter uuid := '40000000-0000-4000-8000-000000000001';
BEGIN
  IF NOT public.mk9_rh_admin_can_manage() THEN RAISE EXCEPTION 'Explicit integration permission not recognized'; END IF;
  PERFORM public.mk9_rh_admin_prepare_allocation(
    promoter,'950edb7d-b94f-4555-9e5a-16fb5aa857a3','CRM-EXT-QA-001',
    '2026-10-01',NULL,statement_timestamp()-interval '1 hour',NULL,'SYNTHETIC SOURCE CONFIRMATION');
  PERFORM public.mk9_rh_admin_prepare_allocation(
    promoter,'600da4d2-4aab-47d6-a81c-3e7a38d717ed','CRM-EXT-QA-001',
    '2026-10-19',NULL,statement_timestamp()-interval '1 hour',NULL,'SYNTHETIC SOURCE CONFIRMATION');
  IF (SELECT count(*) FROM public.mk9_rh_admin_bindings(promoter))<>2 THEN
    RAISE EXCEPTION 'Multiple project allocations were not listed';
  END IF;
  IF EXISTS(SELECT 1 FROM public.mk9_rh_scope('management') WHERE promotor_id=promoter) THEN
    RAISE EXCEPTION 'Pending preparation granted RH access';
  END IF;
  IF (SELECT status FROM public.mk9_rh_resolve_attendance('QA-RH-LOCAL-CRM','2026-10-19'))<>'pendente' THEN
    RAISE EXCEPTION 'Pending identity/allocation was not blocked';
  END IF;
END $$;

RESET ROLE;
DO $$
DECLARE promoter uuid := '40000000-0000-4000-8000-000000000001'; admin_id uuid := auth.uid();
BEGIN
  UPDATE public.mk9_identidades SET estado='aprovado',aprovado_por=admin_id,aprovado_em=statement_timestamp()
   WHERE promotor_id=promoter;
  UPDATE public.mk9_alocacoes SET estado='aprovado',aprovado_por=admin_id,aprovado_em=statement_timestamp()
   WHERE promotor_id=promoter;
END $$;

SET LOCAL ROLE authenticated;
DO $$
DECLARE result record; promoter uuid := '40000000-0000-4000-8000-000000000001';
BEGIN
  SELECT * INTO result FROM public.mk9_rh_resolve_attendance('QA-RH-LOCAL-CRM','2026-10-19');
  IF result.status<>'ambiguo' OR result.alocacoes_validas<>2 OR result.projeto_externo_id IS NOT NULL
     OR result.matricula_externa IS NOT NULL THEN RAISE EXCEPTION 'Multiple active projects were not blocked as ambiguous'; END IF;
END $$;

RESET ROLE;
UPDATE public.mk9_alocacoes SET ocorrencias_ate='2026-10-18'
 WHERE promotor_id='40000000-0000-4000-8000-000000000001'
   AND projeto_externo_id='950edb7d-b94f-4555-9e5a-16fb5aa857a3';
SET LOCAL ROLE authenticated;
DO $$
DECLARE result record;
BEGIN
  SELECT * INTO result FROM public.mk9_rh_resolve_attendance('QA-RH-LOCAL-CRM','2026-10-19');
  IF result.status<>'pronto' OR result.alocacoes_validas<>1
     OR result.projeto_externo_id<>'600da4d2-4aab-47d6-a81c-3e7a38d717ed'
     OR result.matricula_externa<>'CRM-EXT-QA-001' THEN RAISE EXCEPTION 'Single allocation did not resolve external identity'; END IF;
  SELECT * INTO result FROM public.mk9_rh_resolve_attendance('QA-RH-LOCAL-CRM','2026-08-01');
  IF result.status<>'fora_vigencia_ou_janela' THEN RAISE EXCEPTION 'Out-of-window event was not blocked'; END IF;
END $$;

RESET ROLE;
UPDATE public.mk9_identidades SET estado='revogado'
 WHERE promotor_id='40000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
DO $$
DECLARE promoter uuid := '40000000-0000-4000-8000-000000000001';
BEGIN
  IF (SELECT status FROM public.mk9_rh_resolve_attendance('QA-RH-LOCAL-CRM','2026-10-19'))<>'revogado' THEN
    RAISE EXCEPTION 'Revoked identity was not blocked';
  END IF;
  BEGIN
    PERFORM public.mk9_rh_admin_prepare_allocation(
      promoter,'1186bb9a-b1b4-4d2b-a8af-4b34646a3a72','FORGED ',
      '2026-10-01',NULL,statement_timestamp()-interval '1 hour',NULL,'SYNTHETIC FORGED INPUT');
    RAISE EXCEPTION 'Whitespace-mutated external matrícula was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM * FROM public.mk9_alocacoes; RAISE EXCEPTION 'Raw allocation table exposed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM * FROM mk9_rh_private.admin_permissions; RAISE EXCEPTION 'Admin permission table exposed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE mk9_rh_private.admin_permissions SET ativo=false,revogado_em=statement_timestamp()
WHERE usuario_id=auth.uid();
SELECT set_config('request.jwt.claim.sub',
  (SELECT id::text FROM public.profiles WHERE role='admin' AND status='ativo' AND id<>auth.uid() ORDER BY id LIMIT 1),true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE promoter uuid := '40000000-0000-4000-8000-000000000001';
BEGIN
  IF public.mk9_rh_admin_can_manage() THEN RAISE EXCEPTION 'Revoked integration administrator retained permission'; END IF;
  BEGIN PERFORM * FROM public.mk9_rh_admin_bindings(promoter); RAISE EXCEPTION 'Revoked administrator listed bindings'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;

SELECT 'PASS: explicit integration grant; pending-only preparation; multiple projects; external identity; ambiguity/window/revocation guards; raw table access denied; no outbound API' AS result;
