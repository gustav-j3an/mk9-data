import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { signOutAndNavigateToLogin } from './firstAccessNavigation';

const source = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

test('first access screen exposes a return-to-login button with visible keyboard focus', async () => {
  const protectedRoute = await source('./ProtectedRoute.tsx');
  assert.match(protectedRoute, /Voltar para o login/);
  assert.match(protectedRoute, /onClick=\{handleReturnToLogin\}/);
  assert.match(protectedRoute, /focus-visible:ring-2/);
});

test('return-to-login signs out before replacing the route', async () => {
  const calls: string[] = [];
  await signOutAndNavigateToLogin(
    async () => { calls.push('signOut'); },
    () => { calls.push('clearTemporaryState'); },
    (path, options) => { calls.push(`${path}:${options.replace}`); }
  );
  assert.deepEqual(calls, ['signOut', 'clearTemporaryState', '/login:true']);
});

test('failed sign-out does not navigate to login', async () => {
  const calls: string[] = [];
  await assert.rejects(
    signOutAndNavigateToLogin(
      async () => { calls.push('signOut'); throw new Error('offline'); },
      () => { calls.push('clearTemporaryState'); },
      (path) => { calls.push(path); }
    ),
    /offline/
  );
  assert.deepEqual(calls, ['signOut']);
});

test('mandatory password change remains guarded and a later login uses its own session', async () => {
  const protectedRoute = await source('./ProtectedRoute.tsx');
  const authProvider = await source('./AuthProvider.tsx');
  const loginPage = await source('./LoginPage.tsx');
  assert.match(protectedRoute, /session\.user\?\.user_metadata\?\.must_change_password/);
  assert.match(authProvider, /if \(result\.data\.session\)\s*\{\s*setSession\(result\.data\.session\)/);
  assert.match(loginPage, /const isFirstAccess = Boolean\(session\?\.user\?\.user_metadata\?\.must_change_password\)/);
});

test('auth sign-out failure is checked before local session state is cleared', async () => {
  const authProvider = await source('./AuthProvider.tsx');
  const start = authProvider.indexOf('signOut: async () => {');
  const end = authProvider.indexOf('\n    },', start);
  const signOutImplementation = authProvider.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.ok(signOutImplementation.indexOf('await supabase.auth.signOut()') < signOutImplementation.indexOf('setSession(null)'));
  assert.match(signOutImplementation, /if \(signOutError\) throw new Error/);
});

test('restauração da sessão controla o loading e evita substituir sessão por resposta antiga', async () => {
  const authProvider = await source('./AuthProvider.tsx');
  assert.match(authProvider, /let authEventReceived = false/);
  assert.match(authProvider, /if \(!active \|\| authEventReceived\) return/);
  assert.match(authProvider, /getSession\(\)\.then\(async/);
  assert.match(authProvider, /finally\(\(\) => \{\s*if \(active && !authEventReceived\) setLoading\(false\)/);
});

test('acesso interno não autenticado preserva destino completo e login usa caminho local', async () => {
  const protectedRoute = await source('./ProtectedRoute.tsx');
  const loginPage = await source('./LoginPage.tsx');
  assert.match(protectedRoute, /location\.pathname\}\$\{location\.search\}\$\{location\.hash/);
  assert.match(loginPage, /requestedPath/);
  assert.match(loginPage, /requestedPath\.startsWith\('\/'\) && !requestedPath\.startsWith\('\/\/'\)/);
  assert.match(loginPage, /navigate\(returnPath, \{ replace: true \}\)/);
  assert.match(loginPage, /if \(loading\)/);
});
