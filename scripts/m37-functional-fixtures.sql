-- Fixtures exclusivas da stack descartável do GitHub Actions.
-- IDs de usuários vêm do Auth real e são passados via psql -v.
BEGIN;
INSERT INTO public.industrias(codigo,nome,status) VALUES
 ('M37IA','Synthetic active','ativo'),('M37II','Synthetic inactive','inativo');
INSERT INTO public.lojas(codigo,nome,cidade,uf,endereco,status) VALUES
 ('M37L1','Synthetic 1','Teste','SP','Teste','ativo'),
 ('M37L2','Synthetic 2','Teste','SP','Teste','ativo'),
 ('M37L3','Synthetic 3','Teste','SP','Teste','ativo'),
 ('M37L4','Synthetic 4','Teste','SP','Teste','ativo'),
 ('M37L5','Synthetic 5','Teste','SP','Teste','ativo'),
 ('M37L6','Synthetic 6','Teste','SP','Teste','ativo'),
 ('M37L7','Synthetic 7','Teste','SP','Teste','ativo'),
 ('M37L8','Synthetic 8','Teste','SP','Teste','ativo'),
 ('M37L9','Synthetic 9','Teste','SP','Teste','ativo');
INSERT INTO public.promotores(matricula,nome,cidade,uf,status) VALUES
 ('M37P1','Synthetic promoter 1','Teste','SP','ativo'),
 ('M37P2','Synthetic promoter 2','Teste','SP','ativo'),
 ('M37P3','Synthetic promoter 3','Teste','SP','ativo');
UPDATE public.profiles SET role='promotor', status='ativo', promotor_matricula='M37P1'
WHERE id=:'user1';
UPDATE public.profiles SET role='promotor', status='ativo', promotor_matricula='M37P2'
WHERE id=:'user2';
UPDATE public.profiles SET role='promotor', status='ativo', promotor_matricula='M37P3'
WHERE id=:'user3';
INSERT INTO public.promoter_operation_authorizations(promotor_matricula,status,justification)
VALUES ('M37P1','liberado','Isolated functional test'),
 ('M37P2','liberado','Isolated functional test'),
 ('M37P3','liberado','Isolated functional test');
INSERT INTO public.rotas(id,codigo_rota,promotor_matricula,loja_codigo,industria_codigo,frequencia,
 segunda,terca,quarta,quinta,sexta,sabado,domingo,encerrada_em)
VALUES
 ('37000000-0000-4000-8000-000000000001','M37R1','M37P1','M37L1','M37IA','SEMANAL',true,true,true,true,true,true,true,NULL),
 ('37000000-0000-4000-8000-000000000002','M37R2','M37P1','M37L2','M37IA','SEMANAL',true,true,true,true,true,true,true,
  (((clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date - 2)::timestamp AT TIME ZONE 'America/Sao_Paulo')),
 ('37000000-0000-4000-8000-000000000003','M37R3','M37P1','M37L3','M37IA','SEMANAL',true,true,true,true,true,true,true,
  (((clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date - 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')),
 ('37000000-0000-4000-8000-000000000004','M37R4','M37P1','M37L4','M37IA','SEMANAL',true,true,true,true,true,true,true,
  (((clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date)::timestamp AT TIME ZONE 'America/Sao_Paulo')),
 ('37000000-0000-4000-8000-000000000005','M37R5','M37P1','M37L5','M37II','SEMANAL',true,true,true,true,true,true,true,NULL),
 ('37000000-0000-4000-8000-000000000006','M37R6','M37P1','M37L6','M37IA','SEMANAL',true,true,true,true,true,true,true,NULL),
 ('37000000-0000-4000-8000-000000000007','M37R7','M37P1','M37L7','M37IA','SEMANAL',true,true,true,true,true,true,true,NULL),
 ('37000000-0000-4000-8000-000000000008','M37R8','M37P2','M37L8','M37IA','SEMANAL',true,true,true,true,true,true,true,NULL),
 ('37000000-0000-4000-8000-000000000009','M37R9','M37P3','M37L9','M37IA','SEMANAL',true,true,true,true,true,true,true,NULL);
INSERT INTO public.visits(id,rota_id,promotor_matricula,loja_codigo,industria_codigo,data_visita,scheduled_date,status,started_at,completed_at)
VALUES ('37000000-0000-4000-8000-000000000101','37000000-0000-4000-8000-000000000006',
 'M37P1','M37L6','M37IA',(clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date - 1,
 (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date - 1,'concluida',clock_timestamp() - interval '1 hour',clock_timestamp());
INSERT INTO public.visits(id,rota_id,promotor_matricula,loja_codigo,industria_codigo,data_visita,scheduled_date,status,regularization_status)
VALUES ('37000000-0000-4000-8000-000000000102','37000000-0000-4000-8000-000000000007',
 'M37P1','M37L7','M37IA',(clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date - 1,
 (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date - 1,'nao_realizada','closed_without_execution_proof');
COMMIT;

