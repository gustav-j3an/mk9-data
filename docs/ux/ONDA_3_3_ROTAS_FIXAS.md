# MK9 DATE — RELATÓRIO TÉCNICO: ONDA 3.3
## Modernização da Grade Operacional de Rotas Fixas

**Data:** 18 de Outubro de 2026  
**Módulo:** Escala Operacional de Rotas Fixas (`src/views/RoutesView.tsx`)  
**Status:** Concluído com Sucesso  
**Build & Testes:** 100% aprovados (`npm run lint` / `tsc --noEmit`, Vite build, 81 testes de Contratos, 5 testes de Portal do Promotor, 12 testes de Aderência, 15 novos testes de Rotas Fixas)

---

### 1. Resumo Executivo das Intervenções

A **Onda 3.3** modernizou a tela **"Escala Operacional de Rotas Fixas"**, resolvendo problemas crônicos de poluição visual, saturação horizontal e quebra de usabilidade em notebooks e dispositivos móveis, consolidando o padrão estético **ArtCraft / GridCraft**.

Principais intervenções implementadas:
1. **Remoção Visual da Coluna "ROTA / CODE":**
   - A coluna fixa de código foi removida da grade semanal principal, liberando mais de 140px horizontais para dar protagonismo aos nomes de Indústria, Loja e Promotor.
   - O identificador interno (`codigo_rota`, `id`, `industria_codigo`, `loja_codigo`, `promotor_matricula`) permanece 100% íntegro no modelo de dados, no estado do React, nos payloads do Supabase e é apresentado com destaque na Ficha Operacional do modal de detalhes.
2. **Grade Operacional Compacta com Alinhamento Fixo (`table-fixed`):**
   - Organização proporcional e fluida das colunas: Indústria (20%), Loja/PDV (24%), UF (4%), Promotor (22%), Frequência (9%), 7 dias da semana (2.7% cada) e Ações (6%).
   - Truncamento elegante com elipse e `title` acessível contendo nome completo e código.
   - Sete dias da semana (SEG a DOM) sempre visíveis lado a lado em resoluções de desktop (1920px, 1440px, 1366px, 1280px, 1024px) sem barra de rolagem horizontal desnecessária.
   - Apresentação adaptativa com cartões compactos em telas menores (< 768px / 375px) com chips visuais para os 7 dias.
3. **Agrupamento Inteligente e Fiel à Identidade ArtCraft:**
   - Correção do contraste do seletor "Agrupar por" (substituído texto amarelo sobre fundo claro por texto escuro `#171717` com foco âmbar).
   - Cabeçalho de grupo unificado no padrão: `NOME DO GRUPO — X ROTAS` (ex: `Carlos Andrade (PRM-001) — 8 ROTAS`).
   - Recursos interativos de **Expandir / Recolher** grupo com indicador claro de estado (`folder` / `folder_open`), feedback visual em hover e contagem de rotas exibidas na página ativa vs total no grupo.
4. **Estratégia de Paginação com Agrupamento Seguro:**
   - A paginação fatia as rotas de forma previsível (25, 50, 100 registros por página, padrão 25) sem duplicar nem omitir nenhuma rota.
   - O agrupamento é aplicado sobre as rotas da página ativa, com os cabeçalhos de grupos calculando a quantidade total (`groupTotals`) no universo filtrado. Caso um grupo continue em páginas posteriores, o cabeçalho exibe claramente `X rotas (Y nesta página)`.
