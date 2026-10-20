import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, basename } from 'node:path';
import { spawnSync } from 'node:child_process';

test('New homologation preflight validates synthetic configuration without accessing APIs', () => {
  const root = resolve(tmpdir());
  const directory = mkdtempSync(join(root, 'mk9-qa-cli-'));
  const project = '11111111-1111-1111-1111-111111111111';
  const cases = {
    start: '2026-10-01', end: '2026-10-19',
    projects: [{ id: project, matriculas: ['0001'], expectedProtocols: ['synthetic-only'] }],
    actors: ['promotor', 'gestor', 'admin'].map(role => ({ label: role, role, tokenEnv: `MK9_QA_${role.toUpperCase()}_TOKEN`, alocacoes: [{ projeto_id: project, matricula_local: 'PRM-1', matricula_externa: '0001' }], expectedProtocols: ['synthetic-only'] })),
    forbiddenProjectId: '22222222-2222-2222-2222-222222222222'
  };
  const casesFile = join(directory, 'cases.json');
  writeFileSync(casesFile, JSON.stringify(cases));
  const env = {
    ...process.env, MK9_FALTAS_API_URL: 'https://no-network-expected.invalid', MK9_FALTAS_API_KEY: 'synthetic-private-key',
    MK9_FALTAS_PROJECT_TEAMS: JSON.stringify({ [project]: ['EQP-001'] }),
    SUPABASE_URL: 'https://no-network-expected.invalid', SUPABASE_PUBLISHABLE_KEY: 'synthetic-public-key',
    MK9_QA_CASES_FILE: casesFile, MK9_QA_PROMOTOR_TOKEN: 'synthetic-promotor', MK9_QA_GESTOR_TOKEN: 'synthetic-gestor', MK9_QA_ADMIN_TOKEN: 'synthetic-admin'
  };
  const run = (overrides = {}) => spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), resolve('scripts/mk9-homologation.ts'), '--check'], { cwd: directory, env: { ...env, ...overrides }, encoding: 'utf8', timeout: 30_000 });
  try {
    const valid = run();
    assert.equal(valid.status, 0, valid.stderr);
    assert.ok(valid.stdout.includes('No network requests performed'));
    const duplicated = run({ MK9_QA_GESTOR_TOKEN: 'synthetic-promotor' });
    assert.equal(duplicated.status, 1);
    assert.ok(duplicated.stderr.includes('distinct session'));
    const unsafe = run({ MK9_FALTAS_API_URL: 'http://no-network-expected.invalid' });
    assert.equal(unsafe.status, 1);
    assert.ok(unsafe.stderr.includes('HTTPS origin'));
    for (const result of [valid, duplicated, unsafe]) {
      const output = result.stdout + result.stderr;
      for (const secret of [env.MK9_FALTAS_API_KEY, env.MK9_QA_PROMOTOR_TOKEN, env.MK9_QA_ADMIN_TOKEN]) assert.ok(!output.includes(secret));
    }
  } finally {
    // Verify the exact generated directory before recursive removal on Windows.
    if (dirname(resolve(directory)) === root && basename(directory).startsWith('mk9-qa-cli-')) rmSync(directory, { recursive: true, force: true });
  }
});
