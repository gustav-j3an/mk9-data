import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function assertInventoriesEqual(beforeInventory, afterInventory) {
  if (JSON.stringify(beforeInventory) !== JSON.stringify(afterInventory)) {
    throw new Error('DATABASE_INVENTORY_MISMATCH');
  }
  return true;
}

async function main() {
  const [beforePath, afterPath] = process.argv.slice(2);
  if (!beforePath || !afterPath) throw new Error('USAGE');
  const before = JSON.parse(await readFile(beforePath, 'utf8'));
  const after = JSON.parse(await readFile(afterPath, 'utf8'));
  try {
    assertInventoriesEqual(before, after);
  } catch {
    console.error('Restored database inventory does not match source.');
    process.exitCode = 1;
    return;
  }
  console.log('Database inventory matches: table data, schemas and ownership, sequences, RLS, policies, routines, triggers, views, ACLs, roles, and extensions.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
