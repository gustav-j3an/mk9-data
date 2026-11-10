import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { HOMOLOGATION_REF, assertLocalRestoreTarget, assertSourceTarget, assertStorageInventoryMatches, resolveObjectPath, verifyStorageArchive } from './storage-backup.mjs';
import { validateBackupConfig } from './preflight.mjs';
import { assertInventoriesEqual } from './compare-inventory.mjs';

const jwt = payload => `x.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.x`;
const valid = {
  GITHUB_REF: 'refs/heads/codex/m38-backup-actions',
  INPUT_PROJECT_REF: HOMOLOGATION_REF,
  SUPABASE_PROJECT_REF: HOMOLOGATION_REF,
  SUPABASE_PROJECT_URL: `https://${HOMOLOGATION_REF}.supabase.co`,
  SUPABASE_DB_URL: `postgresql://postgres:placeholder@db.${HOMOLOGATION_REF}.supabase.co:5432/postgres?sslmode=require`,
  SUPABASE_SERVICE_ROLE_KEY: 'placeholder', BACKUP_GPG_PASSPHRASE: 'x'.repeat(40),
  INPUT_CONFIRM_ARTIFACT_ACCESS: 'true',
};

test('staging endpoints and JWT project claims are exact', () => {
  assert.equal(assertSourceTarget({ projectRef: HOMOLOGATION_REF, projectUrl: `https://${HOMOLOGATION_REF}.supabase.co`, databaseUrl: valid.SUPABASE_DB_URL, serviceRoleKey: jwt({ role: 'service_role', ref: HOMOLOGATION_REF }) }), true);
  assert.throws(() => assertSourceTarget({ projectRef: 'production-ref', projectUrl: 'https://production-ref.supabase.co', databaseUrl: 'postgresql://postgres:x@db.production-ref.supabase.co/postgres?sslmode=require', serviceRoleKey: jwt({ role: 'service_role', ref: 'production-ref' }) }));
});

test('preflight rejects non-allowlisted branch/source and has no object-store requirement', () => {
  const env = { ...valid, SUPABASE_SERVICE_ROLE_KEY: jwt({ role: 'service_role', ref: HOMOLOGATION_REF }) };
  assert.equal(validateBackupConfig(env), true);
  for (const [key, value] of [['GITHUB_REF', 'refs/heads/main'], ['INPUT_PROJECT_REF', 'production-ref'], ['SUPABASE_PROJECT_URL', 'https://production-ref.supabase.co'], ['SUPABASE_DB_URL', 'postgresql://postgres:x@db.production-ref.supabase.co/postgres?sslmode=require']]) {
    assert.throws(() => validateBackupConfig({ ...env, [key]: value }));
  }
  assert.equal('AWS_ACCESS_KEY_ID' in env, false);
  assert.equal('BACKUP_S3_ENDPOINT_URL' in env, false);
});

test('preflight blocks missing secrets, weak GPG passphrase and absent artifact disclosure confirmation', () => {
  const env = { ...valid, SUPABASE_SERVICE_ROLE_KEY: jwt({ role: 'service_role', ref: HOMOLOGATION_REF }) };
  assert.throws(() => validateBackupConfig({ ...env, SUPABASE_DB_URL: '' }));
  assert.throws(() => validateBackupConfig({ ...env, BACKUP_GPG_PASSPHRASE: '' }));
  assert.throws(() => validateBackupConfig({ ...env, BACKUP_GPG_PASSPHRASE: 'short' }));
  assert.throws(() => validateBackupConfig({ ...env, BACKUP_GPG_PASSPHRASE: `${'x'.repeat(40)}\nignored` }));
  assert.throws(() => validateBackupConfig({ ...env, INPUT_CONFIRM_ARTIFACT_ACCESS: 'false' }));
});

test('restore target is restricted to local Supabase API and object paths cannot escape', () => {
  assert.equal(assertLocalRestoreTarget('http://127.0.0.1:54321'), true);
  assert.throws(() => assertLocalRestoreTarget('https://tafjceemuetqjyngresg.supabase.co:54321'));
  assert.throws(() => resolveObjectPath('/tmp/objects', 'private', '../secret'));
  assert.throws(() => resolveObjectPath('/tmp/objects', 'private', 'a//b'));
});

test('database inventory comparison rejects changes in any tracked object or data field', () => {
  const source = { schemas: ['public'], table_sha256: 'a', rls: true, roles: ['app'] };
  assert.equal(assertInventoriesEqual(source, structuredClone(source)), true);
  const changedData = structuredClone(source);
  changedData.table_sha256 = 'b';
  assert.throws(() => assertInventoriesEqual(source, changedData), /DATABASE_INVENTORY_MISMATCH/);
  const changedRls = structuredClone(source);
  changedRls.rls = false;
  assert.throws(() => assertInventoriesEqual(source, changedRls), /DATABASE_INVENTORY_MISMATCH/);
});

