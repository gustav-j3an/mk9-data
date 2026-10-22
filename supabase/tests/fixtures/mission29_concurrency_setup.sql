-- Synthetic committed actors/routes for two independent psql sessions.
-- Run only inside the disposable mission-29 PostgreSQL database.
INSERT INTO auth.users(id,email) VALUES
 ('00000000-0000-4000-8000-000000002101','m29-admin@example.invalid'),
 ('00000000-0000-4000-8000-000000002102','m29-promoter@example.invalid');
INSERT INTO public.promotores(matricula,nome,cidade,uf,status,equipe)
VALUES ('M29-CONC','Synthetic Concurrency Promoter','Synthetic','SP','ativo','M29-TEAM');
INSERT INTO public.profiles(id,email,name,role,status,promotor_matricula) VALUES
 ('00000000-0000-4000-8000-000000002101','m29-admin@example.invalid','Synthetic Admin','admin','ativo',NULL),
 ('00000000-0000-4000-8000-000000002102','m29-promoter@example.invalid','Synthetic Promoter','promotor','ativo','M29-CONC');
INSERT INTO public.industrias(codigo,nome,status) VALUES ('M29-IND','Synthetic Industry','ativo');
INSERT INTO public.lojas(codigo,nome,cidade,uf,status) VALUES
 ('M29-STORE-A','Synthetic Store A','Synthetic','SP','ativo'),
 ('M29-STORE-B','Synthetic Store B','Synthetic','SP','ativo');
INSERT INTO public.rotas(codigo_rota,promotor_matricula,loja_codigo,industria_codigo,frequencia,uf,segunda,terca,quarta,quinta,sexta,sabado,domingo)
VALUES ('M29-ROUTE-A','M29-CONC','M29-STORE-A','M29-IND','SEMANAL','SP',true,true,true,true,true,true,true),
       ('M29-ROUTE-B','M29-CONC','M29-STORE-B','M29-IND','SEMANAL','SP',true,true,true,true,true,true,true);
INSERT INTO public.system_settings(key,value) VALUES ('operation_mode','"OPERACAO_OFICIAL"'::jsonb);
INSERT INTO public.visits(id,promotor_matricula,loja_codigo,industria_codigo,data_visita,started_at,status)
VALUES ('00000000-0000-4000-8000-000000002111','M29-CONC','M29-STORE-A','M29-IND',(now() AT TIME ZONE 'America/Sao_Paulo')::date-5,now()-interval '5 days','em_andamento');
