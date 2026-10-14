import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!);

async function checkSystemSettings() {
  const { data, error } = await supabase.from('system_settings').select('*');
  console.log('system_settings:', { data, error });
}

checkSystemSettings();
