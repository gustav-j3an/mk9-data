import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveSupabaseTestApiUrl } from './m37-supabase-test-api-url.mjs';

const m37 = readFileSync(new URL('./m37-functional-tests.mjs', import.meta.url), 'utf8');
const m38 = readFileSync(new URL('./m38-functional-tests.mjs', import.meta.url), 'utf8');

test('M37 and M38 functional suites use the dynamic disposable Supabase API URL', () => {
  const status = 'API_URL="http://127.0.0.1:38967"\nDB_URL="postgresql://postgres:secret@127.0.0.1:56789/postgres"';
  assert.equal(resolveSupabaseTestApiUrl(undefined, status), 'http://127.0.0.1:38967');
  for (const source of [m37, m38]) {
    assert.match(source, /resolveSupabaseTestApiUrl\(process\.env\.SUPABASE_TEST_API_URL, status\)/);
    assert.doesNotMatch(source, /127\.0\.0\.1:54321/);
    assert.doesNotMatch(source, /DB_URL|PGPORT/);
  }
});

test('explicit API URL is honored only when it points to a local disposable stack', () => {
  assert.equal(resolveSupabaseTestApiUrl('http://localhost:45678/', ''), 'http://localhost:45678');
  assert.throws(() => resolveSupabaseTestApiUrl('https://project.supabase.co', ''), /non-local/);
  assert.throws(() => resolveSupabaseTestApiUrl(undefined, 'DB_URL="postgresql://localhost:5432/postgres"'), /URL is missing/);
});
