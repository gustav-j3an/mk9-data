# Inventário Canônico e Reconciliação do Ledger de Homologação (56 Migrations)

**Ambiente:** Supabase Homologação `tafjceemuetqjyngresg`  
**Total de Versões Registradas:** 56 versões em `supabase_migrations.schema_migrations`  
**PostgreSQL:** 17.x  
**Data da Auditoria:** 16/11/2026

---

## 1. Baseline Canônico M15 a M37.21 (47 Migrations Consolidadas)
Recuperadas via `supabase migration fetch --remote=tafjceemuetqjyngresg` e auditadas em `docs/m37.21-fetched-migrations-inventory.md`:

| # | Versão Remota | Nome do Arquivo no Repositório Git | SHA-256 (64 caracteres) | Dependência Principal |
|---|---|---|---|---|
| 1 | `20261027194528` | `supabase/migrations/20260930_create_import_tables.sql` | `9B80F707332484C58ED9BC8A13E035E1B2C3B758C99F30997BDB55300B38A57D` | Inicial |
| 2 | `20261027194554` | `supabase/migrations/20260930_create_profiles.sql` | `17CB7930FB7F167C1AB9697809C2EE01C19EF6777ED99D9ED01FED0622B8B622` | Auth / Users |
| 3 | `20261027194557` | `supabase/migrations/20260930_add_status_to_profiles.sql` | `6A91F843E05C7FF6A71DCD46DCFA1555DD4D6CF80B20070D6EB5E644B285BCD0` | Profiles |
| 4 | `20261027194600` | `supabase/migrations/20260930_update_rotas_structure.sql` | `D98C80150A12DDA7F22FA14F062FEAAD6139240B6A3A1BAFFBC297F42C08066F` | Rotas |
| 5 | `20261027194603` | `supabase/migrations/20261001_create_visits_tables.sql` | `E5D45FA783E15B1EDCE053EED6CA2682D71CA02DB70F0514CD44D052881B71C7` | Rotas / Profiles |
| 6 | `20261027194606` | `supabase/migrations/20261006_add_visits_unique_constraint.sql` | `614FC86D0F4F8F180C887D37726AF8C816E461638DB9F744F8246FBA61F9BA79` | Visits |
| 7 | `20261027194616` | `supabase/migrations/20261006_harden_rbac_rls.sql` | `6B360690E59BDA17BB4650E55F9FC704AF34D1E497F1CA18B7EF3B8407A973B6` | RLS Geral |
| 8 | `20261027194620` | `supabase/migrations/20261006_harden_storage_visit_photos.sql` | `5F071F17BD0598E73797D9D55DD3DFDE63D3282D51E9ABD52812A418369429C2` | Storage |
| 9 | `20261027194624` | `supabase/migrations/20261007_add_delete_user_function.sql` | `F2A5E49172453D5FC8D142983B4FD265B5A7C3293875B3A0F0A769B2751A58E3` | Auth Admin |
| 10 | `20261027194627` | `supabase/migrations/20261007_allow_admin_insert_profiles.sql` | `B8BA4E0DFD2BB14D9929A046DB704B3123BCA5C8AE64387DE7CA6BA919FC2E22` | Profiles |
| 11 | `20261027194630` | `supabase/migrations/20261007_create_visit_product_validity.sql` | `9F5F5E51A35E5C43E05D8A4B16BA0941C0E48C4D3AEA45B22BCCA3AA4EB62C71` | Visits |
| 12 | `20261027194639` | `supabase/migrations/20261008_auto_generate_store_code.sql` | `DE0BBC25493982A608D38A5DF3A61803FB24231F00E9CDA4DF5756922CDBDF6A` | Lojas |
| 13 | `20261027194646` | `supabase/migrations/20261008_clean_legacy_duplicate_visits.sql` | `A5DD98343084736D48349F40F683448F99C2FC1A270B1276F1F4BE74F67AFF2C` | Visits |
| 14 | `20261027194650` | `supabase/migrations/20261008_create_notifications_table.sql` | `5BD0BB6ECD14817D2420679370173EB8587553579C557B18D63FD0202F1C26A5` | Notifications |
| 15 | `20261027194655` | `supabase/migrations/20261008_industry_client_access.sql` | `4814B692759A250C53875760E9AAF2A3A8E71866685F9081A32C54D64C79FE95` | RBAC Indústria |
| 16 | `20261027194658` | `supabase/migrations/20261009144200_add_visits_unique_constraint.sql` | `AA0915ACDA7CFFF72761CC0C58C4ED6AF19FB963DCEC20CED46A5A9407D4C95B` | Visits |
| 17 | `20261027194708` | `supabase/migrations/20261010_create_system_settings_and_audit.sql` | `9526D8F6ECF32A72580F392274CEC8F7519A75661091DD084F920DBA12A7B843` | Audit |
| 18 | `20261027194711` | `supabase/migrations/20261011120000_create_promoter_authorizations.sql` | `E06A0D6529F40B32D5112EFC4062EB5FF87F6577DF9FA14BD5E8ED259D63207D` | Authorizations |
| 19 | `20261027194714` | `supabase/migrations/20261011140000_auto_generate_industry_code.sql` | `2FFEEAA8D9BB90BAA3237B3B45A29926AFE865D925620D88AB6852BDE6E01FDF` | Indústrias |
| 20 | `20261027194718` | `supabase/migrations/20261015100000_create_equipes_table.sql` | `3384D9996BF08FE95B2806E6D5F9668E48FE3E5ED262D68005A1F3FE0E895CB1` | Equipes |
| 21 | `20261027194722` | `supabase/migrations/20261016100000_create_supervisores_table.sql` | `641F7F21281068C78AB7A44EF5315F81E7C21BED3FC98AC43408E6F5CEC64707` | Supervisores |
| 22 | `20261027194731` | `supabase/migrations/20261017_create_avatars_storage_policies.sql` | `9D818860117722A9D1B537293099C82ABBD9BC5EDBB1586AE951992E2BB1FF02` | Storage |
| 23 | `20261027194734` | `supabase/migrations/20261017120000_create_contratos_lojas_table.sql` | `97DC6C97583AA1160E24E2206E7AD1DDF8E8C7C92D6AFD527219565AC6BC0727` | Contratos |
| 24 | `20261027194737` | `supabase/migrations/20261018150000_add_data_inicio_operacao_to_industrias.sql` | `1FF86F618FE195186EAD6D584851DDE8ADF9F7B8D63020C76EDE95CC0CD7F383` | Indústrias |
| 25 | `20261027194740` | `supabase/migrations/20261018220000_create_promoter_attendance_audit.sql` | `98D3D372676CD412D2E8EE48939E847EE9096E63FED1C7CF857AF4F0D08F5915` | Frequência |
| 26 | `20261027194744` | `supabase/migrations/20261018230000_create_promoter_schedules_and_absences.sql` | `30F25CBCD91B9057D90D56EE15E765B5BC398A5F37F2A43204DDA207A47F0D34` | Faltas/Escalas |
| 27 | `20261027194754` | `supabase/migrations/20261018232256_harden_attendance_audit_permissions.sql` | `117DC6BC3D5555F9D4DE58918BC330393A54F6125520E402F37141AF80ABC78D` | Permissões |
| 28 | `20261027194801` | `supabase/migrations/20261018234153_finalize_attendance_journeys_privacy_telemetry.sql` | `8DD8E45D5161262B5F3021C9BD9567A7D32FE7168704213B769A9ACC48369BFF` | Telemetria |
| 29 | `20261027194805` | `supabase/migrations/20261018235500_soft_delete_fixed_routes.sql` | `26CE4F4AB18FE7072698853CEA084BF39A7F0A0DC6C5E39998EAE2304433A564` | Rotas |
| 30 | `20261027194808` | `supabase/migrations/20261019001109_lock_attendance_telemetry_and_scope.sql` | `0A93E7213E37A381BF721B900AAF36E2BC161E4D5F7E3BB82D5E8F474B371727` | Escopo |
| 31 | `20261027194811` | `supabase/migrations/20261019001848_validate_attendance_schedule_overlaps.sql` | `60346C33DCBF858140AF52D91CFDC4FC072ADA5AB74BD74CE373E28695F683A8` | Escalas |
| 32 | `20261027194819` | `supabase/migrations/20261019004947_add_attendance_work_location.sql` | `F84A392F08CBE8099333063536E9B5EAB73479F59F57D784EC1887EAFB95C134` | Localização |
| 33 | `20261027194822` | `supabase/migrations/20261019011832_secure_attendance_photos_and_release_contract.sql` | `33268EF093363BFF15FC97187BBB957C670178E4302BF40E62CFC812E7C5FD5C` | Fotos/Contratos |
| 34 | `20261027194825` | `supabase/migrations/20261019013007_complete_attendance_operational_setup.sql` | `405235CE97AAA6B4753D72A7E66B96ADF6B2B90FDAD2188A03BB55C3E1DABA46` | Setup Geral |
| 35 | `20261027194904` | `supabase/migrations/20261019151754_mk9_rh_explicit_bindings.sql` | `0A22B9C55F0DE881689DCC7DA3377713A10F0ABCB960E49E93AC1A154F7A30EC` | RH Bindings |
| 36 | `20261027194914` | `supabase/migrations/20261019175853_mk9_rh_admin_binding_preparation.sql` | `4AC4CB797CCB45165E36A4D6F3076C8FBE54D97A619DB1C081A35850C4C4C28E` | RH Admin |
| 37 | `20261027194917` | `supabase/migrations/20261020160000_add_whatsapp_group_link_to_industrias.sql` | `FD34731A4A4AC302A84A97C02EF6E2559A0F4A53EFDDFB6041D1DACD9C0556DC` | Indústrias |
| 38 | `20261027194919` | `supabase/migrations/20261020160000_mk9_faltas_atestados_prepare_permission.sql` | `79908CA44590258934BB2DDEC087129935F8EEBC15267D5CE5381D57036A47BD` | Faltas Permissões |
| 39 | `20261027194922` | `supabase/migrations/20261020170000_mk9_absence_records_outbox.sql` | `C4C9EA01D769C80D7035812FEC0639E296C4AB1DC203DFB150D026A617EF661E` | Outbox |
| 40 | `20261027194925` | `supabase/migrations/20261021100000_mk9_rh_reconciliation.sql` | `C593171A68C77D0E06E96414177CFD4EFAFCB3625300F13A01976CDCA51BA8BC` | RH Reconciliação |
| 41 | `20261027194934` | `supabase/migrations/20261021120000_mk9_absence_attachments.sql` | `7305F8D3DF2E264A8A2730A14F4F89D95966F5B04CD4B01B5019FD8469A7EC4E` | Anexos Faltas |
| 42 | `20261027194937` | `supabase/migrations/20261022152449_mk9_date_visit_regularization_and_checkin_scope.sql` | `217F56793B45BE293DBA289D7C68863031440364DFFDC2A7C6C65C13241562B1` | Regularização / Checkin |
| 43 | `20261027194940` | `supabase/migrations/20261023142837_promoter_scheduled_visit_actions.sql` | `BBB3EEA79317D8D1668DD05B489F4D0F701CC5FA839D984E19105969BE19F431` | Ações de Visita |
| 44 | `20261030152933` | `20261030152933_m18_homologation_security.sql` | `C20F0CDF6ADFCEF4E219D8FE6E51DAF2E6A493918E4C8644DD32E4AC8AC223D2` | Segurança M18 |
| 45 | `20261030153146` | `20261030153146_m18_active_session_guard.sql` | `AC350BBB8272234F49F12DC9F3F31465C03C73756B93A4AB4D102D65D969D24B` | Sessão Ativa |
| 46 | `20261030153303` | `20261030153303_m18_industry_route_projection.sql` | `3A03A52172576AAA1E90C0FE454FE56616AE414FAB4741FDB68434EA01D1EE36` | Projeção Rotas |
| 47 | `20261030153702` | `20261030153702_m18_photo_upsert_permission.sql` | `D7FB3A33C67C790AD1FF1422BA96A386AB1236F49C891FFCCA11429867FCE0F8` | Upsert Fotos |

