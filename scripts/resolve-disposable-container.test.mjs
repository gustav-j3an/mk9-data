import test from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyCandidateContainerMetadata,
  filterVerifiedContainers,
  verifyDatabaseNonceMatch,
} from './resolve-disposable-container.mjs';

test('resolve-disposable-container: cenário 1 - container correto identificado', () => {
  const expectedProjectId = 'disposable_stack_a1b2c3d4';
  const validCandidate = {
    id: '77c8ec52dacd',
    name: '/supabase_db_disposable_stack_a1b2c3d4',
    image: 'supabase/postgres:17.2.0.1',
    labels: {
      'com.supabase.cli.project': 'disposable_stack_a1b2c3d4',
      'com.docker.compose.project': 'disposable_stack_a1b2c3d4',
    },
  };

  const metaCheck = verifyCandidateContainerMetadata({
    containerId: validCandidate.id,
    containerName: validCandidate.name,
    image: validCandidate.image,
    labels: validCandidate.labels,
    expectedProjectId,
  });
  assert.equal(metaCheck.valid, true);

  const selected = filterVerifiedContainers([validCandidate], expectedProjectId);
  assert.equal(selected.id, '77c8ec52dacd');

  // Nonce check verification
  const execFn = (id, query) => {
    assert.equal(id, '77c8ec52dacd');
    assert.ok(query.includes('mk9_backup_restore_nonce'));
    return 'secret-nonce-12345';
  };

  assert.equal(
    verifyDatabaseNonceMatch({
      containerId: selected.id,
      expectedNonce: 'secret-nonce-12345',
      execFn,
    }),
    true
  );
});

test('resolve-disposable-container: cenário 2 - container de outra stack identificado como único candidato', () => {
  const expectedProjectId = 'disposable_stack_a1b2c3d4';
  const otherStackCandidate = {
    id: '998877665544',
    name: '/supabase_db_other_project_9999',
    image: 'supabase/postgres:17.2.0.1',
    labels: {
      'com.supabase.cli.project': 'other_project_9999',
    },
  };

  const metaCheck = verifyCandidateContainerMetadata({
    containerId: otherStackCandidate.id,
    containerName: otherStackCandidate.name,
    image: otherStackCandidate.image,
    labels: otherStackCandidate.labels,
    expectedProjectId,
  });
  assert.equal(metaCheck.valid, false);
  assert.equal(metaCheck.reason, 'NAME_MISMATCH');

  // Should fail to filter when only other stack is present
  assert.throws(
    () => filterVerifiedContainers([otherStackCandidate], expectedProjectId),
    /DISPOSABLE_CONTAINER_RESOLUTION_FAILED.*found 0/
  );
});

test('resolve-disposable-container: cenário 3 - dois containers semelhantes encontrados', () => {
  const expectedProjectId = 'disposable_stack_a1b2c3d4';
  const candidate1 = {
    id: '111122223333',
    name: 'supabase_db_disposable_stack_a1b2c3d4',
    image: 'supabase/postgres:17.2.0.1',
    labels: { 'com.supabase.cli.project': 'disposable_stack_a1b2c3d4' },
  };
  const candidate2 = {
    id: '444455556666',
    name: '/supabase_db_disposable_stack_a1b2c3d4',
    image: 'supabase/postgres:17.2.0.1',
    labels: { 'com.supabase.cli.project': 'disposable_stack_a1b2c3d4' },
  };

  // Ambiguous: 2 matching containers with the same project id
  assert.throws(
    () => filterVerifiedContainers([candidate1, candidate2], expectedProjectId),
    /DISPOSABLE_CONTAINER_RESOLUTION_FAILED.*found 2/
  );
});

test('resolve-disposable-container: cenário 4 - container com imagem válida, mas identidade incorreta', () => {
  const expectedProjectId = 'disposable_stack_a1b2c3d4';

  // 4.1 Image valid, but name mismatch
  const wrongName = {
    id: '112233445566',
    name: 'supabase_db_wrong_stack',
    image: 'supabase/postgres:17.2.0.1',
  };
  const res1 = verifyCandidateContainerMetadata({
    containerId: wrongName.id,
    containerName: wrongName.name,
    image: wrongName.image,
    expectedProjectId,
  });
  assert.equal(res1.valid, false);
  assert.equal(res1.reason, 'NAME_MISMATCH');

  // 4.2 Image valid, name matches, but CLI project label mismatch
  const wrongLabel = {
    id: '112233445566',
    name: 'supabase_db_disposable_stack_a1b2c3d4',
    image: 'supabase/postgres:17.2.0.1',
    labels: { 'com.supabase.cli.project': 'unauthorized_attacker_project' },
  };
  const res2 = verifyCandidateContainerMetadata({
    containerId: wrongLabel.id,
    containerName: wrongLabel.name,
    image: wrongLabel.image,
    labels: wrongLabel.labels,
    expectedProjectId,
  });
  assert.equal(res2.valid, false);
  assert.equal(res2.reason, 'CLI_PROJECT_LABEL_MISMATCH');

  // 4.3 Image valid, name matches, but database nonce check fails (spoofed container)
  const spoofedExec = () => 'wrong-foreign-nonce';
  assert.throws(
    () =>
      verifyDatabaseNonceMatch({
        containerId: '112233445566',
        expectedNonce: 'legitimate-disposable-nonce-777',
        execFn: spoofedExec,
      }),
    /CONTAINER_NONCE_MISMATCH/
  );

  // 4.4 Non-hex or malformed container ID
  const invalidId = {
    id: 'not-a-valid-hex-id!',
    name: 'supabase_db_disposable_stack_a1b2c3d4',
    image: 'supabase/postgres:17.2.0.1',
  };
  const res3 = verifyCandidateContainerMetadata({
    containerId: invalidId.id,
    containerName: invalidId.name,
    image: invalidId.image,
    expectedProjectId,
  });
  assert.equal(res3.valid, false);
  assert.equal(res3.reason, 'INVALID_HEX_ID');
});

test('resolve-disposable-container: cenário 5 - nenhum container correspondente', () => {
  const expectedProjectId = 'disposable_stack_a1b2c3d4';
  const emptyCandidates = [];

  assert.throws(
    () => filterVerifiedContainers(emptyCandidates, expectedProjectId),
    /DISPOSABLE_CONTAINER_RESOLUTION_FAILED.*found 0/
  );
});
