import assert from 'node:assert/strict';
import test from 'node:test';
import { regularizationErrorMessage, submitVisitRegularization, validateRegularizationReason } from './visitRegularizationService';

test('não chama RPC até o backend ser implantado e verificado', async () => {
  let calls = 0;
  await assert.rejects(() => submitVisitRegularization(async () => {
    calls += 1;
    return { data: null, error: null };
  }, 'visit-1', 'closed_without_execution_proof', 'Motivo válido', false), /aguarda a validação/);
  assert.equal(calls, 0);
});

test('ação administrativa envia matrícula apenas pelo contexto RPC e motivo obrigatório', async () => {
  let request: { name: string; args: Record<string, unknown> } | undefined;
  const data = await submitVisitRegularization(async (name, args) => {
    request = { name, args };
    return { data: { visit_id: 'visit-1' }, error: null };
  }, 'visit-1', 'administratively_completed_with_proof', 'Evidência revisada', true);
  assert.deepEqual(request, {
    name: 'attendance_regularize_visit',
    args: {
      p_visit_id: 'visit-1',
      p_action: 'administratively_completed_with_proof',
      p_reason: 'Evidência revisada'
    }
  });
  assert.deepEqual(data, { visit_id: 'visit-1' });
});

test('recusa motivo vazio ou curto sem chamar o backend', async () => {
  let calls = 0;
  await assert.rejects(() => submitVisitRegularization(async () => {
    calls += 1;
    return { data: null, error: null };
  }, 'visit-1', 'closed_without_execution_proof', '   ', true), /motivo/);
  assert.equal(calls, 0);
});

test('recusa justificativas genéricas e aceita descrição concreta', () => {
  assert.throws(() => validateRegularizationReason('ok'), /genérica/);
  assert.throws(() => validateRegularizationReason('   teste   '), /genérica/);
  assert.equal(validateRegularizationReason('Documentos e fotos conferidos'), 'Documentos e fotos conferidos');
});

test('propaga falha do RPC sem alegar que a regularização foi gravada', async () => {
  await assert.rejects(() => submitVisitRegularization(async () => ({
    data: null,
    error: { message: 'Insufficient existing evidence for administrative completion' }
  }), 'visit-1', 'administratively_completed_with_proof', 'Revisão com evidências', true), /evidências suficientes/);
});

test('traduz indisponibilidade da RPC e não expõe erro técnico do banco', () => {
  assert.match(regularizationErrorMessage('PGRST202 could not find the function'), /backend validado/);
  assert.equal(regularizationErrorMessage('permission denied for table visits'), 'Não foi possível regularizar a visita. Atualize a lista ou procure um administrador.');
});
