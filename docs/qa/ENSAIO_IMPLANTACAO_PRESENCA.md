# Relatório do Ensaio Técnico de Implantação das Migrations de Presença

**Projeto:** MK9 Date  
**Data:** 19 de outubro de 2026  
**Etapa:** 2.3 — Ensaio Prático em Ambiente Isolado  
**Auditor Responsável:** DBA PostgreSQL Sênior / Engenheiro DevOps & Segurança  
**Documento:** `docs/qa/ENSAIO_IMPLANTACAO_PRESENCA.md`  

---

## 1. Ambiente Utilizado e Evidências de Isolamento

Para garantir que **nenhum comando de escrita atingisse o banco Supabase Cloud de produção (`xzmbesqhxcnuokjwrbnw`)**, foi provisionado um ambiente PostgreSQL 17 rigorosamente isolado através do container Docker local:

- **Instância:** PostgreSQL 17.11 x86_64 (`supabase_db_mk9-data`).
- **Bancos Descartáveis de Teste:** `test_attendance_staging` e `test_attendance_restore`.
- **Origem dos Dados de Teste:** Schema base clonado e dados 100% sintéticos (zero dados pessoais ou reais de produção manipulados).
- **Destruição:** Os bancos de teste foram completamente dropados ao término dos ensaios.

---

## 2. Execução Sequencial das Nove Migrações de Presença

As 9 migrações de presença foram aplicadas sequencialmente na base `test_attendance_staging` com cronometragem individual:

| Ordem | Migration | Tempo | Resultado | Impacto / Objetos Criados |
| :---: | :--- | :---: | :---: | :--- |
| **1** | `20261018220000_create_promoter_attendance_audit.sql` | 240 ms | **SUCESSO** | `promoter_attendance_records`, `promoter_attendance_audit_log`, RPC `set_promoter_attendance_override`. |
| **2** | `20261018230000_create_promoter_schedules_and_absences.sql` | 231 ms | **SUCESSO** | `promoter_absences`, `promoter_work_schedules`, RPCs `is_promoter_on_absence`, `get_promoter_schedule`. |
| **3** | `20261018232256_harden_attendance_audit_permissions.sql` | 160 ms | **SUCESSO** | Trigger `guard_profile_operational_identity`, políticas RESTRICTIVE em attendance. |
| **4** | `20261018234153_finalize_attendance_journeys_privacy_telemetry.sql` | 254 ms | **SUCESSO** | Schema `attendance_private`, `promoter_journey_audit`, `promoter_work_schedule_templates`, `attendance_holidays`, views `industry_*`, colunas de telemetria em `visits`. |
| **5** | `20261019001109_lock_attendance_telemetry_and_scope.sql` | 162 ms | **SUCESSO** | Triggers de bloqueio direto de telemetria em `visits` e auditoria de vínculos. |
| **6** | `20261019001848_validate_attendance_schedule_overlaps.sql` | 172 ms | **SUCESSO** | Trigger `guard_schedule_overlap` (anti-sobreposição noturna), view `attendance_override_summary`. |
| **7** | `20261019004947_add_attendance_work_location.sql` | 176 ms | **SUCESSO** | Colunas `work_uf` e `work_city` em schedules e templates. |
| **8** | `20261019011832_secure_attendance_photos_and_release_contract.sql` | 181 ms | **SUCESSO** | Blindagem em `storage.objects` e `visit_photos`, view `industry_routes`. |
| **9** | `20261019013007_complete_attendance_operational_setup.sql` | 161 ms | **SUCESSO** | RPCs `apply_attendance_journeys`, `assign_attendance_supervisor`, `approve_attendance_closure`, `attendance_setup_status`. |

**Total de Objetos Criados:** 27 tabelas e views estruturadas, 8 funções RPC seguras e triggers de governança.  
**Taxa de Sucesso:** 9 de 9 migrações aplicadas (100%).

---

## 3. Validação Prática de Segurança RLS e Permissões

1. **Tentativa de Escrita Direta como `authenticated` (Bypass Test):**
   - Executada inserção direta em `public.promoter_attendance_records` como usuário autenticado sem passar pela RPC oficial.
   - **Resultado:** `ERROR: permission denied for table promoter_attendance_records`. Acesso negado com sucesso conforme política de imutabilidade.
2. **Schema Privado:**
   - Funções internas encapsuladas em `attendance_private` sem permissão de execução para `anon` ou `PUBLIC`.
3. **Parâmetro de Faltas Automáticas:**
   - Consulta em `system_settings` confirmou:
     `{"timezone": "America/Sao_Paulo", "day_close_time": null, "expected_checkin_time": null, "late_tolerance_minutes": null}`.
   - O fechamento automático de faltas permaneceu **100% desabilitado** por padrão.

---

## 4. Teste de Falhas Parciais e Resiliência Atômica

- **Ensaio de Interrupção/Erro:** Durante a simulação de falta de coluna prévia (`industria_codigo` na migration 3 antes do patch de referência), a transação executou o `ROLLBACK` total imediato.
- **Evidência:** O PostgreSQL abortou o bloco atômico sem deixar tabelas órfãs ou corrompidas no catálogo do banco de dados.

---

## 5. Teste de Backup Completo e Restauração (Disaster Recovery)

1. **Dump do Banco Staging:**
   - Gerado dump binário customizado (`pg_dump -F c`) contendo schema e dados sintéticos em `/tmp/test_attendance_backup.dump`.
2. **Restauração em Novo Banco Descartável (`test_attendance_restore`):**
   - Restaurado com sucesso via `pg_restore`.
   - Contagem de tabelas públicas após o restore: **27 tabelas**.
   - Contagem de promotores após o restore: **1 promotor sintético preservado intacto**.
3. **Limpeza:**
   - Ambos os bancos descartáveis (`test_attendance_staging` e `test_attendance_restore`) foram dropados e expurgados do ambiente local.

---

## 6. Procedimento Definitivo Recomendado para Produção

Com base no ensaio 100% bem-sucedido, a aplicação em produção deverá seguir estes passos exatos:

1. **Gerar Snapshot de Salvaguarda dos Dados de Produção:**
   ```bash
   npx supabase db dump --linked --data-only --use-copy -f supabase/backups/prod_backup_data_pre_attendance.sql
   ```
2. **Execução Sequencial no SQL Editor do Supabase Cloud:**
   - Abrir o SQL Editor no painel Supabase do projeto `xzmbesqhxcnuokjwrbnw`.
   - Executar individualmente os scripts de 1 a 9 (`20261018220000` até `20261019013007`).
3. **Recarga do Cache da API:**
   - O script 9 já dispara automaticamente `NOTIFY pgrst, 'reload schema';`.
4. **Validação da Interface:**
   - Abrir o módulo Controle de Presença e confirmar o banner de status e integridade.

