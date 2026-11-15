# RC1.14 - Reconciliacao do ledger de migrations

Base da aplicacao: `f8df53b1ffd77ea255fda1c7a663946a0b25607c`.
Projeto comparado em leitura: homologacao `tafjceemuetqjyngresg`.

## Causa raiz

O checkout RC1 tinha quatro migrations de 2026-09-30 com a mesma versao de 8 digitos, outras colisoes nos dias 2026-10-06/07/08 e duas migrations com a versao `20261020160000`. A ordenacao lexical executava `add_status_to_profiles` antes de `create_profiles`, causando relacao inexistente. O harness anterior renumerava copias temporarias e nao representava o ledger persistido.

## Alinhamento

Os 43 arquivos M15 foram renomeados para as versoes ja registradas na homologacao. Os corpos SQL foram preservados; comparacao com as capturas homologadas foi igual apos remover BOM inicial e somente o terminador isolado `;` acrescentado pela captura. As quatro migrations M18 capturadas e presentes no ledger homologado foram incluidas em `supabase/migrations` para completar a sequencia. Nenhum conteudo ou versao M30/M37/M38 foi alterado.

| Versao/fonte RC1 | Migration | Versao alinhada |
|---|---|---|
| `20260930` | `20260930_create_import_tables.sql` | `20261027194528` |
| `20260930` | `20260930_create_profiles.sql` | `20261027194554` |
| `20260930` | `20260930_add_status_to_profiles.sql` | `20261027194557` |
| `20260930` | `20260930_update_rotas_structure.sql` | `20261027194600` |
| `20261001` | `20261001_create_visits_tables.sql` | `20261027194603` |
| `20261006` | `20261006_add_visits_unique_constraint.sql` | `20261027194606` |
| `20261006` | `20261006_harden_rbac_rls.sql` | `20261027194616` |
| `20261006` | `20261006_harden_storage_visit_photos.sql` | `20261027194620` |
| `20261007` | `20261007_add_delete_user_function.sql` | `20261027194624` |
| `20261007` | `20261007_allow_admin_insert_profiles.sql` | `20261027194627` |
| `20261007` | `20261007_create_visit_product_validity.sql` | `20261027194630` |
| `20261008` | `20261008_auto_generate_store_code.sql` | `20261027194639` |
| `20261008` | `20261008_clean_legacy_duplicate_visits.sql` | `20261027194646` |
| `20261008` | `20261008_create_notifications_table.sql` | `20261027194650` |
| `20261008` | `20261008_industry_client_access.sql` | `20261027194655` |
| `20261009144200` | `20261009144200_add_visits_unique_constraint.sql` | `20261027194658` |
| `20261010` | `20261010_create_system_settings_and_audit.sql` | `20261027194708` |
| `20261011120000` | `20261011120000_create_promoter_authorizations.sql` | `20261027194711` |
| `20261011140000` | `20261011140000_auto_generate_industry_code.sql` | `20261027194714` |
| `20261015100000` | `20261015100000_create_equipes_table.sql` | `20261027194718` |
| `20261016100000` | `20261016100000_create_supervisores_table.sql` | `20261027194722` |
| `20261017` | `20261017_create_avatars_storage_policies.sql` | `20261027194731` |
| `20261017120000` | `20261017120000_create_contratos_lojas_table.sql` | `20261027194734` |
| `20261018150000` | `20261018150000_add_data_inicio_operacao_to_industrias.sql` | `20261027194737` |
| `20261018220000` | `20261018220000_create_promoter_attendance_audit.sql` | `20261027194740` |
| `20261018230000` | `20261018230000_create_promoter_schedules_and_absences.sql` | `20261027194744` |
| `20261018232256` | `20261018232256_harden_attendance_audit_permissions.sql` | `20261027194754` |
| `20261018234153` | `20261018234153_finalize_attendance_journeys_privacy_telemetry.sql` | `20261027194801` |
| `20261018235500` | `20261018235500_soft_delete_fixed_routes.sql` | `20261027194805` |
| `20261019001109` | `20261019001109_lock_attendance_telemetry_and_scope.sql` | `20261027194808` |
| `20261019001848` | `20261019001848_validate_attendance_schedule_overlaps.sql` | `20261027194811` |
| `20261019004947` | `20261019004947_add_attendance_work_location.sql` | `20261027194819` |
| `20261019011832` | `20261019011832_secure_attendance_photos_and_release_contract.sql` | `20261027194822` |
| `20261019013007` | `20261019013007_complete_attendance_operational_setup.sql` | `20261027194825` |
| `20261019151754` | `20261019151754_mk9_rh_explicit_bindings.sql` | `20261027194904` |
| `20261019175853` | `20261019175853_mk9_rh_admin_binding_preparation.sql` | `20261027194914` |
| `20261020160000` | `20261020160000_add_whatsapp_group_link_to_industrias.sql` | `20261027194917` |
| `20261020160000` | `20261020160000_mk9_faltas_atestados_prepare_permission.sql` | `20261027194919` |
| `20261020170000` | `20261020170000_mk9_absence_records_outbox.sql` | `20261027194922` |
| `20261021100000` | `20261021100000_mk9_rh_reconciliation.sql` | `20261027194925` |
| `20261021120000` | `20261021120000_mk9_absence_attachments.sql` | `20261027194934` |
| `20261022152449` | `20261022152449_mk9_date_visit_regularization_and_checkin_scope.sql` | `20261027194937` |
| `20261023142837` | `20261023142837_promoter_scheduled_visit_actions.sql` | `20261027194940` |

## Divergencia mantida explicita

`20261030160000_minimal_visit_regularization.sql` nao tem versao correspondente no ledger remoto observado, embora objetos de regularizacao existam no schema. Ela foi preservada e sera aplicada apenas na instalacao descartavel. Nao marcar como aplicada nem enviar ao Supabase remoto sem reconciliar sua origem e equivalencia com o estado atual.

As quatro migrations M18 agora correspondem as versoes/names no ledger homologado. A lista remota contem 56 versoes: 43 M15, 4 M18, 2 M30, 4 M37 e 3 M38. As versoes M30/M37/M38 coincidem com as versoes dos arquivos RC1. A homologacao ja apresenta `pg_cron` 1.6.4 e o job M38 de expiracao a cada minuto.

## Limites

Esta alteracao nao aplica SQL remoto, nao repara o historico remoto e nao muda producao. O ledger remoto nao armazena hashes dos corpos das migrations; a comparacao usa os snapshots versionados disponiveis e a leitura de catalogo do projeto. A migration de regularizacao sem ledger e uma pendencia para implantacao futura.
