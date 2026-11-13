\set ON_ERROR_STOP on

-- The fixture seeds IND-007 before the migration; the RPC must reserve 008.
DO $m59$
DECLARE
  preview text;
BEGIN
  preview := public.get_next_industry_code();
  IF preview <> 'IND-008' THEN
    RAISE EXCEPTION 'M59_INDUSTRY_PREVIEW_DID_NOT_START_AFTER_EXISTING_CODES:%', preview;
  END IF;
END
$m59$;

GRANT INSERT ON public.industrias TO authenticated;
SET ROLE authenticated;
INSERT INTO public.industrias(codigo) VALUES (NULL);
RESET ROLE;

DO $m59$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.industrias WHERE codigo='IND-009') THEN
    RAISE EXCEPTION 'M59_INDUSTRY_TRIGGER_DID_NOT_GENERATE_CODE';
  END IF;
END
$m59$;

INSERT INTO public.industrias(codigo) VALUES ('IND-M59-CONTRACT') ON CONFLICT DO NOTHING;
INSERT INTO public.lojas(codigo) VALUES ('LOJ-M59-1') ON CONFLICT DO NOTHING;
INSERT INTO public.rotas(
  loja_codigo, industria_codigo, promotor_matricula, frequencia,
  segunda, terca, quarta, quinta, sexta, sabado, domingo
) VALUES ('LOJ-M59-1', 'IND-M59-CONTRACT', 'M59-SYNTH', 'SEMANAL', true, false, false, false, false, false, false);

CREATE OR REPLACE FUNCTION public.is_admin_or_gestor()
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;

GRANT INSERT, UPDATE ON public.contratos_lojas TO authenticated;
SET ROLE authenticated;
SELECT * FROM public.sync_contratos_from_rotas();
UPDATE public.contratos_lojas
SET observacao='M59 trigger test', updated_at='2000-01-01'
WHERE industria_codigo='IND-M59-CONTRACT' AND loja_codigo='LOJ-M59-1';
RESET ROLE;

DO $m59$
DECLARE
BEGIN
  IF (SELECT count(*) FROM public.contratos_lojas
      WHERE industria_codigo='IND-M59-CONTRACT' AND loja_codigo='LOJ-M59-1') <> 1 THEN
    RAISE EXCEPTION 'M59_CONTRACT_SYNC_DID_NOT_CREATE_SYNTHETIC_CONTRACT';
  END IF;

  IF NOT (SELECT updated_at > '2000-01-01'::timestamptz FROM public.contratos_lojas
          WHERE industria_codigo='IND-M59-CONTRACT' AND loja_codigo='LOJ-M59-1') THEN
    RAISE EXCEPTION 'M59_CONTRACT_UPDATED_AT_TRIGGER_FAILED';
  END IF;
END
$m59$;
