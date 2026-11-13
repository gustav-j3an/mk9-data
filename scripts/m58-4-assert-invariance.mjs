import { readFile } from 'node:fs/promises';

function withoutReconciliationLedger(value) {
  const copy = structuredClone(value);
  if (Array.isArray(copy.table_rows)) {
    copy.table_rows = copy.table_rows.filter((row) => !(row.schema === 'supabase_migrations' && row.table === 'schema_migrations'));
  }
  return copy;
}

const [beforeFile, afterFile] = process.argv.slice(2);
if (!beforeFile || !afterFile) throw new Error('USAGE');
const before = withoutReconciliationLedger(JSON.parse(await readFile(beforeFile, 'utf8')));
const after = withoutReconciliationLedger(JSON.parse(await readFile(afterFile, 'utf8')));
if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('M58_4_NON_LEDGER_INVARIANCE_FAILED');
console.log('Synthetic schema/data inventory unchanged outside migration ledger.');
