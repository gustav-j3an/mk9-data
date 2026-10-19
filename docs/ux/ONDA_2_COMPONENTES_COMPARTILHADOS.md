# MK9 Date — Relatório da Onda 2: Componentes Compartilhados e Padronização Visual

**Data:** 18 de Outubro de 2026  
**Status:** CONCLUÍDO E VALIDADO  
**Ambiente:** Supabase Local Docker & Vite Dev Server (`http://localhost:3000`)

---

## 1. Visão Geral da Onda 2

A **Onda 2** de modernização UX/UI do **MK9 Date** introduziu a primeira biblioteca de componentes compartilhados da aplicação (`src/components/ui/`), estabelecendo um padrão consistente de apresentação de dados, métricas e estados de telemetria alinhado às diretrizes ArtCraft / GridCraft catalogadas em `DesignSystemView.tsx`.

A implementação foi validada através de uma **tela piloto de alto impacto e baixo risco**: a gestão de **Lojas & PDVs** (`StoresView.tsx`), preservando integralmente suas integrações com o Supabase, modais de cadastro e edição, permissões de acesso e filtros avançados.

---

## 2. Componentes Criados e suas APIs

### 2.1. `StatusBadge` (`src/components/ui/StatusBadge.tsx`)
Padroniza as dezenas de variantes de badges dispersas pelo sistema com contraste acessível, ponto indicador e tipografia mono:
- **Propriedades (`StatusBadgeProps`):**
  - `status`: String com o valor do status (ex.: `'ativo'`, `'inativo'`, `'concluida'`, `'pendente'`).
  - `variant` (opcional): Variante semântica estrita (`'ativo'`, `'inativo'`, `'conforme'`, `'pendente'`, `'em_andamento'`, `'concluida'`, `'falta'`, `'ruptura'`, `'a_pagar'`, `'pago'`, `'semanal'`, `'quinzenal'`, `'mensal'`, `'neutro'`).
  - `label` (opcional): Rótulo textual customizado. Se omitido, formata o status em caixa alta ou usa o rótulo padrão da variante.
  - `dot` (opcional, default: `true`): Exibe ou oculta o ponto colorido indicador de telemetria.
  - `className` (opcional): Classes Tailwind extras para ajuste de margem/posicionamento.
- **Fallback Seguro:** Caso receba um status desconhecido, faz fallback elegante para o estilo neutro (`bg-[#E4E2DB] border-[#CFCDC5] text-[#525252]`), sem mapeamentos silenciosos errôneos.

### 2.2. `StatCard` (`src/components/ui/StatCard.tsx`)
Unifica os cartões de indicadores de topo com hierarquia clara entre título, valor numérico tabular e descrição:
- **Propriedades (`StatCardProps`):**
  - `title`: Título do indicador em caixa alta mono (ex.: `'TOTAL DE LOJAS'`).
  - `value`: Valor principal exibido em destaque tipográfico tabular mono (`text-3xl font-extrabold`).
  - `description` (opcional): Subtítulo explicativo com contexto operacional.
  - `icon` (opcional): Nome do ícone Material Symbols.
  - `variant` (opcional, default: `'default'`): `'default'`, `'success'`, `'warning'`, `'danger'`, `'info'`.
  - `className` (opcional): Classes extras.

### 2.3. `DataTable` (`src/components/ui/DataTable.tsx`)
Tabela reutilizável, tipada via TypeScript Generics (`DataTable<T>`), projetada para suportar listagens operacionais:
- **Recursos Nativos:**
  - **Paginação no Cliente:** Seletor de 10, 25 e 50 itens por página com controles Anterior / Próxima e indicador de página ativa.
  - **Ordenação por Coluna:** Clique no cabeçalho com ciclo asc/desc/reset e suporte a comparador alfanumérico sensível a números e acentos (`localeCompare` pt-BR) ou accessor customizado.
  - **Busca Rápida Opcional:** Campo de busca integrado com debounce e botão de limpar.
  - **Estados Nativos:** Loading (spinner animado), Erro contextual e Estado Vazio com ilustração e mensagem explicativa.
  - **Acessibilidade e Contraste:** Contrastes verificados com fundo `#E4E2DB` no cabeçalho e `#EAE8E2` nas linhas com hover contrastante, eliminando problemas de legibilidade de texto claro sobre fundo claro.

