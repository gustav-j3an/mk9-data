import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function filterRolesSql(inputPath, outputPath) {
  const content = await readFile(inputPath, 'utf8');
  const reserved = [
    'supabase_admin',
    'supabase_auth_admin',
    'supabase_storage_admin',
    'supabase_functions_admin',
    'supabase_read_only_user',
    'supabase_replication_admin',
    'authenticator',
    'pg_database_owner',
    'pg_read_all_data',
    'pg_write_all_data',
    'postgres'
  ];
  const reservedSet = new Set(reserved.map(r => r.toLowerCase()));

  const filtered = content
    .split('\n')
    .filter(line => {
      const match = line.match(/^\s*(?:CREATE|ALTER|DROP)\s+ROLE\s+"?([^"\s;]+)"?/i);
      if (match) {
        const role = match[1].toLowerCase();
        if (reservedSet.has(role)) {
          return false;
        }
      }
      return true;
    })
    .join('\n');

  await writeFile(outputPath, filtered, 'utf8');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    console.error('Usage: node filter-roles.mjs <input.sql> <output.sql>');
    process.exit(1);
  }
  await filterRolesSql(input, output);
}
