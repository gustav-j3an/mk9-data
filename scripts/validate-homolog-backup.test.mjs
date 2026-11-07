import test from 'node:test';
import assert from 'node:assert/strict';
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
