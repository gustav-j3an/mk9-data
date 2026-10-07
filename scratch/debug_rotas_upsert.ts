import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function testUpdateOrInsertRota() {
  const authEmail = `import_runner_${Date.now()}@mk9trade.com.br`;
  await supabase.auth.signUp({ email: authEmail, password: 'MK9ImportPass2026!' });

  const payload = {
    codigo_rota: 'ROT-PRM-024-LOJ-0097-IND-001',
    industria_codigo: 'IND-001',
    loja_codigo: 'LOJ-0097',
    promotor_matricula: 'PRM-024',
    uf: 'GO',
    frequencia: 'SEMANAL',
    segunda: false,
    terca: false,
    quarta: false,
    quinta: false,
    sexta: true,
    sabado: false,
    domingo: false
  };

  const { data: existing } = await supabase
    .from('rotas')
    .select('id')
    .eq('promotor_matricula', payload.promotor_matricula)
    .eq('loja_codigo', payload.loja_codigo)
    .eq('industria_codigo', payload.industria_codigo)
    .maybeSingle();

  if (existing) {
    const res = await supabase.from('rotas').update(payload).eq('id', existing.id);
    console.log('Update result error:', res.error);
  } else {
    const res = await supabase.from('rotas').insert([payload]);
    console.log('Insert result error:', res.error);
  }
}

testUpdateOrInsertRota().catch(console.error);
