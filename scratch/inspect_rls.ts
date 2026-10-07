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

async function inspectRLS() {
  console.log('=== INSPECTING PROFILES & POLICIES ===');
  
  // 1. Get all profiles
  const { data: profiles, error: pErr } = await supabase.from('profiles').select('id, email, name, role, department');
  console.log('Profiles error:', pErr);
  console.log('Profiles count:', profiles?.length);
  console.log('Profiles data:', JSON.stringify(profiles, null, 2));

  // 2. Test inserting a dummy profile using anon key (unauthenticated or with session)
  const dummyId = crypto.randomUUID();
  const { error: insErr } = await supabase.from('profiles').insert([{
    id: dummyId,
    email: 'test_invite_rls@mk9.com',
    name: 'Test Invite',
    department: 'Teste',
    role: 'promotor'
  }]);
  console.log('Test INSERT with anon key error:', insErr);
}

inspectRLS().catch(console.error);
