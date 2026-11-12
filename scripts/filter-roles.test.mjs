import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { filterRolesSql } from './filter-roles.mjs';

test('filterRolesSql strips CREATE/ALTER for Supabase reserved roles and retains custom roles', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'roles-test-'));
  const input = resolve(dir, 'input.sql');
  const output = resolve(dir, 'output.sql');

  const content = [
    '--',
    '-- Roles',
    '--',
    'CREATE ROLE "anon";',
    'ALTER ROLE "anon" WITH NOSUPERUSER;',
    'CREATE ROLE "supabase_admin";',
    'ALTER ROLE "supabase_admin" WITH SUPERUSER;',
    'CREATE ROLE supabase_auth_admin;',
    'ALTER ROLE supabase_auth_admin WITH SUPERUSER;',
    'CREATE ROLE "my_custom_role";',
    'ALTER ROLE "my_custom_role" WITH LOGIN;',
    'GRANT "anon" TO "postgres";'
  ].join('\n');

  try {
    await writeFile(input, content, 'utf8');
    await filterRolesSql(input, output);
    const result = await readFile(output, 'utf8');

    assert.ok(result.includes('CREATE ROLE "anon";'));
    assert.ok(result.includes('ALTER ROLE "anon" WITH NOSUPERUSER;'));
    assert.ok(result.includes('CREATE ROLE "my_custom_role";'));
    assert.ok(result.includes('ALTER ROLE "my_custom_role" WITH LOGIN;'));
    assert.ok(result.includes('GRANT "anon" TO "postgres";'));

    assert.ok(!result.includes('supabase_admin'));
    assert.ok(!result.includes('supabase_auth_admin'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
