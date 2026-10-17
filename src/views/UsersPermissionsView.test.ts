import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { filterPilotPromoters, type PromoterRecord } from './UsersPermissionsView';

const promoters: PromoterRecord[] = [
  { matricula: 'PRM-00127', nome: 'Ana Beatriz Costa' },
  { matricula: 'PRM-00482', nome: 'Carlos Eduardo Souza' }
];

describe('filterPilotPromoters', () => {
  it('pesquisa pelo nome completo ou parcial ignorando maiúsculas e espaços excedentes', () => {
    assert.deepEqual(
      filterPilotPromoters(promoters, '  ANA   BEATRIZ COSTA ').map((promoter) => promoter.matricula),
      ['PRM-00127']
    );
    assert.deepEqual(
      filterPilotPromoters(promoters, 'eduardo').map((promoter) => promoter.matricula),
      ['PRM-00482']
    );
  });

  it('pesquisa pela matrícula completa ou por um trecho', () => {
    assert.deepEqual(
      filterPilotPromoters(promoters, 'PRM-00127').map((promoter) => promoter.matricula),
      ['PRM-00127']
    );
    assert.deepEqual(
      filterPilotPromoters(promoters, '482').map((promoter) => promoter.matricula),
      ['PRM-00482']
    );
  });

  it('retorna lista vazia sem correspondências e restaura todos quando a busca é limpa', () => {
    assert.deepEqual(filterPilotPromoters(promoters, 'ninguém'), []);
    assert.deepEqual(filterPilotPromoters(promoters, ''), promoters);
    assert.deepEqual(filterPilotPromoters(promoters, '   '), promoters);
  });
});
