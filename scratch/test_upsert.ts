import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function testUpsert() {
  console.log('Testing upsert on industrias...');
  const { data, error } = await supabase.from('industrias').upsert([
    { codigo: 'IND-TEST', nome: 'TEST INDUSTRY', status: 'ativo' }
  ], { onConflict: 'codigo' }).select();

  console.log('Upsert result:', { data, error });
}

testUpsert().catch(console.error);
