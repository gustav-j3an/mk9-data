# DIAGNÓSTICO TÉCNICO ATUAL — MK9 DATE
## Controle Contratual, Frequência de Visitas e Auditoria Operacional
Data da Auditoria: 17/10/2026

---

## 1. Visão Geral da Arquitetura Encontrada

O **MK9 Date** é um ecossistema Single Page Application (SPA) construído em React 19, TypeScript e Vite, integrado ao backend Supabase (PostgreSQL 15+, Auth, Realtime, Row Level Security e Storage).

### 1.1 Camadas do Frontend
- **Ponto de Entrada**: `index.html` -> `src/main.tsx` -> `src/App.tsx`.
- **Roteamento**: `react-router-dom` gerenciando rotas públicas (`/login`, `/reset-password`) e protegidas (`ProtectedRoute`) dentro do `AppShell`.
- **Shell e Navegação**: `src/components/AppShell.tsx` renderiza sidebar, header com busca global (Ctrl+K), notificações persistentes em tempo real, avatar de usuário e prompt de instalação PWA.
- **Restauração de Perfis e RBAC**: `src/auth/AuthProvider.tsx` e `src/types.ts` mapeiam cinco papéis de usuários (`UserRole`):
  1. `admin`: Acesso irrestrito a configurações, auditorias, importações e gestão.
  2. `gestor`: Acesso operacional e gestão de equipes, supervisores e rotas.
  3. `operador`: Acesso operacional restrito (sem importação e gestão de usuários).
  4. `promotor`: Acesso estrito ao Portal do Promotor (`portal-promotor`).
  5. `client_industry`: Acesso estrito ao Portal da Indústria (`portal-industria`), isolado pelo campo `industria_codigo` do perfil.

---

## 2. Inventário de Módulos e Funcionalidades

### 2.1 Cadastros Mestres e Entidades Principais
| Entidade | Tabela Supabase | Interface / View | Status Atual |
|---|---|---|---|
| **Indústrias** | `public.industrias` | `src/views/IndustriesView.tsx` | **Completo**: CRUD, código autogerado, CNPJ, status ativo/inativo e aba de telemetria de frequência. |
| **Lojas (PDVs)** | `public.lojas` | `src/views/StoresView.tsx` | **Completo**: CRUD, código autogerado, rede, endereço, UF, status ativo/inativo. |
| **Promotores** | `public.promotores` | `src/views/PromotersView.tsx` | **Completo**: Cadastro, matrícula única, vinculação a supervisor e equipe. |
| **Equipes** | `public.equipes` | `src/views/TeamsManagementView.tsx` | **Completo**: Gestão regional, vinculação de promotores e métricas de cobertura de PDVs. |
| **Supervisores** | `public.supervisores` | `src/views/SupervisorsManagementView.tsx` | **Completo**: Estrutura hierárquica de supervisão de campo. |
| **Rotas Fixas** | `public.rotas` | `src/views/RoutesView.tsx` | **Operacional**: Chave `(promotor_matricula, loja_codigo, industria_codigo)`. Frequência semanal ou quinzenal com flags booleanas (`segunda`..`domingo`). |
| **Visitas** | `public.visits` | `src/views/VisitsTrackingView.tsx`, `PromoterPortalView.tsx` | **Completo**: Check-in/out, geolocalização, checklist, fotos, ocorrências, validade de produtos. |

### 2.2 Motor de Cálculo Operacional (`src/utils/routePlanner.ts`)
- O motor `calculateOperationalVisits` consolida as rotas fixas (`RouteItem`) com as visitas reais (`Visit`), considerando:
  - Frequência semanal (dias ativos na rota).
  - Frequência quinzenal através de `getMonthlyQuinzenalDates` (máximo de 2 ocorrências no mês, busca de espaçamento de 14 dias e análise do histórico do mês anterior).
  - Modo operacional (`IMPLANTACAO` vs `OPERACAO_OFICIAL` com data de corte inicial).
  - Status operacional: `concluida`, `em_andamento`, `nao_realizada`, `pendente` e `planejada`.

