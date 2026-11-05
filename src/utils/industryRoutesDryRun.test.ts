import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isRouteSuspendedByIndustry,
  formatIndustrySuspensionObservation,
  INDUSTRY_SUSPENSION_OBS_TAG,
  INDUSTRY_SUSPENSION_REASON
} from '../lib/industryRoutesSyncService';
import type { RouteItem } from '../types';

export interface DryRunIndustryRouteSyncResult {
  industryId: string;
  industryCode: string;
  industryName: string;
  industryStatus: string;
  totalRoutesInDatabase: number;
  activeRoutesCount: number;
  previouslyClosedRoutesCount: number;
  routesToSuspend: {
    id: string;
    codigo_rota: string;
    promotor_matricula: string;
    loja_codigo: string;
    simulatedObservacao: string;
  }[];
}

export const simulateIndustryInactivation = (
  industry: { id: string; codigo: string; nome: string; status: string },
  routes: RouteItem[]
): DryRunIndustryRouteSyncResult => {
  const industryRoutes = routes.filter((r) => r.industria_codigo === industry.codigo);
  const activeRoutes = industryRoutes.filter((r) => !r.encerrada_em);
  const previouslyClosed = industryRoutes.filter((r) => !!r.encerrada_em);

  const routesToSuspend = activeRoutes.map((r) => ({
    id: r.id,
    codigo_rota: r.codigo_rota,
    promotor_matricula: r.promotor_matricula,
    loja_codigo: r.loja_codigo,
    simulatedObservacao: formatIndustrySuspensionObservation(r.observacao)
  }));

  return {
    industryId: industry.id,
    industryCode: industry.codigo,
    industryName: industry.nome,
    industryStatus: industry.status,
    totalRoutesInDatabase: industryRoutes.length,
    activeRoutesCount: activeRoutes.length,
    previouslyClosedRoutesCount: previouslyClosed.length,
    routesToSuspend
  };
};

describe('Dry-run / Diagnóstico Idempotente de Indústrias Inativas', () => {
  const mockCopraRoutes: RouteItem[] = [
    {
      id: 'rot-1',
      codigo_rota: 'ROT-001',
      industria_codigo: 'IND-007',
      loja_codigo: 'LOJA-A',
      promotor_matricula: 'PRM-01',
      uf: 'SP',
      frequencia: 'SEMANAL',
      segunda: true,
      terca: false,
      quarta: false,
      quinta: false,
      sexta: false,
      sabado: false,
      domingo: false,
      encerrada_em: null
    },
    {
      id: 'rot-2',
      codigo_rota: 'ROT-002',
      industria_codigo: 'IND-007',
      loja_codigo: 'LOJA-B',
      promotor_matricula: 'PRM-02',
      uf: 'SP',
      frequencia: 'SEMANAL',
      segunda: false,
      terca: true,
      quarta: false,
      quinta: false,
      sexta: false,
      sabado: false,
      domingo: false,
      encerrada_em: null
    },
    {
      id: 'rot-3',
      codigo_rota: 'ROT-003',
      industria_codigo: 'IND-007',
      loja_codigo: 'LOJA-C',
      promotor_matricula: 'PRM-03',
      uf: 'SP',
      frequencia: 'QUINZENAL',
      segunda: false,
      terca: false,
      quarta: true,
      quinta: false,
      sexta: false,
      sabado: false,
      domingo: false,
      encerrada_em: '2026-10-10T12:00:00Z',
      observacao: 'Encerrada antigamente'
    },
    {
      id: 'rot-other',
      codigo_rota: 'ROT-OTHER',
      industria_codigo: 'IND-999',
      loja_codigo: 'LOJA-X',
      promotor_matricula: 'PRM-99',
      uf: 'SP',
      frequencia: 'SEMANAL',
      segunda: true,
      terca: false,
      quarta: false,
      quinta: false,
      sexta: false,
      sabado: false,
      domingo: false,
      encerrada_em: null
    }
  ];

  it('audita e simula com exatidão a suspensão apenas de rotas ativas da indústria especificada', () => {
    const copra = { id: 'copra-uuid', codigo: 'IND-007', nome: 'COPRA ALIMENTOS', status: 'inativo' };
    const simulation = simulateIndustryInactivation(copra, mockCopraRoutes);

    assert.equal(simulation.industryCode, 'IND-007');
    assert.equal(simulation.totalRoutesInDatabase, 3);
    assert.equal(simulation.activeRoutesCount, 2);
    assert.equal(simulation.previouslyClosedRoutesCount, 1);
    assert.equal(simulation.routesToSuspend.length, 2);
    assert.deepEqual(
      simulation.routesToSuspend.map((r) => r.id),
      ['rot-1', 'rot-2']
    );

    // Não afeta IND-999
    assert.ok(!simulation.routesToSuspend.some((r) => r.id === 'rot-other'));

    // Observação recebe tag
    assert.ok(
      simulation.routesToSuspend[0].simulatedObservacao.includes(INDUSTRY_SUSPENSION_OBS_TAG)
    );
  });

  it('é idempotente: executar simulação repetidas vezes não duplica nem altera o resultado', () => {
    const copra = { id: 'copra-uuid', codigo: 'IND-007', nome: 'COPRA ALIMENTOS', status: 'inativo' };
    const run1 = simulateIndustryInactivation(copra, mockCopraRoutes);
    const run2 = simulateIndustryInactivation(copra, mockCopraRoutes);
    assert.deepEqual(run1, run2);
  });
});
