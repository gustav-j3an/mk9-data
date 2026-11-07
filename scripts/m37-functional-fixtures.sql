-- Fixtures exclusivas da stack descartável do GitHub Actions.
-- IDs de usuários vêm do Auth real e são passados via psql -v.
BEGIN;
INSERT INTO public.industrias(codigo,nome,status) VALUES
 ('M37IA','Synthetic active','ativo'),
 ('M37II','Synthetic inactive','inativo'),
 ('M37IC','Synthetic concurrent','ativo');
INSERT INTO public.lojas(codigo,nome,cidade,uf,endereco,status) VALUES
 ('M37L1','Synthetic 1','Teste','SP','Teste','ativo'),
 ('M37L2','Synthetic 2','Teste','SP','Teste','ativo'),
 ('M37L3','Synthetic 3','Teste','SP','Teste','ativo'),
 ('M37L4','Synthetic 4','Teste','SP','Teste','ativo'),
 ('M37L5','Synthetic 5','Teste','SP','Teste','ativo'),
 ('M37L6','Synthetic 6','Teste','SP','Teste','ativo'),
 ('M37L7','Synthetic 7','Teste','SP','Teste','ativo'),
 ('M37L8','Synthetic 8','Teste','SP','Teste','ativo'),
 ('M37L9','Synthetic 9','Teste','SP','Teste','ativo'),
 ('M37L10','Synthetic 10','Teste','SP','Teste','ativo'),
 ('M37L11','Synthetic 11','Teste','SP','Teste','ativo'),
 ('M37L12','Synthetic 12','Teste','SP','Teste','ativo'),
 ('M37L13','Synthetic 13','Teste','SP','Teste','ativo'),
 ('M37L14','Synthetic 14','Teste','SP','Teste','ativo'),
 ('M37L15','Synthetic 15','Teste','SP','Teste','ativo'),
 ('M37L16','Synthetic 16','Teste','SP','Teste','ativo'),
 ('M37L17','Synthetic 17','Teste','SP','Teste','ativo');
INSERT INTO public.promotores(matricula,nome,cidade,uf,status) VALUES
 ('M37P1','Synthetic promoter 1','Teste','SP','ativo'),
 ('M37P2','Synthetic promoter 2','Teste','SP','ativo'),
 ('M37P3','Synthetic promoter 3','Teste','SP','ativo'),
 ('M37P4','Synthetic promoter 4','Teste','SP','ativo');
