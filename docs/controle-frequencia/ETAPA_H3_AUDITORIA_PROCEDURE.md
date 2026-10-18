# RELATÓRIO TÉCNICO DE AUDITORIA — ETAPA H3
## Auditoria da Procedure SQL `sync_contratos_from_rotas()` e Proposta Segura de Migração

**Projeto:** MK9 Date (`C:\projetos\mk9-data`)  
**Data:** 18/10/2026  
**Status da Execução:** SOMENTE ANÁLISE / AUDITORIA LOCAL (Nenhum comando SQL foi executado no banco remoto).

---

### 1. Diagnóstico e Auditoria Detalhada da Procedure Atual

A procedure `public.sync_contratos_from_rotas()` está definida no arquivo de migração `supabase/migrations/20261017120000_create_contratos_lojas_table.sql` (linhas 227 a 349).

| Aspecto | Comportamento na Implementação Atual | Análise de Riscos e Limitações |
|---|---|---|
| **Agrupamento de Rotas** | Agrupa via `GROUP BY industria_codigo, loja_codigo` na tabela `public.rotas`, filtrando apenas `WHERE industria_codigo IS NOT NULL AND loja_codigo IS NOT NULL`. | Adequado para identificar os pares de atendimento. Porém, não verifica se as chaves estrangeiras existem em `public.industrias` e `public.lojas` antes de iterar. |
| **Consolidação de Frequências e Dias** | Usa `MAX(frequencia)` e agrega dias de atendimento usando `BOOL_OR(segunda) ... BOOL_OR(domingo)`. Conta frequências distintas via `COUNT(DISTINCT frequencia)`. | Para frequência `SEMANAL`, calcula a quantidade de dias ativos por semana (`v_visitas_semana`). Para `QUINZENAL`, atribui `ciclo_quinzenal = 'QUINZENAL_LIVRE'` e `visitas_por_semana = NULL`. |
| **Tratamento de Conflitos** | Se `freq_distinct_count > 1`, incrementa `v_conflitos` e executa `CONTINUE` sem criar contrato. | Proteção essencial e correta: divergência cadastral na malha bloqueia a inferência automática. |
| **Prevenção de Duplicações** | Verifica `IF EXISTS (SELECT 1 FROM public.contratos_lojas c WHERE c.industria_codigo = r.industria_codigo AND c.loja_codigo = r.loja_codigo AND c.status IN ('ativo', 'suspenso')) THEN CONTINUE; END IF;`. | Protege contra duplicação de contratos para o mesmo par com vigência ativa ou suspensa. |
| **Campos Inseridos** | Insere `data_inicio_vigencia = CURRENT_DATE`, `data_fim_vigencia = NULL`, `status = 'ativo'`, `origem = 'migracao_rotas'`. | **Gargalo Comercial:** atribui cegamente `CURRENT_DATE` a todas as indústrias, desrespeitando o início efetivo da operação (`data_inicio_operacao`). |
| **Tratamento de Contratos Existentes** | Se existir contrato `ativo` ou `suspenso`, ignora silenciosamente (`CONTINUE`). Se houver apenas contratos `inativo` ou `encerrado`, tenta criar um novo contrato com `data_inicio_vigencia = CURRENT_DATE`. | Pode gerar colisão com contratos encerrados se a data de encerramento for posterior a `CURRENT_DATE` (barrado pelo trigger de overlap). |
| **Idempotência e Concorrência** | Não possui locks explícitos na leitura de `public.rotas` ou `public.contratos_lojas`. O trigger `trigger_check_contratos_vigencia_overlap` possui lock pessimista na linha da loja (`SELECT 1 FROM public.lojas WHERE codigo = NEW.loja_codigo FOR UPDATE`), o que serializa inserções na mesma loja, mas concorrências na chamada da procedure inteira podem gerar overhead e contenção. | Reexecuções consecutivas são seguras devido ao bloco `IF EXISTS`, mas concorrências simultâneas devem ser evitadas na orquestração. |
| **Tratamento de `data_inicio_operacao`** | A procedure atual **ignora totalmente** a tabela `public.industrias` e não lê a coluna `data_inicio_operacao`. | **Incompatível com a regra comercial aprovada:** cria contratos para indústrias não KING sem data de início definida, atribuindo `CURRENT_DATE`. |

---

