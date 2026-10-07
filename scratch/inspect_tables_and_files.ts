import { createClient } from '@supabase/supabase-js';
import XLSX from 'xlsx';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspect() {
  console.log('--- EXCEL FILES INSPECTION ---');
  const baseDir = 'C:\\Users\\Gustavo MK9\\Downloads';
  const files = ['modelo_industrias.xlsx', 'modelo_lojas.xlsx', 'modelo_promotores.xlsx', 'modelo_rotas.xlsx'];

  for (const file of files) {
    const filePath = path.join(baseDir, file);
    if (!fs.existsSync(filePath)) {
      console.error(`File NOT found: ${filePath}`);
      continue;
    }
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json(sheet);
    console.log(`\n================ ${file} (${json.length} rows) ================`);
    if (json.length > 0) {
      console.log(`Columns:`, Object.keys(json[0] as object));
      console.log(`First row:`, json[0]);
      console.log(`Second row:`, json[1]);
    }
  }

  console.log('\n--- TESTING TABLE COLUMNS IN SUPABASE ---');
  const tables = ['industrias', 'lojas', 'promotores', 'rotas'];
  for (const table of tables) {
    // Attempting insert with empty object to inspect error message / schema
    const { error } = await supabase.from(table).insert({});
    console.log(`Table '${table}' insert test response error:`, error?.message || 'No error');
  }
}

inspect().catch(console.error);
