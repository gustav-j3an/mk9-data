import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLOWED_HOMOLOG_PROJECT_REF,
  FORBIDDEN_PRODUCTION_PROJECT_REF,
  validateTargetProject,
  validateIsolationFromRepoLink
} from './guard-homolog-env.mjs';

test('Security Guard: allows exclusively homologation project ref', () => {
  const res = validateTargetProject(ALLOWED_HOMOLOG_PROJECT_REF);
  assert.equal(res.ok, true);
  assert.equal(res.projectRef, 'tafjceemuetqjyngresg');
});

test('Security Guard: blocks production project ref with fatal error', () => {
  const res = validateTargetProject(FORBIDDEN_PRODUCTION_PROJECT_REF);
  assert.equal(res.ok, false);
  assert.match(res.error, /FATAL/);
  assert.match(res.error, /xzmbesqhxcnuokjwrbnw/);
});

test('Security Guard: blocks empty, whitespace, or omitted project ref', () => {
  assert.equal(validateTargetProject('').ok, false);
  assert.equal(validateTargetProject('   ').ok, false);
  assert.equal(validateTargetProject(undefined).ok, false);
  assert.equal(validateTargetProject(null).ok, false);
});

test('Security Guard: blocks unauthorized third-party projects', () => {
  const res = validateTargetProject('rtmpkmbfcedxpfejdmho');
  assert.equal(res.ok, false);
  assert.match(res.error, /BLOCKED/);
});

test('Security Guard: verifies mandatory workspace isolation when repo links to production', () => {
  const res = validateIsolationFromRepoLink('xzmbesqhxcnuokjwrbnw');
  assert.equal(res.ok, true);
  assert.equal(res.isolated, true);
  assert.match(res.warning, /isolated temp workdir is MANDATORY/);
});
