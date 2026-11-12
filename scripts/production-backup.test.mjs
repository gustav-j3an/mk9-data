import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  PRODUCTION_REF,
  ALLOWED_BACKUP_BRANCH,
  SUPABASE_CA_CERT_PATH,
  SUPABASE_CA_SHA256,
  normalizeProductionPoolerUrl,
  inspectProductionTlsPolicy,
  parseProductionPoolerUrl,
} from './production-pooler-connection.mjs';
import {
  validateProductionBackupConfig,
  verifySupabaseCaCertificate,
  verifyCheckedOutCommit,
} from './production-preflight.mjs';
import {
  assertSourceTarget,
  assertLocalRestoreTarget,
  resolveObjectPath,
  assertStorageInventoryMatches,
} from './production-storage-backup.mjs';
import { parseMigrationHistoryData, reconcileMigrationsLedger } from './reconcile-migrations.mjs';
import { bundleRepositoryMigrations } from './bundle-repository-migrations.mjs';

test('production-pooler-connection: rejects non-production project ref', () => {
  assert.equal(PRODUCTION_REF, 'xzmbesqhxcnuokjwrbnw');
  assert.equal(ALLOWED_BACKUP_BRANCH, 'codex/m57.2-production-backup-workflow');

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
  const currentHeadSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
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
    // Test with the actual checked-out HEAD commit
    APPROVED_COMMIT_SHA: currentHeadSha,
  };

  assert.equal(validateProductionBackupConfig(validEnv), true);

  // Missing APPROVED_COMMIT_SHA must throw
  assert.throws(
    () => validateProductionBackupConfig({ ...validEnv, APPROVED_COMMIT_SHA: undefined }),
    /APPROVED_COMMIT_SHA_MISSING/
  );
  assert.throws(
    () => validateProductionBackupConfig({ ...validEnv, APPROVED_COMMIT_SHA: '' }),
    /APPROVED_COMMIT_SHA_MISSING/
  );

  // Divergent APPROVED_COMMIT_SHA must throw COMMIT_SHA_MISMATCH
  assert.throws(
    () => validateProductionBackupConfig({ ...validEnv, APPROVED_COMMIT_SHA: '0000000000000000000000000000000000000000' }),
    /COMMIT_SHA_MISMATCH/
  );

  assert.throws(() => validateProductionBackupConfig({ ...validEnv, GITHUB_REF: 'refs/heads/main' }), /BRANCH_NOT_ALLOWED/);
  assert.throws(() => validateProductionBackupConfig({ ...validEnv, INPUT_PROJECT_REF: 'tafjceemuetqjyngresg' }), /PROJECT_REF_MISMATCH/);
  assert.throws(() => validateProductionBackupConfig({ ...validEnv, INPUT_CONFIRM_ARTIFACT_ACCESS: 'false' }), /ARTIFACT_ACCESS_CONFIRMATION_REQUIRED/);
});

test('production-preflight: commit verification validates actual code and rejects invalid/divergent SHAs', () => {
  const currentHeadSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

  // 1. Correct approved commit matching git rev-parse HEAD
  const result = verifyCheckedOutCommit(currentHeadSha);
  assert.equal(result.verified, true);
  assert.equal(result.commitSha, currentHeadSha.toLowerCase());

  // 2. Divergent commit SHA (valid 40-char hex, but not the current commit)
  assert.throws(
    () => verifyCheckedOutCommit('1111111111111111111111111111111111111111'),
    /COMMIT_SHA_MISMATCH/
  );

  // 3. Abbreviated commit SHA (must be rejected)
  assert.throws(
    () => verifyCheckedOutCommit('e6297ae'),
    /APPROVED_COMMIT_SHA_FORMAT_INVALID/
  );

  // 4. Branch reference or tag name (must be rejected)
  assert.throws(
    () => verifyCheckedOutCommit('codex/m57.2-production-backup-workflow'),
    /APPROVED_COMMIT_SHA_FORMAT_INVALID/
  );
  assert.throws(
    () => verifyCheckedOutCommit('main'),
    /APPROVED_COMMIT_SHA_FORMAT_INVALID/
  );

  // 5. Empty or malformed input
  assert.throws(() => verifyCheckedOutCommit(''), /APPROVED_COMMIT_SHA_FORMAT_INVALID/);
  assert.throws(() => verifyCheckedOutCommit(null), /APPROVED_COMMIT_SHA_FORMAT_INVALID/);
  assert.throws(() => verifyCheckedOutCommit('not-a-valid-sha-at-all-xyz!'), /APPROVED_COMMIT_SHA_FORMAT_INVALID/);
});

