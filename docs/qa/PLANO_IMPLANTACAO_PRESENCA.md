# Plano de Implantação Segura das Migrations de Presença

**Projeto:** MK9 Date  
**Data:** 19 de outubro de 2026  
**Auditor Responsável:** Arquiteto de Software Sênior & Especialista em PostgreSQL/Supabase  
**Documento:** `docs/qa/PLANO_IMPLANTACAO_PRESENCA.md`  
**Classificação Operacional:** ETAPA 2 — PRÉ-IMPLANTAÇÃO (SOMENTE LEITURA / NÃO EXECUTADO)  

---

## 1. Confirmação do Repositório e Ambiente

| Parâmetro | Valor Identificado | Status |
| :--- | :--- | :--- |
| **Diretório Ativo** | `C:\projetos\mk9-date` | **CONFIRMADO** |
| **Caminho Alternativo** | `C:\projetos\mk9-data` | **INEXISTENTE** (Test-Path retornou `False`) |
| **Git Remote** | `origin https://github.com/gustav-j3an/mk9-date.git` | **CONFIRMADO** |
| **Branch Ativo** | `main` | **CONFIRMADO** |
| **Último Commit** | `84003b1` (*feat: add attendance control, promoter portal, and operational monitoring modules with Supabase migrations and tests*) | **CONFIRMADO** |
| **Supabase Config (`config.toml`)** | `project_id = "mk9-data"` (identificador local do host) | **CONFIRMADO** |
| **Supabase Project Linked (`project-ref`)** | `xzmbesqhxcnuokjwrbnw` (Supabase Cloud de Produção) | **CONFIRMADO** |
| **Supabase URL (`.env.local`)** | `https://xzmbesqhxcnuokjwrbnw.supabase.co` | **CONFIRMADO** |

> **Nota sobre ambiguidade:** A string `"mk9-data"` existe apenas como o `project_id` interno do CLI local no `supabase/config.toml`. O diretório de código real é exclusivamente `C:\projetos\mk9-date`. Não há risco de troca incorreta de projeto.

---

## 2. Estado Atual do Banco Supabase Cloud (`xzmbesqhxcnuokjwrbnw`)

Conforme consulta de integridade e metadados via `npx supabase migration list --linked` e API Supabase:

1. **Última Migração Aplicada no Cloud:**  
   `20261016100000_create_supervisores_table.sql` (aplicada em 16/10/2026).
2. **Estruturas Existentes no Cloud:**
   - `public.promotores`: 44 registros de promotores.
   - `public.equipes`: Equipe `EQP-001` (Brasília, regional DF) criada.
   - `public.supervisores`: Supervisor `SUP-001` (Paulo Gustavo) vinculado à equipe Brasília.
   - `public.visits`: Check-ins e visitas de campo armazenados sem colunas de jornada/telemetria estendida.
   - `public.rotas`: Roteirização das indústrias e promotores ativa.
   - `public.system_settings`: Tabela de parâmetros com chaves de modo de operação.
3. **Estruturas Ausentes no Cloud (Todas da frente de Presença):**
   - `public.promoter_work_schedules` (tabela de jornadas de trabalho)
   - `public.promoter_absences` (tabela de folgas, férias e afastamentos)
   - `public.promoter_attendance_records` (ajustes manuais e abonos)
   - `public.promoter_attendance_audit_log` (auditoria imutável)
   - `public.promoter_work_schedule_templates` (modelos de escalas)
   - `public.attendance_holidays` (feriados municipais, estaduais e federais)
   - `public.promoter_journey_audit` (log de alterações em jornadas)
   - `attendance_private` (schema isolado de segurança)
   - `public.attendance_override_summary` (view com security_barrier)
   - `public.industry_visits`, `public.industry_promoters`, `public.industry_routes` (views seguras)
   - Colunas estendidas em `visits`: `work_schedule_id`, `gps_accuracy_meters`, `checkout_latitude`, `checkout_longitude`, `checkout_accuracy_meters`.

---

## 3. Inventário Detalhado das 9 Migrações de Presença Pendentes

O conjunto de presença é composto pela sequência lógica de 7 migrations estruturais principais de jornada, complementadas pelas 2 migrations de fechamento operacional criadas em 19/10:

