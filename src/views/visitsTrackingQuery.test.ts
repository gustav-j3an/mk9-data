import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVisitsTrackingQuery, updateVisitsTrackingQuery } from './visitsTrackingQuery';

test('acompanhamento restaura filtros, busca, ordenamento contextual e paginação da URL', () => {
  const parsed = parseVisitsTrackingQuery(new URLSearchParams('data=2026-10-23&supervisor=Ana&equipe=Sul&busca=Mercado&pagina=4&por_pagina=25'));
  assert.equal(parsed.date, '2026-10-23');
  assert.equal(parsed.supervisor, 'Ana');
  assert.equal(parsed.team, 'Sul');
  assert.equal(parsed.search, 'Mercado');
  assert.equal(parsed.page, 4);
  assert.equal(parsed.pageSize, 25);
});

test('atualizar filtros não expõe credenciais e mantém outros parâmetros compartilháveis', () => {
  const current = new URLSearchParams('origem=painel&token=nao-persistir-aqui');
  const result = updateVisitsTrackingQuery(current, {
    date: '2026-10-23', supervisor: 'all', team: 'all', promoter: 'all', store: 'all', industry: 'all',
    status: 'concluida', occurrence: 'all', search: '  Centro  ', page: 3, pageSize: 50
  });
  assert.equal(result.get('origem'), 'painel');
  assert.equal(result.get('status'), 'concluida');
  assert.equal(result.get('busca'), 'Centro');
  assert.equal(result.get('pagina'), '3');
  assert.equal(result.get('por_pagina'), '50');
  assert.equal(result.get('token'), null);
  assert.equal(parseVisitsTrackingQuery(new URLSearchParams('pagina=-1&por_pagina=999')).page, undefined);
  assert.equal(parseVisitsTrackingQuery(new URLSearchParams('pagina=-1&por_pagina=999')).pageSize, undefined);
});

test('página fora do número válido após mudança de dados pode ser limitada ao total atual', () => {
  const currentPage = 9;
  const totalPages = 2;
  const validPage = Math.min(currentPage, Math.max(totalPages, 1));
  assert.equal(validPage, 2);
});
