# MK9 Data — Etapa H3.19: Auditoria de Consistência e Preparação para Homologação

**Data:** 18 de Outubro de 2026  
**Status do Módulo:** Apto e Seguro para Homologação Local (Docker) — Requer Homologação Operacional antes de qualquer promoção para Produção  
**Ambiente de Auditoria:** PostgreSQL Local Docker (`127.0.0.1:54322`) & Repositório Local (`C:\projetos\mk9-data`)

---

## 1. Resumo Executivo

A auditoria global de consistência das etapas H3.15 até H3.18 foi concluída.
O módulo de contratos e controle de frequência apresenta alto nível de integridade técnica e desacoplamento defensivo:
1. **Isolamento de Produção:** Nenhuma migration, escrita ou sincronização foi enviada ao Supabase remoto (`https://xzmbesqhxcnuokjwrbnw.supabase.co`).
2. **Defesa em Múltiplas Camadas:** As regras comerciais estão validadas no Front-End (`IndustriesView.tsx`), na camada de Serviço DTO pura (`contratosService.ts`), nas constraints e triggers de concorrência com lock pessimista (`trigger_check_contratos_vigencia_overlap`) e nas políticas de segurança em nível de linha (RLS).
3. **Desacoplamento de Rotas e Contratos:** A malha operacional de rotas (`public.rotas`) e o modelo formal de contratos (`public.contratos_lojas`) permanecem desacoplados. A sincronização automática em massa (`sync_contratos_from_rotas`) **não foi disparada**, mantendo a criação estritamente sob demanda administrativa.

---

## 2. Matriz de Auditoria das Regras Comerciais

| # | Regra Comercial | Onde está Implementada | Onde é Garantida | Evidência de Teste / Validação |
|---|-----------------|------------------------|------------------|--------------------------------|
| **1** | **KING (`IND-013`):** Vigência contínua e ciclo 23 a 22 (competência mês final) | Aplicação: `calcularPeriodoContratual()` e `prepareContratoInsertData()` | Aplicação (função pura sem fuso horário) | 12 testes unitários em `contratosService.test.ts` (desvios de ano, meses com 28/29/30/31 dias, dia 22 vs dia 23) e `test_functional_e2e.ts`. |
| **2** | **Demais Indústrias:** Primeiro ciclo condicionado a `data_inicio_operacao` | Aplicação: `classificarParContratual()` e `prepareContratoInsertData()` / Banco: coluna `data_inicio_operacao DATE NULL` | Aplicação e Banco (Schema) | `test_functional_e2e.ts` e suíte unitária: sem data de cadastro, o par é marcado como `INICIO_NAO_INFORMADO` e o botão fica bloqueado. |
| **3** | **Frequência Operacional vs Período de Apuração:** Independência de conceitos | Aplicação: `analyzeRotasForContracts()` e DTO / Banco: colunas separadas | Aplicação e Banco | Frequência (`SEMANAL`, `QUINZENAL`, `MENSAL`) define dias de visita; `data_inicio_vigencia` e `data_fim_vigencia` definem a janela contratual. Teste unitário 7.6.11 comprova independência. |
| **4** | **Prevenção de Sobreposição Temporal:** Mesmo par indústria + loja | Banco: `trigger_check_contratos_vigencia_overlap()` com lock em `public.lojas` / Aplicação: `checkVigenciaOverlap()` | **PostgreSQL (Trigger Estrita)** | Cenário 5 de integração SQL e `test_scenarios_db.sql`: bloqueia com `Conflito de vigência contratual...`. |
| **5** | **Tratamento de Contratos Encerrados/Suspensos:** Histórico não bloqueante | Banco: Condição `status IN ('ativo', 'suspenso')` no trigger / Aplicação: `classificarParContratual()` | PostgreSQL e Aplicação | Cenário 7 de integração SQL: contrato com status `encerrado` não bloqueia nova vigência simultânea. |
| **6** | **Compatibilidade com Lojas, Indústrias e Rotas:** Chaves estrangeiras | Banco: FKs `ON UPDATE CASCADE ON DELETE RESTRICT` | **PostgreSQL (Foreign Keys)** | `contratos_lojas_industria_codigo_fkey` e `contratos_lojas_loja_codigo_fkey` impedem orfandade de dados. |
| **7** | **Consistência UI vs Serviço vs Banco:** Tipagem e DTO | Front: `IndustriesView.tsx`, Serviço: `contratosService.ts`, Banco: `contratos_lojas` | Todas as camadas | `npm run lint` (0 erros), DTO `CreateContratoLojaDTO` sanitizado, 81 testes de regressão. |
| **8** | **Valor por Visita:** Obrigatoriedade no formulário e compatibilidade legada | Front: `> 0` obrigatório no modal / Banco: `CHECK (valor_por_visita IS NULL OR valor_por_visita >= 0)` | Front (obrigatório) e Banco (positivo ou null para legado) | Cenários 2 e 3 de `test_functional_e2e.ts` e constraint SQL validada com rollback. |
| **9** | **Permissões de Acesso (RLS):** CRUD granular por perfil | Banco: 4 policies RLS (`contratos_lojas_*_policy`) / UI: `canEdit = hasPermission(['admin', 'gestor'])` | **PostgreSQL (RLS)** e UI | Cenário 9 de `test_rls_scenarios.sql` e Cenário 12 de `test_scenarios_db.sql`: Admin possui CRUD completo; `client_industry` é restrito à sua indústria; Operador não pode fazer DELETE. |

