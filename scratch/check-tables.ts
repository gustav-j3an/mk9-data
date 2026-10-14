import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!);

async function checkTables() {
  const tables = ['industrias', 'lojas', 'promotores', 'rotas', 'visits', 'visit_checklist_items', 'visit_photos', 'visit_occurrences', 'visit_product_validity', 'notifications'];
  for (const t of tables) {
    const { error, count } = await supabase.from(t).select('*', { count: 'exact', head: true });
    console.log(`Table ${t}:`, error ? `ERROR: ${error.message}` : `EXISTS (count: ${count})`);
  }
}

checkTables();
