# CHECKLIST CENTRAL DE MISSÕES — MK9 DATE
## Controle Contratual, Frequência de Visitas e Auditoria Operacional

| Missão | Título | Status | Autorização |
|---|---|---|---|
| **00** | **Auditoria Técnica e Planejamento** | **[x] Concluído e validado** | Concluída |
| **01** | **Modelo Contratual e Frequências** | **[x] Concluído e validado** | Autorizada |
| **02** | **Programação das Obrigações de Atendimento** | **[ ] Não iniciado** | Aguardando autorização |
| **03** | **Integração com as Visitas Existentes** | **[ ] Não iniciado** | Aguardando autorização |
| **04** | **Indicadores do Painel Administrativo** | **[ ] Não iniciado** | Aguardando autorização |
| **05** | **Portal da Indústria** | **[ ] Não iniciado** | Aguardando autorização |
| **06** | **Segurança e Permissões** | **[ ] Não iniciado** | Aguardando autorização |
| **07** | **Testes Integrados e Validação Final** | **[ ] Não iniciado** | Aguardando autorização |

---

## Detalhamento por Missão

### MISSÃO 00 — Auditoria Técnica e Planejamento
- **Status**: [x] Concluído e validado
- **Arquivos analisados**:
  - `src/types.ts`
  - `src/App.tsx`
  - `src/components/AppShell.tsx`
  - `src/views/IndustryPortalView.tsx`
  - `src/views/IndustriesView.tsx`
  - `src/views/OperationalDashboardView.tsx`
  - `src/views/RoutesView.tsx`
  - `src/views/PromoterPortalView.tsx`
  - `src/utils/routePlanner.ts`
  - `supabase/migrations/20260930_update_rotas_structure.sql`
  - `supabase/migrations/20261001_create_visits_tables.sql`
  - `supabase/migrations/20261008_industry_client_access.sql`
  - `supabase/migrations/20261006_harden_storage_visit_photos.sql`
- **Arquivos criados/modificados**:
  - `docs/controle-frequencia/DIAGNOSTICO_ATUAL.md` (criado)
  - `docs/controle-frequencia/PLANO_IMPLEMENTACAO.md` (criado)
  - `docs/controle-frequencia/CHECKLIST_MISSOES.md` (criado)
- **Tabelas e migrations envolvidas**: Nenhuma alteração remota nesta fase preliminar de auditoria.
- **Alterações de segurança**: Nenhuma alteração nesta fase.
- **Testes executados**:
  - `npm run lint` (aprovado, 0 erros)
  - `npm run build` (aprovado, build concluído)
  - Testes pré-existentes aprovados (avatarLogic, equipesService, routePlanner, PWAInstallPrompt).
- **Critérios de aceitação atendidos**:
  - [x] Relatório de arquitetura atual elaborado.
  - [x] Inventário do que já está pronto concluído.
  - [x] Lista de lacunas e ausências documentada.
  - [x] Mapeamento de componentes e tabelas reutilizáveis concluído.
  - [x] Riscos técnicos identificados e mitigados.
  - [x] Proposta incremental de 7 missões sequenciais estruturada.
- **Próxima missão autorizada**: Missão 01 autorizada pelo usuário.

---

### MISSÃO 01 — Modelo Contratual e Frequências (com Correções da Missão 01.2)
- **Status**: [x] Concluído e validado
- **Objetivo**: Implementar tabela de contratos e frequências por indústria e loja (`contratos_lojas`) com vigência estrita, histórico, RLS granular (delete exclusivo admin), tratamento de pré-migration e carga inicial idempotente.
- **Arquivos analisados**:
  - `supabase/migrations/20260930_create_import_tables.sql`
  - `supabase/migrations/20260930_update_rotas_structure.sql`
  - `supabase/migrations/20261008_industry_client_access.sql`
  - `src/types.ts`
  - `src/lib/equipesService.ts`