5. **Reaproveitamento de Componentes Compartilhados:**
   - Substituição dos cards customizados de KPI pelo componente [`StatCard`](file:///c:/projetos/mk9-data/src/components/ui/StatCard.tsx) (tokens ArtCraft com suporte a variantes `warning`, `success`, `info`, `default`).
   - Substituição dos spans manuais de frequência pelo [`StatusBadge`](file:///c:/projetos/mk9-data/src/components/ui/StatusBadge.tsx) com variantes tipadas `semanal` e `quinzenal`.
6. **Acessibilidade e Contraste nos Modais:**
   - Ficha Operacional da Rota e Modal de Edição totalmente integrados à paleta neutra aquecida (`#F7F6F2`, `#EAE8E2`, `#CFCDC5`, `#171717`), eliminando qualquer texto branco sobre fundo bege ou amarelo desbotado.

---

### 2. Arquivos Modificados e Criados

| Arquivo | Tipo | Descrição |
| :--- | :--- | :--- |
| [`src/views/RoutesView.tsx`](file:///c:/projetos/mk9-data/src/views/RoutesView.tsx) | Modificado | Refatoração completa da grade, remoção visual do código da rota, cabeçalhos expansíveis de grupos, paginação integrada, StatCard, StatusBadge e modais ArtCraft. |
| [`src/utils/routesGridAudit.test.ts`](file:///c:/projetos/mk9-data/src/utils/routesGridAudit.test.ts) | Criado | Suíte de testes unitários com 15 testes cobrindo filtros combinados, agrupamentos, fatiamento de paginação, ordenação, integridade de IDs e responsividade. |
| [`docs/ux/ONDA_3_3_ROTAS_FIXAS.md`](file:///c:/projetos/mk9-data/docs/ux/ONDA_3_3_ROTAS_FIXAS.md) | Criado | Documentação técnica detalhada das alterações da Onda 3.3. |

---

### 3. Detalhamento das Alterações Visuais e UX

#### A. Tabela Principal vs Modal de Detalhes
* **Antes:** A primeira coluna ocupava largura fixa mínima de 140px com texto dourado `codigo_rota` (ex: `ROT-001`), comprimindo os nomes de lojas e indústrias em telas de notebook (1366px).
* **Depois:** A coluna visual foi removida da tabela. O código da rota continua sendo o identificador principal da ficha no modal `viewingRoute` e `editingRoute`:
  - Cabeçalho do modal: `"Ficha Operacional da Rota"` com subtítulo `"Código Interno: ROT-001"`.
  - Dados relacionais, observações e grade dos 7 dias preservados.

#### B. Distribuição de Larguras da Grade Desktop
* A tabela recebeu a classe `table-fixed` com distribuição percentual controlada:
  - **Indústria:** 20% (Truncamento com `title` completo e código secundário `text-[10px] text-[#5F5F5F]`).
  - **Loja / PDV:** 24% (Destaque prioritário, truncamento acessível e código secundário).
  - **UF:** 4% (Centralizado).
  - **Promotor:** 22% (Nome com truncamento e matrícula secundária).
  - **Frequência:** 9% (Renderizado com `StatusBadge` compacto).
  - **Dias (SEG a DOM):** 2.7% cada (Checks verdes em caixas `w-5 h-5` com cabeçalhos dedicados: SEG-SEX neutros, SÁB suave âmbar, DOM suave avermelhado).
  - **Ações:** 6% (Botões compactos `p-1 rounded-md` de Visualizar e Editar).

#### C. Apresentação Adaptativa Mobile / Tablet (< 768px)
* Em telas móveis e tablets portrait, a tabela fixa é ocultada e substituída por cartões modulares compactos:
  - Título com Loja e Indústria em destaque.
  - Badge de frequência no canto superior direito.
  - Linha de promotor com ícone `badge` e ações de toque rápido.
  - Grid de 7 chips compactos na base indicando os dias com checkmark verde ou traço neutro.

#### D. Agrupamento Inteligente e Expansível
* **Contraste:** Seletor com fundo `#EAE8E2`, borda `#CFCDC5`, texto `#171717` font-bold e foco âmbar escuro.
* **Cabeçalhos de Grupo:**
  - `Carlos Andrade (PRM-001) — 8 ROTAS (5 nesta página)`
  - Clique na barra recolhe ou expande o grupo instantaneamente sem perder o estado da página.
  - Ícone dinâmico `folder` / `folder_open` e seta indicadora `expand_more` / `expand_less`.

#### E. Estratégia de Paginação com Agrupamento
* **Arquitetura Adotada:** Paginação por rotas fatiadas no front-end (`slice(start, start + pageSize)`).
* **Solução para Divisão de Grupos:**
  - O cálculo de total por grupo (`groupTotals`) processa o universo filtrado completo.
  - Se um grupo de 15 rotas for dividido (ex: 10 na página 1 e 5 na página 2), o cabeçalho exibe na página 1: `Grupo Alfa — 15 ROTAS (10 nesta página)` e na página 2: `Grupo Alfa — 15 ROTAS (5 nesta página)`.
  - Essa abordagem evita distorções de layout, páginas vazias e rotas ocultas.

---

### 4. Resultados de Testes e Validação

```bash
# 1. Verificação de Tipos TypeScript
npm run lint (tsc --noEmit) -> 0 erros

# 2. Build de Produção Vite
npm run build -> ✓ built in 689ms (dist gerada com sucesso)

# 3. Testes Unitários de Rotas Fixas (Onda 3.3)
npx tsx --test src/utils/routesGridAudit.test.ts
-> 15 testes aprovados (0 falhas)
   - Busca combinada com filtros
   - Agrupamento por promotor, indústria, loja e frequência
   - Paginação fatiada e contagem global por grupo
   - Ordenação de rotas
   - Preservação de identificadores internos
   - Ações de visualizar e editar
   - Mapeamento responsivo dos 7 dias

# 4. Regressão de Testes Existentes
npx tsx --test src/lib/contratosService.test.ts -> 81 testes aprovados (0 falhas)
npx tsx --test src/utils/aderenciaAudit.test.ts -> 12 testes aprovados (0 falhas)
npx tsx --test src/utils/promoterPortalWeekly.test.ts -> 5 testes aprovados (0 falhas)
```

---

### 5. Conformidade com Regras e Segurança

- **Banco de Dados & Schema:** Nenhuma tabela, trigger, RLS ou migration foi alterada.
- **Regras Operacionais:** Regras de frequências SEMANAL/QUINZENAL, dias da semana e vínculos de rotas foram integralmente preservadas.
- **Git:** Nenhum commit automático foi executado.

