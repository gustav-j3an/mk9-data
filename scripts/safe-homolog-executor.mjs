import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import {
  ALLOWED_HOMOLOG_PROJECT_REF,
  FORBIDDEN_PRODUCTION_PROJECT_REF,
  validateTargetProject
} from './guard-homolog-env.mjs';

/** Read-only preflight plan; this module never connects to or writes Supabase. */
export const EXPECTED_HOMOLOGATION_LEDGER = [
  ['20261027194528', 'm15_20260930_create_import_tables'],
  ['20261027194554', 'm15_20260930_create_profiles'],
  ['20261027194557', 'm15_20260930_add_status_to_profiles'],
  ['20261027194600', 'm15_20260930_update_rotas_structure'],
  ['20261027194603', 'm15_20261001_create_visits_tables'],
  ['20261027194606', 'm15_20261006_add_visits_unique_constraint'],
  ['20261027194616', 'm15_20261006_harden_rbac_rls'],
  ['20261027194620', 'm15_20261006_harden_storage_visit_photos'],
  ['20261027194624', 'm15_20261007_add_delete_user_function'],
  ['20261027194627', 'm15_20261007_allow_admin_insert_profiles'],
  ['20261027194630', 'm15_20261007_create_visit_product_validity'],
  ['20261027194639', 'm15_20261008_auto_generate_store_code'],
  ['20261027194646', 'm15_20261008_clean_legacy_duplicate_visits'],
  ['20261027194650', 'm15_20261008_create_notifications_table'],
  ['20261027194655', 'm15_20261008_industry_client_access'],
  ['20261027194658', 'm15_20261009144200_add_visits_unique_constraint'],
  ['20261027194708', 'm15_20261010_create_system_settings_and_audit'],
  ['20261027194711', 'm15_20261011120000_create_promoter_authorizations'],
  ['20261027194714', 'm15_20261011140000_auto_generate_industry_code'],
  ['20261027194718', 'm15_20261015100000_create_equipes_table'],
  ['20261027194722', 'm15_20261016100000_create_supervisores_table'],
  ['20261027194731', 'm15_20261017_create_avatars_storage_policies'],
  ['20261027194734', 'm15_20261017120000_create_contratos_lojas_table'],
  ['20261027194737', 'm15_20261018150000_add_data_inicio_operacao_to_industrias'],
  ['20261027194740', 'm15_20261018220000_create_promoter_attendance_audit'],
  ['20261027194744', 'm15_20261018230000_create_promoter_schedules_and_absences'],
  ['20261027194754', 'm15_20261018232256_harden_attendance_audit_permissions'],
  ['20261027194801', 'm15_20261018234153_finalize_attendance_journeys_privacy_telemetry'],
  ['20261027194805', 'm15_20261018235500_soft_delete_fixed_routes'],
  ['20261027194808', 'm15_20261019001109_lock_attendance_telemetry_and_scope'],
  ['20261027194811', 'm15_20261019001848_validate_attendance_schedule_overlaps'],
  ['20261027194819', 'm15_20261019004947_add_attendance_work_location'],
  ['20261027194822', 'm15_20261019011832_secure_attendance_photos_and_release_contract'],
  ['20261027194825', 'm15_20261019013007_complete_attendance_operational_setup'],
  ['20261027194904', 'm15_20261019151754_mk9_rh_explicit_bindings'],
  ['20261027194914', 'm15_20261019175853_mk9_rh_admin_binding_preparation'],
  ['20261027194917', 'm15_20261020160000_add_whatsapp_group_link_to_industrias'],
  ['20261027194919', 'm15_20261020160000_mk9_faltas_atestados_prepare_permission'],
  ['20261027194922', 'm15_20261020170000_mk9_absence_records_outbox'],
  ['20261027194925', 'm15_20261021100000_mk9_rh_reconciliation'],
  ['20261027194934', 'm15_20261021120000_mk9_absence_attachments'],
  ['20261027194937', 'm15_20261022152449_mk9_date_visit_regularization_and_checkin_scope'],
  ['20261027194940', 'm15_20261023142837_promoter_scheduled_visit_actions'],
  ['20261030152933', 'm18_homologation_security'],
  ['20261030153146', 'm18_active_session_guard'],
  ['20261030153303', 'm18_industry_route_projection'],
  ['20261030153702', 'm18_photo_upsert_permission'],
  ['20261105165500', 'm30_harden_industry_active_checkin'],
  ['20261106131614', 'm30_serialize_industry_checkin'],
  ['20261106140000', 'm37_pending_visit_active_route_guard'],
  ['20261106150000', 'm37_checkin_route_and_conflict_guard'],
  ['20261107140000', 'm37_reconcile_materialized_pending_recovery'],
  ['20261108160835', 'm37_integral_weekly_recovery']
].map(([version, name]) => ({ version, name }));

