import * as XLSX from 'xlsx';

export interface RhRosterRow {
  matricula_rh: string;
  nome_rh: string;
  cargo_rh: string;
  empresa: string;
  cidade_rh: string;
  uf_rh: string;
  situacao_rh: string;
}

export interface RhInternalPerson {
  tipo: 'promotor' | 'supervisor';
  codigo_interno: string;
  identificador: string;
  nome: string;
  cidade: string | null;
  uf: string | null;
  situacao: string;
}

const normalizeHeader = (value: unknown) => String(value ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase().replace(/\s+/g, ' ');

const cellText = (value: unknown) => String(value ?? '').trim();

const requiredHeaders: Record<keyof RhRosterRow, string[]> = {
  empresa: ['EMPRESA'],
  matricula_rh: ['MATRICULA', 'MATRÍCULA'],
  nome_rh: ['COLABORADOR', 'NOME COMPLETO', 'NOME'],
  cargo_rh: ['CARGO'],
  situacao_rh: ['STATUS', 'SITUACAO', 'SITUAÇÃO'],
  uf_rh: ['UF'],
  cidade_rh: ['CIDADE']
};

/** Reads only the seven approved HR roster fields from the selected workbook tab. */
export function parseRhRosterWorkbook(data: ArrayBuffer): RhRosterRow[] {
  const workbook = XLSX.read(data, { type: 'array', cellDates: false });
  const sheetName = workbook.SheetNames.find(name => normalizeHeader(name) === 'BENEFICIOS GERAL');
  if (!sheetName) throw new Error('A pasta Benefícios Geral não foi encontrada.');
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, raw: false, defval: '' });
  const headerIndex = matrix.findIndex(row => {
    const headers = new Set(row.map(normalizeHeader));
    return Object.values(requiredHeaders).every(aliases => aliases.some(alias => headers.has(normalizeHeader(alias))));
  });
  if (headerIndex < 0) throw new Error('Não encontrei as colunas obrigatórias de conciliação na planilha.');

  const headers = matrix[headerIndex].map(normalizeHeader);
  const indexes = Object.fromEntries(Object.entries(requiredHeaders).map(([field, aliases]) => {
    const index = headers.findIndex(header => aliases.map(normalizeHeader).includes(header));
    return [field, index];
  })) as Record<keyof RhRosterRow, number>;

  const rows = matrix.slice(headerIndex + 1)
    .filter(row => row.some(cell => cellText(cell)))
    .map(row => ({
      matricula_rh: cellText(row[indexes.matricula_rh]),
      nome_rh: cellText(row[indexes.nome_rh]),
      cargo_rh: cellText(row[indexes.cargo_rh]),
      empresa: cellText(row[indexes.empresa]),
      cidade_rh: cellText(row[indexes.cidade_rh]),
      uf_rh: cellText(row[indexes.uf_rh]).toUpperCase(),
      situacao_rh: cellText(row[indexes.situacao_rh])
    }))
    .filter(row => Object.values(row).some(Boolean));

  const errors = validateRhRoster(rows);
  if (errors.length) throw new Error(errors[0]);
  return rows;
}

export function validateRhRoster(rows: RhRosterRow[]): string[] {
  const errors: string[] = [];
  if (!rows.length) return ['A planilha não contém colaboradores para importar.'];
  if (rows.length > 100) return ['O lote deve conter no máximo 100 colaboradores.'];
  const registrations = new Set<string>();
  for (const row of rows) {
    if (Object.values(row).some(value => !value.trim())) errors.push('Há linha com campo de conciliação vazio.');
    const normalizedRegistration = row.matricula_rh.trim().toUpperCase();
    if (registrations.has(normalizedRegistration)) errors.push('Há matrícula RH duplicada no arquivo.');
    registrations.add(normalizedRegistration);
    if (row.matricula_rh.length > 64 || row.nome_rh.length > 200 || row.cargo_rh.length > 120 ||
        row.empresa.length > 120 || row.cidade_rh.length > 120 || !/^[A-Z]{2,3}$/.test(row.uf_rh) || row.situacao_rh.length > 80) {
      errors.push('Há campo fora do formato ou tamanho aceito.');
    }
  }
  return [...new Set(errors)];
}

export function rosterDivergences(row: RhRosterRow, person: RhInternalPerson | null): string[] {
  if (!person) return [];
  const flags: string[] = [];
  if (person.tipo === 'promotor' && !/PROMOTOR/i.test(row.cargo_rh)) flags.push('cargo');
  if (person.tipo === 'supervisor' && !/SUPERVISOR/i.test(row.cargo_rh)) flags.push('cargo');
  if (person.cidade && normalizeHeader(person.cidade) !== normalizeHeader(row.cidade_rh)) flags.push('cidade');
  if (person.uf && normalizeHeader(person.uf) !== normalizeHeader(row.uf_rh)) flags.push('UF');
  if (row.situacao_rh !== 'ATIVO EFETIVO' && row.situacao_rh !== 'ATIVO EXPERIÊNCIA' && person.situacao === 'ativo') flags.push('situação/vigência');
  if ((row.situacao_rh === 'ATIVO EFETIVO' || row.situacao_rh === 'ATIVO EXPERIÊNCIA') && person.situacao !== 'ativo') flags.push('situação/vigência');
  return flags;
}
