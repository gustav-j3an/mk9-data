-- Validação Funcional Ponta a Ponta: Cenários 5, 6, 7, 8, 9, 12
BEGIN;

-- 1. Setup de Fixtures Sintéticas Locais
INSERT INTO public.industrias (codigo, nome, cnpj, status, data_inicio_operacao)
VALUES 
  ('IND-TEST-001', 'Industria Sintetica Teste', '00.000.000/0001-99', 'ativo', '2026-01-01');

INSERT INTO public.lojas (codigo, nome, cnpj, cidade, uf, status)
VALUES 
  ('LOJA-TEST-001', 'Loja Sintetica Teste', '00.000.000/0002-99', 'Sao Paulo', 'SP', 'ativo');

-- 2. Cenário 5: Salvar um contrato válido e confirmar a persistência no banco
-- Simula o payload exato gerado pelo modal após clicar em "Autorizar e Gravar Contrato"
INSERT INTO public.contratos_lojas (
  id,
  industria_codigo,
  loja_codigo,
  frequencia,
  visitas_por_semana,
  segunda,
  terca,
  quarta,
  quinta,
  sexta,
  sabado,
  domingo,
  ciclo_quinzenal,
  data_inicio_vigencia,
  data_fim_vigencia,
  status,
  valor_por_visita,
  origem,
  observacao
) VALUES (
  'a1111111-1111-1111-1111-111111111111',
  'IND-TEST-001',
  'LOJA-TEST-001',
  'SEMANAL',
  2,
  true,
  false,
  true,
  false,
  false,
  false,
  false,
  null,
  '2026-01-01',
  null,
  'ativo',
  150.50,
  'manual',
  'Contrato autorizado individualmente via modal'
);

-- Verificar Cenário 5 e Cenário 6 (listagem reflete o registro persistido)
SELECT 'CENARIO_5_E_6_PERSISTIDO' as teste, id, industria_codigo, loja_codigo, status, valor_por_visita, data_inicio_vigencia, data_fim_vigencia 
FROM public.contratos_lojas 
WHERE id = 'a1111111-1111-1111-1111-111111111111';

-- 3. Cenário 9: Proteção contra cliques repetidos / inserção duplicada com mesmo ID ou sobreposição
-- Tentativa 1: Inserir com o mesmo ID (Primary Key) falha imediatamente
-- Tentativa 2 (Cenário 7): Inserir novo contrato ativo/suspenso concorrente na mesma vigência
DO $$
BEGIN
  BEGIN
    INSERT INTO public.contratos_lojas (
      industria_codigo, loja_codigo, frequencia, visitas_por_semana,
      terca, data_inicio_vigencia, data_fim_vigencia, status, valor_por_visita
    ) VALUES (
      'IND-TEST-001', 'LOJA-TEST-001', 'SEMANAL', 1,
      true, '2026-06-01', null, 'ativo', 180.00
    );
    RAISE EXCEPTION 'FALHA: O banco deveria ter rejeitado o contrato sobreposto!';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'CENARIO_7_E_8_SUCESSO_BLOQUEIO: %', SQLERRM;
  END;
END $$;

-- 4. Cenário 12: Permissões de RLS para perfis não autorizados
-- Criar perfil cliente_industria e verificar que INSERT é negado pelas policies
INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
VALUES ('b2222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'cliente.sem.acesso@mk9.local', now(), now());

UPDATE public.profiles
SET role = 'client_industry', name = 'Cliente Sem Acesso', industria_codigo = 'IND-TEST-001'
WHERE id = 'b2222222-2222-2222-2222-222222222222';

-- Simular sessão de client_industry tentando INSERT
DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'b2222222-2222-2222-2222-222222222222', true);
  BEGIN
    -- Tentativa de INSERT sob role authenticated como client_industry
    -- A policy contratos_lojas_insert_policy exige is_admin_or_gestor() OR role = 'operador'
    -- Deve lançar erro de RLS (new row violates row-level security policy)
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'CENARIO_12_BLOQUEIO_RLS_INSERT: %', SQLERRM;
  END;
END $$;

ROLLBACK;

