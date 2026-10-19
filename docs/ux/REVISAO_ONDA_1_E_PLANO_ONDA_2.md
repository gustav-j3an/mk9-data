# MK9 Date — Revisão da Onda 1 e Planejamento da Onda 2

**Data:** 18 de Outubro de 2026  
**Status:** Revisão Concluída / Planejamento Aprovado para Próxima Execução  
**Ambiente:** Supabase Local Docker & Vite Dev Server (`http://localhost:3000`)

---

## 1. Revisão Técnica da Onda 1

### 1.1. Inspeção de Diff (`git diff`)
- **`src/components/AppShell.tsx`**:
  - Implementado o estado `sidebarCollapsed` com persistência em `localStorage` (`mk9_sidebar_collapsed`).
  - Menu lateral dividido em **8 grupos semânticos** (Visão Geral, Operação & Visitas, Roteiros & Frequências, Redes & Parceiros, Pessoas & Equipes, Financeiro & Auditoria, Portais Dedicados, Configurações & Acessos).
  - Modo recolhido com largura de **72px** e modo expandido com **260px**, utilizando transições suaves (`transition-all duration-300 ease-in-out`).
  - No modo recolhido (`isCompact`), adicionados tooltips flutuantes (`group-hover/nav:opacity-100`) contendo o rótulo da tela e o grupo funcional correspondente.
  - No topo (`header`), adicionado componente de breadcrumbs dinâmico mostrando o grupo ativo e o nome da tela (`[Grupo] / [Tela]`).
  - O viewport principal (`main`) ajusta seu espaçamento lateral proporcionalmente (`lg:pl-[72px]` vs `lg:pl-[260px]`).

- **`src/utils/promoterPortalWeekly.test.ts`**:
  - **Por que foi alterado:** Ao rodar `npm run lint` (`tsc --noEmit`), o compilador TypeScript apontou que o arquivo importava `RouteItem` e `Visit` de `./routePlanner.js`, que não os exportava diretamente, e que os objetos de mock não contemplavam os campos obrigatórios `uf` em `RouteItem` e `storage_path` em `VisitPhoto`.
  - **Justificativa e Integridade:** O import foi ajustado para `import type { RouteItem, Visit } from '../types.js'` e os dados de teste foram enriquecidos com valores válidos (`uf: 'SP'`, `storage_path: 'photos/p1.jpg'`). Essa alteração **não relaxou nenhuma asserção** dos testes e **não alterou nenhuma regra comercial**. O teste agora compila de forma estrita e passa com 100% de sucesso (5 subtestes executados e aprovados).

---

## 2. Validação da Navegação Global e Permissões

### 2.1. Correspondência dos 8 Grupos com as Telas Reais
Todos os destinos mapeados no `AppShell.tsx` conectam-se a telas implementadas no roteamento de `App.tsx`:
1. **Visão Geral:**
   - `cockpit` ➔ `CockpitView.tsx`
   - `painel-operacional` ➔ `OperationalDashboardView.tsx`
2. **Operação & Visitas:**
   - `acompanhamento-visitas` ➔ `VisitsTrackingView.tsx`
   - `presenca` ➔ `AttendanceControlView.tsx`
3. **Roteiros & Frequências:**
   - `rotas-fixas` ➔ `RoutesView.tsx`
4. **Redes & Parceiros:**
   - `lojas` ➔ `StoresView.tsx`
   - `industrias` ➔ `IndustriesView.tsx`
5. **Pessoas & Equipes:**
   - `promotores` ➔ `PromotersView.tsx`
   - `freelancers` ➔ `FreelancersView.tsx`
   - `gestao-equipes` ➔ `TeamsManagementView.tsx`
   - `supervisores` ➔ `SupervisorsManagementView.tsx`
6. **Financeiro & Auditoria:**
   - `controle-diarias` ➔ `DailiesControlView.tsx`
7. **Portais Dedicados:**
   - `portal-promotor` ➔ `PromoterPortalView.tsx`
   - `portal-industria` ➔ `IndustryPortalView.tsx`
8. **Configurações & Acessos:**
   - `usuarios` ➔ `UsersPermissionsView.tsx`
   - `importacao` ➔ `ImportView.tsx`
   - `design-system` ➔ `DesignSystemView.tsx`
   - `meu-perfil` ➔ `ProfileView.tsx`

### 2.2. Respeito às Permissões
- A função de guarda `hasPermission(item.permission)` é avaliada para cada item.
- Se uma seção não tiver nenhum item visível para o perfil do usuário logado, o grupo inteiro não é renderizado, garantindo ausência de poluição visual.

### 2.3. Separação de Testes Automatizados vs. Verificação Visual Manual

| Tipo | Itens Validados | Resultado / Método |
| :--- | :--- | :--- |
| **Automatizado** | Typecheck estrito de todo o projeto | `npm run lint` ➔ **0 erros** |
| **Automatizado** | Build de produção e resolução de dependências | `npm run build` ➔ **Sucesso (1.08s)** |
| **Automatizado** | 81 testes de vigência e regras de contratos | `npx tsx --test src/lib/contratosService.test.ts` ➔ **81/81 aprovados** |
| **Automatizado** | 5 testes de visualização semanal do promotor | `npx tsx --test src/utils/promoterPortalWeekly.test.ts` ➔ **5/5 aprovados** |
| **Visual / Manual** | Transição de 260px para 72px e comportamento de chevron | Requer visualização no navegador desktop em resolução >= 1024px. |
| **Visual / Manual** | Posicionamento do tooltip flutuante ao passar o mouse | Requer verificação visual no modo recolhido (não deve quebrar margem). |
| **Visual / Manual** | Abertura do menu gaveta em tablet (768px) e mobile (375px) | Requer inspeção das media queries `sm:` e `lg:` no viewport responsivo. |

