# MK9 DATE — RELATÓRIO TÉCNICO: ONDA 3.2
## Usabilidade, Interatividade e Auditoria de Indicadores de Aderência

**Data:** 18 de Outubro de 2026  
**Módulo:** Gestão de Indústrias (`src/views/IndustriesView.tsx`)  
**Status:** Concluído com Sucesso  
**Build & Testes:** 100% aprovados (Vite build, 81 testes de Contratos, 5 testes de Portal do Promotor, 12 novos testes de Auditoria de Aderência)

---

### 1. Resumo Executivo das Intervenções

A **Onda 3.2** teve como foco elevar a usabilidade e a interatividade nas visões operacionais de aderência (**Visão por Indústria** e **Visão por Promotor**) e realizar uma rigorosa auditoria analítica nos indicadores numéricos de visitas planejadas e percentual de cumprimento, consolidando o padrão estético **ArtCraft / GridCraft**.

Principais entregas:
1. **Auditoria e Transparência dos Indicadores:**
   - **Exclusão de Divisão por Zero:** Para planejadas = 0, os indicadores passam a exibir `—` de forma elegante e segura.
   - **Formatação Fiel da Aderência Residual:** Quando realizada > 0 mas o percentual resulta em fração menor que 1% (caso real `6 / 2148 = 0,279%`), o sistema agora exibe `0,3%` (uma casa decimal com vírgula), eliminando a falsa impressão de `0%` de cumprimento.
   - **Diagnóstico da Decomposição de 2.148 Visitas:** Identificação exata da diferença de 5 visitas na soma (`6 realizadas + 2136 pendentes + 1 não realizada = 2143`). Os 5 registros faltantes são visitas em andamento (`status = 'em_andamento'`). O KPI agora esclarece explicitamente todas as parcelas.
2. **Busca Rápida e Insensível a Acentos:**
   - Implementação do utilitário `normalizeText()` com decomposição Unicode NFD e remoção de diacríticos para busca fluida por nome ou código/matrícula nas tabelas de indústrias e promotores.
   - Botão dedicado para limpar a busca instantaneamente.
3. **Paginação Inteligente e Não Destrutiva:**
   - Paginação fatiada no front-end em blocos de 10, 25 e 50 registros (padrão 10).
   - A paginação não altera nem recalcula os KPIs operacionais superiores (que continuam computando o universo consolidado do período).
   - Reset automático da página para 1 sempre que o usuário altera filtros de competência, indústria, promotor ou termo de busca.
4. **Destaque Visual das Linhas Expandidas:**
   - Preservação da expansão de lojas atendidas (por indústria) e de atendimentos detalhados (por promotor).
   - Destaque com borda esquerda roxa (`border-l-4 border-l-purple-600`) e fundo temático acolchoado (`bg-[#EAE8E2]`), tornando clara a hierarquia visual pai-filho.
   - Mensagens amigáveis para registros sem lojas/atendimentos vinculados no período.

---

### 2. Diagnóstico Técnico dos Indicadores e Aderência

#### A. Aderência Percentual Residual (6 / 2148)
* **Cenário:** Em competências com grande volume de visitas planejadas (ex: 2.148) e poucas baixas no início do ciclo (ex: 6 realizadas), `(6 / 2148) * 100 = 0.279329...%`.
* **Problema Anterior:** A função original realizava `Math.round(0.279)` ou `toFixed(0)`, resultando em `0%`. Para os gestores e promotores que realizaram 6 visitas, ver 0% gerava desconfiança na auditoria do sistema.
* **Solução Implementada:**
  ```typescript
  function formatAderencia(realizadas: number, planejadas: number): string {
    if (planejadas <= 0) return '—';
    const pct = (realizadas / planejadas) * 100;
    if (pct === 0) return '0%';
    if (pct < 1) {
      const formatted = pct.toFixed(1).replace('.', ',');
      return formatted === '0,0' ? '< 0,1%' : `${formatted}%`;
    }
    return `${Math.round(pct)}%`;
  }
  ```
  O valor `6 / 2148` agora é apresentado com precisão como `0,3%`. Valores acima de 1% continuam apresentados como inteiros arredondados (ex: `85%`, `100%`), preservando a clareza executiva.

#### B. Decomposição das 2.148 Visitas Planejadas
* **Cenário Reportado:** `2148 planejadas - (6 realizadas + 2136 pendentes + 1 não realizada) = 5 visitas`.
* **Auditoria de Código em `IndustriesView.tsx`:**
  Na linha ~391 a ~402, o processamento de ocorrências itera sobre o plano de rotas:
  - `status === 'concluida'` ➔ `totalRealizadas` (+6)
  - `status === 'em_andamento'` ➔ `totalEmAndamento` (+5)
  - `status === 'nao_realizada'` ➔ `totalNaoRealizadas` (+1)
  - `pendente` ou sem visita ➔ `totalPendentes` (+2136)
  - **Soma exata:** `6 + 5 + 1 + 2136 = 2.148`.
