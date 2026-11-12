import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { HOMOLOGATION_REF, parseHomologationPoolerUrl } from './pooler-connection.mjs';

const PAGE_SIZE = 500;

export function assertSourceTarget({ projectRef, projectUrl, databaseUrl, poolerHost, serviceRoleKey }) {
  if (projectRef !== HOMOLOGATION_REF) throw new Error('PROJECT_REF_MISMATCH');
  const api = new URL(projectUrl);
  if (api.protocol !== 'https:' || api.hostname !== `${HOMOLOGATION_REF}.supabase.co`) {
    throw new Error('PROJECT_URL_MISMATCH');
  }
  parseHomologationPoolerUrl(databaseUrl, poolerHost);
  const payload = decodeJwtPayload(serviceRoleKey);
  if (payload.role !== 'service_role' || payload.ref !== HOMOLOGATION_REF) {
    throw new Error('STORAGE_KEY_PROJECT_MISMATCH');
  }
  return true;
}

export function assertLocalRestoreTarget(url) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)
      || !['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)
      || parsed.port !== '54321') {
    throw new Error('RESTORE_TARGET_MUST_BE_LOCAL');
  }
  return true;
}

export function resolveObjectPath(root, bucket, objectName) {
  if (!bucket || bucket === '.' || bucket === '..' || /[\\/\0]/.test(bucket) || !objectName || objectName.includes('\\') || objectName.includes('\0')) {
    throw new Error('UNSAFE_STORAGE_PATH');
  }
  const segments = objectName.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error('UNSAFE_STORAGE_PATH');
  }
  const base = path.resolve(root);
  const output = path.resolve(base, bucket, ...segments);
  if (output !== base && !output.startsWith(`${base}${path.sep}`)) throw new Error('UNSAFE_STORAGE_PATH');
  return output;
}

function decodeJwtPayload(value) {
  const parts = String(value ?? '').split('.');
  if (parts.length !== 3) throw new Error('SERVICE_ROLE_KEY_MUST_BE_PROJECT_SCOPED_JWT');
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new Error('SERVICE_ROLE_KEY_INVALID');
  }
}

function authHeaders(key, extra = {}) {
  return { apikey: key, authorization: `Bearer ${key}`, ...extra };
}

async function apiRequest(baseUrl, key, endpoint, init = {}) {
  const response = await fetch(new URL(endpoint, baseUrl), {
    ...init,
    headers: authHeaders(key, init.headers ?? {}),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`STORAGE_API_HTTP_${response.status}`);
  }
  return response;
}

async function listBuckets(baseUrl, key) {
  const response = await apiRequest(baseUrl, key, '/storage/v1/bucket');
  const buckets = await response.json();
  if (!Array.isArray(buckets)) throw new Error('STORAGE_BUCKET_LIST_INVALID');
  return buckets;
}

