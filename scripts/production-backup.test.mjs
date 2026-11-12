import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRODUCTION_REF,
  ALLOWED_BACKUP_BRANCH,
  SUPABASE_CA_CERT_PATH,
  SUPABASE_CA_SHA256,
  normalizeProductionPoolerUrl,
  inspectProductionTlsPolicy,
  parseProductionPoolerUrl,
} from './production-pooler-connection.mjs';
import { validateProductionBackupConfig, verifySupabaseCaCertificate } from './production-preflight.mjs';
import { assertSourceTarget, assertLocalRestoreTarget, resolveObjectPath } from './production-storage-backup.mjs';

test('production-pooler-connection: rejects non-production project ref', () => {
  assert.equal(PRODUCTION_REF, 'xzmbesqhxcnuokjwrbnw');
  assert.equal(ALLOWED_BACKUP_BRANCH, 'codex/m57.2-production-backup-workflow');

  // Attempting to use homologation ref should fail
  assert.throws(
    () => parseProductionPoolerUrl('postgresql://postgres.tafjceemuetqjyngresg:secret@aws-0-sa-east-1.pooler.supabase.com:5432/postgres', 'aws-0-sa-east-1.pooler.supabase.com'),
    /DATABASE_TARGET_MISMATCH/
  );
});

test('production-pooler-connection: normalizes clean pooler url with TLS params', () => {
  const cleanUrl = 'postgresql://postgres.xzmbesqhxcnuokjwrbnw:secret@aws-0-sa-east-1.pooler.supabase.com:5432/postgres';
  const normalized = normalizeProductionPoolerUrl(cleanUrl);
  const u = new URL(normalized);
  assert.equal(u.searchParams.get('sslmode'), 'verify-full');
  assert.equal(u.searchParams.get('sslrootcert'), SUPABASE_CA_CERT_PATH);

  const parsed = parseProductionPoolerUrl(cleanUrl, 'aws-0-sa-east-1.pooler.supabase.com');
  assert.equal(parsed.host, 'aws-0-sa-east-1.pooler.supabase.com');
  assert.equal(parsed.user, 'postgres.xzmbesqhxcnuokjwrbnw');
  assert.equal(parsed.database, 'postgres');
});

test('production-preflight: verifies official Supabase CA certificate', () => {
  const caInfo = verifySupabaseCaCertificate();
  assert.equal(caInfo.verified, true);
  assert.equal(caInfo.fingerprint256, SUPABASE_CA_SHA256);
});

test('production-preflight: rejects invalid branch, invalid ref or missing secrets', () => {
  const validJwt = [
    Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify({ role: 'service_role', ref: 'xzmbesqhxcnuokjwrbnw' })).toString('base64url'),
    'dummy_sig'
  ].join('.');

  const validEnv = {
    GITHUB_REF: 'refs/heads/codex/m57.2-production-backup-workflow',
    INPUT_PROJECT_REF: 'xzmbesqhxcnuokjwrbnw',
    INPUT_CONFIRM_ARTIFACT_ACCESS: 'true',
    SUPABASE_PROJECT_REF: 'xzmbesqhxcnuokjwrbnw',
    SUPABASE_PROJECT_URL: 'https://xzmbesqhxcnuokjwrbnw.supabase.co',
    SUPABASE_POOLER_HOST: 'aws-0-sa-east-1.pooler.supabase.com',
    SUPABASE_DB_URL: 'postgresql://postgres.xzmbesqhxcnuokjwrbnw:secret@aws-0-sa-east-1.pooler.supabase.com:5432/postgres',
    SUPABASE_SERVICE_ROLE_KEY: validJwt,
    BACKUP_GPG_PASSPHRASE: 'a-very-secure-32-byte-passphrase-production-key!',
  };

  assert.equal(validateProductionBackupConfig(validEnv), true);

  // Wrong branch
  assert.throws(() => validateProductionBackupConfig({ ...validEnv, GITHUB_REF: 'refs/heads/main' }), /BRANCH_NOT_ALLOWED/);

  // Wrong project ref
  assert.throws(() => validateProductionBackupConfig({ ...validEnv, INPUT_PROJECT_REF: 'tafjceemuetqjyngresg' }), /PROJECT_REF_MISMATCH/);

  // Missing confirmation
  assert.throws(() => validateProductionBackupConfig({ ...validEnv, INPUT_CONFIRM_ARTIFACT_ACCESS: 'false' }), /ARTIFACT_ACCESS_CONFIRMATION_REQUIRED/);
});

test('production-storage-backup: path resolution and target guards', () => {
  assert.equal(assertLocalRestoreTarget('http://127.0.0.1:54321'), true);
  assert.throws(() => assertLocalRestoreTarget('https://xzmbesqhxcnuokjwrbnw.supabase.co'), /RESTORE_TARGET_MUST_BE_LOCAL/);

  const safePath = resolveObjectPath('C:/temp/export/storage', 'visit-photos', 'folder/photo.jpg');
  assert.match(safePath, /photo\.jpg$/);

  assert.throws(() => resolveObjectPath('C:/temp/export/storage', '..', 'photo.jpg'), /UNSAFE_STORAGE_PATH/);
  assert.throws(() => resolveObjectPath('C:/temp/export/storage', 'visit-photos', '../../etc/passwd'), /UNSAFE_STORAGE_PATH/);
});
