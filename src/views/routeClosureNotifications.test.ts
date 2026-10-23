import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('fixed-route close handlers ignore duplicate in-flight confirmations', async () => {
  const routesView = await readFile(new URL('./RoutesView.tsx', import.meta.url), 'utf8');
  const promoterPortal = await readFile(new URL('./PromoterPortalView.tsx', import.meta.url), 'utf8');
  assert.match(routesView, /!closingRoute \|\| closeRouteInFlight\.current/);
  assert.match(promoterPortal, /!closingScaleRoute \|\| !canManageRoutes \|\| closeScaleInFlight\.current/);
});

test('close failures show the supported explanation and are emitted once by each handler', async () => {
  const routesService = await readFile(new URL('../lib/routesService.ts', import.meta.url), 'utf8');
  const routesView = await readFile(new URL('./RoutesView.tsx', import.meta.url), 'utf8');
  assert.match(routesService, /funcionalidade de encerramento ainda precisa ser habilitada no sistema/);
  assert.doesNotMatch(routesService, /\.delete\(/);
  assert.equal((routesView.match(/title: 'Falha ao Encerrar Rota'/g) || []).length, 1);
});
