\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id, email) VALUES
 ('6599a000-0000-4000-8000-000000000001','m65-promoter@example.invalid'),
 ('6599a000-0000-4000-8000-000000000002','m65-admin@example.invalid');
INSERT INTO public.promotores(matricula,nome,cidade,uf,status) VALUES
 ('M65P1','Synthetic promoter','Test','SP','ativo'),
 ('M65P2','Synthetic unauthorized promoter','Test','SP','ativo');
INSERT INTO public.industrias(codigo,nome,status) VALUES
 ('IND-M65-001','M65 synthetic industry','ativo');
INSERT INTO public.lojas(codigo,nome,cidade,uf,endereco,status) VALUES
 ('M65L1','M65 synthetic store 1','Test','SP','Synthetic','ativo'),
 ('M65L2','M65 synthetic store 2','Test','SP','Synthetic','ativo'),
 ('M65L3','M65 synthetic store 3','Test','SP','Synthetic','ativo');
INSERT INTO public.profiles(id,email,name,role,promotor_matricula,status) VALUES
 ('6599a000-0000-4000-8000-000000000001','m65-promoter@example.invalid','M65 promoter','promotor','M65P1','ativo'),
 ('6599a000-0000-4000-8000-000000000002','m65-admin@example.invalid','M65 admin','admin',NULL,'ativo')
ON CONFLICT (id) DO UPDATE SET
 email=EXCLUDED.email,
 name=EXCLUDED.name,
 role=EXCLUDED.role,
 promotor_matricula=EXCLUDED.promotor_matricula,
 status=EXCLUDED.status;
INSERT INTO public.system_settings(key,value) VALUES ('operation_mode','"IMPLANTACAO"')
ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value;
INSERT INTO public.promoter_operation_authorizations(promotor_matricula,status,justification) VALUES
 ('M65P1','liberado','Synthetic regression'),
 ('M65P2','bloqueado','Synthetic regression');

-- Existing owner rule still works when individual authorization is present.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','6599a000-0000-4000-8000-000000000001',true);
INSERT INTO public.visits(promotor_matricula,loja_codigo,industria_codigo,data_visita)
VALUES ('M65P1','M65L1','IND-M65-001',DATE '2099-01-01');

DO $assert$
BEGIN
  BEGIN
    INSERT INTO public.visits(promotor_matricula,loja_codigo,industria_codigo,data_visita)
    VALUES ('M65P2','M65L2','IND-M65-001',DATE '2099-01-02');
    RAISE EXCEPTION 'M65_UNAUTHORIZED_PROMOTER_INSERT_ACCEPTED';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$assert$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','6599a000-0000-4000-8000-000000000002',true);
-- Preserve the current admin/gestor authorization behavior.
INSERT INTO public.visits(promotor_matricula,loja_codigo,industria_codigo,data_visita)
VALUES ('M65P2','M65L3','IND-M65-001',DATE '2099-01-03');

RESET ROLE;
ROLLBACK;
SELECT 'M65 visits INSERT policy regression passed';
