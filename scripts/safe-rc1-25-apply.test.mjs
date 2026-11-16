import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLOWED_APPLY_BRANCH,
  REQUIRED_CONFIRMATION,
  AUTHORIZED_RC125_MIGRATION,
  validateMigrationIntegrity,
  executeRc125HomologationApply
} from './safe-rc1-25-apply.mjs';
import { ALLOWED_HOMOLOG_PROJECT_REF, FORBIDDEN_PRODUCTION_PROJECT_REF } from './guard-homolog-env.mjs';

test('validateMigrationIntegrity validates RC1.25 migration hash', () => {
  const result = validateMigrationIntegrity();
  assert.equal(result.ok, true);
  assert.equal(result.sha256, AUTHORIZED_RC125_MIGRATION.expectedSha256);
});

test('executeRc125HomologationApply rejects invalid branch', () => {
  assert.throws(() => {
    executeRc125HomologationApply({
      GITHUB_REF: 'refs/heads/main',
      INPUT_PROJECT_REF: ALLOWED_HOMOLOG_PROJECT_REF,
      INPUT_CONFIRMATION: REQUIRED_CONFIRMATION
    });
  }, /BRANCH_NOT_ALLOWED/);
});

test('executeRc125HomologationApply blocks production project ref immediately', () => {
  assert.throws(() => {
    executeRc125HomologationApply({
      GITHUB_REF: `refs/heads/${ALLOWED_APPLY_BRANCH}`,
      INPUT_PROJECT_REF: FORBIDDEN_PRODUCTION_PROJECT_REF,
      INPUT_CONFIRMATION: REQUIRED_CONFIRMATION
    });
  }, /PRODUCTION project/);
});

test('executeRc125HomologationApply requires exact confirmation string', () => {
  assert.throws(() => {
    executeRc125HomologationApply({
      GITHUB_REF: `refs/heads/${ALLOWED_APPLY_BRANCH}`,
      INPUT_PROJECT_REF: ALLOWED_HOMOLOG_PROJECT_REF,
      INPUT_CONFIRMATION: 'APLICAR'
    });
  }, /CONFIRMATION_MISMATCH/);
});

test('executeRc125HomologationApply requires SUPABASE_DB_URL', () => {
  assert.throws(() => {
    executeRc125HomologationApply({
      GITHUB_REF: `refs/heads/${ALLOWED_APPLY_BRANCH}`,
      INPUT_PROJECT_REF: ALLOWED_HOMOLOG_PROJECT_REF,
      INPUT_CONFIRMATION: REQUIRED_CONFIRMATION,
      SUPABASE_DB_URL: ''
    });
  }, /SUPABASE_DB_URL is missing/);
});
