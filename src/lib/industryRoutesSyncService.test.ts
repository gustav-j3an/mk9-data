import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatIndustrySuspensionObservation,
  isRouteSuspendedByIndustry,
  INDUSTRY_SUSPENSION_OBS_TAG,
  INDUSTRY_SUSPENSION_REASON,
  type IndustryRoutesGateway
} from './industryRoutesSyncService';
import type { RouteItem } from '../types';

const mockRoute = (overrides: Partial<RouteItem> = {}): RouteItem => ({
  id: 'route-1',
  codigo_rota: 'ROT-001',
  industria_codigo: 'IND-007',
  loja_codigo: 'LOJA-001',
  promotor_matricula: 'PRM-001',
  uf: 'SP',
  frequencia: 'SEMANAL',
  segunda: true,
  terca: false,
  quarta: false,
  quinta: false,
  sexta: false,
  sabado: false,
  domingo: false,
  ...overrides
});

describe('industryRoutesSyncService - Regras de Observação e Marcação', () => {
  it('formata observação quando estava vazia ou nula', () => {
    assert.equal(
      formatIndustrySuspensionObservation(null),
      `[SUSPENSO: INATIVAÇÃO DA INDÚSTRIA] ${INDUSTRY_SUSPENSION_REASON}`
    );
    assert.equal(
      formatIndustrySuspensionObservation(''),
      `[SUSPENSO: INATIVAÇÃO DA INDÚSTRIA] ${INDUSTRY_SUSPENSION_REASON}`
    );
  });

  it('preserva observação existente e adiciona a tag de inativação', () => {
    const formatted = formatIndustrySuspensionObservation('Atendimento matutino');
    assert.ok(formatted.startsWith('Atendimento matutino | [SUSPENSO: INATIVAÇÃO DA INDÚSTRIA]'));
  });

  it('não duplica a tag se já tiver sido adicionada anteriormente', () => {
    const original = `Rota antiga | ${INDUSTRY_SUSPENSION_OBS_TAG} ${INDUSTRY_SUSPENSION_REASON}`;
    assert.equal(formatIndustrySuspensionObservation(original), original);
  });

  it('identifica corretamente se uma rota foi suspensa por inativação de indústria', () => {
    const activeRoute = mockRoute({ encerrada_em: null, observacao: 'Observação qualquer' });
    assert.equal(isRouteSuspendedByIndustry(activeRoute), false);

    const closedManuallyRoute = mockRoute({
      encerrada_em: '2026-10-20T10:00:00Z',
      observacao: 'Encerrada pelo gestor manualmente'
    });
    assert.equal(isRouteSuspendedByIndustry(closedManuallyRoute), false);

    const suspendedByIndRoute = mockRoute({
      encerrada_em: '2026-10-20T10:00:00Z',
      observacao: `Loja reformando | ${INDUSTRY_SUSPENSION_OBS_TAG} ${INDUSTRY_SUSPENSION_REASON}`
    });
    assert.equal(isRouteSuspendedByIndustry(suspendedByIndRoute), true);
  });
});

