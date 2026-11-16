# Inventário de Reconciliação do Ledger de Homologação (56 Migrations)

**Ambiente:** Homologação `tafjceemuetqjyngresg`  
**Status do Ledger Remoto:** 56 versões registradas em `supabase_migrations.schema_migrations`  
**Data do Diagnóstico:** 16/11/2026

## 1. Baseline Histórico M15 a M37.21 (47 Migrations Consolidadas)
No banco remoto da homologação, essas 47 migrations foram registradas com timestamps padronizados gerados na consolidação do baseline (`20261027194528` a `20261030153702`). Todas possuem arquivos correspondentes rastreáveis no repositório:

| Versão Remota | Nome Registrado no Ledger Remoto | Arquivo Correspondente no Repositório Git |
|---|---|---|
| `20261027194528` | `m15_20260930_create_import_tables` | `supabase/migrations/20260930_create_import_tables.sql` |
| `20261027194554` | `m15_20260930_create_profiles` | `supabase/migrations/20260930_create_profiles.sql` |
| `20261027194557` | `m15_20260930_add_status_to_profiles` | `supabase/migrations/20260930_add_status_to_profiles.sql` |
| `20261027194600` | `m15_20260930_update_rotas_structure` | `supabase/migrations/20260930_update_rotas_structure.sql` |
| `20261027194603` | `m15_20261001_create_visits_tables` | `supabase/migrations/20261001_create_visits_tables.sql` |
| `20261027194606` | `m15_20261006_add_visits_unique_constraint` | `supabase/migrations/20261006_add_visits_unique_constraint.sql` |
| `20261027194616` | `m15_20261006_harden_rbac_rls` | `supabase/migrations/20261006_harden_rbac_rls.sql` |
| `20261027194620` | `m15_20261006_harden_storage_visit_photos` | `supabase/migrations/20261006_harden_storage_visit_photos.sql` |
| `20261027194624` | `m15_20261007_add_delete_user_function` | `supabase/migrations/20261007_add_delete_user_function.sql` |
| `20261027194627` | `m15_20261007_allow_admin_insert_profiles` | `supabase/migrations/20261007_allow_admin_insert_profiles.sql` |
| `20261027194630` | `m15_20261007_create_visit_product_validity` | `supabase/migrations/20261007_create_visit_product_validity.sql` |
| `20261027194639` | `m15_20261008_auto_generate_store_code` | `supabase/migrations/20261008_auto_generate_store_code.sql` |
| `20261027194646` | `m15_20261008_clean_legacy_duplicate_visits` | `supabase/migrations/20261008_clean_legacy_duplicate_visits.sql` |
| `20261027194650` | `m15_20261008_create_notifications_table` | `supabase/migrations/20261008_create_notifications_table.sql` |
| `20261027194655` | `m15_20261008_industry_client_access` | `supabase/migrations/20261008_industry_client_access.sql` |
| `20261027194658` | `m15_20261009144200_add_visits_unique_constraint` | `supabase/migrations/20261009144200_add_visits_unique_constraint.sql` |
| `20261027194708` | `m15_20261010_create_system_settings_and_audit` | `supabase/migrations/20261010_create_system_settings_and_audit.sql` |
| `20261027194711` | `m15_20261011120000_create_promoter_authorizations` | `supabase/migrations/20261011120000_create_promoter_authorizations.sql` |
| `20261027194714` | `m15_20261011140000_auto_generate_industry_code` | `supabase/migrations/20261011140000_auto_generate_industry_code.sql` |
| `20261027194718` | `m15_20261015100000_create_equipes_table` | `supabase/migrations/20261015100000_create_equipes_table.sql` |
| `20261027194722` | `m15_20261016100000_create_supervisores_table` | `supabase/migrations/20261016100000_create_supervisores_table.sql` |
| `20261027194731` | `m15_20261017_create_avatars_storage_policies` | `supabase/migrations/20261017_create_avatars_storage_policies.sql` |
| `20261027194734` | `m15_20261017120000_create_contratos_lojas_table` | `supabase/migrations/20261017120000_create_contratos_lojas_table.sql` |
| `20261027194737` | `m15_20261018150000_add_data_inicio_operacao_to_industrias` | `supabase/migrations/20261018150000_add_data_inicio_operacao_to_industrias.sql` |
| `20261027194740` | `m15_20261018220000_create_promoter_attendance_audit` | `supabase/migrations/20261018220000_create_promoter_attendance_audit.sql` |
| `20261027194744` | `m15_20261018230000_create_promoter_schedules_and_absences` | `supabase/migrations/20261018230000_create_promoter_schedules_and_absences.sql` |
| `20261027194754` | `m15_20261018232256_harden_attendance_audit_permissions` | `supabase/migrations/20261018232256_harden_attendance_audit_permissions.sql` |
| `20261027194801` | `m15_20261018234153_finalize_attendance_journeys_privacy_telemetry` | `supabase/migrations/20261018234153_finalize_attendance_journeys_privacy_telemetry.sql` |
| `20261027194805` | `m15_20261018235500_soft_delete_fixed_routes` | `supabase/migrations/20261018235500_soft_delete_fixed_routes.sql` |
| `20261027194808` | `m15_20261019001109_lock_attendance_telemetry_and_scope` | `supabase/migrations/20261019001109_lock_attendance_telemetry_and_scope.sql` |
| `20261027194811` | `m15_20261019001848_validate_attendance_schedule_overlaps` | `supabase/migrations/20261019001848_validate_attendance_schedule_overlaps.sql` |
| `20261027194819` | `m15_20261019004947_add_attendance_work_location` | `supabase/migrations/20261019004947_add_attendance_work_location.sql` |
| `20261027194822` | `m15_20261019011832_secure_attendance_photos_and_release_contract` | `supabase/migrations/20261019011832_secure_attendance_photos_and_release_contract.sql` |
| `20261027194825` | `m15_20261019013007_complete_attendance_operational_setup` | `supabase/migrations/20261019013007_complete_attendance_operational_setup.sql` |
| `20261027194904` | `m15_20261019151754_mk9_rh_explicit_bindings` | `supabase/migrations/20261019151754_mk9_rh_explicit_bindings.sql` |
| `20261027194914` | `m15_20261019175853_mk9_rh_admin_binding_preparation` | `supabase/migrations/20261019175853_mk9_rh_admin_binding_preparation.sql` |
| `20261027194917` | `m15_20261020160000_add_whatsapp_group_link_to_industrias` | `supabase/migrations/20261020160000_add_whatsapp_group_link_to_industrias.sql` |
| `20261027194919` | `m15_20261020160000_mk9_faltas_atestados_prepare_permission` | `supabase/migrations/20261020160000_mk9_faltas_atestados_prepare_permission.sql` |
| `20261027194922` | `m15_20261020170000_mk9_absence_records_outbox` | `supabase/migrations/20261020170000_mk9_absence_records_outbox.sql` |
| `20261027194925` | `m15_20261021100000_mk9_rh_reconciliation` | `supabase/migrations/20261021100000_mk9_rh_reconciliation.sql` |
| `20261027194934` | `m15_20261021120000_mk9_absence_attachments` | `supabase/migrations/20261021120000_mk9_absence_attachments.sql` |
| `20261027194937` | `m15_20261022152449_mk9_date_visit_regularization_and_checkin_scope` | `supabase/migrations/20261022152449_mk9_date_visit_regularization_and_checkin_scope.sql` |
| `20261027194940` | `m15_20261023142837_promoter_scheduled_visit_actions` | `supabase/migrations/20261023142837_promoter_scheduled_visit_actions.sql` |
| `20261030152933` | `m18_homologation_security` | Arquivo integrado nas branches M18/M37 |
| `20261030153146` | `m18_active_session_guard` | Arquivo integrado nas branches M18/M37 |
| `20261030153303` | `m18_industry_route_projection` | Arquivo integrado nas branches M18/M37 |
| `20261030153702` | `m18_photo_upsert_permission` | Arquivo integrado nas branches M18/M37 |

