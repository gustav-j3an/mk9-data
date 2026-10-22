import assert from 'node:assert/strict';
import test from 'node:test';
import type { Visit } from '../types';
import { canManageOldOpenVisits, filterOldOpenVisits, getAdministrativeResolutionLabel, getVisitDurationLabel, getVisitResolutionCounts } from './oldOpenVisitManagement';

const visit = (id: string, industry: string, status: Visit['status'] = 'em_andamento'): Visit => ({
  id, promotor_matricula: 'P-1', loja_codigo: 'S-1', industria_codigo: industry,
  data_visita: '2026-10-20', started_at: '2026-10-20T12:00:00.000Z', status
});

test('fila administrativa inclui visitas antigas abertas e mantém visitas por indústria separadas', () => {
  const result = filterOldOpenVisits([visit('a', 'I-1'), visit('b', 'I-2')], {
    promoter: 'all', store: 'all', industry: 'all', from: '', to: '', before: '2026-10-22'
  });
  assert.deepEqual(result.map((item) => item.id), ['a', 'b']);
  assert.equal(filterOldOpenVisits(result, {
    promoter: 'all', store: 'S-1', industry: 'I-2', from: '2026-10-19', to: '2026-10-21', before: '2026-10-22'
  })[0]?.id, 'b');
});

test('visitas de hoje, concluídas e não realizadas não entram na fila de antigas abertas', () => {
  const today = { ...visit('today', 'I-1'), data_visita: '2026-10-22' };
  const result = filterOldOpenVisits([today, visit('done', 'I-1', 'concluida'), visit('open', 'I-2')], {
    promoter: 'all', store: 'all', industry: 'all', from: '', to: '', before: '2026-10-22'
  });
  assert.deepEqual(result.map((item) => item.id), ['open']);
});

test('visitas regularizadas saem da fila sem converter o status operacional', () => {
  const closed = { ...visit('closed', 'I-1'), regularization_status: 'closed_without_execution_proof' as const };
  const completed = { ...visit('admin-done', 'I-2'), regularization_status: 'administratively_completed_with_proof' as const };
  assert.deepEqual(filterOldOpenVisits([closed, completed], {
    promoter: 'all', store: 'all', industry: 'all', from: '', to: '', before: '2026-10-22'
  }), []);
  assert.equal(closed.status, 'em_andamento');
  assert.equal(completed.status, 'em_andamento');
  assert.match(getAdministrativeResolutionLabel(closed.regularization_status) || '', /sem execução comprovada/);
  assert.match(getAdministrativeResolutionLabel(completed.regularization_status) || '', /com comprovação/);
  assert.equal(getAdministrativeResolutionLabel(null), null);
});

test('relatórios separam conclusões operacionais, conclusões administrativas e encerramentos sem prova', () => {
  assert.deepEqual(getVisitResolutionCounts([
    { status: 'concluida', regularization_status: null },
    { status: 'em_andamento', regularization_status: 'administratively_completed_with_proof' },
    { status: 'em_andamento', regularization_status: 'closed_without_execution_proof' },
    { status: 'em_andamento', regularization_status: null }
  ]), {
    inProgress: 1,
    operationallyCompleted: 1,
    administrativelyCompleted: 1,
    closedWithoutProof: 1
  });
});

test('ações da central só são exibidas para admin e gestor', () => {
  assert.equal(canManageOldOpenVisits('admin'), true);
  assert.equal(canManageOldOpenVisits('gestor'), true);
  assert.equal(canManageOldOpenVisits('promotor'), false);
  assert.equal(canManageOldOpenVisits('operador'), false);
});

test('duração da visita antiga é legível e não altera nenhum horário', () => {
  assert.equal(getVisitDurationLabel('2026-10-20T12:00:00.000Z', Date.parse('2026-10-22T14:35:00.000Z')), '2d 2h 35min');
  assert.equal(getVisitDurationLabel(null), 'Duração indisponível');
});
