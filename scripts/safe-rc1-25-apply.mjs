import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  ALLOWED_HOMOLOG_PROJECT_REF,
  FORBIDDEN_PRODUCTION_PROJECT_REF,
  validateTargetProject
} from './guard-homolog-env.mjs';
import { normalizeHomologationPoolerUrl, parseHomologationPoolerUrl } from './pooler-connection.mjs';
import { verifyActiveHomologationBackup } from './verify-active-backup.mjs';

export const ALLOWED_APPLY_BRANCH = 'feat/rc1-25-promoter-skus-photos-edit';
export const REQUIRED_CONFIRMATION = 'APLICAR RC1.25 HOMOLOGACAO';

export const AUTHORIZED_RC125_MIGRATION = {
  version: '20261115160000',
  name: '20261115_rc1_25_skus_and_stock_audits',
  file: 'supabase/migrations/propostas/20261115_rc1_25_skus_and_stock_audits.sql',
  expectedSha256: '41EA78BCC4416D65B5714B648AC076DCA932A945CFBB9A19C71C893AB8FDD01B'
};

export function computeFileSha256(filePath) {
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex').toUpperCase();
}

export function validateMigrationIntegrity(migration = AUTHORIZED_RC125_MIGRATION) {
  if (!existsSync(migration.file)) {
    return { ok: false, error: `Migration file missing: ${migration.file}` };
  }
  const actualSha256 = computeFileSha256(migration.file);
  if (actualSha256 !== migration.expectedSha256) {
    return {
      ok: false,
      error: `SHA256 mismatch for ${migration.file}: expected ${migration.expectedSha256}, got ${actualSha256}`
    };
  }
  return { ok: true, file: migration.file, sha256: actualSha256 };
}

export function validateDatabaseUrlStrict(dbUrl, poolerHost) {
  if (!dbUrl) {
    return { ok: false, error: 'SUPABASE_DB_URL is missing.' };
  }
  try {
    const parsed = parseHomologationPoolerUrl(dbUrl, poolerHost);
    if (parsed.projectRef !== ALLOWED_HOMOLOG_PROJECT_REF) {
      return { ok: false, error: `DB URL project mismatch: expected ${ALLOWED_HOMOLOG_PROJECT_REF}, got ${parsed.projectRef}` };
    }
    return { ok: true, projectRef: parsed.projectRef, poolerHost: parsed.poolerHost };
  } catch (err) {
    return { ok: false, error: `DB URL validation error: ${err.message}` };
  }
}

export function runPsql(dbUrl, sql, opts = {}) {
  const normalized = normalizeHomologationPoolerUrl(dbUrl);
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-Atqc', sql, normalized], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PGCONNECT_TIMEOUT: '10'
    },
    ...opts
  }).trim();
}