// Verify the already-applied M30/M37 source, but never reapply it.
export const APPLIED_PREREQUISITE_MIGRATIONS = [
  ['20261105165500', 'supabase/migrations/20261105165500_m30_harden_industry_active_checkin.sql', 'EFF1541C53B4DF6944132BB9AA5FB7CDCA9401D8BB262531916036CF0319938C'],
  ['20261106131614', 'supabase/migrations/20261106131614_m30_serialize_industry_checkin.sql', '92913DE529CF602C52DD59419179498620DCA73B315792BF08246090AE910834'],
  ['20261106140000', 'supabase/migrations/20261106140000_m37_pending_visit_active_route_guard.sql', '8763D644E50808B5D8EDB43FF331B615726AC3598C9BDE3483B9EBE71357BFB5'],
  ['20261106150000', 'supabase/migrations/20261106150000_m37_checkin_route_and_conflict_guard.sql', 'C58F96DE4B4E367B1CCDFBF7A78DDBC561F2EB82A3D2FF429F814687945295D1'],
  ['20261107140000', 'supabase/migrations/20261107140000_m37_reconcile_materialized_pending_recovery.sql', 'DEF790F7B18EF9F7417A97F516D5424E91DC26A29CAC13A770F535E7D65BA46A'],
  ['20261108160835', 'supabase/migrations/20261108160835_m37_integral_weekly_recovery.sql', '452DF8D1BCC10C368A98DBAB9881E45FEC942212320BA88D8A5BA6D3281BA599']
].map(([version, file, expectedSha256]) => ({ version, file, expectedSha256 }));

export const AUTHORIZED_MIGRATIONS = [
  ['20261110150000', 'supabase/migrations/20261110150000_m38_visit_cancellation_and_day_end_close.sql', '3FD97245CB2D2495FC86B0EDE69703DF8F6DA45321B5DB0E28CDDBA007DFBED1'],
  ['20261110160000', 'supabase/migrations/20261110160000_m38_retry_attempt_history.sql', '7E8C214F29889E41120427633C4667A3836AA59DC13AA77171F59DB0D8F53C11'],
  ['20261110170000', 'supabase/migrations/20261110170000_m38_checkin_reuses_active_scheduled_attempt.sql', '79430CC02195A33A89470AFE0587E1165263E1F8536C687ED677A73B71C5781C']
].map(([version, file, expectedSha256]) => ({ version, file, expectedSha256 }));

export const EXPECTED_PRE_M38_SCHEMA = {
  postgresMajorVersion: 17,
  catalogFactCount: 152,
  catalogFingerprint: '41c50d8fa3740cde1c84bb56217d48e2ea3f3d74a30898f746c4a89a62391054'
};

export const REQUIRED_CONFIRMATION = `APPLY_M38_TO_HOMOLOGATION:${ALLOWED_HOMOLOG_PROJECT_REF}:${AUTHORIZED_MIGRATIONS.map(m => m.version).join(',')}`;

export function computeFileSha256(filePath) {
  const normalizedSql = readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
  return createHash('sha256').update(normalizedSql, 'utf8').digest('hex').toUpperCase();
}

export function validateAuthorizedMigrationsIntegrity() {
  const checked = [];
  for (const migration of [...APPLIED_PREREQUISITE_MIGRATIONS, ...AUTHORIZED_MIGRATIONS]) {
    if (!existsSync(migration.file)) return { ok: false, error: `Migration file '${migration.file}' is missing.` };
    const actual = computeFileSha256(migration.file);
    if (actual !== migration.expectedSha256) {
      return { ok: false, error: `SHA-256 mismatch for ${migration.version}: expected ${migration.expectedSha256}, got ${actual}.` };
    }
    checked.push({ version: migration.version, file: migration.file, sha256: actual });
  }
  const prerequisiteVersions = new Set(APPLIED_PREREQUISITE_MIGRATIONS.map(m => m.version));
  return {
    ok: true,
    count: AUTHORIZED_MIGRATIONS.length,
    migrations: checked.filter(m => !prerequisiteVersions.has(m.version)),
    verifiedPrerequisites: checked.filter(m => prerequisiteVersions.has(m.version))
  };
}

