import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isAuthorizedPostgresImage,
  inspectCandidateContainerDiagnostics,
  verifyCandidateContainerMetadata,
  filterVerifiedContainers,
  verifyDatabaseNonceMatch,
} from './resolve-disposable-container.mjs';

test('resolve-disposable-container: validação de imagens oficiais e não autorizadas', () => {
  // Imagem oficial Docker Hub
  assert.equal(isAuthorizedPostgresImage('supabase/postgres:17.2.0.1'), true);
  assert.equal(isAuthorizedPostgresImage('supabase/postgres:15.8.1.085'), true);

  // Imagem oficial Amazon ECR Public
  assert.equal(isAuthorizedPostgresImage('public.ecr.aws/supabase/postgres:17.2.0.1'), true);
  assert.equal(isAuthorizedPostgresImage('public.ecr.aws/supabase/postgres:17.6.1.134'), true);

  // Imagens não autorizadas ou spoofed
  assert.equal(isAuthorizedPostgresImage('evil-registry.com/supabase/postgres:17.2.0.1'), false);
  assert.equal(isAuthorizedPostgresImage('attacker/postgres:17.2.0.1'), false);
  assert.equal(isAuthorizedPostgresImage('postgres:17-alpine'), false);
  assert.equal(isAuthorizedPostgresImage('supabase/gotrue:v2.158.0'), false);
  assert.equal(isAuthorizedPostgresImage(''), false);
  assert.equal(isAuthorizedPostgresImage(null), false);
  assert.equal(isAuthorizedPostgresImage(undefined), false);
});

