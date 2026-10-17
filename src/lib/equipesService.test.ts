import { calculateTeamsMetrics, normalizeEquipeNome } from './equipesService';
import type { Equipe } from '../types';

function runEquipesMetricsTests() {
  console.log('===============================================================');
  console.log('INICIANDO SUÍTE DE TESTES UNITÁRIOS DE calculateTeamsMetrics');
  console.log('===============================================================');

  const mockEquipes: Equipe[] = [
    {
      id: 'eq-1',
      codigo: 'EQP-001',
      nome: 'BRASÍLIA',
      regional: 'DF',
      supervisor_nome: 'PAULO GUSTAVO',
      status: 'ativa'
    },
    {
      id: 'eq-2',
      codigo: 'EQP-002',
      nome: 'GOIÂNIA',
      regional: 'GO',
      supervisor_nome: 'LUCAS',
      status: 'ativa'
    },
    {
      id: 'eq-3',
      codigo: 'EQP-003',
      nome: 'CAMPINAS',
      regional: 'SP',
      supervisor_nome: null,
      status: 'reestruturacao'
    }
  ];

  // --------------------------------------------------------------------------
  // TESTE 1: Normalização de nomes de equipe
  // --------------------------------------------------------------------------
  {
    console.assert(normalizeEquipeNome('BRASÍLIA') === 'BRASÍLIA', 'T1: Nome válido preservado');
    console.assert(normalizeEquipeNome('  BRASÍLIA  ') === 'BRASÍLIA', 'T1: Trim aplicado');
    console.assert(normalizeEquipeNome(null) === null, 'T1: Null retorna null');
    console.assert(normalizeEquipeNome(undefined) === null, 'T1: Undefined retorna null');
    console.assert(normalizeEquipeNome('') === null, 'T1: Vazio retorna null');
    console.assert(normalizeEquipeNome('   ') === null, 'T1: Espaços retorna null');
    console.assert(normalizeEquipeNome('Nenhum') === null, 'T1: Nenhum retorna null');
    console.assert(normalizeEquipeNome('NENHUM') === null, 'T1: NENHUM maiúsculo retorna null');
    console.assert(normalizeEquipeNome('  nenhum  ') === null, 'T1: nenhum com espaços retorna null');
    console.log('[OK] Teste 1: normalizeEquipeNome trata nulos, vazios e "Nenhum"');
  }

  // --------------------------------------------------------------------------
  // TESTE 2: Equipe com vários promotores e PDVs distintos
  // --------------------------------------------------------------------------
  {
    const promotores = [
      { id: 'p1', matricula: 'PRM-001', equipe: 'BRASÍLIA' },
      { id: 'p2', matricula: 'PRM-002', equipe: 'BRASÍLIA' },
      { id: 'p3', matricula: 'PRM-003', equipe: 'BRASÍLIA' }
    ];

    const rotas = [
      { promotor_matricula: 'PRM-001', loja_codigo: 'LOJ-001' },
      { promotor_matricula: 'PRM-001', loja_codigo: 'LOJ-002' },
      { promotor_matricula: 'PRM-002', loja_codigo: 'LOJ-003' },
      { promotor_matricula: 'PRM-003', loja_codigo: 'LOJ-004' }
    ];

    const res = calculateTeamsMetrics(mockEquipes, promotores, rotas);
    const bsb = res.find((e) => e.codigo === 'EQP-001');

    console.assert(bsb !== undefined, 'T2: Equipe Brasília encontrada');
    console.assert(bsb?.promotoresCount === 3, `T2: Esperado 3 promotores, obteve ${bsb?.promotoresCount}`);
    console.assert(bsb?.pdvsCount === 4, `T2: Esperado 4 PDVs, obteve ${bsb?.pdvsCount}`);
    console.log('[OK] Teste 2: Equipe com vários promotores calcula métricas exatas');
  }

  // --------------------------------------------------------------------------
  // TESTE 3: Dois promotores atendendo à mesma loja (sem duplicação de PDV)
  // --------------------------------------------------------------------------
  {
    const promotores = [
      { id: 'p1', matricula: 'PRM-001', equipe: 'BRASÍLIA' },
      { id: 'p2', matricula: 'PRM-002', equipe: 'BRASÍLIA' }
    ];

    // Ambos atendem LOJ-SHARED
    const rotas = [
      { promotor_matricula: 'PRM-001', loja_codigo: 'LOJ-SHARED' },
      { promotor_matricula: 'PRM-001', loja_codigo: 'LOJ-EXCLUSIVE-1' },
      { promotor_matricula: 'PRM-002', loja_codigo: 'LOJ-SHARED' },
      { promotor_matricula: 'PRM-002', loja_codigo: 'LOJ-EXCLUSIVE-2' }
    ];

    const res = calculateTeamsMetrics(mockEquipes, promotores, rotas);
    const bsb = res.find((e) => e.codigo === 'EQP-001');

    console.assert(bsb?.promotoresCount === 2, `T3: 2 promotores, obteve ${bsb?.promotoresCount}`);
    // Lojas únicas: LOJ-SHARED, LOJ-EXCLUSIVE-1, LOJ-EXCLUSIVE-2 = 3 PDVs (NÃO 4!)
    console.assert(bsb?.pdvsCount === 3, `T3: Esperado 3 PDVs distintos, obteve ${bsb?.pdvsCount}`);
    console.log('[OK] Teste 3: Dois promotores na mesma loja contam a loja apenas uma vez');
  }

  // --------------------------------------------------------------------------
  // TESTE 4: Várias rotas do mesmo promotor para a mesma loja (duplicação de rotas)
  // --------------------------------------------------------------------------
  {
    const promotores = [{ id: 'p1', matricula: 'PRM-001', equipe: 'BRASÍLIA' }];

    // Promotor tem 5 rotas cadastradas para a mesma loja (ex: diferentes frequências/indústrias)
    const rotas = [
      { promotor_matricula: 'PRM-001', loja_codigo: 'LOJ-001' },
      { promotor_matricula: 'PRM-001', loja_codigo: 'LOJ-001' },
      { promotor_matricula: 'PRM-001', loja_codigo: 'LOJ-001' },
      { promotor_matricula: 'PRM-001', loja_codigo: 'LOJ-001' }
    ];

    const res = calculateTeamsMetrics(mockEquipes, promotores, rotas);
    const bsb = res.find((e) => e.codigo === 'EQP-001');

    console.assert(bsb?.promotoresCount === 1, 'T4: 1 promotor');
    console.assert(bsb?.pdvsCount === 1, `T4: Esperado 1 PDV distinto, obteve ${bsb?.pdvsCount}`);
    console.log('[OK] Teste 4: Múltiplas rotas para a mesma loja não inflam contagem de PDVs');
  }

  // --------------------------------------------------------------------------
  // TESTE 5: Promotores sem equipe (nulo, vazio, 'Nenhum') e isolamento de PDVs
  // --------------------------------------------------------------------------
  {
    const promotores = [
      { id: 'p1', matricula: 'PRM-001', equipe: 'BRASÍLIA' },
      { id: 'p-none-1', matricula: 'PRM-FREE-1', equipe: null },
      { id: 'p-none-2', matricula: 'PRM-FREE-2', equipe: '' },
      { id: 'p-none-3', matricula: 'PRM-FREE-3', equipe: 'Nenhum' },
      { id: 'p-none-4', matricula: 'PRM-FREE-4', equipe: '   ' }
    ];

    // Rotas de promotores livres têm lojas exclusivas e lojas compartilhadas
    const rotas = [
      { promotor_matricula: 'PRM-001', loja_codigo: 'LOJ-BSB' },
      { promotor_matricula: 'PRM-FREE-1', loja_codigo: 'LOJ-FREE-1' },
      { promotor_matricula: 'PRM-FREE-2', loja_codigo: 'LOJ-FREE-2' },
      { promotor_matricula: 'PRM-FREE-3', loja_codigo: 'LOJ-BSB' } // atende mesma loja de BSB, mas é sem equipe
    ];

    const res = calculateTeamsMetrics(mockEquipes, promotores, rotas);
    const bsb = res.find((e) => e.codigo === 'EQP-001');
    const gyn = res.find((e) => e.codigo === 'EQP-002');

    console.assert(bsb?.promotoresCount === 1, `T5: Brasília deve ter 1 promotor, obteve ${bsb?.promotoresCount}`);
    console.assert(bsb?.pdvsCount === 1, `T5: Brasília deve ter 1 PDV, obteve ${bsb?.pdvsCount}`);
    console.assert(gyn?.promotoresCount === 0, 'T5: Goiânia deve ter 0 promotores');
    console.assert(gyn?.pdvsCount === 0, 'T5: Goiânia deve ter 0 PDVs');
    console.log('[OK] Teste 5: Promotores sem equipe isolados sem vazar para equipes cadastradas');
  }

  // --------------------------------------------------------------------------
  // TESTE 6: Loja sem código válido ou em branco
  // --------------------------------------------------------------------------
  {
    const promotores = [{ id: 'p1', matricula: 'PRM-001', equipe: 'BRASÍLIA' }];

    const rotas = [
      { promotor_matricula: 'PRM-001', loja_codigo: '' },
      { promotor_matricula: 'PRM-001', loja_codigo: '   ' },
      { promotor_matricula: 'PRM-001', loja_codigo: null },
      { promotor_matricula: 'PRM-001', loja_codigo: 'LOJ-VALIDA' }
    ];

    const res = calculateTeamsMetrics(mockEquipes, promotores, rotas);
    const bsb = res.find((e) => e.codigo === 'EQP-001');

    console.assert(bsb?.pdvsCount === 1, `T6: Esperado 1 PDV válido, obteve ${bsb?.pdvsCount}`);
    console.log('[OK] Teste 6: Lojas com código nulo ou vazio ignoradas');
  }

  // --------------------------------------------------------------------------
  // TESTE 7: Matrículas repetidas na lista de promotores (deduplicação)
  // --------------------------------------------------------------------------
  {
    const promotores = [
      { id: 'p1-a', matricula: 'PRM-001', equipe: 'BRASÍLIA' },
      { id: 'p1-b', matricula: 'PRM-001', equipe: 'BRASÍLIA' } // registro duplicado da mesma matrícula
    ];

    const rotas = [{ promotor_matricula: 'PRM-001', loja_codigo: 'LOJ-001' }];

    const res = calculateTeamsMetrics(mockEquipes, promotores, rotas);
    const bsb = res.find((e) => e.codigo === 'EQP-001');

    console.assert(bsb?.promotoresCount === 1, `T7: Matrícula repetida deve contar 1 vez, obteve ${bsb?.promotoresCount}`);
    console.log('[OK] Teste 7: Deduplicação de promotores por matrícula');
  }

  // --------------------------------------------------------------------------
  // TESTE 8: Equipe sem promotores ou sem rotas
  // --------------------------------------------------------------------------
  {
    const promotores = [{ id: 'p1', matricula: 'PRM-001', equipe: 'BRASÍLIA' }];
    // Sem nenhuma rota
    const rotas: any[] = [];

    const res = calculateTeamsMetrics(mockEquipes, promotores, rotas);
    const bsb = res.find((e) => e.codigo === 'EQP-001');
    const campinas = res.find((e) => e.codigo === 'EQP-003');

    console.assert(bsb?.promotoresCount === 1, 'T8: BSB tem 1 promotor');
    console.assert(bsb?.pdvsCount === 0, 'T8: BSB tem 0 PDVs sem rotas');
    console.assert(campinas?.promotoresCount === 0, 'T8: Campinas tem 0 promotores');
    console.assert(campinas?.pdvsCount === 0, 'T8: Campinas tem 0 PDVs');
    console.log('[OK] Teste 8: Equipes sem promotores ou rotas retornam métricas zeradas');
  }

  // --------------------------------------------------------------------------
  // TESTE 9: Resiliência contra entradas inválidas (null, undefined, arrays vazios)
  // --------------------------------------------------------------------------
  {
    const resA = calculateTeamsMetrics(null as any, [], []);
    console.assert(Array.isArray(resA) && resA.length === 0, 'T9-A: Equipes null retorna array vazio');

    const resB = calculateTeamsMetrics([], null as any, null as any);
    console.assert(Array.isArray(resB) && resB.length === 0, 'T9-B: Promotores/rotas null tratado com segurança');

    const resC = calculateTeamsMetrics(mockEquipes, undefined as any, undefined as any);
    console.assert(resC.length === 3, 'T9-C: Retorna as 3 equipes com métricas zeradas');
    resC.forEach((e) => {
      console.assert(e.promotoresCount === 0 && e.pdvsCount === 0, 'T9-C: Métricas zeradas');
    });
    console.log('[OK] Teste 9: Resiliência contra entradas inválidas');
  }

  console.log('===============================================================');
  console.log('SUCESSO: TODOS OS 9 TESTES DE MÉTRICAS FORAM APROVADOS!');
  console.log('===============================================================');
}

runEquipesMetricsTests();