export function validateRemoteLedgerPreconditions(ledgerMigrationList) {
  if (!Array.isArray(ledgerMigrationList)) return { ok: false, error: 'Ledger must be an array of version/name records.' };
  const actual = ledgerMigrationList.map(row => ({
    version: String(row?.version ?? row?.remote ?? '').trim(),
    name: String(row?.name ?? row?.remote_name ?? '').trim()
  }));
  if (actual.some(row => !row.version || !row.name)) return { ok: false, error: 'Every remote ledger row needs its exact version and name.' };
  if (new Set(actual.map(row => row.version)).size !== actual.length) return { ok: false, error: 'Remote ledger contains duplicate versions.' };
  if (actual.length !== EXPECTED_HOMOLOGATION_LEDGER.length) {
    return { ok: false, error: `Remote ledger must exactly match the audited 53-version baseline; found ${actual.length}.` };
  }

  const expected = new Map(EXPECTED_HOMOLOGATION_LEDGER.map(row => [row.version, row.name]));
  for (const row of actual) {
    const expectedName = expected.get(row.version);
    if (expectedName === undefined) return { ok: false, error: `Unexpected remote migration version ${row.version}.` };
    if (expectedName !== row.name) return { ok: false, error: `Remote migration ${row.version} name mismatch.` };
  }
  for (const migration of AUTHORIZED_MIGRATIONS) {
    if (expected.has(migration.version)) return { ok: false, error: `Pending M38 migration ${migration.version} is already registered.` };
  }
  if (!expected.has('20261108160835') || expected.has('20261108100000')) {
    return { ok: false, error: 'M37 weekly recovery must be present only under applied version 20261108160835.' };
  }
  return { ok: true, ledgerCount: actual.length, appliedM37WeeklyVersion: '20261108160835', pendingM38Versions: AUTHORIZED_MIGRATIONS.map(m => m.version) };
}

export function validateSchemaPreconditions(schemaFacts) {
  if (!schemaFacts || typeof schemaFacts !== 'object') return { ok: false, error: 'Read-only schema facts are required.' };
  if (Number(schemaFacts.postgresMajorVersion) !== EXPECTED_PRE_M38_SCHEMA.postgresMajorVersion) {
    return { ok: false, error: 'M38 preflight requires PostgreSQL 17.' };
  }
  if (Number(schemaFacts.catalogFactCount) !== EXPECTED_PRE_M38_SCHEMA.catalogFactCount
      || String(schemaFacts.catalogFingerprint).toLowerCase() !== EXPECTED_PRE_M38_SCHEMA.catalogFingerprint) {
    return { ok: false, error: 'Required M30/M37 catalog fingerprint differs from the audited homologation schema.' };
  }
  if (schemaFacts.pgCronInstalled !== true) return { ok: false, error: 'M38 requires pg_cron before migration execution.' };
  return { ok: true, ...EXPECTED_PRE_M38_SCHEMA, pgCronInstalled: true };
}

export function evaluateSafeExecutionPlan(opts = {}) {
  const { targetProject, linkedProject, isTempWorkdir = false, confirmationText = '', ledgerList = [], schemaFacts } = opts;
  const project = validateTargetProject(targetProject);
  if (!project.ok) return { ok: false, step: 'VALIDATE_PROJECT', error: project.error };
  if (linkedProject === FORBIDDEN_PRODUCTION_PROJECT_REF && !isTempWorkdir) {
    return { ok: false, step: 'ISOLATION_CHECK', error: 'Repository linked to production; an isolated workdir is mandatory.' };
  }
  const integrity = validateAuthorizedMigrationsIntegrity();
  if (!integrity.ok) return { ok: false, step: 'HASH_INTEGRITY', error: integrity.error };
  const ledger = validateRemoteLedgerPreconditions(ledgerList);
  if (!ledger.ok) return { ok: false, step: 'LEDGER_PRECONDITIONS', error: ledger.error };
  const schema = validateSchemaPreconditions(schemaFacts);
  if (!schema.ok) return { ok: false, step: 'SCHEMA_PRECONDITIONS', error: schema.error };
  if (confirmationText !== REQUIRED_CONFIRMATION) {
    return { ok: false, step: 'EXPLICIT_CONFIRMATION', error: `Explicit confirmation required: ${REQUIRED_CONFIRMATION}` };
  }
  // This remains a plan only: no Supabase connection or write operation exists here.
  return {
    ok: true,
    targetProject: project.projectRef,
    ledgerCount: ledger.ledgerCount,
    alreadyAppliedM37WeeklyVersion: ledger.appliedM37WeeklyVersion,
    migrationsToApply: integrity.migrations,
    readyForAuthorizedOperator: true
  };
}
