import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';

// 1. Carrega as variáveis de ambiente somente-leitura do backup de produção
const envConfig = dotenv.parse(fs.readFileSync('.env.local.bak'));
const supabaseUrl = envConfig.VITE_SUPABASE_URL;
const supabaseKey = envConfig.VITE_SUPABASE_PUBLISHABLE_KEY || envConfig.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('ERRO: VITE_SUPABASE_URL ou chave pública não encontradas em .env.local.bak');
  process.exit(1);
}

// Cria cliente Supabase configurado estritamente com a chave pública/anônima
const client = createClient(supabaseUrl, supabaseKey);

// Função auxiliar para busca paginada exclusivamente com SELECT
async function fetchAllRows(tableName: string) {
  const PAGE_SIZE = 1000;
  let from = 0;
  let allRows: any[] = [];
  let hasMore = true;

  while (hasMore) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await client
      .from(tableName)
      .select('*')
      .range(from, to);

    if (error) {
      throw new Error(`Falha ao ler tabela ${tableName}: ${error.message}`);
    }

    if (data && data.length > 0) {
      allRows = allRows.concat(data);
      if (data.length < PAGE_SIZE) {
        hasMore = false;
      } else {
        from += PAGE_SIZE;
      }
    } else {
      hasMore = false;
    }
  }

  return allRows;
}

async function dryRunPreview() {
  console.log('=== EXECUÇÃO DE DIAGNÓSTICO E PREVIEW (SOMENTE LEITURA) ===');
  
  const industrias = await fetchAllRows('industrias');
  const lojas = await fetchAllRows('lojas');
  const promotores = await fetchAllRows('promotores');
  const rotas = await fetchAllRows('rotas');

  console.log(`\nRegistros na Origem:`);
  console.log(`- industrias: ${industrias.length}`);
  console.log(`- lojas: ${lojas.length}`);
  console.log(`- promotores: ${promotores.length}`);
  console.log(`- rotas: ${rotas.length}`);

  // Conjuntos de chaves para validação de integridade referencial
  const industriasCodigos = new Set(industrias.map((i: any) => i.codigo));
  const lojasCodigos = new Set(lojas.map((l: any) => l.codigo));
  const promotoresMatriculas = new Set(promotores.map((p: any) => p.matricula));

  // Validação de chaves estrangeiras em rotas
  let rotasOrfas = 0;
  const rotasComErro: any[] = [];

  rotas.forEach((r: any) => {
    const hasInd = industriasCodigos.has(r.industria_codigo);
    const hasLoj = lojasCodigos.has(r.loja_codigo);
    const hasPrm = promotoresMatriculas.has(r.promotor_matricula);

    if (!hasInd || !hasLoj || !hasPrm) {
      rotasOrfas++;
      rotasComErro.push({
        id: r.id,
        codigo_rota: r.codigo_rota,
        industria_ok: hasInd,
        loja_ok: hasLoj,
        promotor_ok: hasPrm
      });
    }
  });

  // Busca do Yuri
  const yuri = promotores.find((p: any) => p.nome && p.nome.toLowerCase().includes('yuri'));
  console.log('\nVerificação do Promotor Alvo:');
  if (yuri) {
    const rotasYuri = rotas.filter((r: any) => r.promotor_matricula === yuri.matricula);
    console.log(`- Promotor encontrado: ${yuri.nome} (Matrícula: ${yuri.matricula})`);
    console.log(`- Rotas associadas ao Yuri: ${rotasYuri.length}`);
  } else {
    console.log('- Promotor "Yuri" não localizado pelo nome parcial.');
  }

  console.log('\nValidação de Integridade Referencial Prévia:');
  console.log(`- Rotas órfãs ou com FK quebrada: ${rotasOrfas}`);

  console.log('\nStatus: Preview concluído com sucesso. NENHUM DADO FOI ESCRITO.');
}

dryRunPreview().catch((err) => {
  console.error('Erro na execução do preview:', err.message);
  process.exit(1);
});
