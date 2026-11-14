-- Fixtures sintéticas, exclusivas da stack local descartável PostgreSQL 17.
BEGIN;

INSERT INTO public.industrias(codigo, nome, status)
VALUES ('M38IA', 'Synthetic M38 Industry', 'ativo');

INSERT INTO public.lojas(codigo, nome, cidade, uf, endereco, status)
VALUES
  ('M38L1','Synthetic M38 Store 1','Teste','SP','Teste','ativo'),
  ('M38L2','Synthetic M38 Store 2','Teste','SP','Teste','ativo'),
  ('M38L3','Synthetic M38 Store 3','Teste','SP','Teste','ativo'),
  ('M38L4','Synthetic M38 Store 4','Teste','SP','Teste','ativo'),
  ('M38L5','Synthetic M38 Store 5','Teste','SP','Teste','ativo'),
  ('M38L6','Synthetic M38 Store 6','Teste','SP','Teste','ativo'),
  ('M38L7','Synthetic M38 Store 7','Teste','SP','Teste','ativo'),
  ('M38L8','Synthetic M38 Store 8','Teste','SP','Teste','ativo');

INSERT INTO public.promotores(matricula, nome, cidade, uf, status)
VALUES
  ('M38P1','Synthetic M38 Promoter 1','Teste','SP','ativo'),
  ('M38P2','Synthetic M38 Promoter 2','Teste','SP','ativo'),
  ('M38P3','Synthetic M38 Promoter 3','Teste','SP','ativo'),
  ('M38P4','Synthetic M38 Promoter 4','Teste','SP','ativo'),
  ('M38P5','Synthetic M38 Promoter 5','Teste','SP','ativo'),
  ('M38P6','Synthetic M38 Promoter 6','Teste','SP','ativo');

UPDATE public.profiles SET role='promotor', status='ativo', promotor_matricula='M38P1' WHERE id=:'user1';
UPDATE public.profiles SET role='promotor', status='ativo', promotor_matricula='M38P2' WHERE id=:'user2';
UPDATE public.profiles SET role='promotor', status='ativo', promotor_matricula='M38P3' WHERE id=:'user3';
UPDATE public.profiles SET role='promotor', status='ativo', promotor_matricula='M38P4' WHERE id=:'user4';
UPDATE public.profiles SET role='promotor', status='ativo', promotor_matricula='M38P5' WHERE id=:'user5';
UPDATE public.profiles SET role='promotor', status='ativo', promotor_matricula='M38P6' WHERE id=:'user6';
UPDATE public.profiles SET role='gestor', status='ativo', promotor_matricula=NULL WHERE id=:'user7';

INSERT INTO public.promoter_operation_authorizations(promotor_matricula, status, justification)
SELECT 'M38P' || n, 'liberado', 'Isolated Mission 38 integration test' FROM generate_series(1,6) n;

INSERT INTO public.promoter_work_schedules(promotor_matricula, dia_semana, hora_inicio, hora_fim, ativo, timezone)
SELECT 'M38P' || n, d.day_name, '22:00', '06:00', true, 'America/Sao_Paulo'
FROM generate_series(1,2) n
CROSS JOIN (VALUES ('segunda'),('terca'),('quarta'),('quinta'),('sexta'),('sabado'),('domingo')) d(day_name);

INSERT INTO public.rotas(id,codigo_rota,promotor_matricula,loja_codigo,industria_codigo,frequencia,
  segunda,terca,quarta,quinta,sexta,sabado,domingo,encerrada_em)
