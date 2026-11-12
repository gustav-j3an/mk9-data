import assert from 'node:assert/strict';
import test from 'node:test';
import { getVisitStartErrorMessage } from './visitStartError';

test('explica o bloqueio de check-in em indústria inativa sem rotulá-lo como falha de matrícula', () => {
  assert.equal(
    getVisitStartErrorMessage({ code: '42501', message: 'Industry is not active or does not exist' }),
    'Esta indústria está inativa ou não foi encontrada. O check-in foi bloqueado.'
  );
});

test('mantém mensagens genéricas para outros erros de autorização e detalhes internos', () => {
  assert.equal(
    getVisitStartErrorMessage({ code: '42501', message: 'Promoter not released for operation' }),
    'Acesso não autorizado pelas regras do sistema para esta matrícula.'
  );
  assert.equal(
    getVisitStartErrorMessage({ code: 'XX000', message: 'internal error with secret details' }),
    'Não foi possível iniciar o atendimento. Tente novamente ou solicite apoio ao suporte.'
  );
});
