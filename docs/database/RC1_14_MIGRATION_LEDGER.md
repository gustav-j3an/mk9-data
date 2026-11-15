# RC1.14 ? Reconcilia??o do ledger de migrations

Base da aplica??o: `f8df53b1ffd77ea255fda1c7a663946a0b25607c`.
Projeto comparado por leitura: homologa??o `tafjceemuetqjyngresg`.

## Causa raiz

O checkout RC1 tinha quatro migrations de 2026-09-30 com a mesma vers?o de 8 d?gitos, outras colis?es entre migrations de 2026-10-06/07/08 e duas migrations com a vers?o `20261020160000`. A ordena??o lexical executava `add_status_to_profiles` antes de `create_profiles`, causando falha de rela??o inexistente. O harness anterior renumerava c?pias tempor?rias e n?o representava o ledger persistido.

## Alinhamento

Os 43 arquivos M15 foram renomeados para as vers?es j? registradas na homologa??o. Os corpos SQL foram preservados; compara??o com as capturas homologadas foi igual ap?s remover BOM inicial e somente o terminador isolado `;` acrescentado pela captura. As quatro migrations M18 capturadas e presentes no ledger homologado foram inclu?das em `supabase/migrations` para completar a sequ?ncia. Nenhuma migration M30/M37/M38 teve seu conte?do ou vers?o alterados.

| Vers?o/fonte RC1 | Migration | Vers?o alinhada |
|---|---|---|
| `20260930` | `m15_20260930_create_import_tables.sql` | `20261027194528` |
| `20260930` | `m15_20260930_create_profiles.sql` | `20261027194554` |
| `20260930` | `m15_20260930_add_status_to_profiles.sql` | `20261027194557` |
| `20260930` | `m15_20260930_update_rotas_structure.sql` | `20261027194600` |
| `20261001` | `m15_20261001_create_visits_tables.sql` | `20261027194603` |
| `20261006` | `m15_20261006_add_visits_unique_constraint.sql` | `20261027194606` |
| `20261006` | `m15_20261006_harden_rbac_rls.sql` | `20261027194616` |
| `20261006` | `m15_20261006_harden_storage_visit_photos.sql` | `20261027194620` |
| `20261007` | `m15_20261007_add_delete_user_function.sql` | `20261027194624` |
| `20261007` | `m15_20261007_allow_admin_insert_profiles.sql` | `20261027194627` |
| `20261007` | `m15_20261007_create_visit_product_validity.sql` | `20261027194630` |
| `20261008` | `m15_20261008_auto_generate_store_code.sql` | `20261027194639` |
| `20261008` | `m15_20261008_clean_legacy_duplicate_visits.sql` | `20261027194646` |
| `20261008` | `m15_20261008_create_notifications_table.sql` | `20261027194650` |
| `20261008` | `m15_20261008_industry_client_access.sql` | `20261027194655` |
| `20261009144200` | `m15_20261009144200_add_visits_unique_constraint.sql` | `20261027194658` |
| `20261010` | `m15_20261010_create_system_settings_and_audit.sql` | `20261027194708` |
| `20261011120000` | `m15_20261011120000_create_promoter_authorizations.sql` | `20261027194711` |
| `20261011140000` | `m15_20261011140000_auto_generate_industry_code.sql` | `20261027194714` |
| `20261015100000` | `m15_20261015100000_create_equipes_table.sql` | `20261027194718` |
| `20261016100000` | `m15_20261016100000_create_supervisores_table.sql` | `20261027194722` |
| `20261017` | `m15_20261017_create_avatars_storage_policies.sql` | `20261027194731` |
| `20261017120000` | `m15_20261017120000_create_contratos_lojas_table.sql` | `20261027194734` |
| `20261018150000` | `m15_20261018150000_add_data_inicio_operacao_to_industrias.sql` | `20261027194737` |
| `20261018220000` | `m15_20261018220000_create_promoter_attendance_audit.sql` | `20261027194740` |
| `20261018230000` | `m15_20261018230000_create_promoter_schedules_and_absences.sql` | `20261027194744` |
| `20261018232256` | `m15_20261018232256_harden_attendance_audit_permissions.sql` | `20261027194754` |
| `20261018234153` | `m15_20261018234153_finalize_attendance_journeys_privacy_telemetry.sql` | `20261027194801` |
| `20261018235500` | `m15_20261018235500_soft_delete_fixed_routes.sql` | `20261027194805` |
| `20261019001109` | `m15_20261019001109_lock_attendance_telemetry_and_scope.sql` | `20261027194808` |
| `20261019001848` | `m15_20261019001848_validate_attendance_schedule_overlaps.sql` | `20261027194811` |
| `20261019004947` | `m15_20261019004947_add_attendance_work_location.sql` | `20261027194819` |
| `20261019011832` | `m15_20261019011832_secure_attendance_photos_and_release_contract.sql` | `20261027194822` |
| `20261019013007` | `m15_20261019013007_complete_attendance_operational_setup.sql` | `20261027194825` |
| `20261019151754` | `m15_20261019151754_mk9_rh_explicit_bindings.sql` | `20261027194904` |
| `20261019175853` | `m15_20261019175853_mk9_rh_admin_binding_preparation.sql` | `20261027194914` |
| `20261020160000` | `m15_20261020160000_add_whatsapp_group_link_to_industrias.sql` | `20261027194917` |
| `20261020160000` | `m15_20261020160000_mk9_faltas_atestados_prepare_permission.sql` | `20261027194919` |
| `20261020170000` | `m15_20261020170000_mk9_absence_records_outbox.sql` | `20261027194922` |
| `20261021100000` | `m15_20261021100000_mk9_rh_reconciliation.sql` | `20261027194925` |
| `20261021120000` | `m15_20261021120000_mk9_absence_attachments.sql` | `20261027194934` |
| `20261022152449` | `m15_20261022152449_mk9_date_visit_regularization_and_checkin_scope.sql` | `20261027194937` |
| `20261023142837` | `m15_20261023142837_promoter_scheduled_visit_actions.sql` | `20261027194940` |

## Diverg?ncia que permanece expl?cita

`20261030160000_minimal_visit_regularization.sql` n?o tem vers?o correspondente no ledger remoto observado, embora objetos equivalentes de regulariza??o existam no schema. Ela foi preservada e ser? aplicada apenas na instala??o descart?vel. N?o marcar como aplicada nem enviar ao Supabase remoto sem reconciliar sua origem e equival?ncia com o estado atual.

As quatro migrations M18 agora correspondem a vers?es/name no ledger homologado. A lista remota cont?m 56 vers?es: 43 M15, 4 M18, 2 M30, 4 M37 e 3 M38. As vers?es M30/M37/M38 coincidem com as vers?es dos arquivos RC1. A homologa??o j? apresenta `pg_cron` 1.6.4 e o job M38 de expira??o em frequ?ncia de 1 minuto.

## Limites

Esta altera??o n?o aplica SQL remoto, n?o repara o hist?rico remoto e n?o muda produ??o. O ledger remoto n?o armazena hashes dos corpos das migrations; a compara??o local usa os snapshots versionados dispon?veis, al?m da leitura de cat?logo do projeto. A migration de regulariza??o sem ledger ? uma pend?ncia para uma implanta??o futura.
