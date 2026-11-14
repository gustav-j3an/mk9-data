import { createClient } from '@supabase/supabase-js';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

const root = path.resolve(process.argv[2] ?? 'storage-objects');
const url = process.env.SUPABASE_PROJECT_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('M65_STORAGE_EXPORT_CONFIGURATION_MISSING');

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const manifest = createWriteStream(path.join(path.dirname(root), 'storage-objects-manifest.jsonl'), {
  flags: 'w', mode: 0o600,
});
let count = 0;

function safeSegments(value) {
  const segments = value.split('/');
  if (segments.some((part) => !part || part === '.' || part === '..' || part.includes('\\') || part.includes('\0'))) {
    throw new Error('M65_STORAGE_OBJECT_PATH_REJECTED');
  }
  return segments;
}

async function walk(bucket, prefix = '') {
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, {
      limit: pageSize,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw new Error('M65_STORAGE_LIST_FAILED');
    if (!data?.length) break;
    for (const entry of data) {
      const objectKey = prefix ? `${prefix}/${entry.name}` : entry.name;
      const segments = safeSegments(objectKey);
      if (entry.id === null) {
        await walk(bucket, objectKey);
        continue;
      }
      const destination = path.resolve(root, bucket, ...segments);
      if (!destination.startsWith(`${root}${path.sep}`)) throw new Error('M65_STORAGE_OBJECT_PATH_REJECTED');
      await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      const { data: blob, error: downloadError } = await supabase.storage.from(bucket).download(objectKey);
      if (downloadError || !blob) throw new Error('M65_STORAGE_DOWNLOAD_FAILED');
      await pipeline(blob.stream(), createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
      manifest.write(`${JSON.stringify({ bucket, key: objectKey, size: blob.size, updated_at: entry.updated_at ?? null })}\n`);
      count += 1;
    }
    if (data.length < pageSize) break;
  }
}

try {
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error || !buckets) throw new Error('M65_STORAGE_BUCKET_LIST_FAILED');
  await mkdir(root, { recursive: true, mode: 0o700 });
  for (const { name } of buckets) {
    safeSegments(name);
    await walk(name);
  }
  const flushed = once(manifest, 'finish');
  manifest.end();
  await flushed;
  process.stdout.write(`M65_STORAGE_EXPORT_COMPLETE object_count=${count}\n`);
} catch (error) {
  manifest.destroy();
  process.stderr.write(`${error instanceof Error ? error.message : 'M65_STORAGE_EXPORT_FAILED'}\n`);
  process.exitCode = 1;
}
