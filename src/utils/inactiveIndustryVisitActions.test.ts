import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateOperationalVisits, type DayOfWeekDate } from './routePlanner';
import { getScheduledVisitAction } from './scheduledVisitActions';
import type { RouteItem, Visit } from '../types';

const day: DayOfWeekDate = {
  dateStr: '2026-11-09', dayKey: 'segunda', dayLabel: 'Segunda', dayShort: 'Seg',
  isToday: true, isPast: false, isFuture: false
};

const route: RouteItem = {
  id: 'route-1', codigo_rota: 'R-1', industria_codigo: 'I-1', loja_codigo: 'L-1',
  promotor_matricula: 'P-1', uf: 'DF', frequencia: 'SEMANAL',
  segunda: true, terca: false, quarta: false, quinta: false, sexta: false, sabado: false, domingo: false,
  industria: { codigo: 'I-1', nome: 'Indústria teste', status: 'inativo' },
  loja: { codigo: 'L-1', nome: 'Loja teste' }
};

const visit: Visit = {
  id: 'visit-1', rota_id: 'route-1', promotor_matricula: 'P-1', loja_codigo: 'L-1',
  industria_codigo: 'I-1', data_visita: day.dateStr, status: 'nao_realizada',
  industria: { codigo: 'I-1', nome: 'Indústria teste', status: 'inativo' }
};

test('status inativo da relação da rota é propagado e bloqueia início/recuperação', () => {
  const [item] = calculateOperationalVisits({ routes: [route], visits: [], daysRange: [day], todayStr: day.dateStr });
  assert.equal(item.industriaStatus, 'inativo');
  const decision = getScheduledVisitAction({
    item, today: '2026-11-10', weekStart: '2026-11-09', weekEnd: '2026-11-15', authorized: true, hasActiveVisit: false
  });
  assert.equal(decision.allowed, false);
  assert.match(decision.reason || '', /indústria vinculada está inativa/i);
});

test('indústria ativa mantém a recuperação semanal permitida', () => {
  const [item] = calculateOperationalVisits({
    routes: [{ ...route, industria: { ...route.industria!, status: 'ativo' } }],
    visits: [{ ...visit, status: 'nao_realizada', industria: { ...visit.industria!, status: 'ativo' } }], daysRange: [day], todayStr: '2026-11-10'
  });
  assert.equal(item.industriaStatus, 'ativo');
  const decision = getScheduledVisitAction({
    item, today: '2026-11-10', weekStart: '2026-11-09', weekEnd: '2026-11-15', authorized: true, hasActiveVisit: false
  });
  assert.deepEqual(decision, { allowed: true, action: 'recover' });
});

test('status inativo registrado na visita é propagado mesmo quando a consulta da rota vem ativa', () => {
  const [item] = calculateOperationalVisits({
    routes: [{ ...route, industria: { ...route.industria!, status: 'ativo' } }],
    visits: [visit], daysRange: [day], todayStr: day.dateStr
  });
  assert.equal(item.industriaStatus, 'inativo');
  assert.equal(item.status, 'nao_realizada');
  const decision = getScheduledVisitAction({
    item, today: '2026-11-10', weekStart: '2026-11-09', weekEnd: '2026-11-15', authorized: true, hasActiveVisit: false
  });
  assert.equal(decision.allowed, false);
});

test('visita concluída de indústria inativa continua disponível no histórico sem virar ação executável', () => {
  const completed = { ...visit, status: 'concluida' as const, completed_at: '2026-11-09T15:00:00Z' };
  const [item] = calculateOperationalVisits({ routes: [route], visits: [completed], daysRange: [day], todayStr: day.dateStr });
  assert.equal(item.status, 'concluida');
  assert.equal(item.industriaStatus, 'inativo');
});
