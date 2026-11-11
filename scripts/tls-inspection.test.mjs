import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inspectHomologationTlsPolicy,
  parseHomologationPoolerUrl,
  HOMOLOGATION_REF,
} from './pooler-connection.mjs';

const host = 'aws-1-sa-east-1.pooler.supabase.com';
const base = `postgresql://postgres.${HOMOLOGATION_REF}:secret-pass-token-12345@${host}:5432/postgres`;

test('inspectHomologationTlsPolicy approves compliant URL', () => {
  const url = `${base}?sslmode=verify-full&sslrootcert=system`;
  const result = inspectHomologationTlsPolicy(url);
  assert.equal(result.valid, true);
  assert.equal(result.issues.length, 0);
  assert.equal(result.summary, 'TLS policy compliant');
});

test('inspectHomologationTlsPolicy identifies when sslmode is missing or incompatible without leaking credentials', () => {
  const url1 = `${base}?sslrootcert=system`;
  const result1 = inspectHomologationTlsPolicy(url1);
  assert.equal(result1.valid, false);
  assert.match(result1.summary, /sslmode parameter is missing/);
  assert.equal(result1.summary.includes('secret-pass'), false);

  const url2 = `${base}?sslmode=require&sslrootcert=system`;
  const result2 = inspectHomologationTlsPolicy(url2);
  assert.equal(result2.valid, false);
  assert.match(result2.summary, /sslmode parameter is incompatible/);
  assert.equal(result2.summary.includes('secret-pass'), false);
});

test('inspectHomologationTlsPolicy identifies when sslrootcert is missing or incompatible', () => {
  const url1 = `${base}?sslmode=verify-full`;
  const result1 = inspectHomologationTlsPolicy(url1);
  assert.equal(result1.valid, false);
  assert.match(result1.summary, /sslrootcert parameter is missing/);

  const url2 = `${base}?sslmode=verify-full&sslrootcert=insecure-cert`;
  const result2 = inspectHomologationTlsPolicy(url2);
  assert.equal(result2.valid, false);
  assert.match(result2.summary, /sslrootcert parameter is incompatible/);
});

test('inspectHomologationTlsPolicy reports count of additional parameters without revealing their names or values', () => {
  // If an attacker/user puts an arbitrary parameter with sensitive info e.g. token=secret-token-xyz
  const url = `${base}?sslmode=verify-full&sslrootcert=system&token=secret-token-xyz&pgbouncer=true`;
  const result = inspectHomologationTlsPolicy(url);
  assert.equal(result.valid, false);
  assert.match(result.summary, /found 2 additional unauthorized query parameter\(s\)/);
  // Ensure the parameter value or name is NEVER printed
  assert.equal(result.summary.includes('secret-token-xyz'), false);
});

test('inspectHomologationTlsPolicy detects duplicated parameters safely', () => {
  const url = `${base}?sslmode=verify-full&sslmode=verify-full&sslrootcert=system`;
  const result = inspectHomologationTlsPolicy(url);
  assert.equal(result.valid, false);
  assert.match(result.summary, /sslmode parameter is duplicated/);
});

test('parseHomologationPoolerUrl throws DATABASE_TLS_POLICY_MISMATCH with safe non-sensitive category', () => {
  assert.throws(
    () => parseHomologationPoolerUrl(`${base}?sslmode=require&sslrootcert=system`, host),
    err => {
      assert.match(err.message, /DATABASE_TLS_POLICY_MISMATCH: sslmode parameter is incompatible/);
      assert.equal(err.message.includes('secret-pass'), false);
      return true;
    }
  );
});