### 2.3 Portal da Indústria (`src/views/IndustryPortalView.tsx`)
- Identificação da indústria pelo perfil autenticado (`profile.industria_codigo`).
- Visão restrita por RLS no banco e travas no frontend.
- Três abas principais:
  1. **Operacional**: Cards de metas (lojas, visitas previstas, realizadas, pendentes, aderência percentual), tabela detalhada por loja e por promotor.
  2. **Central de Evidências**: Galeria paginada de fotos das visitas com URLs assinadas privadas (`storage.createSignedUrl`).
  3. **Relatórios**: Geração e exportação executiva em PDF e Excel (`xlsx`).

### 2.4 Acompanhamento no Painel Administrativo
- `OperationalDashboardView.tsx`: Cockpit tático com filtros por indústria, promotor, loja, período e prioridade de alertas.
- `IndustriesView.tsx` (Aba Frequência): Consolidação por indústria, comparação de previstas vs realizadas e abertura por loja.
- `CockpitView.tsx`: Indicadores gerenciais de presença, cobertura de equipes e alertas.

---

## 3. O que Já Funciona com Excelência
1. **Isolamento RLS da Indústria**: Migration `20261008_industry_client_access.sql` garante que `client_industry` não consegue ler dados de outras indústrias em `lojas`, `rotas`, `visits`, `visit_photos`, `visit_checklist_items`, etc.
2. **Proteção de Mídia e Evidências**: Bucket privado `visit-photos` com RLS por ID de visita e permissões de signed URLs (3600 segundos).
3. **Registro Completo de Execução em Campo**: O promotor executa check-in, responde checklist, envia fotos, registra rupturas e validade de produtos, e faz check-out com coordenadas GPS.
4. **Cálculo de Aderência em Tempo Real**: Conexão com Realtime do Supabase no Portal da Indústria e Painel Operacional atualiza indicadores instantaneamente.

---

## 4. Lacunas e Necessidades Identificadas (Gaps)

1. **Ausência de Entidade Contratual Explícita (Contrato / Vigência / Valor)**:
   - Atualmente, o conceito de "frequência contratada" é inferido diretamente da tabela `public.rotas` (`r.frequencia` + dias booleanos da semana).
   - Não há registro de **vigência contratual** (data início e data fim da vigência daquele contrato com a indústria).
   - Não há histórico de **alterações contratuais** (se uma loja muda de 1x/semana para 2x/semana em determinado mês, a alteração atual em `rotas` sobrescreve a configuração anterior, afetando cálculos retroativos se não houver versionamento).
   - Não há campo de **valor por visita / valor contratual**, caso o comercial precise de auditoria financeira.
2. **Dependência entre Contrato e Alocação do Promotor**:
   - Como a obrigação está na tabela `rotas` (que exige `promotor_matricula`), se uma loja estiver contratada pela indústria mas temporariamente **sem promotor alocado**, a obrigação contratual não existe no sistema, gerando falso 100% de cumprimento.
   - O contrato pertence à relação **Indústria + Loja**, enquanto a rota é a alocação operacional (**Indústria + Loja + Promotor**).
3. **Visualização de Metas Mensais no Painel**:
   - `IndustriesView.tsx` calcula aderência somando ocorrências em janelas de 7 ou 30 dias passados, em vez de fechar o **mês calendário fechado** (ex: Outubro/2026), que é a prática contratual padrão das indústrias.

---

## 5. Riscos Técnicos Identificados

1. **Risco de Regressão Operacional no Portal do Promotor**:
   - `PromoterPortalView.tsx` consome `rotas` diretamente para montar a agenda de campo. Qualquer mudança estrutural no modelo contratual **NÃO PODE** quebrar a tabela `public.rotas` ou a rotina do promotor.
2. **Risco de Inconsistência Retroativa de Indicadores**:
   - Se uma indústria renegociar a frequência no meio do mês, o sistema precisa saber que até o dia 15 a frequência era X e a partir do dia 16 é Y.
3. **Risco de Exposição de Dados entre Indústrias**:
   - Qualquer nova view, função RPC ou tabela de conciliação contratual deve herdar e respeitar estritamente as políticas RLS (`public.get_auth_industria_codigo()`).

