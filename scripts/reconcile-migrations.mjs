import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Parses pg_dump --data-only --schema=supabase_migrations output
 * Extracts all recorded migration versions from INSERT or COPY statements.
 */
export function parseMigrationHistoryData(sqlContent) {
  const versions = new Set();
  const copyMatch = sqlContent.match(/COPY\s+supabase_migrations\.schema_migrations\s*\([^)]*\)\s*FROM\s+stdin;([\s\S]*?)\\\./);
  if (copyMatch) {
    const lines = copyMatch[1].trim().split(/\r?\n/);
    for (const line of lines) {
      const parts = line.split('\t');
      const version = parts[0]?.trim();
      if (version && /^\d+$/.test(version)) {
        versions.add(version);
      }
    }
  }

  // Also check INSERT INTO statements if present
  const insertMatches = sqlContent.matchAll(/INSERT\s+INTO\s+supabase_migrations\.schema_migrations\s*(?:\([^)]*\))?\s*VALUES\s*\('?(\d+)'?/gi);
  for (const m of insertMatches) {
    if (m[1]) versions.add(m[1]);
  }

  return [...versions].sort();
}

/**
 * Reconciles remote database migration ledger with repository migration files
 */
export async function reconcileMigrationsLedger(migrationSqlPath, bundleManifestPath) {
  const sql = await readFile(path.resolve(migrationSqlPath), 'utf8');
  const manifest = JSON.parse(await readFile(path.resolve(bundleManifestPath), 'utf8'));

  const dbVersions = parseMigrationHistoryData(sql);
  const repoFilesByVersion = new Map();
  for (const item of manifest.migrations) {
    if (item.version) {
      repoFilesByVersion.set(item.version, item.filename);
    }
  }

  const registeredWithoutFile = [];
  for (const dbVer of dbVersions) {
    if (!repoFilesByVersion.has(dbVer)) {
      registeredWithoutFile.push(dbVer);
    }
  }

  const filesNotAppliedInDb = [];
  for (const [repoVer, filename] of repoFilesByVersion.entries()) {
    if (!dbVersions.includes(repoVer)) {
      filesNotAppliedInDb.push({ version: repoVer, filename });
    }
  }

  return {
    dbTotalApplied: dbVersions.length,
    repoTotalFiles: manifest.total_files,
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
  if (report.registeredWithoutFile.length > 0) {
    console.warn(`WARNING: ${report.registeredWithoutFile.length} migration(s) registered in database ledger without matching file in repository:`, report.registeredWithoutFile);
  }
  if (report.filesNotAppliedInDb.length > 0) {
    console.log(`NOTE: ${report.filesNotAppliedInDb.length} file(s) present in repo but not recorded in remote ledger.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(err => {
    console.error(`Migration reconciliation failed (${err.message.replace(/[^A-Z0-9_:-]/gi, '') || 'UNKNOWN'}).`);
    process.exitCode = 1;
  });
}
