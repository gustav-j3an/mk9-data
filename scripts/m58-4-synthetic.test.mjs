import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('synthetic ledger selects exactly 17 repository versions and excludes six candidates', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'm58-4-ledger-'));
  try {
    const versions = [
      '20261009144200', '20261010', '20261011120000', '20261011140000',
      '20261017120000', '20261017', ...Array.from({ length: 20 }, (_, i) => `202609${String(i + 1).padStart(2, '0')}`),
    ];
    const manifest = path.join(dir, 'manifest.json');
    await writeFile(manifest, JSON.stringify({ migrations: versions.map((version) => ({ version })) }));
    const result = spawnSync(process.execPath, ['scripts/m58-4-ledger-setup.mjs', manifest], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal((result.stdout.match(/synthetic baseline only/g) ?? []).length, 17);
    for (const candidate of versions.slice(0, 6)) assert.equal(result.stdout.includes(`('${candidate}'`), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('ledger invariance comparison ignores only migration-ledger row digest', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'm58-4-invariance-'));
  try {
    const before = { table_rows: [{ schema: 'public', table: 'synthetic', data_sha256: 'a' }, { schema: 'supabase_migrations', table: 'schema_migrations', data_sha256: 'b' }], policies: [] };
    const after = structuredClone(before);
    after.table_rows[1].data_sha256 = 'c';
    const a = path.join(dir, 'before.json');
    const b = path.join(dir, 'after.json');
    await writeFile(a, JSON.stringify(before));
    await writeFile(b, JSON.stringify(after));
    let result = spawnSync(process.execPath, ['scripts/m58-4-assert-invariance.mjs', a, b], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    after.table_rows[0].data_sha256 = 'different';
    await writeFile(b, JSON.stringify(after));
    result = spawnSync(process.execPath, ['scripts/m58-4-assert-invariance.mjs', a, b], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}${result.stderr}`, /M58_4_NON_LEDGER_INVARIANCE_FAILED/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('synthetic workflow has no environment secrets and checks for remote configuration', async () => {
  const workflow = await readFile('.github/workflows/m58-4-synthetic-reconciliation.yml', 'utf8');
  const script = await readFile('scripts/m58-4-synthetic-reconciliation.sh', 'utf8');
  assert.doesNotMatch(workflow, /secrets\./i);
  assert.match(workflow, /workflow_dispatch/);
  assert.match(script, /REMOTE_SUPABASE_CONFIGURATION_PRESENT/);
  assert.match(script, /mk9_disposable_nonce/);
});
