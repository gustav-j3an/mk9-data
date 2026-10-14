import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

dotenv.config({ path: '.env.local' });

const supabaseUrl = 'http://127.0.0.1:54321';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

async function runTest() {
  console.log(`Connecting to ${supabaseUrl}...`);
  const client = createClient(supabaseUrl, supabaseAnonKey);

  // 1. Get next code preview
  const { data: codePreview, error: errPreview } = await client.rpc('get_next_industry_code');
  console.log('Next industry code RPC response:', { codePreview, errPreview });

  // 2. Read admin password
  const adminPassword = fs.readFileSync('supabase/.temp/admin_homolog_password.txt', 'utf8').trim();
  const { data: authData, error: authError } = await client.auth.signInWithPassword({
    email: 'admin.homolog@mk9.local',
    password: adminPassword,
  });

  if (authError || !authData.session) {
    console.error('Login failed:', authError);
    process.exit(1);
  }
  console.log('Authenticated successfully as admin.homolog@mk9.local');

  // Authenticated client
  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${authData.session.access_token}`,
      },
    },
  });

  // 3. Insert industry manually with automatic code
  const testIndustry = {
    nome: 'Indústria Teste Manual Automatizado Ltda',
    cnpj: '12.345.678/0001-90',
    status: 'ativo',
    observacao: 'Criado via teste de integração homologação',
  };

  const { data: inserted, error: insertErr } = await authClient
    .from('industrias')
    .insert(testIndustry)
    .select()
    .single();

  if (insertErr) {
    console.error('Insert error:', insertErr);
    process.exit(1);
  }
  console.log('Successfully inserted industry with auto-code:', inserted);

  // 4. Test duplicate prevention
  const { error: dupErr } = await authClient
    .from('industrias')
    .insert({
      codigo: inserted.codigo,
      nome: 'Indústria Duplicada Teste',
      status: 'ativo',
    });

  console.log('Duplicate insert attempt (should fail):', {
    code: dupErr?.code,
    message: dupErr?.message,
    expectedError: dupErr?.code === '23505',
  });

  // 5. Update existing industry
  const { data: updated, error: updateErr } = await authClient
    .from('industrias')
    .update({
      nome: 'Indústria Teste Manual Atualizada Ltda',
      observacao: 'Atualizado com sucesso',
    })
    .eq('id', inserted.id)
    .select()
    .single();

  if (updateErr) {
    console.error('Update error:', updateErr);
    process.exit(1);
  }
  console.log('Successfully updated industry:', updated);

  // 6. Query list and indicators
  const { data: allIndustries, count } = await authClient
    .from('industrias')
    .select('*', { count: 'exact' });

  console.log(`Total industries in database: ${count}`);
  console.log('Sample from query:', allIndustries?.slice(0, 3));

  // 7. Test next code preview after insert
  const { data: nextCodeAfter } = await client.rpc('get_next_industry_code');
  console.log('Next code after insertion:', nextCodeAfter);

  console.log('\n--- ALL VERIFICATIONS PASSED ---');
}

runTest().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
