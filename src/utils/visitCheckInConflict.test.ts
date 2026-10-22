import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canReviewOldOpenVisits,
  createRequestGate,
  findOwnOpenVisit,
  formatOpenVisitConflictMessage,
  getOldOpenVisitCheckInBlockMessage,
  getOldOpenVisitsLabel,
  getPromoterOpenVisitAction,
  isAnotherVisitInProgressError,
  isOpenVisitFromToday
} from './visitCheckInConflict';

const today = '2026-10-22';
const now = new Date('2026-10-22T15:00:00.000Z'); // noon in America/Sao_Paulo
const openVisit = {
  id: 'own', promotor_matricula: 'P-1', loja_codigo: 'L-1', loja: { nome: 'Loja Central' },
  industria_codigo: 'I-1', industria: { nome: 'Indústria A' }, data_visita: today,
  started_at: '2026-10-22T12:30:00.000Z', status: 'em_andamento'
};

test('check-in sem visita aberta não gera conflito', () => {
  assert.equal(findOwnOpenVisit([], 'P-1'), undefined);
  assert.equal(isAnotherVisitInProgressError({ message: 'Store outside promoter assignment' }), false);
});

test('check-in com visita aberta hoje oferece continuar visita', () => {
  const message = formatOpenVisitConflictMessage(openVisit, now);
  assert.match(message, /outro atendimento ativo/);
  assert.equal(getPromoterOpenVisitAction(openVisit, now), 'continue_today');
});

test('check-in com visita antiga orienta regularização autorizada', () => {
  const message = formatOpenVisitConflictMessage({ ...openVisit, data_visita: '2026-10-20', started_at: '2026-10-20T12:30:00.000Z' }, now);
  assert.equal(getPromoterOpenVisitAction({ ...openVisit, data_visita: '2026-10-20', started_at: '2026-10-20T12:30:00.000Z' }, now), 'administrative_regularization');
  assert.match(message, /regularização administrativa/);
  assert.doesNotMatch(message, /Another visit is in progress/);
});

test('converte a mensagem da RPC para uma explicação em português e não inclui detalhes internos', () => {
  assert.equal(isAnotherVisitInProgressError({ message: 'Another visit is in progress' }), true);
  const message = formatOpenVisitConflictMessage(undefined, now);
  assert.match(message, /Não foi possível iniciar a visita/);
  assert.match(getOldOpenVisitCheckInBlockMessage(), /bloqueados pelo servidor/);
  assert.doesNotMatch(message, /database|constraint|SQL/i);
});

test('isola visitas abertas pela matrícula autenticada', () => {
  assert.equal(findOwnOpenVisit([
    { ...openVisit, promotor_matricula: 'P-2' },
    { ...openVisit, status: 'concluida' },
    openVisit
  ], 'P-1')?.id, 'own');
  assert.equal(findOwnOpenVisit([{ ...openVisit, promotor_matricula: 'P-2' }], 'P-1'), undefined);
});

test('bloqueia novas tentativas enquanto o check-in anterior está em andamento', () => {
  const gate = createRequestGate();
  assert.equal(gate.tryAcquire(), true);
  assert.equal(gate.tryAcquire(), false);
  gate.release();
  assert.equal(gate.tryAcquire(), true);
});

test('visita aberta de hoje permanece elegível para o fluxo existente de continuar', () => {
  const found = findOwnOpenVisit([openVisit], 'P-1');
  assert.ok(found);
  assert.equal(found.data_visita, today);
  assert.equal(found.status, 'em_andamento');
  assert.equal(isOpenVisitFromToday(found, now), true);
  assert.equal(isOpenVisitFromToday({ ...found, data_visita: '2026-10-20', started_at: '2026-10-20T12:30:00.000Z' }, now), false);
});

test('múltiplas visitas antigas aparecem como uma contagem compacta, sem listar os registros', () => {
  assert.equal(getOldOpenVisitsLabel(4), '4 visitas antigas aguardando regularização administrativa.');
});

test('acesso à revisão administrativa permanece restrito a admin e gestor', () => {
  assert.equal(canReviewOldOpenVisits('admin'), true);
  assert.equal(canReviewOldOpenVisits('gestor'), true);
  assert.equal(canReviewOldOpenVisits('promotor'), false);
});

test('promotor não recebe ação de regularização para visita antiga', () => {
  assert.equal(getPromoterOpenVisitAction({ ...openVisit, data_visita: '2026-10-20', started_at: '2026-10-20T12:30:00.000Z' }, now), 'administrative_regularization');
});

test('regularized visits are excluded from active and promoter-open queries', () => {
  const visit = { ...openVisit, regularization_status: 'closed_without_execution_proof' };
  assert.equal(isOpenVisitFromToday(visit, now), false);
  assert.equal(findOwnOpenVisit([visit], 'P-1'), undefined);
  assert.equal(getPromoterOpenVisitAction(visit, now), 'administrative_regularization');
});

test('operationally completed visits are not considered open', () => {
  assert.equal(isOpenVisitFromToday({ ...openVisit, status: 'concluida' }, now), false);
});

test('overnight shifts retain their operational date across midnight', () => {
  const visit = {
    ...openVisit,
    data_visita: '2026-10-22',
    started_at: '2026-10-23T03:30:00.000Z',
    work_schedule: { timezone: 'America/Sao_Paulo', hora_inicio: '22:00:00', hora_fim: '06:00:00' }
  };
  assert.equal(isOpenVisitFromToday(visit, '2026-10-23T04:00:00.000Z'), true);
  assert.equal(isOpenVisitFromToday({ ...visit, data_visita: '2026-10-21' }, '2026-10-23T04:00:00.000Z'), false);
});

test('regularized visits stay inactive before, during and after midnight', () => {
  const visit = {
    ...openVisit,
    data_visita: '2026-10-22',
    work_schedule: { timezone: 'America/Sao_Paulo', hora_inicio: '22:00:00', hora_fim: '06:00:00' },
    regularization_status: 'administratively_completed_with_proof'
  };
  assert.equal(isOpenVisitFromToday(visit, '2026-10-23T01:00:00.000Z'), false);
  assert.equal(isOpenVisitFromToday(visit, '2026-10-23T04:00:00.000Z'), false);
  assert.equal(isOpenVisitFromToday(visit, '2026-10-23T10:00:00.000Z'), false);
});

test('operational date uses the captured schedule timezone', () => {
  const newYorkVisit = {
    ...openVisit,
    data_visita: '2026-10-22',
    work_schedule: { timezone: 'America/New_York', hora_inicio: '22:00:00', hora_fim: '06:00:00' }
  };
  const aucklandVisit = {
    ...openVisit,
    data_visita: '2026-10-22',
    work_schedule: { timezone: 'Pacific/Auckland', hora_inicio: '22:00:00', hora_fim: '06:00:00' }
  };
  assert.equal(isOpenVisitFromToday(newYorkVisit, '2026-10-23T03:30:00.000Z'), true);
  assert.equal(isOpenVisitFromToday(aucklandVisit, '2026-10-22T12:00:00.000Z'), true);
});

test('missing or invalid schedule timezone uses the Sao Paulo fallback', () => {
  assert.equal(isOpenVisitFromToday(openVisit, now), true);
  assert.equal(isOpenVisitFromToday({ ...openVisit, work_schedule: { timezone: 'invalid/zone' } }, now), true);
});