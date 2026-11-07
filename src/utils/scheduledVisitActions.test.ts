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

// Casos de teste específicos da Missão 37.44 - Prevenção de duplicidade no mesmo dia
test('cenário 1: visita pendente sem conflito hoje pode ser recuperada', () => {
  const pendingItem = {
    ...base,
    dataStr: '2026-11-04',
    status: 'pendente',
    lojaCodigo: 'L-101',
    industriaCodigo: 'IND-01'
  } as typeof base;

  const result = getScheduledVisitAction({
    item: pendingItem,
    today: '2026-11-07',
    weekStart: '2026-11-02',
    weekEnd: '2026-11-08',
    authorized: true,
    hasActiveVisit: false,
    routeEligibility: 'active',
    todayVisits: []
  });

  assert.equal(result.allowed, true);
  assert.equal(result.action, 'recover');
  assert.equal(result.isSameDayConflict, undefined);
});

test('cenário 2: mesma ocorrência (mesma scheduled_date) já atendida hoje bloqueia recuperação duplicada', () => {
  const pendingItem = {
    ...base,
    dataStr: '2026-11-04',
    status: 'pendente',
    lojaCodigo: 'L-101',
    industriaCodigo: 'IND-01'
  } as typeof base;

  const result = getScheduledVisitAction({
    item: pendingItem,
    today: '2026-11-07',
    weekStart: '2026-11-02',
    weekEnd: '2026-11-08',
    authorized: true,
    hasActiveVisit: false,
    routeEligibility: 'active',
    todayVisits: [
      { loja_codigo: 'L-101', industria_codigo: 'IND-01', status: 'concluida', scheduled_date: '2026-11-04' } as any
    ]
  });

  assert.equal(result.allowed, false);
  assert.equal(result.action, 'recover');
  assert.equal(result.isSameDayConflict, true);
  assert.equal(result.reason, 'Esta ocorrência programada já foi atendida hoje.');
});

test('cenário 3: mesma ocorrência em andamento hoje bloqueia nova recuperação simultânea', () => {
  const pendingItem = {
    ...base,
    dataStr: '2026-11-04',
    status: 'pendente',
    lojaCodigo: 'L-101',
    industriaCodigo: 'IND-01'
  } as typeof base;

  const result = getScheduledVisitAction({
    item: pendingItem,
    today: '2026-11-07',
    weekStart: '2026-11-02',
    weekEnd: '2026-11-08',
    authorized: true,
    hasActiveVisit: false,
    routeEligibility: 'active',
    todayVisits: [
      { loja_codigo: 'L-101', industria_codigo: 'IND-01', status: 'em_andamento', scheduled_date: '2026-11-04' } as any
    ]
  });

  assert.equal(result.allowed, false);
  assert.equal(result.action, 'recover');
  assert.equal(result.isSameDayConflict, true);
  assert.equal(result.reason, 'Esta ocorrência programada já foi atendida hoje.');
});

test('cenário 4: visita hoje para outra indústria na mesma loja NÃO causa conflito', () => {
  const pendingItem = {
    ...base,
    dataStr: '2026-11-04',
    status: 'pendente',
    lojaCodigo: 'L-101',
    industriaCodigo: 'IND-01'
  } as typeof base;

  const result = getScheduledVisitAction({
    item: pendingItem,
    today: '2026-11-07',
    weekStart: '2026-11-02',
    weekEnd: '2026-11-08',
    authorized: true,
    hasActiveVisit: false,
    routeEligibility: 'active',
    todayVisits: [
      { loja_codigo: 'L-101', industria_codigo: 'IND-OUTRA', status: 'concluida' } as any
    ]
  });

  assert.equal(result.allowed, true);
  assert.equal(result.action, 'recover');
  assert.equal(result.isSameDayConflict, undefined);
});

test('cenário 5: visita hoje para a mesma indústria em outra loja NÃO causa conflito', () => {
  const pendingItem = {
    ...base,
    dataStr: '2026-11-04',
    status: 'pendente',
    lojaCodigo: 'L-101',
    industriaCodigo: 'IND-01'
  } as typeof base;

  const result = getScheduledVisitAction({
    item: pendingItem,
    today: '2026-11-07',
    weekStart: '2026-11-02',
    weekEnd: '2026-11-08',
    authorized: true,
    hasActiveVisit: false,
    routeEligibility: 'active',
    todayVisits: [
      { loja_codigo: 'L-OUTRA', industria_codigo: 'IND-01', status: 'concluida' } as any
    ]
  });

  assert.equal(result.allowed, true);
  assert.equal(result.action, 'recover');
  assert.equal(result.isSameDayConflict, undefined);
});

test('cenário 6: recuperação fora da semana permitida permanece bloqueada independentemente de visitas do dia', () => {
  const oldPendingItem = {
    ...base,
    dataStr: '2026-10-28', // semana anterior
    status: 'pendente',
    lojaCodigo: 'L-101',
    industriaCodigo: 'IND-01'
  } as typeof base;

  const result = getScheduledVisitAction({
    item: oldPendingItem,
    today: '2026-11-07',
    weekStart: '2026-11-02',
    weekEnd: '2026-11-08',
    authorized: true,
    hasActiveVisit: false,
    routeEligibility: 'active',
    todayVisits: []
  });

  assert.equal(result.allowed, false);
  assert.equal(result.isSameDayConflict, undefined);
  assert.match(result.reason || '', /janela válida da semana atual/);
});

