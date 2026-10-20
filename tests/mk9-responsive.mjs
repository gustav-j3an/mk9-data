import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const base = process.env.QA_BASE_URL || 'http://127.0.0.1:3001';
const directory = 'scratch/mk9-responsive';
await mkdir(directory, { recursive: true });
const evidence = [];
try {
  for (const role of ['promotor', 'gestor', 'admin']) {
    const page = await browser.newPage();
    const failures = [];
    page.on('pageerror', e => failures.push(e.message));
    await page.route('**/src/auth/AuthProvider.tsx', route => route.fulfill({ contentType: 'application/javascript', body: `export const useAuth = () => ({ role: ${JSON.stringify(role)}, session: { access_token: 'fictitious-qa-token' } });` }));
    let state = 'success';
    let calls = 0;
    await page.route('**/api/rh/**', async route => {
      calls++;
      if (state === 'error') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Temporariamente indisponível' }) });
      const data = state === 'empty' ? [] : [{ protocolo: 'ABC-2026-000123', matricula: '1234', nome: 'Ana Silva de Souza', projeto: 'COMPARTILHADO GO', supervisor: 'João Supervisor', tipo: 'Atestado', inicio: '2026-10-05', fim: '2026-10-06', retorno: '2026-10-07', dias: 2, status: 'Processado' }, { protocolo: 'ABC-2026-000124', matricula: '1234', nome: 'Ana Silva de Souza', projeto: 'COMPARTILHADO GO', supervisor: 'João Supervisor', tipo: 'Falta', inicio: '2026-10-18', fim: '2026-10-18', retorno: null, dias: 1, status: 'Em análise' }];
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data, projects: [{ nome: 'COMPARTILHADO GO', activePromoters: 24 }], activePromoters: 24, updatedAt: '2026-10-19T12:00:00Z' }) });
    });
    for (const width of [360, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${base}/tests/fixtures/mk9-rh.html`);
      await page.getByText('Protocolo: ABC-2026-000123', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${role} ${width}: horizontal overflow`);
      assert.equal(await page.getByText('Minhas Ausências', { exact: true }).count(), role === 'promotor' ? 1 : 0);
      if (role !== 'promotor') {
        await page.getByRole('button', { name: 'Ana Silva de Souza · 1234', exact: true }).first().click();
        await page.getByRole('heading', { name: /Histórico:/ }).waitFor();
      } else assert.equal(await page.getByText('Ana Silva de Souza', { exact: true }).count(), 0);
      const screenshot = `${directory}/${role}-${width}.png`;
      await page.screenshot({ path: screenshot, fullPage: true });
      evidence.push({ role, width, state: 'success', horizontalOverflow: false, screenshot });
    }
    state = 'error';
    await page.reload();
    await page.getByRole('alert').waitFor();
    const before = calls;
    state = 'empty';
    await page.getByRole('button', { name: 'Tentar novamente' }).click();
    await page.getByRole('heading', { name: 'Nenhuma ocorrência encontrada' }).waitFor();
    assert.ok(calls > before);
    assert.equal(failures.length, 0, failures.join('\n'));
    evidence.push({ role, error: 'passed', retry: 'passed', empty: 'passed', pageErrors: failures });
    await page.close();
  }
  await writeFile(`${directory}/results.json`, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally { await browser.close(); }
