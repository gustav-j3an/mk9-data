-- Mission 59: harden contract RPC ACLs and make industry codes database-authoritative.
-- Historical migrations remain unchanged. Existing industry codes are preserved.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Trigger functions are invoked by their triggers; API roles do not need direct EXECUTE.
REVOKE ALL ON FUNCTION public.check_contratos_vigencia_overlap()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.handle_contratos_updated_at()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.sync_contratos_from_rotas()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_contratos_from_rotas() TO authenticated;

-- Serialize the one-time sequence initialization with industry writes.
LOCK TABLE public.industrias IN SHARE ROW EXCLUSIVE MODE;

DO $m59$
DECLARE
  industry_code_attnum smallint;
  max_code numeric;
  sequence_last_value bigint;
  sequence_is_called boolean;
BEGIN
  SELECT attnum INTO industry_code_attnum
  FROM pg_attribute
  WHERE attrelid = 'public.industrias'::regclass
    AND attname = 'codigo'
    AND NOT attisdropped;

  IF industry_code_attnum IS NULL THEN
    RAISE EXCEPTION 'M59_INDUSTRY_CODE_COLUMN_MISSING';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    WHERE i.indrelid = 'public.industrias'::regclass
      AND i.indisunique
      AND i.indisvalid
      AND i.indisready
      AND i.indnkeyatts = 1
      AND i.indkey[0] = industry_code_attnum
  ) THEN
    IF EXISTS (
      SELECT 1 FROM public.industrias
      GROUP BY codigo HAVING count(*) > 1
    ) THEN
      RAISE EXCEPTION 'M59_DUPLICATE_INDUSTRY_CODES_BLOCK_UNIQUE_CONSTRAINT';
    END IF;

    ALTER TABLE public.industrias
      ADD CONSTRAINT industrias_codigo_key UNIQUE (codigo);
  END IF;

  CREATE SEQUENCE IF NOT EXISTS public.industrias_codigo_seq
    AS bigint MINVALUE 1 NO CYCLE CACHE 1;

  SELECT last_value, is_called INTO sequence_last_value, sequence_is_called
  FROM public.industrias_codigo_seq;

  SELECT COALESCE(MAX(substring(codigo FROM 5)::numeric), 0)
    INTO max_code
  FROM public.industrias
  WHERE codigo ~ '^IND-[0-9]+$';

  IF max_code >= 9223372036854775807 THEN
    RAISE EXCEPTION 'M59_INDUSTRY_CODE_SEQUENCE_EXHAUSTED';
  ELSIF max_code > sequence_last_value
     OR (max_code = sequence_last_value AND max_code > 0 AND NOT sequence_is_called) THEN
    PERFORM setval('public.industrias_codigo_seq', max_code::bigint, true);
  END IF;
END
$m59$;

CREATE OR REPLACE FUNCTION public.generate_industry_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  candidate text;
BEGIN
  LOOP
    candidate := 'IND-' || lpad(nextval('public.industrias_codigo_seq'::regclass)::text, 3, '0');
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.industrias i WHERE i.codigo = candidate
    );
  END LOOP;
  RETURN candidate;
END
$function$;

-- This RPC reserves a unique sequence value. It is a preview; the INSERT trigger
-- remains authoritative when callers omit the code or provide an invalid value.
CREATE OR REPLACE FUNCTION public.get_next_industry_code()
RETURNS text
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT public.generate_industry_code()
$function$;

CREATE OR REPLACE FUNCTION public.set_industria_codigo_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF TG_OP = 'INSERT' AND (NEW.codigo IS NULL OR btrim(NEW.codigo) = '') THEN
    NEW.codigo := public.generate_industry_code();
  ELSE
    NEW.codigo := upper(btrim(NEW.codigo));
  END IF;

  IF NEW.codigo IS NULL OR NEW.codigo !~ '^IND-[A-Z0-9]+(-[A-Z0-9]+)*$' THEN
    RAISE EXCEPTION 'Invalid industry code. Use format IND-XXX.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trigger_set_industria_codigo ON public.industrias;
CREATE TRIGGER trigger_set_industria_codigo
  BEFORE INSERT OR UPDATE OF codigo ON public.industrias
  FOR EACH ROW
  EXECUTE FUNCTION public.set_industria_codigo_trigger();

-- Only the authenticated preview RPC is exposed. SECURITY DEFINER functions
-- consume the sequence internally; API roles cannot read or advance it directly.
REVOKE ALL ON FUNCTION public.generate_industry_code()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_next_industry_code()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_industria_codigo_trigger()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_next_industry_code() TO authenticated;
REVOKE ALL ON SEQUENCE public.industrias_codigo_seq
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
