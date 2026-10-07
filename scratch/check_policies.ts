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

async function checkRemotePolicies() {
  console.log('=== CHECKING REMOTE POLICIES & FUNCTIONS ===');
  
  // Try querying pg_policies via rpc or rest if exposed, or testing rls behaviour
  const { data: pols, error: polErr } = await supabase.from('pg_policies').select('*');
  console.log('pg_policies query result:', pols, 'err:', polErr);
}

checkRemotePolicies().catch(console.error);
