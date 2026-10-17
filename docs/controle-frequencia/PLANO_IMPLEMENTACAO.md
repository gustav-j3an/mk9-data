# PLANO DE IMPLEMENTAÇÃO INCREMENTAL
## Controle Contratual, Frequência de Visitas e Auditoria Operacional — MK9 Date

Este documento estabelece o roteiro técnico detalhado para evolução do sistema MK9 Date, estruturado em **missões individuais e atômicas**, garantindo zero interrupção das operações de campo, preservação estrita do banco de dados existente e proteção total das políticas RLS.

---

## 1. Princípios Arquiteturais e Diretrizes
1. **Separar Contrato de Alocação Operacional**:
   - **Contrato (Obrigação)**: Vínculo Indústria + Loja (frequência, vigência, dias previstos, valor/visita, status).
   - **Alocação Operacional (Escala)**: Vínculo Indústria + Loja + Promotor (`public.rotas`).
   - **Execução Real (Evidência)**: Vínculo Indústria + Loja + Promotor + Data (`public.visits`).
2. **Compatibilidade e Transição Transparente**:
   - O módulo de rotas e o Portal do Promotor continuarão funcionando perfeitamente sem quebras.
   - Os contratos existentes poderão ser inicializados a partir das rotas ativas com fallback inteligente.
3. **Isolamento RLS Obrigatório**:
   - Toda e qualquer nova entidade ou consulta deverá possuir isolamento total por `industria_codigo` para o papel `client_industry`.
4. **Sem Destruição de Histórico**:
   - Alterações de frequência criam novas vigências ou versões, mantendo os registros passados auditáveis.

---

## 2. Mapa das Missões

```
Missão 00: Auditoria Técnica e Planejamento (Atual)
     │
     ▼
Missão 01: Modelo Contratual e Frequências (Tabela contratos_lojas + Vigência + Histórico)
     │
     ▼
Missão 02: Motor de Programação das Obrigações (Cálculo dinâmico por mês/ano com base contratual)
     │
     ▼
Missão 03: Integração e Conciliação com Visitas Reais (Previsto vs Realizado sem duplicidade)
     │
     ▼
Missão 04: Indicadores e Painel Administrativo MK9 (Cockpit de cumprimento e gestão de contratos)
     │
     ▼
Missão 05: Portal da Indústria Atualizado (Visão contratual da indústria, lojas e evidências)
     │
     ▼
Missão 06: Segurança, RLS e Auditoria de Permissões (Garantia de isolamento e zero vazamento)
     │
     ▼
Missão 07: Testes Integrados, Regressão e Validação Final (20 cenários + lint + build + testes)
```

---

## 3. Detalhamento de Cada Missão e Critérios de Aceitação

### MISSÃO 01 — Modelo Contratual e Frequências
- **Objetivo**: Criar modelo que represente a obrigação contratual acordada entre a MK9 e a Indústria para cada Loja, independente da presença temporária de um promotor na rota.
- **Implementação**:
  - Migration não destrutiva criando `public.contratos_lojas`:
    - `id` UUID PRIMARY KEY.
    - `industria_codigo` TEXT REFERENCES `industrias(codigo)`.
    - `loja_codigo` TEXT REFERENCES `lojas(codigo)`.
    - `frequencia` TEXT CHECK ('SEMANAL', 'QUINZENAL', 'MENSAL').
    - `visitas_por_semana` INTEGER DEFAULT 1.
    - `dias_semana_previstos` JSONB ou booleanos (`segunda`..`domingo`).
    - `data_inicio_vigencia` DATE NOT NULL.
    - `data_fim_vigencia` DATE NULL.
    - `status` TEXT DEFAULT 'ativo' CHECK ('ativo', 'encerrado', 'suspenso').
    - `valor_por_visita` NUMERIC(10,2) NULL.
    - `observacao` TEXT NULL.
    - `created_at`, `updated_at`.
    - Unique index para evitar duplicidade de contratos ativos no mesmo período para a mesma loja/indústria.
  - Script idempotente de carga inicial baseado nas rotas já cadastradas em produção (sem duplicar).
  - RLS configurado com `public.get_auth_industria_codigo()`.
  - Types TypeScript em `src/types.ts`.
- **Critérios de Aceitação**:
  - Uma indústria pode possuir várias lojas contratadas.
  - Uma loja pode ter contratos com diferentes indústrias sem duplicar a loja.
  - Suporta frequência semanal (1x, 2x, 3x/semana), quinzenal e dias específicos.
  - Permite definir vigência e preservar histórico.

---

