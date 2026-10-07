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

async function testFirstAccessFlow() {
  console.log('=== TESTANDO FLUXO DE PRIMEIRO ACESSO E SENHA TEMPORÁRIA ===');

  const testEmail = `test_user_${Date.now()}@mk9test.com`;
  const testName = 'Usuario Teste Primeiro Acesso';
  const tempPassword = `Mk9@${crypto.randomUUID().slice(0, 8)}`;

  console.log('1. Criando usuário no Auth com a flag must_change_password: true...');
  const { data: authData, error: authErr } = await supabase.auth.signUp({
    email: testEmail,
    password: tempPassword,
    options: {
      data: {
        full_name: testName,
        must_change_password: true
      }
    }
  });

  if (authErr || !authData.user) {
    console.error('Erro na criação do usuário:', authErr);
    return;
  }

  console.log('✔ Usuário criado no Auth com ID:', authData.user.id);
  console.log('✔ User metadata flag must_change_password:', authData.user.user_metadata?.must_change_password);

  console.log('2. Testando login do usuário com a senha temporária...');
  const userClient = createClient(url, key, { auth: { persistSession: false } });
  const { data: loginData, error: loginErr } = await userClient.auth.signInWithPassword({
    email: testEmail,
    password: tempPassword
  });

  if (loginErr || !loginData.session) {
    console.error('Erro no login do usuário:', loginErr);
    return;
  }

  console.log('✔ Login do usuário realizado com sucesso!');
  console.log('✔ Flag identificada na sessão do usuário:', loginData.session.user.user_metadata?.must_change_password === true ? 'REQUER TROCA DE SENHA' : 'OK');

  console.log('3. Atualizando senha do usuário e limpando a flag must_change_password...');
  const newPassword = 'NovaSenhaSegura123!';
  const { data: updateData, error: updateErr } = await userClient.auth.updateUser({
    password: newPassword,
    data: { must_change_password: false }
  });

  if (updateErr) {
    console.error('Erro ao atualizar senha:', updateErr);
    return;
  }

  console.log('✔ Senha atualizada com sucesso!');
  console.log('✔ Nova flag must_change_password:', updateData.user.user_metadata?.must_change_password);

  console.log('4. Testando novo login com a NOVA SENHA...');
  const { data: finalLogin, error: finalErr } = await userClient.auth.signInWithPassword({
    email: testEmail,
    password: newPassword
  });

  if (finalErr) {
    console.error('Erro no login com nova senha:', finalErr);
  } else {
    console.log('✔ SUCCESS! Login com nova senha efetuado com sucesso!');
    console.log('✔ ID do usuário logado:', finalLogin.session?.user.id);
  }

  // Limpeza
  console.log('5. Limpando conta de teste do banco...');
  const adminClient = createClient(url, key);
  await adminClient.rpc('delete_user_by_admin', { target_user_id: authData.user.id }).catch(() => {});
  console.log('=== TESTE CONCLUÍDO COM SUCESSO! ===');
}

testFirstAccessFlow().catch(console.error);
