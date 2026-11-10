import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allocateUniquePorts, configureSupabasePorts, SUPABASE_PORT_KEYS } from './configure-m37-supabase-ports.mjs';

const config = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
const workflow = readFileSync(new URL('../.github/workflows/m37-recovery-postgres17.yml', import.meta.url), 'utf8');

test('Supabase test ports are unique and every configured service port is updated', () => {
  const ports = Object.fromEntries(SUPABASE_PORT_KEYS.map(([section, key], index) => [`${section}.${key}`, 56000 + index]));
  const configured = configureSupabasePorts(config, ports);
  let section = '';
  const found = {};

  for (const line of configured.split(/\r?\n/)) {
    const sectionMatch = line.match(/^\s*\[([^\]]+)\]/);
    if (sectionMatch) section = sectionMatch[1];
    for (const [targetSection, targetKey] of SUPABASE_PORT_KEYS) {
      const match = line.match(new RegExp(`^\\s*${targetKey}\\s*=\\s*(\\d+)`));
      if (section === targetSection && match) found[`${section}.${targetKey}`] = Number(match[1]);
    }
  }

  assert.deepEqual(found, ports);
  assert.match(configured, /major_version = 17/);
  assert.throws(() => configureSupabasePorts(config, { ...ports, 'db.port': ports['api.port'] }), /must be unique/);
});

test('runner port allocation returns distinct ports that can be bound locally', async () => {
  const ports = await allocateUniquePorts();
  assert.equal(ports.length, SUPABASE_PORT_KEYS.length);
  assert.equal(new Set(ports).size, ports.length);
  assert.ok(ports.every(port => Number.isInteger(port) && port > 0));
});

test('CLI writes the configured database port to the following GitHub Actions steps', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'mk9-m37-ports-'));
  try {
    const configPath = join(tempDir, 'config.toml');
    const githubEnvPath = join(tempDir, 'github-env');
    writeFileSync(configPath, config, 'utf8');
    const utilityPath = fileURLToPath(new URL('./configure-m37-supabase-ports.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [utilityPath, configPath], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_ENV: githubEnvPath }
    });
    assert.equal(result.status, 0, result.stderr);

    const configured = readFileSync(configPath, 'utf8');
    const pgPort = readFileSync(githubEnvPath, 'utf8').match(/^PGPORT=(\d+)$/m)?.[1];
    const dbSection = configured.match(/^\[db\]\r?\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m)?.[1];
    assert.ok(pgPort, 'CLI must export PGPORT for subsequent workflow steps');
    assert.match(dbSection ?? '', new RegExp(`^port = ${pgPort}$`, 'm'));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('workflow diagnoses ports and connects with the PostgreSQL port configured before startup', () => {
  const diagnosis = workflow.indexOf('Diagnose runner ports before starting Supabase');
  const start = workflow.indexOf('Start isolated official Supabase stack');
  assert.ok(diagnosis >= 0 && diagnosis < start);
  assert.match(workflow, /configure-m37-supabase-ports\.mjs" supabase\/config\.toml/);
  assert.doesNotMatch(workflow, /PGPORT:/);
  const utility = readFileSync(new URL('./configure-m37-supabase-ports.mjs', import.meta.url), 'utf8');
  assert.match(utility, /appendFileSync\(process\.env\.GITHUB_ENV, `PGPORT=\$\{databasePort\}\\n`\)/);
});