---

## 2. Migrations Operacionais M30 e M37 (6 Versões)
Validadas com hashes exatos de 64 caracteres em `scripts/safe-homolog-executor.mjs`:

| # | Versão Remota | Nome do Arquivo Git | SHA-256 Validado (64 caracteres) | Dependência Principal |
|---|---|---|---|---|
| 48 | `20261105165500` | `supabase/migrations/20261105165500_m30_harden_industry_active_checkin.sql` | `EFF1541C53B4DF6944132BB9AA5FB7CDCA9401D8BB262531916036CF0319938C` | M15 Checkin |
| 49 | `20261106131614` | `supabase/migrations/20261106131614_m30_serialize_industry_checkin.sql` | `92913DE529CF602C52DD59419179498620DCA73B315792BF08246090AE910834` | Concorrência Checkin |
| 50 | `20261106140000` | `supabase/migrations/20261106140000_m37_pending_visit_active_route_guard.sql` | `8763D644E50808B5D8EDB43FF331B615726AC3598C9BDE3483B9EBE71357BFB5` | Guards Rotas |
| 51 | `20261106150000` | `supabase/migrations/20261106150000_m37_checkin_route_and_conflict_guard.sql` | `C58F96DE4B4E367B1CCDFBF7A78DDBC561F2EB82A3D2FF429F814687945295D1` | Conflito Rotas |
| 52 | `20261107140000` | `supabase/migrations/20261107140000_m37_reconcile_materialized_pending_recovery.sql` | `DEF790F7B18EF9F7417A97F516D5424E91DC26A29CAC13A770F535E7D65BA46A` | Recuperação Pendente |
| 53 | `20261108160835` | `supabase/migrations/20261108160835_m37_integral_weekly_recovery.sql` | `452DF8D1BCC10C368A98DBAB9881E45FEC942212320BA88D8A5BA6D3281BA599` | Recuperação Semanal |

