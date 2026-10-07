import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function testAccess() {
  console.log('Testing select on industrias...');
  const { data: indData, error: indErr } = await supabase.from('industrias').select('*').limit(1);
  console.log('Industrias select:', { indData, indErr });

  console.log('Testing select on lojas...');
  const { data: lojData, error: lojErr } = await supabase.from('lojas').select('*').limit(1);
  console.log('Lojas select:', { lojData, lojErr });

  console.log('Testing select on promotores...');
  const { data: prmData, error: prmErr } = await supabase.from('promotores').select('*').limit(1);
  console.log('Promotores select:', { prmData, prmErr });

  console.log('Testing select on rotas...');
  const { data: rotData, error: rotErr } = await supabase.from('rotas').select('*').limit(1);
  console.log('Rotas select:', { rotData, rotErr });
}

testAccess().catch(console.error);
