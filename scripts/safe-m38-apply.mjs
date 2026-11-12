import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import {
  ALLOWED_HOMOLOG_PROJECT_REF,
  FORBIDDEN_PRODUCTION_PROJECT_REF,
  validateTargetProject
} from './guard-homolog-env.mjs';
import {
  computeFileSha256,
  validateAuthorizedMigrationsIntegrity,
  validateRemoteLedgerPreconditions,
  AUTHORIZED_MIGRATIONS,
  EXPECTED_HOMOLOGATION_LEDGER,
  REQUIRED_CONFIRMATION
} from './safe-homolog-executor.mjs';
import { normalizeHomologationPoolerUrl } from './pooler-connection.mjs';

export const ALLOWED_APPLY_BRANCH = 'codex/m50.1-m38-homolog-apply';

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

export function executeM38HomologationApply(env = process.env) {
  console.log('==> [M38 Safe Apply] Checking environment and branch safety...');

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

  const dbUrl = env.SUPABASE_DB_URL;
  if (!dbUrl) {
    throw new Error('SUPABASE_DB_URL is missing.');
  }

  console.log('==> [M38 Safe Apply] Verifying migration file hashes (SHA-256)...');
  const integrity = validateAuthorizedMigrationsIntegrity();
  if (!integrity.ok) {
    throw new Error(`MIGRATION_INTEGRITY_FAILED: ${integrity.error}`);
  }
  console.log(`PASS: Verified ${integrity.migrations.length} pending M38 migration files.`);

  console.log('==> [M38 Safe Apply] Connecting read-only to verify database identity...');
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

  console.log('==> [M38 Safe Apply] Verifying pg_cron is installed...');
  const pgCronInstalled = runPsql(dbUrl, "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron');");
  if (pgCronInstalled !== 't') {
    throw new Error('PG_CRON_NOT_INSTALLED: pg_cron extension must be enabled before M38 execution.');
  }
  console.log('PASS: pg_cron extension confirmed.');

  console.log('==> [M38 Safe Apply] Querying remote ledger...');
  const ledgerRaw = runPsql(dbUrl, "SELECT json_agg(json_build_object('version', version, 'name', name) ORDER BY version) FROM supabase_migrations.schema_migrations;");
  const remoteLedger = JSON.parse(ledgerRaw || '[]');
  const ledgerCheck = validateRemoteLedgerPreconditions(remoteLedger);
  if (!ledgerCheck.ok) {
    throw new Error(`REMOTE_LEDGER_PRECONDITION_FAILED: ${ledgerCheck.error}`);
  }
  console.log(`PASS: Remote ledger matches baseline (${ledgerCheck.ledgerCount} migrations applied).`);

  for (const m of AUTHORIZED_MIGRATIONS) {
    const already = remoteLedger.some(r => r.version === m.version);
    if (already) {
      throw new Error(`MIGRATION_ALREADY_APPLIED: ${m.version} is already registered in schema_migrations.`);
    }
  }

  console.log('==> [M38 Safe Apply] Applying M38 migrations sequentially in individual transactions...');
  const applied = [];
  for (const migration of AUTHORIZED_MIGRATIONS) {
    console.log(`\n--- Applying Migration: ${migration.version} (${migration.file}) ---`);
    const sqlContent = readFileSync(migration.file, 'utf8');

    // Execute migration within explicit transaction and record to schema_migrations
    const migrationSql = `
      BEGIN;
      ${sqlContent}
      INSERT INTO supabase_migrations.schema_migrations (version, name)
      VALUES ('${migration.version}', '${migration.file.replace(/^.*[\\/]/, '').replace(/\.sql$/, '')}');
      COMMIT;
    `;

    try {
      runPsql(dbUrl, migrationSql);
      applied.push(migration.version);
      console.log(`SUCCESS: Migration ${migration.version} applied and registered.`);
    } catch (err) {
      console.error(`FATAL: Error applying migration ${migration.version}:`, err.message);
      throw new Error(`MIGRATION_EXECUTION_FAILED at ${migration.version}: ${err.message}`);
    }
  }

  console.log('\n==> [M38 Safe Apply] Running post-migration verifications...');
  const updatedLedgerRaw = runPsql(dbUrl, "SELECT json_agg(json_build_object('version', version, 'name', name) ORDER BY version) FROM supabase_migrations.schema_migrations;");
  const updatedLedger = JSON.parse(updatedLedgerRaw || '[]');
  console.log(`Updated ledger total migrations: ${updatedLedger.length} (expected: 56)`);
  if (updatedLedger.length !== 56) {
    throw new Error(`POST_LEDGER_COUNT_MISMATCH: Expected 56 migrations, got ${updatedLedger.length}`);
  }

  const cronCheck = runPsql(dbUrl, "SELECT count(*) FROM cron.job WHERE jobname = 'm38-expire-old-open-visits' AND schedule = '* * * * *';");
  console.log(`pg_cron job 'm38-expire-old-open-visits' count: ${cronCheck}`);
  if (cronCheck !== '1') {
    throw new Error('CRON_JOB_NOT_REGISTERED: pg_cron job m38-expire-old-open-visits missing or incorrect schedule.');
  }

  const rpcCheck = runPsql(dbUrl, "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('attendance_cancel_visit', 'attendance_start_scheduled_occurrence', 'attendance_check_in');");
  console.log(`Public RPC functions found: ${rpcCheck} (expected: 3)`);
  if (rpcCheck !== '3') {
    throw new Error('RPC_FUNCTIONS_MISSING: Not all required RPCs were found in public namespace.');
  }

  console.log('\n==> [M38 Safe Apply] ALL 3 MIGRATIONS APPLIED AND VERIFIED SUCCESSFULLY!');
  return {
    ok: true,
    appliedMigrations: applied,
    totalLedgerCount: updatedLedger.length,
    cronJobActive: true
  };
}
