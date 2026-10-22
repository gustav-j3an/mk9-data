import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { filterOperationalVisits, getChecklistDisplayValue, getIndustryDisplayName, groupIndustryPerformance, paginateOperationalVisits } from './industryPortalOperational';

const visits = [
  { lojaNome: 'Mercado Central', lojaCodigo: 'LJ-01', lojaCidade: 'São Paulo', promotorNome: 'Ana', status: 'concluida' as const },
  { lojaNome: 'Super Campinas', lojaCodigo: 'LJ-02', lojaCidade: 'Campinas', promotorNome: 'Bruno', status: 'pendente' as const },
  { lojaNome: 'Mercado Norte', lojaCodigo: 'LJ-03', lojaCidade: 'Curitiba', promotorNome: 'Ana', status: 'em_andamento' as const },
  { lojaNome: 'Loja Sul', lojaCodigo: 'LJ-04', lojaCidade: 'Santos', promotorNome: 'Caio', status: 'nao_realizada' as const },
  { lojaNome: 'Loja Futuro', lojaCodigo: 'LJ-05', lojaCidade: 'Brasília', promotorNome: 'Dani', status: 'planejada' as const }
];

describe('filtros e paginação da visão operacional', () => {
  it('filtra por cada status persistido sem transformar pendências atrasadas em outro status', () => {
    assert.deepEqual(filterOperationalVisits(visits, 'concluida', '').map((item) => item.lojaCodigo), ['LJ-01']);
    assert.deepEqual(filterOperationalVisits(visits, 'pendente', '').map((item) => item.lojaCodigo), ['LJ-02']);
    assert.deepEqual(filterOperationalVisits(visits, 'em_andamento', '').map((item) => item.lojaCodigo), ['LJ-03']);
    assert.deepEqual(filterOperationalVisits(visits, 'nao_realizada', '').map((item) => item.lojaCodigo), ['LJ-04']);
    assert.equal(filterOperationalVisits(visits, 'all', '').length, 5);
    assert.equal(
      ['concluida', 'em_andamento', 'pendente', 'nao_realizada']
        .reduce((total, status) => total + filterOperationalVisits(visits, status as 'concluida' | 'em_andamento' | 'pendente' | 'nao_realizada', '').length, 0),
      4
    ); // Status da execução são exclusivos; o item só planejado permanece no total agregado.
  });

  it('busca por loja, código, cidade e promotor sem diferenciar caixa ou acentuação', () => {
    assert.equal(filterOperationalVisits(visits, 'all', 'ana')[0].lojaCodigo, 'LJ-01');
    assert.equal(filterOperationalVisits(visits, 'all', 'LJ-02')[0].lojaNome, 'Super Campinas');
    assert.equal(filterOperationalVisits(visits, 'all', 'Sao Paulo').length, 1);
  });

  it('limita a lista à página solicitada e corrige índices fora do intervalo', () => {
    assert.deepEqual(paginateOperationalVisits([1, 2, 3, 4, 5], 2, 2), [3, 4]);
    assert.deepEqual(paginateOperationalVisits([1, 2, 3], 99, 2), [3]);
    assert.deepEqual(paginateOperationalVisits([1, 2, 3], 0, 2), [1, 2]);
  });
});

describe('industry identity, performance, and checklist display', () => {
  const performanceVisits = [
    { key: 'king-1', industriaCodigo: 'KING', industriaNome: 'King', status: 'concluida' as const },
    { key: 'king-2', industriaCodigo: 'KING', industriaNome: 'King', status: 'pendente' as const },
    { key: 'other-1', industriaCodigo: 'OTHER', industriaNome: 'Outra', status: 'nao_realizada' as const },
    { key: 'unknown-1', industriaCodigo: '', industriaNome: '', status: 'concluida' as const }
  ];

  it('uses a truthful fallback when no industry identity is available', () => {
    assert.equal(getIndustryDisplayName('', ''), 'Indústria não identificada');
  });

  it('searches operational visits by industry name and code', () => {
    const item = { key: 'king-1', routeId: 'r1', dataStr: '2026-10-21', dayOfWeekLabel: 'Qua', promotorMatricula: 'P1', promotorNome: 'Ana', lojaCodigo: 'L1', lojaNome: 'Mercado', industriaCodigo: 'KING', industriaNome: 'King', frequencia: 'SEMANAL', status: 'concluida' as const, isPastOverdue: false, priorityOrder: 1 };
    assert.equal(filterOperationalVisits([item], 'all', 'king').length, 1);
    assert.equal(filterOperationalVisits([item], 'all', 'KING').length, 1);
  });

  it('groups global visits without double counting and keeps unidentified visits visible', () => {
    const grouped = groupIndustryPerformance([...performanceVisits, performanceVisits[0]]);
    assert.equal(grouped.length, 3);
    assert.deepEqual(grouped.find((item) => item.codigo === 'KING'), {
      codigo: 'KING', nome: 'King', previstas: 2, concluidas: 1, pendentes: 1, naoRealizadas: 0, taxaExecucao: 50
    });
    assert.equal(grouped.find((item) => item.codigo === null)?.nome, 'Indústria não identificada');
  });

  it('isolates performance to the selected industry', () => {
    assert.deepEqual(groupIndustryPerformance(performanceVisits, 'KING').map((item) => item.codigo), ['KING']);
  });

  it('preserves numeric values, yes/no answers, and missing checklist answers', () => {
    assert.equal(getChecklistDisplayValue({ checked: true, valor_texto: '12' }), '12');
    assert.equal(getChecklistDisplayValue({ checked: true }), 'Sim');
    assert.equal(getChecklistDisplayValue({ checked: false }), 'Não');
    assert.equal(getChecklistDisplayValue({ checked: null }), 'Não informado');
  });
});
