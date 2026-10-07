import XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

const baseDir = 'C:\\Users\\Gustavo MK9\\Downloads';
const filePath = path.join(baseDir, 'modelo_rotas.xlsx');
const workbook = XLSX.readFile(filePath);
const sheet = workbook.Sheets['DADOS'];
const rawRows = XLSX.utils.sheet_to_json<any>(sheet);

function isDayMarked(val: any): boolean {
  if (!val) return false;
  const s = val.toString().trim().toUpperCase();
  return s === 'SIM' || s === 'X' || s === '1' || s === 'TRUE' || s === 'V' || s === '✓';
}

interface ProcessedRoute {
  industria_codigo: string;
  loja_codigo: string;
  promotor_matricula: string;
  uf: string | null;
  frequencia: 'SEMANAL' | 'QUINZENAL';
  segunda: boolean;
  terca: boolean;
  quarta: boolean;
  quinta: boolean;
  sexta: boolean;
  sabado: boolean;
  domingo: boolean;
  sourceLines: number[];
}

const mapByKey = new Map<string, ProcessedRoute>();
const ignoredNoDays: any[] = [];
let totalRowsProcessed = 0;
let duplicatesCount = 0;

for (let idx = 0; idx < rawRows.length; idx++) {
  const r = rawRows[idx];
  const lineNumber = idx + 2; // Row in sheet (1-based header + 1-based index)
  totalRowsProcessed++;

  const promotor_matricula = (r.promotor || '').toString().trim();
  const loja_codigo = (r.loja || '').toString().trim();
  const industria_codigo = (r.industria || '').toString().trim();
  const uf = (r.uf || '').toString().trim() || null;
  const freqRaw = (r.frequencia || 'SEMANAL').toString().trim().toUpperCase();
  const frequencia: 'SEMANAL' | 'QUINZENAL' = freqRaw === 'QUINZENAL' ? 'QUINZENAL' : 'SEMANAL';

  const seg = isDayMarked(r.segunda);
  const ter = isDayMarked(r.terca);
  const qua = isDayMarked(r.quarta);
  const qui = isDayMarked(r.quinta);
  const sex = isDayMarked(r.sexta);
  const sab = isDayMarked(r.sabado);
  const dom = isDayMarked(r.domingo);
  const hasAnyDay = seg || ter || qua || qui || sex || sab || dom;

  const key = `${promotor_matricula}__${loja_codigo}__${industria_codigo}`;

  if (mapByKey.has(key)) {
    duplicatesCount++;
    const existing = mapByKey.get(key)!;
    existing.sourceLines.push(lineNumber);
    // Combine days
    existing.segunda = existing.segunda || seg;
    existing.terca = existing.terca || ter;
    existing.quarta = existing.quarta || qua;
    existing.quinta = existing.quinta || qui;
    existing.sexta = existing.sexta || sex;
    existing.sabado = existing.sabado || sab;
    existing.domingo = existing.domingo || dom;

    // Special cases frequency rules
    if (promotor_matricula === 'PRM-024' && loja_codigo === 'LOJ-0366' && industria_codigo === 'IND-023') {
      existing.frequencia = 'SEMANAL';
    } else if (promotor_matricula === 'PRM-016' && loja_codigo === 'LOJ-0235' && industria_codigo === 'IND-024') {
      existing.frequencia = 'QUINZENAL';
    } else if (promotor_matricula === 'PRM-065' && loja_codigo === 'LOJ-0079' && industria_codigo === 'IND-022') {
      existing.frequencia = 'QUINZENAL';
    }
  } else {
    if (!hasAnyDay) {
      ignoredNoDays.push({ lineNumber, promotor_matricula, loja_codigo, industria_codigo, uf });
    } else {
      mapByKey.set(key, {
        industria_codigo,
        loja_codigo,
        promotor_matricula,
        uf,
        frequencia,
        segunda: seg,
        terca: ter,
        quarta: qua,
        quinta: qui,
        sexta: sex,
        sabado: sab,
        domingo: dom,
        sourceLines: [lineNumber]
      });
    }
  }
}

console.log(`--- ROTAS CONSOLIDATION SUMMARY ---`);
console.log(`Total raw rows in sheet: ${totalRowsProcessed}`);
console.log(`Unique route keys consolidated: ${mapByKey.size}`);
console.log(`Duplicates consolidated: ${duplicatesCount}`);
console.log(`Ignored routes (no days marked): ${ignoredNoDays.length}`);
console.log(`Ignored routes list:`, ignoredNoDays);

// Check Special Cases in mapByKey
console.log('\nCASO 1 (PRM-024 + LOJ-0366 + IND-023):', mapByKey.get('PRM-024__LOJ-0366__IND-023'));
console.log('CASO 2 (PRM-016 + LOJ-0235 + IND-024):', mapByKey.get('PRM-016__LOJ-0235__IND-024'));
console.log('CASO 3 (PRM-065 + LOJ-0079 + IND-022):', mapByKey.get('PRM-065__LOJ-0079__IND-022'));