export async function executeRc125HomologationApply(env = process.env) {
  console.log('==> [RC1.25 Safe Apply] Checking environment and branch safety...');

  const branch = env.GITHUB_REF;
  if (branch !== `refs/heads/${ALLOWED_APPLY_BRANCH}`) {
    throw new Error(`BRANCH_NOT_ALLOWED: Execution permitted exclusively on refs/heads/${ALLOWED_APPLY_BRANCH}, got ${branch}`);
  }

  const targetProject = env.INPUT_PROJECT_REF || env.SUPABASE_PROJECT_REF;
  const projectValidation = validateTargetProject(targetProject);
  if (!projectValidation.ok) {
    throw new Error(`PROJECT_VALIDATION_FAILED: ${projectValidation.error}`);
  }

  const confirmation = env.INPUT_CONFIRMATION;
  if (confirmation !== REQUIRED_CONFIRMATION) {
    throw new Error(`CONFIRMATION_MISMATCH: Expected exact confirmation "${REQUIRED_CONFIRMATION}", got "${confirmation}"`);
  }

  console.log('==> [RC1.25 Safe Apply] Verifying active unexpired homologation backup artifact...');
  const backup = await verifyActiveHomologationBackup(env.GITHUB_TOKEN);
  console.log(`PASS: Active backup confirmed: ${backup.name} (runId: ${backup.runId}, size: ${backup.sizeBytes} bytes, expires: ${backup.expiresAt})`);

  const dbUrl = env.SUPABASE_DB_URL;
  const poolerHost = env.SUPABASE_POOLER_HOST;
  const dbUrlValidation = validateDatabaseUrlStrict(dbUrl, poolerHost);
  if (!dbUrlValidation.ok) {
    throw new Error(`DATABASE_URL_VALIDATION_FAILED: ${dbUrlValidation.error}`);
  }
  console.log(`PASS: Validated pooler host and project ref (${dbUrlValidation.projectRef}) from database URL.`);

  console.log('==> [RC1.25 Safe Apply] Verifying migration file hash (SHA-256)...');
  const integrity = validateMigrationIntegrity();
  if (!integrity.ok) {
    throw new Error(`MIGRATION_INTEGRITY_FAILED: ${integrity.error}`);
  }
  console.log(`PASS: Verified RC1.25 migration file hash: ${integrity.sha256}`);

  console.log('==> [RC1.25 Safe Apply] Connecting read-only to verify database identity...');
  const probe = runPsql(dbUrl, "SELECT current_database() || '|' || current_user || '|' || current_setting('server_version_num');");
  const [db, user, versionNumStr] = probe.split('|').map(s => s.trim());
  if (db !== 'postgres') {
    throw new Error(`DATABASE_MISMATCH: Expected "postgres", got "${db}"`);
  }
  const versionNum = parseInt(versionNumStr, 10);
  if (versionNum < 170000 || versionNum >= 180000) {
    throw new Error(`POSTGRES_VERSION_MISMATCH: Expected PostgreSQL 17, got ${versionNum}`);
  }
  console.log(`PASS: Connected to ${db} as ${user} (PostgreSQL ${versionNum}).`);

  console.log('==> [RC1.25 Safe Apply] Querying remote ledger and checking duplicate registration...');
  const ledgerRaw = runPsql(dbUrl, "SELECT json_agg(json_build_object('version', version, 'name', name) ORDER BY version) FROM supabase_migrations.schema_migrations;");
  const remoteLedger = JSON.parse(ledgerRaw || '[]');
  console.log(`Current remote ledger count: ${remoteLedger.length}`);

  const already = remoteLedger.some(r => r.version === AUTHORIZED_RC125_MIGRATION.version);
  if (already) {
    throw new Error(`MIGRATION_ALREADY_APPLIED: Version ${AUTHORIZED_RC125_MIGRATION.version} is already registered in schema_migrations.`);
  }

  console.log(`==> [RC1.25 Safe Apply] Applying migration ${AUTHORIZED_RC125_MIGRATION.file} in a single atomic transaction...`);
  const sqlContent = readFileSync(AUTHORIZED_RC125_MIGRATION.file, 'utf8');
  const migrationSql = `
    BEGIN;
    ${sqlContent}
    INSERT INTO supabase_migrations.schema_migrations (version, name)
    VALUES ('${AUTHORIZED_RC125_MIGRATION.version}', '${AUTHORIZED_RC125_MIGRATION.name}');
    COMMIT;
  `;

  try {
    runPsql(dbUrl, migrationSql);
    console.log(`SUCCESS: Migration ${AUTHORIZED_RC125_MIGRATION.version} applied and registered.`);
  } catch (err) {
    console.error(`FATAL: Error applying migration: ${err.message}`);
    throw new Error(`MIGRATION_EXECUTION_FAILED: ${err.message}`);
  }

  console.log('==> [RC1.25 Safe Apply] Running post-migration verification...');
  const checkAuditTable = runPsql(dbUrl, "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'visit_completed_review_audits');");
  if (checkAuditTable !== 't') {
    throw new Error('POST_MIGRATION_FAILED: Table visit_completed_review_audits not found.');
  }

  console.log('==> [RC1.25 Safe Apply] RC1.25 APPLIED AND VERIFIED SUCCESSFULLY!');
  return {
    ok: true,
    appliedVersion: AUTHORIZED_RC125_MIGRATION.version
  };
}