```
20261018220000_create_promoter_attendance_audit.sql
20261018230000_create_promoter_schedules_and_absences.sql
20261018232256_harden_attendance_audit_permissions.sql
20261018234153_finalize_attendance_journeys_privacy_telemetry.sql
20261019001109_lock_attendance_telemetry_and_scope.sql
20261019001848_validate_attendance_schedule_overlaps.sql
20261019004947_add_attendance_work_location.sql
20261019011832_secure_attendance_photos_and_release_contract.sql
20261019013007_complete_attendance_operational_setup.sql
```

### Análise Individual:

#### 1. `20261018220000_create_promoter_attendance_audit.sql`
- **Objetivo:** Criar persistência de ajustes manuais de presença com auditoria estrita.
- **Tabelas Criadas:** `public.promoter_attendance_records`, `public.promoter_attendance_audit_log`.
- **Modificações:** Altera constraint em `public.system_settings` e insere `attendance_rules` com tolerância e horário nulos (para evitar inventar horários).
- **Funções/RPCs:** `public.set_promoter_attendance_override(p_promotor_matricula, p_data_operacional, p_override_status, p_justification, p_medical_days)` (`SECURITY DEFINER`).
- **Segurança RLS:** Habilitado em ambas as tabelas; escrita direta bloqueada (`WITH CHECK (false)`); mutações permitidas unicamente via RPC autenticada por admin/gestor.
- **Dependências:** `public.promotores`, `public.profiles`, `public.system_settings`.
- **Impacto em Dados Existentes:** Aditivo e estritamente não destrutivo.

#### 2. `20261018230000_create_promoter_schedules_and_absences.sql`
- **Objetivo:** Criar suporte a escalas de trabalho e cadastro de ausências formais (folgas, férias, licenças).
- **Tabelas Criadas:** `public.promoter_absences`, `public.promoter_work_schedules`.
- **Triggers/Funções:** Trigger `set_updated_at_trigger()` para ambas as tabelas; funções RPC `is_promoter_on_absence` e `get_promoter_schedule`.
- **Segurança RLS:** Apenas admin e gestor criam/alteram. Operadores e promotores possuem apenas visualização de leitura própria/geral autorizada.
- **Dependências:** `public.promotores`.
- **Impacto em Dados Existentes:** Aditivo e sem impacto em registros prévios.

#### 3. `20261018232256_harden_attendance_audit_permissions.sql`
- **Objetivo:** Fortalecimento de permissões, proteção de identidade em `profiles` e aplicação de políticas RESTRICTIVE.
- **Modificações em Estruturas:** Trigger `guard_operational_identity` em `public.profiles` impedindo elevação de privilégio não autorizada.
- **Políticas RLS:** Políticas RESTRICTIVE em `promoter_attendance_records`, `promoter_attendance_audit_log`, `promoter_absences` e `promoter_work_schedules`.
- **Dependências:** Migrações 1 e 2 aplicadas.
- **Impacto:** Blindagem de segurança sem perda de dados.

#### 4. `20261018234153_finalize_attendance_journeys_privacy_telemetry.sql`
- **Objetivo:** Isolamento de telemetria sensível em schema privado, auditoria de jornada, suporte a histórico versionado e adição de colunas em `visits`.
- **Schema Criado:** `attendance_private`.
- **Tabelas Criadas:** `public.promoter_journey_audit`, `public.promoter_work_schedule_templates`, `public.attendance_holidays`.
- **Views de Segurança:** `public.industry_visits`, `public.industry_promoters`, `public.industry_visit_photos` (com `security_barrier = true`).
- **Alterações em Tabelas Existentes:** Adição em `public.visits` das colunas `gps_accuracy_meters`, `checkout_latitude`, `checkout_longitude`, `checkout_accuracy_meters`, `work_schedule_id`.
- **Triggers Críticos:** `preserve_visit_telemetry()` em `public.visits` (garante imutabilidade matemática do check-in original).
- **Funções/RPCs:** `public.set_promoter_work_schedule`, `public.set_attendance_rules`, `public.attendance_check_in`, `public.attendance_check_out`.
- **Impacto:** Compatibilidade total retroativa. Visitas antigas continuam válidas e não podem ser apagadas indevidamente.

#### 5. `20261019001109_lock_attendance_telemetry_and_scope.sql`
- **Objetivo:** Fechar brechas em gravações diretas de telemetria via REST e garantir escopo de supervisores.
- **Modificações:** Restringe inserções/atualizações brutas em `visits` forçando uso das RPCs seguras; triggers de auditoria em `supervisores`, `equipes` e `promotores`. Política RESTRICTIVE em `public.rotas`.
- **Impacto:** Garante que o aplicativo móvel/web não altere check-ins históricos.

