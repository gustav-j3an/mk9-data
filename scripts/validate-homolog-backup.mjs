import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import {
  ALLOWED_HOMOLOG_PROJECT_REF,
  validateTargetProject
} from './guard-homolog-env.mjs';

/**
 * scripts/validate-homolog-backup.mjs
 * Validador de integridade e completude do backup canônico independente de homologação.
 */

export const EXPECTED_BASELINE_MIGRATIONS_COUNT = 47;
export const EXPECTED_COMBINED_SHA256 = 'A64E0ACDE372B322A92BAEA946242B251BE967A75A7DFB6AB4618CDFC756723E';

export function validateCanonicalHomologationBackup(archiveDir = 'supabase/fetched_homologation_migrations') {
  const files = readdirSync(archiveDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  if (files.length !== EXPECTED_BASELINE_MIGRATIONS_COUNT) {
    return {
      ok: false,
      error: `Backup validation failed: Expected ${EXPECTED_BASELINE_MIGRATIONS_COUNT} files, found ${files.length}.`
    };
  }

  const hashList = [];
  let totalBytes = 0;

  for (const f of files) {
    const fullPath = join(archiveDir, f);
    const buf = readFileSync(fullPath);
    totalBytes += buf.length;
    // Canonicalize text line endings so the existing pinned backup digest is OS independent.
    const content = buf.toString('utf8').replace(/\r?\n/g, '\r\n');
    const sha = createHash('sha256').update(content, 'utf8').digest('hex').toUpperCase();
    hashList.push(sha);
  }

  const combined = createHash('sha256').update(hashList.join('')).digest('hex').toUpperCase();

  if (combined !== EXPECTED_COMBINED_SHA256) {
    return {
      ok: false,
      error: `Integrity check mismatch! Expected ${EXPECTED_COMBINED_SHA256}, calculated ${combined}`
    };
  }

  return {
    ok: true,
    fileCount: files.length,
    totalBytes,
    combinedSha256: combined
  };
}

if (process.argv[1] && process.argv[1].endsWith('validate-homolog-backup.mjs')) {
  const target = process.argv[2] || ALLOWED_HOMOLOG_PROJECT_REF;
  const guard = validateTargetProject(target);
  if (!guard.ok) {
    console.error(guard.error);
    process.exit(1);
  }
  const res = validateCanonicalHomologationBackup();
  if (!res.ok) {
    console.error(res.error);
    process.exit(1);
  }
  console.log(`[BACKUP VALIDATED] ${res.fileCount} canonical files (${res.totalBytes} bytes). Combined SHA256: ${res.combinedSha256}`);
  process.exit(0);
}
