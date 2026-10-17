# PROTOCOLO DE RECUPERAÇÃO SEGURA (ROLLBACK CONDICIONAL)
**Módulo:** `public.contratos_lojas`  
**Migration:** `supabase/migrations/20261017120000_create_contratos_lojas_table.sql`

---

## 1. Princípios Inegociáveis de Recuperação
1. **Separação Obrigatória:** Diagnóstico (somente leitura) e Reversão (DML/DDL) são procedimentos **completamente separados**.
2. **Sem Automação Cega:** Nunca execute scripts de reversão automática em caso de erro na migration.
3. **Proibição de `CASCADE`:** É expressamente proibido o uso de `DROP ... CASCADE`, prevenindo a destruição acidental de foreign keys ou views dependentes em outras tabelas.
4. **Comprovação de Origem:** A mera existência de um objeto com o nome esperado não autoriza sua exclusão. Deve-se comprovar que o objeto foi de fato criado pela tentativa atual e que não possui dependências operacionais.
5. **Preservação de Dados:** Caso a tabela `contratos_lojas` já contenha registros inseridos por usuários, a tabela **NÃO deve ser descartada** via DROP TABLE.

---

## 2. Etapa 1: Diagnóstico de Estado Real (Somente Leitura)

Em caso de falha durante a execução manual da migração, execute o script abaixo no SQL Editor para levantar o inventário do que foi criado:

```sql
-- ==============================================================================
-- DIAGNÓSTICO DE ESTADO APÓS FALHA PARCIAL (SOMENTE LEITURA)
-- ==============================================================================

-- 1. Inspecionar a tabela contratos_lojas
SELECT 
  'TABELA' AS tipo_objeto,
  c.relname AS nome_objeto,
  pg_get_userbyid(c.relowner) AS proprietario,
  c.relrowsecurity AS rls_ativo,
  (SELECT count(*) FROM public.contratos_lojas) AS total_registros
FROM pg_catalog.pg_class c
WHERE c.relname = 'contratos_lojas' 
  AND c.relnamespace = (SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = 'public')

UNION ALL

-- 2. Inspecionar Triggers associados à tabela
SELECT 
  'TRIGGER',
  trig.tgname,
  'table_owner',
  true,
  0
FROM pg_catalog.pg_trigger trig
JOIN pg_catalog.pg_class cl ON cl.oid = trig.tgrelid
WHERE cl.relname = 'contratos_lojas' AND NOT trig.tgisinternal

UNION ALL

-- 3. Inspecionar Funções do módulo de contratos
SELECT 
  'FUNCAO',
  p.proname || '(' || pg_get_function_arguments(p.oid) || ')',
  pg_get_userbyid(p.proowner),
  p.prosecdef, -- true se for SECURITY DEFINER
  0
FROM pg_catalog.pg_proc p
WHERE p.pronamespace = (SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = 'public')
  AND p.proname IN ('check_contratos_vigencia_overlap', 'handle_contratos_updated_at', 'sync_contratos_from_rotas')

UNION ALL

-- 4. Inspecionar se existem dependências externas apontando para contratos_lojas
SELECT 
  'DEPENDENCIA_EXTERNA',
  cl_origem.relname || ' (' || con.conname || ')',
  'foreign_key',
  false,
  0
FROM pg_catalog.pg_constraint con
JOIN pg_catalog.pg_class cl_origem ON cl_origem.oid = con.conrelid
WHERE con.confrelid = (
  SELECT oid FROM pg_catalog.pg_class 
  WHERE relname = 'contratos_lojas' AND relnamespace = (SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = 'public')
);
```

---

## 3. Matriz de Decisão para Ação Corretiva

| Cenário Identificado no Diagnóstico | Ação Recomendada |
| :--- | :--- |
| **A. Tabela não existe e funções não existem** | Nenhuma ação de limpeza necessária. O erro ocorreu antes da criação e o banco permaneceu íntegro. |
| **B. Tabela foi criada vazia (0 registros) e falhou no trigger/RLS** | Prosseguir para a Etapa 2 de Reversão Cirúrgica Controlada após confirmação humana. |
| **C. Tabela possui registros (> 0 registros)** | **PARADA OBRIGATÓRIA.** Não realize DROP. A tabela já continha dados comerciais ou foi populada anteriormente. Requer auditoria manual. |
| **D. Dependências externas detectadas** | **PARADA OBRIGATÓRIA.** Há outras tabelas referenciando `contratos_lojas`. Não realize DROP. |
| **E. Funções com proprietário divergente do usuário atual** | **PARADA OBRIGATÓRIA.** As funções podem ter sido instaladas por outro módulo ou extensão administrativa. |

---

## 4. Etapa 2: Reversão Cirúrgica Controlada (Apenas para Cenário B)

Execute este bloco **exclusivamente se a confirmação humana validar o Cenário B** (tabela vazia, sem dependências externas, comprovadamente criada na sessão com erro):

```sql
-- ==============================================================================
-- REVERSÃO CIRÚRGICA CONTROLADA (APENAS CENÁRIO B - SEM CASCADE)
-- ==============================================================================

DO $$
DECLARE
  v_count INTEGER := 0;
BEGIN
  -- 1. Verificação de segurança: a tabela só pode ser descartada se estiver rigorosamente vazia
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE relname = 'contratos_lojas' AND relnamespace = (SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = 'public')) THEN
    EXECUTE 'SELECT count(*) FROM public.contratos_lojas' INTO v_count;
    IF v_count > 0 THEN
      RAISE EXCEPTION 'ABORTADO: A tabela contratos_lojas contém % registros e não pode ser removida por rollback.', v_count;
    END IF;

    -- Descartar triggers conhecidos
    DROP TRIGGER IF EXISTS trigger_check_contratos_vigencia_overlap ON public.contratos_lojas;
    DROP TRIGGER IF EXISTS trigger_contratos_updated_at ON public.contratos_lojas;

    -- Descartar a tabela vazia sem CASCADE
    DROP TABLE public.contratos_lojas;
  END IF;

  -- 2. Descartar apenas as 3 funções novas comprovadas
  DROP FUNCTION IF EXISTS public.check_contratos_vigencia_overlap();
  DROP FUNCTION IF EXISTS public.handle_contratos_updated_at();
  DROP FUNCTION IF EXISTS public.sync_contratos_from_rotas();
END $$;
```

