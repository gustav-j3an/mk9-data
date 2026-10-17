# RELATÓRIO DE AUDITORIA FINAL DO PRE-DEPLOY CHECKLIST — MISSÃO 02.9

**Documento Auditado:** `docs/controle-frequencia/PRE_DEPLOY_CHECKLIST.md`  
**Migração de Referência:** `supabase/migrations/20261017120000_create_contratos_lojas_table.sql`  
**Data:** 17/10/2026  
**Ambiente:** Estritamente Local (nenhuma conexão ou comando remoto executado).

---

## 1. Verificações Aprovadas da Consulta SQL de Pré-Implantação

1. **Estrutura Sintática do PostgreSQL:**
   - A consulta utiliza uma cláusula `WITH` unificada no topo do comando contendo 6 CTEs (`req_tables`, `req_fk_columns`, `req_cols`, `req_rbac_funcs`, `target_new_funcs`, `req_privileges`). Não há declarações `WITH` intercaladas após instruções `UNION ALL`.
   - As 7 seções subsequentes consom essas CTEs via `SELECT ... UNION ALL ...`, respeitando a gramática formal do parser SQL do PostgreSQL.
2. **Determinismo por Dependência (1 Linha por Item):**
   - Todas as 28 dependências obrigatórias geram exatamente 1 linha na saída:
     - 5 tabelas-base operacionais.
     - 1 verificação de estado da tabela alvo (`contratos_lojas`).
     - 2 verificações de compatibilidade de chaves estrangeiras.
     - 14 colunas dependentes com tipos e nulabilidade.
     - 3 funções auxiliares RBAC.
     - 3 detecções de nomes conflitantes para as novas funções.
     - 3 avaliações de privilégios de schema.
   - Em caso de ausência de qualquer objeto, a consulta não omite a linha; ela produz explicitamente o status `BLOQUEADO`.
3. **Validação Completa de Chaves Estrangeiras:**
   - A Seção 3 (`COMPATIBILIDADE_FK`) valida:
     - Se a tabela de destino possui constraint `PRIMARY KEY` (`'p'`) ou `UNIQUE` (`'u'`).
     - Se a constraint é mono-coluna e restrita exatamente à coluna referenciada (`con.conkey = ARRAY[att_target.attnum]`), descartando chaves compostas falsas-positivas.
     - Se o tipo nativo da coluna de destino no catálogo (`typ.typname`) é idêntico ao tipo pretendido na nova coluna de origem (`text`).
4. **Validação de Funções RBAC e Ambiguidade:**
   - A Seção 5 (`FUNCAO_RBAC`) cruza `proname`, `pronamespace` e `pg_get_function_identity_arguments`.
   - Se houver sobrecargas (*overloads*) com múltiplos matches para o mesmo nome: classificado como `REQUER ANÁLISE`.
   - Se o tipo de retorno divergir: classificado como `REQUER ANÁLISE`.
   - Se unívoca com retorno correto: `APROVADO`.
5. **Garantia Estrita de Somente Leitura:**
   - A consulta contém apenas instruções `SELECT`, `JOIN`, `CASE` e funções informativas de catálogo (`has_schema_privilege`, `pg_get_function_identity_arguments`).
   - Não contém nenhum comando DDL (`CREATE`, `ALTER`, `DROP`), DML (`INSERT`, `UPDATE`, `DELETE`) nem invocação de funções de escrita.

---

## 2. Análise Crítica: O que o Checklist Consegue e NÃO Consegue Comprovar

| Aspecto | Comprovável pelo Checklist SQL | NÃO Comprovável pelo Checklist SQL (Limitação Inerente) |
| :--- | :--- | :--- |
| **Existência e Schema das Tabelas** | ✅ Comprova presença e tipo `relkind='r'` no schema `public`. | Não infere a integridade semântica dos dados dentro dessas tabelas. |
| **Colunas e Tipos** | ✅ Comprova presença, tipo nativo do PostgreSQL e flag `attnotnull`. | Não atesta se os dados existentes violam regras que serão criadas no futuro. |
| **Constraints para FKs** | ✅ Comprova constraints UNIQUE/PK mono-coluna e tipos compatíveis. | Não valida se existem registros órfãos pré-existentes na base antes da criação da FK. |
| **Funções RBAC** | ✅ Comprova presença, argumentos e tipo de retorno. | Não executa a lógica interna das funções RBAC para testar regras dinâmicas de sessão. |
| **Privilégios e RLS** | ✅ Comprova `USAGE` e `CREATE` no schema `public`. | ⚠️ **Não comprova a eficácia das políticas RLS** (RLS só pode ser comprovado em tempo de execução via consultas com tokens JWT reais de cada perfil). |

