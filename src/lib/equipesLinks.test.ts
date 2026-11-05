import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateTeamsMetrics, normalizeEquipeNome } from './equipesService';
import type { Equipe } from '../types';

test('calculateTeamsMetrics matches promoters by both team name and team code', () => {
  const equipes: Equipe[] = [
    {
      id: 'eq-1',
      codigo: 'M18-EQP',
      nome: 'FICTICIA Equipe A',
      regional: 'SP',
      supervisor_nome: 'FICTICIO Supervisor',
      status: 'ativa'
    },
    {
      id: 'eq-2',
      codigo: 'EQP-002',
      nome: 'EQUIPE BETA',
      regional: 'RJ',
      supervisor_nome: null,
      status: 'ativa'
    }
  ];

  // Promotor 1 está com equipe = 'M18-EQP' (código)
  // Promotor 2 está com equipe = 'FICTICIA Equipe A' (nome)
  // Promotor 3 está com equipe = 'EQUIPE BETA' (nome)
  // Promotor 4 sem equipe
  const promotores = [
    { id: 'p1', matricula: 'M18-P-A', equipe: 'M18-EQP' },
    { id: 'p2', matricula: 'M18-P-B', equipe: 'FICTICIA Equipe A' },
    { id: 'p3', matricula: 'M18-P-C', equipe: 'EQUIPE BETA' },
    { id: 'p4', matricula: 'M18-P-D', equipe: null }
  ];

  const rotas = [
    { promotor_matricula: 'M18-P-A', loja_codigo: 'LOJ-1' },
    { promotor_matricula: 'M18-P-B', loja_codigo: 'LOJ-2' },
    { promotor_matricula: 'M18-P-C', loja_codigo: 'LOJ-3' }
  ];

  const metrics = calculateTeamsMetrics(equipes, promotores, rotas);
  const eqA = metrics.find(e => e.id === 'eq-1');
  const eqB = metrics.find(e => e.id === 'eq-2');

  assert.equal(eqA?.promotoresCount, 2, 'Equipe A deve contar ambos os promotores (por nome e por código)');
  assert.equal(eqA?.pdvsCount, 2, 'Equipe A deve agregar os 2 PDVs distintos');
  assert.equal(eqB?.promotoresCount, 1, 'Equipe B conta 1 promotor');
  assert.equal(eqB?.pdvsCount, 1, 'Equipe B conta 1 PDV');
});

