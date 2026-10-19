import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { RouteItem } from '../types';
import {
  buildRoutePayload,
  canManageFixedRoutes,
  closeFixedRoute,
  createFixedRoute,
  hasAnyScheduledDay,
  isDuplicateActiveRoute,
  updateFixedRouteSchedule,
  type FixedRouteGateway,
  type RouteFormValues
} from './routesService';

const form: RouteFormValues = {
  codigo_rota: '  R-ANA  ',
  industria_codigo: 'IND01',
  loja_codigo: 'LOJA01',
  promotor_matricula: 'ANA01',
  uf: 'SP',
  frequencia: 'QUINZENAL',
  segunda: false,
  terca: true,
  quarta: false,
  quinta: true,
  sexta: false,
  sabado: false,
  domingo: false,
  observacao: '  Conferir exposição  '
};

const route = (overrides: Partial<RouteItem> = {}): RouteItem => ({
  id: 'route-1',
  codigo_rota: 'R-001',
  industria_codigo: 'IND01',
  loja_codigo: 'LOJA01',
  promotor_matricula: 'ANA01',
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

describe('fixed route management', () => {
  it('builds the same weekly/fortnightly route payload used by both creation screens', () => {
    assert.deepEqual(buildRoutePayload(form), {
      codigo_rota: 'R-ANA',
      industria_codigo: 'IND01',
      loja_codigo: 'LOJA01',
      promotor_matricula: 'ANA01',
      uf: 'SP',
      frequencia: 'QUINZENAL',
      segunda: false,
      terca: true,
      quarta: false,
      quinta: true,
      sexta: false,
      sabado: false,
      domingo: false,
      observacao: 'Conferir exposição'
    });
    assert.equal(buildRoutePayload({ ...form, codigo_rota: '' }).codigo_rota, 'ROT-ANA01');
  });

  it('prevents active duplicates but allows a new assignment after logical closure', () => {
    const candidate = {
      promotor_matricula: 'ANA01',
      loja_codigo: 'LOJA01',
      industria_codigo: 'IND01'
    };
    assert.equal(isDuplicateActiveRoute([route()], candidate), true);
    assert.equal(isDuplicateActiveRoute([route({ encerrada_em: '2026-10-18T10:00:00Z' })], candidate), false);
    assert.equal(isDuplicateActiveRoute([route()], { ...candidate, industria_codigo: 'IND02' }), false);
  });

  it('requires at least one service day when creating a route', () => {
    assert.equal(hasAnyScheduledDay(form), true);
    assert.equal(hasAnyScheduledDay({
      segunda: false,
      terca: false,
      quarta: false,
      quinta: false,
      sexta: false,
      sabado: false,
      domingo: false
    }), false);
  });

  it('allows management only for admin and gestor roles', () => {
    assert.equal(canManageFixedRoutes('admin'), true);
    assert.equal(canManageFixedRoutes('gestor'), true);
    assert.equal(canManageFixedRoutes('operador'), false);
    assert.equal(canManageFixedRoutes('promotor'), false);
  });

  it('routes create, edit and logical close through the shared gateway and reports failures', async () => {
    const calls: unknown[][] = [];
    const gateway: FixedRouteGateway = {
      async create(payload) { calls.push(['create', payload]); },
      async updateSchedule(id, schedule) { calls.push(['update', id, schedule]); },
      async close(id, timestamp) { calls.push(['close', id, timestamp]); }
    };

    await createFixedRoute(form, gateway);
    await updateFixedRouteSchedule('route-1', {
      frequencia: 'SEMANAL',
      segunda: true,
      terca: false,
      quarta: false,
      quinta: false,
      sexta: false,
      sabado: false,
      domingo: false,
      observacao: 'Atualizada'
    }, gateway);
    await closeFixedRoute('route-1', gateway, '2026-10-18T12:00:00.000Z');

    assert.equal(calls.length, 3);
    assert.equal(calls[0][0], 'create');
    assert.equal(calls[1][0], 'update');
    assert.deepEqual(calls[2], ['close', 'route-1', '2026-10-18T12:00:00.000Z']);

    const failingGateway: FixedRouteGateway = {
      ...gateway,
      async create() { throw new Error('Falha ao inserir'); },
      async updateSchedule() { throw new Error('Falha ao atualizar'); },
      async close() { throw new Error('Supabase indisponível'); }
    };
    await assert.rejects(createFixedRoute(form, failingGateway), /Falha ao inserir/);
    await assert.rejects(updateFixedRouteSchedule('route-1', {
      frequencia: 'SEMANAL',
      segunda: true,
      terca: false,
      quarta: false,
      quinta: false,
      sexta: false,
      sabado: false,
      domingo: false
    }, failingGateway), /Falha ao atualizar/);
    await assert.rejects(closeFixedRoute('route-1', failingGateway), /Supabase indisponível/);
  });
});
