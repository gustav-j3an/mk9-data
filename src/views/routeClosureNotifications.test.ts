import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('fixed-route close handlers ignore duplicate in-flight confirmations', async () => {
  const routesView = await readFile(new URL('./RoutesView.tsx', import.meta.url), 'utf8');
  const promoterPortal = await readFile(new URL('./PromoterPortalView.tsx', import.meta.url), 'utf8');
  assert.match(routesView, /!closingRoute \|\| closeRouteInFlight\.current/);
  assert.match(promoterPortal, /!closingScaleRoute \|\| !canManageRoutes \|\| closeScaleInFlight\.current/);
});

test('close failures retain the migration explanation and are emitted once by each handler', async () => {
  const routesService = await readFile(new URL('../lib/routesService.ts', import.meta.url), 'utf8');
  const routesView = await readFile(new URL('./RoutesView.tsx', import.meta.url), 'utf8');
  assert.match(routesService, /20261018235500_soft_delete_fixed_routes\.sql/);
  assert.equal((routesView.match(/title: 'Falha ao Encerrar Rota'/g) || []).length, 1);
});
