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
const INVENTORY_FILE = 'docs/m37.21-fetched-migrations-inventory.md';

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex').toUpperCase();
}

function parseCanonicalInventory() {
  const inventory = readFileSync(INVENTORY_FILE, 'utf8');
  return [...inventory.matchAll(/^\|\s*\d+\s*\|\s*\d+\s*\|\s*`([^`]+)`\s*\|\s*(\d+)\s*\|\s*`([A-F0-9]{64})`\s*\|\s*$/gm)]
    .map(([, file, bytes, sha]) => ({ file, bytes: Number(bytes), sha }));
}

function newlineVariants(buffer) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  const lfText = text.replace(/\r\n?/g, '\n');
  const lf = Buffer.from(lfText, 'utf8');
  const crlf = Buffer.from(lfText.replace(/\n/g, '\r\n'), 'utf8');
  // Two canonical fetched files retain LF on the final line ending.
  const crlfWithLfTerminator = Buffer.from(lfText.replace(/\n/g, '\r\n').replace(/\r\n$/, '\n'), 'utf8');
  return { lf, crlf, crlfWithLfTerminator };
}

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

  const inventory = parseCanonicalInventory();
  if (inventory.length !== EXPECTED_BASELINE_MIGRATIONS_COUNT) {
    return {
      ok: false,
      error: `Canonical inventory validation failed: Expected ${EXPECTED_BASELINE_MIGRATIONS_COUNT} rows, found ${inventory.length}.`
    };
  }
  const inventoryByFile = new Map(inventory.map(entry => [entry.file, entry]));
  const inventoryFiles = [...inventoryByFile.keys()].sort();
  if (new Set(inventoryByFile.keys()).size !== inventory.length
      || files.some((file, index) => file !== inventoryFiles[index])) {
    return { ok: false, error: 'Backup file names do not exactly match the canonical 47-file inventory.' };
  }

  const hashList = [];
  let totalBytes = 0;

  for (const f of files) {
    const fullPath = join(archiveDir, f);
    const buf = readFileSync(fullPath);
    let variants;
    try {
      variants = newlineVariants(buf);
    } catch {
      return { ok: false, error: `Migration ${f} is not valid UTF-8.` };
    }

    const expected = inventoryByFile.get(f);
    const matchingVariant = Object.values(variants).find(candidate => sha256(candidate) === expected.sha);
    if (!matchingVariant || matchingVariant.length !== expected.bytes) {
      return {
        ok: false,
        error: `Canonical content mismatch for ${f}: inventory SHA-256/size ${expected.sha}/${expected.bytes} does not match any newline-only representation.`
      };
    }

    // Hash a single CRLF representation so the aggregate stays stable across
    // Windows and Linux while preserving every non-newline byte.
    totalBytes += variants.crlf.length;
    hashList.push(sha256(variants.crlf));
  }

  const combined = sha256(Buffer.from(hashList.join(''), 'utf8'));

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
