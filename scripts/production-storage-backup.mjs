import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { PRODUCTION_REF, parseProductionPoolerUrl } from './production-pooler-connection.mjs';

const PAGE_SIZE = 500;

export function assertSourceTarget({ projectRef, projectUrl, databaseUrl, poolerHost, serviceRoleKey }) {
  if (projectRef !== PRODUCTION_REF) throw new Error('PROJECT_REF_MISMATCH');
  const api = new URL(projectUrl);
  if (api.protocol !== 'https:' || api.hostname !== `${PRODUCTION_REF}.supabase.co`) {
    throw new Error('PROJECT_URL_MISMATCH');
  }
  parseProductionPoolerUrl(databaseUrl, poolerHost);
  const payload = decodeJwtPayload(serviceRoleKey);
  if (payload.role !== 'service_role' || payload.ref !== PRODUCTION_REF) {
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

async function listAllObjects(baseUrl, key, bucketId) {
  const collected = [];
  async function traverse(prefix = '') {
    let offset = 0;
    while (true) {
      const page = await listPage(baseUrl, key, bucketId, prefix, offset);
      if (page.length === 0) break;
      for (const entry of page) {
        if (isDirectory(entry)) {
          const nextPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
          await traverse(nextPrefix);
        } else {
          const objectName = prefix ? `${prefix}/${entry.name}` : entry.name;
          collected.push({ ...entry, bucket: bucketId, name: objectName });
        }
      }
      if (page.length < PAGE_SIZE) break;
      offset += page.length;
    }
  }
  await traverse();
  collected.sort((a, b) => a.name.localeCompare(b.name));
  return collected;
}

export async function exportStorage({ projectRef, projectUrl, serviceRoleKey, outputDir }) {
  if (projectRef !== PRODUCTION_REF) throw new Error('PROJECT_REF_MISMATCH');
  const targetDir = path.resolve(outputDir);
  await mkdir(targetDir, { recursive: true, mode: 0o700 });
  const buckets = await listBuckets(projectUrl, serviceRoleKey);
  const normalizedBuckets = buckets
    .map(b => ({
      id: b.id ?? b.name,
      name: b.name,
      public: Boolean(b.public),
      file_size_limit: b.file_size_limit ?? null,
      allowed_mime_types: Array.isArray(b.allowed_mime_types) ? [...b.allowed_mime_types].sort() : null,
      created_at: b.created_at ?? null,
      updated_at: b.updated_at ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const manifestObjects = [];
  let totalBytes = 0;
  for (const bucket of normalizedBuckets) {
    const objects = await listAllObjects(projectUrl, serviceRoleKey, bucket.id);
    for (const obj of objects) {
      const destination = resolveObjectPath(targetDir, bucket.name, obj.name);
      const downloaded = await downloadObject(projectUrl, serviceRoleKey, bucket.id, obj.name, destination);
      totalBytes += downloaded.size;
      manifestObjects.push({
        bucket: bucket.name,
        name: obj.name,
        id: obj.id ?? null,
        updated_at: obj.updated_at ?? null,
        created_at: obj.created_at ?? null,
        last_accessed_at: obj.last_accessed_at ?? null,
        metadata: stableJson(obj.metadata ?? {}),
        sha256: downloaded.sha256,
        bytes: downloaded.size,
      });
    }
  }
  manifestObjects.sort((a, b) => a.bucket === b.bucket ? a.name.localeCompare(b.name) : a.bucket.localeCompare(b.bucket));
  const manifest = {
    schema_version: '1.0',
    exported_at: new Date().toISOString(),
    project_ref: PRODUCTION_REF,
    bucket_count: normalizedBuckets.length,
    object_count: manifestObjects.length,
    total_bytes: totalBytes,
    buckets: normalizedBuckets,
    objects: manifestObjects,
  };
  await writeFile(path.join(targetDir, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
  return { buckets: normalizedBuckets.length, objects: manifestObjects.length, bytes: totalBytes };
}

export async function verifyStorageArchive(archiveDir) {
  const root = path.resolve(archiveDir);
  const manifestPath = path.join(root, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.project_ref !== PRODUCTION_REF) throw new Error('PROJECT_REF_MISMATCH');
  let checkedBytes = 0;
  for (const obj of manifest.objects) {
    const filePath = resolveObjectPath(root, obj.bucket, obj.name);
    const content = await readFile(filePath);
    const hash = createHash('sha256').update(content).digest('hex');
    if (hash !== obj.sha256 || content.length !== obj.bytes) {
      throw new Error(`STORAGE_CHECKSUM_MISMATCH: ${obj.bucket}/${obj.name}`);
    }
    checkedBytes += content.length;
  }
  if (checkedBytes !== manifest.total_bytes) throw new Error('STORAGE_TOTAL_BYTES_MISMATCH');
  return { buckets: manifest.bucket_count, objects: manifest.object_count, bytes: checkedBytes };
}

export function assertStorageInventoryMatches(sourceManifest, restoredBuckets, restoredObjects) {
  // 1. Rigorous comparison of buckets: names and security configurations
  const sourceBucketMap = new Map(sourceManifest.buckets.map(b => [b.name, b]));
  const restoredBucketMap = new Map(restoredBuckets.map(b => [b.name, b]));

  if (sourceBucketMap.size !== restoredBucketMap.size) {
    throw new Error('STORAGE_RESTORE_BUCKET_MISMATCH: bucket count mismatch');
  }

  for (const [name, src] of sourceBucketMap.entries()) {
    const res = restoredBucketMap.get(name);
    if (!res) {
      throw new Error(`STORAGE_RESTORE_BUCKET_MISMATCH: bucket missing in restore: ${name}`);
    }
    if (Boolean(src.public) !== Boolean(res.public)) {
      throw new Error(`STORAGE_RESTORE_BUCKET_CONFIG_MISMATCH: ${name} public setting mismatch`);
    }
    if ((src.file_size_limit ?? null) !== (res.file_size_limit ?? null)) {
      throw new Error(`STORAGE_RESTORE_BUCKET_CONFIG_MISMATCH: ${name} file_size_limit mismatch`);
    }
    const srcMime = src.allowed_mime_types ? [...src.allowed_mime_types].sort() : [];
    const resMime = res.allowed_mime_types ? [...res.allowed_mime_types].sort() : [];
    if (JSON.stringify(srcMime) !== JSON.stringify(resMime)) {
      throw new Error(`STORAGE_RESTORE_BUCKET_CONFIG_MISMATCH: ${name} allowed_mime_types mismatch`);
    }
  }

  // 2. Rigorous comparison of objects: signatures, sizes, and hashes
  const sourceObjectSignatures = sourceManifest.objects
    .map(o => ({ bucket: o.bucket, name: o.name, sha256: o.sha256, bytes: o.bytes }))
    .sort((a, b) => a.bucket === b.bucket ? a.name.localeCompare(b.name) : a.bucket.localeCompare(b.bucket));
  const restoredObjectSignatures = restoredObjects
    .map(o => ({
      bucket: o.bucket,
      name: o.name,
      sha256: o.sha256 ?? o.metadata?.sha256 ?? o.metadata?.eTag,
      bytes: o.bytes ?? o.metadata?.size,
    }))
    .sort((a, b) => a.bucket === b.bucket ? a.name.localeCompare(b.name) : a.bucket.localeCompare(b.bucket));

  if (sourceObjectSignatures.length !== restoredObjectSignatures.length) {
    throw new Error(`STORAGE_RESTORE_OBJECT_COUNT_MISMATCH: expected ${sourceObjectSignatures.length}, got ${restoredObjectSignatures.length}`);
  }

  for (let i = 0; i < sourceObjectSignatures.length; i += 1) {
    const s = sourceObjectSignatures[i];
    const r = restoredObjectSignatures[i];
    if (s.bucket !== r.bucket || s.name !== r.name) {
      throw new Error(`STORAGE_RESTORE_OBJECT_MISMATCH: expected ${s.bucket}/${s.name}, got ${r.bucket}/${r.name}`);
    }
    if (s.bytes !== r.bytes) {
      throw new Error(`STORAGE_RESTORE_SIZE_MISMATCH: ${s.bucket}/${s.name} expected ${s.bytes} bytes, got ${r.bytes}`);
    }
    if (r.sha256 && s.sha256 !== r.sha256) {
      throw new Error(`STORAGE_RESTORE_HASH_MISMATCH: ${s.bucket}/${s.name} metadata hash mismatch`);
    }
  }
  return true;
}

export async function restoreStorageLocal({ archiveDir, metadataSqlPath, localUrl, localServiceRoleKey }) {
  assertLocalRestoreTarget(localUrl);
  const root = path.resolve(archiveDir);
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
  const checked = await verifyStorageArchive(root);
  const existingBuckets = await listBuckets(localUrl, localServiceRoleKey);
  const existingBucketMap = new Map(existingBuckets.map(b => [b.name, b]));

  for (const bucket of manifest.buckets) {
    if (!existingBucketMap.has(bucket.name)) {
      await apiRequest(localUrl, localServiceRoleKey, '/storage/v1/bucket', {
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
    }
  }

  for (const obj of manifest.objects) {
    const filePath = resolveObjectPath(root, obj.bucket, obj.name);
    const content = await readFile(filePath);
    const encodedPath = obj.name.split('/').map(encodeURIComponent).join('/');
    const response = await fetch(new URL(`/storage/v1/object/${encodeURIComponent(obj.bucket)}/${encodedPath}`, localUrl), {
      method: 'POST',
      headers: authHeaders(localServiceRoleKey, {
        'content-type': obj.metadata?.mimetype ?? 'application/octet-stream',
        'x-upsert': 'true',
      }),
      body: content,
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`STORAGE_UPLOAD_HTTP_${response.status}`);
    await response.body?.cancel();
  }
  const quote = value => value == null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;
  const jsonLiteral = value => value == null ? 'NULL::jsonb' : `${quote(JSON.stringify(value))}::jsonb`;
  const statements = [];
  statements.push('ALTER TABLE storage.objects DISABLE TRIGGER update_objects_updated_at;');
  for (const bucket of manifest.buckets) {
    statements.push(`DO $restore$ DECLARE changed integer; BEGIN UPDATE storage.buckets SET created_at=${quote(bucket.created_at)}::timestamptz, updated_at=${quote(bucket.updated_at)}::timestamptz WHERE id=${quote(bucket.id ?? bucket.name)}; GET DIAGNOSTICS changed = ROW_COUNT; IF changed <> 1 THEN RAISE EXCEPTION 'restored bucket metadata missing'; END IF; END $restore$;`);
  }
  for (const item of manifest.objects) {
    const bucket = manifest.buckets.find(candidate => candidate.name === item.bucket);
    if (!bucket) throw new Error('STORAGE_OBJECT_BUCKET_MISSING');
    statements.push(`DO $restore$ DECLARE changed integer; BEGIN UPDATE storage.objects SET id=${quote(item.id)}, created_at=${quote(item.created_at)}::timestamptz, updated_at=${quote(item.updated_at)}::timestamptz, last_accessed_at=${quote(item.last_accessed_at)}::timestamptz, metadata=${jsonLiteral(item.metadata)} WHERE bucket_id=${quote(bucket.id ?? bucket.name)} AND name=${quote(item.name)}; GET DIAGNOSTICS changed = ROW_COUNT; IF changed <> 1 THEN RAISE EXCEPTION 'restored object metadata missing'; END IF; END $restore$;`);
  }
  statements.push('ALTER TABLE storage.objects ENABLE TRIGGER update_objects_updated_at;');
  if (!metadataSqlPath) throw new Error('RESTORE_METADATA_OUTPUT_REQUIRED');
  await writeFile(path.resolve(metadataSqlPath), `${statements.join('\n')}\n`, { flag: 'w', mode: 0o600 });
  return checked;
}

export async function verifyRestoredStorageLocal({ archiveDir, localUrl, localServiceRoleKey }) {
  assertLocalRestoreTarget(localUrl);
  const root = path.resolve(archiveDir);
  const checked = await verifyStorageArchive(root);
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
  const buckets = await listBuckets(localUrl, localServiceRoleKey);
  const objects = [];
  let totalDownloadedBytes = 0;

  for (const bucket of buckets) {
    const bucketObjects = await listAllObjects(localUrl, localServiceRoleKey, bucket.id ?? bucket.name);
    for (const obj of bucketObjects) {
      // Direct binary download and byte hashing from the restored local Storage API
      const encodedPath = obj.name.split('/').map(encodeURIComponent).join('/');
      const response = await apiRequest(localUrl, localServiceRoleKey, `/storage/v1/object/authenticated/${encodeURIComponent(bucket.id ?? bucket.name)}/${encodedPath}`);
      if (!response.body) throw new Error('STORAGE_RESTORE_DOWNLOAD_BODY_MISSING');
      const digest = createHash('sha256');
      let byteCount = 0;
      for await (const chunk of response.body) {
        digest.update(chunk);
        byteCount += chunk.length;
      }
      totalDownloadedBytes += byteCount;
      objects.push({
        ...obj,
        bucket: bucket.name,
        sha256: digest.digest('hex'),
        bytes: byteCount,
      });
    }
  }

  if (totalDownloadedBytes !== manifest.total_bytes) {
    throw new Error(`STORAGE_RESTORE_TOTAL_BYTES_MISMATCH: expected ${manifest.total_bytes}, got ${totalDownloadedBytes}`);
  }

  assertStorageInventoryMatches(manifest, buckets, objects);
  return { ...checked, restoredBytes: totalDownloadedBytes, objects: objects.length };
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
