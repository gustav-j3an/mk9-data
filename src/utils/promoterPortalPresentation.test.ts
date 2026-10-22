import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  filterPromoterAppointments,
  filterHistoricalAttendances,
  formatAppointmentDateHeading,
  getAppointmentsTabForMetric,
  getMetricDisplayValue,
  getWeeklyPromoterMetricCounts,
  groupAppointmentsByDate,
  getRegularizationCounts,
  getRegularizationPresentation,
  isUnresolvedVisitInProgress
} from './promoterPortalPresentation';

test('indicator statuses navigate to the corresponding appointments filter', () => {
  assert.equal(getAppointmentsTabForMetric('planejada'), 'today');
  assert.equal(getAppointmentsTabForMetric('em_andamento'), 'today');
  assert.equal(getAppointmentsTabForMetric('pendente'), 'pending');
  assert.equal(getAppointmentsTabForMetric('concluida'), 'history');
  assert.equal(getAppointmentsTabForMetric('nao_realizada'), 'history');
});

test('appointment filters retain only the selected status and preserve all on reset', () => {
  const appointments = [
    { id: 'p', status: 'planejada' },
    { id: 'a', status: 'em_andamento' },
    { id: 'c', status: 'concluida' },
    { id: 'r', status: 'em_andamento', visitObj: { regularization_status: 'closed_without_execution_proof' } }
  ];
  assert.deepEqual(filterPromoterAppointments(appointments, 'planejada'), [appointments[0]]);
  assert.deepEqual(filterPromoterAppointments(appointments, 'em_andamento'), [appointments[1]]);
  assert.deepEqual(filterPromoterAppointments(appointments, 'em_andamento').map(appointment => appointment.id), ['a']);
  assert.deepEqual(filterPromoterAppointments(appointments, 'all'), appointments);
});

test('weekly metric counts include only pendente, concluida and nao_realizada records', () => {
  assert.deepEqual(getWeeklyPromoterMetricCounts([
    { status: 'planejada' }, { status: 'em_andamento' }, { status: 'pendente' },
    { status: 'concluida' }, { status: 'concluida' }, { status: 'nao_realizada' }
  ]), { pending: 1, completed: 2, notDone: 1 });
});

test('metrics show unavailable while loading or after a load error', () => {
  assert.equal(getMetricDisplayValue(0, true, false), '—');
  assert.equal(getMetricDisplayValue(0, false, true), '—');
  assert.equal(getMetricDisplayValue(0, false, false), 0);
});

test('history shows real attendance records, including interrupted and in-progress records, but excludes schedule projections', () => {
  const visits = [
    { id: 'planned', status: 'planejada', visitObj: null },
    { id: 'pending', status: 'pendente', visitObj: null },
    { id: 'completed', status: 'concluida', visitObj: { id: 'completed' } },
    { id: 'interrupted', status: 'nao_realizada', visitObj: { id: 'interrupted', motivo_nao_realizada: '[Interrupção] justificativa' } },
    { id: 'open', status: 'em_andamento', visitObj: { id: 'open' } }
  ];
  assert.deepEqual(filterHistoricalAttendances(visits).map(visit => visit.id), ['completed', 'interrupted', 'open']);
});

test('administrative resolutions stay separate from active and completed operational counts', () => {
  const visits = [
    { status: 'em_andamento', regularization_status: null },
    { status: 'em_andamento', regularization_status: 'closed_without_execution_proof' },
    { status: 'em_andamento', regularization_status: 'administratively_completed_with_proof' },
    { status: 'concluida', regularization_status: null }
  ];
  assert.equal(isUnresolvedVisitInProgress(visits[0]), true);
  assert.equal(isUnresolvedVisitInProgress(visits[1]), false);
  assert.deepEqual(getRegularizationCounts(visits), { inProgress: 1, administrativelyCompleted: 1, closedWithoutProof: 1 });
  assert.equal(getRegularizationPresentation(visits[1].regularization_status), 'Encerrada administrativamente · sem execução comprovada');
  assert.equal(getRegularizationPresentation(visits[2].regularization_status), 'Concluída administrativamente · com comprovação');
});

test('upcoming appointments group by date in chronological order without merging stores or industries', () => {
  const appointments = [
    { key: 'friday-x', dataStr: '2026-10-23', lojaNome: 'Loja A', industriaNome: 'Indústria X' },
    { key: 'saturday-z', dataStr: '2026-10-24', lojaNome: 'Loja C', industriaNome: 'Indústria Z' },
    { key: 'friday-y', dataStr: '2026-10-23', lojaNome: 'Loja A', industriaNome: 'Indústria Y' }
  ];
  const groups = groupAppointmentsByDate(appointments);
  assert.deepEqual(groups.map(group => group.date), ['2026-10-23', '2026-10-24']);
  assert.deepEqual(groups[0].appointments.map(visit => visit.industriaNome), ['Indústria X', 'Indústria Y']);
  assert.equal(groups[0].appointments.length, 2);
  assert.equal(groups[1].appointments[0].key, 'saturday-z');
  assert.equal(formatAppointmentDateHeading(groups[0].date), 'SEXTA-FEIRA — 23/10');
  assert.equal(formatAppointmentDateHeading(groups[1].date), 'SÁBADO — 24/10');
});
