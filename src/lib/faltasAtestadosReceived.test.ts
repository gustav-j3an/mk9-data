import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CrmBinding } from './faltasAtestados';
import { filterAbsenceHistory, parseAbsenceHistory } from './faltasAtestadosReceived';

const projectA = '65f7e80f-f615-4ceb-9b8d-80db170735dc';
const projectB = '89bccfec-5f8e-4925-8702-6af0d984d5bf';
const binding = (project = projectA, external = 'CRM-42', local = 'PRM-1', state = 'aprovado'): CrmBinding => ({
  promotor_id: '30000000-0000-0000-0000-000000000101', matricula_interna: local, colaborador: 'Pessoa Sintética', equipe: '', supervisor: '', cidade: '', uf: '',
  identidade_status: state, alocacao_id: `30000000-0000-0000-0000-${project === projectA ? '000000000001' : '000000000002'}`,
  projeto_crm: project, matricula_externa: external, alocacao_status: state, ocorrencias_desde: '2026-01-01', ocorrencias_ate: null,
  valido_desde: '2026-01-01T00:00:00.000Z', valido_ate: null
});
const item = (project = projectA, external = 'CRM-42', id = 'record-1', extra: Record<string, unknown> = {}) => ({
  externalIdentity: { recordId: id, projectId: project, matricula: external }, protocolo: `PROTO-${id}`, matricula: 'PRM-1', nome: 'Pessoa Sintética', projeto: 'Projeto sem nome autoritativo', supervisor: '',
  tipo: 'Falta', inicio: '2026-10-10', fim: '2026-10-10', retorno: null, dias: 1, status: 'Em análise', ...extra
});
const response = (data: unknown[]) => ({ data, projects: [], updatedAt: '2026-10-20T12:00:00.000Z', activePromoters: 1 });

test('normalizes a valid external API result into a display projection without medical fields', () => {
  const parsed = parseAbsenceHistory(response([item()]), [binding()], new Date('2026-10-20T12:00:00.000Z'));
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].externalRecordId, 'record-1');
  assert.equal(parsed.records[0].projectId, projectA);
  assert.equal(parsed.display[0].collaborator, 'Pessoa Sintética');
  assert.ok(!JSON.stringify(parsed).match(/CID|documento|diagnóstico/i));
});

test('rejects incomplete and malformed responses instead of manufacturing data', () => {
  assert.throws(() => parseAbsenceHistory({ data: [{}], updatedAt: 'bad' }, [binding()]));
  assert.throws(() => parseAbsenceHistory(response([item(projectA, 'CRM-42', 'record-2', { inicio: '2026-02-30' })]), [binding()]));
});

test('returns a genuine empty state when the authorized API response contains no records', () => {
  const parsed = parseAbsenceHistory(response([]), [binding()], new Date('2026-10-20T12:00:00.000Z'));
  assert.deepEqual(parsed.records, []);
  assert.deepEqual(parsed.display, []);
  assert.equal(parsed.unmatchedCount, 0);
});

test('preserves protocol separately when the external API omits its record ID', () => {
  const row = item();
  row.externalIdentity.recordId = null as unknown as string;
  const parsed = parseAbsenceHistory(response([row]), [binding()], new Date('2026-10-20T12:00:00.000Z'));
  assert.equal(parsed.records[0].externalRecordId, null);
  assert.equal(parsed.records[0].externalProtocol, 'PROTO-record-1');
  assert.ok(parsed.display[0].key.includes('PROTO-record-1'));
});

test('filters by period, exact CRM project, absence type, and either real or internal matricula', () => {
  const bindings = [binding(), binding(projectB, 'CRM-77', 'PRM-2')];
  const parsed = parseAbsenceHistory(response([item(), item(projectB, 'CRM-77', 'record-2', { matricula: 'PRM-2', tipo: 'Atestado' })]), bindings, new Date('2026-10-20T12:00:00.000Z'));
  assert.equal(filterAbsenceHistory(parsed.records, { start: '2026-10-01', end: '2026-10-31', projectId: projectB, type: 'Atestado', matricula: 'CRM-77' }).length, 1);
  assert.equal(filterAbsenceHistory(parsed.records, { start: '2026-10-11', end: '2026-10-31', projectId: '', type: '', matricula: '' }).length, 0);
});

test('does not infer an unbound matricula or project from a name', () => {
  const parsed = parseAbsenceHistory(response([item(projectB, 'CRM-42', 'foreign')]), [binding()], new Date('2026-10-20T12:00:00.000Z'));
  assert.equal(parsed.records.length, 0);
  assert.equal(parsed.unmatchedCount, 1);
});

test('supports one person in multiple approved projects and deduplicates an identical external record', () => {
  const rows = [item(), item(projectB, 'CRM-77', 'record-2', { matricula: 'PRM-1' }), item()];
  const parsed = parseAbsenceHistory(response(rows), [binding(), binding(projectB, 'CRM-77')], new Date('2026-10-20T12:00:00.000Z'));
  assert.equal(parsed.records.length, 2);
  assert.throws(() => parseAbsenceHistory(response([item(), item(projectA, 'CRM-42', 'record-1', { status: 'Processado' })]), [binding()], new Date('2026-10-20T12:00:00.000Z')));
});

test('excludes pending and revoked bindings even when returned records share the same person name', () => {
  const pending = binding(projectA, 'CRM-42', 'PRM-1', 'pendente');
  const parsed = parseAbsenceHistory(response([item()]), [pending], new Date('2026-10-20T12:00:00.000Z'));
  assert.equal(parsed.records.length, 0);
  assert.equal(parsed.unmatchedCount, 1);
});
