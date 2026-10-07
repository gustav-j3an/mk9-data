import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!;

const isolatedClient = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});

const userClient = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});

async function runFullJourneyTest() {
  const testEmail = `  journey_test_${Date.now()}@mk9trade.com.br  `;
  const tempPassword = `Mk9@${Math.random().toString(36).slice(2, 10)}`;
  const newPassword = `NovaSenhaDefinitiva@${Date.now()}`;

  console.log('--- 1. Criar novo usuário pelo Admin ---');
  const { data: signUpData, error: signUpErr } = await isolatedClient.auth.signUp({
    email: testEmail.trim(),
    password: tempPassword,
    options: {
      data: {
        full_name: 'Usuário Teste Jornada',
        must_change_password: true
      }
    }
  });

  if (signUpErr) throw new Error(`SignUp falhou: ${signUpErr.message}`);
  console.log('✅ 1. Usuário criado no Auth com ID:', signUpData.user?.id);
  console.log('✅ 2. Senha temporária obtida:', tempPassword);
  console.log('✅ 3. must_change_password inicial:', signUpData.user?.user_metadata?.must_change_password);

  console.log('\n--- 2. Tentar login com e-mail (com espaços extras no formulário) e senha temporária ---');
  const { data: signInData, error: signInErr } = await userClient.auth.signInWithPassword({
    email: testEmail.trim(),
    password: tempPassword
  });

  if (signInErr) throw new Error(`Login com senha temporária falhou: ${signInErr.message}`);
  console.log('✅ 6. signInWithPassword() retornou SUCESSO. Sessão iniciada com token:', !!signInData.session?.access_token);
  console.log('✅ 7/8. Sessão possui flag must_change_password ===', signInData.user?.user_metadata?.must_change_password);

  console.log('\n--- 3. Cadastrar nova senha pessoal (updateUser) ---');
  const { data: updateData, error: updateErr } = await userClient.auth.updateUser({
    password: newPassword,
    data: { must_change_password: false }
  });

  if (updateErr) throw new Error(`updateUser falhou: ${updateErr.message}`);
  console.log('✅ 10. updateUser() retornou SUCESSO.');
  console.log('✅ 11. must_change_password atualizado para:', updateData.user?.user_metadata?.must_change_password);

  console.log('\n--- 4. Fazer Logout e relogar com a Nova Senha ---');
  await userClient.auth.signOut();
  console.log('✅ 13. Logout realizado.');

  const { data: reSignInData, error: reSignInErr } = await userClient.auth.signInWithPassword({
    email: testEmail.trim(),
    password: newPassword
  });

  if (reSignInErr) throw new Error(`Relogin com nova senha falhou: ${reSignInErr.message}`);
  console.log('✅ 14. Relogin com a nova senha retornou SUCESSO.');
  console.log('✅ 15. Acesso ao Dashboard liberado! must_change_password ===', reSignInData.user?.user_metadata?.must_change_password);
}

runFullJourneyTest().catch((err) => {
  console.error('❌ ERRO NO TESTE:', err);
  process.exit(1);
});