---

## 3. Preparação e Arquitetura da Onda 2

A **Onda 2** terá como foco os componentes compartilhados da camada de apresentação (Core UI Components), padronizando a interface conforme os tokens já catalogados em `DesignSystemView.tsx` e evitando duplicações desnecessárias.

### 3.1. Diagnóstico de Componentes Existentes e Oportunidades
Atualmente em `src/components/`, existem apenas:
- `AppShell.tsx`
- `AuthorSignature.tsx`
- `ErrorBoundary.tsx`
- `PWAInstallPrompt.tsx`
- `SearchableSelect.tsx`
- `reports/ExecutiveReportDocument.tsx`

Não existem componentes compartilhados para `DataTable`, `StatCard` ou `StatusBadge`. Cada tela (`IndustriesView`, `StoresView`, `FreelancersView`, `AttendanceControlView`, `CockpitView`) implementa sua própria tabela HTML `<table />`, seus próprios cards de métricas e badges inline com classes Tailwind variadas (ex.: texto branco sobre fundo bege identificado em linhas da tabela de contratos de `IndustriesView.tsx`).

### 3.2. Proposta de Padronização para a Onda 2

#### A. Componente `DataTable` (`src/components/ui/DataTable.tsx`):
- **Objetivo:** Fornecer paginação real no cliente (10, 25, 50 registros), ordenação por coluna clicável (com indicador de seta) e busca rápida integrada.
- **Estrutura:**
  - Header estilizado no padrão GridCraft (`#E3E1DA` com bordas `#CFCDC5`, texto font-mono bold uppercase).
  - Estados de `loading` (spinner estilizado) e `empty` (ícone amigável com mensagem contextual).
  - Linhas com contraste garantido (`text-[#171717]`, zebra suave e hover `#EAE8E1`).
  - Rodapé com contagem de registros exibidos vs. total e botões de página Anterior / Próxima.
- **Prioridade de Adoção:** Telas com grande volume de dados (`IndustriesView` - aba Contratos e Frequência, e `StoresView`).

#### B. Componente `StatCard` (`src/components/ui/StatCard.tsx`):
- **Objetivo:** Padronizar os cartões de indicadores de topo presentes em quase todas as telas operacionais.
- **Variantes:**
  - `default`: Fundo `#F7F6F2`, borda `#CFCDC5`, texto escuro `#171717`.
  - `success`: Borda `#16845B`/30 com destaque em verde.
  - `warning`: Borda `#D98A00`/30 com destaque em âmbar.
  - `danger`: Borda `#D93636`/30 com destaque em vermelho.
  - `info`: Borda `#286FF5`/30 com destaque em azul.
- Suporte a ícone Material Symbols, label mono em caixa alta, valor tabular em fonte mono e subtítulo opcional.

#### C. Componente `StatusBadge` (`src/components/ui/StatusBadge.tsx`):
- **Objetivo:** Unificar as dezenas de variantes de badges dispersas pelo sistema.
- **Mapeamento de Status:**
  - `ativo` / `conforme` / `concluida`: Verde `#16845B` com fundo `#E8F5EE`.
  - `pendente` / `em_andamento` / `a_pagar`: Âmbar `#D98A00` com fundo `#FFF8E6`.
  - `inativo` / `cancelado` / `falta` / `ruptura`: Vermelho `#D93636` com fundo `#FDF2F2`.
  - `extra` / `semanal`: Azul `#286FF5` com fundo `#EBF2FE`.
  - `quinzenal`: Roxo com fundo leve.
  - `neutro` / `sem_registro`: Cinza `#737373` com fundo `#E4E2DB`.
- Ponto pulsante ou estático indicativo e tipografia legível `font-mono text-[10px] font-bold`.

---

## 4. Riscos Mapeados e Plano de Mitigação

1. **Risco de Quebra em Telas Existentes:**
   - *Mitigação:* Os novos componentes `DataTable`, `StatCard` e `StatusBadge` serão criados isoladamente em `src/components/ui/`. Nenhuma tela existente será modificada de imediato até que os componentes estejam testados e validados unitariamente e com tipagem estrita.
2. **Risco de Regressão em Regras de Negócio e Contratos:**
   - *Mitigação:* A tabela de contratos de `IndustriesView` preservará 100% dos dados calculados por `analyzeRotasForContracts`, `classificarParContratual` e `prepareContratoInsertData`. Apenas a camada de renderização visual (apresentação tabular) será beneficiada pela paginação e ordenação do `DataTable`.
3. **Risco de Divergência de Contrastes:**
   - *Mitigação:* Seguir à risca os tokens de `DesignSystemView.tsx` (`#171717` para texto principal, `#737373` para texto secundário sobre `#F7F6F2` e `#EAE8E2`).

---

## 5. Próximos Passos (Aguardando Autorização)

- [ ] Criar a pasta `src/components/ui/` e implementar `StatusBadge.tsx` com tipagem estrita e tokens ArtCraft.
- [ ] Implementar `StatCard.tsx` com variantes de status.
- [ ] Implementar `DataTable.tsx` genérico com paginação no cliente, ordenação tipada e busca.
- [ ] Aplicar os novos componentes de forma piloto na tabela de **Lojas** (`StoresView.tsx`) e na tabela de **Contratos Elegíveis** de `IndustriesView.tsx`.
- [ ] Rodar a suíte completa de verificação (`npm run lint`, `npm run build`, testes de contrato).

