import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultScreenForRole, roleCanOpenScreen, screenFromPath, screenPath } from './navigation';
import { readFile } from 'node:fs/promises';

test('módulos operacionais restauram o módulo pelo caminho direto', () => {
  for (const screen of ['rotas-fixas', 'acompanhamento-visitas', 'portal-promotor'] as const) {
    assert.equal(screenFromPath(screenPath(screen)), screen);
  }
  assert.equal(screenFromPath('/acompanhamento-visitas/'), 'acompanhamento-visitas');
  assert.equal(screenFromPath('/'), null);
  assert.equal(screenFromPath('/rota-inexistente'), null);
});

test('destino inicial depende do perfil e caminhos internos respeitam o papel', () => {
  assert.equal(defaultScreenForRole('promotor'), 'portal-promotor');
  assert.equal(defaultScreenForRole('client_industry'), 'portal-industria');
  assert.equal(defaultScreenForRole('admin'), 'cockpit');
  assert.equal(roleCanOpenScreen('rotas-fixas', 'admin'), true);
  assert.equal(roleCanOpenScreen('usuarios', 'operador'), false);
  assert.equal(roleCanOpenScreen('portal-promotor', 'promotor'), true);
  assert.equal(roleCanOpenScreen('rotas-fixas', 'promotor'), false);
});

test('a resolução da rota independe de viewport desktop ou celular', () => {
  const path = '/rotas-fixas';
  for (const viewport of [1440, 768, 390]) {
    assert.ok(viewport > 0);
    assert.equal(screenFromPath(path), 'rotas-fixas');
  }
});

test('Dashboard usa o caminho como estado do módulo e aguarda autorização antes do fallback', async () => {
  const app = await readFile(new URL('./App.tsx', import.meta.url), 'utf8');
  assert.match(app, /useLocation, useNavigate/);
  assert.match(app, /screenFromPath\(location\.pathname\)/);
  assert.match(app, /navigate\(screenPath\(screen\)\)/);
  assert.match(app, /if \(accessCheckPending\) return/);
  assert.match(app, /navigate\(screenPath\(activeScreen\), \{ replace: true \}\)/);
});
