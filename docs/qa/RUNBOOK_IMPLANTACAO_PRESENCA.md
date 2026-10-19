# Runbook Definitivo de Implantação — Controle de Presença

**Projeto:** MK9 Date  
**Data:** 19 de outubro de 2026  
**Auditor Responsável:** DBA PostgreSQL Sênior / Especialista Supabase & Segurança DevOps  
**Documento:** `docs/qa/RUNBOOK_IMPLANTACAO_PRESENCA.md`  
**Status Operacional:** PRONTO PARA SOLICITAR AUTORIZAÇÃO FORMAL DO ADMINISTRADOR  

---

## 1. Pré-Requisitos e Confirmação do Ambiente

Antes de iniciar qualquer procedimento, o operador deve confirmar rigorosamente as variáveis de ambiente e conectividade:

| Item | Valor Obrigatório / Esperado | Validação |
| :--- | :--- | :--- |
| **Diretório de Trabalho** | `C:\projetos\mk9-date` | Confirmar via terminal (`Get-Location`) |
| **Branch Git** | `main` (limpo, sem commits não homologados) | `git status --short` |
| **Projeto Supabase Cloud** | `xzmbesqhxcnuokjwrbnw` (Região `sa-east-1` São Paulo) | Confirmar via `supabase\.temp\project-ref` |
| **CLI Supabase** | Instalada e autenticada com acesso ao projeto | `npx supabase projects list` |
| **Permissão no Supabase** | Role `postgres` / `service_role` com privilégios de DDL | Acesso ao SQL Editor do Dashboard |

---

## 2. Fase de Salvaguarda (Backup Completo Pré-Implantação)

> **ATENÇÃO:** O dump com `--schema-only` NÃO É SUFICIENTE. O backup completo exige a exportação dos dados reais existentes (`public.promotores`, `public.equipes`, `public.supervisores`, `public.visits`, `public.rotas`, etc.).

### Procedimento de Extração (Executar no início da janela autorizada):

1. **Backup Completo de Dados Operacionais (`--data-only --use-copy`):**
   ```powershell
   npx supabase db dump --linked --data-only --use-copy -f "supabase/backups/prod_backup_data_pre_attendance.sql"
   ```
2. **Backup de Esquema (DDL atual de produção):**
   ```powershell
   npx supabase db dump --linked -f "supabase/backups/prod_backup_schema_pre_attendance.sql"
   ```
3. **Backup de Roles e Permissões:**
   ```powershell
   npx supabase db dump --linked --role-only -f "supabase/backups/prod_backup_roles_pre_attendance.sql"
   ```
4. **Verificação de Integridade dos Arquivos:**
   - Conferir se os arquivos possuem tamanho superior a 0 KB e contêm os comandos `COPY public.promotores` e `COPY public.visits`.
   - Garantir que a pasta `supabase/backups/` não seja versionada publicamente no Git.

---

## 3. Matriz de Reconciliação do Ledger de Migrações

Para evitar o erro crítico de executar `supabase db push` ou `supabase migration up` (que tentaria reexecutar scripts legados cujas tabelas já existem fisicamente), a implantação será realizada **de forma assistida e sequencial**.

### Mapeamento das 9 Migrações de Presença:

| Ordem | Versão Timestamp | Arquivo Local | Estado Atual no Cloud | Ação na Janela |
| :---: | :---: | :--- | :---: | :--- |
| **1** | `20261018220000` | `20261018220000_create_promoter_attendance_audit.sql` | **Pendente Real** | Aplicar no SQL Editor |
| **2** | `20261018230000` | `20261018230000_create_promoter_schedules_and_absences.sql` | **Pendente Real** | Aplicar no SQL Editor |
| **3** | `20261018232256` | `20261018232256_harden_attendance_audit_permissions.sql` | **Pendente Real** | Aplicar no SQL Editor |
| **4** | `20261018234153` | `20261018234153_finalize_attendance_journeys_privacy_telemetry.sql` | **Pendente Real** | Aplicar no SQL Editor |
| **5** | `20261019001109` | `20261019001109_lock_attendance_telemetry_and_scope.sql` | **Pendente Real** | Aplicar no SQL Editor |
| **6** | `20261019001848` | `20261019001848_validate_attendance_schedule_overlaps.sql` | **Pendente Real** | Aplicar no SQL Editor |
| **7** | `20261019004947` | `20261019004947_add_attendance_work_location.sql` | **Pendente Real** | Aplicar no SQL Editor |
| **8** | `20261019011832` | `20261019011832_secure_attendance_photos_and_release_contract.sql` | **Pendente Real** | Aplicar no SQL Editor (loop pg_default_acl ajustado para revogar privilégios em roles com USAGE e registrar NOTICE para supabase_admin gerenciada) |
| **9** | `20261019013007` | `20261019013007_complete_attendance_operational_setup.sql` | **Pendente Real** | Aplicar no SQL Editor |

---

## 4. Matriz Completa de Segurança e Permissões por Perfil

