import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RouteItem } from '../types';
import { clearFixedRouteFilters, filterFixedRoutes } from './fixedRouteFilters';

const route = (overrides: Partial<RouteItem> = {}): RouteItem => ({
  id: 'r1', codigo_rota: 'ROT-01', industria_codigo: 'I1', loja_codigo: 'L1',
  promotor_matricula: 'M-123', uf: 'GO', frequencia: 'SEMANAL', segunda: true,
  terca: false, quarta: false, quinta: false, sexta: false, sabado: false, domingo: false,
  industria: { codigo: 'I1', nome: 'ALLES Alimentos' },
  loja: { codigo: 'L1', nome: 'Assaí Valparaíso', rede: 'Assaí', cidade: 'Valparaíso', bairro: 'Jardim Águas Claras', uf: 'GO' },
  promotor: { matricula: 'M-123', nome: 'Franklin Silva' },
  ...overrides
});

const defaults = clearFixedRouteFilters();

test('searches industry, store, city, network, district, promoter, and registration accent-insensitively', () => {
  const rows = [route()];
  for (const search of ['alles', 'ASSAI', 'valparaiso', 'jardim aguas', 'franklin', 'm-123']) {
    assert.equal(filterFixedRoutes(rows, { ...defaults, search }).length, 1, search);
  }
});

test('combines general search with industry, UF, and frequency filters', () => {
  const rows = [route(), route({ id: 'r2', uf: 'SP', industria_codigo: 'I2', loja_codigo: 'L2' })];
  assert.deepEqual(filterFixedRoutes(rows, { ...defaults, search: 'valparaiso', industry: 'I1', uf: 'GO' }).map((item) => item.id), ['r1']);
  assert.equal(filterFixedRoutes(rows, { ...defaults, search: 'valparaiso', industry: 'I1', uf: 'SP' }).length, 0);
  assert.equal(filterFixedRoutes(rows, { ...defaults, frequency: 'QUINZENAL' }).length, 0);
});

test('supports active, closed, all, clear defaults, result counts, and no-result queries', () => {
  const rows = [route(), route({ id: 'closed', encerrada_em: '2026-10-20T12:00:00Z' })];
  assert.equal(filterFixedRoutes(rows, defaults).length, 1);
  assert.equal(filterFixedRoutes(rows, { ...defaults, status: 'closed' }).length, 1);
  assert.equal(filterFixedRoutes(rows, { ...defaults, status: 'all' }).length, 2);
  assert.equal(filterFixedRoutes(rows, { ...defaults, search: 'inexistente' }).length, 0);
  assert.deepEqual(defaults, { search: '', industry: 'TODAS', store: 'TODAS', promoter: 'TODOS', uf: 'TODAS', frequency: 'TODAS', day: 'TODOS', status: 'active' });
});