test('resolve-disposable-container: cenário 1 - container correto identificado (Docker Hub e Amazon ECR)', () => {
  const expectedProjectId = 'disposable_stack_a1b2c3d4';

  // 1.1 Docker Hub
  const validDockerHub = {
    id: '77c8ec52dacd',
    name: '/supabase_db_disposable_stack_a1b2c3d4',
    image: 'supabase/postgres:17.2.0.1',
    labels: {
      'com.supabase.cli.project': 'disposable_stack_a1b2c3d4',
      'com.docker.compose.project': 'disposable_stack_a1b2c3d4',
    },
  };
  const checkHub = verifyCandidateContainerMetadata({
    containerId: validDockerHub.id,
    containerName: validDockerHub.name,
    image: validDockerHub.image,
    labels: validDockerHub.labels,
    expectedProjectId,
  });
  assert.equal(checkHub.valid, true);

  // 1.2 Amazon ECR Public (usado pelo Supabase CLI v3 em Linux)
  const validEcr = {
    id: '88d9fb63ebde',
    name: '/supabase_db_disposable_stack_a1b2c3d4',
    image: 'public.ecr.aws/supabase/postgres:17.2.0.1',
    labels: {
      'com.supabase.cli.project': 'disposable_stack_a1b2c3d4',
      'com.docker.compose.project': 'disposable_stack_a1b2c3d4',
    },
  };
  const checkEcr = verifyCandidateContainerMetadata({
    containerId: validEcr.id,
    containerName: validEcr.name,
    image: validEcr.image,
    labels: validEcr.labels,
    expectedProjectId,
  });
  assert.equal(checkEcr.valid, true);

  const selected = filterVerifiedContainers([validEcr], expectedProjectId);
  assert.equal(selected.id, '88d9fb63ebde');

  // Nonce check verification
  const execFn = (id, query, db) => {
    assert.equal(id, '88d9fb63ebde');
    assert.equal(db, 'postgres');
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

test('resolve-disposable-container: preserva tabela legado e permite apenas nonce sintético explícito', () => {
  const observedQueries = [];
  const execFn = (_id, query) => {
    observedQueries.push(query);
    return 'synthetic-nonce';
  };

  assert.equal(verifyDatabaseNonceMatch({
    containerId: 'aabbccddeeff', expectedNonce: 'synthetic-nonce', execFn,
  }), true);
  assert.equal(verifyDatabaseNonceMatch({
    containerId: 'aabbccddeeff', expectedNonce: 'synthetic-nonce',
    nonceTable: 'public.mk9_disposable_nonce', execFn,
  }), true);
  assert.deepEqual(observedQueries, [
    'SELECT token FROM mk9_backup_restore_nonce LIMIT 1;',
    'SELECT token FROM public.mk9_disposable_nonce LIMIT 1;',
  ]);
  assert.throws(() => verifyDatabaseNonceMatch({
    containerId: 'aabbccddeeff', expectedNonce: 'synthetic-nonce',
    nonceTable: 'public.untrusted_table; DROP TABLE visits', execFn,
  }), /NONCE_TABLE_NOT_ALLOWED/);
});

test('resolve-disposable-container: falha de nonce não expõe container ou valores do desafio', () => {
  const expectedNonce = 'private-challenge-value';
  assert.throws(() => verifyDatabaseNonceMatch({
    containerId: 'aabbccddeeff', expectedNonce,
    nonceTable: 'public.mk9_disposable_nonce',
    execFn: () => 'different-private-value',
  }), (error) => {
    assert.equal(error.message, 'CONTAINER_NONCE_MISMATCH');
    assert.equal(error.message.includes(expectedNonce), false);
    assert.equal(error.message.includes('different-private-value'), false);
    assert.equal(error.message.includes('aabbccddeeff'), false);
    return true;
  });
  assert.throws(() => verifyDatabaseNonceMatch({
    containerId: 'aabbccddeeff', expectedNonce,
    nonceTable: 'public.mk9_disposable_nonce',
    execFn: () => { throw new Error(expectedNonce); },
  }), (error) => error.message === 'CONTAINER_NONCE_QUERY_FAILED' && !error.message.includes(expectedNonce));
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

test('resolve-disposable-container: diagnóstico estruturado emite códigos precisos sem vazar secrets', () => {
  const expectedProjectId = 'disposable_stack_secret_nonce_1234';
  const secretRawToken = 'secret_nonce_1234';
  const rawImage = 'public.ecr.aws/supabase/postgres:17.2.0.1';
  const rawId = '77c8ec52dacd';

  const mockCandidates = [
    // Candidato 1: ID inválido
    {
      id: 'not-hex!',
      name: `supabase_db_${expectedProjectId}`,
      image: rawImage,
      labels: { 'com.supabase.cli.project': expectedProjectId },
    },
    // Candidato 2: Nome divergente
    {
      id: '111122223333',
      name: 'supabase_db_other_unrelated_stack',
      image: rawImage,
      labels: { 'com.supabase.cli.project': expectedProjectId },
    },
    // Candidato 3: Imagem não confiável
    {
      id: '222233334444',
      name: `supabase_db_${expectedProjectId}`,
      image: 'evil-registry.com/untrusted/postgres:17',
      labels: { 'com.supabase.cli.project': expectedProjectId },
    },
    // Candidato 4: Label CLI divergente
    {
      id: '333344445555',
      name: `supabase_db_${expectedProjectId}`,
      image: rawImage,
      labels: { 'com.supabase.cli.project': 'conflicting_project_id' },
    },
    // Candidato 5: Label Compose divergente
    {
      id: '444455556666',
      name: `supabase_db_${expectedProjectId}`,
      image: rawImage,
      labels: {
        'com.supabase.cli.project': expectedProjectId,
        'com.docker.compose.project': 'conflicting_compose_project',
      },
    },
  ];

  const loggedMessages = [];
  const mockLogger = {
    error: (msg) => loggedMessages.push(msg),
  };

  assert.throws(
    () => filterVerifiedContainers(mockCandidates, expectedProjectId, mockLogger),
    /DISPOSABLE_CONTAINER_RESOLUTION_FAILED.*found 0/
  );

  // 1. Confirma que os diagnósticos estruturados foram emitidos
  assert.ok(loggedMessages.length >= 6);
  assert.ok(loggedMessages[0].includes('Total inspected: 5, Approved: 0'));

  // 2. Confirma os códigos de rejeição e booleanos de cada candidato
  assert.ok(loggedMessages[1].includes('reason=INVALID_HEX_ID'));
  assert.ok(loggedMessages[1].includes('hexValid=false'));

  assert.ok(loggedMessages[2].includes('reason=NAME_MISMATCH'));
  assert.ok(loggedMessages[2].includes('nameMatch=false'));

  assert.ok(loggedMessages[3].includes('reason=IMAGE_UNTRUSTED'));
  assert.ok(loggedMessages[3].includes('imageMatch=false'));

  assert.ok(loggedMessages[4].includes('reason=CLI_PROJECT_LABEL_MISMATCH'));
  assert.ok(loggedMessages[4].includes('labelsMatch=false'));

  assert.ok(loggedMessages[5].includes('reason=COMPOSE_PROJECT_LABEL_MISMATCH'));
  assert.ok(loggedMessages[5].includes('labelsMatch=false'));

  // 3. Confirma estritamente que nenhum dado bruto ou sensível foi vazado nos logs
  const allLogs = loggedMessages.join('\n');
  assert.ok(!allLogs.includes(secretRawToken), 'Token/nonce não deve constar nos logs');
  assert.ok(!allLogs.includes(expectedProjectId), 'expectedProjectId não deve constar nos logs diagnósticos');
  assert.ok(!allLogs.includes(rawImage), 'String da imagem não deve constar nos logs diagnósticos');
  assert.ok(!allLogs.includes(rawId), 'ID do container não deve constar nos logs diagnósticos');
  assert.ok(!allLogs.includes('conflicting_project_id'), 'Labels brutos não devem constar nos logs');
  assert.ok(!allLogs.includes('conflicting_compose_project'), 'Labels de compose não devem constar nos logs');
});

test('resolve-disposable-container: inspectCandidateContainerDiagnostics retorna valores precisos para candidato aprovado', () => {
  const projectId = 'mk9_valid_project_123';
  const approved = {
    containerId: 'aabbccddeeff',
    containerName: `/supabase_db_${projectId}`,
    image: 'public.ecr.aws/supabase/postgres:17.2.0.1',
    labels: { 'com.supabase.cli.project': projectId },
    expectedProjectId: projectId,
  };

  const diag = inspectCandidateContainerDiagnostics(approved);
  assert.equal(diag.valid, true);
  assert.equal(diag.reason, 'APPROVED');
  assert.equal(diag.isHexValid, true);
  assert.equal(diag.isNameMatch, true);
  assert.equal(diag.isImageMatch, true);
  assert.equal(diag.isLabelsMatch, true);
});
