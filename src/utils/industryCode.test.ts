import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isValidIndustryCode, normalizeIndustryCode } from './industryCode';

describe('industry codes', () => {
  it('normalizes whitespace and case', () => {
    assert.equal(normalizeIndustryCode(' ind-abc-01 '), 'IND-ABC-01');
    assert.equal(isValidIndustryCode(' ind-abc-01 '), true);
  });

  it('accepts alphanumeric segments and rejects malformed values', () => {
    for (const code of ['IND-001', 'IND-TEST-001', 'IND-A']) {
      assert.equal(isValidIndustryCode(code), true, code);
    }
    for (const code of ['', 'IND', 'IND-1 bad', 'IND-001!', 'LOJ-001', 'IND--001']) {
      assert.equal(isValidIndustryCode(code), false, code);
    }
  });
});