async function listPage(baseUrl, key, bucketId, prefix, offset) {
  const response = await apiRequest(baseUrl, key, `/storage/v1/object/list/${encodeURIComponent(bucketId)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prefix, limit: PAGE_SIZE, offset, sortBy: { column: 'name', order: 'asc' } }),
  });
  const entries = await response.json();
  if (!Array.isArray(entries)) throw new Error('STORAGE_OBJECT_LIST_INVALID');
  return entries;
}

async function downloadObject(baseUrl, key, bucketId, objectName, destination) {
  const encodedPath = objectName.split('/').map(encodeURIComponent).join('/');
  const response = await apiRequest(baseUrl, key, `/storage/v1/object/authenticated/${encodeURIComponent(bucketId)}/${encodedPath}`);
  if (!response.body) throw new Error('STORAGE_OBJECT_BODY_MISSING');
  const digest = createHash('sha256');
  let byteCount = 0;
  const meter = new Transform({
    transform(chunk, encoding, callback) {
      digest.update(chunk);
      byteCount += chunk.length;
      callback(null, chunk);
    },
  });
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
  return { sha256: digest.digest('hex'), size: byteCount };
}

function isDirectory(entry) {
  return entry.id == null && entry.metadata == null && entry.updated_at == null;
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableJson(value[key])]));
  }
  return value;
}

function sameTimestamp(left, right) {
  if (left == null || right == null) return left === right;
  return Date.parse(left) === Date.parse(right);
}

export function assertStorageInventoryMatches(manifest, buckets, objects) {
  const normalizeBuckets = values => values.map(bucket => ({
    id: bucket.id ?? bucket.name,
    name: bucket.name,
    public: Boolean(bucket.public),
    file_size_limit: bucket.file_size_limit ?? null,
    allowed_mime_types: bucket.allowed_mime_types ?? null,
    created_at: bucket.created_at ?? null,
    updated_at: bucket.updated_at ?? null,
  })).sort((a, b) => a.name.localeCompare(b.name));
  const expectedBuckets = normalizeBuckets(manifest.buckets);
  const actualBuckets = normalizeBuckets(buckets);
  if (JSON.stringify(expectedBuckets.map(bucket => ({ ...bucket, created_at: null, updated_at: null })))
      !== JSON.stringify(actualBuckets.map(bucket => ({ ...bucket, created_at: null, updated_at: null })))) {
    throw new Error('LOCAL_STORAGE_BUCKET_INVENTORY_MISMATCH');
  }
  for (let index = 0; index < expectedBuckets.length; index += 1) {
    if (!sameTimestamp(expectedBuckets[index].created_at, actualBuckets[index].created_at)
        || !sameTimestamp(expectedBuckets[index].updated_at, actualBuckets[index].updated_at)) {
      throw new Error('LOCAL_STORAGE_BUCKET_METADATA_MISMATCH');
    }
  }

  const keyOf = item => `${item.bucket}\0${item.name}`;
  const expected = new Map(manifest.objects.map(item => [keyOf(item), item]));
  const actual = new Map(objects.map(item => [keyOf(item), item]));
  if (expected.size !== manifest.objects.length || actual.size !== objects.length || expected.size !== actual.size) {
    throw new Error('LOCAL_STORAGE_OBJECT_INVENTORY_MISMATCH');
  }
  for (const [key, source] of expected) {
    const restored = actual.get(key);
    if (!restored || source.id !== restored.id
        || !sameTimestamp(source.created_at, restored.created_at)
        || !sameTimestamp(source.updated_at, restored.updated_at)
        || !sameTimestamp(source.last_accessed_at, restored.last_accessed_at)
        || JSON.stringify(stableJson(source.metadata)) !== JSON.stringify(stableJson(restored.metadata))) {
      console.error('Storage object metadata mismatch details:');
      console.error('  Source object:', JSON.stringify({ id: source.id, created_at: source.created_at, updated_at: source.updated_at, last_accessed_at: source.last_accessed_at, metadata: source.metadata }));
      console.error('  Restored object:', JSON.stringify(restored ? { id: restored.id, created_at: restored.created_at, updated_at: restored.updated_at, last_accessed_at: restored.last_accessed_at, metadata: restored.metadata } : null));
      throw new Error('LOCAL_STORAGE_OBJECT_METADATA_MISMATCH');
    }
    const actualSize = Number(restored.size ?? restored.metadata?.size);
    if (!Number.isFinite(actualSize) || actualSize !== source.size) {
      throw new Error('LOCAL_STORAGE_OBJECT_SIZE_MISMATCH');
    }
  }
  return { buckets: expectedBuckets.length, objects: expected.size };
}

async function listAllObjects(baseUrl, key, bucketId, prefix = '') {
  const result = [];
  let offset = 0;
  while (true) {
    const page = await listPage(baseUrl, key, bucketId, prefix, offset);
    for (const entry of page) {
      if (isDirectory(entry)) {
        const nestedPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
        result.push(...await listAllObjects(baseUrl, key, bucketId, nestedPrefix));
      } else {
        const name = prefix ? `${prefix}/${entry.name}` : entry.name;
        result.push({ ...entry, bucket: bucketId, name });
      }
    }
    offset += page.length;
    if (page.length < PAGE_SIZE) break;
  }
  return result;
}

async function exportObjects(baseUrl, key, bucket, root, manifest) {
  let offset = 0;
  while (true) {
    const page = await listPage(baseUrl, key, bucket.id ?? bucket.name, '', offset);
    for (const entry of page) {
      const name = entry.name;
      if (isDirectory(entry)) {
        await exportPrefix(baseUrl, key, bucket, name, root, manifest);
      } else {
        await exportFile(baseUrl, key, bucket, name, root, manifest, entry);
      }
    }
    offset += page.length;
    if (page.length < PAGE_SIZE) break;
  }
}

async function exportPrefix(baseUrl, key, bucket, prefix, root, manifest) {
  let offset = 0;
  while (true) {
    const page = await listPage(baseUrl, key, bucket.id ?? bucket.name, prefix, offset);
    for (const entry of page) {
      const name = `${prefix}/${entry.name}`;
      if (isDirectory(entry)) await exportPrefix(baseUrl, key, bucket, name, root, manifest);
      else await exportFile(baseUrl, key, bucket, name, root, manifest, entry);
    }
    offset += page.length;
    if (page.length < PAGE_SIZE) break;
  }
}

async function exportFile(baseUrl, key, bucket, name, root, manifest, entry) {
  const destination = resolveObjectPath(root, bucket.name, name);
  const integrity = await downloadObject(baseUrl, key, bucket.id ?? bucket.name, name, destination);
  manifest.objects.push({
    bucket: bucket.name,
    name,
    id: entry.id ?? null,
    owner: entry.owner ?? null,
    owner_id: entry.owner_id ?? null,
    created_at: entry.created_at ?? null,
    updated_at: entry.updated_at ?? null,
    last_accessed_at: entry.last_accessed_at ?? null,
    metadata: entry.metadata ?? null,
    size: integrity.size,
    sha256: integrity.sha256,
  });
  manifest.totalBytes += integrity.size;
}

export async function exportStorage({ projectRef, projectUrl, serviceRoleKey, outputDir }) {
  const root = path.resolve(outputDir);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const buckets = await listBuckets(projectUrl, serviceRoleKey);
  const manifest = {
    format: 1,
    projectRef,
    generatedAt: new Date().toISOString(),
    buckets: buckets.map(({ id, name, public: isPublic, file_size_limit, allowed_mime_types, created_at, updated_at }) => ({
      id, name, public: Boolean(isPublic), file_size_limit: file_size_limit ?? null,
      allowed_mime_types: allowed_mime_types ?? null, created_at: created_at ?? null, updated_at: updated_at ?? null,
    })),
    objects: [],
    totalBytes: 0,
  };
  for (const bucket of buckets) await exportObjects(projectUrl, serviceRoleKey, bucket, root, manifest);
  const manifestPath = path.join(root, 'manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, { flag: 'wx', mode: 0o600 });
  return { buckets: manifest.buckets.length, objects: manifest.objects.length, bytes: manifest.totalBytes };
}

export async function verifyStorageArchive(rootDir) {
  const root = path.resolve(rootDir);
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
  if (manifest.format !== 1 || manifest.projectRef !== HOMOLOGATION_REF || !Array.isArray(manifest.buckets) || !Array.isArray(manifest.objects)) {
    throw new Error('STORAGE_MANIFEST_INVALID');
  }
  let bytes = 0;
  const expectedPaths = new Set(['manifest.json']);
  const bucketNames = new Set(manifest.buckets.map(bucket => bucket.name));
  if (bucketNames.size !== manifest.buckets.length || manifest.buckets.some(bucket => !bucket.name || !bucket.id || typeof bucket.public !== 'boolean')) {
    throw new Error('STORAGE_BUCKET_MANIFEST_INVALID');
  }
  const objectKeys = new Set();
  for (const item of manifest.objects) {
    if (!bucketNames.has(item.bucket) || typeof item.id !== 'string' || !item.id
        || !Number.isSafeInteger(item.size) || item.size < 0
        || !/^[a-f0-9]{64}$/.test(item.sha256 ?? '')) throw new Error('STORAGE_OBJECT_MANIFEST_INVALID');
    const objectKey = `${item.bucket}\0${item.name}`;
    if (objectKeys.has(objectKey)) throw new Error('STORAGE_OBJECT_MANIFEST_DUPLICATE');
    objectKeys.add(objectKey);
    const file = resolveObjectPath(root, item.bucket, item.name);
    expectedPaths.add(path.relative(root, file).split(path.sep).join('/'));
    const info = await stat(file);
    const hash = createHash('sha256');
    const stream = await import('node:fs').then(fs => fs.createReadStream(file));
    for await (const chunk of stream) hash.update(chunk);
    if (info.size !== item.size || hash.digest('hex') !== item.sha256) throw new Error('STORAGE_ARCHIVE_INTEGRITY_FAILED');
    bytes += info.size;
  }
  if (bytes !== manifest.totalBytes) throw new Error('STORAGE_ARCHIVE_SIZE_MISMATCH');
  const actualPaths = new Set();
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('STORAGE_ARCHIVE_SYMLINK_REJECTED');
      if (entry.isDirectory()) await walk(fullPath);
      else if (entry.isFile()) actualPaths.add(path.relative(root, fullPath).split(path.sep).join('/'));
      else throw new Error('STORAGE_ARCHIVE_ENTRY_INVALID');
    }
  }
  await walk(root);
  if (actualPaths.size !== expectedPaths.size || [...actualPaths].some(file => !expectedPaths.has(file))) {
    throw new Error('STORAGE_ARCHIVE_FILE_SET_MISMATCH');
  }
  return { buckets: manifest.buckets.length, objects: manifest.objects.length, bytes };
}

async function uploadLocalObject(baseUrl, key, bucketId, item, file) {
  const encodedPath = item.name.split('/').map(encodeURIComponent).join('/');
  const info = await stat(file);
  const body = (await import('node:fs')).createReadStream(file);
  const response = await apiRequest(baseUrl, key, `/storage/v1/object/${encodeURIComponent(bucketId)}/${encodedPath}`, {
    method: 'POST',
    headers: {
      'content-type': item.metadata?.mimetype || 'application/octet-stream',
      'content-length': String(info.size),
      'cache-control': item.metadata?.cacheControl || 'max-age=3600',
      'x-upsert': 'false',
    },
    body,
    duplex: 'half',
  });
  await response.body?.cancel();
}

export async function restoreStorageLocal({ archiveDir, metadataSqlPath, localUrl, localServiceRoleKey }) {
  assertLocalRestoreTarget(localUrl);
  const root = path.resolve(archiveDir);
  const checked = await verifyStorageArchive(root);
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
  const currentBuckets = await listBuckets(localUrl, localServiceRoleKey);
  if (currentBuckets.length !== 0) throw new Error('LOCAL_STORAGE_NOT_EMPTY');
  for (const bucket of manifest.buckets) {
    const response = await apiRequest(localUrl, localServiceRoleKey, '/storage/v1/bucket', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: bucket.id ?? bucket.name,
        name: bucket.name,
        public: bucket.public,
        file_size_limit: bucket.file_size_limit,
        allowed_mime_types: bucket.allowed_mime_types,
      }),
    });
    await response.body?.cancel();
  }
  for (const item of manifest.objects) {
    const file = resolveObjectPath(root, item.bucket, item.name);
    const manifestBucket = manifest.buckets.find(bucket => bucket.name === item.bucket);
    if (!manifestBucket) throw new Error('STORAGE_OBJECT_BUCKET_MISSING');
    const bucketId = manifestBucket.id ?? manifestBucket.name;
    await uploadLocalObject(localUrl, localServiceRoleKey, bucketId, item, file);
    const encodedPath = item.name.split('/').map(encodeURIComponent).join('/');
    const response = await apiRequest(localUrl, localServiceRoleKey, `/storage/v1/object/authenticated/${encodeURIComponent(bucketId)}/${encodedPath}`);
    if (!response.body) throw new Error('LOCAL_STORAGE_OBJECT_BODY_MISSING');
    const hash = createHash('sha256');
    let bytes = 0;
    for await (const chunk of Readable.fromWeb(response.body)) {
      hash.update(chunk);
      bytes += chunk.length;
    }
    if (bytes !== item.size || hash.digest('hex') !== item.sha256) throw new Error('LOCAL_STORAGE_RESTORE_INTEGRITY_FAILED');
  }
  const quote = value => value == null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;
  const jsonLiteral = value => value == null ? 'NULL::jsonb' : `${quote(JSON.stringify(value))}::jsonb`;
  const statements = [];
  for (const bucket of manifest.buckets) {
    statements.push(`DO $restore$ DECLARE changed integer; BEGIN UPDATE storage.buckets SET created_at=${quote(bucket.created_at)}::timestamptz, updated_at=${quote(bucket.updated_at)}::timestamptz WHERE id=${quote(bucket.id ?? bucket.name)}; GET DIAGNOSTICS changed = ROW_COUNT; IF changed <> 1 THEN RAISE EXCEPTION 'restored bucket metadata missing'; END IF; END $restore$;`);
  }
  for (const item of manifest.objects) {
    const bucket = manifest.buckets.find(candidate => candidate.name === item.bucket);
    if (!bucket) throw new Error('STORAGE_OBJECT_BUCKET_MISSING');
    statements.push(`DO $restore$ DECLARE changed integer; BEGIN UPDATE storage.objects SET id=${quote(item.id)}, created_at=${quote(item.created_at)}::timestamptz, updated_at=${quote(item.updated_at)}::timestamptz, last_accessed_at=${quote(item.last_accessed_at)}::timestamptz, metadata=${jsonLiteral(item.metadata)} WHERE bucket_id=${quote(bucket.id ?? bucket.name)} AND name=${quote(item.name)}; GET DIAGNOSTICS changed = ROW_COUNT; IF changed <> 1 THEN RAISE EXCEPTION 'restored object metadata missing'; END IF; END $restore$;`);
  }
  if (!metadataSqlPath) throw new Error('RESTORE_METADATA_OUTPUT_REQUIRED');
  await writeFile(path.resolve(metadataSqlPath), `${statements.join('\n')}\n`, { flag: 'wx', mode: 0o600 });
  return checked;
}

export async function verifyRestoredStorageLocal({ archiveDir, localUrl, localServiceRoleKey }) {
  assertLocalRestoreTarget(localUrl);
  const root = path.resolve(archiveDir);
  const checked = await verifyStorageArchive(root);
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
  const buckets = await listBuckets(localUrl, localServiceRoleKey);
  const objects = [];
  for (const bucket of buckets) {
    objects.push(...await listAllObjects(localUrl, localServiceRoleKey, bucket.id ?? bucket.name));
  }
  const normalized = objects.map(item => {
    const bucket = buckets.find(candidate => (candidate.id ?? candidate.name) === item.bucket);
    return { ...item, bucket: bucket?.name ?? item.bucket };
  });
  return { ...checked, ...assertStorageInventoryMatches(manifest, buckets, normalized) };
}

async function main() {
  const [operation, directory, metadataSqlPath] = process.argv.slice(2);
  if (!operation || !directory) throw new Error('USAGE');
  if (operation === 'export') {
    assertSourceTarget({
      projectRef: process.env.SUPABASE_PROJECT_REF,
      projectUrl: process.env.SUPABASE_PROJECT_URL,
      databaseUrl: process.env.SUPABASE_DB_URL,
      poolerHost: process.env.SUPABASE_POOLER_HOST,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    });
    const result = await exportStorage({
      projectRef: process.env.SUPABASE_PROJECT_REF,
      projectUrl: process.env.SUPABASE_PROJECT_URL,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      outputDir: directory,
    });
    console.log(`Storage export verified: ${result.buckets} buckets, ${result.objects} objects, ${result.bytes} bytes.`);
  } else if (operation === 'verify') {
    const result = await verifyStorageArchive(directory);
    console.log(`Storage archive integrity verified: ${result.buckets} buckets, ${result.objects} objects, ${result.bytes} bytes.`);
  } else if (operation === 'restore-local') {
    const result = await restoreStorageLocal({
      archiveDir: directory,
      metadataSqlPath,
      localUrl: process.env.RESTORE_SUPABASE_URL,
      localServiceRoleKey: process.env.RESTORE_SUPABASE_SERVICE_ROLE_KEY,
    });
    console.log(`Separate disposable Storage API restore loaded: ${result.buckets} buckets, ${result.objects} objects, ${result.bytes} bytes; object metadata verification follows after its local SQL metadata step.`);
  } else if (operation === 'verify-local') {
    const result = await verifyRestoredStorageLocal({
      archiveDir: directory,
      localUrl: process.env.RESTORE_SUPABASE_URL,
      localServiceRoleKey: process.env.RESTORE_SUPABASE_SERVICE_ROLE_KEY,
    });
    console.log(`Separate disposable Storage API inventory verified: ${result.buckets} buckets, ${result.objects} objects, ${result.bytes} bytes.`);
  } else {
    throw new Error('UNKNOWN_OPERATION');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(`Storage backup operation failed (${error.message.replace(/[^A-Z0-9_:-]/gi, '') || 'UNKNOWN'}).`);
    process.exitCode = 1;
  });
}
