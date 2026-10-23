import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBuildMetadata, parseGithubRepository, summarizeRelation } from './check-publication.mjs';

test('publication checker parses GitHub remotes', () => {
  assert.equal(parseGithubRepository('https://github.com/gustav-j3an/mk9-data.git'), 'gustav-j3an/mk9-data');
  assert.equal(parseGithubRepository('git@github.com:gustav-j3an/mk9-data.git'), 'gustav-j3an/mk9-data');
  assert.equal(parseGithubRepository('https://example.com/repo.git'), null);
});

test('publication checker reads the generated build marker from HTML', () => {
  assert.deepEqual(parseBuildMetadata('<meta name="mk9-build-version" content="2.6.1" /><meta name="mk9-build-commit" content="abc1234" /><meta name="mk9-build-ref" content="main" />'), {
    version: '2.6.1', commit: 'abc1234', ref: 'main',
  });
  assert.deepEqual(parseBuildMetadata('<html></html>'), { version: null, commit: null, ref: null });
});

test('publication checker explains branch relations', () => {
  assert.equal(summarizeRelation(0, 0), 'sincronizadas');
  assert.equal(summarizeRelation(0, 2), 'desenvolvimento 2 commit(s) à frente');
  assert.equal(summarizeRelation(1, 0), 'desenvolvimento 1 commit(s) atrás');
  assert.equal(summarizeRelation(3, 2), 'divergentes (3 exclusivos em main, 2 exclusivos em recovery)');
});
