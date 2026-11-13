import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { assertInventoryInvariant } from './m58-4-assert-invariance.mjs';
import { assertLedgerTransition, RECONCILED_VERSIONS } from './m58-4-assert-ledger-transition.mjs';
import { assertDisposableConnectionProbe, assertDisposableTarget, extractContainerNetworkAddresses } from './m58-4-disposable-target.mjs';
import { assertFunctionBodyHash, EXPECTED_FUNCTIONS, sourceFunctionBody } from './m58-4-verify-function-bodies.mjs';

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
    const before = { tables_and_row_counts: [{ schema: 'public', table: 'synthetic', rows: 0, data_sha256: 'a' }, { schema: 'supabase_migrations', table: 'schema_migrations', rows: 17, data_sha256: 'b', owner: 'postgres', acl: '', rls: false, force_rls: false }], policies: [] };
    const after = structuredClone(before);
    after.tables_and_row_counts[1].data_sha256 = 'c';
    after.tables_and_row_counts[1].rows = 23;
    const a = path.join(dir, 'before.json');
    const b = path.join(dir, 'after.json');
    await writeFile(a, JSON.stringify(before));
    await writeFile(b, JSON.stringify(after));
    let result = spawnSync(process.execPath, ['scripts/m58-4-assert-invariance.mjs', a, b], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const structuralLedgerChange = structuredClone(after);
    structuralLedgerChange.tables_and_row_counts[1].owner = 'unexpected_owner';
    assert.throws(() => assertInventoryInvariant(before, structuralLedgerChange), /NON_LEDGER_INVARIANCE_FAILED/);
    after.tables_and_row_counts[0].data_sha256 = 'different';
    await writeFile(b, JSON.stringify(after));
    result = spawnSync(process.execPath, ['scripts/m58-4-assert-invariance.mjs', a, b], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}${result.stderr}`, /M58_4_NON_LEDGER_INVARIANCE_FAILED/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('inventory comparison rejects unexpected schema, ACL, policy, and non-ledger data changes', () => {
  const baseline = {
    tables_and_row_counts: [
      { schema: 'public', table: 'visits', rows: 2, data_sha256: 'aa', owner: 'postgres', acl: '', rls: true, force_rls: false },
      { schema: 'supabase_migrations', table: 'schema_migrations', rows: 17, data_sha256: 'bb', owner: 'postgres', acl: '', rls: false, force_rls: false },
    ],
    constraints: [{ name: 'visits_key', definition: 'UNIQUE (id)' }],
    policies: [{ name: 'visits_select', qual: 'true' }],
  };
  for (const mutate of [
    (x) => { x.tables_and_row_counts[0].rows += 1; },
    (x) => { x.tables_and_row_counts[0].acl = '{authenticated=r/postgres}'; },
    (x) => { x.constraints[0].definition = 'CHECK (true)'; },
    (x) => { x.policies[0].qual = 'false'; },
    (x) => { x.tables_and_row_counts[1].rls = true; },
  ]) {
    const altered = structuredClone(baseline);
    mutate(altered);
    assert.throws(() => assertInventoryInvariant(baseline, altered), /NON_LEDGER_INVARIANCE_FAILED/);
  }
});

test('ledger transition permits only six exact synthetic records and preserves prior entries', () => {
  const before = Array.from({ length: 17 }, (_, i) => ({ version: `202609${String(i + 1).padStart(2, '0')}`, statements: ['synthetic baseline only'], name: 'synthetic_baseline' }));
  const after = [...before, ...RECONCILED_VERSIONS.map((version) => ({ version, statements: ['synthetic ledger simulation'], name: null }))];
  assert.equal(assertLedgerTransition(before, after), true);
  const unexpected = [...after, { version: '20261101000000', statements: ['extra'], name: null }];
  assert.throws(() => assertLedgerTransition(before, unexpected), /FINAL_COUNT_INVALID|UNEXPECTED_LEDGER_VERSION/);
  const modified = structuredClone(after);
  modified[0].statements[0] = 'changed baseline';
  assert.throws(() => assertLedgerTransition(before, modified), /EXISTING_LEDGER_ROW_CHANGED/);
  const alteredCandidate = structuredClone(after);
  alteredCandidate[17].statements[0] = 'unexpected SQL';
  assert.throws(() => assertLedgerTransition(before, alteredCandidate), /RECONCILIATION_LEDGER_ROW_INVALID/);
});

test('disposable connection guard rejects wrong host, database, identity and server/container probe', () => {
  const projectId = `mk9_synth_${'a'.repeat(28)}`;
  const nonce = 'a'.repeat(28);
  const databaseUrl = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable';
  assert.equal(assertDisposableTarget({ databaseUrl, projectId, nonce }), true);
  for (const invalidUrl of [
    databaseUrl.replace('127.0.0.1', 'prod.example.com'),
    databaseUrl.replace(':54322/', ':5432/'),
    databaseUrl.replace('/postgres?', '/production?'),
  ]) assert.throws(() => assertDisposableTarget({ databaseUrl: invalidUrl, projectId, nonce }), /NOT_DISPOSABLE/);
  assert.throws(() => assertDisposableTarget({ databaseUrl, projectId: 'mk9_synth_other', nonce }), /IDENTITY_INVALID/);
  const goodProbe = { database: 'postgres', serverAddress: '172.20.0.4', serverPort: 5432, serverVersionNum: 170005, nonceCount: 1, containerIps: '172.20.0.4' };
  assert.equal(assertDisposableConnectionProbe(goodProbe), true);
  const inspectNetworks = JSON.stringify({
    bridge: { IPAddress: ' 172.20.0.4 ', GlobalIPv6Address: '' },
    secondary: { IPAddress: '172.21.0.7/16', GlobalIPv6Address: '2001:0db8:0000:0000:0000:0000:0000:0001' },
  });
  assert.deepEqual(extractContainerNetworkAddresses(inspectNetworks), ['172.20.0.4', '172.21.0.7', '2001:db8::1']);
  assert.equal(assertDisposableConnectionProbe({
    ...goodProbe, serverAddress: '::ffff:172.20.0.4', containerIps: inspectNetworks,
  }), true);
  assert.equal(assertDisposableConnectionProbe({
    ...goodProbe, serverAddress: '::ffff:ac14:0004', containerIps: inspectNetworks,
  }), true);
  assert.equal(assertDisposableConnectionProbe({
    ...goodProbe, serverAddress: '2001:db8::1', serverPort: '5432', containerIps: inspectNetworks,
  }), true);
  assert.deepEqual(extractContainerNetworkAddresses(' 172.20.0.4,\n172.21.0.7, '), ['172.20.0.4', '172.21.0.7']);
  assert.deepEqual(extractContainerNetworkAddresses('{invalid json'), []);
  for (const changes of [
    { serverAddress: '172.20.0.99' }, { database: 'production' }, { serverPort: 5433 },
    { serverVersionNum: 160000 }, { nonceCount: 0 }, { nonceCount: 2 },
  ]) assert.throws(() => assertDisposableConnectionProbe({ ...goodProbe, ...changes }));
  assert.throws(() => assertDisposableConnectionProbe({ ...goodProbe, containerIps: '{invalid json' }), /no-valid-container-addresses/);
  assert.throws(() => assertDisposableConnectionProbe({
    ...goodProbe, serverAddress: '172.20.0.99', containerIps: inspectNetworks,
  }), (error) => /server=172\.20\.0\.99/.test(error.message) && /docker=172\.20\.0\.4,172\.21\.0\.7,2001:db8::1/.test(error.message));
});

test('fixed function fingerprints detect altered SQL and recognize all six migration function sources', async () => {
  assert.equal(EXPECTED_FUNCTIONS.length, 10);
  for (const item of EXPECTED_FUNCTIONS) {
    const sql = await readFile(`supabase/migrations/${item.file}`, 'utf8');
    const body = sourceFunctionBody(sql, item.name);
    assert.equal(assertFunctionBodyHash(item.hash, body, item.name), true);
    assert.throws(() => assertFunctionBodyHash(item.hash, `${body}\n-- altered`, item.name), /FUNCTION_BODY_DIVERGED/);
  }
});

test('contract ACL assertion diagnoses effective, direct, and PUBLIC grants separately', async () => {
  const assertion = await readFile('scripts/m58-4-assert-migration-objects.sql', 'utf8');
  const migration = await readFile('supabase/migrations/20261017120000_create_contratos_lojas_table.sql', 'utf8');
  for (const marker of [
    'M58_4_CONTRACT_SYNC_AUTHENTICATED_EXECUTE_MISSING',
    'M58_4_CONTRACT_SYNC_ANON_EXECUTE_UNEXPECTED',
    'M58_4_CONTRACT_SYNC_SERVICE_ROLE_EXECUTE_UNEXPECTED',
    'M58_4_CONTRACT_OVERLAP_TRIGGER_ANON_EXECUTE_UNEXPECTED',
    'M58_4_CONTRACT_OVERLAP_TRIGGER_API_ROLE_EXECUTE_UNEXPECTED',
    'M58_4_CONTRACT_UPDATED_AT_TRIGGER_ANON_EXECUTE_UNEXPECTED',
    'M58_4_CONTRACT_UPDATED_AT_TRIGGER_API_ROLE_EXECUTE_UNEXPECTED',
  ]) assert.ok(assertion.includes(marker), `missing ACL diagnostic: ${marker}`);
  assert.equal((assertion.match(/has_function_privilege\('anon'/g) ?? []).length, 6);
  assert.equal((assertion.match(/aclexplode\(COALESCE\(proacl, acldefault\('f',proowner\)\)\)/g) ?? []).length, 6);
  assert.match(assertion, /a\.grantee=0 AND a\.privilege_type='EXECUTE'/);
  assert.match(assertion, /a\.grantee=\(SELECT oid FROM pg_roles WHERE rolname='anon'\).*a\.privilege_type='EXECUTE'/s);
  assert.match(assertion, /pg_has_role\('anon','authenticated','USAGE'\)/);
  assert.match(migration, /REVOKE EXECUTE ON FUNCTION public\.check_contratos_vigencia_overlap\(\) FROM PUBLIC, anon, authenticated, service_role;/);
  assert.match(migration, /REVOKE EXECUTE ON FUNCTION public\.handle_contratos_updated_at\(\) FROM PUBLIC, anon, authenticated, service_role;/);
  assert.match(migration, /REVOKE EXECUTE ON FUNCTION public\.sync_contratos_from_rotas\(\) FROM PUBLIC, anon, authenticated, service_role;/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.sync_contratos_from_rotas\(\) TO authenticated;/);
});

test('synthetic workflow has no environment secrets and checks for remote configuration', async () => {
  const workflow = await readFile('.github/workflows/m58-4-synthetic-reconciliation.yml', 'utf8');
  const script = await readFile('scripts/m58-4-synthetic-reconciliation.sh', 'utf8');
  const assertion = await readFile('scripts/m58-4-assert-migration-objects.sql', 'utf8');
  const fixture = await readFile('scripts/m58-4-synthetic-fixture.sql', 'utf8');
  assert.doesNotMatch(workflow, /secrets\./i);
  assert.doesNotMatch(workflow, /^\s+environment:/mi);
  assert.doesNotMatch(workflow, /upload-artifact|cache:/i);
  assert.match(workflow, /permissions:\s+contents:\s+read/);
  assert.ok([...workflow.matchAll(/uses:\s*([^\s#]+)/g)].every(([, action]) => /@[0-9a-f]{40}$/i.test(action)));
  assert.match(workflow, /export PATH="\/usr\/lib\/postgresql\/17\/bin:\$PATH"/);
  assert.match(workflow, /command -v psql\)" = '\/usr\/lib\/postgresql\/17\/bin\/psql'/);
  assert.match(workflow, /command -v pg_dump\)" = '\/usr\/lib\/postgresql\/17\/bin\/pg_dump'/);
  assert.match(workflow, /psql --version \| grep -q '\^psql \(PostgreSQL\) 17\\\.'/);
  assert.match(workflow, /pg_dump --version \| grep -q '\^pg_dump \(PostgreSQL\) 17\\\.'/);
  assert.match(workflow, /workflow_dispatch/);
  assert.match(script, /REMOTE_SUPABASE_CONFIGURATION_PRESENT/);
  assert.match(script, /mk9_disposable_nonce/);
  assert.match(script, /docker inspect --format '\{\{json \.NetworkSettings\.Networks\}\}'/);
  assert.match(script, /resolve-disposable-container\.mjs .*public\.mk9_disposable_nonce/);
  assert.match(script, /m58-4-verify-function-bodies\.mjs/);
  assert.match(script, /m58-4-assert-ledger-transition\.mjs/);
  assert.match(script, /inet_server_addr/);
  assert.match(script, /127\.0\.0\.1:54322/);
  assert.match(script, /m58-4-assert-migration-objects\.sql/);
  assert.match(script, /expect_acl_rejection M58_4_CONTRACT_SYNC_ANON_EXECUTE_UNEXPECTED/);
  assert.match(script, /GRANT EXECUTE ON FUNCTION public\.sync_contratos_from_rotas\(\) TO PUBLIC/);
  assert.match(assertion, /has_function_privilege\('authenticated','public\.sync_contratos_from_rotas\(\)','EXECUTE'\)/);
  assert.match(assertion, /has_function_privilege\('service_role','public\.sync_contratos_from_rotas\(\)','EXECUTE'\)/);
  assert.match(script, /ALTER TABLE public\.system_settings RENAME COLUMN value/);
  assert.match(script, /ALTER POLICY system_settings_select_authenticated/);
  assert.match(fixture, /M58_4_SUPABASE_SYSTEM_OBJECTS_MISSING/);
  assert.doesNotMatch(fixture, /CREATE\s+(?:TABLE|OR REPLACE FUNCTION)\s+(?:IF NOT EXISTS\s+)?(?:auth\.|storage\.)/i);
  assert.doesNotMatch(fixture, /ALTER TABLE\s+storage\.objects/i);
});