UPDATE public.profiles SET role='promotor', status='ativo', promotor_matricula='M37P1'
WHERE id=:'user1';
UPDATE public.profiles SET role='promotor', status='ativo', promotor_matricula='M37P2'
WHERE id=:'user2';
UPDATE public.profiles SET role='promotor', status='ativo', promotor_matricula='M37P3'
WHERE id=:'user3';
UPDATE public.profiles SET role='promotor', status='ativo', promotor_matricula='M37P4'
WHERE id=:'user4';
INSERT INTO public.promoter_operation_authorizations(promotor_matricula,status,justification)
VALUES ('M37P1','liberado','Isolated functional test'),
 ('M37P2','liberado','Isolated functional test'),
 ('M37P3','liberado','Isolated functional test'),
 ('M37P4','liberado','Isolated functional test');
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
 ('37000000-0000-4000-8000-000000000009','M37R9','M37P3','M37L9','M37IA','SEMANAL',true,true,true,true,true,true,true,NULL),
 ('37000000-0000-4000-8000-000000000010','M37R10','M37P4','M37L10','M37IA','SEMANAL',true,true,true,true,true,true,true,NULL),
 ('37000000-0000-4000-8000-000000000011','M37R11','M37P4','M37L11','M37IA','SEMANAL',true,true,true,true,true,true,true,NULL),
 ('37000000-0000-4000-8000-000000000012','M37R12','M37P4','M37L12','M37IA','SEMANAL',true,true,true,true,true,true,true,NULL),
 ('37000000-0000-4000-8000-000000000013','M37R13','M37P4','M37L13','M37IA','SEMANAL',true,true,true,true,true,true,true,NULL),
 ('37000000-0000-4000-8000-000000000014','M37R14','M37P1','M37L14','M37IA','SEMANAL',true,true,true,true,true,true,true,
  (((clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date + 5)::timestamp AT TIME ZONE 'America/Sao_Paulo')),
 ('37000000-0000-4000-8000-000000000015','M37R15','M37P4','M37L15','M37IA','SEMANAL',true,true,true,true,true,true,true,NULL),
 ('37000000-0000-4000-8000-000000000016','M37R16','M37P3','M37L16','M37IA','SEMANAL',true,true,true,true,true,true,true,NULL),
 ('37000000-0000-4000-8000-000000000017','M37R17','M37P1','M37L17','M37IC','SEMANAL',true,true,true,true,true,true,true,NULL);
INSERT INTO public.visits(id,rota_id,promotor_matricula,loja_codigo,industria_codigo,data_visita,scheduled_date,status,started_at,completed_at)
VALUES ('37000000-0000-4000-8000-000000000101','37000000-0000-4000-8000-000000000006',
 'M37P1','M37L6','M37IA',(clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date - 1,
 (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date - 1,'concluida',clock_timestamp() - interval '1 hour',clock_timestamp());
INSERT INTO public.visits(id,rota_id,promotor_matricula,loja_codigo,industria_codigo,data_visita,scheduled_date,status,regularization_status)
VALUES ('37000000-0000-4000-8000-000000000102','37000000-0000-4000-8000-000000000007',
 'M37P1','M37L7','M37IA',(clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date - 1,
 (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date - 1,'nao_realizada','closed_without_execution_proof');
INSERT INTO public.visits(id,rota_id,promotor_matricula,loja_codigo,industria_codigo,data_visita,scheduled_date,status)
VALUES ('37000000-0000-4000-8000-000000000103','37000000-0000-4000-8000-000000000010',
 'M37P4','M37L10','M37IA',(clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date - 1,
 (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date - 1,'pendente');
INSERT INTO public.visits(id,rota_id,promotor_matricula,loja_codigo,industria_codigo,data_visita,scheduled_date,status)
VALUES ('37000000-0000-4000-8000-000000000104','37000000-0000-4000-8000-000000000011',
 'M37P4','M37L11','M37IA',(clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date - 1,
 (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date - 1,'nao_realizada');
INSERT INTO public.visits(id,rota_id,promotor_matricula,loja_codigo,industria_codigo,data_visita,scheduled_date,status)
VALUES ('37000000-0000-4000-8000-000000000105','37000000-0000-4000-8000-000000000012',
 'M37P4','M37L12','M37IA',(clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date - 1,
 (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date - 1,'pendente');
INSERT INTO public.visit_checklist_items(id,visit_id,item_key,item_label,checked)
VALUES ('37000000-0000-4000-8000-000000000201','37000000-0000-4000-8000-000000000105',
 'estoque_conferido','Conferencia de estoque',true);
INSERT INTO public.visits(id,rota_id,promotor_matricula,loja_codigo,industria_codigo,data_visita,scheduled_date,status,started_at)
VALUES ('37000000-0000-4000-8000-000000000106','37000000-0000-4000-8000-000000000013',
 'M37P4','M37L13','M37IA',(clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date - 1,
 (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date - 1,'em_andamento',clock_timestamp() - interval '24 hours');
INSERT INTO public.visits(id,rota_id,promotor_matricula,loja_codigo,industria_codigo,data_visita,scheduled_date,status)
VALUES ('37000000-0000-4000-8000-000000000107','37000000-0000-4000-8000-000000000015',
 'M37P4','M37L15','M37IA',(clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date - 1,
 (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date - 1,'pendente');
INSERT INTO public.visit_product_validity(id,visit_id,produto_nome,quantidade,data_vencimento)
VALUES ('37000000-0000-4000-8000-000000000301','37000000-0000-4000-8000-000000000107',
 'Produto Validade Teste',1,(clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date + 30);
INSERT INTO public.visits(id,rota_id,promotor_matricula,loja_codigo,industria_codigo,data_visita,scheduled_date,status)
VALUES ('37000000-0000-4000-8000-000000000108','37000000-0000-4000-8000-000000000016',
 'M37P3','M37L16','M37IA',(clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date - 1,
 (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date - 1,'pendente');
COMMIT;
