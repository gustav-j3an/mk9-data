# MK9 DATE — ETAPA H3.4: AUDITORIA CRÍTICA DA PRÉVIA DE CONTRATOS

**Data da Auditoria:** 18 de Outubro de 2026  
**Status do Módulo:** AUDITADO E VALIDADO LOCALMENTE (PRÉVIA SOMENTE LEITURA)  
**Ambiente:** Local (`C:\projetos\mk9-data`)  
**Escopo:** `src/views/IndustriesView.tsx`, `src/lib/contratosService.ts`, tipos de contratos e migrations locais.

---

## 1. Contexto e Objetivos

A Etapa H3.3 conectou a aba **Prévia de Contratos** em `IndustriesView.tsx` à consulta de contratos existentes via `contratosService.listContratos()`. O objetivo desta Etapa H3.4 é executar uma **auditoria crítica completa e independente** sobre a lógica implementada, verificando 9 critérios essenciais de consistência, integridade comercial e segurança operacional antes de liberar qualquer botão ou funcionalidade de criação/autorização de contratos na interface.

---

## 2. Resumo Executivo das Verificações Obrigatórias

| Item | Verificação Obrigatória | Status | Avaliação Técnica |
| :---: | :--- | :---: | :--- |
| **1** | **Contratos encerrados** | **Aprovado com recomendação** | Contratos com status `'encerrado'` ou `'cancelado'` não bloqueiam indevidamente a classificação. O par se torna elegível para nova vigência. |
| **2** | **Múltiplos contratos do mesmo par** | **Aprovado** | O mapa agrupa todos os contratos em `ContratoLoja[]` pelo par `${ind}\|${loj}`. A classificação prioriza a existência de qualquer contrato ativo ou suspenso. |
| **3** | **Vigências e sobreposição** | **Aprovado** | Paridade exata com a trigger `trigger_check_contratos_vigencia_overlap`: a interface bloqueia se houver contrato `ativo` ou `suspenso` com vigência contínua/aberta. |
| **4** | **Conflitos de frequência** | **Aprovado** | A função pura `analyzeRotasForContracts()` segrega estritamente rotas conflitantes em `conflitos`, impedindo que pares com divergência entrem no fluxo de elegíveis. |
| **5** | **Falha de consulta** | **Aprovado (Fail-Safe)** | Se `contratosError` ocorrer (falha de rede ou migration pendente), todos os itens recebem `classificacao = 'ERRO_CONSULTA'`, zerando projeções e `totalElegiveisAptos = 0`. |
| **6** | **Chaves de relacionamento** | **Aprovado** | Tanto rotas quanto contratos utilizam `industria_codigo` e `loja_codigo` normalizados com `.trim().toUpperCase()`. |
| **7** | **Datas e ciclos de apuração** | **Aprovado** | KING (`IND-013`) mantém ciclo contínuo 23 a 22. Demais indústrias exigem `data_inicio_operacao`. Projeção zerada quando cadastro não existir. |
| **8** | **Permissões de acesso** | **Aprovado** | Restrito a `['admin', 'gestor']`. A interface é 100% somente leitura: nenhum botão de gravação, mutação ou RPC exposto. |
| **9** | **Testes e cobertura** | **Aprovado** | 66 testes unitários passando em `contratosService.test.ts`. Build do Vite e linting TypeScript executados com zero erros. |

---

## 3. Análise Detalhada dos 9 Pontos de Auditoria

### 3.1. Contratos Encerrados e Histórico
- **Comportamento no Código:** Em `IndustriesView.tsx` (linhas 636–668), a inspeção filtra contratos da lista do par:
  ```typescript
  const contratoAtivo = contratosDoPar.find((c) => c.status === 'ativo');
  const contratoSuspenso = contratosDoPar.find((c) => c.status === 'suspenso');
  const contratoEncerrado = contratosDoPar.find((c) => c.status === 'encerrado');
  ```
  Se o par possuir apenas contratos históricos encerrados (`status === 'encerrado'`) ou inativos (`status === 'inativo'`), ele não cai nas cláusulas de bloqueio de contrato ativo ou suspenso. Se `data_inicio_operacao` estiver informada, ele é classificado como `ELEGIVEL`.
