import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inspectHomologationTlsPolicy,
  normalizeHomologationPoolerUrl,
  parseHomologationPoolerUrl,
  HOMOLOGATION_REF,
} from './pooler-connection.mjs';

const host = 'aws-1-sa-east-1.pooler.supabase.com';
const base = `postgresql://postgres.${HOMOLOGATION_REF}:secret-pass-token-12345@${host}:5432/postgres`;

test('normalizeHomologationPoolerUrl accepts URL with 0 parameters and appends verify-full & system', () => {
  const normalized = normalizeHomologationPoolerUrl(base);
  const u = new URL(normalized);
  assert.equal(u.searchParams.get('sslmode'), 'verify-full');
  assert.equal(u.searchParams.get('sslrootcert'), 'system');
  assert.equal([...u.searchParams.entries()].length, 2);
});

test('normalizeHomologationPoolerUrl preserves already compliant URL', () => {
  const compliant = `${base}?sslmode=verify-full&sslrootcert=system`;
  const normalized = normalizeHomologationPoolerUrl(compliant);
  assert.equal(normalized, compliant);
});

test('normalizeHomologationPoolerUrl rejects incompatible sslmode or sslrootcert', () => {
  assert.throws(
    () => normalizeHomologationPoolerUrl(`${base}?sslmode=require&sslrootcert=system`),
    /DATABASE_TLS_POLICY_MISMATCH: sslmode parameter is incompatible/
  );
  assert.throws(
    () => normalizeHomologationPoolerUrl(`${base}?sslmode=verify-full&sslrootcert=wrong`),
    /DATABASE_TLS_POLICY_MISMATCH: sslrootcert parameter is incompatible/
  );
});

test('normalizeHomologationPoolerUrl rejects unknown, duplicate, or extra parameters without leaking values', () => {
  assert.throws(
    () => normalizeHomologationPoolerUrl(`${base}?sslmode=verify-full&sslrootcert=system&pgbouncer=true`),
    err => {
      assert.match(err.message, /found 1 additional unauthorized query parameter/);
      assert.equal(err.message.includes('pgbouncer'), false);
      assert.equal(err.message.includes('secret-pass'), false);
      return true;
    }
  );
});

test('parseHomologationPoolerUrl parses clean URL without query string and normalizes it safely', () => {
  const parsed = parseHomologationPoolerUrl(base, host);
  assert.equal(parsed.host, host);
  assert.equal(parsed.port, '5432');
  assert.equal(parsed.user, `postgres.${HOMOLOGATION_REF}`);
  assert.equal(parsed.password, 'secret-pass-token-12345');
  assert.equal(parsed.database, 'postgres');
});

test('parseHomologationPoolerUrl works seamlessly with special characters in password', () => {
  const specialPass = 'p@$$w0rd!#%^&*()-_+=~';
  const encodedPass = encodeURIComponent(specialPass);
  const specialUrl = `postgresql://postgres.${HOMOLOGATION_REF}:${encodedPass}@${host}:5432/postgres`;
  const parsed = parseHomologationPoolerUrl(specialUrl, host);
  assert.equal(parsed.password, specialPass);
  const normalized = normalizeHomologationPoolerUrl(specialUrl);
  assert.equal(normalized.includes('sslmode=verify-full'), true);
});

test('parseHomologationPoolerUrl rejects production targets strictly', () => {
  const prodRef = 'xzmbesqhxcnuokjwrbnw';
  const prodUrl1 = `postgresql://postgres.${prodRef}:pwd@${host}:5432/postgres`;
  assert.throws(() => parseHomologationPoolerUrl(prodUrl1, host), /DATABASE_TARGET_MISMATCH/);

  const prodUrl2 = `postgresql://postgres.${HOMOLOGATION_REF}:pwd@aws-0-us-west-2.pooler.supabase.com:5432/postgres`;
  assert.throws(() => parseHomologationPoolerUrl(prodUrl2, host), /DATABASE_TARGET_MISMATCH/);
});
