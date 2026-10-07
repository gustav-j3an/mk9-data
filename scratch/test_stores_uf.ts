import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function testStoresUf() {
  const testEmail = `import_admin_${Date.now()}@mk9trade.com.br`;
  const { data: authData } = await supabase.auth.signUp({
    email: testEmail,
    password: 'ImportPassword123!'
  });

  console.log('Auth user session:', !!authData.session);

  // Test 1: Insert LOJ-0408 with uf = 'GO'
  const res1 = await supabase.from('lojas').upsert([
    {
      codigo: 'LOJ-TEST-0408',
      nome: 'SUPERMERCADO REIS - ITUMBIARA AV. OSVALDO CRUZ',
      cidade: 'ITUMBIARA',
      uf: 'GO',
      status: 'ativo'
    }
  ], { onConflict: 'codigo' }).select();
  console.log('LOJ-0408 (GO) insert result error:', res1.error?.message || 'SUCCESS');

  // Test 2: Insert LOJ-0407 with uf = null
  const res2 = await supabase.from('lojas').upsert([
    {
      codigo: 'LOJ-TEST-0407',
      nome: 'SUPERMERCADO REIS - CELSO MAEDA',
      cidade: 'NAO INFORMADA',
      uf: null,
      status: 'ativo'
    }
  ], { onConflict: 'codigo' }).select();
  console.log('LOJ-0407 (null) insert result error:', res2.error?.message || 'SUCCESS');

  // Test 3: Insert LOJ-0407 with uf = ''
  const res3 = await supabase.from('lojas').upsert([
    {
      codigo: 'LOJ-TEST-0407',
      nome: 'SUPERMERCADO REIS - CELSO MAEDA',
      cidade: 'NAO INFORMADA',
      uf: '',
      status: 'ativo'
    }
  ], { onConflict: 'codigo' }).select();
  console.log('LOJ-0407 (empty string) insert result error:', res3.error?.message || 'SUCCESS');

  // Cleanup test records
  await supabase.from('lojas').delete().in('codigo', ['LOJ-TEST-0408', 'LOJ-TEST-0407']);
}

testStoresUf().catch(console.error);
