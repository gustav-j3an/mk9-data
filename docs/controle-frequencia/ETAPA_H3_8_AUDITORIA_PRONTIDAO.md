# MK9 DATE — ETAPA H3.8: AUDITORIA DE PRONTIDÃO PARA IMPLANTAÇÃO

**Data:** 18 de Outubro de 2026  
**Status Geral:** PRONTO PARA HOMOLOGAÇÃO COM DEPENDÊNCIAS DE MIGRAÇÃO  
**Ambiente:** `C:\projetos\mk9-data`  
**Escopo:** Validação comercial, integridade de contratos, ordem de migrations, segurança RLS e planejamento de testes integrados.

---

## 1. Matriz de Classificação de Prontidão

| Área Avaliada | Item / Requisito | Status | Justificativa Técnica |
| :--- | :--- | :---: | :--- |
| **1. Comercial** | Obrigatoriedade de `valor_por_visita` na UI | **Aprovado** | O modal bloqueia valores vazios, zeros, negativos ou NaN com mensagem clara. |
| **1. Comercial** | Validação de `valor_por_visita` no serviço | **Pendente de decisão** | No DTO/serviço, o campo aceita `null` (para compatibilidade histórica). Para gravação via UI, a UI exige valor > 0. Recomenda-se manter assim ou criar flag estrita. |
| **1. Comercial** | Não inferência de valores a partir das rotas | **Aprovado** | Rotas operacionais não possuem dados monetários; valor é 100% digitado pelo gestor. |
| **2. Integridade** | Trigger de sobreposição (`trigger_check_contratos_vigencia_overlap`) | **Aprovado** | Lock pessimista via `FOR UPDATE` na tabela `lojas` e bloqueio estrito de intervalos sobrepostos para status `'ativo'` e `'suspenso'`. |
| **2. Integridade** | Contratos históricos encerrados | **Aprovado** | Contratos com status `'encerrado'` ou `'inativo'` não disparam overlap, liberando novas vigências. |
| **2. Integridade** | Verificação de elegibilidade pré-gravação (Race Condition) | **Pendente de decisão** | Antes de persistir, a interface deve reconsultar ou confiar na trigger de banco (que já é atômica). Recomenda-se revalidação pré-submit na UI. |
| **2. Integridade** | Vigência Contínua vs. Ciclo de Apuração | **Aprovado** | Vigência comercial contínua envia `data_fim_vigencia = null`. Ciclos 23–22 e mensal não afetam o contrato comercial. |
| **3. Migrations** | Migration `data_inicio_operacao` em `industrias` | **Bloqueador** | `20261018150000_add_data_inicio_operacao_to_industrias.sql` deve ser aplicada no banco remoto antes de salvar indústrias com a data. |
| **3. Migrations** | Migration `contratos_lojas` e triggers | **Bloqueador** | `20261017120000_create_contratos_lojas_table.sql` deve ser aplicada no banco remoto antes de qualquer chamada a `createContrato()`. |
| **4. Segurança** | Controle de acesso na interface (UI) | **Aprovado** | Apenas perfis `admin` e `gestor` têm acesso à aba de contratos e ao modal de revisão (`canEdit = hasPermission(['admin', 'gestor'])`). |
| **4. Segurança** | Políticas de RLS (`contratos_lojas`) | **Aprovado** | Políticas granulares: INSERT restrito a admin, gestor e operador; UPDATE restrito; DELETE restrito a admin. |
| **4. Segurança** | Ausência de chamadas de persistência | **Aprovado** | `createContrato()` não é invocado na UI; nenhuma operação de escrita remota foi efetuada. |

---

## 2. Detalhamento Técnico das 4 Áreas da Auditoria

### 2.1. Validação Comercial
- **Na Interface (`IndustriesView.tsx`):**
  - O campo de valor monetário valida `parseFloat(revisaoForm.valor_por_visita)`.
  - Se for vazio, `NaN` ou $\le 0$, bloqueia a submissão com o erro: *"Informe um valor por visita válido e maior que zero (R$)."*