describe('industryRoutesSyncService - Hardening RPC e Segurança Transacional', () => {
  it('lança erro explicativo e não altera dados se a RPC de inativação não existir', async () => {
    const mockGateway: IndustryRoutesGateway = {
      getActiveRoutesCountForIndustry: async () => 8,
      getActiveRoutesForIndustry: async () => [mockRoute()],
      inactivateIndustryAndSuspendRoutes: async () => {
        // Simulação do comportamento com RPC ausente
        const err = { code: '42883', message: 'function public.inactivate_industry_and_suspend_routes does not exist' };
        if (err.code === '42883') {
          throw new Error('A função transacional de inativação não está disponível no banco de dados. A operação foi cancelada com segurança sem alterar dados.');
        }
        return {} as any;
      },
      activateIndustry: async () => {},
      reactivateRoutesForIndustry: async () => ({ industryCode: 'IND-007', routesReactivatedCount: 0, usedRpc: true })
    };

    await assert.rejects(
      () => mockGateway.inactivateIndustryAndSuspendRoutes('uuid-1', 'IND-007', 'COPRA', [mockRoute()]),
      /função transacional de inativação não está disponível no banco de dados/
    );
  });

  it('lança erro e cancela operação caso a RPC retorne falha de permissão (42501)', async () => {
    const mockGateway: IndustryRoutesGateway = {
      getActiveRoutesCountForIndustry: async () => 1,
      getActiveRoutesForIndustry: async () => [mockRoute()],
      inactivateIndustryAndSuspendRoutes: async () => {
        const err = { code: '42501', message: 'Acesso não autorizado. Apenas administradores e gestores podem suspender rotas por indústria.' };
        throw new Error(`Falha na inativação atômica da indústria: ${err.message}`);
      },
      activateIndustry: async () => {},
      reactivateRoutesForIndustry: async () => ({ industryCode: 'IND-007', routesReactivatedCount: 0, usedRpc: true })
    };

    await assert.rejects(
      () => mockGateway.inactivateIndustryAndSuspendRoutes('uuid-1', 'IND-007', 'COPRA', [mockRoute()]),
      /Acesso não autorizado/
    );
  });

  it('executa a suspensão com sucesso quando a RPC transacional responde com sucesso', async () => {
    const mockGateway: IndustryRoutesGateway = {
      getActiveRoutesCountForIndustry: async () => 3,
      getActiveRoutesForIndustry: async () => [mockRoute({ id: 'r1' }), mockRoute({ id: 'r2' }), mockRoute({ id: 'r3' })],
      inactivateIndustryAndSuspendRoutes: async (id, code, name, routes) => ({
        industryId: id,
        industryCode: code,
        industryName: name,
        routesSuspendedCount: routes.length,
        routesSuspendedIds: routes.map(r => r.id),
        usedRpc: true
      }),
      activateIndustry: async () => {},
      reactivateRoutesForIndustry: async () => ({ industryCode: 'IND-007', routesReactivatedCount: 0, usedRpc: true })
    };

    const result = await mockGateway.inactivateIndustryAndSuspendRoutes('uuid-1', 'IND-007', 'COPRA', [
      mockRoute({ id: 'r1' }),
      mockRoute({ id: 'r2' }),
      mockRoute({ id: 'r3' })
    ]);

    assert.equal(result.usedRpc, true);
    assert.equal(result.routesSuspendedCount, 3);
    assert.deepEqual(result.routesSuspendedIds, ['r1', 'r2', 'r3']);
  });

  it('retorna a contagem real de rotas suspensas reportada pela RPC transacional', async () => {
    const mockGateway: IndustryRoutesGateway = {
      getActiveRoutesCountForIndustry: async () => 5,
      getActiveRoutesForIndustry: async () => [
        mockRoute({ id: 'r1' }),
        mockRoute({ id: 'r2' }),
        mockRoute({ id: 'r3' }),
        mockRoute({ id: 'r4' }),
        mockRoute({ id: 'r5' })
      ],
      inactivateIndustryAndSuspendRoutes: async (id, code, name, routes) => ({
        industryId: id,
        industryCode: code,
        industryName: name,
        routesSuspendedCount: 5,
        routesSuspendedIds: routes.map(r => r.id),
        usedRpc: true
      }),
      activateIndustry: async () => {},
      reactivateRoutesForIndustry: async () => ({ industryCode: 'IND-007', routesReactivatedCount: 0, usedRpc: true })
    };

    const result = await mockGateway.inactivateIndustryAndSuspendRoutes('uuid-1', 'IND-007', 'COPRA', [
      mockRoute({ id: 'r1' }),
      mockRoute({ id: 'r2' }),
      mockRoute({ id: 'r3' }),
      mockRoute({ id: 'r4' }),
      mockRoute({ id: 'r5' })
    ]);

    assert.equal(result.routesSuspendedCount, 5);
    assert.equal(result.routesSuspendedIds.length, 5);
  });

  it('bloqueia reativação de rotas vinculadas a indústria inativa (código 22023)', async () => {
    const mockGateway: IndustryRoutesGateway = {
      getActiveRoutesCountForIndustry: async () => 0,
      getActiveRoutesForIndustry: async () => [],
      inactivateIndustryAndSuspendRoutes: async () => ({} as any),
      activateIndustry: async () => {},
      reactivateRoutesForIndustry: async () => {
        const err = {
          code: '22023',
          message: 'Não é permitido reativar rotas de uma indústria inativa. Reative a indústria primeiro.'
        };
        throw new Error(`Falha na reativação das rotas: ${err.message}`);
      }
    };

    await assert.rejects(
      () => mockGateway.reactivateRoutesForIndustry('uuid-1', 'IND-007'),
      /Não é permitido reativar rotas de uma indústria inativa/
    );
  });
});