test('separate Storage inventory checks objects, IDs, metadata, timestamps, bucket policy and bytes count', () => {
  const manifest = {
    buckets: [{ id: 'private-id', name: 'private', public: false, file_size_limit: 123, allowed_mime_types: ['image/jpeg'], created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z' }],
    objects: [{ bucket: 'private', name: 'a/photo.jpg', id: 'source-id', owner_id: 'source-user', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z', last_accessed_at: null, metadata: { mimetype: 'image/jpeg', size: 4 }, size: 4 }],
  };
  const buckets = structuredClone(manifest.buckets);
  const objects = [{ ...structuredClone(manifest.objects[0]), owner_id: 'local-owner' }];
  assert.deepEqual(assertStorageInventoryMatches(manifest, buckets, objects), { buckets: 1, objects: 1 });
  assert.throws(() => assertStorageInventoryMatches(manifest, buckets, [{ ...objects[0], id: 'different-id' }]), /LOCAL_STORAGE_OBJECT_METADATA_MISMATCH/);
  assert.throws(() => assertStorageInventoryMatches(manifest, [{ ...buckets[0], public: true }], objects), /LOCAL_STORAGE_BUCKET_INVENTORY_MISMATCH/);
  assert.throws(() => assertStorageInventoryMatches(manifest, buckets, []), /LOCAL_STORAGE_OBJECT_INVENTORY_MISMATCH/);
});

test('backup script encrypts before publishing only a GPG artifact and keeps restores isolated', async () => {
  const script = await readFile(new URL('./mk9-supabase-homologation-backup.sh', import.meta.url), 'utf8');
  const workflow = await readFile(new URL('../.github/workflows/supabase-homologation-backup.yml', import.meta.url), 'utf8');
  const docs = await readFile(new URL('../docs/supabase-homologation-backup.md', import.meta.url), 'utf8');
  const encryption = script.indexOf('--symmetric --cipher-algo AES256');
  const encryptionCheck = script.indexOf('gpg --batch --quiet --pinentry-mode loopback --passphrase-file');
  const artifactCopy = script.indexOf('install -m 0600 "$ROOT/backup.tar.gz.gpg" "$ARTIFACT_PATH"');
  assert.ok(encryption > 0 && encryptionCheck > encryption && artifactCopy > encryptionCheck);
  assert.doesNotMatch(script, /\baws\b|s3:\/\//i);
  assert.match(script, /set -Eeuo pipefail/);
  assert.match(script, /mk9_backup_restore/);
  assert.match(script, /verify-local/);
  assert.match(script, /supabase db dump --role-only --remote="\$SUPABASE_DB_URL"/);
  assert.match(script, /SHOW server_version_num/);
  assert.match(script, /SERVER_VERSION_NUM < 170000/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\n\s+push:/);
  assert.match(workflow, /environment: homologation-backup/);
  assert.match(workflow, /uses: actions\/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9/);
  assert.match(workflow, /retention-days: 1/);
  assert.match(workflow, /if-no-files-found: error/);
  assert.match(workflow, /\.tar\.gz\.gpg/);
  assert.doesNotMatch(workflow, /AWS_|BACKUP_S3_|awscli/i);
  assert.match(docs, /Este repositório é público/);
  assert.match(docs, /não deve ser tratado como armazenamento privado permanente/);
  assert.match(docs, /retenção configurada é de \*\*1 dia\*\*/);
  assert.match(script, /assert|pg_restore/);
});

test('inventory SQL includes row hashes and privilege/RLS/managed-object coverage', async () => {
  const sql = await readFile(new URL('./backup-inventory.sql', import.meta.url), 'utf8');
  for (const fragment of ['sha256(', 'relrowsecurity', 'pg_policies', 'pg_default_acl', 'pg_auth_members', 'pg_sequence', 'pg_aggregate', 'aggminvtransfn', 'indisreplident', 'pg_extension', 'pg_get_functiondef', 'pg_constraint', 'pg_index', 'pg_type']) {
    assert.ok(sql.includes(fragment), `missing inventory feature ${fragment}`);
  }
  assert.doesNotMatch(sql, /data_md5|definition_md5/);
});

test('Storage archive rejects unmanifested files and symlinks', async () => {
  const directory = await mkdtemp(`${tmpdir()}/mk9-backup-test-`);
  try {
    await writeFile(`${directory}/manifest.json`, JSON.stringify({ format: 1, projectRef: HOMOLOGATION_REF, buckets: [], objects: [], totalBytes: 0 }));
    assert.deepEqual(await verifyStorageArchive(directory), { buckets: 0, objects: 0, bytes: 0 });
    await writeFile(`${directory}/unexpected.txt`, 'not in the manifest');
    await assert.rejects(verifyStorageArchive(directory), /STORAGE_ARCHIVE_FILE_SET_MISMATCH/);
    await unlink(`${directory}/unexpected.txt`);
    await symlink('/etc/passwd', `${directory}/link`);
    await assert.rejects(verifyStorageArchive(directory), /STORAGE_ARCHIVE_SYMLINK_REJECTED/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
