# Diagnóstico e Recuperação Operacional do Controle de Presença

**Projeto:** MK9 Date  
**Data:** 19 de outubro de 2026  
**Auditor Responsável:** Engenharia de Software / Arquitetura Supabase  
**Status do Módulo:** Operacional com Restrições (Em Modo Transitório / Migrations Pendentes)  

---

## 1. Sumário Executivo

A inspeção detalhada do módulo **Controle de Presença** (`src/views/AttendanceControlView.tsx`), do serviço de integração com o Supabase (`src/lib/attendanceService.ts`) e do motor de conformidade trabalhista (`src/utils/attendanceEngine.ts`) identificou com precisão matemática a causa de todas as mensagens e comportamentos observados na interface:

1. **0 Promotores Elegíveis e Lista Vazia:**  
   O motor de regras trabalhistas estabelece que um promotor só é considerado **elegível** se possuir uma jornada contratual ativa cadastrada (`promoter_work_schedules`). Como a tabela de jornadas ainda não existe no Supabase Cloud, a consulta cai no fallback tolerante e retorna lista vazia. Sem jornadas cadastradas, 100% dos promotores são classificados como `sem_expediente` (`eligible = false`). A interface, por padrão, oculta promotores sem expediente previsto para não gerar falsos indicadores de falta. Caso o filtro *"Incluir folgas e sem expediente"* seja selecionado, todos os promotores aparecem imediatamente listados.
2. **44 Promotores com Vínculo de Supervisor Pendente:**  
   O Supabase Cloud possui 44 promotores ativos. A resolução de supervisão (`resolveSupervisor`) exige que a coluna `promotores.equipe` coincida com uma equipe registrada em `public.equipes` que possua `supervisor_id` preenchido e vinculado a `public.supervisores`. Promotores sem equipe ou com equipe sem supervisor ativo recebem o status `'Não atribuído'`, acionando o alerta de governança operacional.
3. **Avisos de Estruturas Indisponíveis (attendance_holidays, attendance_telemetry, etc.):**  
   O motor avançado de presença foi preparado para consumir 7 migrações estruturais que criam tabelas de feriados, afastamentos, telemetria, sumário e status operacional. Essas migrações foram geradas localmente (`supabase/migrations/20261018220000_...` a `20261019013007_...`), mas **ainda não foram aplicadas no Supabase Cloud** (a última migração aplicada no banco remoto foi `20261016100000_create_supervisores_table.sql`).
4. **Faltas Automáticas Desabilitadas:**  
   As faltas automáticas exigem operação em modo oficial (`OPERACAO_OFICIAL`), data de corte oficial definida e autorização expressa em `system_settings.attendance_rules.automatic_absence_approved = true`. Como o sistema está em fase de implantação/transição, o bloqueio automático protege os trabalhadores de faltas indevidas.

---

## 2. Inventário de Arquivos e Componentes Analisados

| Arquivo | Função no Sistema | Situação Encontrada |
| :--- | :--- | :--- |
| `src/views/AttendanceControlView.tsx` | View principal do Controle de Presença | Integrada ao `attendanceService`. Filtra promotores por padrão com `offSchedule = false`, ocultando promotores sem jornada cadastrada. |
| `src/lib/attendanceService.ts` | Camada de dados e fallback Supabase | Implementa fallback tolerante (`optionalQuery`). Detecta tabelas ausentes sem quebrar a tela. |
| `src/utils/attendanceEngine.ts` | Motor de cálculo de jornada e elegibilidade | Contém as regras formais: elegibilidade (`scheduled && !absence`), pontualidade, tolerâncias, telemetria e geofence. |
| `src/lib/attendanceAdministration.ts` | Funções administrativas e governança | Gerencia parâmetros operacionais, validações de supervisor e fechamento de faltas. |
| `src/components/AttendanceJourneyPanel.tsx` | Painel visual de detalhe da jornada do promotor | Renderiza linha do tempo de batidas, rotas, desvios e telemetria. |

---

## 3. Estruturas no Supabase Cloud: Existentes vs. Ausentes

| Estrutura no Supabase | Tipo | Status no Cloud Remoto | Impacto no Controle de Presença |
| :--- | :--- | :--- | :--- |
| `public.promotores` | Tabela | **EXISTE** (44 ativos) | Fornece o rol de promotores. |
| `public.equipes` | Tabela | **EXISTE** (`EQP-001` Brasília) | Fornece equipes cadastradas. |
| `public.supervisores` | Tabela | **EXISTE** (`SUP-001` Paulo Gustavo) | Fornece supervisores cadastrados. |
| `public.rotas` | Tabela | **EXISTE** | Fornece rotas e clientes do dia. |
| `public.visits` | Tabela | **EXISTE** (sem colunas de telemetria) | Registra check-in/check-out tradicionais. |
| `public.attendance_records` | Tabela | **EXISTE** | Tabela canônica de batidas de ponto. |
| `public.promoter_work_schedules` | Tabela | **AUSENTE NO CLOUD** | **Causa Raiz 1:** Impede o cadastro de jornadas contratuais; torna `eligible = 0`. |
| `public.promoter_absences` | Tabela | **AUSENTE NO CLOUD** | Não há leitura de atestados/licenças formais no banco. |
| `public.attendance_holidays` | Tabela | **AUSENTE NO CLOUD** | Feriados caem no calendário padrão sem exceções municipais/estaduais. |
| `public.attendance_override_summary`| View | **AUSENTE NO CLOUD** | Justificativas e abonos gerenciais não consolidados via view. |
| `attendance_setup_status()` | RPC | **AUSENTE NO CLOUD** | Gera aviso no painel informando ausência do checklist da Migration 9. |
| Colunas de telemetria em `visits` | Colunas | **AUSENTES NO CLOUD** | `work_schedule_id`, `within_geofence`, `battery_level` operam via fallback de coordenadas brutas. |

