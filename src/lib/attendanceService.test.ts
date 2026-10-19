import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMissingTable, readPages, validateOverride } from './attendanceService';
import * as XLSX from 'xlsx';
import { exportRows } from '../utils/attendanceEngine';

test('paginação mantém todas as linhas após o limite padrão da API', async () => {
  const calls: number[] = [];
  const source = Array.from({ length: 1207 }, (_, id) => ({ id }));
  const rows = await readPages(async (from, to) => {
    calls.push(from);
    return { data: source.slice(from, to + 1), error: null };
  });
  assert.equal(rows.length, 1207);
  assert.deepEqual(calls, [0, 500, 1000]);
});
test('falha em uma página rejeita a consulta em vez de retornar totais parciais', async () => {
  await assert.rejects(readPages(async from => from === 0 ? { data: Array(500).fill({}), error: null } : { data: null, error: { name: 'PostgrestError', code: '42501', message: 'denied', details: '', hint: '' } }), { code: '42501' });
});
test('apenas relação ausente é reconhecida como dependência pendente', () => {
  const error = (code: string) => ({ name: 'PostgrestError', code, message: 'promoter_attendance_records', details: '', hint: '' });
  assert.equal(isMissingTable(error('42P01')), true);
  assert.equal(isMissingTable(error('PGRST205')), true);
  assert.equal(isMissingTable(error('42501')), false);
  assert.equal(isMissingTable(error('42703')), false);
});
test('ajuste exige justificativa, status conhecido e dias inteiros no intervalo permitido', () => {
  assert.throws(() => validateOverride('presente', 'x'));
  assert.throws(() => validateOverride('inventado', 'Justificativa'));
  for (const days of [0, -1, 31, 1.5, NaN]) assert.throws(() => validateOverride('atestado_aprovado', 'Justificativa', days));
  assert.doesNotThrow(() => validateOverride('atestado_pendente', 'Justificativa', 2));
});
test('planilha XLSX preserva data operacional e horário original sem criar fórmulas', () => {
  const rows = exportRows([{ id: '1', promoterId: '1', name: '=1+1', initials: 'T', matricula: '001', squad: 'A', supervisor: 'Supervisora', city: 'São Paulo', state: 'SP', status: 'presente', operationalStatus: 'presente', eligible: true, checkInAt: '2026-10-19T11:00:00Z', telemetryTime: '08:00', telemetryDetail: 'Localização não disponível' }], '2026-10-19');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Presença');
  const decoded = XLSX.read(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' });
  const sheet = decoded.Sheets[decoded.SheetNames[0]];
  assert.deepEqual(XLSX.utils.sheet_to_json(sheet), rows);
  assert.equal(sheet.B2.f, undefined);
  assert.equal(sheet.B2.t, 's');
});
