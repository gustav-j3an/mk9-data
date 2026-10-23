import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getScheduledVisitAction } from './scheduledVisitActions';
import type { OperationalVisitItem } from './routePlanner';

const base = {
  routeId: 'route-1', dataStr: '2026-10-23', status: 'planejada', frequencia: 'SEMANAL', visitObj: null
} as Pick<OperationalVisitItem, 'routeId' | 'dataStr' | 'status' | 'frequencia' | 'visitObj'>;
const common = { today: '2026-10-22', weekStart: '2026-10-19', weekEnd: '2026-10-25', authorized: true, hasActiveVisit: false };

test('programação virtual semanal sem linha em visits pode ser antecipada', () => {
  assert.deepEqual(getScheduledVisitAction({ item: base, ...common }), { allowed: true, action: 'advance' });
});

test('recuperação aceita programação não realizada somente dentro da semana atual', () => {
  const item = { ...base, dataStr: '2026-10-21', status: 'pendente' } as typeof base;
  assert.equal(getScheduledVisitAction({ item, ...common }).action, 'recover');
  assert.equal(getScheduledVisitAction({ item: { ...item, dataStr: '2026-10-18' }, ...common }).allowed, false);
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
});

test('duplicidade é evitada por ocorrência única e nunca abre uma segunda ação para concluída', () => {
  const completed = { ...base, visitObj: { status: 'concluida', started_at: '2026-10-22T10:00:00Z' } } as typeof base;
  assert.match(getScheduledVisitAction({ item: completed, ...common }).reason || '', /iniciado ou concluído/);
});
