import test from 'node:test';
import assert from 'node:assert/strict';
import { HOMOLOGATION_REF, assertLocalRestoreTarget, assertSourceTarget, resolveObjectPath } from './storage-backup.mjs';
import { validateBackupConfig } from './preflight.mjs';

const jwt = payload => `x.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.x`;
const valid = {
  GITHUB_REF: 'refs/heads/codex/m38-backup-actions',
  INPUT_PROJECT_REF: HOMOLOGATION_REF,
  SUPABASE_PROJECT_REF: HOMOLOGATION_REF,
  SUPABASE_PROJECT_URL: `https://${HOMOLOGATION_REF}.supabase.co`,
  SUPABASE_DB_URL: `postgresql://postgres:placeholder@db.${HOMOLOGATION_REF}.supabase.co:5432/postgres?sslmode=require`,
  SUPABASE_SERVICE_ROLE_KEY: 'placeholder', BACKUP_GPG_PASSPHRASE: 'x'.repeat(40),
  AWS_ACCESS_KEY_ID: 'placeholder', AWS_SECRET_ACCESS_KEY: 'placeholder',
  INPUT_CONFIRM_PRIVATE_DESTINATION: 'true', BACKUP_S3_ENDPOINT_URL: 'https://example-r2.invalid',
  BACKUP_S3_BUCKET: 'mk9-private-backups', BACKUP_S3_REGION: 'auto', BACKUP_S3_PREFIX: 'homologation/mk9',
};

test('staging endpoints and JWT project claims are exact', () => {
  assert.equal(assertSourceTarget({ projectRef: HOMOLOGATION_REF, projectUrl: `https://${HOMOLOGATION_REF}.supabase.co`, databaseUrl: valid.SUPABASE_DB_URL, serviceRoleKey: jwt({ role: 'service_role', ref: HOMOLOGATION_REF }) }), true);
  assert.throws(() => assertSourceTarget({ projectRef: 'production-ref', projectUrl: 'https://production-ref.supabase.co', databaseUrl: 'postgresql://postgres:x@db.production-ref.supabase.co/postgres?sslmode=require', serviceRoleKey: jwt({ role: 'service_role', ref: 'production-ref' }) }));
});

test('preflight rejects all non-allowlisted branch, source and destination values', () => {
  const env = { ...valid, SUPABASE_SERVICE_ROLE_KEY: jwt({ role: 'service_role', ref: HOMOLOGATION_REF }) };
  assert.equal(validateBackupConfig(env), true);
  for (const [key, value] of [['GITHUB_REF', 'refs/heads/main'], ['INPUT_PROJECT_REF', 'production-ref'], ['SUPABASE_PROJECT_URL', 'https://production-ref.supabase.co'], ['SUPABASE_DB_URL', 'postgresql://postgres:x@db.production-ref.supabase.co/postgres?sslmode=require'], ['BACKUP_S3_ENDPOINT_URL', 'http://example.invalid']]) {
    assert.throws(() => validateBackupConfig({ ...env, [key]: value }));
  }
});

test('preflight blocks missing secrets and absent private-destination confirmation', () => {
  const env = { ...valid, SUPABASE_SERVICE_ROLE_KEY: jwt({ role: 'service_role', ref: HOMOLOGATION_REF }) };
  assert.throws(() => validateBackupConfig({ ...env, AWS_SECRET_ACCESS_KEY: '' }));
  assert.throws(() => validateBackupConfig({ ...env, BACKUP_GPG_PASSPHRASE: '' }));
  assert.throws(() => validateBackupConfig({ ...env, INPUT_CONFIRM_PRIVATE_DESTINATION: 'false' }));
});

test('restore target is restricted to local Supabase API and object paths cannot escape', () => {
  assert.equal(assertLocalRestoreTarget('http://127.0.0.1:54321'), true);
  assert.throws(() => assertLocalRestoreTarget('https://tafjceemuetqjyngresg.supabase.co:54321'));
  assert.throws(() => resolveObjectPath('/tmp/objects', 'private', '../secret'));
  assert.throws(() => resolveObjectPath('/tmp/objects', 'private', 'a//b'));
});
