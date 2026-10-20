import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Criar diretório de evidências
const evidenceDir = 'scratch/mk9-browser-homologation';
await mkdir(evidenceDir, { recursive: true });

// 1. Iniciar Vite localmente se não estiver rodando
console.log('Conectando ao Vite local na porta 3000...');

// 2. Importar Playwright via cache localizado
const playwrightPath = 'file:///C:/Users/Gustavo%20MK9/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';
const { chromium } = await import(playwrightPath);

console.log('Iniciando Chromium local para testes reais...');
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true
});

const context = await browser.newContext({
  viewport: { width: 1440, height: 900 }
});

const page = await context.newPage();
const consoleErrors = [];
page.on('console', msg => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', err => consoleErrors.push(err.message));

// Mock da camada de auth e service do Supabase no navegador para simular Admin com 44 promotores reais e 0 jornadas
await page.route(url => url.pathname.includes('attendanceService'), route => {
  route.fulfill({
    contentType: 'application/javascript',
    body: `
      export const fetchAttendance = async (date) => {
        // Gerar 44 promotores exatamente como no banco real
        const promoters = Array.from({ length: 44 }, (_, i) => ({
          id: 'p-' + (i + 1),
          matricula: 'PRM-' + String(i + 1).padStart(3, '0'),
          nome: i === 0 ? 'FABIO CAMARGO DOS SANTOS' : i === 1 ? 'KAYQUE DE JESUS OLIVEIRA' : 'PROMOTOR OPERACIONAL ' + (i + 1),
          equipe: i % 2 === 0 ? 'Equipe Capital' : 'Equipe Interior',
          supervisor: i % 2 === 0 ? 'Supervisora Ana' : 'Supervisor Carlos',
          cidade: i % 2 === 0 ? 'São Paulo' : 'Campinas',
          uf: 'SP',
          telefone: '119999900' + String(i).padStart(2, '0'),
          status: 'ativo'
        }));

        // Itens de presença: 44 promotores sem jornada (sem_expediente, eligible: false)
        const items = promoters.map(p => ({
          id: p.id,
          promoterId: p.id,
          name: p.nome,
          initials: p.nome.split(' ').map(n => n[0]).slice(0, 2).join(''),
          matricula: p.matricula,
          squad: p.equipe,
          supervisor: p.supervisor,
          city: p.cidade,
          state: p.uf,
          phone: p.telefone,
          status: 'sem_registro',
          operationalStatus: 'sem_expediente',
          eligible: false,
          medicalStatus: null,
          scheduleDetail: 'Jornada não cadastrada',
          checkInAt: null,
          telemetryTime: '--:--',
          telemetryDetail: 'Sem jornada cadastrada para a data'
        }));

        return {
          items,
          promoters,
          warnings: ['44 promotor(es) sem jornada cadastrada nesta data, fora dos indicadores. Programação de visitas não substitui jornada.'],
          canEdit: true,
          timezone: 'America/Sao_Paulo',
          fetchedAt: new Date().toISOString()
        };
      };

      export const saveAttendance = async () => ({ success: true });
      export const fetchAttendanceAudit = async () => [];
      export const attendanceErrorMessage = (err) => err?.message || 'Erro';
      export const resolveCrmAttendance = async () => null;
    `
  });
});

const report = [];

try {
  console.log('Acessando http://127.0.0.1:3000/tests/fixtures/mk9-attendance.html...');
  await page.goto('http://127.0.0.1:3000/tests/fixtures/mk9-attendance.html', { waitUntil: 'networkidle' });

  // 1. Validar HUD Superior
  console.log('1. Validando HUD superior...');
  await page.waitForSelector('text=Controle de Presença');
  await page.waitForSelector('text=44 promotores cadastrados');
  await page.waitForSelector('text=0 com jornada • 44 sem expediente');
  await page.waitForSelector('text=0 elegíveis nos filtros');
  
  await page.screenshot({ path: `${evidenceDir}/01-hud-e-empty-state-desktop.png`, fullPage: true });
  report.push({ step: '1. HUD e Indicadores Iniciais', status: 'PASS', screenshot: `${evidenceDir}/01-hud-e-empty-state-desktop.png` });

  // 2. Clicar no botão [Ver promotores sem expediente (44)]
  console.log('2. Testando botão de ação do empty state...');
  const btnVerSemExpediente = page.locator('button:has-text("Ver promotores sem expediente (44)")');
  await btnVerSemExpediente.click();
  await page.waitForTimeout(500);

  // Confirmar que a tabela abriu com os 44 promotores
  const rowsCount = await page.locator('tbody tr').count();
  assert.equal(rowsCount, 44, `Esperado 44 linhas na tabela, encontrado ${rowsCount}`);
  await page.screenshot({ path: `${evidenceDir}/02-tabela-44-promotores-sem-expediente.png`, fullPage: true });
  report.push({ step: '2. Listagem dos 44 Promotores sem Expediente', status: 'PASS', totalExibido: rowsCount, screenshot: `${evidenceDir}/02-tabela-44-promotores-sem-expediente.png` });

  // 3. Testar busca por nome
  console.log('3. Testando busca textual...');
  const searchInput = page.locator('input[placeholder*="Buscar promotor"]');
  await searchInput.fill('FABIO');
  await page.waitForTimeout(300);
  const rowsFabio = await page.locator('tbody tr').count();
  assert.equal(rowsFabio, 1, `Esperado 1 promotor com busca FABIO, encontrado ${rowsFabio}`);
  await page.screenshot({ path: `${evidenceDir}/03-busca-promotor-fabio.png` });
  report.push({ step: '3. Busca Textual por Promotor', status: 'PASS', resultado: '1 promotor encontrado', screenshot: `${evidenceDir}/03-busca-promotor-fabio.png` });

  // Limpar busca
  await page.locator('button:has-text("✕")').click();
  await page.waitForTimeout(300);

  // 4. Testar filtro por Supervisor
  console.log('4. Testando filtro de supervisor...');
  const supervisorSelect = page.locator('select[aria-label="Filtrar por supervisor"]');
  await supervisorSelect.selectOption('Supervisora Ana');
  await page.waitForTimeout(300);
  const rowsAna = await page.locator('tbody tr').count();
  assert.equal(rowsAna, 22, `Esperado 22 promotores para Supervisora Ana, encontrado ${rowsAna}`);
  await page.screenshot({ path: `${evidenceDir}/04-filtro-supervisor-ana.png` });
  report.push({ step: '4. Filtro por Supervisor', status: 'PASS', totalSupervisoraAna: rowsAna, screenshot: `${evidenceDir}/04-filtro-supervisor-ana.png` });

  // Resetar supervisor
  await supervisorSelect.selectOption('');
  await page.waitForTimeout(300);

  // 5. Abrir painel de Jornadas e Modelos
  console.log('5. Testando painel de Jornadas, Modelos e Calendário...');
  const detailsPanel = page.locator('summary:has-text("Jornadas, modelos e calendário")');
  await detailsPanel.click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${evidenceDir}/05-painel-jornadas-aberto.png` });
  report.push({ step: '5. Abertura do Painel de Jornadas', status: 'PASS', screenshot: `${evidenceDir}/05-painel-jornadas-aberto.png` });

  // 6. Testar Responsividade Mobile (360x780)
  console.log('6. Testando visualização mobile...');
  await page.setViewportSize({ width: 360, height: 780 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${evidenceDir}/06-visualizacao-mobile-360px.png`, fullPage: true });
  report.push({ step: '6. Responsividade Mobile (360px)', status: 'PASS', screenshot: `${evidenceDir}/06-visualizacao-mobile-360px.png` });

  // Salvar relatório
  await writeFile(`${evidenceDir}/relatorio_execucao_browser.json`, JSON.stringify({ report, consoleErrors }, null, 2));
  console.log('SUCESSO NO TESTE REAL DE NAVEGADOR! Resultados em:', `${evidenceDir}/relatorio_execucao_browser.json`);

} catch (err) {
  console.error('ERRO NO TESTE DE NAVEGADOR:', err);
  console.error('CONSOLE ERRORS DO NAVEGADOR:', consoleErrors);
  await page.screenshot({ path: `${evidenceDir}/erro-execucao.png` });
  throw err;
} finally {
  await browser.close();
}