---

## 3. Migrations de Ciclo de Vida M38 (3 Versões)
Validadas com hashes exatos de 64 caracteres em `scripts/safe-homolog-executor.mjs`:

| # | Versão Remota | Nome do Arquivo Git | SHA-256 Validado (64 caracteres) | Dependência Principal |
|---|---|---|---|---|
| 54 | `20261110150000` | `supabase/migrations/20261110150000_m38_visit_cancellation_and_day_end_close.sql` | `3FD97245CB2D2495FC86B0EDE69703DF8F6DA45321B5DB0E28CDDBA007DFBED1` | `pg_cron` / Cancelamento |
| 55 | `20261110160000` | `supabase/migrations/20261110160000_m38_retry_attempt_history.sql` | `7E8C214F29889E41120427633C4667A3836AA59DC13AA77171F59DB0D8F53C11` | Histórico Tentativas |
| 56 | `20261110170000` | `supabase/migrations/20261110170000_m38_checkin_reuses_active_scheduled_attempt.sql` | `79430CC02195A33A89470AFE0587E1165263E1F8536C687ED677A73B71C5781C` | Checkin Reuso |

---

## 4. Migration Proposta RC1.25 (Pendente de Aplicação Remota)
| # | Versão Alvo | Arquivo da Migration Proposta | SHA-256 Validado (64 caracteres) | Dependência Principal |
|---|---|---|---|---|
| 57 | `20261115160000` | `supabase/migrations/propostas/20261115_rc1_25_skus_and_stock_audits.sql` | `41EA78BCC4416D65B5714B648AC076DCA932A945CFBB9A19C71C893AB8FDD01B` | M38 Guards / SKUs |

---
**Status da Reconciliação:** Concluída e auditável. As 56 versões remotas possuem correspondência individual rastreável, hashes de 64 dígitos conferidos e dependências registradas.
