import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLOWED_APPLY_BRANCH,
  REQUIRED_CONFIRMATION,
  AUTHORIZED_RC125_MIGRATION,
  computeNormalizedSha256,
  validateMigrationIntegrity,
  validateDatabaseUrlStrict,
  executeRc125HomologationApply
} from './safe-rc1-25-apply.mjs';
import { ALLOWED_HOMOLOG_PROJECT_REF, FORBIDDEN_PRODUCTION_PROJECT_REF } from './guard-homolog-env.mjs';

test('validateMigrationIntegrity validates RC1.25 migration hash', () => {
  const result = validateMigrationIntegrity();
  assert.equal(result.ok, true);
  assert.equal(result.sha256, AUTHORIZED_RC125_MIGRATION.expectedSha256);
});

test('computeNormalizedSha256 produces identical hash for LF and CRLF line endings', () => {
  const sampleSqlLF = 'SELECT 1;\n-- Test migration\nCREATE TABLE test_tab (id uuid);\n';
  const sampleSqlCRLF = 'SELECT 1;\r\n-- Test migration\r\nCREATE TABLE test_tab (id uuid);\r\n';

  const hashLF = computeNormalizedSha256(sampleSqlLF);
  const hashCRLF = computeNormalizedSha256(sampleSqlCRLF);

  assert.equal(hashLF, hashCRLF);
  assert.equal(typeof hashLF, 'string');
  assert.equal(hashLF.length, 64);
});

test('computeNormalizedSha256 detects actual SQL content alterations', () => {
  const originalSql = 'SELECT 1;\n-- Original statement\n';
  const alteredSql = 'SELECT 2;\n-- Original statement\n';

  const originalHash = computeNormalizedSha256(originalSql);
  const alteredHash = computeNormalizedSha256(alteredSql);

  assert.notEqual(originalHash, alteredHash);
});

test('validateMigrationIntegrity rejects incorrect hash', () => {
  const invalidMigration = {
    ...AUTHORIZED_RC125_MIGRATION,
    expectedSha256: '0000000000000000000000000000000000000000000000000000000000000000'
  };
  const result = validateMigrationIntegrity(invalidMigration);
  assert.equal(result.ok, false);
  assert.match(result.error, /SHA256 mismatch/);
});

test('validateDatabaseUrlStrict accepts valid homologation pooler URL', () => {
  const validUrl = `postgresql://postgres.${ALLOWED_HOMOLOG_PROJECT_REF}:secretpassword@aws-1-sa-east-1.pooler.supabase.com:5432/postgres`;
  const result = validateDatabaseUrlStrict(validUrl, 'aws-1-sa-east-1.pooler.supabase.com');
  assert.equal(result.ok, true);
  assert.equal(result.projectRef, ALLOWED_HOMOLOG_PROJECT_REF);
  assert.equal(result.user, `postgres.${ALLOWED_HOMOLOG_PROJECT_REF}`);
  assert.equal(result.poolerHost, 'aws-1-sa-east-1.pooler.supabase.com');
});

test('validateDatabaseUrlStrict rejects production pooler URL', () => {
  const prodUrl = `postgresql://postgres.${FORBIDDEN_PRODUCTION_PROJECT_REF}:secretpassword@aws-1-sa-east-1.pooler.supabase.com:5432/postgres`;
  const result = validateDatabaseUrlStrict(prodUrl, 'aws-1-sa-east-1.pooler.supabase.com');
  assert.equal(result.ok, false);
});

test('executeRc125HomologationApply rejects invalid branch', async () => {
  await assert.rejects(async () => {
    await executeRc125HomologationApply({
      GITHUB_REF: 'refs/heads/main',
      INPUT_PROJECT_REF: ALLOWED_HOMOLOG_PROJECT_REF,
      INPUT_CONFIRMATION: REQUIRED_CONFIRMATION
    });
  }, /BRANCH_NOT_ALLOWED/);
});

test('executeRc125HomologationApply blocks production project ref immediately', async () => {
  await assert.rejects(async () => {
    await executeRc125HomologationApply({
      GITHUB_REF: `refs/heads/${ALLOWED_APPLY_BRANCH}`,
      INPUT_PROJECT_REF: FORBIDDEN_PRODUCTION_PROJECT_REF,
      INPUT_CONFIRMATION: REQUIRED_CONFIRMATION
    });
  }, /PRODUCTION project/);
});

test('executeRc125HomologationApply requires exact confirmation string', async () => {
  await assert.rejects(async () => {
    await executeRc125HomologationApply({
      GITHUB_REF: `refs/heads/${ALLOWED_APPLY_BRANCH}`,
      INPUT_PROJECT_REF: ALLOWED_HOMOLOG_PROJECT_REF,
      INPUT_CONFIRMATION: 'APLICAR'
    });
  }, /CONFIRMATION_MISMATCH/);
});

test('executeRc125HomologationApply requires SUPABASE_DB_URL', async () => {
  await assert.rejects(async () => {
    await executeRc125HomologationApply({
      GITHUB_REF: `refs/heads/${ALLOWED_APPLY_BRANCH}`,
      INPUT_PROJECT_REF: ALLOWED_HOMOLOG_PROJECT_REF,
      INPUT_CONFIRMATION: REQUIRED_CONFIRMATION,
      SUPABASE_DB_URL: ''
    });
  }, /SUPABASE_DB_URL is missing/);
});