- **Arquivos criados/modificados**:
  - `supabase/migrations/20261017120000_create_contratos_lojas_table.sql` (revisado: trigger de sobreposição temporal estrita, DELETE restrito a admin, check de coerência de frequências)
  - `src/types.ts` (atualizado: visitas_por_semana opcional para QUINZENAL e MENSAL)
  - `src/lib/contratosService.ts` (atualizado: detecção de sobreposição, MigrationPendingError tipado)
  - `src/lib/contratosService.test.ts` (atualizado: 18 testes unitários cobrindo vigência, sobreposição, coerência de frequência e erros pré-migration)
  - `docs/controle-frequencia/CHECKLIST_MISSOES.md` (atualizado)
- **Tabelas e migrations envolvidas**:
  - Migration local: `20261017120000_create_contratos_lojas_table.sql`.
  - Tabela: `public.contratos_lojas` (não destrutiva, preserva `rotas` e `visits`).
- **Alterações de segurança e RLS**:
  - `contratos_lojas_select_policy`: Admin/Gestor/Operador acessam tudo; Promotores lêem apenas lojas onde têm rota; `client_industry` isolado por `public.get_auth_industria_codigo()`.
  - `contratos_lojas_insert_policy`: Restrito a Admin/Gestor/Operador.
  - `contratos_lojas_update_policy`: Restrito a Admin/Gestor/Operador.
  - `contratos_lojas_delete_policy`: Exclusivo para papel `admin` (operador e gestor não podem excluir fisicamente contratos históricos).
- **Testes executados**:
  - `npx tsx src/lib/contratosService.test.ts` (18/18 testes aprovados)
  - `npx tsx src/auth/avatarLogic.test.ts` (5/5 aprovados)
  - `npx tsx src/lib/equipesService.test.ts` (9/9 aprovados)
  - `npx tsx src/utils/routePlanner.test.ts` (19/19 aprovados)
  - `npx tsx src/components/PWAInstallPrompt.test.ts` (7/7 aprovados)
  - `npm run lint` (0 erros)
  - `npm run build` (sucesso)
- **Critérios de aceitação atendidos**:
  - [x] Uma indústria pode ter várias lojas contratadas.
  - [x] Uma loja pode ter contratos com diferentes indústrias sem duplicar a loja.
  - [x] Representação de múltiplas visitas por semana (1x..7x) apenas para SEMANAL.
  - [x] Representação de frequência quinzenal com ciclo e visitas_por_semana nulo.
  - [x] Definição de vigência (`data_inicio_vigencia`, `data_fim_vigencia`).
  - [x] Trigger no banco impede dois contratos ativos ou suspensos com sobreposição temporal.
  - [x] Exclusão física de contratos restrita a administradores.
  - [x] Serviço TypeScript diferencia erro de pré-migration (`MigrationPendingError`) de falhas de autenticação/rede.
  - [x] Estrutura independente da presença de promotor na rota.
  - [x] Carga inicial inteligente e idempotente (`sync_contratos_from_rotas`) com isolamento de conflitos.
  - [x] RLS validado e compatível com as regras de isolamento da indústria.
- **Próxima missão**: Missão 02 aguardando autorização explícita do usuário.

### MISSÃO 02 — Programação das Obrigações de Atendimento
- **Status**: [ ] Não iniciado
- **Objetivo**: Motor de cálculo mensal/quinzenal/semanal de obrigações contratuais esperadas.

### MISSÃO 03 — Integração com as Visitas Existentes
- **Status**: [ ] Não iniciado
- **Objetivo**: Conciliação de execuções reais com as obrigações sem duplicidade.

### MISSÃO 04 — Indicadores do Painel Administrativo
- **Status**: [ ] Não iniciado
- **Objetivo**: Painel de acompanhamento mensal de cumprimento e auditoria de contratos.

### MISSÃO 05 — Portal da Indústria
- **Status**: [ ] Não iniciado
- **Objetivo**: Visão contratual, evidências e relatórios específicos para o cliente indústria.

### MISSÃO 06 — Segurança e Permissões
- **Status**: [ ] Não iniciado
- **Objetivo**: Auditoria de RLS, isolamento de dados e testes de não-vazamento.

### MISSÃO 07 — Testes Integrados e Validação Final
- **Status**: [ ] Não iniciado
- **Objetivo**: Bateria de 20 cenários de testes, regressão geral, lint e build.

