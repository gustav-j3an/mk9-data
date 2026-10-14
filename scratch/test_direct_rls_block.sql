-- Test direct write attempts via client (simulating authenticated non-superuser)
DO $$
DECLARE
  v_error_caught BOOLEAN := FALSE;
BEGIN
  -- Simular authenticated context
  PERFORM set_config('request.jwt.claim.sub', 'd6c3bc2c-3286-4dd3-ade3-e98fd008919e', true);
  PERFORM set_config('role', 'authenticated', true);

  -- 1. Tentativa de update direto na tabela system_settings
  BEGIN
    UPDATE public.system_settings SET value = '"HACKED"'::jsonb WHERE key = 'operation_mode';
  EXCEPTION WHEN OTHERS THEN
    v_error_caught := TRUE;
  END;

  -- 2. Tentativa de delete direto
  BEGIN
    DELETE FROM public.system_settings WHERE key = 'operation_mode';
  EXCEPTION WHEN OTHERS THEN
    v_error_caught := TRUE;
  END;

  -- 3. Tentativa de insert direto no log de auditoria
  BEGIN
    INSERT INTO public.system_settings_audit_log (
      previous_mode, new_mode, justification
    ) VALUES ('A', 'B', 'Hacking audit log');
  EXCEPTION WHEN OTHERS THEN
    v_error_caught := TRUE;
  END;
END $$;
