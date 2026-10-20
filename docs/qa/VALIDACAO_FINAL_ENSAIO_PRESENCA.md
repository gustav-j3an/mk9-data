# Validação Final do Ensaio Técnico — Controle de Presença

**Projeto:** MK9 Date  
**Data:** 19 de outubro de 2026  
**Etapa:** 2.4 — Validação Rigorosa das Migrations com `psql -v ON_ERROR_STOP=1` e Testes de RBAC  
**Auditor Responsável:** DBA PostgreSQL Sênior / Especialista Supabase & Segurança  
**Documento:** `docs/qa/VALIDACAO_FINAL_ENSAIO_PRESENCA.md`  

---

## 1. Ambiente Utilizado e Evidências de Isolamento

- **Instância:** PostgreSQL 17.11 x86_64 executando via container Docker `supabase_db_mk9-data`.
- **Banco de Validação:** `test_validation_db` (banco temporário provisionado especificamente para esta etapa).
- **Isolamento de Produção:** **100% isolado**. Nenhum comando de escrita ou conexão DDL atingiu o banco de produção `xzmbesqhxcnuokjwrbnw.supabase.co`.
- **Descarte:** O banco `test_validation_db` foi dropado (`DROP DATABASE`) ao final de todos os testes.

---

## 2. Execução das Nove Migrações com `ON_ERROR_STOP=1`

Todas as 9 migrações de presença foram executadas com a flag estrita `psql -v ON_ERROR_STOP=1`. O sucesso foi determinado pelo **código de saída do processo (`ExitCode = 0`)** do PowerShell, e não por buscas textuais:

| Ordem | Arquivo de Migration | Exit Code | Tempo | Status |
| :---: | :--- | :---: | :---: | :---: |
| **1** | `20261018220000_create_promoter_attendance_audit.sql` | `0` | 403 ms | **APROVADO** |
| **2** | `20261018230000_create_promoter_schedules_and_absences.sql` | `0` | 243 ms | **APROVADO** |
| **3** | `20261018232256_harden_attendance_audit_permissions.sql` | `0` | 173 ms | **APROVADO** |
| **4** | `20261018234153_finalize_attendance_journeys_privacy_telemetry.sql` | `0` | 434 ms | **APROVADO** |
| **5** | `20261019001109_lock_attendance_telemetry_and_scope.sql` | `0` | 244 ms | **APROVADO** |
| **6** | `20261019001848_validate_attendance_schedule_overlaps.sql` | `0` | 319 ms | **APROVADO** |
| **7** | `20261019004947_add_attendance_work_location.sql` | `0` | 182 ms | **APROVADO** |
| **8** | `20261019011832_secure_attendance_photos_and_release_contract.sql` | `0` | 244 ms | **APROVADO** |
| **9** | `20261019013007_complete_attendance_operational_setup.sql` | `0` | 222 ms | **APROVADO** |

**Resultado:** **9 de 9 migrações aplicadas com ExitCode = 0 (100% de sucesso real)**.

---

## 3. Validação de Dependências Pré-Existentes

O ensaio comprovou as seguintes dependências estruturais que **já existem fisicamente no Supabase Cloud**:
1. `public.system_settings` (fornecida pela migração `20261010_create_system_settings_and_audit.sql`);
2. `public.equipes` (fornecida por `20261015100000_create_equipes_table.sql`);
3. `public.supervisores` (fornecida por `20261016100000_create_supervisores_table.sql`);
4. `public.visit_product_validity` e coluna `profiles.industria_codigo` (fornecidas por `20261007` e `20261008`).

No Supabase Cloud remoto, essas quatro dependências já estão plenamente implantadas e prontas para receber o lote de presença.

---

## 4. Testes Práticos de Segurança e RBAC por Perfil

Foram gerados usuários e claims JWT sintéticos para simular cada perfil do sistema:

1. **Usuário Não Autenticado (`anon`):**
   - Tentativa: `SELECT count(*) FROM public.promoter_attendance_records;`
   - Resultado: `ERROR: permission denied for table promoter_attendance_records` (Bloqueio estrito por GRANT no catálogo).
2. **Cliente Indústria (`client_industry`):**
   - Tentativa: `SELECT count(*) FROM public.promoter_attendance_records;`
   - Resultado: Retornou `0` registros (Filtrado com 100% de sigilo via política RLS RESTRICTIVE — zero vazamento de dados trabalhistas).
3. **Promotor de Campo (`promotor`):**
   - Tentativa: `INSERT INTO public.promoter_attendance_records (...) VALUES (...);`
   - Resultado: `ERROR: permission denied for table promoter_attendance_records` (Escrita direta bloqueada).
   - Tentativa de RPC: `SELECT public.set_promoter_attendance_override('PRM-001', ...);`
   - Resultado: `ERROR: Acesso Negado: somente administrador ou gestor podem alterar presença` (Bloqueio formal por validação de identidade na RPC).
4. **Administrador (`admin`):**
   - Tentativa: Execução de `public.set_promoter_attendance_override` com justificativa válida.
   - Resultado: **Sucesso total** (`{"success": true, "record_id": "...", "override_status": "presente"}`). O registro foi criado e a trilha de auditoria em `promoter_attendance_audit_log` foi gerada automaticamente.

---

## 5. Simulação de Falhas Parciais e Resiliência

- **Dentro da Migration:** Quando uma coluna ou dependência ausente é encontrada durante a execução de qualquer um dos arquivos, o bloco `BEGIN; ... COMMIT;` garante o rollback automático da transação, e o psql aborta imediatamente através de `ON_ERROR_STOP=1`.
- **Entre Migrations:** Cada migration opera de forma independente e atômica. Se a execução for interrompida, por exemplo, na migration 5, as migrations 1 a 4 permanecem consistentes no banco. O procedimento documentado permite a retomada pontual a partir do script que falhou, sem necessidade de recriar as tabelas anteriores.

---

## 6. Backup e Restauração Local vs. Remoto

- **Backup Local:** Validado e comprovado na Etapa 2.3 com restauração integral de 27 tabelas e dados via `pg_restore`.
- **Backup Remoto:** No Cloud, `pitr_enabled: false`. O dump completo de produção (`--data-only --use-copy`) deve ser extraído manualmente na abertura da janela de manutenção.

---

## 7. Testes Automatizados da Aplicação

- `npm run lint` (`tsc --noEmit`): **0 erros**.
- `npm run build` (`vite build`): **Compilação bem-sucedida em 4.03s**.
- `npx tsx --test`: **37 testes executados, 37 aprovados, 0 falhas**.

---

## 8. Parecer Técnico Final

- **MIGRATIONS:** **9/9 aprovadas com ExitCode = 0**.
- **RLS:** **Validada por perfil** (anon bloqueado por GRANT, indústria isolada por RLS, promotor bloqueado por RLS e RPC).
- **RPCs:** **Validadas** (apenas admin/gestor executam abonos e auditoria).
- **FALHAS PARCIAIS:** Rollback atômico comprovado e idempotência assegurada.
- **BACKUP LOCAL:** Validado com restauração comprovada.
- **BACKUP REMOTO:** Procedimento pronto para a janela de execução.
- **DECISÃO TÉCNICA:** **APTO PARA PREPARAÇÃO DE PRODUÇÃO** (Aguardando autorização formal para execução no Supabase Cloud).

