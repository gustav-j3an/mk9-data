import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PROFILE_RESTORE_TIMEOUT_MS, SESSION_RESTORE_TIMEOUT_MS, settleWithin } from './sessionRestoration';

test('restoration timeouts are finite and bounded', () => {
  assert.ok(SESSION_RESTORE_TIMEOUT_MS > 0 && SESSION_RESTORE_TIMEOUT_MS <= 15_000);
  assert.ok(PROFILE_RESTORE_TIMEOUT_MS > 0 && PROFILE_RESTORE_TIMEOUT_MS <= 15_000);
});

test('a missing session settles normally and stays unauthenticated', async () => {
  const session = await settleWithin(Promise.resolve(null), 20, 'timeout');
  assert.equal(session, null);
});

test('a valid session result is preserved', async () => {
  const session = { user: { id: 'synthetic-user' } };
  assert.equal(await settleWithin(Promise.resolve(session), 20, 'timeout'), session);
});

test('rejected session restoration returns control through the error path', async () => {
  await assert.rejects(settleWithin(Promise.reject(new Error('expired session')), 20, 'timeout'), /expired session/);
});

test('a non-resolving operation rejects within its timeout', async () => {
  const started = Date.now();
  await assert.rejects(settleWithin(new Promise(() => {}), 20, 'auth timed out'), /auth timed out/);
  assert.ok(Date.now() - started < 500);
});

test('login remains available after bounded restoration and private routes still require a session', async () => {
  const { readFile } = await import('node:fs/promises');
  const loginPage = await readFile(new URL('./LoginPage.tsx', import.meta.url), 'utf8');
  const protectedRoute = await readFile(new URL('./ProtectedRoute.tsx', import.meta.url), 'utf8');
  const authProvider = await readFile(new URL('./AuthProvider.tsx', import.meta.url), 'utf8');
  assert.match(loginPage, /if \(loading\)/);
  assert.match(loginPage, /Restaurando sessão/);
  assert.match(protectedRoute, /if \(!session\)/);
  assert.match(protectedRoute, /Navigate to="\/login"/);
  assert.match(authProvider, /SESSION_RESTORE_TIMEOUT_MS/);
  assert.match(authProvider, /PROFILE_RESTORE_TIMEOUT_MS/);
});
