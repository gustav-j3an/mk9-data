import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const RECONCILED_VERSIONS = Object.freeze([
  '20261009144200', '20261010', '20261011120000',
  '20261011140000', '20261017120000', '20261017',
]);

function sortRows(rows) {
  if (!Array.isArray(rows)) throw new Error('M58_4_LEDGER_SNAPSHOT_INVALID');
  const sorted = [...rows].sort((a, b) => String(a.version).localeCompare(String(b.version)));
  if (new Set(sorted.map((row) => row.version)).size !== sorted.length) throw new Error('M58_4_LEDGER_DUPLICATE_VERSION');
  return sorted;
}

export function assertLedgerTransition(beforeRows, afterRows) {
  const before = sortRows(beforeRows);
  const after = sortRows(afterRows);
  if (before.length !== 17) throw new Error('M58_4_LEDGER_INITIAL_COUNT_INVALID');
  if (before.some((row) => RECONCILED_VERSIONS.includes(row.version))) throw new Error('M58_4_CANDIDATE_ALREADY_REGISTERED');
  if (after.length !== 23) throw new Error('M58_4_LEDGER_FINAL_COUNT_INVALID');

  const beforeByVersion = new Map(before.map((row) => [row.version, row]));
  const afterByVersion = new Map(after.map((row) => [row.version, row]));
  for (const row of before) {
    if (JSON.stringify(afterByVersion.get(row.version)) !== JSON.stringify(row)) {
      throw new Error('M58_4_EXISTING_LEDGER_ROW_CHANGED');
    }
  }
  for (const version of RECONCILED_VERSIONS) {
    const row = afterByVersion.get(version);
    if (!row || row.name !== null || JSON.stringify(row.statements) !== JSON.stringify(['synthetic ledger simulation'])) {
      throw new Error('M58_4_RECONCILIATION_LEDGER_ROW_INVALID');
    }
  }
  if (after.some((row) => !beforeByVersion.has(row.version) && !RECONCILED_VERSIONS.includes(row.version))) {
    throw new Error('M58_4_UNEXPECTED_LEDGER_VERSION');
  }
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [beforePath, afterPath] = process.argv.slice(2);
  if (!beforePath || !afterPath) throw new Error('USAGE');
  const before = JSON.parse(await readFile(beforePath, 'utf8'));
  const after = JSON.parse(await readFile(afterPath, 'utf8'));
  assertLedgerTransition(before, after);
  console.log('Synthetic ledger transition verified: 17 existing rows preserved and exactly six expected rows appended.');
}
