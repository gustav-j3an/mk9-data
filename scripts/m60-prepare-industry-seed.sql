DO $m60$
BEGIN
  IF EXISTS (SELECT 1 FROM public.industrias WHERE codigo = 'IND-9000000000000000000') THEN
    RAISE EXCEPTION 'M60_SYNTHETIC_SEQUENCE_MARKER_ALREADY_EXISTS';
  END IF;

  INSERT INTO public.industrias(codigo, nome, status)
  VALUES ('IND-9000000000000000000', 'M60 synthetic sequence marker', 'ativo');
END
$m60$;
