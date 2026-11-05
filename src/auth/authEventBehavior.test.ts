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

test('sign-in, sign-out, and profile events keep the normal auth transition behavior', () => {
  assert.equal(shouldKeepAuthenticatedViewMountedOnAuthEvent('SIGNED_IN', 'user-a', 'user-a'), false);
  assert.equal(shouldKeepAuthenticatedViewMountedOnAuthEvent('SIGNED_OUT', 'user-a', null), false);
  assert.equal(shouldKeepAuthenticatedViewMountedOnAuthEvent('USER_UPDATED', 'user-a', 'user-a'), false);
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
