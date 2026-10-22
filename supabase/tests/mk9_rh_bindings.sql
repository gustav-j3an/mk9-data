-- Synthetic data only. Entire test transaction is rolled back. No operational data is reassigned.
BEGIN;
INSERT INTO public.profiles(id,name,role,status) VALUES
 ('10000000-0000-0000-0000-000000000001','Synthetic own','promotor','ativo'),
 ('10000000-0000-0000-0000-000000000002','Synthetic supervisor','promotor','ativo'),
 ('10000000-0000-0000-0000-000000000003','Synthetic manager','admin','ativo'),
 ('10000000-0000-0000-0000-000000000004','Unmapped admin','admin','ativo');
INSERT INTO public.promotores(id,matricula,nome,status,equipe) VALUES
 ('20000000-0000-0000-0000-000000000001','PRM-LOCAL-1','Synthetic A','ativo','SAME OPERATIONAL TEAM'),
 ('20000000-0000-0000-0000-000000000002','PRM-LOCAL-2','Synthetic B','ativo','SAME OPERATIONAL TEAM');
CREATE TEMP TABLE operational_before AS SELECT md5(jsonb_agg(to_jsonb(p) ORDER BY id)::text) AS fingerprint FROM public.promotores p;
INSERT INTO public.mk9_identidades(promotor_id,usuario_id,estado,aprovado_por,aprovado_em,referencia) VALUES
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','aprovado','10000000-0000-0000-0000-000000000003',now(),'SYNTHETIC test approval'),
 ('20000000-0000-0000-0000-000000000002',null,'aprovado','10000000-0000-0000-0000-000000000003',now(),'SYNTHETIC test approval');
INSERT INTO public.mk9_alocacoes(id,promotor_id,projeto_externo_id,matricula_externa,ocorrencias_desde,valido_desde,estado,aprovado_por,aprovado_em,referencia) VALUES
 ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','65f7e80f-f615-4ceb-9b8d-80db170735dc','0000042','2026-10-01',now()-interval '1 day','aprovado','10000000-0000-0000-0000-000000000003',now(),'SYNTHETIC test approval'),
 ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','89bccfec-5f8e-4925-8702-6af0d984d5bf','0000042','2026-10-01',now()-interval '1 day','aprovado','10000000-0000-0000-0000-000000000003',now(),'SYNTHETIC test approval'),
 ('30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000002','89bccfec-5f8e-4925-8702-6af0d984d5bf','B-MT','2026-10-01',now()-interval '1 day','aprovado','10000000-0000-0000-0000-000000000003',now(),'SYNTHETIC test approval');
INSERT INTO public.mk9_acessos(usuario_id,alocacao_id,tipo,estado,valido_desde,aprovado_por,aprovado_em,referencia) VALUES
 ('10000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','supervisao','aprovado',now()-interval '1 day','10000000-0000-0000-0000-000000000003',now(),'SYNTHETIC scope'),
 ('10000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000003','gestao','aprovado',now()-interval '1 day','10000000-0000-0000-0000-000000000003',now(),'SYNTHETIC scope');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.mk9_rh_scope('mine'))<>2 THEN RAISE EXCEPTION 'Own multi-project scope failed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.mk9_rh_scope('mine') WHERE matricula_local='PRM-LOCAL-1' AND matricula_externa='0000042') THEN RAISE EXCEPTION 'Identity translation failed'; END IF;
 IF EXISTS(SELECT 1 FROM public.mk9_rh_scope('management')) THEN RAISE EXCEPTION 'Own account escalated'; END IF;
 BEGIN PERFORM * FROM public.mk9_identidades; RAISE EXCEPTION 'Raw identities exposed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN INSERT INTO public.mk9_acessos(usuario_id,alocacao_id,tipo,estado,valido_desde,referencia) VALUES(auth.uid(),'30000000-0000-0000-0000-000000000003','gestao','pendente',now(),'FORGED'); RAISE EXCEPTION 'Frontend write accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.mk9_rh_scope('team'))<>1 THEN RAISE EXCEPTION 'Partial supervisor scope failed'; END IF;
 IF EXISTS(SELECT 1 FROM public.mk9_rh_scope('team') WHERE matricula_externa='B-MT') THEN RAISE EXCEPTION 'Same team leaked another project'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.mk9_rh_scope('management'))<>1 THEN RAISE EXCEPTION 'Limited manager scope failed'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000004',true);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.mk9_rh_scope('management')) THEN RAISE EXCEPTION 'Operational admin granted RH implicitly'; END IF;
