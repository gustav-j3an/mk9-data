BEGIN;
SELECT set_config('request.jwt.claim.sub', '8c09b739-497c-4e18-87eb-f5653d61628d', true);

SELECT apply_attendance_journeys(
  ARRAY['PRM-023', 'PRM-060'],
  ARRAY['segunda', 'terca', 'quarta', 'quinta', 'sexta'],
  '08:00'::time,
  '17:00'::time,
  '2026-10-19'::date,
  '2026-11-30'::date,
  60,
  15,
  'America/Sao_Paulo',
  'CLT integral',
  'Teste sintético de homologação funcional',
  false,
  'SP',
  'São Paulo'
);

SELECT count(*) AS total_schedules FROM promoter_work_schedules WHERE promotor_matricula IN ('PRM-023', 'PRM-060');
SELECT count(*) AS total_audit FROM promoter_journey_audit WHERE promotor_matricula IN ('PRM-023', 'PRM-060');

-- Teste de sobreposição futura (deve disparar exceção)
DO $$
BEGIN
  BEGIN
    PERFORM apply_attendance_journeys(
      ARRAY['PRM-023'],
      ARRAY['segunda'],
      '09:00'::time,
      '18:00'::time,
      '2026-10-15'::date,
      '2026-12-01'::date,
      60,
      15,
      'America/Sao_Paulo',
      'CLT integral',
      'Teste de sobreposição de jornada',
      false,
      'SP',
      'São Paulo'
    );
    RAISE EXCEPTION 'Falha: Sobreposição não foi bloqueada!';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Sucesso no bloqueio de sobreposição: %', SQLERRM;
  END;
END $$;

ROLLBACK;

