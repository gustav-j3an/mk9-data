-- ==============================================================================
-- MK9 COMMAND CENTER - HIGIENIZAÇÃO DE REGISTROS DUPLICADOS LEGADOS EM VISITAS
-- Arquivo: supabase/migrations/20261008_clean_legacy_duplicate_visits.sql
-- Descrição: Remove exatamente os 9 registros duplicados legados validados na Etapa 7.4.
-- Com trava de segurança para validar a correspondência dos IDs às chaves operacionais.
-- ==============================================================================

DO $$
DECLARE
  v_invalid_count INTEGER;
BEGIN
  -- 1. Validar que os 9 IDs pertencem rigorosamente aos 2 grupos de duplicidade identificados
  SELECT COUNT(*) INTO v_invalid_count
  FROM public.visits
  WHERE id IN (
    '4dda4b2a-aa85-4ce8-a162-ba684d3f3fc0',
    '1ace8b3a-d049-4116-a1af-ddc2baddcc09',
    '86896272-df25-47c5-90ee-385e7d00b6dd',
    '97e74478-dbcf-46cb-8634-f44e0ae69aa6',
    'ed12292e-3c0f-444a-a2b5-2aa8c075cb16',
    '5bddb242-4169-4122-b275-6577bbb05d35',
    '4425632e-470b-47a1-86e8-16111324b3f0',
    '1c35098a-a3e3-48dc-9351-57cddb887c47',
    'b346dd08-f63c-4739-b9fe-d68f6cf2fde7'
  )
  AND NOT (
    (promotor_matricula = 'PRM-024' AND loja_codigo = 'LOJ-0097' AND industria_codigo = 'IND-001' AND data_visita = '2026-10-02')
    OR
    (promotor_matricula = 'PRM-060' AND loja_codigo = 'LOJ-0367' AND industria_codigo = 'IND-001' AND data_visita = '2026-10-06')
  );

  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION 'Abortando exclusão: Encontrado(s) % registro(s) que não correspondem às chaves operacionais autorizadas.', v_invalid_count;
  END IF;

  -- 2. Remover cirurgicamente os 9 registros redundantes
  DELETE FROM public.visits
  WHERE id IN (
    -- Grupo 1 (PRM-024, LOJ-0097, IND-001, 2026-10-02)
    '4dda4b2a-aa85-4ce8-a162-ba684d3f3fc0',
    '1ace8b3a-d049-4116-a1af-ddc2baddcc09',
    
    -- Grupo 2 (PRM-060, LOJ-0367, IND-001, 2026-10-06)
    '86896272-df25-47c5-90ee-385e7d00b6dd',
    '97e74478-dbcf-46cb-8634-f44e0ae69aa6',
    'ed12292e-3c0f-444a-a2b5-2aa8c075cb16',
    '5bddb242-4169-4122-b275-6577bbb05d35',
    '4425632e-470b-47a1-86e8-16111324b3f0',
    '1c35098a-a3e3-48dc-9351-57cddb887c47',
    'b346dd08-f63c-4739-b9fe-d68f6cf2fde7'
  );

  RAISE NOTICE 'Higienização concluída com sucesso. 9 registros duplicados removidos.';
END $$;
