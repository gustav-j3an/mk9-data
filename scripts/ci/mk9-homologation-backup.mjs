import { createClient } from '@supabase/supabase-js';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_REF = 'tafjceemuetqjyngresg';
const EXPECTED_LATEST_MIGRATION = '20261030153702';
const EXPECTED_PENDING_MIGRATIONS = [
  '20261105150000',
  '20261105165500',
  '20261106125151',
  '20261106131614',
];
const WORKSPACE = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TEMP_ROOT = process.env.RUNNER_TEMP || tmpdir();
const WORK_DIR = join(TEMP_ROOT, `mk9-homologation-${randomUUID()}`);

const envRequired = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Required Environment value is missing: ${name}`);
  return value;
};

function run(command, args, { input, env = process.env, encoding = 'utf8' } = {}) {
  const result = spawnSync(command, args, { input, env, encoding, maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) {
    const safeError = (result.stderr || '').toString().split(/\r?\n/).slice(-12).join('\n');
    throw new Error(`${command} failed with exit ${result.status}${safeError ? `:\n${safeError}` : ''}`);
  }
  return result.stdout;
}

function validateDbUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('SUPABASE_DB_URL is not a valid PostgreSQL URL.');
  }
  const user = decodeURIComponent(url.username);
  const hostAllowed = /^aws-\d+-sa-east-1\.pooler\.supabase\.com$/.test(url.hostname);
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('SUPABASE_DB_URL must use the PostgreSQL protocol.');
  }
  if (!hostAllowed || url.port !== '5432' || user !== `postgres.${PROJECT_REF}` || url.pathname !== '/postgres' || !url.password) {
    throw new Error('Database URL rejected: only the homologation session pooler on port 5432 is allowed.');
  }
  if (url.searchParams.get('sslmode') === 'disable') {
    throw new Error('Database URL rejected because SSL is disabled.');
  }
  return {
    host: url.hostname,
    port: '5432',
    user,
    password: decodeURIComponent(url.password),
    database: 'postgres',
  };
}

const escapePgpass = (value) => value.replaceAll('\\', '\\\\').replaceAll(':', '\\:').replaceAll('\n', '');

async function streamToFile(command, args, outputPath, env) {
  const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  try {
    await Promise.all([
      pipeline(child.stdout, createWriteStream(outputPath, { mode: 0o600, flags: 'w' })),
      new Promise((resolvePromise, rejectPromise) => {
        child.once('error', rejectPromise);
        child.once('close', (code) => {
          if (code === 0) resolvePromise();
          else rejectPromise(new Error(`${command} failed with exit ${code}: ${stderr.split(/\r?\n/).slice(-8).join('\n')}`));
        });
      }),
    ]);
  } catch (error) {
    child.kill();
    throw error;
  }
}

function postgresArgs(db, ...args) {
  return ['--host', db.host, '--port', db.port, '--username', db.user, '--dbname', db.database, ...args];
}

const PRECHECK_SQL = `
SELECT json_build_object(
  'server_version', current_setting('server_version'),
  'latest_migration', (SELECT max(version::text) FROM supabase_migrations.schema_migrations),
  'planned_migrations_pending', NOT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version::text = ANY(ARRAY[${EXPECTED_PENDING_MIGRATIONS.map((v) => `'${v}'`).join(',')}])
  ),
  'max_migration_matches_last_audit', (SELECT max(version::text) = '${EXPECTED_LATEST_MIGRATION}' FROM supabase_migrations.schema_migrations),
  'checkin_for_share', position('FOR SHARE' in pg_get_functiondef('public.attendance_check_in(text,text,uuid,numeric,numeric,numeric)'::regprocedure)) > 0,
  'checkin_for_key_share', position('FOR KEY SHARE' in pg_get_functiondef('public.attendance_check_in(text,text,uuid,numeric,numeric,numeric)'::regprocedure)) > 0,
  'schedule_active_check', position('Industry is not active' in pg_get_functiondef('attendance_private.attendance_start_scheduled_occurrence(uuid,date,text,numeric,numeric,numeric)'::regprocedure)) > 0,
  'inactivate_rpc_exists', to_regprocedure('public.inactivate_industry_and_suspend_routes(uuid,text)') IS NOT NULL,
  'reactivate_rpc_exists', to_regprocedure('public.reactivate_industry_routes(uuid,uuid[])') IS NOT NULL,
  'audit_table_exists', to_regclass('attendance_private.industry_route_sync_audit') IS NOT NULL,
  'public_table_counts', (
    SELECT coalesce(json_agg(json_build_object('schema', schema_name, 'table', table_name, 'rows', row_count) ORDER BY schema_name, table_name), '[]'::json)
    FROM (
      SELECT schemaname AS schema_name, tablename AS table_name,
        array_to_string(xpath('/table/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %I.%I', schemaname, tablename), false, false, '')), '')::bigint AS row_count
      FROM pg_tables
      WHERE schemaname NOT LIKE 'pg_%' AND schemaname <> 'information_schema'
    ) counts
  ),
  'object_counts', json_build_object(
    'relations', (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema' AND c.relkind IN ('r','p','v','m','f')),
    'functions', (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'),
    'indexes', (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='i' AND n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'),
    'triggers', (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'),
    'policies', (SELECT count(*) FROM pg_policies WHERE schemaname NOT LIKE 'pg_%' AND schemaname <> 'information_schema'),
    'rls_tables', (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relrowsecurity AND n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema')
  ),
  'extensions', (SELECT coalesce(json_agg(json_build_object('name', e.extname, 'version', e.extversion) ORDER BY e.extname), '[]'::json) FROM pg_extension e),
  'ops', json_build_object(
    'industries', (SELECT count(*) FROM public.industrias),
    'routes', (SELECT count(*) FROM public.rotas),
    'open_routes', (SELECT count(*) FROM public.rotas WHERE encerrada_em IS NULL),
    'visits', (SELECT count(*) FROM public.visits),
    'visits_in_progress', (SELECT count(*) FROM public.visits WHERE status='em_andamento'),
    'visits_completed', (SELECT count(*) FROM public.visits WHERE status='concluida'),
    'scheduled_actions', (SELECT count(*) FROM public.visit_schedule_actions),
    'regularization_audit', (SELECT count(*) FROM public.visit_regularization_audit)
  )
)::text`;

const STORAGE_SQL = `SELECT coalesce(json_agg(json_build_object(
  'bucket_id', o.bucket_id,
  'name', o.name,
  'size', nullif(o.metadata->>'size','')::bigint,
  'mimetype', o.metadata->>'mimetype',
  'version', o.version
) ORDER BY o.bucket_id, o.name), '[]'::json)::text FROM storage.objects o`;

async function sha256File(path) {
  const hash = createHash('sha256');
  const { createReadStream } = await import('node:fs');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function fileInside(root, relativePath, bytes) {
  const clean = relativePath.replaceAll('\\', '/');
  if (!clean || clean.startsWith('/') || clean.split('/').some((part) => part === '..' || part === '.')) {
    throw new Error('Storage object path failed the safe archive path check.');
  }
  const destination = resolve(root, clean);
  const rel = relative(root, destination);
  if (rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) throw new Error('Storage object path escapes the backup directory.');
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  await writeFile(destination, bytes, { mode: 0o600, flag: 'wx' });
  return destination;
}

async function downloadStorage(inventory, destination) {
  const jwt = envRequired('SUPABASE_STORAGE_READ_JWT');
  const payloadText = jwt.split('.')[1];
  let payload;
  try { payload = JSON.parse(Buffer.from(payloadText, 'base64url').toString('utf8')); }
  catch { throw new Error('Storage read JWT is malformed.'); }
  if (payload.role !== 'authenticated' || Number(payload.exp) < Math.floor(Date.now() / 1000) + 300) {
    throw new Error('Storage token must be an unexpired authenticated-user JWT, not a service-role key.');
  }

  const client = createClient(envRequired('SUPABASE_URL'), envRequired('SUPABASE_ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const records = [];
  for (const object of inventory) {
    const { data, error } = await client.storage.from(object.bucket_id).download(object.name);
    if (error || !data) throw new Error(`Storage read failed for object ${records.length + 1}; object path omitted from logs.`);
    const buffer = Buffer.from(await data.arrayBuffer());
    if (object.size !== null && buffer.byteLength !== Number(object.size)) {
      throw new Error(`Storage object ${records.length + 1} byte count did not match database metadata.`);
    }
    const relativePath = `storage/${object.bucket_id}/${object.name}`;
    const savedPath = await fileInside(destination, relativePath, buffer);
    records.push({
      bucket_id: object.bucket_id,
      name: object.name,
      size_bytes: buffer.byteLength,
      sha256: await sha256File(savedPath),
      archive_path: relativePath,
    });
  }
  return records;
}

async function partialRestore(dumpPath, bundleDir) {
  const fullDb = 'mk9_restore_full_attempt';
  const partialDb = 'mk9_restore_partial';
  const restoreEnv = { ...process.env, PGPASSWORD: 'runner-only-not-a-project-credential' };
  run('createdb', ['--host', '127.0.0.1', '--port', '5432', '--username', 'postgres', fullDb], { env: restoreEnv });
  const listPath = join(bundleDir, 'pg_restore.list');
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('pg_restore', ['--list', dumpPath], { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('close', async (code) => {
      if (code !== 0) return rejectPromise(new Error(`pg_restore --list failed: ${stderr.split(/\r?\n/).slice(-8).join('\n')}`));
      await writeFile(listPath, Buffer.concat(chunks), { mode: 0o600 });
      resolvePromise();
    });
  });
  const toc = await readFile(listPath, 'utf8');
  const tocCount = toc.split(/\r?\n/).filter((line) => /^\d+;/.test(line)).length;
  const hasVaultExtension = /\bEXTENSION\s+-\s+supabase_vault\b/.test(toc);
  const hasVaultSchema = /\bSCHEMA\s+-\s+vault\b/.test(toc);

  // Record a faithful restore attempt, then test an explicitly partial restore
  // that omits only the Supabase-managed vault extension/schema and owner ACLs.
  const fullLog = join(bundleDir, 'full-restore-limitation.txt');
  const full = spawnSync('pg_restore', ['--exit-on-error', '--no-owner', '--no-acl', '--host', '127.0.0.1', '--port', '5432', '--username', 'postgres', '--dbname', fullDb, dumpPath], { env: restoreEnv, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  await writeFile(fullLog, `exit_code=${full.status}\n${full.stderr || ''}`, { mode: 0o600 });
  run('createdb', ['--host', '127.0.0.1', '--port', '5432', '--username', 'postgres', partialDb], { env: restoreEnv });
  const partialList = join(bundleDir, 'pg_restore.partial.list');
  const filteredToc = toc.split(/\r?\n/).filter((line) => {
    if (!/^\d+;/.test(line)) return true;
    return !/\b(?:supabase_vault|vault)\b/i.test(line);
  }).join('\n');
  await writeFile(partialList, filteredToc, { mode: 0o600 });
  const partial = spawnSync('pg_restore', ['--exit-on-error', '--no-owner', '--no-acl', `--use-list=${partialList}`, '--host', '127.0.0.1', '--port', '5432', '--username', 'postgres', '--dbname', partialDb, dumpPath], { env: restoreEnv, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  if (partial.status !== 0) {
    await writeFile(join(bundleDir, 'partial-restore-limitation.txt'), `exit_code=${partial.status}\n${partial.stderr || ''}`, { mode: 0o600 });
    return {
      status: 'partial_failed',
      full_restore_exit: full.status,
      partial_restore_exit: partial.status,
      toc_entries: tocCount,
      supabase_vault_in_toc: hasVaultExtension,
      vault_schema_in_toc: hasVaultSchema,
    };
  }

  const restoreInventorySql = `SELECT coalesce(json_agg(json_build_object('schema',schemaname,'table',tablename,'rows',array_to_string(xpath('/table/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %I.%I',schemaname,tablename),false,false,'')),'')::bigint) ORDER BY schemaname,tablename),'[]'::json)::text FROM pg_tables WHERE schemaname='public'`;
  const restoreCounts = JSON.parse(run('psql', ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '--host', '127.0.0.1', '--port', '5432', '--username', 'postgres', '--dbname', partialDb, '-c', restoreInventorySql], { env: restoreEnv }).trim());
  const countsMatch = JSON.stringify(restoreCounts) === JSON.stringify(precheckPublicCounts(await readFile(join(bundleDir, 'precheck-public-counts.json'), 'utf8')));
  const result = {
    status: 'partial',
    full_restore_exit: full.status,
    partial_restore_exit: partial.status,
    toc_entries: tocCount,
    supabase_vault_in_toc: hasVaultExtension,
    vault_schema_in_toc: hasVaultSchema,
    public_row_counts_match: countsMatch,
    partial_public_inventory: restoreCounts,
  };
  await writeFile(join(bundleDir, 'restore-report.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
  return result;
}

function precheckPublicCounts(serialized) {
  return JSON.parse(serialized).filter((entry) => entry.schema === 'public').map((entry) => ({ schema: entry.schema, table: entry.table, rows: entry.rows }));
}

async function main() {
  const db = validateDbUrl(envRequired('SUPABASE_DB_URL'));
  const recipient = envRequired('BACKUP_AGE_RECIPIENT').trim();
  const identity = envRequired('BACKUP_AGE_IDENTITY').trim();
  const bundleDir = join(WORK_DIR, 'bundle');
  const storageDir = join(bundleDir, 'storage');
  await mkdir(bundleDir, { recursive: true, mode: 0o700 });
  await mkdir(storageDir, { recursive: true, mode: 0o700 });

  const precheckText = run('psql', postgresArgs(db, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', PRECHECK_SQL), { env: { ...process.env, PGPASSWORD: db.password, PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '15' } });
  const precheck = JSON.parse(precheckText.trim());
  if (!precheck.planned_migrations_pending || !precheck.max_migration_matches_last_audit) {
    throw new Error('Remote migration ledger changed since the audited baseline or one of the planned migrations is already applied.');
  }
  if (precheck.server_version.split('.')[0] !== '17') throw new Error('Homologation server is not PostgreSQL 17.');

  const precheckPublic = precheck.public_table_counts.filter((entry) => entry.schema === 'public');
  await writeFile(join(bundleDir, 'precheck-public-counts.json'), JSON.stringify(precheckPublic), { mode: 0o600 });
  const storageBeforeText = run('psql', postgresArgs(db, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', STORAGE_SQL), { env: { ...process.env, PGPASSWORD: db.password, PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '15' } });
  const storageInventory = JSON.parse(storageBeforeText.trim());
  const photosUnmatched = Number(run('psql', postgresArgs(db, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', `SELECT count(*) FROM public.visit_photos p WHERE NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id='visit-photos' AND (o.name=p.storage_path OR o.name=regexp_replace(p.storage_path,'^visit-photos/','') OR position(o.name in coalesce(p.file_url,''))>0))`), { env: { ...process.env, PGPASSWORD: db.password, PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '15' } }).trim());
  const storageFiles = await downloadStorage(storageInventory, storageDir);
  const storageAfterText = run('psql', postgresArgs(db, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', STORAGE_SQL), { env: { ...process.env, PGPASSWORD: db.password, PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '15' } });
  const storageAfter = JSON.parse(storageAfterText.trim());
  if (JSON.stringify(storageInventory) !== JSON.stringify(storageAfter)) {
    throw new Error('Storage inventory changed during export; no stable Storage snapshot was produced.');
  }

  const migrationPath = (version) => join(WORKSPACE, 'supabase', 'migrations', `${version}_${({
    '20261105150000': 'm30_inactivate_industry_routes_sync.sql',
    '20261105165500': 'm30_harden_industry_active_checkin.sql',
    '20261106125151': 'harden_industry_route_suspension_audit.sql',
    '20261106131614': 'm30_serialize_industry_checkin.sql',
  })[version]}`);
  const migrationHashes = {};
  for (const version of EXPECTED_PENDING_MIGRATIONS) migrationHashes[version] = await sha256File(migrationPath(version));

  const dumpPath = join(bundleDir, 'homologation.dump');
  const rolesPath = join(bundleDir, 'global-roles.sql');
  const pgEnv = { ...process.env, PGPASSWORD: db.password, PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '15' };
  await streamToFile('pg_dump', postgresArgs(db, '--format=custom', '--verbose', '--dbname', 'postgres'), dumpPath, pgEnv);
  await streamToFile('pg_dumpall', ['--host', db.host, '--port', db.port, '--username', db.user, '--globals-only', '--no-role-passwords'], rolesPath, pgEnv);
  const roleBytes = Number((await stat(rolesPath)).size);
  const dumpBytes = Number((await stat(dumpPath)).size);
  if (dumpBytes <= 0 || roleBytes <= 0) throw new Error('Database dump or global-role inventory is empty.');

  const restore = await partialRestore(dumpPath, bundleDir);
  const manifest = {
    format: 'PostgreSQL custom archive + global roles SQL + Storage objects',
    created_at: new Date().toISOString(),
    project_ref: PROJECT_REF,
    server_version: precheck.server_version,
    database_bytes: dumpBytes,
    roles_inventory_bytes: roleBytes,
    migration_ledger_latest: precheck.latest_migration,
    expected_migrations_pending: EXPECTED_PENDING_MIGRATIONS,
    migration_sha256: migrationHashes,
    pre_backup_inventory: precheck,
    storage_inventory_count: storageInventory.length,
    storage_export: storageFiles,
    visit_photo_rows_without_matching_storage_object: photosUnmatched,
    restore_check: restore,
    notes: [
      'Storage binary objects are exported separately from pg_dump and included in this encrypted package.',
      'Generic PostgreSQL 17 restore is partial when Supabase-managed extensions, roles, or schemas are unavailable.',
      'A full Supabase recovery test requires an authorized Supabase clone.',
    ],
  };
  await writeFile(join(bundleDir, 'storage-inventory.json'), JSON.stringify(storageInventory, null, 2), { mode: 0o600 });
  await writeFile(join(bundleDir, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  const rawBundle = join(WORK_DIR, 'homologation-backup.tar.gz');
  run('tar', ['-czf', rawBundle, '-C', bundleDir, '.']);
  const archivePath = join(TEMP_ROOT, `mk9-homologation-${PROJECT_REF}-${process.env.GITHUB_RUN_ID || 'manual'}.tar.gz.age`);
  run('age', ['-r', recipient, '-o', archivePath, rawBundle]);
  const identityPath = join(WORK_DIR, 'age-identity.txt');
  await writeFile(identityPath, `${identity}\n`, { mode: 0o600 });
  const decryptedPath = join(WORK_DIR, 'decrypt-check.tar.gz');
  run('age', ['-d', '-i', identityPath, '-o', decryptedPath, archivePath]);
  const rawSha = await sha256File(rawBundle);
  const decryptedSha = await sha256File(decryptedPath);
  if (rawSha !== decryptedSha) throw new Error('Encrypted backup decrypt/checksum verification failed.');

  const archiveBytes = Number((await stat(archivePath)).size);
  const archiveSha = await sha256File(archivePath);
  const out = process.env.GITHUB_OUTPUT;
  if (out) {
    await writeFile(out, `encrypted_archive=${archivePath}\nencrypted_sha256=${archiveSha}\nencrypted_bytes=${archiveBytes}\nrestore_status=${restore.status}\n`, { flag: 'a' });
  }
  const summary = [
    '### Homologation backup preflight',
    '',
    `- Project: \`${PROJECT_REF}\` (target validated from the PostgreSQL session-pooler URL)`,
    `- PostgreSQL: ${precheck.server_version}`,
    `- Database dump: ${dumpBytes} bytes; encrypted archive: ${archiveBytes} bytes`,
    `- Encrypted archive SHA-256: \`${archiveSha}\``,
    `- Storage files exported: ${storageFiles.length}; unpaired visit photo metadata rows: ${photosUnmatched}`,
    `- Restore result: ${restore.status} (vault/roles/ACL limitations are recorded inside the encrypted bundle)`,
    '- No migrations or remote writes were executed.',
  ].join('\n');
  if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`, { flag: 'a' });
  console.log(`Encrypted backup prepared and locally decrypted for checksum verification. Restore check: ${restore.status}.`);
}

try {
  await main();
} catch (error) {
  const message = String(error?.message || error).replaceAll(process.env.SUPABASE_DB_URL || '\u0000', '[redacted database URL]');
  console.error(message);
  process.exitCode = 1;
} finally {
  try {
    await rm(WORK_DIR, { recursive: true, force: true });
  } catch {
    // The hosted runner is ephemeral; the encrypted archive remains outside this work directory.
  }
}
