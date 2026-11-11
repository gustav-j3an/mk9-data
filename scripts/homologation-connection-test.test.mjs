import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLOWED_CONNECTION_TEST_BRANCH,
  validateConnectionTestConfig,
  verifyPoolerDnsResolution,
  parseSessionInspectionResult,
  verifySupabaseCaCertificate,
} from './homologation-connection-test.mjs';
import { HOMOLOGATION_REF, SUPABASE_CA_SHA256 } from './pooler-connection.mjs';

const poolerHost = 'aws-1-sa-east-1.pooler.supabase.com';
const validDbUrl = `postgresql://postgres.${HOMOLOGATION_REF}:dummy-secret@${poolerHost}:5432/postgres?sslmode=verify-full&sslrootcert=system`;

const validEnv = {
  GITHUB_REF: `refs/heads/${ALLOWED_CONNECTION_TEST_BRANCH}`,
  INPUT_PROJECT_REF: HOMOLOGATION_REF,
  SUPABASE_PROJECT_REF: HOMOLOGATION_REF,
  SUPABASE_DB_URL: validDbUrl,
  SUPABASE_POOLER_HOST: poolerHost,
};

test('verifySupabaseCaCertificate validates official certificate file and rejects tampered files', () => {
  const verified = verifySupabaseCaCertificate();
  assert.equal(verified.verified, true);
  assert.equal(verified.fingerprint256, SUPABASE_CA_SHA256);
  assert.match(verified.subject, /Supabase Root 2021 CA/);

  assert.throws(
    () => verifySupabaseCaCertificate('non-existent-cert.crt'),
    /CA_CERT_FILE_NOT_FOUND/
  );
});

test('validateConnectionTestConfig accepts exact valid configuration', () => {
  const result = validateConnectionTestConfig(validEnv);
  assert.equal(result.projectRef, HOMOLOGATION_REF);
  assert.equal(result.poolerHost, poolerHost);
  assert.equal(result.parsed.host, poolerHost);
  assert.equal(result.parsed.port, '5432');
  assert.equal(result.parsed.user, `postgres.${HOMOLOGATION_REF}`);
  assert.equal(result.parsed.database, 'postgres');
});

test('validateConnectionTestConfig blocks unapproved branch', () => {
  assert.throws(
    () => validateConnectionTestConfig({ ...validEnv, GITHUB_REF: 'refs/heads/main' }),
    /BRANCH_NOT_ALLOWED/
  );
  assert.throws(
    () => validateConnectionTestConfig({ ...validEnv, GITHUB_REF: 'refs/heads/codex/m42.2-m39-session-pooler' }),
    /BRANCH_NOT_ALLOWED/
  );
});

test('validateConnectionTestConfig blocks project ref mismatch or production targets', () => {
  assert.throws(
    () => validateConnectionTestConfig({ ...validEnv, INPUT_PROJECT_REF: 'xzmbesqhxcnuokjwrbnw' }),
    /PROJECT_REF_MISMATCH/
  );
  assert.throws(
    () => validateConnectionTestConfig({ ...validEnv, SUPABASE_PROJECT_REF: 'xzmbesqhxcnuokjwrbnw' }),
    /PROJECT_REF_MISMATCH/
  );
  // Production pooler host or direct db host
  assert.throws(
    () => validateConnectionTestConfig({
      ...validEnv,
      SUPABASE_DB_URL: 'postgresql://postgres.xzmbesqhxcnuokjwrbnw:pwd@aws-1-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=verify-full&sslrootcert=system',
    }),
    /DATABASE_TARGET_MISMATCH/
  );
  assert.throws(
    () => validateConnectionTestConfig({
      ...validEnv,
      SUPABASE_DB_URL: `postgresql://postgres.${HOMOLOGATION_REF}:pwd@db.tafjceemuetqjyngresg.supabase.co:5432/postgres?sslmode=verify-full&sslrootcert=system`,
    }),
    /DATABASE_TARGET_MISMATCH/
  );
});

test('validateConnectionTestConfig rejects missing config or insecure TLS params', () => {
  assert.throws(
    () => validateConnectionTestConfig({ ...validEnv, SUPABASE_DB_URL: '' }),
    /REQUIRED_CONFIG_MISSING/
  );
  assert.throws(
    () => validateConnectionTestConfig({ ...validEnv, SUPABASE_POOLER_HOST: '' }),
    /REQUIRED_CONFIG_MISSING/
  );
  assert.throws(
    () => validateConnectionTestConfig({
      ...validEnv,
      SUPABASE_DB_URL: `postgresql://postgres.${HOMOLOGATION_REF}:pwd@${poolerHost}:5432/postgres?sslmode=require&sslrootcert=system`,
    }),
    /DATABASE_TLS_POLICY_MISMATCH/
  );
});

test('parseSessionInspectionResult handles postgres user and postgres.<ref> on PostgreSQL 17', () => {
  const res1 = parseSessionInspectionResult('postgres|postgres|171100');
  assert.equal(res1.currentDatabase, 'postgres');
  assert.equal(res1.currentUser, 'postgres');
  assert.equal(res1.serverVersionNum, 171100);
  assert.equal(res1.isPostgres17, true);

  const res2 = parseSessionInspectionResult(`postgres|postgres.${HOMOLOGATION_REF}|170002\n`);
  assert.equal(res2.currentDatabase, 'postgres');
  assert.equal(res2.currentUser, `postgres.${HOMOLOGATION_REF}`);
  assert.equal(res2.serverVersionNum, 170002);
  assert.equal(res2.isPostgres17, true);
});

test('parseSessionInspectionResult rejects invalid databases, wrong users, and non-PG17 engines', () => {
  assert.throws(() => parseSessionInspectionResult('template1|postgres|171100'), /DATABASE_MISMATCH/);
  assert.throws(() => parseSessionInspectionResult('postgres|postgres.otherproject|171100'), /USER_MISMATCH/);
  assert.throws(() => parseSessionInspectionResult('postgres|unknown_user|171100'), /USER_MISMATCH/);
  assert.throws(() => parseSessionInspectionResult('postgres|postgres|160005'), /POSTGRESQL_VERSION_MISMATCH/);
  assert.throws(() => parseSessionInspectionResult('postgres|postgres|180000'), /POSTGRESQL_VERSION_MISMATCH/);
  assert.throws(() => parseSessionInspectionResult(''), /EMPTY_DATABASE_RESPONSE/);
  assert.throws(() => parseSessionInspectionResult('invalid_format'), /UNEXPECTED_DATABASE_RESPONSE_FORMAT/);
});

test('verifyPoolerDnsResolution validates input parameters', async () => {
  await assert.rejects(() => verifyPoolerDnsResolution(''), /INVALID_HOST/);
  await assert.rejects(() => verifyPoolerDnsResolution(null), /INVALID_HOST/);
});
