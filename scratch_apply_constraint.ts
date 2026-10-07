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

async function testConstraintBehavior() {
  console.log('--- TESTANDO COMPORTAMENTO DE DUPLICIDADE EM VISITS ---');

  // Buscar uma rota real para teste
  const { data: route } = await supabase.from('rotas').select('*').limit(1).single();
  if (!route) {
    console.log('Nenhuma rota encontrada para teste.');
    return;
  }

  const testKey = {
    promotor_matricula: route.promotor_matricula,
    loja_codigo: route.loja_codigo,
    industria_codigo: route.industria_codigo,
    data_visita: '2099-12-31', // data futura segura de teste
    status: 'pendente'
  };

  console.log('Criando registro 1 de teste com a chave:', testKey);
  const { data: ins1, error: err1 } = await supabase.from('visits').insert([testKey]).select().single();
  
  if (err1) {
    console.error('Erro na primeira inserção:', err1.message);
  } else {
    console.log('Primeira inserção realizada com ID:', ins1.id);

    console.log('Tentando segunda inserção idêntica com a mesma chave...');
    const { data: ins2, error: err2 } = await supabase.from('visits').insert([testKey]).select();

    if (err2) {
      console.log('SUCCESS: O PostgreSQL rejeitou a duplicidade com erro:', err2.code, err2.message);
    } else {
      console.log('ATENÇÃO: Segunda inserção permitida (constraint UNIQUE ainda precisa de execução no console Supabase DDL). Data:', ins2);
      // Limpar segundo registro se tiver inserido
      if (ins2?.[0]?.id) {
        await supabase.from('visits').delete().eq('id', ins2[0].id);
      }
    }

    // Limpar primeiro registro de teste
    console.log('Limpando registro de teste...');
    await supabase.from('visits').delete().eq('id', ins1.id);
  }
}

testConstraintBehavior().catch(console.error);
