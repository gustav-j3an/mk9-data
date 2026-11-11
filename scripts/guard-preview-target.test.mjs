import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPreviewTarget, HOMOLOGATION_PREVIEW_BRANCH, HOMOLOGATION_PROJECT_REF, validatePreviewTarget } from './guard-preview-target.mjs';

const valid = {
  branch: HOMOLOGATION_PREVIEW_BRANCH,
  supabaseUrl: `https://${HOMOLOGATION_PROJECT_REF}.supabase.co`,
  publishableKey: 'sb_publishable_test_public_key_long_enough',
};

test('dedicated Preview accepts only the homologation URL and a public key', () => {
  assert.deepEqual(validatePreviewTarget(valid), { ok: true, applies: true, projectRef: HOMOLOGATION_PROJECT_REF });
  assert.throws(() => assertPreviewTarget({ ...valid, supabaseUrl: 'https://xzmbesqhxcnuokjwrbnw.supabase.co' }), /restricted to the homologation/);
  assert.throws(() => assertPreviewTarget({ ...valid, publishableKey: '' }), /requires a Supabase publishable/);
});

test('legacy JWT keys must identify homologation and cannot be service role', () => {
  const jwt = (payload) => `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;
  assert.equal(assertPreviewTarget({ ...valid, publishableKey: jwt({ ref: HOMOLOGATION_PROJECT_REF, role: 'anon' }) }).ok, true);
  assert.throws(() => assertPreviewTarget({ ...valid, publishableKey: jwt({ ref: 'xzmbesqhxcnuokjwrbnw', role: 'anon' }) }), /claim does not match/);
  assert.throws(() => assertPreviewTarget({ ...valid, publishableKey: jwt({ ref: HOMOLOGATION_PROJECT_REF, role: 'service_role' }) }), /Service role/);
});

test('guard does not change normal development or production builds', () => {
  assert.deepEqual(validatePreviewTarget({ branch: 'main', supabaseUrl: 'https://xzmbesqhxcnuokjwrbnw.supabase.co', publishableKey: 'anything' }), { ok: true, applies: false });
});