- **No Serviço (`contratosService.ts`):**
  - O `validateContratoPayload` e o DTO `CreateContratoLojaDTO` aceitam `valor_por_visita?: number | null` (rejeitando apenas valores negativos).
  - **Decisão:** Manter o DTO flexível para conciliações históricas ou importações de planilha que possam ter contratos com valor sob negociação (`null`), enquanto o fluxo da UI de autorização individual exige o valor monetário positivo de forma mandatória.

### 2.2. Integridade dos Contratos e Concorrência
- **Trigger `check_contratos_vigencia_overlap`:**
  - Aplica concorrência serializada via lock exclusivo em `public.lojas` (`SELECT 1 FROM lojas WHERE codigo = NEW.loja_codigo FOR UPDATE`).
  - Duas tentativas simultâneas de criar contrato para a mesma loja/indústria são serializadas no nível do motor Postgres. A segunda transação é pausada até o commit da primeira, impedindo sobreposições silenciosas mesmo sob concorrência intensa.
- **Revalidação Prévia na Interface:**
  - Embora a trigger de banco garanta 100% de consistência ACID, a interface deve exibir um Toast amigável caso o banco rejeite a transação com `P0001` (exceção da trigger), capturando o erro e atualizando a lista de contratos automaticamente.

### 2.3. Mapa e Ordem das Migrations Necessárias

As migrations pendentes no Supabase remoto devem ser executadas **estritamente nesta ordem**:

1. **Passo 1 (Pré-requisito das Indústrias):**  
   `supabase/migrations/20261018150000_add_data_inicio_operacao_to_industrias.sql`  
   *Justificativa:* Adiciona a coluna `data_inicio_operacao DATE NULL` na tabela `public.industrias`. Sem ela, o cadastro e edição de indústrias não consegue salvar a data base comercial.
2. **Passo 2 (Tabela de Contratos e Triggers de Overlap):**  
   `supabase/migrations/20261017120000_create_contratos_lojas_table.sql`  
   *Justificativa:* Cria `public.contratos_lojas`, checks de frequência, trigger de validação de overlap com lock pessimista, trigger de `updated_at` e policies de RLS para `authenticated`.
3. **Passo 3 (Opcional / Futuro — Procedure de Sincronização em Lote):**  
   `supabase/migrations/propostas/20261018160000_proposal_sync_contratos_with_data_inicio.sql`  
   *Justificativa:* Deve ser mantida como proposta e aplicada apenas quando e se a MK9 decidir autorizar sincronização em lote. Não é necessária para o fluxo de autorização individual via UI.

### 2.4. Segurança e RLS
- **UI:** Operação visível apenas para `admin` e `gestor`. Operadores, promotores e clientes indústria não visualizam botões de ação ou abas de conciliação contratual.
- **RLS no Banco:** Mesmo que um usuário mal-intencionado execute requisições HTTP diretas pela API do Supabase, o RLS rejeitará qualquer `INSERT` ou `UPDATE` proveniente de perfis que não sejam `admin`, `gestor` ou `operador`.

---

## 3. Testes de Integração Recomendados para Ambiente Isolado (Staging)

Antes de abrir a gravação em produção, recomenda-se executar em banco de homologação:
1. **Teste de Overlap Concorrente:** Duas requisições paralelas inserindo o mesmo par `IND-001` + `LOJ-001` para verificar o bloqueio da trigger.
2. **Teste de Reativação Pós-Encerramento:** Contrato encerrado em `2026-06-30` permitindo nova vigência com início em `2026-07-01`.
3. **Teste de Permissão de Promotor:** Promotor autenticado tentando fazer `INSERT` direto em `contratos_lojas` (deve retornar erro 42501 / RLS violation).
4. **Teste de Vigência Aberta KING:** Contrato KING criado com `data_fim_vigencia = NULL` e verificação da consulta pelo portal da indústria.

---

## 4. Evidências de Validação Local

- `npx tsx --test src/lib/contratosService.test.ts`: **81 testes aprovados** (0 falhas).
- `npm run lint`: **0 erros** (`tsc --noEmit`).
- `npm run build`: **Compilação de produção concluída com sucesso**.
- `git status -s`: Sem arquivos em stage, sem commits realizados.
- **Confirmação Expressa:** Nenhuma gravação remota (`INSERT`, `UPDATE`, `DELETE`, RPC ou migrations) foi executada.

