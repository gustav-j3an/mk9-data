# Relatório de Reconciliação do Histórico de Migrações

**Projeto:** MK9 Date  
**Data:** 19 de outubro de 2026  
**Auditor Responsável:** DBA PostgreSQL Sênior / Engenheiro DevOps  
**Documento:** `docs/qa/RECONCILIACAO_MIGRATIONS_PRESENCA.md`  

---

## 1. Diagnóstico do Histórico (Ledger Local vs. Ledger Remoto)

A inspeção do ledger no Supabase Cloud (`supabase_migrations.schema_migrations`) via `npx supabase migration list --linked` cruzada com os arquivos em `supabase/migrations/` e com as estruturas reais do banco revelou três causas fundamentais para a divergência:

1. **Truncamento de Timestamps no Histórico Legado Remoto:**  
   As migrações executadas em setembro e início de outubro de 2026 foram registradas no Supabase Cloud apenas com o prefixo da data (`YYYYMMDD` - ex: `20260930`, `20261006`, `20261007`, `20261008`). Localmente, existiam múltiplos arquivos para o mesmo dia. Isso faz com que a CLI do Supabase interprete as migrações subsequentes do mesmo dia como "locais não aplicadas", embora suas tabelas já existam em produção.
2. **Migrações Manuais ou Fora da CLI:**  
   Tabelas como `contratos_lojas` (`20261017120000`) já existem fisicamente no banco de produção (testado via API Supabase), porém a migration correspondente não consta registrada na tabela `schema_migrations`.
3. **Migrações Realmente Pendentes:**  
   - `20261018150000_add_data_inicio_operacao_to_industrias.sql`: Não aplicada e a coluna `data_inicio_operacao` comprovadamente **não existe** em `industrias`.
   - **As 9 migrações de presença** (`20261018220000` a `20261019013007`): Não aplicadas e nenhuma de suas tabelas (`promoter_work_schedules`, etc.) existe no Cloud.

---

## 2. Matriz Completa de Reconciliação

