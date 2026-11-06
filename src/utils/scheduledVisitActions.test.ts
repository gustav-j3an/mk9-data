import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getScheduledRouteEligibility, getScheduledVisitAction, isRouteVisibleInOperationalHistory, isScheduledVisitActionRpcReady } from './scheduledVisitActions';
import type { OperationalVisitItem } from './routePlanner';

const base = {
  routeId: 'route-1', dataStr: '2026-10-23', status: 'planejada', frequencia: 'SEMANAL', visitObj: null
} as Pick<OperationalVisitItem, 'routeId' | 'dataStr' | 'status' | 'frequencia' | 'visitObj'>;
const common = { today: '2026-10-22', weekStart: '2026-10-19', weekEnd: '2026-10-25', authorized: true, hasActiveVisit: false, routeEligibility: 'active' as const };

test('elegibilidade da rota exige vínculo confirmado com indústria ativa e rota aberta', () => {
  assert.equal(getScheduledRouteEligibility(undefined), 'unavailable');
  assert.equal(getScheduledRouteEligibility({ encerrada_em: null, industria: null }), 'unavailable');
  assert.equal(getScheduledRouteEligibility({ encerrada_em: null, industria: { codigo: 'I-1', nome: 'Teste', status: 'inativo' } }), 'unavailable');
  assert.equal(getScheduledRouteEligibility({ encerrada_em: '2026-11-04T12:00:00Z', industria: { codigo: 'I-1', nome: 'Teste', status: 'ativo' } }), 'closed');
  assert.equal(getScheduledRouteEligibility({ encerrada_em: null, industria: { codigo: 'I-1', nome: 'Teste', status: 'ativo' } }), 'active');
});

test('rotas encerradas continuam disponíveis no histórico dentro da janela carregada', () => {
  assert.equal(isRouteVisibleInOperationalHistory({ encerrada_em: '2026-11-03T12:00:00Z' }, '2026-08-08'), true);
  assert.equal(isRouteVisibleInOperationalHistory({ encerrada_em: '2026-08-07T12:00:00Z' }, '2026-08-08'), false);
  assert.equal(isRouteVisibleInOperationalHistory({ encerrada_em: null }, '2026-08-08'), true);
});

test('programação virtual semanal sem linha em visits pode ser antecipada', () => {
  assert.deepEqual(getScheduledVisitAction({ item: base, ...common }), { allowed: true, action: 'advance' });
});

test('recuperação aceita programação não realizada somente dentro da semana atual', () => {
  const item = { ...base, dataStr: '2026-10-21', status: 'nao_realizada' } as typeof base;
  assert.equal(getScheduledVisitAction({ item, ...common }).action, 'recover');
  assert.equal(getScheduledVisitAction({ item: { ...item, dataStr: '2026-10-18' }, ...common }).allowed, false);
});

test('visita de 04/11 pode ser recuperada em 06/11 dentro da mesma semana', () => {
  const item = { ...base, dataStr: '2026-11-04', status: 'nao_realizada' } as typeof base;
  assert.deepEqual(getScheduledVisitAction({
    item,
    today: '2026-11-06',
    weekStart: '2026-11-02',
    weekEnd: '2026-11-08',
    authorized: true,
    hasActiveVisit: false,
    routeEligibility: 'active'
  }), { allowed: true, action: 'recover' });
});

test('visita de 04/11 deixa de ser recuperável depois do fim da semana em 08/11', () => {
  const item = { ...base, dataStr: '2026-11-04', status: 'nao_realizada' } as typeof base;
  assert.equal(getScheduledVisitAction({
    item,
    today: '2026-11-09',
    weekStart: '2026-11-09',
    weekEnd: '2026-11-15',
    authorized: true,
    hasActiveVisit: false,
    routeEligibility: 'active'
  }).allowed, false);
});

test('rota atualmente encerrada bloqueia recuperação independentemente da data de encerramento', () => {
  const plannedDate = '2026-11-04';
  const closedDates = ['2026-11-03', plannedDate, '2026-11-05'];
  closedDates.forEach((routeEndedAt) => {
    const item = { ...base, dataStr: plannedDate, status: 'nao_realizada' } as typeof base;
    const result = getScheduledVisitAction({ ...common, item, routeEligibility: getScheduledRouteEligibility({ encerrada_em: routeEndedAt, industria: { codigo: 'I-1', nome: 'Teste', status: 'ativo' } }) });
    assert.equal(result.allowed, false);
    assert.match(result.reason || '', /rota foi encerrada/);
  });
});

test('dia futuro não vira não realizado e semana futura não pode ser antecipada', () => {
  const item = { ...base, dataStr: '2026-10-26' } as typeof base;
  assert.equal(getScheduledVisitAction({ item, ...common }).allowed, false);
  assert.equal(getScheduledVisitAction({ item: { ...item, dataStr: '2026-10-25', status: 'planejada' }, ...common }).action, 'advance');
});

test('concluída, em andamento, escala quinzenal, operação sem permissão e conflito bloqueiam ação', () => {
  const denied = [
    { item: { ...base, status: 'concluida' } as typeof base, ...common },
    { item: { ...base, visitObj: { status: 'em_andamento', started_at: '2026-10-22T10:00:00Z' } } as typeof base, ...common },
    { item: { ...base, frequencia: 'QUINZENAL' } as typeof base, ...common },
    { item: base, ...common, authorized: false },
    { item: base, ...common, hasActiveVisit: true }
  ];
  denied.forEach(input => assert.equal(getScheduledVisitAction(input).allowed, false));
  assert.equal(getScheduledVisitAction({ item: base, ...common, routeEligibility: 'unavailable' }).allowed, false);
});

test('duplicidade é evitada por ocorrência única e nunca abre uma segunda ação para concluída', () => {
  const completed = { ...base, visitObj: { status: 'concluida', started_at: '2026-10-22T10:00:00Z' } } as typeof base;
  assert.match(getScheduledVisitAction({ item: completed, ...common }).reason || '', /iniciado ou concluído/);
});

test('ações de agenda só são habilitadas quando a RPC responde com a validação esperada', () => {
  assert.equal(isScheduledVisitActionRpcReady({ code: '22023', message: 'Invalid scheduled visit action' }), true);
  assert.equal(isScheduledVisitActionRpcReady({ code: 'PGRST202', message: 'Function not found' }), false);
  assert.equal(isScheduledVisitActionRpcReady({ code: '42501', message: 'Promoter identity required' }), false);
  assert.equal(isScheduledVisitActionRpcReady({ code: '08006', message: 'Network error' }), false);
  assert.equal(isScheduledVisitActionRpcReady(null), false);
});
