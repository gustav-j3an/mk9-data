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
  // SHA-256 do conteudo canonico da migration normalizado com finais de linha Unix (LF).
  // Garante integridade estrita e identica em qualquer ambiente (Windows, Linux, CI).
  expectedSha256: '8AAF49416C581EAEAAFC31BDFE7C769CA289C2444577A917FBCC769AECC018F5'
};

/**
 * Normaliza quebras de linha CRLF para LF antes de calcular o digest SHA-256.
 * O digest representa o conteudo logico canonico do arquivo de migration.
 */
export function computeNormalizedSha256(contentOrPath) {
  let text;
  if (typeof contentOrPath === 'string' && existsSync(contentOrPath)) {
    text = readFileSync(contentOrPath, 'utf8');
  } else if (Buffer.isBuffer(contentOrPath)) {
    text = contentOrPath.toString('utf8');
  } else if (typeof contentOrPath === 'string') {
    text = contentOrPath;
  } else {
    throw new TypeError('Invalid contentOrPath for hash calculation');
  }
  const normalized = text.replace(/\r\n/g, '\n');
  return createHash('sha256').update(normalized, 'utf8').digest('hex').toUpperCase();
}

export function computeFileSha256(filePath) {
  return computeNormalizedSha256(filePath);
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
    // parseHomologationPoolerUrl valida que host === configuredHost, porta === 5432
    // e user === postgres.<HOMOLOGATION_REF>, lancando erro caso divirja.
    if (parsed.user !== `postgres.${ALLOWED_HOMOLOG_PROJECT_REF}`) {
      return { ok: false, error: `DB URL user mismatch: expected postgres.${ALLOWED_HOMOLOG_PROJECT_REF}, got ${parsed.user}` };
    }
    return {
      ok: true,
      projectRef: ALLOWED_HOMOLOG_PROJECT_REF,
      poolerHost: parsed.host,
      user: parsed.user
    };
  } catch (err) {
    return { ok: false, error: `DB URL validation error: ${err.message}` };
  }
}

export function runPsql(dbUrl, sql, opts = {}) {
  const { singleTransaction = false, ...execOpts } = opts;
  const normalized = normalizeHomologationPoolerUrl(dbUrl);
  const args = ['-X', '-v', 'ON_ERROR_STOP=1', '-Atqc', sql];
  if (singleTransaction) args.splice(3, 0, '--single-transaction');
  args.push(normalized);
  return execFileSync('psql', args, {
    encoding: 'utf8',
    env: {
      ...process.env,
      PGCONNECT_TIMEOUT: '10'
    },
    ...execOpts
  }).trim();
}

/**
 * The approved source SQL has its own outer BEGIN/COMMIT for manual use.
 * Remove only those exact boundary lines so the executor can submit the DDL
 * plus ledger INSERT under psql's single transaction (psql -1).
 */