test('cenário 7: tentativa concorrente com atendimento ativo no promotor é bloqueada', () => {
  const pendingItem = {
    ...base,
    dataStr: '2026-11-04',
    status: 'pendente',
    lojaCodigo: 'L-101',
    industriaCodigo: 'IND-01'
  } as typeof base;

  const result = getScheduledVisitAction({
    item: pendingItem,
    today: '2026-11-07',
    weekStart: '2026-11-02',
    weekEnd: '2026-11-08',
    authorized: true,
    hasActiveVisit: true, // atendimento em curso em qualquer loja
    routeEligibility: 'active',
    todayVisits: []
  });

  assert.equal(result.allowed, false);
  assert.match(result.reason || '', /Finalize o atendimento atual/);
});

// Casos específicos da Missão 37.52 - Recuperação integral de múltiplas ocorrências na semana
test('cenário 37.52-1: segunda-feira (02/11) pode ser recuperada no sábado (07/11)', () => {
  const itemSegunda = {
    ...base,
    dataStr: '2026-11-02',
    status: 'nao_realizada',
    lojaCodigo: 'L-101',
    industriaCodigo: 'IND-01'
  } as typeof base;

  const result = getScheduledVisitAction({
    item: itemSegunda,
    today: '2026-11-07',
    weekStart: '2026-11-02',
    weekEnd: '2026-11-08',
    authorized: true,
    hasActiveVisit: false,
    routeEligibility: 'active',
    todayVisits: []
  });

  assert.equal(result.allowed, true);
  assert.equal(result.action, 'recover');
});

test('cenário 37.52-2: quarta-feira (04/11) pode ser recuperada no sábado (07/11)', () => {
  const itemQuarta = {
    ...base,
    dataStr: '2026-11-04',
    status: 'nao_realizada',
    lojaCodigo: 'L-101',
    industriaCodigo: 'IND-01'
  } as typeof base;

  const result = getScheduledVisitAction({
    item: itemQuarta,
    today: '2026-11-07',
    weekStart: '2026-11-02',
    weekEnd: '2026-11-08',
    authorized: true,
    hasActiveVisit: false,
    routeEligibility: 'active',
    todayVisits: []
  });

  assert.equal(result.allowed, true);
  assert.equal(result.action, 'recover');
});

test('cenário 37.52-3: quinta-feira (05/11) pode ser recuperada no sábado (07/11)', () => {
  const itemQuinta = {
    ...base,
    dataStr: '2026-11-05',
    status: 'nao_realizada',
    lojaCodigo: 'L-101',
    industriaCodigo: 'IND-01'
  } as typeof base;

  const result = getScheduledVisitAction({
    item: itemQuinta,
    today: '2026-11-07',
    weekStart: '2026-11-02',
    weekEnd: '2026-11-08',
    authorized: true,
    hasActiveVisit: false,
    routeEligibility: 'active',
    todayVisits: []
  });

  assert.equal(result.allowed, true);
  assert.equal(result.action, 'recover');
});

test('cenário 37.52-4: recuperar três ocorrências da mesma loja e indústria no sábado separadamente', () => {
  // Simulando que a segunda (02/11) já foi recuperada e concluída hoje no sábado
  const visitsConcluidasHoje = [
    { loja_codigo: 'L-101', industria_codigo: 'IND-01', status: 'concluida', scheduled_date: '2026-11-02' } as any
  ];

  // A quarta (04/11) NÃO deve ser bloqueada pela segunda ter sido feita hoje
  const itemQuarta = {
    ...base,
    dataStr: '2026-11-04',
    status: 'nao_realizada',
    lojaCodigo: 'L-101',
    industriaCodigo: 'IND-01'
  } as typeof base;

  const resultQuarta = getScheduledVisitAction({
    item: itemQuarta,
    today: '2026-11-07',
    weekStart: '2026-11-02',
    weekEnd: '2026-11-08',
    authorized: true,
    hasActiveVisit: false,
    routeEligibility: 'active',
    todayVisits: visitsConcluidasHoje
  });

  assert.equal(resultQuarta.allowed, true);
  assert.equal(resultQuarta.action, 'recover');

  // A quinta (05/11) também permanece habilitada para recuperação
  const itemQuinta = {
    ...base,
    dataStr: '2026-11-05',
    status: 'nao_realizada',
    lojaCodigo: 'L-101',
    industriaCodigo: 'IND-01'
  } as typeof base;

  const resultQuinta = getScheduledVisitAction({
    item: itemQuinta,
    today: '2026-11-07',
    weekStart: '2026-11-02',
    weekEnd: '2026-11-08',
    authorized: true,
    hasActiveVisit: false,
    routeEligibility: 'active',
    todayVisits: visitsConcluidasHoje
  });

  assert.equal(resultQuinta.allowed, true);
  assert.equal(resultQuinta.action, 'recover');
});

test('cenário 37.52-5: bloquear execução duplicada da mesma ocorrência já recuperada hoje', () => {
  const visitsConcluidasHoje = [
    { loja_codigo: 'L-101', industria_codigo: 'IND-01', status: 'concluida', scheduled_date: '2026-11-02' } as any
  ];

  const itemSegundaRepetida = {
    ...base,
    dataStr: '2026-11-02',
    status: 'pendente',
    lojaCodigo: 'L-101',
    industriaCodigo: 'IND-01'
  } as typeof base;

  const result = getScheduledVisitAction({
    item: itemSegundaRepetida,
    today: '2026-11-07',
    weekStart: '2026-11-02',
    weekEnd: '2026-11-08',
    authorized: true,
    hasActiveVisit: false,
    routeEligibility: 'active',
    todayVisits: visitsConcluidasHoje
  });

  assert.equal(result.allowed, false);
  assert.equal(result.isSameDayConflict, true);
  assert.equal(result.reason, 'Esta ocorrência programada já foi atendida hoje.');
});