* **Conclusão:** Não existe perda de dados ou erro de contagem no banco. As 5 visitas são atendimentos que foram iniciados no app do promotor (`check-in`), mas cujo `check-out` ainda não foi finalizado.
* **Ajuste de UX:** O subtítulo do Card de Aderência Operacional foi atualizado para exibir explicitamente:
  `"6 de 2.148 visitas cumpridas (5 em andamento, 2.136 pendentes, 1 não realizada)"`.

---

### 3. Melhorias na Visão por Indústria

* **Campo de Busca:** Input posicionado no topo com placeholder `"Buscar indústria por nome ou código..."`.
  - Normalização por `normalizeText()` para busca case-insensitive e sem acentos (ex: `"tres coracoes"` encontra `"Três Corações"`).
  - Ícone de fechar (`close`) para limpeza rápida.
* **Seletor de Paginação:** Opções de 10, 25 e 50 itens por página.
* **Controles Duplos (Topo e Rodapé):**
  - Barra de status no topo: `"Encontradas: X de Y indústrias (filtrado por '...')"` e botões Anterior / Próxima com indicação `"Pág. X de Y"`.
  - Rodapé completo exibido quando há mais de uma página.
* **Linha Expandida de Lojas:**
  - Borda roxa `border-l-4 border-l-purple-600` destacando que a sub-tabela pertence à indústria clicada.
  - Aderência de cada loja formatada com `formatAderencia(d.realizadas, d.planejadas)`.
  - Mensagem de estado vazio amigável: `"Nenhuma loja vinculada a esta indústria com rotas no período selecionado."`.

---

### 4. Melhorias na Visão por Promotor

* **Campo de Busca:** Input posicionado no topo com placeholder `"Buscar promotor por nome ou matrícula..."`.
  - Busca tanto pelo nome civil quanto pela matrícula/código funcional.
* **Seletor de Paginação:** Opções de 10, 25 e 50 itens por página.
* **Linha Expandida de Atendimentos:**
  - Destaque estrutural `border-l-4 border-l-purple-600` e fundo `bg-[#EAE8E2]`.
  - Badge de aderência com formatação sensível a valores nulos (planejadas = 0) e residuais.
  - Subtítulo com contagem de relações Loja × Indústria atendidas por aquele promotor.

---

### 5. Padrão Visual ArtCraft / GridCraft Aplicado

| Elemento | Token Tailwind / Hex | Propósito Visual |
| :--- | :--- | :--- |
| **Fundo de Cartões / Seções** | `bg-[#F7F6F2]` | Superfície neutra quente primária |
| **Linhas Alternadas / Hover** | `bg-[#EAE8E2]`, `hover:bg-[#EAE8E2]/60` | Destaque suave em foco e hover |
| **Linha Expandida Ativa** | `bg-[#EAE8E2] border-l-4 border-l-purple-600` | Identificação inequívoca do registro aberto |
| **Bordas Estruturais** | `border-[#CFCDC5]` | Delimitação tátil e precisa da grade |
| **Cabeçalhos de Tabela** | `bg-[#E3E1DA] text-[#5F5F5F] font-mono` | Tipografia técnica e separação hierárquica |
| **Tipografia Principal** | `text-[#171717]` | Alto contraste e legibilidade em tela |
| **Textos Secundários / Metadados** | `text-[#77766F]`, `text-[#5F5F5F]` | Suporte visual sem ruído |

---

### 6. Testes Automatizados e Validação

Uma nova suíte de testes unitários foi criada em `src/utils/aderenciaAudit.test.ts` usando o executor nativo do Node.js (`tsx --test`), cobrindo 12 cenários de auditoria:
1. `normalizeText`: remoção de maiúsculas, espaços e caracteres especiais em português (`ç`, `ã`, `é`, etc.).
2. `formatAderencia`:
   - Planejadas = 0 ➔ retorna `'—'`.
   - Realizadas = 0 e planejadas > 0 ➔ retorna `'0%'`.
   - Caso real residual 6 / 2148 ➔ retorna `'0,3%'`.
   - Frações inferiores a 0,05% ➔ retorna `'< 0,1%'`.
   - Valores normais >= 1% ➔ arredondamento conforme padrão de gestão (`50%`, `85%`, `100%`).
3. Auditoria matemática: soma de `realizadas + em_andamento + nao_realizadas + pendentes = 2148`.
4. Filtro de busca e lógica de paginação.

**Resultados de Execução:**
- `src/utils/aderenciaAudit.test.ts`: 12 testes aprovados (0 falhas).
- `src/lib/contratosService.test.ts`: 81 testes aprovados (0 falhas).
- `src/utils/promoterPortalWeekly.test.ts`: 5 testes aprovados (0 falhas).
- `npm run build`: Build do Vite concluído com sucesso em 781ms.

---

### 7. Integridade e Regras Comerciais

- **Schema do Supabase:** Nenhuma tabela, coluna, view ou RLS foi alterada.
- **Regras de Negócio e Contratos:** As lógicas de vigência contínua/determinada, KING IND-013, cálculo de competência e frequências foram 100% preservadas.
- **Git:** Nenhum commit automático foi efetuado.

