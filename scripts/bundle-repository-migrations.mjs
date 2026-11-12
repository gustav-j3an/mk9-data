import { createHash } from 'node:crypto';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Bundles executable repository migrations from supabase/migrations (top-level only).
 * Strictly excludes proposal directories (like supabase/migrations/propostas),
 * experimental files, and non-SQL assets, while maintaining an explicit, deep audit record
 * of excluded items with relative paths, sizes and SHA-256 hashes.
 */
export async function bundleRepositoryMigrations(migrationsDir = 'supabase/migrations', outputDir) {
  const resolvedDir = path.resolve(migrationsDir);
  const resolvedOut = path.resolve(outputDir);
  await mkdir(resolvedOut, { recursive: true, mode: 0o700 });

  const entries = await readdir(resolvedDir, { withFileTypes: true });

  const executableFiles = [];
  const excludedItems = [];

  // Helper to catalog excluded files recursively inside subdirectories
  async function catalogDirectoryExcluded(dirPath, relativePrefix) {
    const subEntries = await readdir(dirPath, { withFileTypes: true });
    for (const sub of subEntries) {
      const subFull = path.join(dirPath, sub.name);
      const subRel = path.join(relativePrefix, sub.name).replace(/\\/g, '/');
      if (sub.isDirectory()) {
        await catalogDirectoryExcluded(subFull, subRel);
      } else {
        const subContent = await readFile(subFull);
        const subSha = createHash('sha256').update(subContent).digest('hex');
        excludedItems.push({
          path: subRel,
          name: sub.name,
          type: sub.name.endsWith('.sql') ? 'excluded-sql-subfolder' : 'excluded-non-sql-subfolder',
          bytes: subContent.length,
          sha256: subSha,
          reason: 'Subdirectories (e.g. proposals, drafts) are strictly excluded from executable migrations bundle',
        });
      }
    }
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const subDirPath = path.join(resolvedDir, entry.name);
      await catalogDirectoryExcluded(subDirPath, entry.name);
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith('.sql')) {
      const filePath = path.join(resolvedDir, entry.name);
      const content = await readFile(filePath);
      const sha256 = createHash('sha256').update(content).digest('hex');
      excludedItems.push({
        path: entry.name,
        name: entry.name,
        type: 'non-sql-file',
        bytes: content.length,
        sha256,
        reason: 'Only .sql files in top-level migrations dir are included in executable bundle',
      });
      continue;
    }

    executableFiles.push(entry.name);
  }

  executableFiles.sort();

  const manifest = [];
  for (const filename of executableFiles) {
    const filePath = path.join(resolvedDir, filename);
    const content = await readFile(filePath);
    const sha256 = createHash('sha256').update(content).digest('hex');
    const versionMatch = filename.match(/^(\d{8,14})/);
    const version = versionMatch ? versionMatch[1] : null;

    // Copy executable migration file into bundle
    await writeFile(path.join(resolvedOut, filename), content, { flag: 'w', mode: 0o600 });

    manifest.push({
      filename,
      version,
      sha256,
      bytes: content.length,
    });
  }

  const result = {
    schema_version: '1.0',
    generated_at: new Date().toISOString(),
    total_executable_files: manifest.length,
    total_excluded_items: excludedItems.length,
    migrations: manifest,
    excluded_items: excludedItems,
  };

  await writeFile(path.join(resolvedOut, 'manifest.json'), JSON.stringify(result, null, 2), { flag: 'w', mode: 0o600 });
  return result;
}

async function main() {
  const [outputDir] = process.argv.slice(2);
  if (!outputDir) throw new Error('USAGE: bundle-repository-migrations.mjs <outputDir>');
  const res = await bundleRepositoryMigrations('supabase/migrations', outputDir);
  console.log(`Repository migrations bundled: ${res.total_executable_files} executable SQL files cataloged with SHA-256 hashes (${res.total_excluded_items} items excluded for audit).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(err => {
    console.error(`Migration bundling failed (${err.message.replace(/[^A-Z0-9_:-]/gi, '') || 'UNKNOWN'}).`);
    process.exitCode = 1;
  });
}
