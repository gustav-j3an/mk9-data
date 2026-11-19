# RC1.25.49 — schema reconciliation evidence

This record describes only the local PostgreSQL 17 rehearsal. The source state was the restored copy with 17 ledger entries and 43 visits; no remote database was inspected or modified.

## Reconciled migration 20261022152449

Catalog comparison against the migration source found:

| Object group | Restored state before reconciliation | Disposition in the package |
| --- | --- | --- |
| `public.visit_regularization_audit` columns/defaults and constraints | Present; fingerprints matched the source definition | Kept in place; the package checks the complete captured fingerprints and performs no table recreation. |
| `public.visits.regularization_status` and check constraint | Present; definition matched | Kept in place after fingerprint check. |
| `visit_regularization_audit_promoter_time_idx` | Present; index definition matched | Kept in place after fingerprint check. |
| Two regularization triggers and the existing audit read policy | Present; definitions matched | Recreated only after exact precondition checks; verified again after application. |
| Nine restrictive policies on checklist, occurrences, and product validity | Missing | Created; postconditions verify relation, command, role, permissiveness, and expression fingerprints. |
| Functions | Four source-equivalent; five stale; two absent | The package checks signatures and body hashes, checks authorization helpers, then applies canonical function definitions and validates the resulting signatures and hashes. |

The stale functions were `check_visit_promotor_update_integrity`, `photo_upload_allowed`, `regularize_old_open_visit`, `attendance_check_in`, and `attendance_check_out`. The absent functions were `is_visit_in_current_operational_day` and `promoter_can_write_visit`. The other functions in the source migration matched their expected prior definitions. The authorization helper set is fingerprinted separately, including `staff_can_access`, `is_admin_or_gestor`, `get_auth_promotor_matricula`, `is_promotor_authorized`, and `auth.uid()`.

The package is separate from historical migrations, pins the source migration SHA-256, fails closed on catalog drift, and contains no `CREATE TABLE IF NOT EXISTS` or `CREATE INDEX IF NOT EXISTS` fallback. It does not insert a retroactive ledger row by itself; the rehearsal records the matching migration version in the same outer transaction as its SQL.

## Pending migration inventory

Each entry below was included in the local one-transaction rehearsal and received its corresponding ledger version only after its SQL. All 26 runner migrations plus the proposed RC1.25 migration completed in that clone. This confirms executable compatibility in the captured clone; it is not a claim that every pre-existing object in every migration received an independent source-to-catalog fingerprint. The detailed pre-state fingerprinting was focused on the known partial migration above.

| Version | Migration | Schema area / object scope | Rehearsal result |
| --- | --- | --- | --- |
| `20261009144200` | `add_visits_unique_constraint` | Visit uniqueness constraint | Applied in the atomic clone. |
| `20261010` | `create_system_settings_and_audit` | Settings/audit tables, indexes, policies, mode helper | Applied in the atomic clone. |
| `20261011120000` | `create_promoter_authorizations` | Promoter authorization/audit tables, policies, helper functions and visit guards | Applied; it changes a helper fingerprint consumed by the later reconciliation. |
| `20261011140000` | `auto_generate_industry_code` | Industry sequence, code helpers and trigger | Applied in the atomic clone. |
| `20261017120000` | `create_contratos_lojas_table` | Store contracts, indexes, overlap/update triggers and policies | Applied in the atomic clone. |
| `20261017` | `create_avatars_storage_policies` | Storage bucket policies | Applied in the atomic clone. |
| `20261018150000` | `add_data_inicio_operacao_to_industrias` | Industry operation-date column | Applied in the atomic clone. |
| `20261019151754` | `mk9_rh_explicit_bindings` | HR private schema, identity/allocation/access tables, indexes, triggers and scope helpers | Applied in the atomic clone. |
| `20261019175853` | `mk9_rh_admin_binding_preparation` | HR admin permissions and binding-management functions | Applied in the atomic clone. |
| `20261020160000` | `add_whatsapp_group_link_to_industrias` | Industry WhatsApp link column | Applied in the atomic clone. |
| `20261020163000` | `mk9_faltas_atestados_prepare_permission` | HR absence preparation permissions and helpers | Applied in the atomic clone. |
| `20261020170000` | `mk9_absence_records_outbox` | Absence, send-attempt, audit tables and restricted functions/policies | Applied in the atomic clone. |
| `20261021100000` | `mk9_rh_reconciliation` | HR reconciliation tables, indexes, permissions and RPCs | Applied in the atomic clone. |
| `20261021120000` | `mk9_absence_attachments` | Absence attachment table, storage policies and RPCs | Applied in the atomic clone. |
| `20261022152449` | `mk9_date_visit_regularization_and_checkin_scope` | Visit regularization audit, functions, triggers and nine missing restrictive policies | Applied through the separate guarded reconciliation package. |
| `20261023142837` | `promoter_scheduled_visit_actions` | Scheduled visit action table and attendance RPCs | Applied in the atomic clone. |
| `20261030160000` | `minimal_visit_regularization` | Regularization audit/functions/trigger definitions | Applied in the atomic clone after the guarded reconciliation. |
| `20261105165500` | `m30_harden_industry_active_checkin` | Check-in and scheduled-occurrence functions | Applied in the atomic clone. |
| `20261106131614` | `m30_serialize_industry_checkin` | Serialized check-in functions | Applied in the atomic clone. |
| `20261106140000` | `m37_pending_visit_active_route_guard` | Scheduled occurrence guard | Applied in the atomic clone. |
| `20261106150000` | `m37_checkin_route_and_conflict_guard` | Check-in route/conflict guard | Applied in the atomic clone. |
| `20261107140000` | `m37_reconcile_materialized_pending_recovery` | Recovery authorization and transition guard | Applied in the atomic clone. |
| `20261108160835` | `m37_integral_weekly_recovery` | Visit uniqueness indexes and scheduled recovery function | Applied in the atomic clone. |
| `20261110150000` | `m38_visit_cancellation_and_day_end_close` | Lifecycle audit/authorization, expiry and cancellation functions/triggers | Applied in the atomic clone. |
| `20261110160000` | `m38_retry_attempt_history` | Retry authorization, uniqueness, and retry functions/triggers | Applied in the atomic clone. |
| `20261110170000` | `m38_checkin_reuses_active_scheduled_attempt` | Scheduled check-in retry behavior | Applied in the atomic clone. |
| `20261115160000` | `20261115_rc1_25_skus_and_stock_audits` | Industry SKU catalog, visit stock checks, completed-visit edit audit and guard functions | Applied in the atomic clone. |

## Limits of this evidence

- A fresh clone `mk9_prod_restore_ensaios_v3` ended with 43 visits, 44 ledger rows (17 original plus 27 rehearsed), 120/120 validated foreign keys, zero invalid indexes, and all ten regularization/current-visit policies with expected role and predicate fingerprints.
- The original dump hash stayed `96aa0653d2ccf15f15486c07477bbbc8c88f42ff7c29129f98628e908a2d930d`.
- The restore used `--no-owner --no-privileges`; local roles are placeholders. Functional tests used transaction-scoped grants for `authenticated`, then rolled back. Thus those tests exercise synthetic RLS/business flows but do not certify original Supabase ACL parity.
- The profile role constraint supports `admin`, `gestor`, `operador`, `promotor`, and `client_industry`; `tecnico` is not an accepted role value in this snapshot. A technician-specific permission scenario remains undefined.
- PostgreSQL reports `cron.launch_active_jobs=off`; the WSL firewall remains `input drop` / `output drop`, loopback only.
