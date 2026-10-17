# RELATÓRIO DE FECHAMENTO DOS BLOQUEADORES DE SEGURANÇA E PRÉ-IMPLANTAÇÃO — MISSÃO 02.6

**Módulo:** Controle Contratual e Frequências (`public.contratos_lojas`)  
**Data:** 17/10/2026  
**Ambiente:** Somente Leitura Local (nenhum comando remoto executado).

---

## 1. Status Geral da Auditoria

| Dimensão | Classificação | Justificativa |
| :--- | :---: | :--- |
| **Sintaxe DDL & Constraints** | **COMPROVADO LOCALMENTE** | 24 testes unitários automatizados passando; build de produção e linter 100% limpos. |
| **Segurança e Privilégios Mínimos** | **COMPROVADO LOCALMENTE** | `REVOKE FROM PUBLIC` aplicado em todas as funções; remoção de `SECURITY DEFINER` de `handle_contratos_updated_at`; `search_path = pg_catalog, public`. |
| **Checklist de Pré-Verificação** | **PRONTO P/ EXECUÇÃO MANUAL** | Documento `docs/controle-frequencia/PRE_DEPLOY_CHECKLIST.md` criado com consultas baseadas em `pg_catalog` gerando status determinísticos (`APROVADO`, `BLOQUEADO`, `REQUER ANÁLISE`). |
| **Protocolo de Rollback Seguro** | **PRONTO P/ EXECUÇÃO MANUAL** | Documento `docs/controle-frequencia/ROLLBACK_SEGURO.md` estruturado com diagnóstico prévio, proibição de `CASCADE` e bloqueio se a tabela contiver dados. |
| **Homologação Concorrente Real** | **PENDENTE DE HOMOLOGAÇÃO** | A máquina local não possui serviço PostgreSQL em execução nem Docker operacional. O teste físico multi-sessão está formalizado no checklist para execução em ambiente PostgreSQL. |
| **Definição de Vigência Comercial** | **DEPENDENTE DE DECISÃO COMERCIAL** | A sincronização inicial (`sync_contratos_from_rotas`) permanece desacoplada e bloqueada, aguardando aprovação comercial quanto ao uso de `CURRENT_DATE`. |

---

## 2. Auditoria Detalhada de Funções e `SECURITY DEFINER`

### A. `public.handle_contratos_updated_at()`
- **Privilégio:** **SECURITY INVOKER** (padrão, sem elevação de privilégios).
- **Operação:** Apenas atribui `NEW.updated_at = NOW()` em memória.
- **Resolução de Objetos:** `SET search_path = pg_catalog, public`.
- **Concessões:** Não possui `GRANT EXECUTE` para `authenticated` ou `anon`. Disparada internamente pelo PostgreSQL no evento `BEFORE UPDATE`.

### B. `public.check_contratos_vigencia_overlap()`
- **Privilégio:** **SECURITY DEFINER** (com elevação controlada).
- **Razão Objetiva:** O trigger precisa adquirir um lock de linha (`FOR UPDATE`) sobre `public.lojas` e consultar `public.contratos_lojas` para detectar sobreposições com contratos de terceiros. Se rodasse como invoker, as políticas RLS do chamador filtrariam a consulta e permitiriam inserções concorrentes silenciosamente sobrepostas.
- **Resolução de Objetos:** `SET search_path = pg_catalog, public`.
- **Concessões:** `REVOKE EXECUTE ... FROM PUBLIC`. Nenhum usuário ou endpoint pode chamá-la diretamente via RPC.

### C. `public.sync_contratos_from_rotas()`
- **Privilégio:** **SECURITY DEFINER** (com elevação controlada).
- **Razão Objetiva:** Procedure administrativa em lote que precisa agregar dados da malha de `public.rotas` e inserir em `public.contratos_lojas`.
- **Guarda de Segurança:** Primeira instrução executa `IF NOT (public.is_admin_or_gestor()) THEN RAISE EXCEPTION ...`. Não é contornável por parâmetros (a função não recebe argumentos de entrada).
- **Resolução de Objetos:** `SET search_path = pg_catalog, public`.
- **Concessões:** `REVOKE EXECUTE ... FROM PUBLIC; GRANT EXECUTE ... TO authenticated;`.

---

## 3. Análise Concorrente do Lock Pessimista (`FOR UPDATE`)

### Comportamento sob `READ COMMITTED`
1. Toda operação de `INSERT` ou `UPDATE` em `public.contratos_lojas` com `status IN ('ativo', 'suspenso')` executa:
   ```sql
   SELECT EXISTS (SELECT 1 FROM public.lojas WHERE codigo = NEW.loja_codigo FOR UPDATE);
   ```
2. **Inserções Simultâneas:** Transações concorrentes para a mesma loja são forçadas a enfileirar no nível de lock de tupla da tabela `lojas`. Quando a primeira comita, a segunda lê a tupla de loja atualizada e, sob `READ COMMITTED`, avalia a query de sobreposição enxergando a tupla recém-inserida.
3. **Deadlocks:** Como todas as transações adquirem o lock no mesmo objeto (`lojas`) seguindo a mesma ordem antes de tocar em `contratos_lojas`, o risco de deadlock entre inserções puras é eliminado.
4. **Limitação Local:** Devido à ausência de PostgreSQL local na máquina (serviço inativo e Docker inacessível), a eficácia concorrente sob múltiplas conexões paralelas está **formalmente registrada como pendente de homologação física**.

---

## 4. Regras Comerciais e Sincronização de Dados

A procedure `sync_contratos_from_rotas()` **não é executada durante a migração**. Suas premissas provisórias registradas para decisão da equipe comercial são:

1. **Início da Vigência (`CURRENT_DATE`):**
   - *Impacto:* Contratos gerados a partir de rotas existentes passarão a valer a partir da data de execução da carga. Visitas passadas não serão cobertas retroativamente por vigência formal.
   - *Decisão Pendente:* A MK9 deve aprovar se a vigência inicial deve ser a data atual ou uma data de corte histórica (ex: início do mês vigente ou data da importação da rota).
2. **Cálculo de Visitas por Semana:**
   - Para rotas com frequência `'SEMANAL'`, conta a quantidade de dias marcados como `true` (`segunda` a `domingo`). Se nenhum dia estiver marcado, atribui 1 visita/semana por segurança.
3. **Tratamento de Divergências:**
   - Rotas com múltiplas frequências para a mesma combinação loja/indústria (`COUNT(DISTINCT frequencia) > 1`) são **ignoradas como conflitos** e não geram contratos automáticos.

---

## 5. Parecer Técnico Conclusivo

> [!IMPORTANT]
> ### PARECER: **PRONTO PARA REVISÃO MANUAL; IMPLANTAÇÃO CONDICIONADA À PRÉ-VERIFICAÇÃO**
> 
> O código DDL, os tipos TypeScript e as rotinas de segurança estão totalmente fechados, sem erros conhecidos.
> 
> **Condições que devem ser atendidas para autorizar a implantação no Supabase:**
> 1. Executar a pré-verificação (`docs/controle-frequencia/PRE_DEPLOY_CHECKLIST.md`) no SQL Editor do Supabase e comprovar que todos os itens retornam `APROVADO`.
> 2. Se a tabela `contratos_lojas` já existir (cenário de testes prévios), avaliar seu conteúdo antes de aplicar.
> 3. Manter a sincronização inicial desacoplada para posterior aprovação comercial na Missão 03.