- **Relação com o Banco de Dados:** A trigger de banco `check_contratos_vigencia_overlap` valida sobreposição exclusivamente quando `NEW.status IN ('ativo', 'suspenso')` contra registros existentes onde `status IN ('ativo', 'suspenso')`. Contratos encerrados ou cancelados não geram conflito na trigger.
- **Recomendação de Próxima Etapa:** Quando for implementada a criação de contratos para pares que já tiveram contratos no passado, a UI de formalização deve validar que a nova data de início de vigência seja posterior à data de encerramento do contrato anterior, prevenindo descontinuidades lógicas no histórico.

---

### 3.2. Múltiplos Contratos por Par de Indústria e Loja
- **Agrupamento Estruturado:** Em `IndustriesView.tsx`, a coleção de contratos retornada por `contratosService.listContratos()` é processada em um `Map<string, ContratoLoja[]>` indexado por `${ind}|${loj}`.
- **Busca Abrangente:** Em vez de utilizar apenas o primeiro registro retornado pela consulta SQL, o código avalia o array completo `contratosDoPar`.
- **Prevalência Conservadora:** Se existirem múltiplos contratos históricos e um deles estiver marcado como `ativo`, o par é imediatamente classificado como `JA_POSSUI_ATIVO`. Se nenhum estiver ativo, mas houver um `suspenso`, recebe `JA_POSSUI_SUSPENSO`. A priorização garante que contratos ativos prevaleçam.

---

### 3.3. Vigências e Sobreposição com a Trigger SQL
- **Regra de Banco (`trigger_check_contratos_vigencia_overlap`):**
  - Aplica lock pessimista via `SELECT ... FOR UPDATE` na tabela `public.lojas`.
  - Verifica sobreposição de intervalos:
    $$\max(\text{inicio}_A, \text{inicio}_B) \le \min(\text{fim}_A, \text{fim}_B)$$
    onde `data_fim_vigencia` nula é tratada como `9999-12-31`.
  - Bloqueia apenas quando `status IN ('ativo', 'suspenso')`.
- **Paridade com a Interface:**
  - A interface impede que qualquer item com contrato ativo ou suspenso receba a marcação `ELEGIVEL`.
  - Contratos vigentes sem data fim (típicos da KING e de contratos contínuos) são identificados como `JA_POSSUI_ATIVO`, bloqueando a autorização redundante.

---

### 3.4. Conflitos de Frequência entre Rotas
- **Isolamento de Conflitos:** A função pura `analyzeRotasForContracts(rotas)` consolida as rotas ativas agrupadas por `${ind}|${loj}`.
- **Detecção de Divergência:** Se para a mesma loja e indústria existirem rotas com frequências diferentes (ex.: rota A = `SEMANAL` e rota B = `QUINZENAL`), o par é encaminhado para a lista `conflitos`.
- **Garantia de Não Contaminação:** Itens conflitantes não entram no array `elegiveis`, não recebem projeção de período e não incrementam o contador de aptos. Eles são renderizados na **Tabela 2 — Conflitos de Frequência**, com aviso de que requerem alinhamento operacional prévio.

---

### 3.5. Tratamento de Falha de Consulta (Fail-Safe)
- **Cenários Cobertos:** Queda de rede, credenciais inválidas, indisponibilidade do Supabase ou ausência da tabela `contratos_lojas` (`MigrationPendingError`).
- **Comportamento Defensivo:**
  - O estado `contratosError` captura a exceção.
  - O `useMemo` checa:
    ```typescript
    if (contratosError) {
      classificacao = 'ERRO_CONSULTA';
      motivoClassificacao = 'Consulta de contratos indisponível. Elegibilidade bloqueada preventivamente.';
    }
    ```
  - Projeções de período são desativadas (`projecao_periodo: undefined`).
  - A métrica `totalElegiveisAptos` é avaliada como zero.
  - Um banner de alerta em destaque informa que os dados não puderam ser verificados contra o banco e bloqueia decisões visuais equivocadas.

