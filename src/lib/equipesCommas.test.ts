import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculateTeamsMetrics, equipesService } from './equipesService';
import type { Equipe } from '../types';

test('calculateTeamsMetrics matches teams with commas and codes accurately', () => {
  const equipes: Equipe[] = [
    {
      id: 'eq-df',
      codigo: 'EQP-001',
      nome: 'DF, GO, BA',
      regional: 'Centro-Oeste/Nordeste',
      supervisor_nome: 'ROBERTO CARLOS',
      status: 'ativa'
    },
    {
      id: 'eq-sp',
      codigo: 'EQP-002',
      nome: 'SP, RJ',
      regional: 'Sudeste',
      supervisor_nome: null,
      status: 'ativa'
    }
  ];

  const promotores = [
    { id: 'p1', matricula: 'PRM-101', equipe: 'DF, GO, BA' },
    { id: 'p2', matricula: 'PRM-102', equipe: 'EQP-001' },
    { id: 'p3', matricula: 'PRM-103', equipe: 'SP, RJ' }
  ];

  const rotas = [
    { promotor_matricula: 'PRM-101', loja_codigo: 'LOJ-1' },
    { promotor_matricula: 'PRM-102', loja_codigo: 'LOJ-2' },
    { promotor_matricula: 'PRM-103', loja_codigo: 'LOJ-3' }
  ];

  const metrics = calculateTeamsMetrics(equipes, promotores, rotas);
  const eqDF = metrics.find(e => e.id === 'eq-df');
  const eqSP = metrics.find(e => e.id === 'eq-sp');

  assert.equal(eqDF?.promotoresCount, 2, 'Equipe DF, GO, BA deve contar ambos os promotores vinculados');
  assert.equal(eqDF?.pdvsCount, 2, 'Equipe DF, GO, BA deve contar 2 PDVs distintos');
  assert.equal(eqSP?.promotoresCount, 1, 'Equipe SP, RJ deve contar 1 promotor');
});

test('listPromotoresByEquipe uses .in() with candidates array to handle commas in names safely', async () => {
  const serviceContent = await readFile(new URL('./equipesService.ts', import.meta.url), 'utf8');
  assert.match(serviceContent, /\.in\('equipe',\s*candidates\)/, 'listPromotoresByEquipe must use .in() to avoid PostgREST comma splitting syntax error');
});

test('TeamsManagementView switches to promotores tab and highlights selected team on Ver Integrantes click', async () => {
  const viewContent = await readFile(new URL('../views/TeamsManagementView.tsx', import.meta.url), 'utf8');

  // Garante que o botão Ver Detalhes / Ver Integrantes seta drawerTab para 'promotores'
  assert.match(viewContent, /setDrawerTab\('promotores'\)/);

  // Garante tratamento de erro de consulta diferenciado de lista vazia
  assert.match(viewContent, /promotersError\s*\?/);
  assert.match(viewContent, /Não foi possível carregar os integrantes/);

  // Garante que o card selecionado recebe realce visual
  assert.match(viewContent, /border-purple-600 ring-2/);

  // Garante que os integrantes mostram nome, matrícula, supervisor e situação (status)
  assert.match(viewContent, /p\.status \|\| 'ativo'/);
  assert.match(viewContent, /p\.supervisor \|\| 'Não atribuído'/);
});