| Perfil | Jornadas (`promoter_work_schedules`) | Presenças Manuais (`promoter_attendance_records`) | Auditoria (`promoter_*_audit`) | Telemetria / Check-in (`visits`) | Fotos (`visit-photos` / Storage) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Administrador (`admin`)** | SELECT, INSERT, UPDATE, DELETE (via RPCs) | SELECT (todas), Escrita somente via RPC auditada | SELECT (global) | Acesso irrestrito a check-in e check-out | Leitura e exclusão autorizada |
| **Supervisor / Gestor (`gestor`)** | SELECT (apenas de sua equipe), Escrita via RPC | SELECT (apenas de sua equipe), Escrita via RPC | SELECT (apenas de sua equipe) | SELECT (somente promotores de sua equipe) | Visualização somente de fotos de sua equipe |
| **Promotor de Campo (`promotor`)** | SELECT (apenas seu próprio expediente) | Sem escrita; leitura apenas do seu status | Sem acesso | INSERT/UPDATE apenas via RPC `attendance_check_in` / `check_out` | Upload e leitura exclusiva das fotos de sua visita |
| **Cliente Indústria (`client_industry`)** | Bloqueado (Zero acesso por RLS) | Bloqueado (Zero acesso por RLS) | Bloqueado | Acesso exclusivo à view sanitizada `industry_visits` (sem CPF, GPS bruto ou telefone) | Acesso apenas via view protegida `industry_visit_photos` |
| **Anônimo (`anon`)** | Bloqueado por REVOKE | Bloqueado por REVOKE | Bloqueado por REVOKE | Bloqueado por REVOKE | Bloqueado por política RESTRICTIVE |

---

## 5. Roteiro Passo a Passo de Execução Supervisionada

### Passo 1: Execução Sequencial das Migrações no Supabase Cloud
No **SQL Editor** do projeto `xzmbesqhxcnuokjwrbnw`, executar os 9 scripts na ordem exata de 1 a 9.
- Cada script possui bloco atômico `BEGIN; ... COMMIT;` com `lock_timeout = '3s'` e `statement_timeout = '60s'`.
- Critério de Parada Imediata: Se qualquer script retornar erro, **NÃO prosseguir** para o script seguinte. O script com erro sofrerá rollback automático.

### Passo 2: Registro Consistente no Ledger Remoto
Após a execução bem-sucedida de cada script, registrar as versões na tabela de histórico de migrações (`supabase_migrations.schema_migrations`) executando no SQL Editor:
```sql
INSERT INTO supabase_migrations.schema_migrations (version) VALUES
  ('20261018220000'),
  ('20261018230000'),
  ('20261018232256'),
  ('20261018234153'),
  ('20261019001109'),
  ('20261019001848'),
  ('20261019004947'),
  ('20261019011832'),
  ('20261019013007')
ON CONFLICT (version) DO NOTHING;
```

### Passo 3: Recarga do Cache da API do PostgREST
Executar no SQL Editor:
```sql
NOTIFY pgrst, 'reload schema';
```

---

## 6. Procedimento de Validação Pós-Implantação

Após a conclusão da implantação, executar as seguintes verificações de integridade:

1. **Checagem de Tabelas e Schema Privado:**
   ```sql
   SELECT table_schema, table_name FROM information_schema.tables 
   WHERE table_schema IN ('public', 'attendance_private') AND table_name LIKE '%attendance%'
   ORDER BY table_schema, table_name;
   ```
2. **Confirmação do Bloqueio de Faltas Automáticas:**
   ```sql
   SELECT key, value FROM public.system_settings WHERE key = 'attendance_rules';
   ```
   *Critério de Sucesso:* `automatic_absence_approved` deve ser `false` (ou nulo) e não pode haver fechamento automático de ponto.
3. **Validação da Quantidade de Promotores e Equipes:**
   ```sql
   SELECT count(*) FROM public.promotores; -- Deve permanecer exatamente 44
   SELECT count(*) FROM public.equipes;    -- Deve permanecer exatamente 1 (Brasília)
   SELECT count(*) FROM public.supervisores; -- Deve permanecer exatamente 1 (Paulo Gustavo)
   ```
4. **Homologação na Interface MK9 Date:**
   - Acessar a tela **Controle de Presença** no navegador.
   - Confirmar que o aviso de "Estruturas indisponíveis" desapareceu e que o painel exibe a versão operacional 9 sem falhas de conexão.

---

## 7. Procedimento de Contingência e Disaster Recovery

Caso ocorra um bloqueio intransponível ou impacto imprevisto em produção:

1. **Falha Durante a Janela de Execução:**  
   O script que falhou já estará desfeito pelo `ROLLBACK` atômico. Interromper a implantação; a aplicação continua operando com o fallback tolerante do frontend.
2. **Reversão Total para o Ponto de Partida:**  
   Recarregar o snapshot de dados prévio gerado na Fase 2:
   ```powershell
   # Restauração dos dados salvaguardados
   psql -h aws-0-sa-east-1.pooler.supabase.com -p 5432 -d postgres -U postgres.xzmbesqhxcnuokjwrbnw -f "supabase/backups/prod_backup_data_pre_attendance.sql"
   ```

