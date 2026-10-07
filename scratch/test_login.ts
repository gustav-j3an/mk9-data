import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function testAuth() {
  console.log('Testing sign up / sign in...');
  const testEmail = `import_admin_${Date.now()}@mk9trade.com.br`;
  const testPassword = 'ImportPassword123!';

  // Attempt sign up
  const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
    email: testEmail,
    password: testPassword
  });
  console.log('Sign up result:', { user: signUpData.user?.email, error: signUpErr?.message });

  if (signUpData.session) {
    console.log('Session acquired via sign up!');
    // Test upsert on industrias
    const { data: upsertData, error: upsertErr } = await supabase.from('industrias').upsert([
      { codigo: 'IND-TEST', nome: 'TEST INDUSTRY', status: 'ativo' }
    ], { onConflict: 'codigo' }).select();
    console.log('Upsert result with session:', { upsertData, error: upsertErr?.message });

    // Clean up test row
    await supabase.from('industrias').delete().eq('codigo', 'IND-TEST');
  }
}

testAuth().catch(console.error);
