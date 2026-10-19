# MK9 DATE — ONDA 4.2: MODERNIZAÇÃO DO CABEÇALHO E INDICADORES OPERACIONAIS

**Data:** 18/10/2026  
**Status:** Concluído com Sucesso  
**Módulo:** Painel Operacional (`src/views/OperationalDashboardView.tsx`)  
**Design System Adotado:** Padrão ArtCraft / GridCraft (Tokens neutros `#EAE8E2`, `#F7F6F2`, `#171717`, `#CFCDC5`)

---

## 1. ARQUIVOS ALTERADOS E CRIADOS

1. **`src/views/OperationalDashboardView.tsx`:**
   - Modernização do cabeçalho operacional com título conciso, descrição e indicação do período ativo no HUD;
   - Controles de período com estados rápidos (`Hoje`, `7 dias`, `Mês`) e botão de atualização com feedback de carregamento;
   - Banner institucional de Modo Operacional modernizado com chips [`StatusBadge`](file:///c:/projetos/mk9-data/src/components/ui/StatusBadge.tsx) (`Telemetria Pré-SLA` vs `SLA Ativo`);
   - Substituição dos cards manuais superiores pelos componentes reutilizáveis [`StatCard`](file:///c:/projetos/mk9-data/src/components/ui/StatCard.tsx).
2. **`src/components/ui/StatCard.tsx`:**
   - Adicionado suporte nativo a `onClick` com acessibilidade (`role="button"`, `tabIndex={0}`, navegação por teclado com Enter/Espaço);
   - Adicionado suporte a `badge` no canto superior direito e `subtitle` no rodapé do card;
   - Preservação total de compatibilidade com todos os usos existentes do componente.
3. **`src/utils/operationalDashboardHeader.test.ts` (Novo):**
   - Suíte de testes automatizados via Node Test Runner validando variantes semânticas, atalhos de navegação, mapeamento de períodos e modo operacional.

---

## 2. COMPONENTES REUTILIZADOS

- **[`StatCard`](file:///c:/projetos/mk9-data/src/components/ui/StatCard.tsx):**
  - **Visitas de Hoje:** Variante `info`, exibindo total de concluídas, badge com total planejado e detalhamento de visitas em andamento, pendentes e não realizadas.
  - **Pendências Críticas:** Variante dinâmica (`danger` quando há atrasadas, `warning` caso contrário), badge com pendências no período e detalhamento de hoje e não realizadas.
  - **Rupturas Abertas:** Variante dinâmica (`danger` quando há rupturas em aberto, `success` quando zeradas), badge com total geral e detalhamento de resolvidas no filtro.
  - **Vencimentos Críticos:** Variante dinâmica (`danger` para vencidos ou a vencer em até 3 dias, `success` quando zerados), badge de itens monitorados e chips de criticidade.
- **[`StatusBadge`](file:///c:/projetos/mk9-data/src/components/ui/StatusBadge.tsx):**
  - Utilizado no banner superior de diretrizes operacionais de SLA:
    - Modo `IMPLANTACAO`: Badge `neutro` com rótulo "Telemetria Pré-SLA".
    - Modo `OPERACAO_OFICIAL`: Badge `conforme` com rótulo "SLA Ativo".

---

## 3. MELHORIAS IMPLEMENTADAS

1. **Eliminação de Sobrecarga e Melhoria de Contraste:**
   - Fim dos textos brancos sobre fundos claros ou cores berrantes sem propósito semântico;
   - Aplicação estrita da paleta ArtCraft: fundos `#F7F6F2`, bordas `#CFCDC5`, texto primário `#171717` e secundário `#737373`.
2. **Interatividade e Acessibilidade (Atalhos Funcionais):**
   - Cada um dos 4 `StatCards` atua como gatilho de navegação intuitivo:
     - Card **Visitas de Hoje** $\rightarrow$ ativa a aba `visitas_hoje` na Central;
     - Card **Pendências Críticas** $\rightarrow$ ativa a aba `pendencias` na Central;
     - Card **Rupturas Abertas** $\rightarrow$ ativa a aba `rupturas` no bloco de Ocorrências filtrando por "abertas";
     - Card **Vencimentos Críticos** $\rightarrow$ ativa a aba `validades` no bloco de Ocorrências filtrando por "vencidos".
   - Foco visível por teclado e acionamento por tecla Enter/Espaço.
3. **HUD de Sincronização e Período:**
   - O cabeçalho exibe claramente o período selecionado e o carimbo de data/hora da última sincronização com o Supabase.

---

## 4. REGRAS DE NEGÓCIO E DADOS PRESERVADOS

- **Fórmulas e Métricas:** Nenhuma fórmula matemática foi alterada. Os valores de `plannedItemsToday`, `agendaDoDia`, `pendenciasKpis`, `rupturasAbertasFiltradasCount` e `todasValidades` permanecem calculados pelo motor de telemetria original.
- **SLA e Modos Operacionais:** O comportamento de `systemSettings` foi preservado integralmente, respeitando as regras de transição entre fase de calibração e operação com penalidade.
- **Permissões:** O acesso ao painel continua restrito a perfis autorizados (`admin` e `gestor`) no `AppShell`.

---

## 5. RESULTADOS DOS TESTES E VALIDAÇÃO TÉCNICA

- **Linter (`npm run lint` / `tsc --noEmit`):** Executado com código de saída 0 (zero erros de tipagem TypeScript).
- **Build de Produção (`npm run build`):** Compilado com sucesso em 712ms, gerando os bundles de produção sem falhas.
- **Suíte de Testes Automatizada (`npx tsx src/utils/operationalDashboardHeader.test.ts`):** 5 testes executados, 5 aprovados (0 falhas).
- **Suítes de Regressão Anteriores:**
  - `src/utils/aderenciaAudit.test.ts`: 12 testes aprovados.
  - `src/utils/routesGridAudit.test.ts`: 15 testes aprovados.

---

## 6. LIMITAÇÕES ENCONTRADAS

- Os períodos disponíveis no cabeçalho são `Hoje` (1 dia), `7 dias` (últimos 7 dias) e `Mês` (últimos 30 dias), conforme o suporte real de query da tabela `visits`. Intervalos customizados arbitrários não foram introduzidos nesta etapa para evitar divergências de conciliação com o motor `calculateOperationalVisits`.

---

## 7. PRÓXIMA ETAPA RECOMENDADA

Prosseguir para a **ONDA 4.3 — CENTRAL DE ATENÇÃO OPERACIONAL E CONCILIAÇÃO DE VISITAS**:
- Substituir as tabelas manuais de Alertas Ativos, Pendências & Agendas e Visitas de Hoje pelo componente reutilizável [`DataTable`](file:///c:/projetos/mk9-data/src/components/ui/DataTable.tsx);
- Implementar paginação real e busca combinada de promotores/lojas nas sub-abas da Central.

