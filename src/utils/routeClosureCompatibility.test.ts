import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteClosureCompatibility, isMissingRouteClosureColumn } from './routeClosureCompatibility';

test('recognizes only missing encerrada_em schema errors', () => {
  assert.equal(isMissingRouteClosureColumn({
    code: '42703',
    message: 'column rotas.encerrada_em does not exist'
  }), true);
  assert.equal(isMissingRouteClosureColumn({
    code: 'PGRST204',
    message: "Could not find the 'encerrada_em' column of 'rotas' in the schema cache"
  }), true);
  assert.equal(isMissingRouteClosureColumn({
    code: '42501',
    message: 'permission denied for table rotas'
  }), false);
  assert.equal(isMissingRouteClosureColumn({
    code: '42703',
    message: 'column rotas.frequencia does not exist'
  }), false);
});

test('retries once without closure filtering when the legacy schema lacks the column', async () => {
  const calls: boolean[] = [];
  const routes = [{ id: 'weekly-route' }];
  const loadRoutesWithClosureFallback = createRouteClosureCompatibility();
  const result = await loadRoutesWithClosureFallback(async (filterByClosure) => {
    calls.push(filterByClosure);
    return filterByClosure
      ? { data: [], error: { code: '42703', message: 'column rotas.encerrada_em does not exist' } }
      : { data: routes, error: null };
  });

  assert.deepEqual(calls, [true, false]);
  assert.deepEqual(result.data, routes);
  assert.equal(result.error, null);
  assert.equal(result.usedClosureFallback, true);
  assert.deepEqual(result.closureFallbackError, { code: '42703', message: 'column rotas.encerrada_em does not exist' });
});

test('does not retry unrelated query errors', async () => {
  const calls: boolean[] = [];
  const queryError = { code: '42501', message: 'permission denied for table rotas' };
  const loadRoutesWithClosureFallback = createRouteClosureCompatibility();
  const result = await loadRoutesWithClosureFallback(async (filterByClosure) => {
    calls.push(filterByClosure);
    return { data: [], error: queryError };
  });

  assert.deepEqual(calls, [true]);
  assert.equal(result.error, queryError);
  assert.equal(result.usedClosureFallback, false);
});

test('remembers a confirmed missing closure column for subsequent route reloads', async () => {
  const loadRoutesWithClosureFallback = createRouteClosureCompatibility();
  const calls: boolean[] = [];
  const query = async (filterByClosure: boolean) => {
    calls.push(filterByClosure);
    return filterByClosure
      ? { data: [], error: { code: '42703', message: 'column rotas.encerrada_em does not exist' } }
      : { data: [{ id: 'legacy-route' }], error: null };
  };

  await loadRoutesWithClosureFallback(query);
  const second = await loadRoutesWithClosureFallback(query);

  assert.deepEqual(calls, [true, false, false]);
  assert.deepEqual(second.data, [{ id: 'legacy-route' }]);
  assert.equal(second.usedClosureFallback, true);
});
