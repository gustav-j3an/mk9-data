import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const recoveryScript = readFileSync(new URL('./m37-recovery-postgres17.sh', import.meta.url), 'utf8');
const executorScript = readFileSync(new URL('./safe-homolog-executor.mjs', import.meta.url), 'utf8');

test('M37 recovery simulation records the six applied M30/M37 ledger names without .sql', () => {
  const migrationList = recoveryScript.match(/migrations=\(\r?\n([\s\S]*?)\r?\n\)/)?.[1];
  assert.ok(migrationList, 'recovery script must declare its migration list');
  const recoveryMigrations = [...migrationList.matchAll(/^\s+supabase\/migrations\/(\d+)_([^\s/]+\.sql)\s*$/gm)]
    .map(([, version, filename]) => ({ version, filename }));

  const prerequisites = executorScript.match(/APPLIED_PREREQUISITE_MIGRATIONS = \[([\s\S]*?)\n\]\.map/)?.[1];
  assert.ok(prerequisites, 'executor must declare the pinned applied M30/M37 migrations');
  const expectedLedgerEntries = [...prerequisites.matchAll(/^\s*\['(\d+)',\s*'([^']+\.sql)',\s*'[A-F0-9]{64}'\],?$/gm)]
    .map(([, version, path]) => ({ version, name: path.split('/').at(-1).replace(/^\d+_/, '').replace(/\.sql$/, '') }));
  assert.equal(expectedLedgerEntries.length, 6, 'executor must pin the six applied M30/M37 ledger entries');
  assert.equal(recoveryMigrations.length, 9, 'the runner must retain all six dependencies and three M38 migrations');
  assert.deepEqual(recoveryMigrations.slice(0, 6).map(({ version, filename }) => ({
    version,
    name: filename.replace(/^\d+_/, '').replace(/\.sql$/, '')
  })), expectedLedgerEntries);

  assert.match(recoveryScript, /local migration_stem="\$\{migration_basename%\.sql\}"/);
  assert.match(recoveryScript, /printf '%s\\n' "\$\{migration_stem#\*_\}"/);
  assert.match(recoveryScript, /VALUES \('\$expected_ver','\$ledger_name'\)/);
  assert.match(recoveryScript, /all six M30\/M37 ledger entries use their extension-free homologation names/);
});

test('M37 recovery database assertions report failures instead of failing silently', () => {
  assert.match(recoveryScript, /assert_psql_true\(\) \{/);
  assert.match(recoveryScript, /ERROR: \$description \(actual result: \$result\)/);
  assert.match(recoveryScript, /ERROR: Could not evaluate database assertion: \$description/);
});

test('M37/M38 schema fingerprint uses the same explicit pipe separator as its expected value', () => {
  assert.match(recoveryScript, /schema_facts="\$\(psql -X -v ON_ERROR_STOP=1 -At -F '\|' -f scripts\/m38-homologation-schema-fingerprint\.sql\)"/);
  assert.match(recoveryScript, /expected_schema_facts='152\|[a-f0-9]{64}'/);
  assert.doesNotMatch(recoveryScript, /expected_schema_facts=\$'152\\t/);
});
