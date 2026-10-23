import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { filterPromoterDailySummaries, paginateVisits, sortVisitsForDisplay } from './visitsTrackingPresentation';

describe('apresentação do acompanhamento de visitas', () => {
  it('pagina os resultados já filtrados, limita índices e suporta os tamanhos permitidos', () => {
    const filtered = Array.from({ length: 37 }, (_, index) => `visita-${index + 1}`);
    assert.equal(paginateVisits(filtered, 1, 15).length, 15);
    assert.equal(paginateVisits(filtered, 2, 15)[0], 'visita-16');
    assert.equal(paginateVisits(filtered, 3, 15).length, 7);
    assert.equal(paginateVisits(filtered, 1, 25).length, 25);
    assert.equal(paginateVisits(filtered, 1, 50).length, 37);
    assert.equal(paginateVisits(filtered, 99, 15).length, 7);
  });

  it('combina busca por promotor e filtro de pendências sem alterar os cartões de origem', () => {
    const summaries = [
      { nome: 'Ana Silva', pendentes: 2, previstas: 4 },
      { nome: 'Bruno Souza', pendentes: 0, previstas: 3 },
      { nome: 'Ana Costa', pendentes: 0, previstas: 2 }
    ];
    assert.deepEqual(filterPromoterDailySummaries(summaries, ' ana ', false).map((item) => item.nome), ['Ana Silva', 'Ana Costa']);
    assert.deepEqual(filterPromoterDailySummaries(summaries, '', true).map((item) => item.nome), ['Ana Silva']);
    assert.equal(summaries[0].previstas, 4);
  });

  it('ordena os resultados filtrados antes de paginar, mantendo a ordem estável por loja', () => {
    const ordered = sortVisitsForDisplay([
      { lojaNome: 'Zeta', status: 'concluida' },
      { lojaNome: 'Beta', status: 'pendente' },
      { lojaNome: 'Alfa', status: 'em_andamento' }
    ]);
    assert.deepEqual(ordered.map((item) => item.lojaNome), ['Alfa', 'Beta', 'Zeta']);
    assert.deepEqual(paginateVisits(ordered, 1, 15), ordered);
  });
});
