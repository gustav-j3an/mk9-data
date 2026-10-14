import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { supabase } from '../src/lib/supabase';
import { fetchSystemSettings } from '../src/lib/systemSettings';

async function testAuthFetch() {
  // Simular login ou testar com usuário
  console.log('Testing unauthenticated fetch:');
  const unauth = await fetchSystemSettings();
  console.log('Unauthenticated result:', unauth);

  // Testar se permitirmos SELECT para anon também
}

testAuthFetch();
