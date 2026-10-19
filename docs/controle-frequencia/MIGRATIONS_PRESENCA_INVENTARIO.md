# Invent?rio de migrations ? Presen?a

Invent?rio do diret?rio raiz comparado com o hist?rico remoto somente de leitura observado nesta auditoria. N?o equivale a autoriza??o de implanta??o. Arquivos em subdiret?rios/propostas n?o integram esta sequ?ncia.

| Arquivo | Situa??o |
| --- | --- |
| `20260930_add_status_to_profiles.sql` | Consta no hist?rico remoto observado |
| `20260930_create_import_tables.sql` | Hist?rico remoto insuficiente; reconciliar esquema e vers?o antes de aplicar |
| `20260930_create_profiles.sql` | Hist?rico remoto insuficiente; reconciliar esquema e vers?o antes de aplicar |
| `20260930_update_rotas_structure.sql` | Hist?rico remoto insuficiente; reconciliar esquema e vers?o antes de aplicar |
| `20261001_create_visits_tables.sql` | Consta no hist?rico remoto observado |
| `20261006_add_visits_unique_constraint.sql` | Consta no hist?rico remoto observado |
| `20261006_harden_rbac_rls.sql` | Hist?rico remoto insuficiente; reconciliar esquema e vers?o antes de aplicar |
| `20261006_harden_storage_visit_photos.sql` | Hist?rico remoto insuficiente; reconciliar esquema e vers?o antes de aplicar |
| `20261007_add_delete_user_function.sql` | Consta no hist?rico remoto observado |
| `20261007_allow_admin_insert_profiles.sql` | Hist?rico remoto insuficiente; reconciliar esquema e vers?o antes de aplicar |
| `20261007_create_visit_product_validity.sql` | Hist?rico remoto insuficiente; reconciliar esquema e vers?o antes de aplicar |
| `20261008_auto_generate_store_code.sql` | Consta no hist?rico remoto observado |
| `20261008_clean_legacy_duplicate_visits.sql` | Hist?rico remoto insuficiente; reconciliar esquema e vers?o antes de aplicar |
| `20261008_create_notifications_table.sql` | Hist?rico remoto insuficiente; reconciliar esquema e vers?o antes de aplicar |
| `20261008_industry_client_access.sql` | Hist?rico remoto insuficiente; reconciliar esquema e vers?o antes de aplicar |
| `20261009144200_add_visits_unique_constraint.sql` | Hist?rico remoto insuficiente; reconciliar esquema e vers?o antes de aplicar |
| `20261010_create_system_settings_and_audit.sql` | Hist?rico remoto insuficiente; reconciliar esquema e vers?o antes de aplicar |
| `20261011120000_create_promoter_authorizations.sql` | Hist?rico remoto insuficiente; reconciliar esquema e vers?o antes de aplicar |
| `20261011140000_auto_generate_industry_code.sql` | Hist?rico remoto insuficiente; reconciliar esquema e vers?o antes de aplicar |
| `20261015100000_create_equipes_table.sql` | Consta no hist?rico remoto observado |
| `20261016100000_create_supervisores_table.sql` | Consta no hist?rico remoto observado |
| `20261017120000_create_contratos_lojas_table.sql` | Hist?rico remoto insuficiente; reconciliar esquema e vers?o antes de aplicar |
| `20261017_create_avatars_storage_policies.sql` | Hist?rico remoto insuficiente; reconciliar esquema e vers?o antes de aplicar |
| `20261018150000_add_data_inicio_operacao_to_industrias.sql` | Hist?rico remoto insuficiente; reconciliar esquema e vers?o antes de aplicar |
| `20261018220000_create_promoter_attendance_audit.sql` | Preparada; aplicada somente no Docker local; pendente no remoto |
| `20261018230000_create_promoter_schedules_and_absences.sql` | Preparada; aplicada somente no Docker local; pendente no remoto |
| `20261018232256_harden_attendance_audit_permissions.sql` | Preparada; aplicada somente no Docker local; pendente no remoto |
| `20261018234153_finalize_attendance_journeys_privacy_telemetry.sql` | Preparada; aplicada somente no Docker local; pendente no remoto |
| `20261019001109_lock_attendance_telemetry_and_scope.sql` | Preparada; aplicada somente no Docker local; pendente no remoto |
| `20261019001848_validate_attendance_schedule_overlaps.sql` | Preparada; aplicada somente no Docker local; pendente no remoto |
| `20261019004947_add_attendance_work_location.sql` | Preparada; aplicada somente no Docker local; pendente no remoto |

## Ordem das sete migrations de presen?a

1. `20261018220000_create_promoter_attendance_audit.sql`
2. `20261018230000_create_promoter_schedules_and_absences.sql`
3. `20261018232256_harden_attendance_audit_permissions.sql`
4. `20261018234153_finalize_attendance_journeys_privacy_telemetry.sql`
5. `20261019001109_lock_attendance_telemetry_and_scope.sql`
6. `20261019001848_validate_attendance_schedule_overlaps.sql`
7. `20261019004947_add_attendance_work_location.sql`

Dependem das estruturas existentes de profiles/promotores/visits/system_settings, equipes/supervisores, tabelas filhas de evid?ncias e Storage. Cada migration de presen?a depende das anteriores; a ?ltima usa a fun??o movida para o schema privado. A base local recebeu os pr?-requisitos existentes de equipes/supervisores. N?o foi comprovado replay integral de toda a hist?ria legada em base vazia.

H? vers?es curtas repetidas no legado e objetos existentes sem correspond?ncia completa no ledger. N?o executar `db push` ?s cegas nem marcar migrations reparadas sem comparar defini??es reais. O segundo arquivo de constraint de visitas tamb?m exige concilia??o, n?o aplica??o autom?tica.

## Implanta??o e recupera??o

As sete migrations n?o apagam tabelas/dados; alteram policies, constraints, fun??es e permiss?es. Isso muda contratos: frontend antigo que grava telemetria diretamente ter? a opera??o bloqueada. Planejar atualiza??o coordenada de banco e frontend, janela de manuten??o e verifica??o de perfis/escopos.

Antes de implanta??o autorizada: backup verific?vel, ensaio de restaura??o, revis?o de diverg?ncias e execu??o dos testes de seguran?a em staging. O backup Docker local teve somente cat?logo validado; isso n?o comprova recupera??o integral.

Preferir corre??o progressiva por nova migration. N?o desfazer RLS/imutabilidade para restaurar clientes antigos; preservar auditoria e telemetria. Em incidente, bloquear grava??es, corrigir contrato e validar seguran?a antes de reabrir. Nenhum rollback destrutivo foi preparado ou executado.
