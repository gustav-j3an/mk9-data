import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterPromoterSummaries, calculateOperationalMetrics, type RouteStatusFilter } from './attendanceFilters';
import type { PromoterOperationalSummary } from './visitActivityEngine';

const mockSummaries: PromoterOperationalSummary[] = [
  {
    promoterId: 'p1',
    matricula: '001',
    name: 'Ana Silva',
    equipe: 'Alpha',
    supervisor: 'Carlos',
    presenceStatus: 'presente',
    firstActivityTime: '08:00',
    scheduledVisitsCount: 3,
    completedVisitsCount: 3,
    inProgressVisitsCount: 0,
    pendingVisitsCount: 0,
    routeStatus: 'COMPLETO',
    visits: []
  },
  {
    promoterId: 'p2',
    matricula: '002',
    name: 'Bruno Souza',
    equipe: 'Alpha',
    supervisor: 'Carlos',
    presenceStatus: 'presente',
    firstActivityTime: '08:30',
    scheduledVisitsCount: 4,
    completedVisitsCount: 2,
    inProgressVisitsCount: 0,
    pendingVisitsCount: 2,
    routeStatus: 'PARCIAL',
    visits: []
  },
  {
    promoterId: 'p3',
    matricula: '003',
    name: 'Carla Dias',
    equipe: 'Beta',
    supervisor: 'Mariana',
    presenceStatus: 'sem_atividade',
    firstActivityTime: null,
    scheduledVisitsCount: 2,
    completedVisitsCount: 0,
    inProgressVisitsCount: 0,
    pendingVisitsCount: 2,
    routeStatus: 'NAO_REALIZADO',
    visits: []
  },
  {
    promoterId: 'p4',
    matricula: '004',
    name: 'Daniel Rocha',
    equipe: 'Beta',
    supervisor: 'Mariana',
    presenceStatus: 'presente',
    firstActivityTime: '09:00',
    scheduledVisitsCount: 3,
    completedVisitsCount: 1,
    inProgressVisitsCount: 1,
    pendingVisitsCount: 2,
    routeStatus: 'EM_ATIVIDADE',
    visits: []
  },
  {
    promoterId: 'p5',
    matricula: '005',
    name: 'Eduardo Lima',
    equipe: 'Beta',
    supervisor: 'Mariana',
    presenceStatus: 'sem_atividade',
    firstActivityTime: null,
    scheduledVisitsCount: 3,
    completedVisitsCount: 0,
    inProgressVisitsCount: 0,
    pendingVisitsCount: 3,
    routeStatus: 'AGUARDANDO_INICIO',
    visits: []
  },
  {
    promoterId: 'p6',
    matricula: '006',
    name: 'Fabiana Melo',
    equipe: 'Geral',
    supervisor: 'Carlos',
    presenceStatus: 'sem_atividade',
    firstActivityTime: null,
    scheduledVisitsCount: 0,
    completedVisitsCount: 0,
    inProgressVisitsCount: 0,
    pendingVisitsCount: 0,
    routeStatus: 'SEM_PROGRAMACAO',
    visits: []
  }
];

test('1. Retorna todos os promotores com roteiro programado no padrão', () => {
  const result = filterPromoterSummaries(mockSummaries, {
    scopeFilter: 'com_roteiro',
    statusFilter: 'ALL'
  });
  // p1, p2, p3, p4, p5 (p6 não tem programação)
  assert.equal(result.length, 5);
});
test('2. Filtro interativo: COMPLETOS', () => {
  const result = filterPromoterSummaries(mockSummaries, {
    scopeFilter: 'com_roteiro',
    statusFilter: 'COMPLETO'
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'Ana Silva');
});

test('3. Filtro interativo: PARCIAIS', () => {
  const result = filterPromoterSummaries(mockSummaries, {
    scopeFilter: 'com_roteiro',
    statusFilter: 'PARCIAL'
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'Bruno Souza');
});

test('4. Filtro interativo: NÃO REALIZADOS', () => {
  const result = filterPromoterSummaries(mockSummaries, {
    scopeFilter: 'com_roteiro',
    statusFilter: 'NAO_REALIZADO'
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'Carla Dias');
});

test('5. Filtro interativo: EM ATIVIDADE', () => {
  const result = filterPromoterSummaries(mockSummaries, {
    scopeFilter: 'com_roteiro',
    statusFilter: 'EM_ATIVIDADE'
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'Daniel Rocha');
});

test('6. Filtro interativo: AGUARDANDO INÍCIO', () => {
  const result = filterPromoterSummaries(mockSummaries, {
    scopeFilter: 'com_roteiro',
    statusFilter: 'AGUARDANDO_INICIO'
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'Eduardo Lima');
});

test('7. Desativação do filtro interativo (volta para ALL)', () => {
  const result = filterPromoterSummaries(mockSummaries, {
    scopeFilter: 'com_roteiro',
    statusFilter: 'ALL'
  });
  assert.equal(result.length, 5);
});

test('8. Combinação de filtro interativo com busca textual', () => {
  // Buscar 'Bruno' com filtro PARCIAL -> 1 resultado
  const r1 = filterPromoterSummaries(mockSummaries, {
    search: 'Bruno',
    statusFilter: 'PARCIAL'
  });
  assert.equal(r1.length, 1);

  // Buscar 'Ana' com filtro PARCIAL -> 0 resultados
  const r2 = filterPromoterSummaries(mockSummaries, {
    search: 'Ana',
    statusFilter: 'PARCIAL'
  });
  assert.equal(r2.length, 0);
});

test('9. Combinação de filtro interativo com Supervisor', () => {
  // Supervisor Mariana com filtro EM_ATIVIDADE -> Daniel Rocha
  const r1 = filterPromoterSummaries(mockSummaries, {
    supervisorFilter: 'Mariana',
    statusFilter: 'EM_ATIVIDADE'
  });
  assert.equal(r1.length, 1);
  assert.equal(r1[0].matricula, '004');

  // Supervisor Carlos com filtro EM_ATIVIDADE -> 0
  const r2 = filterPromoterSummaries(mockSummaries, {
    supervisorFilter: 'Carlos',
    statusFilter: 'EM_ATIVIDADE'
  });
  assert.equal(r2.length, 0);
});

test('10. Escopo sem programação', () => {
  const result = filterPromoterSummaries(mockSummaries, {
    scopeFilter: 'sem_programacao',
    statusFilter: 'ALL'
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'Fabiana Melo');
});

test('11. Cálculo das métricas preserva valores da operação', () => {
  const metrics = calculateOperationalMetrics(mockSummaries.filter(s => s.scheduledVisitsCount > 0));
  assert.equal(metrics.completos, 1);
  assert.equal(metrics.parciais, 1);
  assert.equal(metrics.naoRealizados, 1);
  assert.equal(metrics.emAtividade, 1);
  assert.equal(metrics.aguardandoInicio, 1);
  assert.equal(metrics.totalProgramadas, 15);
  assert.equal(metrics.totalConcluidas, 6);
  assert.equal(metrics.totalPendentes, 9);
  assert.equal(metrics.percentualExecucao, 40); // 6 / 15 = 40%
});