### MISSÃO 02 — Programação das Obrigações de Atendimento
- **Objetivo**: Calcular com exatidão matemática o calendário de obrigações de atendimento para qualquer mês/ano de análise.
- **Implementação**:
  - Evoluir o motor em `src/utils/contractPlanner.ts` / `routePlanner.ts`:
    - Considera meses com 4 ou 5 ocorrências de dias da semana.
    - Trata contratos que iniciaram ou encerraram no meio do mês.
    - Para rotas quinzenais, aplica o motor de espaçamento mínimo de 14 dias com histórico do mês anterior.
    - Diferencia:
      - **Obrigação Contratada**: O que foi vendido para a indústria.
      - **Escala de Rota**: Se existe promotor atribuído àquela obrigação.
      - **Status**: Futura (não conta como atraso), Pendente, Vencida, Atendida.
- **Critérios de Aceitação**:
  - Cálculo dinâmico ou persistido sem risco de inflação de dados.
  - Não classifica obrigações futuras como atrasadas.
  - Respeita rigorosamente a vigência do contrato.

---

### MISSÃO 03 — Integração com as Visitas Existentes
- **Objetivo**: Vincular execuções reais de campo (`public.visits`) às obrigações contratuais sem criar fluxo paralelo.
- **Implementação**:
  - Conciliação entre `visits` concluídas e as obrigações previstas do par `(industria_codigo, loja_codigo)` no período.
  - Regras de contagem:
    - Somente visitas com `status = 'concluida'` contam como realizadas.
    - Visitas `em_andamento`, `pendente` ou `nao_realizada` não pontuam aderência positiva.
    - Visitas executadas fora do dia programado continuam registradas e auditáveis, mas sinalizadas como fora da grade.
    - Nenhuma visita concluída é contada em duplicidade.
- **Critérios de Aceitação**:
  - Atualização automática dos indicadores assim que o promotor conclui o atendimento.
  - Preservação total de fotos, checklists, coordenadas GPS e ocorrências.

---

### MISSÃO 04 — Indicadores do Painel Administrativo
- **Objetivo**: Oferecer à gestão da MK9 visão global de auditoria contratual e cumprimento de frequência.
- **Implementação**:
  - Aprimorar `IndustriesView.tsx` e `OperationalDashboardView.tsx`:
    - Filtro por Mês/Ano calendário fechado (ex: Outubro/2026).
    - Métricas: Total de Lojas Contratadas, Visitas Previstas no Mês, Visitas Realizadas, Pendentes, Atrasadas, % Aderência Global.
    - Visão de Alerta: Lojas sem promotor alocado (contrato órfão), lojas com risco de descumprimento de frequência.
    - Tabela expansível por Indústria -> Lojas -> Frequência Contratada -> Promotor Alocado -> Execuções.
- **Critérios de Aceitação**:
  - Gestor consegue filtrar qualquer indústria e auditar o cumprimento contratual loja a loja.
  - Identificação imediata de desvios e atrasos.

---

### MISSÃO 05 — Portal da Indústria
- **Objetivo**: Prover à indústria cliente portal transparente com suas lojas contratadas, metas do mês e evidências.
- **Implementação**:
  - Aprimorar `IndustryPortalView.tsx`:
    - Exibição clara das frequências contratuais acordadas por loja.
    - Barra de progresso mensal de cumprimento de metas.
    - Histórico de visitas por loja com acesso direto a fotos, checklists e ocorrências.
    - Exportação de relatório contratual executivo em PDF e Excel.
- **Critérios de Aceitação**:
  - Cliente visualiza unicamente seus dados com máxima clareza.
  - Fotos privadas continuam acessíveis somente via URLs assinadas.

---

### MISSÃO 06 — Segurança e Permissões RLS
- **Objetivo**: Blindagem total das novas estruturas no banco de dados.
- **Implementação**:
  - Auditoria completa de RLS em `contratos_lojas` e quaisquer novas views/funções.
  - Testes com token de usuário `client_industry` tentando consultar dados de indústria concorrente.
  - Testes com usuário anônimo.
- **Critérios de Aceitação**:
  - Tentativas de acesso indevido retornam 0 linhas ou erro de permissão.
  - Zero exposição de URLs de fotos sem assinatura.

---

### MISSÃO 07 — Testes Integrados e Validação Final
- **Objetivo**: Execução da bateria completa de 20 cenários de testes automatizados e de regressão.
- **Implementação**:
  - Testes de lógica e cálculo unitários (`tsx`).
  - Execução de `npm run lint` (`tsc --noEmit`).
  - Execução de `npm run build` (`vite build`).
- **Critérios de Aceitação**:
  - 100% dos testes aprovados, build limpo e documentação concluída.

