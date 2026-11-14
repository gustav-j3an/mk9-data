import assert from 'node:assert/strict';
import test from 'node:test';
import { submitVisitCancellation, validateVisitCancellationReason } from './visitCancellationService';

test('justificativa de cancelamento é normalizada e obrigatória', () => {
  assert.equal(validateVisitCancellationReason('  Loja   fechada para manutenção  '), 'Loja fechada para manutenção');
  assert.throws(() => validateVisitCancellationReason('teste'), /justificativa específica/i);
  assert.throws(() => validateVisitCancellationReason('x'.repeat(1001)), /justificativa específica/i);
});

test('cancelamento envia a RPC autorizada com id e justificativa validada', async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const result = await submitVisitCancellation(async (name, args) => {
    calls.push({ name, args });
    return { data: { status: 'nao_realizada' }, error: null };
  }, 'visit-1', 'Loja fechada para manutenção');

  assert.deepEqual(result, { status: 'nao_realizada' });
  assert.deepEqual(calls, [{ name: 'attendance_cancel_visit', args: {
    p_visit_id: 'visit-1',
    p_reason: 'Loja fechada para manutenção'
  } }]);
});

test('cancelamento não chama backend para id ou justificativa inválida', async () => {
  let called = false;
  const rpc = async () => { called = true; return { data: null, error: null }; };
  await assert.rejects(submitVisitCancellation(rpc, '', 'Loja fechada para manutenção'), /Visita inválida/);
  await assert.rejects(submitVisitCancellation(rpc, 'visit-1', 'sem motivo'), /justificativa específica/i);
  assert.equal(called, false);
});

test('falha de autorização não é tratada como sucesso', async () => {
  await assert.rejects(submitVisitCancellation(async () => ({ data: null, error: { message: 'Visit not authorised' } }), 'visit-1', 'Loja fechada para manutenção'), /não pertence ao seu usuário/i);
});
