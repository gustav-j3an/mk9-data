import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!);

async function testDirectEdits() {
  const { data, error } = await supabase
    .from('system_settings')
    .update({ value: 'OPERACAO_OFICIAL' })
    .eq('key', 'operation_mode')
    .select();
  
  console.log('Update result data:', data, 'error:', error);
}

testDirectEdits();
