import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const recoveryScript = readFileSync(new URL('./m37-recovery-postgres17.sh', import.meta.url), 'utf8');
const pgCronPreflight = readFileSync(new URL('./m37-pg-cron-preflight.sh', import.meta.url), 'utf8');
const workflow = readFileSync(new URL('../.github/workflows/m37-recovery-postgres17.yml', import.meta.url), 'utf8');
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

test('M38 disposable PostgreSQL preflight installs and verifies the real pg_cron module before migrations', () => {
  const available = pgCronPreflight.indexOf('pg_available_extensions WHERE name=\'pg_cron\'');
  const preloaded = pgCronPreflight.indexOf("'pg_cron' = ANY (regexp_split_to_array(current_setting('shared_preload_libraries')");
  const database = pgCronPreflight.indexOf("current_setting('cron.database_name', true) = current_database()");
  const install = pgCronPreflight.indexOf("CREATE EXTENSION IF NOT EXISTS pg_cron");
  const installed = pgCronPreflight.indexOf("pg_extension WHERE extname='pg_cron'");
  const objects = pgCronPreflight.indexOf("to_regnamespace('cron') IS NOT NULL");

  for (const [label, position] of Object.entries({ available, preloaded, database, install, installed, objects })) {
    assert.ok(position >= 0, `preflight must check ${label}`);
  }
  assert.ok(available < preloaded && preloaded < database && database < install && install < installed && installed < objects,
    'pg_cron availability, preload and database config must pass before installation and object checks');
  assert.match(pgCronPreflight, /to_regclass\('cron\.job'\) IS NOT NULL/);
  assert.match(recoveryScript, /bash scripts\/m37-pg-cron-preflight\.sh/);
});

test('pg_cron diagnostic catalogs are recorded before any preflight assertion can fail', () => {
  const diagnosticStart = pgCronPreflight.indexOf('=== PostgreSQL 17 pg_cron configuration diagnostics (read-only) ===');
  const firstAssertion = pgCronPreflight.indexOf('assert_psql_true "server is PostgreSQL 17"');
  assert.ok(diagnosticStart >= 0 && firstAssertion > diagnosticStart,
    'diagnostics must run before the first failing prerequisite assertion');

  const diagnosticSection = pgCronPreflight.slice(diagnosticStart, firstAssertion);
  for (const required of [
    "current_setting('server_version')",
    "current_setting('server_version_num')",
    "SELECT name, setting, source, sourcefile, pending_restart",
    "current_setting('cron.database_name', true)",
    'FROM pg_file_settings',
    'sourceline, name, setting, applied, error',
    'FROM pg_available_extensions',
    'default_version, installed_version',
    'FROM pg_extension',
    'extname, extversion'
  ]) {
    assert.ok(diagnosticSection.includes(required), `diagnostics must record ${required}`);
  }
  assert.match(diagnosticSection, /name IN \('shared_preload_libraries', 'cron\.database_name'\)/);
  assert.match(diagnosticSection, /coalesce\(current_setting\('cron\.database_name', true\), '<absent>'\)/);
  assert.match(diagnosticSection, /WHERE name = 'pg_cron'/);
  assert.match(diagnosticSection, /WHERE extname = 'pg_cron'/);
});

test('GitHub Actions runs pg_cron preflight before npm install, tests, typecheck, build and migrations', () => {
  const position = marker => {
    const found = workflow.indexOf(marker);
    assert.ok(found >= 0, `workflow must include ${marker}`);
    return found;
  };
  const start = position('name: Start isolated official Supabase stack');
  const preflight = position('name: Verify and install pg_cron in disposable PostgreSQL 17');
  const install = position('name: Install npm dependencies');
  const tests = position('name: Run complete npm test suite');
  const typecheck = position('name: Run TypeScript typecheck');
  const build = position('name: Build production bundle');
  const migrations = position('name: Simulate homologation ledger, migrations and functional suites');

  assert.ok(start < preflight && preflight < install && install < tests && tests < typecheck && typecheck < build && build < migrations,
    'the database must pass pg_cron preflight before the full verification workload');
  assert.match(workflow, /curl -fsSL https:\/\/github\.com\/supabase\/cli\/releases\/download\/v3\.0\.0\//);
  assert.match(workflow, /configure-m37-supabase-ports\.mjs/);
  assert.match(workflow, /bash scripts\/m37-pg-cron-preflight\.sh/);
  assert.match(workflow, /name: Capture PostgreSQL and container diagnostics\s+if: always\(\)/);
  assert.match(workflow, /name: Stop isolated stack\s+if: always\(\)/);
});