test('production-storage-backup: path resolution and target guards', () => {
  assert.equal(assertLocalRestoreTarget('http://127.0.0.1:54321'), true);
  assert.throws(() => assertLocalRestoreTarget('https://xzmbesqhxcnuokjwrbnw.supabase.co'), /RESTORE_TARGET_MUST_BE_LOCAL/);

  const safePath = resolveObjectPath('C:/temp/export/storage', 'visit-photos', 'folder/photo.jpg');
  assert.match(safePath, /photo\.jpg$/);

  assert.throws(() => resolveObjectPath('C:/temp/export/storage', '..', 'photo.jpg'), /UNSAFE_STORAGE_PATH/);
  assert.throws(() => resolveObjectPath('C:/temp/export/storage', 'visit-photos', '../../etc/passwd'), /UNSAFE_STORAGE_PATH/);
});

test('production-storage-backup: detects corrupted files, size mismatch, and altered bucket configurations', () => {
  const sourceManifest = {
    buckets: [
      { name: 'visit-photos', public: false, file_size_limit: 5242880, allowed_mime_types: ['image/jpeg', 'image/png'] }
    ],
    objects: [
      { bucket: 'visit-photos', name: 'photo1.jpg', sha256: 'abc123hash', bytes: 1024 }
    ]
  };

  const validRestoredBuckets = [
    { name: 'visit-photos', public: false, file_size_limit: 5242880, allowed_mime_types: ['image/jpeg', 'image/png'] }
  ];
  const validRestoredObjects = [
    { bucket: 'visit-photos', name: 'photo1.jpg', sha256: 'abc123hash', bytes: 1024 }
  ];

  assert.equal(assertStorageInventoryMatches(sourceManifest, validRestoredBuckets, validRestoredObjects), true);

  // 1. Corrupted bucket public setting
  const alteredBucketPublic = [{ ...validRestoredBuckets[0], public: true }];
  assert.throws(
    () => assertStorageInventoryMatches(sourceManifest, alteredBucketPublic, validRestoredObjects),
    /STORAGE_RESTORE_BUCKET_CONFIG_MISMATCH: visit-photos public setting mismatch/
  );

  // 2. Corrupted bucket file_size_limit
  const alteredBucketLimit = [{ ...validRestoredBuckets[0], file_size_limit: 10485760 }];
  assert.throws(
    () => assertStorageInventoryMatches(sourceManifest, alteredBucketLimit, validRestoredObjects),
    /STORAGE_RESTORE_BUCKET_CONFIG_MISMATCH: visit-photos file_size_limit mismatch/
  );

  // 3. Corrupted object size
  const alteredObjectSize = [{ ...validRestoredObjects[0], bytes: 1023 }];
  assert.throws(
    () => assertStorageInventoryMatches(sourceManifest, validRestoredBuckets, alteredObjectSize),
    /STORAGE_RESTORE_SIZE_MISMATCH/
  );

  // 4. Corrupted object SHA-256 hash
  const alteredObjectHash = [{ ...validRestoredObjects[0], sha256: 'corrupted_hash_xyz' }];
  assert.throws(
    () => assertStorageInventoryMatches(sourceManifest, validRestoredBuckets, alteredObjectHash),
    /STORAGE_RESTORE_HASH_MISMATCH/
  );

  // 5. Incomplete restore
  assert.throws(
    () => assertStorageInventoryMatches(sourceManifest, validRestoredBuckets, []),
    /STORAGE_RESTORE_OBJECT_COUNT_MISMATCH/
  );
});

