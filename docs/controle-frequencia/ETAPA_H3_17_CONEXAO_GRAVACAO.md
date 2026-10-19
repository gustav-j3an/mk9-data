# MK9 Data — Etapa H3.17: Revisão Funcional e Conexão de Gravação de Contratos

**Data:** 18 de Outubro de 2026  
**Status:** Concluído com Sucesso  
**Componentes Revisados e Conectados:**
- [src/views/IndustriesView.tsx](file:///c:/projetos/mk9-data/src/views/IndustriesView.tsx)
- [src/lib/contratosService.ts](file:///c:/projetos/mk9-data/src/lib/contratosService.ts)
- [src/lib/contratosService.test.ts](file:///c:/projetos/mk9-data/src/lib/contratosService.test.ts)

---

## 1. Revisão das Camadas de Validação Comercial e Integridade

### 1.1 Regra Comercial KING (`IND-013`) vs Demais Indústrias
Conforme diretriz, a validação não se restringiu ao banco de dados:
- **Indústria KING (`IND-013`):**
  - Implementada com rigor matemático em `calcularPeriodoContratual()` e `prepareContratoInsertData()`.
  - Opera no ciclo contínuo **23 de um mês a 22 do mês subsequente** (com competência atribuída ao mês final).
  - É a única indústria independente da presença mandatória de `data_inicio_operacao`, pois seu ciclo histórico e contínuo opera sob a regra 23-22.
- **Demais Indústrias (Calendário Padrão):**
  - Quando `data_inicio_operacao` estiver informada no cadastro, o primeiro ciclo apura no formato **pro-rata** (da data de início ao último dia do mês).
  - Ciclos subsequentes operam do dia 01 ao último dia do mês.
  - Caso `data_inicio_operacao` não esteja preenchida na tabela `industrias`, a aplicação classifica o par como `INICIO_NAO_INFORMADO` e bloqueia a autorização direta, orientando regularização prévia no cadastro.

---

## 2. Implementação da Conexão e Tratamento de Erros

### 2.1 Conexão no Modal de Revisão (`IndustriesView.tsx`)
A ação de autorização individual na aba *Prévia de Contratos* foi conectada ao serviço de persistência:
1. **Validação do Formulário no Front-End:**
   - **Valor por visita:** Mandatório, numérico, estritamente maior que zero (`> 0`). Não é permitido prosseguir com valor vazio ou negativo.
   - **Vigência comercial:** Opção explícita entre contrato contínuo (`data_fim_vigencia = null`) ou prazo determinado.
   - **Data de término:** Validada contra formato ISO e coerência de calendário; bloqueada caso seja anterior à data de início.
2. **Construção do DTO Sanitizado (`CreateContratoLojaDTO`):**
   - Transmissão padronizada para `contratosService.createContrato()`, garantindo que apenas colunas válidas sejam enviadas.
3. **Tratamento de Erros e Feedback de Interface:**
   - Tratamento de `isMigrationPending` via `MigrationPendingError` caso a tabela não exista.
   - Tratamento de exceção de trigger de sobreposição (`check_contratos_vigencia_overlap`), exibindo toast claro em caso de conflito temporal.
   - Estado `savingContrato` que desabilita botões contra duplicação de cliques e aciona indicador de progresso (*spinner*).
   - Ao salvar com sucesso: fecha o modal, notifica o usuário via toast e executa `fetchContratos()`, atualizando a lista e reclassificando o par imediatamente para `JA_POSSUI_ATIVO`.

---

## 3. Verificação de Regressão e Integridade da Aplicação

- **Testes Unitários e de Integração da Aplicação:**
  - `npx tsx --test src/lib/contratosService.test.ts`
  - **81 testes executados, 81 testes aprovados (0 falhas em 22 suítes)**.
- **Verificação Estática de Tipos (TypeScript Lint):**
  - `npm run lint` (`tsc --noEmit`)
  - **0 erros**.
- **Build de Produção (Vite):**
  - `npm run build`
  - **Sucesso em 770ms**.
- **Segurança de Ambientes:**
  - Nenhuma alteração foi promovida para o ambiente remoto de produção.
  - Nenhum commit foi realizado no Git.

