import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getScheduledVisitRpcErrorMessage } from './scheduledVisitRpcError';

test('traduz erro de execução já existente sem expor texto SQL em inglês', () => {
  assert.match(getScheduledVisitRpcErrorMessage({ code: '23505', message: 'This scheduled occurrence already has an execution' }), /ocorrência já possui um atendimento/i);
});

test('traduz bloqueios de retry e atendimento em andamento', () => {
  assert.match(getScheduledVisitRpcErrorMessage({ message: 'Only a cancelled or automatically closed attempt can be retried' }), /não está elegível/i);
  assert.match(getScheduledVisitRpcErrorMessage({ message: 'Another visit is in progress' }), /Finalize o atendimento atual/i);
});

test('usa mensagem neutra para erro RPC desconhecido', () => {
  assert.equal(getScheduledVisitRpcErrorMessage({ code: 'XX000', message: 'private database detail' }), 'Não foi possível confirmar a programação no servidor. Atualize a agenda e tente novamente.');
});
