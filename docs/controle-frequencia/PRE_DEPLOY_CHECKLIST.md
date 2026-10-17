# CHECKLIST RIGOROSO DE PRÉ-IMPLANTAÇÃO (SOMENTE LEITURA)
**Módulo:** `public.contratos_lojas`  
**Migration:** `supabase/migrations/20261017120000_create_contratos_lojas_table.sql`  
**Objetivo:** Validar via catálogo do PostgreSQL (`pg_catalog` / `information_schema`) todos os pré-requisitos antes de executar a DDL.

---

## 1. Princípios de Execução da Pré-Verificação
1. **Determinismo:** Toda dependência produz exatamente uma linha com status explícito: `APROVADO`, `BLOQUEADO` ou `REQUER ANÁLISE`.
2. **Critério de Parada:** Se qualquer linha retornar `BLOQUEADO` ou `REQUER ANÁLISE`, **a implantação deve ser interrompida imediatamente**.
3. **Somente Leitura:** Esta consulta não cria, altera ou exclui objetos.

---

## 2. Consulta SQL Completa de Pré-Verificação

Execute o bloco abaixo no SQL Editor do Supabase:

```sql
-- ==============================================================================
-- MK9 DATE - PRÉ-VERIFICAÇÃO DE PRÉ-REQUISITOS COM CLASSIFICAÇÃO EXPLÍCITA
-- ==============================================================================

-- 1. TABELAS-BASE OPERACIONAIS OBRIGATÓRIAS
WITH req_tables(table_name) AS (
  VALUES ('industrias'), ('lojas'), ('profiles'), ('rotas'), ('visits')
)
SELECT 
  '1. TABELA_BASE' AS categoria,
  r.table_name AS item_verificado,
  CASE 
    WHEN c.relname IS NOT NULL AND c.relkind = 'r' THEN 'APROVADO'
    ELSE 'BLOQUEADO'
  END AS status,
  CASE 
    WHEN c.relname IS NOT NULL AND c.relkind = 'r' 
    THEN 'Tabela base existe no schema public.'
    ELSE 'Tabela base obrigatória ausente. Implantação não pode prosseguir.'
  END AS detalhe
FROM req_tables r
LEFT JOIN pg_catalog.pg_class c 
  ON c.relname = r.table_name 
  AND c.relnamespace = (SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = 'public')

UNION ALL

-- 2. ESTADO PRÉVIO DA TABELA CONTRATOS_LOJAS
SELECT 
  '2. ESTADO_ALVO',
  'contratos_lojas',
  CASE 
    WHEN c.relname IS NULL THEN 'APROVADO'
    ELSE 'BLOQUEADO'
  END,
  CASE 
    WHEN c.relname IS NULL 
    THEN 'Tabela contratos_lojas inexistente. Pronto para criação limpa.'
    ELSE 'BLOQUEIO CRÍTICO: Tabela contratos_lojas já existe no banco. Não confie em CREATE TABLE IF NOT EXISTS; realize diff explícito de colunas e constraints antes de aplicar.'
  END
FROM (SELECT 1) _
LEFT JOIN pg_catalog.pg_class c 
  ON c.relname = 'contratos_lojas' 
  AND c.relnamespace = (SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = 'public')

UNION ALL

-- 3. CONSTRAINTS UNIQUE/PK EM INDUSTRIAS E LOJAS (EXIGIDAS PARA FOREIGN KEYS)
WITH req_keys(tbl, col) AS (
  VALUES ('industrias', 'codigo'), ('lojas', 'codigo')
)
SELECT 
  '3. CONSTRAINT_FK',
  rk.tbl || '.' || rk.col,
  CASE 
    WHEN con.conname IS NOT NULL THEN 'APROVADO'
    ELSE 'BLOQUEADO'
  END,
  CASE 
    WHEN con.conname IS NOT NULL 
    THEN 'Constraint ' || con.contype || ' (' || con.conname || ') presente para chave estrangeira.'
    ELSE 'Coluna ' || rk.col || ' não possui constraint UNIQUE ou PK na tabela ' || rk.tbl || '.'
  END
FROM req_keys rk
LEFT JOIN pg_catalog.pg_constraint con 
  ON con.conrelid = (
    SELECT oid FROM pg_catalog.pg_class 
    WHERE relname = rk.tbl AND relnamespace = (SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = 'public')
  )
  AND con.contype IN ('p', 'u')
  AND (
    SELECT attname FROM pg_catalog.pg_attribute 
    WHERE attrelid = con.conrelid AND attnum = ANY(con.conkey)
  ) = rk.col

UNION ALL

-- 4. COLUNAS DEPENDENTES UTILIZADAS EM POLÍTICAS RLS E NA SINCRONIZAÇÃO
WITH req_cols(tbl, col, expected_type) AS (
  VALUES 
    ('profiles', 'id', 'uuid'),
    ('profiles', 'role', 'text'),
    ('profiles', 'industria_codigo', 'text'),
    ('profiles', 'promotor_matricula', 'text'),
    ('rotas', 'industria_codigo', 'text'),
    ('rotas', 'loja_codigo', 'text'),
    ('rotas', 'promotor_matricula', 'text'),
    ('rotas', 'frequencia', 'text'),
    ('rotas', 'segunda', 'boolean'),
    ('rotas', 'terca', 'boolean'),
    ('rotas', 'quarta', 'boolean'),
    ('rotas', 'quinta', 'boolean'),
    ('rotas', 'sexta', 'boolean'),
    ('rotas', 'sabado', 'boolean'),
    ('rotas', 'domingo', 'boolean')
)
SELECT 
  '4. COLUNA_DEPENDENTE',
  rc.tbl || '.' || rc.col,
  CASE 
    WHEN a.attname IS NOT NULL AND t.typname = rc.expected_type THEN 'APROVADO'
    WHEN a.attname IS NOT NULL AND t.typname != rc.expected_type THEN 'REQUER ANÁLISE'
    ELSE 'BLOQUEADO'
  END,
  CASE 
    WHEN a.attname IS NOT NULL AND t.typname = rc.expected_type 
    THEN 'Coluna existe com tipo compatível (' || t.typname || ').'
    WHEN a.attname IS NOT NULL AND t.typname != rc.expected_type 
    THEN 'Coluna existe com tipo divergente: esperado ' || rc.expected_type || ', encontrado ' || t.typname || '.'
    ELSE 'Coluna obrigatória ausente em ' || rc.tbl || '.'
  END
FROM req_cols rc
LEFT JOIN pg_catalog.pg_class cl 
  ON cl.relname = rc.tbl AND cl.relnamespace = (SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = 'public')
LEFT JOIN pg_catalog.pg_attribute a 
  ON a.attrelid = cl.oid AND a.attname = rc.col AND NOT a.attisdropped
LEFT JOIN pg_catalog.pg_type t 
  ON t.oid = a.atttypid

UNION ALL

-- 5. FUNÇÕES AUXILIARES RBAC PRÉ-EXISTENTES
WITH req_funcs(func_name, return_type) AS (
  VALUES 
    ('is_admin_or_gestor', 'bool'),
    ('get_auth_industria_codigo', 'text'),
    ('get_auth_promotor_matricula', 'text')
)
SELECT 
  '5. FUNCAO_RBAC',
  rf.func_name || '() -> ' || rf.return_type,
  CASE 
    WHEN p.proname IS NOT NULL AND t.typname = rf.return_type THEN 'APROVADO'
    WHEN p.proname IS NOT NULL AND t.typname != rf.return_type THEN 'REQUER ANÁLISE'
    ELSE 'BLOQUEADO'
  END,
  CASE 
    WHEN p.proname IS NOT NULL AND t.typname = rf.return_type 
    THEN 'Função RBAC presente com tipo de retorno correto (' || t.typname || ').'
    WHEN p.proname IS NOT NULL AND t.typname != rf.return_type 
    THEN 'Assinatura divergente: esperado retorno ' || rf.return_type || ', encontrado ' || t.typname || '.'
    ELSE 'Função RBAC obrigatória não encontrada.'
  END
FROM req_funcs rf
LEFT JOIN pg_catalog.pg_proc p 
  ON p.proname = rf.func_name 
  AND p.pronamespace = (SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = 'public')
LEFT JOIN pg_catalog.pg_type t 
  ON t.oid = p.prorettype

UNION ALL

-- 6. VERIFICAÇÃO DE NOMES CONFLITANTES PARA AS NOVAS FUNÇÕES
WITH target_new_funcs(func_name) AS (
  VALUES 
    ('check_contratos_vigencia_overlap'),
    ('handle_contratos_updated_at'),
    ('sync_contratos_from_rotas')
)
SELECT 
  '6. CONFLITO_NOMES',
  tnf.func_name,
  CASE 
    WHEN p.proname IS NULL THEN 'APROVADO'
    ELSE 'REQUER ANÁLISE'
  END,
  CASE 
    WHEN p.proname IS NULL 
    THEN 'Nome livre no schema public. Nenhuma função conflitante encontrada.'
    ELSE 'Função já existe no schema public com ' || p.pronargs || ' argumentos. Inspecione se é versão legada.'
  END
FROM target_new_funcs tnf
LEFT JOIN pg_catalog.pg_proc p 
  ON p.proname = tnf.func_name 
  AND p.pronamespace = (SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = 'public')

UNION ALL

-- 7. PRIVILÉGIOS DE TABELA E EXECUÇÃO NO SCHEMA PUBLIC
SELECT 
  '7. PRIVILEGIOS_BASE',
  'schema.public',
  CASE 
    WHEN has_schema_privilege('authenticated', 'public', 'USAGE') THEN 'APROVADO'
    ELSE 'BLOQUEADO'
  END,
  CASE 
    WHEN has_schema_privilege('authenticated', 'public', 'USAGE') 
    THEN 'Papel authenticated possui privilégio USAGE no schema public.'
    ELSE 'Papel authenticated NÃO possui privilégio USAGE no schema public.'
  END

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