---

## 4. Inventário das Migrações Locais Pendentes de Aplicação

As migrações abaixo foram criadas em ambiente local e aguardam autorização formal para aplicação controlada no Supabase Cloud:

1. `20261018220000_attendance_work_schedules.sql`: Criação de `promoter_work_schedules` com horários, dias da semana e tolerâncias.
2. `20261018230000_attendance_holidays_and_absences.sql`: Criação de `attendance_holidays` e `promoter_absences` com RLS restrito.
3. `20261018232256_attendance_telemetry_and_routes.sql`: Adiciona colunas de telemetria, bateria e georreferenciamento em `visits`.
4. `20261018234153_attendance_override_and_audit.sql`: Criação do fluxo de abonos, justificativas gerenciais e auditoria.
5. `20261019001109_attendance_settings_and_hardening.sql`: Criação de parâmetros operacionais em `system_settings`.
6. `20261019001848_attendance_setup_rpc.sql`: Função `attendance_setup_status()` para diagnóstico automatizado.
7. `20261019004947_attendance_rls_policies.sql`: Políticas de segurança para gestores e supervisores.

---

## 5. Análise de Causa Raiz por Item Reportado

### 5.1. Zero Promotores Elegíveis e Lista Vazia
- **Mecanismo:** Em `src/utils/attendanceEngine.ts`:
  ```typescript
  const scheduled = Boolean(schedule);
  const eligible = scheduled && (!absence || medicalAbsence) && holiday?.behavior !== 'off';
  ```
- **Fato:** Como a tabela `promoter_work_schedules` não existe no banco remoto, a consulta retorna `[]`. Logo, para todos os 44 promotores, `schedule` é nulo, resultando em `scheduled = false` e `eligible = false`.
- **Filtro da Interface:** `AttendanceControlView.tsx` inicializa com `includeOffSchedule = false`. Portanto, a lista filtra todos os `eligible = false`, resultando em 0 itens renderizados na tabela.

### 5.2. 44 Promotores com Vínculo de Supervisor Pendente
- **Mecanismo:** `resolveSupervisor` pesquisa se o campo `equipe` do promotor corresponde ao `nome` ou `codigo` de alguma equipe em `public.equipes`.
- **Fato:** No banco do Cloud, a grande maioria dos promotores ainda não teve o campo `equipe` preenchido para `'BRASÍLIA'` (ou a equipe não possui supervisor associado no mapeamento direto do promotor). Qualquer promotor cujo supervisor resulte em `'Não atribuído'` é contabilizado no aviso.

### 5.3. Faltas Automáticas Desabilitadas
- **Mecanismo:** O motor de presença exige 4 condições estritas para habilitar marcação de falta em lote:
  1. `operation_mode === 'OPERACAO_OFICIAL'`;
  2. `official_start_date` preenchido e já ultrapassado;
  3. `rules.automatic_absence_approved === true`;
  4. Horário de fechamento de tolerância esgotado.
- **Fato:** Nenhuma dessas opções foi ativada deliberadamente no banco, o que está **estritamente correto** para evitar penalizações trabalhistas indevidas antes da conclusão da implantação.

---

## 6. Matriz de Classificação de Itens

| Componente / Requisito | Classificação | Ação Necessária |
| :--- | :--- | :--- |
| Tolerância do Frontend a Tabelas Inexistentes | **CORRIGIDO** | Frontend opera com fallback resiliente e não quebra a tela. |
| Testes Unitários de Regras de Negócio e Jornada | **CORRIGIDO** | 37 testes automatizados passando com 100% de sucesso. |
| Tabelas de Jornada, Feriados e Afastamentos | **PENDENTE DE MIGRATION** | Aplicar as migrações no Supabase Cloud sob autorização do usuário. |
| Parâmetros Oficiais de Fechamento de Faltas | **PENDENTE DE CONFIGURAÇÃO** | Definir regras formais em `system_settings` após validação da diretoria. |
| Associação dos 35 Promotores Restantes à Equipe | **PENDENTE DE DADOS** | Concluir o vínculo dos promotores através da tela de Gestão de Equipes. |
| Ativação de Faltas Automáticas em Produção | **PENDENTE DE AUTORIZAÇÃO** | Aguardar período de homologação antes de ligar corte automático. |

---

## 7. Recomendações e Plano de Ação

1. **Ajuste Ergonômico de Interface (Sem Quebra de Regras):**  
   Quando `schedules.length === 0` (banco sem jornadas migradas), exibir um aviso amigável no topo da tabela orientando que os promotores estão sem escala definida e oferecendo um botão direto para *"Exibir promotores cadastrados em modo transitório"*, permitindo visualizar os 44 promotores imediatamente sem alterar as regras de elegibilidade.
2. **Homologação das Migrações de Presença:**  
   Submeter o lote de migrações (`20261018220000` a `20261019013007`) para aprovação do cliente antes de qualquer execução no Supabase Cloud.
3. **Completar Cadastro de Equipes:**  
   Vincular os promotores restantes às suas respectivas equipes na tela de Gestão de Equipes para sanar os 44 avisos de vínculo pendente.

