import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseOperationalDashboardQuery, updateOperationalDashboardQuery } from './operationalDashboardQuery';

describe('operationalDashboardQuery', () => {
  it('faz parse seguro de parâmetros e sub-abas da URL', () => {
    const params = new URLSearchParams('periodo=week&aba_central=pendencias&aba_ocorrencias=validades&industria=IND01&promotor=P123&loja=L456&ruptura_status=todas&validade_status=vencidos&agenda_status=em_andamento&alerta_prioridade=critico&pendencia_status=todas');
    const parsed = parseOperationalDashboardQuery(params);

    assert.equal(parsed.period, 'week');
    assert.equal(parsed.centralTab, 'pendencias');
    assert.equal(parsed.ocorrenciasTab, 'validades');
    assert.equal(parsed.industry, 'IND01');
    assert.equal(parsed.promoter, 'P123');
    assert.equal(parsed.store, 'L456');
    assert.equal(parsed.ruptureStatus, 'todas');
    assert.equal(parsed.validityStatus, 'vencidos');
    assert.equal(parsed.agendaStatus, 'em_andamento');
    assert.equal(parsed.alertPriority, 'critico');
    assert.equal(parsed.pendenciaStatus, 'todas');
  });

  it('ignora valores inválidos para enums restritos', () => {
    const params = new URLSearchParams('periodo=invalid&aba_central=invalid&aba_ocorrencias=invalid');
    const parsed = parseOperationalDashboardQuery(params);

    assert.equal(parsed.period, undefined);
    assert.equal(parsed.centralTab, undefined);
    assert.equal(parsed.ocorrenciasTab, undefined);
  });

  it('atualiza parâmetros sem expor segredos ou tokens', () => {
    const current = new URLSearchParams('password=123456&secret=abc');
    const updated = updateOperationalDashboardQuery(current, {
      period: 'month',
      centralTab: 'promotores',
      ocorrenciasTab: 'incidentes',
      industry: 'IND02',
      promoter: 'MAT01',
      store: 'LOJA01',
      ruptureStatus: 'todas',
      validityStatus: 'ate3',
      agendaStatus: 'concluida',
      alertPriority: 'critico',
      pendenciaStatus: 'nao_realizada'
    });

    assert.equal(updated.get('password'), null);
    assert.equal(updated.get('secret'), null);
    assert.equal(updated.get('periodo'), 'month');
    assert.equal(updated.get('aba_central'), 'promotores');
    assert.equal(updated.get('aba_ocorrencias'), 'incidentes');
    assert.equal(updated.get('industria'), 'IND02');
  });

  it('remove parâmetros quando voltam para o default', () => {
    const current = new URLSearchParams('periodo=week&aba_central=pendencias');
    const updated = updateOperationalDashboardQuery(current, {
      period: 'today',
      centralTab: 'alertas',
      ocorrenciasTab: 'rupturas',
      industry: 'all',
      promoter: 'all',
      store: 'all',
      ruptureStatus: 'abertas',
      validityStatus: 'all',
      agendaStatus: 'all',
      alertPriority: 'active',
      pendenciaStatus: 'pendente'
    });

    assert.equal(updated.get('periodo'), null);
    assert.equal(updated.get('aba_central'), null);
    assert.equal(updated.get('aba_ocorrencias'), null);
    assert.equal(updated.get('industria'), null);
  });
});
