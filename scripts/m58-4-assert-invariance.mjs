import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const LEDGER_ID = { schema: 'supabase_migrations', table: 'schema_migrations' };
const LEDGER_CONTENT_FIELDS = new Set(['rows', 'data_sha256']);

function normalizedInventory(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.tables_and_row_counts)) {
    throw new Error('M58_4_INVENTORY_SHAPE_INVALID');
  }
  const inventory = structuredClone(input);
  const ledgerRows = inventory.tables_and_row_counts.filter((row) => row.schema === LEDGER_ID.schema && row.table === LEDGER_ID.table);
  if (ledgerRows.length !== 1) throw new Error('M58_4_LEDGER_INVENTORY_ROW_INVALID');
  for (const field of LEDGER_CONTENT_FIELDS) {
    if (!(field in ledgerRows[0])) throw new Error('M58_4_LEDGER_INVENTORY_CONTENT_MISSING');
    delete ledgerRows[0][field];
  }
  inventory.tables_and_row_counts.sort((a, b) => `${a.schema}.${a.table}`.localeCompare(`${b.schema}.${b.table}`));
  return inventory;
}

export function assertInventoryInvariant(before, after) {
  if (JSON.stringify(normalizedInventory(before)) !== JSON.stringify(normalizedInventory(after))) {
    throw new Error('M58_4_NON_LEDGER_INVARIANCE_FAILED');
  }
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [beforeFile, afterFile] = process.argv.slice(2);
  if (!beforeFile || !afterFile) throw new Error('USAGE');
  const before = JSON.parse(await readFile(beforeFile, 'utf8'));
  const after = JSON.parse(await readFile(afterFile, 'utf8'));
  assertInventoryInvariant(before, after);
  console.log('Synthetic inventory unchanged except for ledger row count/content digest; ledger transition verified separately.');
}