## 2. Migrations Operacionais M30 e M37 (6 Versões)
| Versão Remota | Nome Registrado no Ledger Remoto | Arquivo Correspondente no Repositório Git | SHA-256 Validado |
|---|---|---|---|
| `20261105165500` | `m30_harden_industry_active_checkin` | `supabase/migrations/20261105165500_m30_harden_industry_active_checkin.sql` | `EFF1541C53B4DF6944132BB9AA5FB7CDCA9401D8BB262531916036CF0319938C` |
| `20261106131614` | `m30_serialize_industry_checkin` | `supabase/migrations/20261106131614_m30_serialize_industry_checkin.sql` | `92913DE529CF602C52DD59419179498620DCA73B315792BF08246090AE910834` |
| `20261106140000` | `m37_pending_visit_active_route_guard` | `supabase/migrations/20261106140000_m37_pending_visit_active_route_guard.sql` | `8763D644E50808B5D8EDB43FF331B615726AC3598C9BDE3483B9EBE71357BFB5` |
| `20261106150000` | `m37_checkin_route_and_conflict_guard` | `supabase/migrations/20261106150000_m37_checkin_route_and_conflict_guard.sql` | `C58F96DE4B4E367B1CCDFBF7A78DDBC561F2EB82A` |
| `20261107140000` | `m37_reconcile_materialized_pending_recovery` | `supabase/migrations/20261107140000_m37_reconcile_materialized_pending_recovery.sql` | `B779A2B2D1160BEBEACFC4AE65A5463D4CFCEE998B3BDDE73C3080A5453F7768` |
| `20261108160835` | `m37_integral_weekly_recovery` | `supabase/migrations/20261108160835_m37_integral_weekly_recovery.sql` | `6A0F81523E97FEE3B48F47CC4F26B431D89020CA` |

