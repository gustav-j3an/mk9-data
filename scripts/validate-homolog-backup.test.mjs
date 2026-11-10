import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EXPECTED_BASELINE_MIGRATIONS_COUNT,
  EXPECTED_COMBINED_SHA256,
  validateCanonicalHomologationBackup
} from './validate-homolog-backup.mjs';

test('Backup Validator: verifies 47 canonical migrations and combined SHA-256', () => {
  const res = validateCanonicalHomologationBackup();
  assert.equal(res.ok, true);
  assert.equal(res.fileCount, EXPECTED_BASELINE_MIGRATIONS_COUNT);
  assert.equal(res.combinedSha256, EXPECTED_COMBINED_SHA256);
  assert.ok(res.totalBytes > 300000);
});

test('Backup Validator: accepts newline-only checkout changes but rejects SQL content changes', () => {
  const tempArchive = mkdtempSync(join(tmpdir(), 'mk9-backup-validator-'));
  try {
    const sourceFiles = readdirSync('supabase/fetched_homologation_migrations').filter(file => file.endsWith('.sql'));
    for (const file of sourceFiles) {
      const source = readFileSync(join('supabase/fetched_homologation_migrations', file), 'utf8');
      writeFileSync(join(tempArchive, file), source.replace(/\r\n?/g, '\n'), 'utf8');
    }

    const normalized = validateCanonicalHomologationBackup(tempArchive);
    assert.equal(normalized.ok, true, normalized.error);
    assert.equal(normalized.combinedSha256, EXPECTED_COMBINED_SHA256);

    for (const file of sourceFiles) {
      const source = readFileSync(join(tempArchive, file), 'utf8');
      writeFileSync(join(tempArchive, file), source.replace(/\n/g, '\r\n'), 'utf8');
    }
    const windowsCheckout = validateCanonicalHomologationBackup(tempArchive);
    assert.equal(windowsCheckout.ok, true, windowsCheckout.error);
    assert.equal(windowsCheckout.combinedSha256, EXPECTED_COMBINED_SHA256);

    const changedFile = sourceFiles.sort()[0];
    const changedSql = readFileSync(join(tempArchive, changedFile), 'utf8');
    writeFileSync(join(tempArchive, changedFile), `${changedSql}\n-- integrity mutation\n`, 'utf8');
    const changed = validateCanonicalHomologationBackup(tempArchive);
    assert.equal(changed.ok, false);
    assert.match(changed.error, /Canonical content mismatch/);
  } finally {
    rmSync(tempArchive, { recursive: true, force: true });
  }
});
