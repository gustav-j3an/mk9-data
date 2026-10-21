import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { filterOperationalVisits, paginateOperationalVisits } from './industryPortalOperational';

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