END $$;
RESET ROLE;

DO $$ BEGIN
 BEGIN INSERT INTO public.mk9_alocacoes(promotor_id,projeto_externo_id,matricula_externa,ocorrencias_desde,valido_desde,referencia) VALUES('20000000-0000-0000-0000-000000000002','65f7e80f-f615-4ceb-9b8d-80db170735dc','0000042','2026-10-01',now(),'DUPLICATE'); RAISE EXCEPTION 'External duplicate accepted'; EXCEPTION WHEN unique_violation THEN NULL; END;
 BEGIN UPDATE public.mk9_alocacoes SET matricula_externa='DIFFERENT' WHERE id='30000000-0000-0000-0000-000000000001'; RAISE EXCEPTION 'External identity reassigned'; EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
UPDATE public.mk9_acessos SET estado='revogado' WHERE tipo='supervisao';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.mk9_rh_scope('team')) THEN RAISE EXCEPTION 'Revoked supervisor still authorized'; END IF; END $$;
RESET ROLE;
UPDATE public.mk9_alocacoes SET valido_ate=now()-interval '1 hour' WHERE id='30000000-0000-0000-0000-000000000002';
UPDATE public.mk9_alocacoes SET estado='revogado' WHERE id='30000000-0000-0000-0000-000000000001';
DO $$ BEGIN
 IF (SELECT jsonb_array_length(historico) FROM public.mk9_alocacoes WHERE id='30000000-0000-0000-0000-000000000001')<>2 THEN RAISE EXCEPTION 'Change history missing'; END IF;
 IF (SELECT fingerprint FROM operational_before)<>(SELECT md5(jsonb_agg(to_jsonb(p) ORDER BY id)::text) FROM public.promotores p) THEN RAISE EXCEPTION 'Operational data changed'; END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.mk9_rh_scope('mine')) THEN RAISE EXCEPTION 'Expired or revoked allocation still authorized'; END IF; END $$;
RESET ROLE;
-- Expired grants and unapproved identities are denied independently of allocation state.
UPDATE public.mk9_acessos SET valido_ate=now()-interval '1 hour' WHERE tipo='gestao';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.mk9_rh_scope('management')) THEN RAISE EXCEPTION 'Expired grant accepted'; END IF; END $$;
RESET ROLE;
UPDATE public.mk9_acessos SET valido_ate=null WHERE tipo='gestao';
UPDATE public.mk9_identidades SET estado='pendente' WHERE promotor_id='20000000-0000-0000-0000-000000000002';
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.mk9_rh_scope('management')) THEN RAISE EXCEPTION 'Unapproved identity accepted'; END IF; END $$;
RESET ROLE;
-- Explicit synthetic deletion compatibility check: do not block existing person/account deletion.
DELETE FROM public.promotores WHERE id='20000000-0000-0000-0000-000000000001';
DO $$ BEGIN
 IF (SELECT count(*) FROM public.mk9_alocacoes WHERE promotor_id IS NULL AND estado='revogado')<>2 THEN RAISE EXCEPTION 'Historical reservation lost on source deletion'; END IF;
 BEGIN INSERT INTO public.mk9_alocacoes(promotor_id,projeto_externo_id,matricula_externa,ocorrencias_desde,valido_desde,referencia) VALUES('20000000-0000-0000-0000-000000000002','65f7e80f-f615-4ceb-9b8d-80db170735dc','0000042','2026-10-01',now(),'REUSED'); RAISE EXCEPTION 'Historical matricula reused'; EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;
DELETE FROM public.profiles WHERE id='10000000-0000-0000-0000-000000000003';
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM * FROM public.mk9_rh_scope('mine'); RAISE EXCEPTION 'Anonymous RPC accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT 'PASS: isolated PostgreSQL RLS, explicit identity, scoped grants, integrity, history, revocation and unchanged operational rows' AS result;
ROLLBACK;