VALUES
 ('38000000-0000-4000-8000-000000000001','M38R1','M38P1','M38L1','M38IA','SEMANAL',true,true,true,true,true,true,true,NULL),
 ('38000000-0000-4000-8000-000000000002','M38R2','M38P1','M38L2','M38IA','SEMANAL',true,true,true,true,true,true,true,NULL),
 ('38000000-0000-4000-8000-000000000003','M38R3','M38P2','M38L3','M38IA','SEMANAL',true,true,true,true,true,true,true,NULL),
 ('38000000-0000-4000-8000-000000000004','M38R4','M38P3','M38L4','M38IA','SEMANAL',true,true,true,true,true,true,true,NULL),
 ('38000000-0000-4000-8000-000000000005','M38R5','M38P4','M38L5','M38IA','SEMANAL',true,true,true,true,true,true,true,NULL),
 ('38000000-0000-4000-8000-000000000006','M38R6','M38P5','M38L6','M38IA','SEMANAL',true,true,true,true,true,true,true,NULL),
 ('38000000-0000-4000-8000-000000000007','M38R7','M38P6','M38L7','M38IA','SEMANAL',true,true,true,true,true,true,true,NULL),
 ('38000000-0000-4000-8000-000000000008','M38R8','M38P6','M38L8','M38IA','SEMANAL',true,true,true,true,true,true,true,NULL);

INSERT INTO public.system_settings(key,value)
VALUES ('operation_mode','"IMPLANTACAO"'::jsonb)
ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value;

-- As tentativas P1/P2 começaram após meia-noite em uma escala noturna; sua
-- data efetiva anterior é válida, enquanto started_at continua no dia atual.
INSERT INTO public.visits(id,rota_id,promotor_matricula,loja_codigo,industria_codigo,data_visita,scheduled_date,status,started_at)
VALUES
 ('38000000-0000-4000-8000-000000000101','38000000-0000-4000-8000-000000000001','M38P1','M38L1','M38IA',
  (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date - 1,
  (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date - 1,'em_andamento',
  (((clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date)::timestamp AT TIME ZONE 'America/Sao_Paulo') + interval '15 minutes'),
 ('38000000-0000-4000-8000-000000000102','38000000-0000-4000-8000-000000000002','M38P1','M38L2','M38IA',
  (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date - 1,
  (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date - 1,'em_andamento',
  (((clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date)::timestamp AT TIME ZONE 'America/Sao_Paulo') + interval '20 minutes'),
 ('38000000-0000-4000-8000-000000000103','38000000-0000-4000-8000-000000000003','M38P2','M38L3','M38IA',
  (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date - 1,
  (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date - 1,'em_andamento',
  (((clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date)::timestamp AT TIME ZONE 'America/Sao_Paulo') + interval '25 minutes'),
 ('38000000-0000-4000-8000-000000000104','38000000-0000-4000-8000-000000000004','M38P3','M38L4','M38IA',
  (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date - 1,
  (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date - 1,'em_andamento',
  (((clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date)::timestamp AT TIME ZONE 'America/Sao_Paulo') - interval '30 minutes'),
 ('38000000-0000-4000-8000-000000000105','38000000-0000-4000-8000-000000000005','M38P4','M38L5','M38IA',
  (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date - 1,
  (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date - 1,'concluida',
  (((clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date)::timestamp AT TIME ZONE 'America/Sao_Paulo') - interval '2 hours'),
 ('38000000-0000-4000-8000-000000000106','38000000-0000-4000-8000-000000000006','M38P5','M38L6','M38IA',
  (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date,
  (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date - 1,'em_andamento',
  ((clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date::timestamp AT TIME ZONE 'America/Sao_Paulo')),
 ('38000000-0000-4000-8000-000000000107','38000000-0000-4000-8000-000000000007','M38P6','M38L7','M38IA',
  (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date - 1,
  (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date - 1,'em_andamento',
  (((clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date)::timestamp AT TIME ZONE 'America/Sao_Paulo') - interval '1 second');

UPDATE public.visits SET completed_at=started_at + interval '30 minutes'
WHERE id='38000000-0000-4000-8000-000000000105';

INSERT INTO public.visit_checklist_items(visit_id,item_key,item_label,checked)
VALUES
 ('38000000-0000-4000-8000-000000000101','m38-test','M38 evidence fixture',true),
 ('38000000-0000-4000-8000-000000000103','m38-test','M38 evidence fixture',true),
 ('38000000-0000-4000-8000-000000000104','m38-test','M38 evidence fixture',true),
 ('38000000-0000-4000-8000-000000000107','m38-test','M38 evidence fixture',true);

COMMIT;
