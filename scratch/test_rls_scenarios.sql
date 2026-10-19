-- Testes de RLS para contratos_lojas
BEGIN;

-- 1. Inserir fixtures sintéticas de indústria e loja
INSERT INTO public.industrias (codigo, nome, cnpj, status, data_inicio_operacao)
VALUES 
  ('IND-TEST-001', 'Industria Sintetica Teste', '00.000.000/0001-99', 'ativo', '2026-01-01'),
  ('IND-TEST-002', 'Outra Industria Sintetica', '00.000.000/0003-99', 'ativo', '2026-01-01');

INSERT INTO public.lojas (codigo, nome, cnpj, cidade, uf, status)
VALUES ('LOJA-TEST-001', 'Loja Sintetica Teste', '00.000.000/0002-99', 'Sao Paulo', 'SP', 'ativo');

-- Inserir usuários em auth.users (o trigger on_auth_user_created cria a linha correspondente em public.profiles)
INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
VALUES 
  ('22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'operador.teste@mk9.local', now(), now()),
  ('33333333-3333-3333-3333-333333333333', 'authenticated', 'authenticated', 'cliente.teste@mk9.local', now(), now()),
  ('44444444-4444-4444-4444-444444444444', 'authenticated', 'authenticated', 'outro.cliente@mk9.local', now(), now());

-- Atualizar os perfis gerados com suas respectivas roles e vínculos ('client_industry')
UPDATE public.profiles
SET role = 'operador', name = 'Operador Teste', department = 'Operações'
WHERE id = '22222222-2222-2222-2222-222222222222';

UPDATE public.profiles
SET role = 'client_industry', name = 'Cliente Teste', department = 'Comercial', industria_codigo = 'IND-TEST-001'
WHERE id = '33333333-3333-3333-3333-333333333333';

UPDATE public.profiles
SET role = 'client_industry', name = 'Outro Cliente Teste', department = 'Comercial', industria_codigo = 'IND-TEST-002'
WHERE id = '44444444-4444-4444-4444-444444444444';

-- Inserir contrato prévio para IND-TEST-001 e LOJA-TEST-001
INSERT INTO public.contratos_lojas (
  id, industria_codigo, loja_codigo, frequencia, visitas_por_semana,
  segunda, data_inicio_vigencia, data_fim_vigencia, status, valor_por_visita
) VALUES (
  '99999999-9999-9999-9999-999999999999', 'IND-TEST-001', 'LOJA-TEST-001', 'SEMANAL', 1,
  true, '2026-01-01', NULL, 'ativo', 150.00
);

-- TESTE 1: Admin SELECT (deve enxergar 1)
SELECT set_config('request.jwt.claim.sub', '8bd7452a-87d7-4cd3-bc05-c76664ce8734', true);
SET LOCAL ROLE authenticated;
SELECT 'TESTE_1_ADMIN_SELECT' as scenario, count(*) as count FROM public.contratos_lojas;

RESET ROLE;

-- TESTE 2: Cliente da própria indústria (IND-TEST-001) SELECT (deve enxergar 1)
SELECT set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
SET LOCAL ROLE authenticated;
SELECT 'TESTE_2_CLIENTE_PROPRIA_IND_SELECT' as scenario, count(*) as count FROM public.contratos_lojas;

RESET ROLE;

-- TESTE 3: Cliente de outra indústria (IND-TEST-002) SELECT (deve enxergar 0 por isolamento)
SELECT set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);
SET LOCAL ROLE authenticated;
SELECT 'TESTE_3_OUTRO_CLIENTE_SELECT' as scenario, count(*) as count FROM public.contratos_lojas;

RESET ROLE;

-- TESTE 4: Operador tenta DELETE (deve ser bloqueado pelo RLS e não deletar nada)
SELECT set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
SET LOCAL ROLE authenticated;
DELETE FROM public.contratos_lojas WHERE id = '99999999-9999-9999-9999-999999999999';

RESET ROLE;
SELECT 'TESTE_4_AFTER_OPERADOR_DELETE' as scenario, count(*) as count FROM public.contratos_lojas WHERE id = '99999999-9999-9999-9999-999999999999';

-- TESTE 5: Admin tenta DELETE (deve deletar com sucesso)
SELECT set_config('request.jwt.claim.sub', '8bd7452a-87d7-4cd3-bc05-c76664ce8734', true);
SET LOCAL ROLE authenticated;
DELETE FROM public.contratos_lojas WHERE id = '99999999-9999-9999-9999-999999999999';

RESET ROLE;
SELECT 'TESTE_5_AFTER_ADMIN_DELETE' as scenario, count(*) as count FROM public.contratos_lojas WHERE id = '99999999-9999-9999-9999-999999999999';

ROLLBACK;

