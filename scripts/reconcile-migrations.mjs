import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Parses pg_dump --data-only --schema=supabase_migrations output
 * Extracts all recorded migration versions from INSERT or COPY statements.
 * Throws an error on empty ledger, malformed format, or missing data to prevent silent approval.
 */
export function parseMigrationHistoryData(sqlContent) {
  if (!sqlContent || typeof sqlContent !== 'string' || sqlContent.trim().length === 0) {
    throw new Error('MIGRATION_LEDGER_EMPTY_OR_UNREADABLE: pg_dump migration history data is empty');
  }

  const versions = new Set();
  const copyMatch = sqlContent.match(/COPY\s+supabase_migrations\.schema_migrations(?:\s*\([^)]*\))?\s*FROM\s+stdin;([\s\S]*?)\\\./i);
  if (copyMatch) {
    const lines = copyMatch[1].trim().split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      const parts = line.split('\t');
      const version = parts[0]?.trim();
      if (version && /^\d+$/.test(version)) {
        versions.add(version);
      } else {
        throw new Error(`MIGRATION_LEDGER_MALFORMED_LINE: unexpected entry "${line}"`);
      }
    }
  }

  // Also check INSERT INTO statements if present
  const insertMatches = sqlContent.matchAll(/INSERT\s+INTO\s+supabase_migrations\.schema_migrations\s*(?:\([^)]*\))?\s*VALUES\s*\('?(\d+)'?/gi);
  for (const m of insertMatches) {
    if (m[1]) versions.add(m[1]);
  }

  if (versions.size === 0) {
    throw new Error('MIGRATION_LEDGER_ZERO_ENTRIES: No migration entries found in supabase_migrations.schema_migrations data');
  }

  return [...versions].sort();
}

/**
 * Reconciles remote database migration ledger with repository migration files.
 * Identifies:
 * 1. Registered migrations in remote DB that have NO matching file in repository (BLOCKING DIVERGENCE).
 * 2. Files in repository that have not yet been applied in the remote database (Informational / Unexecuted).
 */
export async function reconcileMigrationsLedger(migrationSqlPath, bundleManifestPath) {
  let sql;
  try {
    sql = await readFile(path.resolve(migrationSqlPath), 'utf8');
  } catch (err) {
    throw new Error(`MIGRATION_HISTORY_FILE_NOT_FOUND: ${err.message}`);
  }

  let manifest;
  try {
    manifest = JSON.parse(await readFile(path.resolve(bundleManifestPath), 'utf8'));
  } catch (err) {
    throw new Error(`MIGRATION_BUNDLE_MANIFEST_INVALID: ${err.message}`);
  }

  if (!manifest || !Array.isArray(manifest.migrations)) {
    throw new Error('MIGRATION_BUNDLE_MANIFEST_MALFORMED: migrations array missing');
  }

  const dbVersions = parseMigrationHistoryData(sql);
  const repoFilesByVersion = new Map();
  for (const item of manifest.migrations) {
    if (item.version) {
      repoFilesByVersion.set(item.version, item.filename);
    }
  }

  // Migrations applied in remote DB that DO NOT exist as executable files in repo
  const registeredWithoutFile = [];
  for (const dbVer of dbVersions) {
    if (!repoFilesByVersion.has(dbVer)) {
      registeredWithoutFile.push(dbVer);
    }
  }

  // Files present in repo that have NOT been applied in remote DB
  const filesNotAppliedInDb = [];
  for (const [repoVer, filename] of repoFilesByVersion.entries()) {
    if (!dbVersions.includes(repoVer)) {
      filesNotAppliedInDb.push({ version: repoVer, filename });
    }
  }

  return {
    dbTotalApplied: dbVersions.length,
    repoTotalFiles: manifest.total_executable_files ?? manifest.migrations.length,
    registeredWithoutFile,
    filesNotAppliedInDb,
    isFullyTracked: registeredWithoutFile.length === 0,
  };
}

async function main() {
  const [migrationSqlPath, bundleManifestPath] = process.argv.slice(2);
  if (!migrationSqlPath || !bundleManifestPath) {
    throw new Error('USAGE: reconcile-migrations.mjs <migrationHistorySql> <bundleManifestJson>');
  }

  const report = await reconcileMigrationsLedger(migrationSqlPath, bundleManifestPath);
  console.log(`Migrations ledger reconciliation: ${report.dbTotalApplied} applied in database, ${report.repoTotalFiles} in repository.`);

  if (report.filesNotAppliedInDb.length > 0) {
    console.log(`NOTE: ${report.filesNotAppliedInDb.length} file(s) present in repository are not yet applied in production:`);
    for (const f of report.filesNotAppliedInDb) {
      console.log(`  - Version ${f.version}: ${f.filename}`);
    }
  }

  if (report.registeredWithoutFile.length > 0) {
    console.error(`ERROR: ${report.registeredWithoutFile.length} migration(s) registered in database ledger without matching file in repository:`);
    for (const v of report.registeredWithoutFile) {
      console.error(`  - Unmatched version in DB: ${v}`);
    }
    console.error('MIGRATION_LEDGER_DIVERGENCE_BLOCK: Production database contains migrations not accounted for in this branch. Aborting backup generation to preserve auditability.');
    process.exit(1);
  }

  console.log('Migrations ledger reconciliation verified: 100% of applied database migrations are matched by repository files.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(err => {
    console.error(`Migration reconciliation failed (${err.message.replace(/[^A-Z0-9_:-]/gi, '') || 'UNKNOWN'}).`);
    process.exit(1);
  });
}
