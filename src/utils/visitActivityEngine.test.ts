import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePromoterActivity, isRouteScheduledForDate } from './visitActivityEngine';
import type { RouteItem, Visit } from '../types';

const mockRoute = (overrides: Partial<RouteItem> = {}): RouteItem => ({
  id: 'r-1',
  codigo_rota: 'ROTA-01',
  promotor_matricula: 'P001',
  loja_codigo: 'L001',
  industria_codigo: 'IND01',
  frequencia: 'SEMANAL',
  segunda: true,
  terca: false,
  quarta: false,
  quinta: false,
  sexta: false,
  sabado: false,
  domingo: false,
  uf: null,
  ...overrides
});

const mockVisit = (overrides: Partial<Visit> = {}): Visit => ({
  id: 'v-1',
  promotor_matricula: 'P001',
  loja_codigo: 'L001',
  industria_codigo: 'IND01',
  data_visita: '2026-10-19', // Segunda-feira
  status: 'concluida',
  started_at: '2026-10-19T11:00:00Z',
  completed_at: '2026-10-19T12:30:00Z',
  ...overrides
});

test('Regra 1: Uma visita concluída válida gera presença confirmada', () => {
  const v = mockVisit();
  const res = computePromoterActivity('P001', '2026-10-19', [v], [mockRoute()]);
  assert.equal(res.status, 'confirmada');
  assert.equal(res.totalConcluidas, 1);
  assert.equal(res.primeiraAtividade, '08:00'); // UTC 11:00 em America/Sao_Paulo (-3)
  assert.equal(res.ultimaAtividade, '09:30'); // UTC 12:30 em America/Sao_Paulo (-3)
  assert.match(res.origemEvidencia, /1 visita\(s\) concluída\(s\)/);
});

test('Regra 2: Visita apenas iniciada gera em_atividade (não confirmada definitivamente)', () => {
  const v = mockVisit({ status: 'em_andamento', completed_at: null });
  const res = computePromoterActivity('P001', '2026-10-19', [v], [mockRoute()]);
  assert.equal(res.status, 'em_atividade');
  assert.equal(res.totalConcluidas, 0);
  assert.equal(res.totalIniciadas, 1);
  assert.match(res.origemEvidencia, /aguardando conclusão/);
});

test('Regra 3: Sem visitas gera sem_evidencia sem gerar falta', () => {
  const res = computePromoterActivity('P001', '2026-10-19', [], [mockRoute()]);
  assert.equal(res.status, 'sem_evidencia');
  assert.equal(res.totalConcluidas, 0);
  assert.equal(res.totalIniciadas, 0);
  assert.equal(res.totalProgramadas, 1);
  assert.match(res.origemEvidencia, /sem início reportado/);
});

test('Regra 4: Múltiplas visitas no mesmo dia confirmam apenas uma presença e totalizam todas', () => {
  const v1 = mockVisit({ id: 'v-1', started_at: '2026-10-19T11:00:00Z', completed_at: '2026-10-19T12:00:00Z' });
  const v2 = mockVisit({ id: 'v-2', loja_codigo: 'L002', started_at: '2026-10-19T13:00:00Z', completed_at: '2026-10-19T15:00:00Z' });
  const v3 = mockVisit({ id: 'v-3', loja_codigo: 'L003', started_at: '2026-10-19T16:00:00Z', completed_at: '2026-10-19T17:30:00Z' });

  const res = computePromoterActivity('P001', '2026-10-19', [v1, v2, v3], [mockRoute(), mockRoute({ id: 'r-2', loja_codigo: 'L002' })]);
  assert.equal(res.status, 'confirmada');
  assert.equal(res.totalConcluidas, 3);
  assert.equal(res.primeiraAtividade, '08:00'); // Primeiro atendimento do dia
  assert.equal(res.ultimaAtividade, '14:30'); // Conclusão do último atendimento (17:30 UTC -> 14:30 BRT)
});

test('Regra de Segurança: Visitas de outro promotor são estritamente isoladas', () => {
  const vOutro = mockVisit({ promotor_matricula: 'OUTRO_999' });
  const res = computePromoterActivity('P001', '2026-10-19', [vOutro], []);
  assert.equal(res.status, 'sem_evidencia');
  assert.equal(res.totalConcluidas, 0);
});

test('Regra de Segurança: Visitas canceladas (nao_realizada) não confirmam presença', () => {
  const vCancelada = mockVisit({ status: 'nao_realizada', started_at: null, completed_at: null });
  const res = computePromoterActivity('P001', '2026-10-19', [vCancelada], [mockRoute()]);
  assert.equal(res.status, 'sem_evidencia');
  assert.equal(res.totalConcluidas, 0);
});

test('Regra de Segurança: Rota com soft-delete (encerrada_em) não conta como programada', () => {
  const rotaEncerrada = mockRoute({ encerrada_em: '2026-10-18T10:00:00Z' });
  assert.equal(isRouteScheduledForDate(rotaEncerrada, '2026-10-19'), false);
});