---

## 3. Aplicação na Tela Piloto (`StoresView.tsx`)

A tela de gestão de Lojas foi escolhida como piloto por conter volume real de dados, filtros multifatoriais (busca textual, status e UF), modais de edição/criação e ações por linha.

### Modificações Realizadas:
1. **Métricas de Topo:**
   - Substituição dos 3 blocos HTML manuais por instâncias do `StatCard` (`default` para Total de Lojas, `success` para Lojas Ativas e `info` para UFs Atendidas), com descrições operacionais agregadas.
2. **Tabela de Dados:**
   - Substituição da tabela manual e dos blocos dispersos de loading/erro/vazio pelo componente `DataTable<StoreItem>`.
   - Definição tipada de `columns: Column<StoreItem>[]` cobrindo Código, Nome da Loja, Rede, Cidade/UF, CNPJ, Status e Ações.
   - Aplicação do `StatusBadge` na coluna de status, substituindo as classes de badge inline anteriores.
   - Preservação estrita das permissões de edição (`canEdit`), modais de criação (`handleOpenCreate`), edição (`handleOpenEdit`), visualização detalhada (`setViewingItem`) e toggle de ativação (`handleToggleStatus`).

---

## 4. Evidências de Teste e Validação

### 4.1. Verificação Estrita de Tipagem (`npm run lint` / `tsc --noEmit`)
```text
> react-example@0.0.0 lint
> tsc --noEmit
Exit code: 0 (Sucesso sem erros)
```

### 4.2. Build de Produção (`npm run build` / `vite build`)
```text
vite v8.3.1 building client environment for production...
transforming...
✓ 124 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                     2.31 kB │ gzip:   0.93 kB
dist/assets/index-DjfnOpoP.css    121.17 kB │ gzip:  18.82 kB
dist/assets/index-CLr6nnJJ.js   1,797.63 kB │ gzip: 435.24 kB
✓ built in 1.16s
Exit code: 0 (Sucesso)
```

### 4.3. Testes Unitários de Regras de Contratos (`npx tsx --test src/lib/contratosService.test.ts`)
```text
# tests 81
# suites 22
# pass 81
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 526.4893
Exit code: 0 (Todos os 81 testes aprovados sem qualquer regressão)
```

### 4.4. Testes do Portal do Promotor (`npx tsx --test src/utils/promoterPortalWeekly.test.ts`)
```text
# tests 5
# suites 1
# pass 5
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 325.5514
Exit code: 0 (Todos os 5 testes aprovados)
```

---

## 5. Arquivos Alterados ou Criados

| Arquivo | Ação | Descrição |
| :--- | :--- | :--- |
| `src/components/ui/StatusBadge.tsx` | Criado | Componente unificado para badges de telemetria e status. |
| `src/components/ui/StatCard.tsx` | Criado | Componente unificado para cartões de indicadores no topo das telas. |
| `src/components/ui/DataTable.tsx` | Criado | Componente genérico e tipado de tabela com paginação, busca e ordenação. |
| `src/components/ui/index.ts` | Criado | Barrel file de exportação da biblioteca de componentes UI. |
| `src/views/StoresView.tsx` | Modificado | Integração piloto de `StatCard`, `StatusBadge` e `DataTable` na listagem de lojas. |

---

## 6. Próximos Passos (Ondas Subsequentes)

Com a biblioteca de componentes compartilhados estabelecida e validada na tela piloto:
1. **Expandir para a Aba de Contratos (`IndustriesView.tsx`):**
   - Aplicar `DataTable` na Projeção de Contratos Elegíveis e no Histórico de Contratos Cadastrados, resolvendo o problema de contraste (texto branco sobre fundo claro) e viabilizando paginação em grandes bases.
2. **Padronizar Telas de Pessoas & Freelancers (`PromotersView.tsx` e `FreelancersView.tsx`):**
   - Adotar `DataTable` e `StatusBadge` na gestão das equipes e diárias.
3. **Painéis Operacionais (`VisitsTrackingView.tsx` e `AttendanceControlView.tsx`):**
   - Utilizar `StatCard` nos contadores de campo e `StatusBadge` nos check-ins de promotores.