### 2. Comparação Técnica: Procedure SQL vs. Regras Comerciais e TypeScript

| Dimensão Conceitual | Decisão Comercial Homologada & TypeScript | Procedure SQL Atual | Alinhamento Necessário |
|---|---|---|---|
| **Início da Relação Comercial** | KING: Contrato contínuo (`data_fim_vigencia = NULL`).<br>Demais Indústrias: Data comercial estrita em `industrias.data_inicio_operacao`. Proibido usar `created_at` ou `CURRENT_DATE`. | Aplica `CURRENT_DATE` como início da vigência para todas as indústrias indistintamente. | A procedure deve buscar `industrias.data_inicio_operacao`. Se for nula/ausente para indústria não KING, **NÃO DEVE** criar o contrato. |
| **Período de Apuração (Ciclo Mensal)** | KING: apuração móvel do dia 23 ao dia 22.<br>Demais: 1º ciclo pro-rata (da `data_inicio_operacao` ao fim do mês); ciclos seguintes do dia 01 ao fim do mês. | Não calcula competências nem períodos mensais. | **Manter fora da procedure:** A tabela `contratos_lojas` modela a **relação contratual contínua**, não o fechamento contábil mensal. |
| **Frequência Operacional** | `SEMANAL` ou `QUINZENAL` define a cadência operacional de visitas dos promotores, sendo totalmente desacoplada das datas de vigência. | Mesma regra: preenche `visitas_por_semana` (semanal) ou `ciclo_quinzenal` (quinzenal). | Alinhado. |
| **Data de Cadastro Técnica (`created_at`)** | Não pode ser usada para inferir vigência ou competência comercial. | Não utilizava `created_at` (usava `CURRENT_DATE`), mas também não lia `data_inicio_operacao`. | Alinhado com a proibição de uso de `created_at`. |

---

### 3. Decisão de Arquitetura: Responsabilidade da Procedure SQL

> [!IMPORTANT]
> **Decisão Fundamental:** A procedure `sync_contratos_from_rotas()` deve manter a responsabilidade restrita à criação de **CONTRATOS COMERCIAIS CONTÍNUOS** (`data_fim_vigencia = NULL`).
> 
> Ela **NÃO DEVE** calcular competências mensais nem gerar múltiplos contratos a cada mês. O ciclo de apuração (dia 23 a 22 para KING, e pro-rata/mensal para as demais) é computado em memória e em relatórios analíticos pela função pura `calcularPeriodoContratual()`.
> 
> Misturar geração de faturamento/apuração mensal dentro de `contratos_lojas` violaria a restrição `check_contratos_vigencia_overlap` e sobrecarregaria o modelo relacional com dezenas de contratos redundantes por loja.

---

### 4. Proposta de Alinhamento da Procedure (Proposta Segura de Migration)

A proposta de redefinição da procedure:
1. **Verificação de Chave Estrangeira e `data_inicio_operacao`:**
   - Realiza `LEFT JOIN public.industrias i ON i.codigo = r.industria_codigo`.
   - Se `r.industria_codigo = 'IND-013'` (KING): permite criação com `data_inicio_vigencia = COALESCE(i.data_inicio_operacao, CURRENT_DATE)` e `data_fim_vigencia = NULL`.
   - Se `r.industria_codigo <> 'IND-013'`: exige `i.data_inicio_operacao IS NOT NULL`. Se estiver ausente, contabiliza como `v_sem_data_inicio := v_sem_data_inicio + 1` e não cria o contrato.
2. **Preservação de Retorno e Telemetria:**
   - Retorna tabela com 4 colunas:
     - `total_rotas_analisadas INTEGER`
     - `contratos_criados INTEGER`
     - `rotas_conflitantes_ignoradas INTEGER`
     - `rotas_sem_data_inicio_ignoradas INTEGER`
3. **Compatibilidade Pré-Migração:**
   - Inclui guarda defensiva para verificar se a coluna `data_inicio_operacao` existe em `information_schema.columns` antes de consultá-la, evitando erro se executada antes da migration DDL.

---

### 5. Arquivo de Proposta Criado

Foi gerado o arquivo de proposta de migração:  
`supabase/migrations/propostas/20261018160000_proposal_sync_contratos_with_data_inicio.sql`  
*(Marcado expressamente como NÃO EXECUTADO no banco de dados).*