| Versão Local | Nome do Arquivo Local | Estado Remoto | Estrutura no Banco | Divergência | Ação Recomendada |
| :--- | :--- | :---: | :---: | :--- | :--- |
| `20260930` | `20260930_add_status_to_profiles.sql` | **Aplicada** | Existe (`profiles.status`) | Nenhuma | Manter intacto no ledger |
| `20260930` | `20260930_create_import_tables.sql` | Pendente no CLI | Tabelas existem | Prefixo repetido `20260930` | Não forçar push global |
| `20260930` | `20260930_create_profiles.sql` | Pendente no CLI | Tabela existe (`profiles`) | Prefixo repetido `20260930` | Não forçar push global |
| `20260930` | `20260930_update_rotas_structure.sql` | Pendente no CLI | Estrutura existe (`rotas`) | Prefixo repetido `20260930` | Não forçar push global |
| `20261001` | `20261001_create_visits_tables.sql` | **Aplicada** | Tabela existe (`visits`) | Nenhuma | Manter intacto no ledger |
| `20261006` | `20261006_add_visits_unique_constraint.sql` | **Aplicada** | Constraint existe | Nenhuma | Manter intacto no ledger |
| `20261006` | `20261006_harden_rbac_rls.sql` | Pendente no CLI | Políticas ativas | Prefixo repetido `20261006` | Não forçar push global |
| `20261006` | `20261006_harden_storage_visit_photos.sql` | Pendente no CLI | Storage configurado | Prefixo repetido `20261006` | Não forçar push global |
| `20261007` | `20261007_add_delete_user_function.sql` | **Aplicada** | Função existe | Nenhuma | Manter intacto no ledger |
| `20261007` | `20261007_allow_admin_insert_profiles.sql` | Pendente no CLI | Política existe | Prefixo repetido `20261007` | Não forçar push global |
| `20261007` | `20261007_create_visit_product_validity.sql` | Pendente no CLI | Tabela existe | Prefixo repetido `20261007` | Não forçar push global |
| `20261008` | `20261008_auto_generate_store_code.sql` | **Aplicada** | Função/trigger existe | Nenhuma | Manter intacto no ledger |
| `20261008` | `20261008_clean_legacy_duplicate_visits.sql` | Pendente no CLI | Script pontual executado | Prefixo repetido `20261008` | Não forçar push global |
| `20261008` | `20261008_create_notifications_table.sql` | Pendente no CLI | Tabela existe | Prefixo repetido `20261008` | Não forçar push global |
| `20261008` | `20261008_industry_client_access.sql` | Pendente no CLI | Views/acesso existem | Prefixo repetido `20261008` | Não forçar push global |
| `20261009144200` | `20261009144200_add_visits_unique_constraint.sql` | Pendente no CLI | Duplicata da constraint de 06/10 | Timestamp detalhado | Manter sem reaplicação |
| `20261010` | `20261010_create_system_settings_and_audit.sql` | Pendente no CLI | Tabela existe (`system_settings`) | Não registrada no ledger | Não forçar push global |
| `20261011120000` | `20261011120000_create_promoter_authorizations.sql` | Pendente no CLI | Tabela existe | Não registrada no ledger | Não forçar push global |
| `20261011140000` | `20261011140000_auto_generate_industry_code.sql` | Pendente no CLI | Trigger existe | Não registrada no ledger | Não forçar push global |
| `20261015100000` | `20261015100000_create_equipes_table.sql` | **Aplicada** | Tabela existe (`equipes`) | Nenhuma | Manter intacto no ledger |
| `20261016100000` | `20261016100000_create_supervisores_table.sql` | **Aplicada** | Tabela existe (`supervisores`) | Nenhuma | Última versão formal |
| `20261017120000` | `20261017120000_create_contratos_lojas_table.sql` | Pendente no CLI | Tabela já existe no Cloud | Executada fora do CLI | Registrar via repair quando autorizado |
| `20261017` | `20261017_create_avatars_storage_policies.sql` | Pendente no CLI | Bucket/política existem | Não registrada no ledger | Não forçar push global |
| `20261018150000` | `20261018150000_add_data_inicio_operacao_to_industrias.sql` | **Pendente Real** | Coluna NÃO existe em `industrias` | Não aplicada | Aplicar isoladamente sob autorização |
| `20261018220000` | `20261018220000_create_promoter_attendance_audit.sql` | **Pendente Real** | Tabela NÃO existe | Migração de Presença 1 | Aplicar na janela de presença |
| `20261018230000` | `20261018230000_create_promoter_schedules_and_absences.sql` | **Pendente Real** | Tabela NÃO existe | Migração de Presença 2 | Aplicar na janela de presença |
| `20261018232256` | `20261018232256_harden_attendance_audit_permissions.sql` | **Pendente Real** | Regras NÃO existem | Migração de Presença 3 | Aplicar na janela de presença |
| `20261018234153` | `20261018234153_finalize_attendance_journeys_privacy_telemetry.sql` | **Pendente Real** | Schema NÃO existe | Migração de Presença 4 | Aplicar na janela de presença |
| `20261019001109` | `20261019001109_lock_attendance_telemetry_and_scope.sql` | **Pendente Real** | Triggers NÃO existem | Migração de Presença 5 | Aplicar na janela de presença |
| `20261019001848` | `20261019001848_validate_attendance_schedule_overlaps.sql` | **Pendente Real** | Trigger NÃO existe | Migração de Presença 6 | Aplicar na janela de presença |
| `20261019004947` | `20261019004947_add_attendance_work_location.sql` | **Pendente Real** | Colunas NÃO existem | Migração de Presença 7 | Aplicar na janela de presença |
| `20261019011832` | `20261019011832_secure_attendance_photos_and_release_contract.sql` | **Pendente Real** | View/RLS NÃO existem | Migração de Presença 8 | Aplicar na janela de presença |
| `20261019013007` | `20261019013007_complete_attendance_operational_setup.sql` | **Pendente Real** | RPCs NÃO existem | Migração de Presença 9 | Aplicar na janela de presença |

---

## 3. Estratégia Recomendada de Reconciliação (Sem Riscos Operacionais)

> **REGRA DE OURO:** É proibido executar `supabase db push` ou `supabase migration up`. Esses comandos tentariam reexecutar scripts legados cujas tabelas já existem, gerando erros de concorrência ou duplicação.

### Procedimento Proposto:
1. **Não alterar migrations legadas:** Preservar todo o histórico anterior a `20261016100000`.
2. **Aplicação das Migrações de Presença via Execução Controlada:**
   As 9 migrações de presença possuem timestamps longos e sequenciais estritos (`20261018220000` a `20261019013007`). Elas devem ser aplicadas sequencialmente via SQL Editor do Supabase Cloud (ou script de migration direcionado).
3. **Registro Posterior no Ledger (Apenas após aplicação com sucesso):**
   Para cada migração aplicada com sucesso pelo SQL Editor, registrar a versão correspondente na tabela `supabase_migrations.schema_migrations` para manter o `npx supabase migration list --linked` perfeitamente sincronizado.

