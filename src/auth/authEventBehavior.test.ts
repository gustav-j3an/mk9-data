import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { shouldKeepAuthenticatedViewMountedOnAuthEvent } from './authEventBehavior';

test('a token refresh for the same authenticated user keeps the active view mounted', () => {
  assert.equal(shouldKeepAuthenticatedViewMountedOnAuthEvent('TOKEN_REFRESHED', 'user-a', 'user-a'), true);
});

test('a refresh without the same valid user does not preserve the authenticated view', () => {
  assert.equal(shouldKeepAuthenticatedViewMountedOnAuthEvent('TOKEN_REFRESHED', null, 'user-a'), false);
  assert.equal(shouldKeepAuthenticatedViewMountedOnAuthEvent('TOKEN_REFRESHED', 'user-a', null), false);
  assert.equal(shouldKeepAuthenticatedViewMountedOnAuthEvent('TOKEN_REFRESHED', 'user-a', 'user-b'), false);
});

test('same-user sign-in and profile updates keep the active route, while identity transitions do not', () => {
  assert.equal(shouldKeepAuthenticatedViewMountedOnAuthEvent('SIGNED_IN', 'user-a', 'user-a'), true);
  assert.equal(shouldKeepAuthenticatedViewMountedOnAuthEvent('USER_UPDATED', 'user-a', 'user-a'), true);
  assert.equal(shouldKeepAuthenticatedViewMountedOnAuthEvent('SIGNED_IN', null, 'user-a'), false);
  assert.equal(shouldKeepAuthenticatedViewMountedOnAuthEvent('SIGNED_IN', 'user-a', 'user-b'), false);
  assert.equal(shouldKeepAuthenticatedViewMountedOnAuthEvent('SIGNED_OUT', 'user-a', null), false);
});

test('the provider keeps route content mounted during a same-user refresh and retains the last profile on refresh failure', async () => {
  const provider = await readFile(new URL('./AuthProvider.tsx', import.meta.url), 'utf8');
  const protectedRoute = await readFile(new URL('./ProtectedRoute.tsx', import.meta.url), 'utf8');

  assert.match(provider, /if \(!keepAuthenticatedViewMounted\) setLoading\(true\)/);
  assert.match(provider, /restoreProfile\(nextSession, keepAuthenticatedViewMounted\)/);
  assert.match(provider, /if \(active && !keepAuthenticatedViewMounted\) setLoading\(false\)/);
  assert.match(provider, /if \(!options\.preserveExistingOnError\) setProfile\(defaultProfile\)/);
  assert.match(protectedRoute, /if \(loading\)[\s\S]*?if \(!session\)/);
});

test('authorization refetch uses the user identity and keeps prior access while refreshed credentials are checked', async () => {
  const files = await Promise.all([
    readFile(new URL('../lib/rhAccess.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../lib/faltasAtestadosAccess.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../lib/rhMatriculasAccess.tsx', import.meta.url), 'utf8'),
  ]);
  for (const source of files) {
    assert.match(source, /state\?\.userId === userId/);
    assert.match(source, /previous\?\.userId === userId \? previous\.access/);
  }
});

test('route authorization refresh does not replace the current screen with a blocking placeholder', async () => {
  const app = await readFile(new URL('../App.tsx', import.meta.url), 'utf8');
  assert.match(app, /accessCheckPending \? lastAllowedScreen : homeScreen/);
  assert.doesNotMatch(app, /Verificando permissões\.\.\./);
});