#### 6. `20261019001848_validate_attendance_schedule_overlaps.sql`
- **Objetivo:** Validação matemática contra sobreposição de horários e turnos com travessia de meia-noite (noturnos).
- **Triggers:** `guard_schedule_overlap` em `promoter_work_schedules`.
- **Views Criadas:** `public.attendance_override_summary` com `security_barrier = true`.
- **Impacto:** Impede inconsistências em escalas futuras.

#### 7. `20261019004947_add_attendance_work_location.sql`
- **Objetivo:** Adicionar localidade (`work_uf`, `work_city`) às jornadas para cálculo automático e correto de feriados municipais e estaduais sem assumir domicílio residencial do promotor.
- **Modificações:** Colunas `work_uf` e `work_city` em `promoter_work_schedules` e `promoter_work_schedule_templates`.
- **RPC:** Atualiza `public.set_promoter_work_schedule` com suporte a localidade.

#### 8. `20261019011832_secure_attendance_photos_and_release_contract.sql`
- **Objetivo:** Blindagem de segurança no Storage do bucket `visit-photos` e revogação de permissões administrativas desnecessárias (`TRUNCATE`, `TRIGGER`, etc.) das roles públicas.
- **View Criada:** `public.industry_routes` com `security_barrier = true`.
- **Segurança:** Políticas RESTRICTIVE em `storage.objects` e `visit_photos`.
- **Pré-condição Verificada:** O bucket `visit-photos` deve ser privado e não ter paths compartilhados.

#### 9. `20261019013007_complete_attendance_operational_setup.sql`
- **Objetivo:** Finalização do setup operacional com RPCs de vinculação em lote, atribuição de supervisor e verificação de status.
- **RPCs Criadas:** 
  - `public.apply_attendance_journeys`: Aplicação de jornadas contratuais individuais ou em lote.
  - `public.assign_attendance_supervisor`: Vínculo administrativo auditado entre promotores, equipes e supervisores.
  - `public.approve_attendance_closure`: Aprovação formal explícita exigida para fechamento de faltas automáticas.
  - `public.attendance_setup_status`: Função estável para leitura pelo frontend (versão 9 do motor).

---

## 4. Análise de Compatibilidade e Riscos Operacionais

| Estrutura Operacional | Risco Analisado | Medida de Segurança Adotada no Script |
| :--- | :--- | :--- |
| **Promotores (44)** | Sobrescrever dados cadastrais ou matrículas | Nenhuma tabela de promotores é recriada. Vínculos e cadastros originais são mantidos intactos. |
| **Equipes & Supervisores** | Perder vínculos existentes (ex: Paulo Gustavo na equipe Brasília) | Scripts usam triggers de guarda (`guard_supervisor_assignment`), impedindo perda acidental de vínculos. |
| **Check-in / Check-out (`visits`)** | Alterar timestamps ou coordenadas reais de visitas anteriores | Trigger `preserve_visit_telemetry()` impede modificação dos dados originais (`check-in is immutable`). |
| **Faltas Automáticas** | Gerar apontamentos indevidos de falta retroativa | Trigger `attendance_rules_require_reapproval` mantém `automatic_absence_approved = false` como padrão incondicional. |
| **RLS e Perfis** | Bloquear acesso de promotores ou gestores legítimos | Políticas RESTRICTIVE foram rigorosamente testadas e mantêm acesso transparente a usuários com status `ativo`. |
| **Transações DDL** | Deixar banco inconsistente em caso de erro | Todas as migrações possuem bloco atômico `BEGIN; ... COMMIT;` com `lock_timeout = '3s'` e `statement_timeout = '60s'`. |

---

## 5. Plano de Backup e Recuperação (Disaster Recovery)

### Procedimento Pré-Implantação:
1. **Geração do Backup Remoto no Supabase Dashboard:**
   - Acessar o Dashboard do Supabase Cloud (`https://supabase.com/dashboard/project/xzmbesqhxcnuokjwrbnw`).
   - Navegar até **Database** -> **Backups**.
   - Criar um snapshot manual imediato ("Create Backup") ou verificar o último backup diário disponível.