---

## 3. Problemas Encontrados e Correções Realizadas

### A. Verificação de Tipo Nulável de Colunas no Catálogo (`attnotnull`)
- **Trecho:** Seção 4 (`COLUNA_DEPENDENTE`) de `PRE_DEPLOY_CHECKLIST.md`.
- **Análise:** A coluna `attnotnull` do catálogo `pg_attribute` indica se a coluna possui a restrição `NOT NULL` física. A consulta classifica como `REQUER ANÁLISE` se uma coluna como `rotas.loja_codigo` permitir nulos no schema, pois isso poderia gerar divergências nas rotas ao criar contratos futuros.
- **Conclusão:** A checagem foi mantida com status `REQUER ANÁLISE` (em vez de `BLOQUEADO` cego), permitindo que o administrador avalie se o schema legado aceita nulos sem quebrar a pré-verificação caso os dados estejam consistentes.

---

## 4. Limitações de Validação no Ambiente Atual

- **Ausência de PostgreSQL Local:**  
  A máquina local **não possui serviço PostgreSQL em execução nem daemon Docker ativo**. A consulta SQL foi auditada estaticamente conforme a gramática formal do catálogo do PostgreSQL (`pg_catalog`). Sua execução física real ocorrerá quando submetida ao SQL Editor do Supabase antes da migração.
- **Escopo dos Testes Automatizados Locais:**  
  Os 24 testes unitários automatizados em `src/lib/contratosService.test.ts` cobrem exclusivamente a lógica TypeScript/Node em memória (funções puras, validação de payload, detecção de erros PostgREST e agregação de rotas). **Eles não executam nem comprovam o SQL do PostgreSQL**.

---

## 5. Resultados Reais dos Comandos Locais Executados

```powershell
# 1. Testes Unitários de Regras Contratuais
> npx tsx src/lib/contratosService.test.ts
# tests 24 | suites 6 | pass 24 | fail 0 (100% aprovado em 50.8ms)

# 2. Verificação Estática de Tipagem (TypeScript Strict)
> npm run lint
# tsc --noEmit (Código de saída 0 — zero erros)

# 3. Compilação e Empacotamento de Produção
> npm run build
# vite build (Bundle de produção gerado com sucesso em 1.37s)
```

---

## 6. Decisão Final da Auditoria

> [!IMPORTANT]
> ### DECISÃO: **APTO PARA PREFLIGHT SOMENTE LEITURA**
> 
> A consulta SQL apresentada em `docs/controle-frequencia/PRE_DEPLOY_CHECKLIST.md` é:
> 1. **100% segura para execução:** Somente leitura, sem efeitos colaterais, sem DDL e sem DML.
> 2. **Determinística:** Produz status explícitos (`APROVADO`, `BLOQUEADO`, `REQUER ANÁLISE`) para cada dependência.
> 3. **Conforme ao Catálogo:** Baseada estritamente nas tabelas nativas `pg_catalog.pg_class`, `pg_catalog.pg_attribute`, `pg_catalog.pg_constraint`, `pg_catalog.pg_proc` e `pg_catalog.pg_type`.
> 
> **Próximo passo recomendado para o usuário:**  
> Executar a consulta do [`PRE_DEPLOY_CHECKLIST.md`](file:///c:/projetos/mk9-data/docs/controle-frequencia/PRE_DEPLOY_CHECKLIST.md) no SQL Editor do Supabase e conferir os resultados retornados.

**Confirmação do Banco Remoto:**  
O Supabase remoto permanece **100% inalterado**. Nenhuma DDL, DML ou conexão remota foi disparada.