test('reconcile-migrations: correctly parses schema_migrations and detects empty/corrupted data', () => {
  // 1. Standard COPY format with column list (version in 1st position)
  const sampleDumpWithColumns = `
COPY supabase_migrations.schema_migrations (version, statements, name) FROM stdin;
20260930120000	{"statement 1"}	create_profiles
20261001150000	{"statement 2"}	create_visits
\\.
`;
  const parsed1 = parseMigrationHistoryData(sampleDumpWithColumns);
  assert.deepEqual(parsed1, ['20260930120000', '20261001150000']);

  // 2. COPY format with version in different position (e.g. name, version, statements)
  const sampleDumpReordered = `
COPY supabase_migrations.schema_migrations (name, version, statements) FROM stdin;
create_profiles	20260930120000	{"statement 1"}
create_visits	20261001150000	{"statement 2"}
\\.
`;
  const parsed2 = parseMigrationHistoryData(sampleDumpReordered);
  assert.deepEqual(parsed2, ['20260930120000', '20261001150000']);

  // 3. COPY format without explicit column list
  const sampleDumpNoColHeader = `
COPY supabase_migrations.schema_migrations FROM stdin;
20260930120000	{"statement 1"}	create_profiles
\\.
`;
  const parsed3 = parseMigrationHistoryData(sampleDumpNoColHeader);
  assert.deepEqual(parsed3, ['20260930120000']);

  // 4. Reject COPY header missing version column
  assert.throws(
    () => parseMigrationHistoryData('COPY supabase_migrations.schema_migrations (name, statements) FROM stdin;\nfoo\tbar\n\\.\n'),
    /MIGRATION_LEDGER_HEADER_INVALID/
  );

  // 5. Reject COPY row with column count mismatch (expected 3, got 2)
  assert.throws(
    () => parseMigrationHistoryData('COPY supabase_migrations.schema_migrations (version, statements, name) FROM stdin;\n20260930120000\tmissing_third_col\n\\.\n'),
    /MIGRATION_LEDGER_ROW_COLUMN_MISMATCH/
  );

  // 6. Reject invalid non-numeric version format
  assert.throws(
    () => parseMigrationHistoryData('COPY supabase_migrations.schema_migrations (version, name) FROM stdin;\nnot_a_version\tcreate_profiles\n\\.\n'),
    /MIGRATION_LEDGER_MALFORMED_LINE/
  );

  // 7. Empty data or comments-only throws error to prevent silent approval
  assert.throws(() => parseMigrationHistoryData(''), /MIGRATION_LEDGER_EMPTY_OR_UNREADABLE/);
  assert.throws(() => parseMigrationHistoryData('-- only comments\n'), /MIGRATION_LEDGER_ZERO_ENTRIES/);
});

test('bundle-repository-migrations: strictly excludes subdirectories and deep-catalogs excluded files', async () => {
  const result = await bundleRepositoryMigrations('supabase/migrations', path.resolve('scratch/test-bundle-output'));
  assert.ok(result.total_executable_files > 0);
  assert.ok(result.total_excluded_items > 0);

  // Check that proposal file in propostas/ subfolder is deeply cataloged in excluded_items with SHA256 and bytes
  const excludedProposal = result.excluded_items.find(i => i.name === '20261018160000_proposal_sync_contratos_with_data_inicio.sql');
  assert.ok(excludedProposal, 'Proposal SQL file inside subfolder must be cataloged in excluded items');
  assert.equal(excludedProposal.type, 'excluded-sql-subfolder');
  assert.ok(excludedProposal.path.includes('propostas/20261018160000_proposal_sync_contratos_with_data_inicio.sql'));
  assert.ok(excludedProposal.bytes > 0);
  assert.equal(excludedProposal.sha256.length, 64);

  // Executable migrations must not contain proposals or subdirectories
  for (const m of result.migrations) {
    assert.ok(!m.filename.includes('proposal_sync_contratos_with_data_inicio'), 'Proposals must not be in executable migrations');
    assert.ok(m.sha256 && m.sha256.length === 64, 'Each bundled migration must have SHA-256 hash');
  }
});