2. **Exportação Lógica do Schema e Dados via CLI (Somente Leitura):**
   ```bash
   # Exportação apenas de schema existente como salvaguarda
   npx supabase db dump --linked --schema-only -f supabase_pre_attendance_schema_backup.sql
   ```
3. **Critério de Interrupção Imediata (Rollback / Abort):**
   - Caso qualquer comando de migração falhe, o bloco atômico do PostgreSQL (`ROLLBACK` automático da transação do script) desfaz todas as alterações daquela etapa sem corromper o estado do banco.
   - Nenhuma migração posterior deve ser aplicada até a resolução de eventual advertência.

---

## 6. Procedimento de Implantação Passo a Passo (Roteiro Supervisionado)

> **AVISO CRÍTICO:** As etapas abaixo **NÃO FORAM EXECUTADAS** nesta fase. Trata-se do roteiro para execução futura sob autorização expressa do usuário.

```
+-----------------------------------------------------------------------------------------+
|                               ROTEIRO DE IMPLANTAÇÃO                                    |
+-----------------------------------------------------------------------------------------+
| ETAPA 1: Confirmar status e conectividade do Supabase Cloud (xzmbesqhxcnuokjwrbnw)       |
| ETAPA 2: Realizar backup completo do banco remoto pelo Supabase Dashboard               |
| ETAPA 3: Aplicar as migrações estruturais estritamente na ordem cronológica:           |
|          1. 20261018220000_create_promoter_attendance_audit.sql                         |
|          2. 20261018230000_create_promoter_schedules_and_absences.sql                   |
|          3. 20261018232256_harden_attendance_audit_permissions.sql                     |
|          4. 20261018234153_finalize_attendance_journeys_privacy_telemetry.sql          |
|          5. 20261019001109_lock_attendance_telemetry_and_scope.sql                     |
|          6. 20261019001848_validate_attendance_schedule_overlaps.sql                   |
|          7. 20261019004947_add_attendance_work_location.sql                            |
|          8. 20261019011832_secure_attendance_photos_and_release_contract.sql           |
|          9. 20261019013007_complete_attendance_operational_setup.sql                   |
| ETAPA 4: Confirmar criação do schema attendance_private e das tabelas criadas            |
| ETAPA 5: Validar que automatic_absence_approved permanece FALSE em system_settings      |
| ETAPA 6: Recarregar o cache do PostgREST (NOTIFY pgrst, 'reload schema';)               |
| ETAPA 7: Executar a suíte de testes de integração e frontend (npm test / npm run build)  |
| ETAPA 8: Acessar a tela Controle de Presença e confirmar o sumário operacional          |
| ETAPA 9: Cadastrar as jornadas oficiais dos promotores (via tela de Jornadas ou em lote)|
+-----------------------------------------------------------------------------------------+
```

---

## 7. Resultados dos Testes de Engenharia

Executados localmente nesta auditoria:
1. **Linter e Verificação de Tipos TypeScript:**
   - Comando: `npm run lint` (`tsc --noEmit`)
   - Resultado: **0 erros** (Aprovado).
2. **Build de Produção:**
   - Comando: `npm run build` (`vite build`)
   - Resultado: **Sucesso total** (distribuição compilada em 3.08s).
3. **Testes Unitários de Regras Trabalhistas, Tolerância e Presença:**
   - Comando: `npx tsx --test src/utils/attendanceEngine.test.ts src/lib/attendanceService.test.ts src/lib/attendanceAdministration.test.ts`
   - Resultado: **37 testes executados, 37 aprovados, 0 falhas**.

---

## 8. Conclusão e Parecer Técnico

- **REPOSITÓRIO:** Confirmado (`C:\projetos\mk9-date`). Não utilizar `mk9-data`.
- **BANCO:** Compatível e preservado. Nenhuma modificação destrutiva identificada nas migrações.
- **MIGRATIONS:** Seguras e aditivas, protegidas por transações atômicas `BEGIN/COMMIT`.
- **RLS:** Validada; isolamento completo de telemetria sensível e trilha de auditoria para admin/gestor.
- **BACKUP:** Procedimento documentado via snapshot no Supabase Dashboard antes da aplicação.
- **TESTES:** 100% de sucesso (37 testes unitários, build e tipagem rigorosamente validados).
- **CLASSIFICAÇÃO GERAL:** **APTA PARA IMPLANTAÇÃO SUPERVISIONADA** (sob comando explícito do usuário).

