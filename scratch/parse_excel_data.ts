import XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

const baseDir = 'C:\\Users\\Gustavo MK9\\Downloads';
const files = [
  'modelo_industrias.xlsx',
  'modelo_lojas.xlsx',
  'modelo_promotores.xlsx',
  'modelo_rotas.xlsx'
];

for (const file of files) {
  const filePath = path.join(baseDir, file);
  if (!fs.existsSync(filePath)) {
    console.error(`File NOT found: ${filePath}`);
    continue;
  }
  const workbook = XLSX.readFile(filePath);
  console.log(`\n==================================================`);
  console.log(`FILE: ${file} | SHEETS: ${workbook.SheetNames.join(', ')}`);
  
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
    console.log(`--- Sheet '${sheetName}' (total raw rows: ${data.length}) ---`);
    for (let i = 0; i < Math.min(15, data.length); i++) {
      console.log(`Row ${i + 1}:`, JSON.stringify(data[i]));
    }
  }
}
