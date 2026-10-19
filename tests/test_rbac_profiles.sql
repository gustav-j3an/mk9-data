BEGIN;
-- 1. Teste ANÔNIMO (auth.uid() = NULL)
-- Tentativa de chamar apply_attendance_journeys sem autenticação deve retornar 42501
DO $$
BEGIN
  BEGIN
    PERFORM apply_attendance_journeys(
      ARRAY['PRM-023'],
      ARRAY['segunda'],
      '08:00'::time,
      '17:00'::time,
      '2026-10-19'::date,
      NULL,
      NULL,
      NULL,
      'America/Sao_Paulo',
      NULL,
      'Tentativa anonima',
      false,
      NULL,
      NULL
    );
    RAISE EXCEPTION 'FALHA: Anonimo conseguiu executar apply_attendance_journeys!';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'OK: Anonimo bloqueado com sucesso: %', SQLERRM;
  END;
END $$;

-- 2. Teste CLIENT_INDUSTRY (edsonking@gmail.com -> id 'bef35710-6247-46f8-8652-6ad2ed8f182f')
SELECT set_config('request.jwt.claim.sub', 'bef35710-6247-46f8-8652-6ad2ed8f182f', true);
DO $$
BEGIN
  BEGIN
    PERFORM apply_attendance_journeys(
      ARRAY['PRM-023'],
      ARRAY['segunda'],
      '08:00'::time,
      '17:00'::time,
      '2026-10-19'::date,
      NULL,
      NULL,
      NULL,
      'America/Sao_Paulo',
      NULL,
      'Tentativa industria',
      false,
      NULL,
      NULL
    );
    RAISE EXCEPTION 'FALHA: Industria conseguiu executar apply_attendance_journeys!';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'OK: Industria bloqueada com sucesso: %', SQLERRM;
  END;
END $$;

-- 3. Teste PROMOTOR (paulogustavomk9@outlook.com -> id '28d80ead-7ece-4440-80a0-0b724a873a5a')
SELECT set_config('request.jwt.claim.sub', '28d80ead-7ece-4440-80a0-0b724a873a5a', true);
DO $$
BEGIN
  BEGIN
    PERFORM apply_attendance_journeys(
      ARRAY['PRM-023'],
      ARRAY['segunda'],
      '08:00'::time,
      '17:00'::time,
      '2026-10-19'::date,
      NULL,
      NULL,
      NULL,
      'America/Sao_Paulo',
      NULL,
      'Tentativa promotor',
      false,
      NULL,
      NULL
    );
    RAISE EXCEPTION 'FALHA: Promotor conseguiu executar apply_attendance_journeys!';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'OK: Promotor bloqueado com sucesso: %', SQLERRM;
  END;
END $$;

-- 4. Teste ADMIN (lucasmattheus704@gmail.com -> id '8c09b739-497c-4e18-87eb-f5653d61628d')
SELECT set_config('request.jwt.claim.sub', '8c09b739-497c-4e18-87eb-f5653d61628d', true);
DO $$
DECLARE
  res jsonb;
BEGIN
  res := apply_attendance_journeys(
    ARRAY['PRM-023'],
    ARRAY['segunda'],
    '08:00'::time,
    '17:00'::time,
    '2026-10-19'::date,
    NULL,
    NULL,
    NULL,
    'America/Sao_Paulo',
    NULL,
    'Admin configurando jornada homologada',
    false,
    NULL,
    NULL
  );
  IF (res->>'success')::boolean = true THEN
    RAISE NOTICE 'OK: Admin autorizado executou com sucesso: %', res;
  ELSE
    RAISE EXCEPTION 'FALHA: Admin nao obteve success=true!';
  END IF;
END $$;

ROLLBACK;

