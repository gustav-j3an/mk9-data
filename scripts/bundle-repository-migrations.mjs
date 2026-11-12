import { createHash } from 'node:crypto';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function bundleRepositoryMigrations(migrationsDir = 'supabase/migrations', outputDir) {
  const resolvedDir = path.resolve(migrationsDir);
  const resolvedOut = path.resolve(outputDir);
  await mkdir(resolvedOut, { recursive: true, mode: 0o700 });

  const files = (await readdir(resolvedDir, { withFileTypes: true }))
    .filter(dirent => dirent.isFile() && dirent.name.endsWith('.sql'))
    .map(dirent => dirent.name)
    .sort();

  const manifest = [];
  for (const filename of files) {
    const filePath = path.join(resolvedDir, filename);
    const content = await readFile(filePath);
    const sha256 = createHash('sha256').update(content).digest('hex');
    const versionMatch = filename.match(/^(\d{8,14})/);
    const version = versionMatch ? versionMatch[1] : null;

    // Copy to outputDir for backup bundle
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
    total_files: manifest.length,
    migrations: manifest,
  };

  await writeFile(path.join(resolvedOut, 'manifest.json'), JSON.stringify(result, null, 2), { flag: 'w', mode: 0o600 });
  return result;
}

async function main() {
  const [outputDir] = process.argv.slice(2);
  if (!outputDir) throw new Error('USAGE: bundle-repository-migrations.mjs <outputDir>');
  const res = await bundleRepositoryMigrations('supabase/migrations', outputDir);
  console.log(`Repository migrations bundled: ${res.total_files} SQL files cataloged with SHA-256 hashes.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(err => {
    console.error(`Migration bundling failed (${err.message.replace(/[^A-Z0-9_:-]/gi, '') || 'UNKNOWN'}).`);
    process.exitCode = 1;
  });
}
