import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { OperationalVisitItem } from './routePlanner';
import {
  canOpenStoreVisitReport,
  filterStoreHistoryItems,
  getStoreHistoryStatusLabel,
  getStoreHistorySummary
} from './industryStoreHistory';

const makeItem = (status: OperationalVisitItem['status'], options: Partial<OperationalVisitItem> = {}): OperationalVisitItem => ({
  key: status,
  routeId: 'route-1',
  dataStr: '2026-10-21',
  dayOfWeekLabel: 'Quarta-feira',
  promotorMatricula: 'P-01',
  promotorNome: 'Promotor de teste',
  lojaCodigo: 'L-01',
  lojaNome: 'Loja de teste',
  industriaCodigo: 'I-01',
  industriaNome: 'Indústria de teste',
  frequencia: 'SEMANAL',
  status,
  isPastOverdue: false,
  priorityOrder: 1,
  visitObj: null,
  ...options
});

describe('histórico de atendimentos da loja', () => {
  it('usa os mesmos itens operacionais para resumo e distinção entre planejada e pendente', () => {
    const items = [
      makeItem('concluida', { visitObj: { id: 'visit-1' } as OperationalVisitItem['visitObj'] }),
      makeItem('planejada'),
      makeItem('pendente'),
      makeItem('nao_realizada'),
      makeItem('em_andamento')
    ];

    assert.deepEqual(getStoreHistorySummary(items), {
      planejadas: 5,
      concluidas: 1,
      pendentes: 1,
      naoRealizadas: 1,
      aderencia: 20
    });
    assert.equal(getStoreHistoryStatusLabel(items[1]), 'Planejada');
    assert.equal(getStoreHistoryStatusLabel(items[2]), 'Pendente');
    assert.equal(getStoreHistoryStatusLabel(makeItem('pendente', { isPastOverdue: true })), 'Atrasada');
  });

  it('filtra a timeline pelo status sem alterar o resumo do período', () => {
    const items = [makeItem('planejada'), makeItem('pendente'), makeItem('concluida')];
    assert.deepEqual(filterStoreHistoryItems(items, 'pendente'), [items[1]]);
    assert.deepEqual(filterStoreHistoryItems(items, 'all'), items);
    assert.equal(getStoreHistorySummary(items).planejadas, 3);
  });

  it('não oferece relatório para atendimento sem execução concluída e associada', () => {
    assert.equal(canOpenStoreVisitReport(makeItem('planejada')), false);
    assert.equal(canOpenStoreVisitReport(makeItem('pendente', { visitObj: { id: 'visit-2' } as OperationalVisitItem['visitObj'] })), false);
    assert.equal(canOpenStoreVisitReport(makeItem('concluida')), false);
    assert.equal(canOpenStoreVisitReport(makeItem('concluida', { visitObj: { id: 'visit-3' } as OperationalVisitItem['visitObj'] })), true);
  });

  it('marca aderência como indisponível quando não há atendimentos no período', () => {
    assert.equal(getStoreHistorySummary([]).aderencia, null);
  });
});