export function composeAtomicMigrationSql(sqlContent, migration = AUTHORIZED_RC125_MIGRATION) {
  const normalized = sqlContent.replace(/\r\n/g, '\n').trim();
  const lines = normalized.split('\n');
  const beginIndex = lines.findIndex(line => /^BEGIN;\s*$/i.test(line));
  const commitIndex = lines.findLastIndex(line => /^COMMIT;\s*$/i.test(line));
  const headerIsCommentsOnly = lines.slice(0, beginIndex).every(line => /^\s*(--.*)?$/.test(line));
  if (beginIndex < 0 || commitIndex <= beginIndex || !headerIsCommentsOnly
      || lines.slice(commitIndex + 1).some(line => line.trim() !== '')) {
    throw new Error('MIGRATION_TRANSACTION_BOUNDARIES_INVALID: expected one outer BEGIN; and COMMIT;');
  }
  const body = [...lines.slice(0, beginIndex), ...lines.slice(beginIndex + 1, commitIndex)].join('\n').trim();
  if (/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im.test(body)) {
    throw new Error('MIGRATION_NESTED_TRANSACTION_BOUNDARY: inner transaction control is not allowed');
  }
  return `${body}\n\nINSERT INTO supabase_migrations.schema_migrations (version, name)\nVALUES ('${migration.version}', '${migration.name}');`;
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

  const dbUrl = env.SUPABASE_DB_URL;
  const poolerHost = env.SUPABASE_POOLER_HOST;
  const dbUrlValidation = validateDatabaseUrlStrict(dbUrl, poolerHost);
  if (!dbUrlValidation.ok) {
    throw new Error(`DATABASE_URL_VALIDATION_FAILED: ${dbUrlValidation.error}`);
  }
  console.log(`PASS: Validated pooler host (${dbUrlValidation.poolerHost}) and project user (${dbUrlValidation.user}) from database URL.`);

  console.log('==> [RC1.25 Safe Apply] Verifying active unexpired homologation backup artifact...');
  const backup = await verifyActiveHomologationBackup(env.GITHUB_TOKEN);
  console.log(`PASS: Active backup confirmed: ${backup.name} (runId: ${backup.runId}, size: ${backup.sizeBytes} bytes, expires: ${backup.expiresAt})`);

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
    const registered = remoteLedger.find(r => r.version === AUTHORIZED_RC125_MIGRATION.version);
    if (registered.name !== AUTHORIZED_RC125_MIGRATION.name) {
      throw new Error(`LEDGER_NAME_MISMATCH: version ${AUTHORIZED_RC125_MIGRATION.version} is registered with an unexpected name.`);
    }
    console.log(`INFO: Version ${AUTHORIZED_RC125_MIGRATION.version} is already registered in schema_migrations. Skipping SQL re-execution and validating schema state...`);
  } else {
    const untrackedObjects = runPsql(dbUrl, `
      SELECT (
        EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public'
          AND table_name IN ('industria_skus', 'visit_sku_stock_checks', 'visit_edits_audit_log'))
        OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
          AND policyname IN ('industria_skus_select_policy', 'industria_skus_promoter_insert_policy',
            'industria_skus_suggestion_scope_guard', 'industria_skus_admin_write_policy',
            'visit_sku_stock_select_policy', 'visit_sku_stock_write_policy',
            'visit_sku_stock_update_policy', 'visit_sku_stock_insert_current_visit_guard',
            'visit_sku_stock_update_current_visit_guard', 'visit_edits_audit_select_policy'))
        OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname IN (
            'check_visit_promotor_update_integrity', 'save_completed_visit_edit',
            'guard_visit_sku_stock_check', 'guard_visit_sku_stock_finalization'))
        OR EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'
          AND NOT t.tgisinternal AND t.tgname IN (
            'trg_visit_promotor_update_integrity', 'guard_visit_sku_stock_check',
            'guard_visit_sku_stock_finalization'))
        OR EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.visit_checklist_items')
          AND conname = 'uq_visit_checklist_item')
      )::text;
    `);
    if (untrackedObjects === 't') {
      throw new Error('UNTRACKED_PARTIAL_MIGRATION_STATE: RC1.25 objects exist without the ledger version; refusing automatic re-execution.');
    }
    console.log(`==> [RC1.25 Safe Apply] Applying migration ${AUTHORIZED_RC125_MIGRATION.file} in a single atomic transaction...`);
    const sqlContent = readFileSync(AUTHORIZED_RC125_MIGRATION.file, 'utf8');
    const migrationSql = composeAtomicMigrationSql(sqlContent);

    try {
      runPsql(dbUrl, migrationSql, { singleTransaction: true });
      console.log(`SUCCESS: Migration ${AUTHORIZED_RC125_MIGRATION.version} applied and registered.`);
    } catch {
      // Do not print the child-process error: it can embed the DB URL or SQL.
      console.error('FATAL: psql migration command failed; single-transaction mode was requested. Connection and SQL details were suppressed.');
      throw new Error('MIGRATION_EXECUTION_FAILED: psql command failed; diagnostic details suppressed.');
    }
  }

  console.log('==> [RC1.25 Safe Apply] Running post-migration verification...');
  const checkAuditTable = runPsql(dbUrl, "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'visit_edits_audit_log');");
  if (checkAuditTable !== 't') {
    throw new Error('POST_MIGRATION_FAILED: Table visit_edits_audit_log not found.');
  }

  const checkSkusTable = runPsql(dbUrl, "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'industria_skus');");
  if (checkSkusTable !== 't') {
    throw new Error('POST_MIGRATION_FAILED: Table industria_skus not found.');
  }

  const checkStockChecksTable = runPsql(dbUrl, "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'visit_sku_stock_checks');");
  if (checkStockChecksTable !== 't') {
    throw new Error('POST_MIGRATION_FAILED: Table visit_sku_stock_checks not found.');
  }

  const checkLedgerRegistration = runPsql(dbUrl, `SELECT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '${AUTHORIZED_RC125_MIGRATION.version}');`);
  if (checkLedgerRegistration !== 't') {
    throw new Error(`POST_MIGRATION_FAILED: Migration ${AUTHORIZED_RC125_MIGRATION.version} not found in schema_migrations.`);
  }

  console.log('==> [RC1.25 Safe Apply] RC1.25 APPLIED AND VERIFIED SUCCESSFULLY!');
  return {
    ok: true,
    appliedVersion: AUTHORIZED_RC125_MIGRATION.version
  };
}
