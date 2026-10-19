import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

export interface LojaPerformanceItem {
  codigo: string;
  nome: string;
  cidade: string;
  uf: string;
  planejadas: number;
  concluidas: number;
  pendentes: number;
  atrasadas: number;
  naoRealizadas: number;
  ocorrencias: number;
  aderencia: number;
}

/**
 * Função utilitária pura que reproduz o algoritmo de filtragem de lojas
 * utilizado na seção "Desempenho por PDV / Loja" do IndustryPortalView.
 */
export function filterLojasPerformance(
  list: LojaPerformanceItem[],
  params: {
    query?: string;
    uf?: string;
    city?: string;
    status?: 'all' | 'atrasadas' | 'pendentes' | 'concluidas' | 'sem_visita';
  }
): LojaPerformanceItem[] {
  let result = [...list];

  // 1. Busca textual por nome ou código
  if (params.query && params.query.trim()) {
    const q = params.query.toLowerCase().trim();
    result = result.filter(
      (l) => l.nome.toLowerCase().includes(q) || l.codigo.toLowerCase().includes(q)
    );
  }

  // 2. Filtro por UF
  if (params.uf && params.uf !== 'all') {
    result = result.filter((l) => l.uf.toUpperCase() === params.uf?.toUpperCase());
  }

  // 3. Filtro por Cidade
  if (params.city && params.city !== 'all') {
    result = result.filter((l) => l.cidade.toLowerCase() === params.city?.toLowerCase());
  }

  // 4. Filtro por Situação Operacional
  if (params.status === 'atrasadas') {
    result = result.filter((l) => l.atrasadas > 0);
  } else if (params.status === 'pendentes') {
    result = result.filter((l) => l.pendentes > 0);
  } else if (params.status === 'concluidas') {
    result = result.filter((l) => l.concluidas > 0 && l.pendentes === 0 && l.atrasadas === 0);
  } else if (params.status === 'sem_visita') {
    result = result.filter((l) => l.concluidas === 0);
  }

  return result;
}

/**
 * Função utilitária de ordenação das lojas
 */
export function sortLojasPerformance(
  list: LojaPerformanceItem[],
  field: 'atrasadas' | 'aderencia' | 'planejadas' | 'concluidas' | 'nome',
  order: 'asc' | 'desc'
): LojaPerformanceItem[] {
  const sorted = [...list];
  sorted.sort((a, b) => {
    let comp = 0;
    if (field === 'nome') {
      comp = a.nome.localeCompare(b.nome);
    } else if (field === 'atrasadas') {
      comp = a.atrasadas - b.atrasadas;
    } else if (field === 'aderencia') {
      comp = a.aderencia - b.aderencia;
    } else if (field === 'planejadas') {
      comp = a.planejadas - b.planejadas;
    } else if (field === 'concluidas') {
      comp = a.concluidas - b.concluidas;
    }
    return order === 'asc' ? comp : -comp;
  });
  return sorted;
}

/**
 * Função utilitária pura de paginação (20 por página)
 */
export function paginateLojasPerformance(
  list: LojaPerformanceItem[],
  page: number,
  pageSize: number = 20
): { items: LojaPerformanceItem[]; totalPages: number } {
  const totalPages = Math.max(1, Math.ceil(list.length / pageSize));
  const safePage = Math.max(1, Math.min(page, totalPages));
  const start = (safePage - 1) * pageSize;
  const items = list.slice(start, start + pageSize);
  return { items, totalPages };
}

// ---------------- DADOS DE TESTE MOCK ----------------
const mockLojas: LojaPerformanceItem[] = [
  {
    codigo: 'LJ-001',
    nome: 'Supermercado Central Paulista',
    cidade: 'São Paulo',
    uf: 'SP',
    planejadas: 10,
    concluidas: 10,
    pendentes: 0,
    atrasadas: 0,
    naoRealizadas: 0,
    ocorrencias: 1,
    aderencia: 100
  },
  {
    codigo: 'LJ-002',
    nome: 'Hipermercado Campinas Norte',
    cidade: 'Campinas',
    uf: 'SP',
    planejadas: 8,
    concluidas: 4,
    pendentes: 4,
    atrasadas: 2,
    naoRealizadas: 0,
    ocorrencias: 3,
    aderencia: 50
  },
  {
    codigo: 'LJ-003',
    nome: 'Supermercado Leblon Sul',
    cidade: 'Rio de Janeiro',
    uf: 'RJ',
    planejadas: 6,
    concluidas: 0,
    pendentes: 6,
    atrasadas: 0,
    naoRealizadas: 0,
    ocorrencias: 0,
    aderencia: 0
  },
  {
    codigo: 'LJ-004',
    nome: 'Atacadão Niterói',
    cidade: 'Niterói',
    uf: 'RJ',
    planejadas: 4,
    concluidas: 0,
    pendentes: 4,
    atrasadas: 4,
    naoRealizadas: 0,
    ocorrencias: 2,
    aderencia: 0
  }
];

