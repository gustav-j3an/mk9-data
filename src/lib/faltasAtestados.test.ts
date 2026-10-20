import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import {
  externalWriteEnabled, hasPreparePermission, inclusiveDays, isBindingSelectable, isOccurrenceWithinBinding,
  resolveBinding, reviewNotSent, validateAbsenceDraft, type AbsenceDraft, type CrmBinding
} from './faltasAtestados';

const binding = (overrides: Partial<CrmBinding> = {}): CrmBinding => ({
  promotor_id: 'p-1', matricula_interna: 'PRM-068', colaborador: 'Pessoa de Teste',
  equipe: 'Equipe A', supervisor: 'Supervisora', cidade: 'São Paulo', uf: 'SP',
  identidade_status: 'aprovado', alocacao_id: 'a-1',
  projeto_crm: '65f7e80f-f615-4ceb-9b8d-80db170735dc', matricula_externa: '0000042',
  alocacao_status: 'aprovado', ocorrencias_desde: '2026-01-01', ocorrencias_ate: null,
  valido_desde: '2026-01-01T00:00:00.000Z', valido_ate: null, ...overrides
});
const draft = (overrides: Partial<AbsenceDraft> = {}): AbsenceDraft => ({
  alocacaoId: 'a-1', tipo: 'Atestado', inicio: '2026-10-19', fim: '2026-10-20',
  retorno: '2026-10-21', empresa: 'Empresa informada', supervisor: 'Supervisora',
  localidade: 'São Paulo/SP', loja: '', motivo: '', informacoes: '', ...overrides
});

test('capability exige concessão explícita verdadeira', () => {
  assert.equal(hasPreparePermission(true), true);
  assert.equal(hasPreparePermission(false), false);
  assert.equal(hasPreparePermission(undefined), false);
  assert.equal(hasPreparePermission('admin'), false);
});

test('usuário sem capability não obtém permissão por papel', () => {
  assert.equal(hasPreparePermission(false), false);
  assert.equal(hasPreparePermission({ role: 'admin' }), false);
});

test('seleciona colaborador pelo ID único da alocação', () => {
  const rows = [binding(), binding({ alocacao_id: 'a-2', projeto_crm: '950edb7d-b94f-4555-9e5a-16fb5aa857a3', matricula_externa: '0099' })];
  assert.equal(resolveBinding(rows, 'a-2')?.colaborador, 'Pessoa de Teste');
  assert.equal(resolveBinding(rows, 'missing'), null);
  assert.equal(resolveBinding([rows[0], rows[0]], 'a-1'), null);
});

test('matrícula externa é resolvida do vínculo, nunca de texto do formulário', () => {
  const selected = resolveBinding([binding()], 'a-1');
  assert.equal(selected?.matricula_externa, '0000042');
  assert.equal(Object.hasOwn(draft(), 'matriculaExterna'), false);
});

test('preserva múltiplos projetos como alocações distintas', () => {
  const rows = [binding(), binding({ alocacao_id: 'a-2', projeto_crm: '950edb7d-b94f-4555-9e5a-16fb5aa857a3', matricula_externa: '0099' })];
  assert.notEqual(resolveBinding(rows, 'a-1')?.projeto_crm, resolveBinding(rows, 'a-2')?.projeto_crm);
});

test('vínculo pendente não pode ser selecionado', () => {
  assert.equal(isBindingSelectable(binding({ alocacao_status: 'pendente' }), new Date('2026-10-20T12:00:00Z')), false);
});

test('vínculo revogado não pode ser selecionado', () => {
  assert.equal(isBindingSelectable(binding({ alocacao_status: 'revogado' }), new Date('2026-10-20T12:00:00Z')), false);
});

test('janela de ocorrência e vigência do vínculo são respeitadas', () => {
  assert.equal(isOccurrenceWithinBinding(binding(), '2026-10-19', '2026-10-20'), true);
  assert.equal(isOccurrenceWithinBinding(binding({ ocorrencias_ate: '2026-10-19' }), '2026-10-19', '2026-10-20'), false);
  assert.equal(isOccurrenceWithinBinding(binding({ valido_ate: '2026-10-20T00:00:00.000Z' }), '2026-10-19', '2026-10-20'), false);
});

test('datas inválidas e período invertido são rejeitados', () => {
  assert.equal(inclusiveDays('2026-02-30', '2026-03-01'), null);
  assert.equal(inclusiveDays('2026-10-21', '2026-10-20'), null);
  assert.ok(validateAbsenceDraft(draft({ inicio: '2026-02-30' }), binding()).length > 0);
});

test('campos requeridos do formulário são validados', () => {
  const errors = validateAbsenceDraft(draft({ tipo: '', empresa: '', supervisor: '', localidade: '' }), binding());
  assert.ok(errors.length >= 4);
});

test('revisão informa claramente que nada foi enviado', () => {
  assert.equal(reviewNotSent, 'Não enviado — integração com CRM aguardando homologação.');
  assert.equal(externalWriteEnabled, false);
});

test('não há cliente de escrita nem POST externo no módulo', async () => {
  const source = await readFile(resolve('src/views/FaltasAtestadosModule.tsx'), 'utf8');
  assert.doesNotMatch(source, /method\s*:\s*['"]POST['"]|\.insert\s*\(|\.upsert\s*\(/i);
  assert.doesNotMatch(source, /fetch\s*\([^)]*method\s*:\s*['"]POST['"]/is);
});

test('módulo e helpers não referenciam o Controle de Presença', async () => {
  const sources = await Promise.all([
    readFile(resolve('src/views/FaltasAtestadosModule.tsx'), 'utf8'),
    readFile(resolve('src/lib/faltasAtestados.ts'), 'utf8')
  ]);
  assert.doesNotMatch(sources.join('\n'), /promoter_attendance_records|promoter_attendance_audit_log|promoter_absences|attendanceService|attendance_check_/i);
});
