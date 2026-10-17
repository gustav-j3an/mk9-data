import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { filterSearchableOptions, type SearchableSelectOption } from './SearchableSelect';

const storeOptions: SearchableSelectOption[] = [
  {
    value: 'LOJ-0071',
    label: 'Loja Centro (LOJ-0071)',
    detail: 'Taguatinga - DF',
    searchText: 'Loja Centro LOJ-0071 Taguatinga DF'
  },
  {
    value: 'LOJ-0210',
    label: 'Supermercado Taguatinga (LOJ-0210)',
    detail: 'Taguatinga - DF',
    searchText: 'Supermercado Taguatinga LOJ-0210 Taguatinga DF'
  },
  {
    value: 'LOJ-0345',
    label: 'Mercado Goiás (LOJ-0345)',
    detail: 'Goiânia - GO',
    searchText: 'Mercado Goiás LOJ-0345 Goiânia GO'
  }
];

describe('filterSearchableOptions', () => {
  it('encontra lojas por parte do nome e código', () => {
    assert.deepEqual(
      filterSearchableOptions(storeOptions, 'supermercado').map((option) => option.value),
      ['LOJ-0210']
    );
    assert.deepEqual(
      filterSearchableOptions(storeOptions, 'LOJ-0071').map((option) => option.value),
      ['LOJ-0071']
    );
  });

  it('retorna todas as lojas da cidade ou UF pesquisada', () => {
    assert.deepEqual(
      filterSearchableOptions(storeOptions, 'Taguatinga').map((option) => option.value),
      ['LOJ-0071', 'LOJ-0210']
    );
    assert.deepEqual(
      filterSearchableOptions(storeOptions, 'GO').map((option) => option.value),
      ['LOJ-0345']
    );
  });

  it('pesquisa nome e código da indústria e nome e matrícula do promotor', () => {
    const industryOptions: SearchableSelectOption[] = [
      { value: 'IND-005', label: 'Indústria Norte (IND-005)', searchText: 'Indústria Norte IND-005' }
    ];
    const promoterOptions: SearchableSelectOption[] = [
      { value: '009812', label: 'Marina Souza (009812)', searchText: 'Marina Souza 009812' }
    ];

    assert.equal(filterSearchableOptions(industryOptions, 'norte')[0].value, 'IND-005');
    assert.equal(filterSearchableOptions(industryOptions, 'IND-005')[0].value, 'IND-005');
    assert.equal(filterSearchableOptions(promoterOptions, 'marina')[0].value, '009812');
    assert.equal(filterSearchableOptions(promoterOptions, '009812')[0].value, '009812');
  });
});