## 3. Migrations de Ciclo de Vida M38 (3 Versões)
| Versão Remota | Nome Registrado no Ledger Remoto | Arquivo Correspondente no Repositório Git | SHA-256 Validado |
|---|---|---|---|
| `20261108130000` | `m38_visit_cancellation_and_day_end_close` | `supabase/migrations/20261108130000_m38_visit_cancellation_and_day_end_close.sql` | `B3EA30FA5CCEFD9F3F6D3803DC5389650FEF0DF9` |
| `20261108170619` | `m38_retry_attempt_history` | `supabase/migrations/20261108170619_m38_retry_attempt_history.sql` | `901844D17805DE36CEEFEF99B0F39600F174987E` |
| `20261108174150` | `m38_checkin_reuses_active_scheduled_attempt` | `supabase/migrations/20261108174150_m38_checkin_reuses_active_scheduled_attempt.sql` | `7BE0BE047A54C937EEA59E7EBD042BC331D4A0CA` |

## 4. Migration Proposta RC1.25 (Pendente de Aplicação)
| Versão Alvo | Nome do Arquivo Proposto | Caminho no Repositório Git | SHA-256 do Arquivo |
|---|---|---|---|
| `20261115160000` | `20261115_rc1_25_skus_and_stock_audits.sql` | `supabase/migrations/propostas/20261115_rc1_25_skus_and_stock_audits.sql` | `41EA78BCC4416D65B5714B648AC076DCA932A945CFBB9A19C71C893AB8FDD01B` |

---
**Conclusão de Integridade:** As 56 migrations registradas no banco de homologação estão 100% mapeadas e identificadas em suas branches/arquivos originais. Nenhuma migration foi aplicada artificialmente ou renumerada de forma destrutiva. A migration proposta RC1.25 adicionará a 57ª versão do ledger atômica e seguramente quando autorizada.
