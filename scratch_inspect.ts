import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const envContent = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8');
const env: Record<string, string> = {};
envContent.split('\n').forEach(l => {
  const p = l.split('=');
  if (p.length >= 2) env[p[0].trim()] = p.slice(1).join('=').trim();
});

const url = env['VITE_SUPABASE_URL'];
const key = env['VITE_SUPABASE_PUBLISHABLE_KEY'];

const supabase = createClient(url, key);

async function inspect() {
  const { count: rotasCount, error: rErr } = await supabase.from('rotas').select('*', { count: 'exact', head: true });
  console.log('Rotas count:', rotasCount, 'Error:', rErr);

  const { count: profCount, error: pErr } = await supabase.from('profiles').select('*', { count: 'exact', head: true });
  console.log('Profiles count:', profCount, 'Error:', pErr);
}

inspect().catch(console.error);
