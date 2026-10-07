import XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

const baseDir = 'C:\\Users\\Gustavo MK9\\Downloads';

function parseSheet(fileName: string) {
  const filePath = path.join(baseDir, fileName);
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets['DADOS'];
  const rows = XLSX.utils.sheet_to_json<any>(sheet);
  return rows;
}

console.log('--- READING EXCEL FILES ---');
const industriasRows = parseSheet('modelo_industrias.xlsx');
const lojasRows = parseSheet('modelo_lojas.xlsx');
const promotoresRows = parseSheet('modelo_promotores.xlsx');
const rotasRows = parseSheet('modelo_rotas.xlsx');

console.log(`Industrias raw rows: ${industriasRows.length}`);
console.log(`Lojas raw rows: ${lojasRows.length}`);
console.log(`Promotores raw rows: ${promotoresRows.length}`);
console.log(`Rotas raw rows: ${rotasRows.length}`);

// Check Lojas without UF
const storesWithoutUf = lojasRows.filter(r => !r.uf || r.uf.toString().trim() === '');
console.log(`\nLojas without UF (${storesWithoutUf.length}):`, storesWithoutUf.map(s => ({ codigo: s.codigo, nome: s.nome, cidade: s.cidade, uf: s.uf })));

// Check Promotores (Alexandre PRM-723, Lucas PRM-038, Lucas PRM-028)
const alexandrePrm = promotoresRows.filter(p => p.matricula === 'PRM-723' || p.nome?.includes('ALEXANDRE'));
console.log('\nAlexandre in Promotores:', alexandrePrm);

const lucasPrm = promotoresRows.filter(p => p.nome?.includes('LUCAS'));
console.log('\nLucas in Promotores:', lucasPrm);

// Check Rotas for Alexandre & Lucas
const rotasAlexandre = rotasRows.filter(r => r.promotor === 'PRM-723');
console.log('\nRotas for PRM-723:', rotasAlexandre.length);

const rotasLucas38 = rotasRows.filter(r => r.promotor === 'PRM-038');
console.log('Rotas for PRM-038:', rotasLucas38.length);

const rotasLucas28 = rotasRows.filter(r => r.promotor === 'PRM-028');
console.log('Rotas for PRM-028:', rotasLucas28);

// Check Rotas without days
function isDayMarked(val: any): boolean {
  if (!val) return false;
  const s = val.toString().trim().toUpperCase();
  return s === 'SIM' || s === 'X' || s === '1' || s === 'TRUE' || s === 'V' || s === '✓';
}

const rotasSemDia = rotasRows.filter(r => {
  const hasAnyDay = isDayMarked(r.segunda) || isDayMarked(r.terca) || isDayMarked(r.quarta) ||
                    isDayMarked(r.quinta) || isDayMarked(r.sexta) || isDayMarked(r.sabado) || isDayMarked(r.domingo);
  return !hasAnyDay;
});
console.log(`\nRotas sem nenhum dia marcado (${rotasSemDia.length}):`, rotasSemDia);
