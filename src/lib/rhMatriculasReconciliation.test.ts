import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import * as XLSX from 'xlsx';
import { parseRhRosterWorkbook, rosterDivergences, validateRhRoster, type RhInternalPerson, type RhRosterRow } from './rhMatriculasReconciliation';

const rosterRow = (overrides: Partial<RhRosterRow> = {}): RhRosterRow => ({
  matricula_rh: '123', nome_rh: 'Pessoa Colaboradora', cargo_rh: 'PROMOTOR(A)', empresa: 'CZB',
  cidade_rh: 'GOIÂNIA', uf_rh: 'GO', situacao_rh: 'ATIVO EFETIVO', ...overrides
});
const person: RhInternalPerson = {
  tipo: 'promotor', codigo_interno: 'PRM-0042', identificador: 'uuid-interno', nome: 'Pessoa Colaboradora',
  cidade: 'GOIANIA', uf: 'GO', situacao: 'ativo'
};

test('workbook extraction allowlists only seven reconciliation fields', () => {
  const source = [
    ['EMPRESA','MATRICULA','COLABORADOR','CPF','CARGO','SALARIO','STATUS','UF','CIDADE','RG','PIS','BENEFICIO'],
    ['CZB','00123','Pessoa Colaboradora','11122233344','PROMOTOR(A)','99999','ATIVO EFETIVO','GO','GOIANIA','RGSECRET','PISSECRET','BENEFITSECRET']
  ];
  const sheet = XLSX.utils.aoa_to_sheet(source);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Benefícios Geral');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  const rows = parseRhRosterWorkbook(bytes);
  assert.deepEqual(rows, [{ matricula_rh: '00123', nome_rh: 'Pessoa Colaboradora', cargo_rh: 'PROMOTOR(A)', empresa: 'CZB', cidade_rh: 'GOIANIA', uf_rh: 'GO', situacao_rh: 'ATIVO EFETIVO' }]);
  assert.equal(JSON.stringify(rows).includes('11122233344'), false);
  assert.equal(JSON.stringify(rows).includes('99999'), false);
  assert.equal(JSON.stringify(rows).includes('RGSECRET'), false);
  assert.equal(JSON.stringify(rows).includes('PISSECRET'), false);
  assert.equal(JSON.stringify(rows).includes('BENEFITSECRET'), false);
});

test('rejeita matrículas duplicadas, dados incompletos e lote fora do limite', () => {
  assert.ok(validateRhRoster([rosterRow(), rosterRow()]).some(error => error.includes('duplicada')));
  assert.ok(validateRhRoster([rosterRow({ nome_rh: '' })]).length > 0);
  assert.ok(validateRhRoster(Array.from({ length: 101 }, (_, index) => rosterRow({ matricula_rh: String(index) }))).length > 0);
});

test('divergências são explícitas; semelhança nominal nunca associa identidade', () => {
  assert.deepEqual(rosterDivergences(rosterRow(), person), []);
  assert.deepEqual(rosterDivergences(rosterRow({ cidade_rh: 'BRASÍLIA' }), person), ['cidade']);
  assert.deepEqual(rosterDivergences(rosterRow({ situacao_rh: 'AFASTADO INSS' }), person), ['situação/vigência']);
  assert.deepEqual(rosterDivergences(rosterRow(), null), []);
  assert.ok(rosterDivergences(rosterRow({ cargo_rh: 'CONSULTOR' }), person).includes('cargo'));
});

test('migration preserva chaves operacionais, exige capability específica e audita decisões', async () => {
  const sql = await readFile(resolve('supabase/migrations/20261021100000_mk9_rh_reconciliation.sql'), 'utf8');
  assert.match(sql, /reconciliation_permissions/);
  assert.match(sql, /p\.role='admin' AND p\.status='ativo'/);
  assert.match(sql, /CREATE UNIQUE INDEX matriculas_rh_recon_approved_promotor_unique/);
  assert.match(sql, /CREATE UNIQUE INDEX matriculas_rh_recon_approved_supervisor_unique/);
  assert.match(sql, /FOR UPDATE/);
  assert.match(sql, /matriculas_rh_reconciliation_audit/);
  assert.match(sql, /REVOKE ALL ON mk9_rh_private\.matriculas_rh_reconciliation/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/);
  assert.doesNotMatch(sql, /UPDATE\s+public\.(promotores|supervisores|rotas|visits)/i);
  assert.doesNotMatch(sql, /^\s*(cpf|salario|beneficio|pis|rg)\s+/im);
});
