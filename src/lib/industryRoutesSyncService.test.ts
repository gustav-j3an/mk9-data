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
