import test from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWED_APPLY_BRANCH } from './safe-m38-apply.mjs';
import { ALLOWED_HOMOLOG_PROJECT_REF, FORBIDDEN_PRODUCTION_PROJECT_REF } from './guard-homolog-env.mjs';
import { REQUIRED_CONFIRMATION, validateAuthorizedMigrationsIntegrity } from './safe-homolog-executor.mjs';

test('M38 apply branch matches allowed policy', () => {
  assert.equal(ALLOWED_APPLY_BRANCH, 'codex/m50.1-m38-homolog-apply');
});

test('M38 apply requires exact confirmation string', () => {
  assert.equal(
    REQUIRED_CONFIRMATION,
    'APPLY_M38_TO_HOMOLOGATION:tafjceemuetqjyngresg:20261110150000,20261110160000,20261110170000'
  );
});

test('M38 apply verifies migration file integrity', () => {
  const result = validateAuthorizedMigrationsIntegrity();
  assert.equal(result.ok, true, result.error);
  assert.equal(result.migrations.length, 3);
});
