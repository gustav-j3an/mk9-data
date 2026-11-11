import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function normalizeAcl(acl) {
  if (!acl || typeof acl !== 'string') return '';
  // PostgreSQL ACL string representation: "{priv1,priv2,...}" or ""
  const trimmed = acl.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    const inner = trimmed.slice(1, -1);
    if (!inner) return '';
    const parts = inner.split(',').map(s => s.trim()).filter(Boolean);
    parts.sort();
    return `{${parts.join(',')}}`;
  }
  return trimmed;
}

function normalizeInventory(obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(normalizeInventory);
  }
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'acl' && typeof value === 'string') {
      result[key] = normalizeAcl(value);
    } else {
      result[key] = normalizeInventory(value);
    }
  }
  return result;
}

export function assertInventoriesEqual(beforeInventory, afterInventory) {
  const normBefore = normalizeInventory(beforeInventory);
  const normAfter = normalizeInventory(afterInventory);
  if (JSON.stringify(normBefore) !== JSON.stringify(normAfter)) {
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
  } catch (err) {
    console.error('Restored database inventory does not match source.');
    for (const key of Object.keys(before)) {
      const b = JSON.stringify(before[key]);
      const a = JSON.stringify(after[key]);
      if (b !== a) {
        console.error(`Mismatch in section "${key}":`);
        if (Array.isArray(before[key]) && Array.isArray(after[key])) {
          const bSet = new Set(before[key].map(x => JSON.stringify(x)));
          const aSet = new Set(after[key].map(x => JSON.stringify(x)));
          const onlyInBefore = before[key].filter(x => !aSet.has(JSON.stringify(x)));
          const onlyInAfter = after[key].filter(x => !bSet.has(JSON.stringify(x)));
          console.error(`  Items only in Source (${onlyInBefore.length}):`, JSON.stringify(onlyInBefore.slice(0, 3)));
          console.error(`  Items only in Restored (${onlyInAfter.length}):`, JSON.stringify(onlyInAfter.slice(0, 3)));
        } else {
          console.error(`Source:   ${b?.slice(0, 300)}`);
          console.error(`Restored: ${a?.slice(0, 300)}`);
        }
      }
    }
    process.exitCode = 1;
    return;
  }
  console.log('Database inventory matches: table data, schemas and ownership, sequences, RLS, policies, routines, triggers, views, ACLs, roles, and extensions.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
