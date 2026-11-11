import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inspectHomologationTlsPolicy,
  parseHomologationPoolerUrl,
  HOMOLOGATION_REF,
} from './pooler-connection.mjs';

const host = 'aws-1-sa-east-1.pooler.supabase.com';
const base = `postgresql://postgres.${HOMOLOGATION_REF}:dummy-secret@${host}:5432/postgres`;

test('inspectHomologationTlsPolicy approves compliant URL', () => {
  const url = `${base}?sslmode=verify-full&sslrootcert=system`;
  const result = inspectHomologationTlsPolicy(url);
  assert.equal(result.valid, true);
  assert.equal(result.issues.length, 0);
  assert.equal(result.summary, 'TLS policy compliant');
});

test('inspectHomologationTlsPolicy identifies when sslmode is not verify-full', () => {
  const url = `${base}?sslmode=require&sslrootcert=system`;
  const result = inspectHomologationTlsPolicy(url);
  assert.equal(result.valid, false);
  assert.match(result.summary, /sslmode is "require"/);
});

test('inspectHomologationTlsPolicy identifies when sslrootcert is missing or wrong', () => {
  const url = `${base}?sslmode=verify-full`;
  const result = inspectHomologationTlsPolicy(url);
  assert.equal(result.valid, false);
  assert.match(result.summary, /sslrootcert is null/);
});

test('inspectHomologationTlsPolicy identifies presence of unexpected keys such as pgbouncer', () => {
  const url = `${base}?sslmode=verify-full&sslrootcert=system&pgbouncer=true`;
  const result = inspectHomologationTlsPolicy(url);
  assert.equal(result.valid, false);
  assert.match(result.summary, /unexpected query parameter keys: pgbouncer/);
  assert.match(result.summary, /query parameter count is 3/);
});

test('inspectHomologationTlsPolicy identifies multiple simultaneous non-compliances safely without leaking credentials', () => {
  const url = `${base}?sslmode=require`;
  const result = inspectHomologationTlsPolicy(url);
  assert.equal(result.valid, false);
  // Summary should not contain password or user credentials
  assert.equal(result.summary.includes('dummy-secret'), false);
  assert.match(result.summary, /sslmode is "require"/);
  assert.match(result.summary, /sslrootcert is null/);
});

test('parseHomologationPoolerUrl throws DATABASE_TLS_POLICY_MISMATCH with descriptive message', () => {
  assert.throws(
    () => parseHomologationPoolerUrl(`${base}?sslmode=require`, host),
    /DATABASE_TLS_POLICY_MISMATCH: sslmode is "require"/
  );
});
