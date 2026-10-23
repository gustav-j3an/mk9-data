import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('route rows wire view, edit, and logical closure actions to their existing modals', async () => {
  const source = await readFile(new URL('./RoutesView.tsx', import.meta.url), 'utf8');
  assert.match(source, /onClick=\{\(\) => setViewingRoute\(r\)\}/);
  assert.match(source, /onClick=\{\(\) => setEditingRoute\(\{ \.\.\.r \}\)\}/);
  assert.match(source, /onClick=\{\(\) => setClosingRoute\(r\)\}/);
  assert.match(source, /\{viewingRoute && \(/);
  assert.match(source, /\{editingRoute && \(/);
  assert.match(source, /\{closingRoute && closureSupported === true && \(/);
});

test('route details expose stored location, status, and closure date only when available', async () => {
  const source = await readFile(new URL('./RoutesView.tsx', import.meta.url), 'utf8');
  assert.match(source, /Código da loja: \{viewingRoute\.loja_codigo\}/);
  assert.match(source, /viewingRoute\.loja\?\.cidade/);
  assert.match(source, /viewingRoute\.encerrada_em \? 'Encerrada' : 'Ativa'/);
  assert.match(source, /\{viewingRoute\.encerrada_em &&/);
  assert.match(source, /dateTime=\{viewingRoute\.encerrada_em\}/);
});

test('editing validates and persists assignment and schedule fields, then refreshes the existing route list', async () => {
  const source = await readFile(new URL('./RoutesView.tsx', import.meta.url), 'utf8');
  assert.match(source, /validateFixedRouteEdit\(routes, editingRoute\.id, editingRoute\)/);
  for (const field of ['promotor_matricula', 'loja_codigo', 'industria_codigo', 'frequencia', 'segunda', 'domingo']) {
    assert.match(source, new RegExp(`${field}: editingRoute\\.${field}`));
  }
  assert.match(source, /setRoutes\(\(current\) => current\.map\(\(route\) => route\.id === editingRoute\.id/);
  assert.match(source, /await fetchRoutes\(\)/);
  assert.match(source, /disabled=\{Boolean\(r\.encerrada_em\)\}/);
});
