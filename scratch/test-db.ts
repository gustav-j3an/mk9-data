import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  console.log('Testing connection to Supabase...');
  const { data: prof, error: profErr } = await supabase.from('profiles').select('id, email, role').limit(2);
  console.log('profiles test:', { data: prof, error: profErr });

  const { data: vis, error: visErr } = await supabase.from('visits').select('id').limit(2);
  console.log('visits test:', { count: vis?.length, error: visErr });
}

check();
