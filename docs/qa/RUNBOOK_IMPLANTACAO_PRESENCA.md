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

## 5. Roteiro Passo a Passo de Execucao Supervisionada

### Passo 1: Execucao Sequencial e Granular das Migracoes no Supabase Cloud
No **SQL Editor** do projeto `xzmbesqhxcnuokjwrbnw` (ou via runner controlado), executar as migrations estritamente uma a uma em ordem deterministica.
- Cada migration deve ser executada dentro de sua propria transacao atomica (`BEGIN; ... COMMIT;`) quando compativel com DDL transacional, acompanhada de `lock_timeout = '3s'` e `statement_timeout = '60s'`.
- O registro correspondente no ledger (`supabase_migrations.schema_migrations`) deve ser efetuado atomicamente dentro do mesmo bloco da migration.
- **Criterio de Parada Imediata:** Diante de qualquer erro retornado pelo banco, **a execucao e interrompida imediatamente** no ponto exato da falha. Nao avancar para os scripts seguintes.

### Passo 2: Diagnostico e Compensacao Pontual (Sem Rollback Automatico de Shell)
- O encerramento do script ou do shell (`set -e`) apenas interrompe o processo cliente; **nao desfaz retroativamente alteracoes ja comitadas em transacoes anteriores**.
- Como cada migration aprovada comitou atomicamente, o banco permanece no estado estavel da ultima migracao bem-sucedida.
- O operador deve diagnosticar o erro na migration que falhou e aplicar uma **compensacao direcionada** (ajuste pontual de dados ou constraint bloqueante) para possibilitar a retomada segura, sem acionar restauracao destrutiva do banco inteiro.

### Passo 3: Recarga do Cache da API do PostgREST
Executar no SQL Editor:
```sql
NOTIFY pgrst, 'reload schema';
```

---

## 6. Procedimento de Validacao Pos-Implantacao

Apos a conclusao da implantacao, executar as seguintes verificacoes de integridade:

1. **Checagem de Tabelas e Schema Privado:**
   ```sql
   SELECT table_schema, table_name FROM information_schema.tables 
   WHERE table_schema IN ('public', 'attendance_private') AND table_name LIKE '%attendance%'
   ORDER BY table_schema, table_name;
   ```
2. **Confirmacao do Bloqueio de Faltas Automaticas:**
   ```sql
   SELECT key, value FROM public.system_settings WHERE key = 'attendance_rules';
   ```
   *Criterio de Sucesso:* `automatic_absence_approved` deve ser `false` (ou nulo) e nao pode haver fechamento automatico de ponto.
3. **Validacao da Quantidade de Promotores e Equipes:**
   ```sql
   SELECT count(*) FROM public.promotores; -- Deve permanecer exatamente 44
   SELECT count(*) FROM public.equipes;    -- Deve permanecer exatamente 1 (Brasilia)
   SELECT count(*) FROM public.supervisores; -- Deve permanecer exatamente 1 (Paulo Gustavo)
   ```
4. **Homologacao na Interface MK9 Date:**
   - Acessar a tela **Controle de Presenca** no navegador.
   - Confirmar que o aviso de "Estruturas indisponiveis" desapareceu e que o painel exibe a versao operacional 9 sem falhas de conexao.

---

## 7. Procedimento de Contingencia e Disaster Recovery

Caso ocorra um bloqueio intransponivel ou impacto imprevisto em producao:

1. **Falha Durante a Janela de Execucao:**  
   O script que falhou sofrera `ROLLBACK` atomico dentro de sua propria transacao, mantendo as migracoes anteriores ja comitadas intactas. A implantacao e interrompida imediatamente. Nao presumir que `set -e` reverta o banco automaticamente.
2. **Avaliacao de Compensacao Pontual:**  
   Antes de considerar qualquer restauracao, deve-se avaliar se uma intervencao direcionada (script de reversao ou ajuste cirurgico da migracao afetada) resolve a inconsistencia, preservando integralmente os dados operacionais do banco.
3. **Procedimento Excepcional de Disaster Recovery (Restauracao de Snapshot):**  
   - **Alerta Critico de Perda de Dados:** A restauracao de um snapshot de dados do momento T0 sobrescreve a base e **descarta irrevogavelmente todas as alteracoes operacionais ocorridas apos T0** (check-ins, check-outs, fotos, registros de presenca e atualizacoes de rotas).
   - A restauracao de snapshot **e estritamente proibida como resposta automatica padrao**.
   - Ela so podera ser acionada em caso de **corrupcao estrutural irrecuperavel do catalogo do banco**, mediante:
     a) Congelamento total e previo do trafego da aplicacao;
     b) Comunicacao formal previa ao administrador informando a perda potencial dos dados operacionais gerados apos T0;
     c) **Autorizacao explicita e documentada do administrador** para a restauracao destrutiva.


## 8. Disponibilização do workflow protegido de ensaio

A inclusão do workflow no branch de integração não o disponibiliza para workflow_dispatch; ele deve ser publicado no default branch por PR específico e aprovado conforme as proteções existentes. Consulte docs/qa/REAL_BACKUP_REHEARSAL_RELEASE.md para o procedimento restrito: diff limitado ao workflow, SHA integral aprovado pelo Copilot fixado explicitamente, sem merge de código do produto. O workflow candidato permanece fail-closed enquanto PENDING_COPILOT_REVIEW não for substituído após auditoria. A configuração do Environment production-backup, incluindo aprovador independente e bloqueio de autoaprovação, deve ser verificada pelo administrador antes do dispatch; este runbook não altera segredos nem regras do Environment.
