import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateOperationalVisits } from './routePlanner';
import type { RouteItem, Visit } from '../types';
import { getCurrentWeekBounds, getDaysLate, getOperationalDateRange, selectPastVisitsFromAgenda } from './promoterPendingVisits';

const today = '2026-10-22';
const route: RouteItem = {
  id: 'route-1', promotor_matricula: 'FRANKLIN-01', loja_codigo: 'ASSAI-01', industria_codigo: 'KING',
  frequencia: 'SEMANAL', segunda: false, terca: false, quarta: true, quinta: false, sexta: false, sabado: false, domingo: false,
  loja: { codigo: 'ASSAI-01', nome: 'ASSAÍ — ASA NORTE' }, industria: { codigo: 'KING', nome: 'KING' }
} as RouteItem;
const day = { dateStr: '2026-10-21', dayKey: 'quarta' as const, dayLabel: 'Quarta', dayShort: 'Qua', isToday: false, isPast: true, isFuture: false };

test('semana operacional vai de segunda a domingo, inclusive, em 22/10/2026', () => {
  assert.deepEqual(getCurrentWeekBounds('2026-10-22'), { start: '2026-10-19', end: '2026-10-25' });
  assert.deepEqual(getCurrentWeekBounds('2026-10-19'), { start: '2026-10-19', end: '2026-10-25' });
  assert.deepEqual(getCurrentWeekBounds('2026-10-25'), { start: '2026-10-19', end: '2026-10-25' });
});

test('a segunda-feira seguinte exclui ocorrências da semana anterior da janela atual', () => {
  assert.deepEqual(getCurrentWeekBounds('2026-10-26'), { start: '2026-10-26', end: '2026-11-01' });
});

test('a janela histórica contém 90 dias completos e inclui hoje sem desvio UTC', () => {
  const range = getOperationalDateRange(today);
  assert.equal(range.length, 91);
  assert.equal(range[0].dateStr, '2026-07-24');
  assert.equal(range.at(-1)?.dateStr, today);
  assert.equal(range.find(item => item.dateStr === '2026-10-21')?.dayKey, 'quarta');
});

test('derive pending history from the agenda range without a second query', () => {
  const rows = [
    { id: 'past', data_visita: '2026-10-21' },
    { id: 'today', data_visita: today },
    { id: 'future', data_visita: '2026-10-23' }
  ];
  assert.deepEqual(selectPastVisitsFromAgenda(rows, today), [rows[0]]);
});

test('calcula atraso por data civil e atravessa mudança de mês', () => {
  assert.equal(getDaysLate('2026-10-21', today), 1);
  assert.equal(getDaysLate('2026-10-17', today), 5);
  assert.equal(getDaysLate('2026-10-23', today), 0);
});

test('rota semanal de ontem sem visita vira pendência no modo oficial sem criar visita', () => {
  const result = calculateOperationalVisits({
    routes: [route], visits: [], daysRange: [day], todayStr: today,
    operationMode: 'OPERACAO_OFICIAL', officialStartDate: '2026-10-01'
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].dataStr, '2026-10-21');
  assert.equal(result[0].status, 'pendente');
  assert.equal(result[0].isPastOverdue, true);
  assert.equal(result[0].visitObj, null);
  assert.equal(result[0].frequencia, 'SEMANAL');
});

test('visita concluída e não realizada permanecem status definitivos, nunca pendências', () => {
  const makeVisit = (status: Visit['status'], id: string) => ({
    id, promotor_matricula: 'FRANKLIN-01', loja_codigo: 'ASSAI-01', industria_codigo: 'KING', data_visita: '2026-10-21', status
  } as Visit);
  for (const status of ['concluida', 'nao_realizada', 'em_andamento'] as const) {
    const [item] = calculateOperationalVisits({
      routes: [route], visits: [makeVisit(status, status)], daysRange: [day], todayStr: today,
      operationMode: 'OPERACAO_OFICIAL', officialStartDate: '2026-10-01'
    });
    assert.equal(item.status, status);
    assert.equal(item.isPastOverdue, false);
  }
});

test('frequência quinzenal não cria visita em dia sem ocorrência prevista', () => {
  const biweekly = { ...route, frequencia: 'QUINZENAL' } as RouteItem;
  const result = calculateOperationalVisits({
    routes: [biweekly], visits: [], daysRange: [day], todayStr: today,
    operationMode: 'OPERACAO_OFICIAL', officialStartDate: '2026-10-01'
  });
  assert.equal(result.length, 0);
});

test('execução antecipada fica vinculada à data originalmente programada sem reaparecer no dia efetivo', () => {
  const fridayRoute = { ...route, frequencia: 'SEMANAL', quarta: false, sexta: true } as RouteItem;
  const advancedVisit = {
    id: 'advance-1', promotor_matricula: 'FRANKLIN-01', loja_codigo: 'ASSAI-01', industria_codigo: 'KING',
    rota_id: 'route-1', data_visita: '2026-10-22', scheduled_date: '2026-10-23', status: 'concluida'
  } as Visit;
  const range = [
    { dateStr: '2026-10-22', dayKey: 'quinta' as const, dayLabel: 'Quinta', dayShort: 'Qui', isToday: true, isPast: false, isFuture: false },
    { dateStr: '2026-10-23', dayKey: 'sexta' as const, dayLabel: 'Sexta', dayShort: 'Sex', isToday: false, isPast: false, isFuture: true }
  ];
  const result = calculateOperationalVisits({
    routes: [fridayRoute], visits: [advancedVisit], daysRange: range, todayStr: '2026-10-22',
    operationMode: 'OPERACAO_OFICIAL', officialStartDate: '2026-10-01'
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].dataStr, '2026-10-23');
  assert.equal(result[0].status, 'concluida');
  assert.equal(result[0].visitObj?.data_visita, '2026-10-22');
  assert.equal(result[0].visitObj?.scheduled_date, '2026-10-23');
});

test('rota encerrada preserva programação anterior e não gera programação após o encerramento', () => {
  const closedRoute = { ...route, encerrada_em: '2026-10-21T15:00:00Z' } as RouteItem;
  const beforeClose = calculateOperationalVisits({
    routes: [closedRoute], visits: [], daysRange: [day], todayStr: today,
    operationMode: 'OPERACAO_OFICIAL', officialStartDate: '2026-10-01'
  });
  assert.equal(beforeClose.length, 1);
  assert.equal(beforeClose[0].status, 'pendente');
  const afterClose = calculateOperationalVisits({
    routes: [closedRoute], visits: [], daysRange: [{ ...day, dateStr: '2026-10-28' }], todayStr: today,
    operationMode: 'OPERACAO_OFICIAL', officialStartDate: '2026-10-01'
  });
  assert.equal(afterClose.length, 0);
});
