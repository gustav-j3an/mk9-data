\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id, email) VALUES
 ('65000000-0000-4000-8000-000000000001','m65-promoter@example.invalid'),
 ('65000000-0000-4000-8000-000000000002','m65-admin@example.invalid');
INSERT INTO public.promotores(matricula,nome,cidade,uf,status) VALUES
 ('M65P1','Synthetic promoter','Test','SP','ativo'),
 ('M65P2','Synthetic unauthorized promoter','Test','SP','ativo');
INSERT INTO public.profiles(id,email,name,role,promotor_matricula,status) VALUES
 ('65000000-0000-4000-8000-000000000001','m65-promoter@example.invalid','M65 promoter','promotor','M65P1','ativo'),
 ('65000000-0000-4000-8000-000000000002','m65-admin@example.invalid','M65 admin','admin',NULL,'ativo');
INSERT INTO public.system_settings(key,value) VALUES ('operation_mode','"IMPLANTACAO"');
INSERT INTO public.promoter_operation_authorizations(promotor_matricula,status,justification) VALUES
 ('M65P1','liberado','Synthetic regression'),
 ('M65P2','bloqueado','Synthetic regression');

-- Existing owner rule still works when individual authorization is present.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','65000000-0000-4000-8000-000000000001',true);
INSERT INTO public.visits(promotor_matricula,loja_codigo,industria_codigo,data_visita)
VALUES ('M65P1','M37L1','M37IA',DATE '2099-01-01');

DO $assert$
BEGIN
  BEGIN
    INSERT INTO public.visits(promotor_matricula,loja_codigo,industria_codigo,data_visita)
    VALUES ('M65P2','M37L2','M37IA',DATE '2099-01-02');
    RAISE EXCEPTION 'M65_UNAUTHORIZED_PROMOTER_INSERT_ACCEPTED';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$assert$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','65000000-0000-4000-8000-000000000002',true);
-- Preserve the current admin/gestor authorization behavior.
INSERT INTO public.visits(promotor_matricula,loja_codigo,industria_codigo,data_visita)
VALUES ('M65P2','M37L3','M37IA',DATE '2099-01-03');

RESET ROLE;
ROLLBACK;
SELECT 'M65 visits INSERT policy regression passed';