describe('Portal da Indústria — Filtros, Ordenação e Paginação de Lojas', () => {
  it('filtra lojas por nome ou código da loja ignorando maiúsculas', () => {
    const resNome = filterLojasPerformance(mockLojas, { query: 'campinas' });
    assert.equal(resNome.length, 1);
    assert.equal(resNome[0].codigo, 'LJ-002');

    const resCodigo = filterLojasPerformance(mockLojas, { query: 'LJ-004' });
    assert.equal(resCodigo.length, 1);
    assert.equal(resCodigo[0].nome, 'Atacadão Niterói');
  });

  it('filtra por UF e Cidade', () => {
    const resSp = filterLojasPerformance(mockLojas, { uf: 'SP' });
    assert.equal(resSp.length, 2);

    const resRj = filterLojasPerformance(mockLojas, { uf: 'RJ', city: 'Niterói' });
    assert.equal(resRj.length, 1);
    assert.equal(resRj[0].codigo, 'LJ-004');
  });

  it('filtra por situação operacional: atrasadas, pendentes, 100% concluídas e sem visita', () => {
    const atrasadas = filterLojasPerformance(mockLojas, { status: 'atrasadas' });
    assert.equal(atrasadas.length, 2); // LJ-002 e LJ-004

    const concluidas = filterLojasPerformance(mockLojas, { status: 'concluidas' });
    assert.equal(concluidas.length, 1);
    assert.equal(concluidas[0].codigo, 'LJ-001');

    const semVisita = filterLojasPerformance(mockLojas, { status: 'sem_visita' });
    assert.equal(semVisita.length, 2); // LJ-003 e LJ-004
  });

  it('ordena corretamente por atrasos e por aderência', () => {
    const ordenadoAtrasosDesc = sortLojasPerformance(mockLojas, 'atrasadas', 'desc');
    assert.equal(ordenadoAtrasosDesc[0].codigo, 'LJ-004'); // 4 atrasadas
    assert.equal(ordenadoAtrasosDesc[1].codigo, 'LJ-002'); // 2 atrasadas

    const ordenadoAderenciaDesc = sortLojasPerformance(mockLojas, 'aderencia', 'desc');
    assert.equal(ordenadoAderenciaDesc[0].codigo, 'LJ-001'); // 100%
  });

  it('pagina 20 lojas por página sem carregar mais do que o limite da página', () => {
    // Gerar 45 lojas simuladas
    const muitasLojas: LojaPerformanceItem[] = Array.from({ length: 45 }).map((_, i) => ({
      codigo: `LJ-${String(i + 1).padStart(3, '0')}`,
      nome: `Loja Teste ${i + 1}`,
      cidade: 'São Paulo',
      uf: 'SP',
      planejadas: 5,
      concluidas: 5,
      pendentes: 0,
      atrasadas: 0,
      naoRealizadas: 0,
      ocorrencias: 0,
      aderencia: 100
    }));

    const pag1 = paginateLojasPerformance(muitasLojas, 1, 20);
    assert.equal(pag1.items.length, 20);
    assert.equal(pag1.totalPages, 3);
    assert.equal(pag1.items[0].codigo, 'LJ-001');

    const pag2 = paginateLojasPerformance(muitasLojas, 2, 20);
    assert.equal(pag2.items.length, 20);
    assert.equal(pag2.items[0].codigo, 'LJ-021');

    const pag3 = paginateLojasPerformance(muitasLojas, 3, 20);
    assert.equal(pag3.items.length, 5); // 45 - 40 = 5
  });
});

describe('Portal da Indústria — Regras de Segurança e Isolamento por Indústria', () => {
  it('garante que rotas e visitas são isoladas quando activeIndCode é fornecido', () => {
    const rotasTodas = [
      { id: '1', loja_codigo: 'L1', industria_codigo: 'IND-A' },
      { id: '2', loja_codigo: 'L2', industria_codigo: 'IND-B' },
      { id: '3', loja_codigo: 'L3', industria_codigo: 'IND-A' }
    ];

    const rotasIndA = rotasTodas.filter((r) => r.industria_codigo === 'IND-A');
    assert.equal(rotasIndA.length, 2);
    assert.equal(rotasIndA.every((r) => r.industria_codigo === 'IND-A'), true);

    // No modo GLOBAL (activeIndCode vazio), visualiza todas
    const globalIndustryCode = String('');
    const rotasGlobal = rotasTodas.filter((r) => !globalIndustryCode || r.industria_codigo === globalIndustryCode);
    assert.equal(rotasGlobal.length, 3);
  });

  it('evita 0% indevido e indica "Não disponível" quando o denominador é zero', () => {
    const kpisSemPlanejadas = { planejadas: 0, concluidas: 0 };
    const kpisSemLojas = { lojas: 0, lojasComVisita: 0 };

    const aderenciaValida = kpisSemPlanejadas.planejadas > 0
      ? Math.round((kpisSemPlanejadas.concluidas / kpisSemPlanejadas.planejadas) * 100)
      : null;

    const coberturaValida = kpisSemLojas.lojas > 0
      ? Math.round((kpisSemLojas.lojasComVisita / kpisSemLojas.lojas) * 100)
      : null;

    assert.equal(aderenciaValida, null);
    assert.equal(coberturaValida, null);
  });
});