---

## 3. Auditoria de Integração e Pontos de Entrada no Sistema

Uma varredura completa no código-fonte identificou todos os locais de interação com `contratos_lojas`:
1. **Criação de Contratos:**
   - **Único ponto de entrada ativo:** Modal administrativo individual em `src/views/IndustriesView.tsx` através de `contratosService.createContrato()`.
   - **Ponto de entrada batch (em espera):** Procedure `sync_contratos_from_rotas()` em `contratosService.runSyncFromRotas()`, preservada e não acionada.
2. **Consulta e Leitura:**
   - `contratosService.listContratos()` em `IndustriesView.tsx` para carregar a grade de pré-visualização e confrontar pares já contratados.
3. **Classificação e Projeção:**
   - `analyzeRotasForContracts()` e `classificarParContratual()` em `contratosService.ts`.
4. **Conclusão de Auditoria de Integração:**
   - Não foram encontradas rotas órfãs, chamadas legadas divergentes ou tentativas de gravação direta fora do `contratosService`.

---

## 4. Auditoria de Segurança e Integridade do PostgreSQL

- **Bypass de Interface Impossível:** As regras críticas (não-sobreposição de vigências ativas, integridade referencial de indústria e loja, valores não negativos e restrição de exclusão para não-admins) são garantidas no banco via Triggers, Constraints e RLS com `SECURITY DEFINER`. Mesmo que uma requisição burle a UI, o PostgreSQL aborta a transação (`ON_ERROR_STOP`).
- **Prevenção de Race Conditions:** O trigger `trigger_check_contratos_vigencia_overlap` realiza um lock pessimista (`SELECT 1 FROM public.lojas WHERE codigo = NEW.loja_codigo FOR UPDATE`), serializando requisições concorrentes e eliminando brechas de concorrência.

---

## 5. Auditoria de Arquivos Temporários (`scratch/`)

Os arquivos presentes na pasta `scratch/` foram catalogados:
- **Scripts de Teste Funcional e Integração (Úteis para Regressão Local):**
  - `scratch/test_functional_e2e.ts`: Testes de regras puras e validação de formulário (TypeScript).
  - `scratch/test_scenarios_db.sql`: Testes de inserção, concorrência e RLS (SQL).
  - `scratch/test_rls_scenarios.sql`: Bateria de testes de permissões RLS multi-tenant (SQL).
  - `scratch/test_local_db_e2e.ts`: Script utilitário de conexão local.
- **Arquivos Históricos / Referência:**
  - `scratch/reference.pdf` e `scratch/promoter_portal_ref.pdf`: Documentos de especificação de produto.
  - Scripts de auditoria visual de outubro/2026 (`audit_and_fix_inputs.js`, `deep_audit_contrast.js`, etc.).
- **Análise de Segurança:** Nenhum arquivo temporário contém credenciais privadas ou dados sensíveis de produção.
- **Recomendação:** Manter os scripts de teste em `scratch/` como suíte auxiliar de integração ou migrá-los formalmente para uma pasta `tests/integration/` no momento oportuno.

---

## 6. Estado do Banco de Dados Local

- **Contagem atual de contratos em `public.contratos_lojas`:** **0 registros**.
  - Este é exatamente o **estado esperado**, pois todas as validações anteriores foram executadas com blocos transacionais e `ROLLBACK`, preservando a base limpa para a homologação com o usuário.
- **Registros preexistentes:** 1 indústria (`IND-001`) e 1 perfil (`admin.homolog@mk9.local`), ambos intactos.

---

## 7. Resultados dos Testes de Regressão

- **Testes Unitários:** `npx tsx --test src/lib/contratosService.test.ts`
  - **81 testes executados, 81 testes aprovados (0 falhas em 22 suítes)**.
- **TypeScript Lint:** `npm run lint` (`tsc --noEmit`)
  - **0 erros**.
- **Build de Produção:** `npm run build` (Vite v8.3.1)
  - **100% aprovado** em 821ms.

---

## 8. Parecer Final e Recomendações

> [!IMPORTANT]
> **Parecer de Prontidão:**  
> O módulo de contratos e controle de frequência está **TOTALMENTE PRONTO PARA HOMOLOGAÇÃO NO AMBIENTE LOCAL (DOCKER)**.  
> **Não deve ser promovido para o ambiente de produção** sem antes passar pelo ciclo formal de homologação assistida com dados sintéticos no ambiente local ou de staging.

### Recomendações para a Próxima Etapa:
1. **Executar a Homologação Assistida:** O usuário ou equipe de operações pode utilizar a interface local para autorizar o primeiro contrato de teste real no banco Docker e observar a persistência e transição de status na UI.
2. **Definição sobre a Carga Inicial em Lote:** Decidir, em momento futuro e controlado, se a procedure `sync_contratos_from_rotas` será disparada para popular os contratos a partir das rotas existentes ou se a adoção continuará sendo individual/sob demanda.