---

### 3.6. Chaves de Relacionamento e Integridade Referencial
- **Campos Utilizados:**
  - Tabela `rotas`: `industria_codigo` e `loja_codigo`.
  - Tabela `contratos_lojas`: `industria_codigo` e `loja_codigo` (ambas com foreign keys estritas para `industrias(codigo)` e `lojas(codigo)`).
- **Normalização de String:** Tanto na montagem do mapa de contratos quanto no cruzamento com a análise de rotas, é aplicada a normalização:
  ```typescript
  const key = `${ind.toUpperCase().trim()}|${loj.toUpperCase().trim()}`;
  ```
- **Conclusão:** Não há risco de descasamento por espaçamento ou sensibilidade de caixa alta/baixa.

---

### 3.7. Conformidade das Datas e Ciclos Contratuais
- **KING (`IND-013`):**
  - Reconhecida pelo código exato `IND-013`.
  - Ciclo de apuração contínuo do dia 23 ao dia 22 do mês subsequente.
  - A prévia projeta o ciclo de apuração sem alterar vigência comercial aberta.
- **Demais Indústrias:**
  - Exigem obrigatoriamente a presença de `data_inicio_operacao`.
  - Quando a data de início da operação não está cadastrada na tabela `industrias`, o par recebe `classificacao = 'INICIO_NAO_INFORMADO'` e a projeção de datas é ocultada, impedindo datas fictícias geradas por `CURRENT_DATE`.
  - Quando cadastrada, o primeiro mês projeta início na data efetiva (pro-rata) e encerramento no último dia do mês.

---

### 3.8. Permissões de Acesso e Segurança Operacional
- **Acesso à Aba:** O botão e a aba "Prévia de Contratos" só são visíveis se `hasPermission(['admin', 'gestor'])` for verdadeiro.
- **Operação Estritamente Somente Leitura:**
  - Não existem botões de submissão ("Gravar Contrato", "Sincronizar", "Aprovar").
  - Não há chamadas à procedure `sync_contratos_from_rotas()` nem a triggers no cliente.
  - Nenhum endpoint de mutação (`insert`, `update`, `delete`) é acionado pela aba.

---

### 3.9. Testes e Estabilidade Técnica
- **Testes Unitários:** Executados com sucesso via `npx tsx --test src/lib/contratosService.test.ts`:
  - **Total de testes:** 66
  - **Suites:** 17
  - **Aprovados:** 66
  - **Falhas:** 0
- **Verificação de Tipos e Lint:** Executado `npm run lint` (`tsc --noEmit`):
  - **Erros:** 0
- **Compilação de Produção:** Executado `npm run build` (`vite build`):
  - **Status:** Sucesso completo.

---

## 4. Decisões Administrativas Pendentes para a Próxima Etapa (Criação de Contratos)

Antes de implementar o fluxo de gravação ou autorização individual de contratos por gestores:

1. **Definição do Valor por Visita:** O valor por visita (`valor_por_visita`) não está presente na tabela de rotas. Na tela de autorização, o gestor deverá preencher ou confirmar um valor padrão acordado comercialmente.
2. **Definição da Data de Término da Vigência:** Para a KING, o contrato permanece contínuo (`data_fim_vigencia = NULL`). Para as demais indústrias, definir se o contrato é cadastrado por prazo indeterminado (`NULL`) ou se terá data final estipulada no formulário de autorização.
3. **Aplicação das Migrations em Ambiente Remoto:** As migrations `20261017120000_create_contratos_lojas_table.sql` e `20261018150000_add_data_inicio_operacao_to_industrias.sql` ainda estão pendentes de execução no banco de produção/staging remoto.