test('security-workflow-check: ensures secrets are NOT present in global workflow env and checkout is pinned', async () => {
  const workflowYaml = await readFile('.github/workflows/supabase-production-backup.yml', 'utf8');

  // Match the global env block under jobs.backup-and-restore.env
  const globalEnvMatch = workflowYaml.match(/jobs:\s*[\s\S]*?backup-and-restore:\s*[\s\S]*?env:\s*([\s\S]*?)\s*steps:/);
  assert.ok(globalEnvMatch, 'Global job env block must exist');
  const globalEnvContent = globalEnvMatch[1];

  // Secrets must NOT be referenced in the global job env
  assert.ok(!globalEnvContent.includes('secrets.SUPABASE_DB_URL'), 'secrets.SUPABASE_DB_URL must not be in global job env');
  assert.ok(!globalEnvContent.includes('secrets.SUPABASE_SERVICE_ROLE_KEY'), 'secrets.SUPABASE_SERVICE_ROLE_KEY must not be in global job env');
  assert.ok(!globalEnvContent.includes('secrets.BACKUP_GPG_PASSPHRASE'), 'secrets.BACKUP_GPG_PASSPHRASE must not be in global job env');

  // Secrets must be present only in specific execution steps
  assert.ok(workflowYaml.includes('SUPABASE_DB_URL: ${{ secrets.SUPABASE_DB_URL }}'), 'Secrets must be step-scoped');

  // Checkout step must NOT checkout a dynamic branch ref directly; it must be pinned to approved SHA
  const checkoutRefMatch = workflowYaml.match(/ref:\s*(\$\{\{\s*vars\.APPROVED_COMMIT_SHA[^\n]+)/);
  assert.ok(checkoutRefMatch, 'Checkout ref must be specified with vars.APPROVED_COMMIT_SHA');
  const checkoutRef = checkoutRefMatch[1].trim();
  assert.ok(!checkoutRef.includes('refs/heads/'), 'Checkout ref must not be a mutable branch ref');
  assert.ok(checkoutRef.includes('vars.APPROVED_COMMIT_SHA'), 'Checkout ref must honor vars.APPROVED_COMMIT_SHA');

  // Both preflight steps (standalone and backup script) must receive APPROVED_COMMIT_SHA
  const preflightEnvMatches = [...workflowYaml.matchAll(/APPROVED_COMMIT_SHA:\s*(\$\{\{\s*vars\.APPROVED_COMMIT_SHA[^\n]+)/g)];
  assert.ok(preflightEnvMatches.length >= 2, 'APPROVED_COMMIT_SHA must be transmitted to both preflight and backup execution steps');
});

test('production-disposable-container: discovery logic filters candidate containers by image and hex ID', () => {
  const hexPattern = /^[0-9a-fA-F]{12,64}$/;

  // Test hex ID pattern
  assert.ok(hexPattern.test('77c8ec52dacd'), '12-char hex is valid');
  assert.ok(hexPattern.test('77c8ec52dacd77c8ec52dacd77c8ec52dacd77c8ec52dacd77c8ec52dacd1234'), '64-char hex is valid');
  assert.ok(!hexPattern.test('invalid-id!'), 'Non-hex rejected');
  assert.ok(!hexPattern.test('123'), 'Short ID rejected');

  // Test container filtering simulation
  const mockCandidates = [
    { id: '111122223333', image: 'supabase/postgres:17.2.0.1' },
    { id: '222233334444', image: 'public.ecr.aws/supabase/postgres:17.2.0.1' },
    { id: '444455556666', image: 'supabase/gotrue:v2.158.0' },
    { id: '777788889999', image: 'redis:alpine' },
  ];

  const isSupabasePostgres = img => /^(?:public\.ecr\.aws\/)?supabase\/postgres:/.test(img);
  const filtered = mockCandidates.filter(c => hexPattern.test(c.id) && isSupabasePostgres(c.image));
  assert.equal(filtered.length, 2);
  assert.equal(filtered[0].id, '111122223333');
  assert.equal(filtered[1].id, '222233334444');
});

test('production-disposable-container: shell script binds ephemeral project id and invokes resolver', async () => {
  const scriptContent = await readFile('scripts/mk9-supabase-production-backup.sh', 'utf8');

  // Must generate ephemeral stack nonce
  assert.ok(scriptContent.includes('DISPOSABLE_STACK_NONCE='), 'Must generate ephemeral stack nonce');
  assert.ok(scriptContent.includes('DISPOSABLE_PROJECT_ID='), 'Must define ephemeral project id');
  assert.ok(scriptContent.includes('mk9_backup_restore_nonce'), 'Must plant cryptographic nonce table in database');
  assert.ok(scriptContent.includes('resolve-disposable-container.mjs'), 'Must invoke resolver script');
  assert.ok(!scriptContent.includes('CONTAINER_MATCHES="$(docker ps'), 'Legacy brittle docker ps matching must be removed');
});


