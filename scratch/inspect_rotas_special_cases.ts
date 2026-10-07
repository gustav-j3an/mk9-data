import XLSX from 'xlsx';
import * as path from 'path';

const baseDir = 'C:\\Users\\Gustavo MK9\\Downloads';
const filePath = path.join(baseDir, 'modelo_rotas.xlsx');
const workbook = XLSX.readFile(filePath);
const sheet = workbook.Sheets['DADOS'];
const rawRows = XLSX.utils.sheet_to_json<any>(sheet);

console.log('Headers:', Object.keys(rawRows[0]));

console.log('Row 23 (index 21):', rawRows[21]);
console.log('Row 165 (index 163):', rawRows[163]);

console.log('Row 216 (index 214):', rawRows[214]);
console.log('Row 223 (index 221):', rawRows[221]);

console.log('Row 351 (index 349):', rawRows[349]);
console.log('Row 352 (index 350):', rawRows[350]);
