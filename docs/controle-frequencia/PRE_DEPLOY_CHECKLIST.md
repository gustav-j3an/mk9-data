# CHECKLIST RIGOROSO DE PRÉ-IMPLANTAÇÃO (SOMENTE LEITURA)
**Módulo:** `public.contratos_lojas`  
**Migration:** `supabase/migrations/20261017120000_create_contratos_lojas_table.sql`  
**Objetivo:** Validar via catálogo nativo do PostgreSQL (`pg_catalog`) todos os pré-requisitos antes de executar a DDL.

---

## 1. Princípios de Execução da Pré-Verificação
1. **Determinismo:** Toda dependência produz exatamente uma linha com status explícito: `APROVADO`, `BLOQUEADO` ou `REQUER ANÁLISE`.
2. **Critério de Parada:** Se qualquer linha retornar `BLOQUEADO` ou `REQUER ANÁLISE`, **a implantação deve ser interrompida imediatamente**.
3. **Somente Leitura:** Esta consulta não cria, altera ou exclui objetos.
4. **Sintaxe Unificada:** Todas as CTEs (`WITH`) estão concentradas no início da consulta, tornando o SQL válido e executável em lote único no PostgreSQL.

---

## 2. Consulta SQL Completa de Pré-Verificação

Execute o bloco abaixo no SQL Editor do Supabase:

```sql
-- ==============================================================================
-- MK9 DATE - PRÉ-VERIFICAÇÃO DE PRÉ-REQUISITOS (SOMENTE LEITURA / PG_CATALOG)
-- ==============================================================================

WITH 
-- 1. Definição das Tabelas-Base Requeridas
req_tables(table_name) AS (
  VALUES 
    ('industrias'), 
    ('lojas'), 
    ('profiles'), 
    ('rotas'), 
    ('visits')
),

-- 2. Definição das Relações de Chaves Estrangeiras (Origem e Destino com Tipos)
req_fk_columns(fk_name, target_table, target_column, target_type, future_source_table, future_source_column, future_source_type) AS (
  VALUES 
    ('fk_contratos_industria', 'industrias', 'codigo', 'text', 'contratos_lojas', 'industria_codigo', 'text'),
    ('fk_contratos_loja',      'lojas',      'codigo', 'text', 'contratos_lojas', 'loja_codigo',      'text')
),

-- 3. Definição das Colunas Dependentes Obrigatórias
req_cols(table_name, column_name, expected_type, is_nullable) AS (
  VALUES 
    ('profiles', 'id',                 'uuid',    false),
    ('profiles', 'role',               'text',    true),
    ('profiles', 'industria_codigo',   'text',    true),
    ('profiles', 'promotor_matricula', 'text',    true),
    ('rotas',    'industria_codigo',   'text',    false),
    ('rotas',    'loja_codigo',        'text',    false),
    ('rotas',    'promotor_matricula', 'text',    false),
    ('rotas',    'frequencia',         'text',    true),
    ('rotas',    'segunda',            'bool',    true),
    ('rotas',    'terca',              'bool',    true),
    ('rotas',    'quarta',             'bool',    true),
    ('rotas',    'quinta',             'bool',    true),
    ('rotas',    'sexta',              'bool',    true),
    ('rotas',    'sabado',             'bool',    true),
    ('rotas',    'domingo',            'bool',    true)
),

-- 4. Definição das Funções RBAC Pré-Existentes
req_rbac_funcs(func_name, expected_args, return_type) AS (
  VALUES 
    ('is_admin_or_gestor',          '', 'bool'),
    ('get_auth_industria_codigo',   '', 'text'),
    ('get_auth_promotor_matricula', '', 'text')
),

-- 5. Definição das Novas Funções a Serem Criadas
target_new_funcs(func_name) AS (
  VALUES 
    ('check_contratos_vigencia_overlap'),
    ('handle_contratos_updated_at'),
    ('sync_contratos_from_rotas')
),

-- 6. Definição dos Privilégios Base a Avaliar
req_privileges(priv_type, object_name, grantee_role, privilege_tested) AS (
  VALUES 
    ('SCHEMA_USAGE',  'public', 'authenticated', 'USAGE'),
    ('SCHEMA_USAGE',  'public', 'anon',          'USAGE'),
    ('SCHEMA_CREATE', 'public', 'authenticated', 'CREATE')
)

-- ------------------------------------------------------------------------------
-- SEÇÃO 1: TABELAS-BASE OPERACIONAIS OBRIGATÓRIAS
-- ------------------------------------------------------------------------------
SELECT 
  '1. TABELA_BASE' AS categoria,
  r.table_name AS item_verificado,
  CASE 
    WHEN c.relname IS NOT NULL AND c.relkind = 'r' THEN 'APROVADO'
    ELSE 'BLOQUEADO'
  END AS status,
  CASE 
    WHEN c.relname IS NOT NULL AND c.relkind = 'r' 
    THEN 'Tabela base ordinária (relkind=r) existe no schema public.'
    ELSE 'Tabela base obrigatória ausente no schema public. Implantação não pode prosseguir.'
  END AS detalhe
FROM req_tables r
LEFT JOIN pg_catalog.pg_class c 
  ON c.relname = r.table_name 
  AND c.relnamespace = (SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = 'public')

UNION ALL

-- ------------------------------------------------------------------------------
-- SEÇÃO 2: ESTADO PRÉVIO DA TABELA ALVO (contratos_lojas)
-- ------------------------------------------------------------------------------
SELECT 
  '2. ESTADO_ALVO',
  'public.contratos_lojas',
  CASE 
    WHEN c.relname IS NULL THEN 'APROVADO'
    ELSE 'BLOQUEADO'
  END,
  CASE 
    WHEN c.relname IS NULL 
    THEN 'Tabela inexistente. Pronto para criação limpa.'
    ELSE 'BLOQUEIO CRÍTICO: Tabela contratos_lojas já existe no banco. Não confie em CREATE TABLE IF NOT EXISTS; realize diff explícito de colunas e constraints antes de aplicar.'
  END
FROM (SELECT 1) _
LEFT JOIN pg_catalog.pg_class c 
  ON c.relname = 'contratos_lojas' 
  AND c.relnamespace = (SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = 'public')

UNION ALL

-- ------------------------------------------------------------------------------
-- SEÇÃO 3: VALIDAÇÃO COMPLETA DE CONSTRAINT E TIPOS DE CHAVE ESTRANGEIRA
-- ------------------------------------------------------------------------------
SELECT 
  '3. COMPATIBILIDADE_FK',
  fk.future_source_table || '.' || fk.future_source_column || ' -> ' || fk.target_table || '.' || fk.target_column,
  CASE 
    WHEN con.conname IS NOT NULL AND typ.typname = fk.target_type AND fk.future_source_type = fk.target_type THEN 'APROVADO'
    WHEN con.conname IS NOT NULL AND typ.typname != fk.target_type THEN 'BLOQUEADO'
    ELSE 'BLOQUEADO'
  END,
  CASE 
    WHEN con.conname IS NOT NULL AND typ.typname = fk.target_type AND fk.future_source_type = fk.target_type
    THEN 'Coluna de destino ' || fk.target_table || '.' || fk.target_column || ' possui constraint ' || 
         CASE con.contype WHEN 'p' THEN 'PRIMARY KEY' WHEN 'u' THEN 'UNIQUE' END || 
         ' (' || con.conname || ') mono-coluna e tipo compatível (' || typ.typname || ').'
    WHEN con.conname IS NOT NULL AND typ.typname != fk.target_type
    THEN 'Incompatibilidade de tipos: destino ' || typ.typname || ', origem pretendida ' || fk.future_source_type || '.'
    ELSE 'Coluna ' || fk.target_table || '.' || fk.target_column || ' não possui constraint UNIQUE ou PK estrita de coluna única.'
  END
FROM req_fk_columns fk
LEFT JOIN pg_catalog.pg_class cl_target 
  ON cl_target.relname = fk.target_table 
  AND cl_target.relnamespace = (SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = 'public')
LEFT JOIN pg_catalog.pg_attribute att_target 
  ON att_target.attrelid = cl_target.oid 
  AND att_target.attname = fk.target_column 
  AND NOT att_target.attisdropped
LEFT JOIN pg_catalog.pg_type typ 
  ON typ.oid = att_target.atttypid
LEFT JOIN pg_catalog.pg_constraint con 
  ON con.conrelid = cl_target.oid 
  AND con.contype IN ('p', 'u')
  AND con.conkey = ARRAY[att_target.attnum]

UNION ALL

-- ------------------------------------------------------------------------------
-- SEÇÃO 4: COLUNAS DEPENDENTES (TIPOS E NULABILIDADE)
-- ------------------------------------------------------------------------------
SELECT 
  '4. COLUNA_DEPENDENTE',
  rc.table_name || '.' || rc.column_name,
  CASE 
    WHEN a.attname IS NULL THEN 'BLOQUEADO'
    WHEN t.typname != rc.expected_type THEN 'REQUER ANÁLISE'
    WHEN rc.is_nullable = false AND a.attnotnull = false THEN 'REQUER ANÁLISE'
    ELSE 'APROVADO'
  END,
  CASE 
    WHEN a.attname IS NULL 
    THEN 'Coluna obrigatória ausente na tabela ' || rc.table_name || '.'
    WHEN t.typname != rc.expected_type 
    THEN 'Tipo divergente em ' || rc.table_name || '.' || rc.column_name || ': esperado ' || rc.expected_type || ', encontrado ' || t.typname || '.'
    WHEN rc.is_nullable = false AND a.attnotnull = false 
    THEN 'Coluna ' || rc.table_name || '.' || rc.column_name || ' aceita NULL, mas a regra operacional exige NOT NULL.'
    ELSE 'Coluna presente com tipo correto (' || t.typname || ') e nulabilidade verificada.'
  END
FROM req_cols rc
LEFT JOIN pg_catalog.pg_class cl 
  ON cl.relname = rc.table_name 
  AND cl.relnamespace = (SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = 'public')
LEFT JOIN pg_catalog.pg_attribute a 
  ON a.attrelid = cl.oid 
  AND a.attname = rc.column_name 
  AND NOT a.attisdropped
LEFT JOIN pg_catalog.pg_type t 
  ON t.oid = a.atttypid

UNION ALL

-- ------------------------------------------------------------------------------
-- SEÇÃO 5: FUNÇÕES AUXILIARES RBAC (ASSINATURA, RETORNO E AMBIGUIDADE)
-- ------------------------------------------------------------------------------
SELECT 
  '5. FUNCAO_RBAC',
  rf.func_name || '(' || rf.expected_args || ') -> ' || rf.return_type,
  CASE 
    WHEN match_data.total_matches = 1 AND match_data.actual_return_type = rf.return_type THEN 'APROVADO'
    WHEN match_data.total_matches > 1 THEN 'REQUER ANÁLISE'
    WHEN match_data.total_matches = 1 AND match_data.actual_return_type != rf.return_type THEN 'REQUER ANÁLISE'
    ELSE 'BLOQUEADO'
  END,
  CASE 
    WHEN match_data.total_matches = 1 AND match_data.actual_return_type = rf.return_type 
    THEN 'Função RBAC presente com assinatura unívoca e tipo de retorno correto (' || match_data.actual_return_type || ').'
    WHEN match_data.total_matches > 1 
    THEN 'Assinatura ambígua: foram encontradas ' || match_data.total_matches || ' sobrecargas (overloads) da função ' || rf.func_name || '.'
    WHEN match_data.total_matches = 1 AND match_data.actual_return_type != rf.return_type 
    THEN 'Tipo de retorno divergente: esperado ' || rf.return_type || ', encontrado ' || match_data.actual_return_type || '.'
    ELSE 'Função RBAC obrigatória ' || rf.func_name || ' não encontrada no schema public.'
  END
FROM req_rbac_funcs rf
LEFT JOIN LATERAL (
  SELECT 
    count(*)::integer AS total_matches,
    max(t.typname) AS actual_return_type
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_type t ON t.oid = p.prorettype
  WHERE p.proname = rf.func_name 
    AND p.pronamespace = (SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = 'public')
    AND pg_get_function_identity_arguments(p.oid) = rf.expected_args
) match_data ON true

UNION ALL

-- ------------------------------------------------------------------------------
-- SEÇÃO 6: DETECÇÃO DE CONFLITOS DE NOMES DE FUNÇÕES A CRIAR
-- ------------------------------------------------------------------------------
SELECT 
  '6. CONFLITO_NOMES',
  tnf.func_name,
  CASE 
    WHEN p.total_funcs = 0 THEN 'APROVADO'
    ELSE 'REQUER ANÁLISE'
  END,
  CASE 
    WHEN p.total_funcs = 0 
    THEN 'Nome livre no schema public. Nenhuma função conflitante encontrada.'
    ELSE 'Função com este nome já existe no schema public (' || p.total_funcs || ' sobrecargas encontradas). Inspecione antes de aplicar.'
  END
FROM target_new_funcs tnf
LEFT JOIN LATERAL (
  SELECT count(*)::integer AS total_funcs
  FROM pg_catalog.pg_proc p
  WHERE p.proname = tnf.func_name 
    AND p.pronamespace = (SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = 'public')
) p ON true

UNION ALL

-- ------------------------------------------------------------------------------
-- SEÇÃO 7: PRIVILÉGIOS DE SCHEMA E EXECUÇÃO
-- ------------------------------------------------------------------------------
SELECT 
  '7. PRIVILEGIOS_BASE',
  rp.grantee_role || ' -> ' || rp.priv_type || ' ON ' || rp.object_name,
  CASE 
    WHEN rp.priv_type = 'SCHEMA_USAGE' AND has_schema_privilege(rp.grantee_role, rp.object_name, 'USAGE') THEN 'APROVADO'
    WHEN rp.priv_type = 'SCHEMA_USAGE' AND NOT has_schema_privilege(rp.grantee_role, rp.object_name, 'USAGE') THEN 'BLOQUEADO'
    WHEN rp.priv_type = 'SCHEMA_CREATE' AND has_schema_privilege(rp.grantee_role, rp.object_name, 'CREATE') THEN 'REQUER ANÁLISE'
    WHEN rp.priv_type = 'SCHEMA_CREATE' AND NOT has_schema_privilege(rp.grantee_role, rp.object_name, 'CREATE') THEN 'APROVADO'
    ELSE 'REQUER ANÁLISE'
  END,
  CASE 
    WHEN rp.priv_type = 'SCHEMA_USAGE' AND has_schema_privilege(rp.grantee_role, rp.object_name, 'USAGE')
    THEN 'Papel possui privilégio USAGE, permitindo resolução dos objetos via API PostgREST.'
    WHEN rp.priv_type = 'SCHEMA_USAGE' AND NOT has_schema_privilege(rp.grantee_role, rp.object_name, 'USAGE')
    THEN 'Papel NÃO possui USAGE no schema. Requisições da API falharão.'
    WHEN rp.priv_type = 'SCHEMA_CREATE' AND has_schema_privilege(rp.grantee_role, rp.object_name, 'CREATE')
    THEN 'Aviso de segurança: papel autenticado possui privilégio de CREATE no schema public (elevação excessiva).'
    WHEN rp.priv_type = 'SCHEMA_CREATE' AND NOT has_schema_privilege(rp.grantee_role, rp.object_name, 'CREATE')
    THEN 'Papel autenticado não possui privilégio CREATE no schema public (menor privilégio assegurado).'
    ELSE 'Privilégio avaliado requer análise contextual.'
  END
FROM req_privileges rp

ORDER BY categoria, item_verificado;
```

---

## 3. Pós-Verificação (Confirmação Imediata Pós-DDL)

```sql
-- 1. Conferir tabela e RLS ativado
SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = 'contratos_lojas';

-- 2. Conferir os 3 índices criados além da PK
SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'contratos_lojas' ORDER BY indexname;

-- 3. Conferir os 2 gatilhos vinculados
SELECT trigger_name, event_manipulation, action_timing FROM information_schema.triggers WHERE event_object_schema = 'public' AND event_object_table = 'contratos_lojas';

-- 4. Conferir as 4 políticas RLS
SELECT policyname, cmd, roles FROM pg_policies WHERE schemaname = 'public' AND tablename = 'contratos_lojas';

-- 5. Conferir que PUBLIC não possui privilégios de execução nas funções criadas
SELECT routine_name, grantee, privilege_type 
FROM information_schema.routine_privileges 
WHERE specific_schema = 'public' 
  AND routine_name IN ('check_contratos_vigencia_overlap', 'handle_contratos_updated_at', 'sync_contratos_from_rotas')
  AND grantee = 'PUBLIC';
```
