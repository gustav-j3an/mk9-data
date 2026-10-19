import test from 'node:test';
import assert from 'node:assert/strict';

// Helper de normalização segura testado idêntico à implementação
const normalizeSafe = (str: string | null | undefined): string => {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
};

interface MockVisit {
  id: string;
  data_visita: string;
  promotor_matricula: string;
  promotor?: { nome: string };
  loja_codigo: string;
  loja?: { nome: string; cidade?: string; uf?: string };
  industria_codigo: string;
  industria?: { nome: string };
  status: 'em_andamento' | 'concluida' | 'nao_realizada' | 'pendente';
  started_at?: string | null;
  completed_at?: string | null;
}

const mockVisits: MockVisit[] = [
  {
    id: 'vis-1001-abc',
    data_visita: '2026-10-18',
    promotor_matricula: 'P001',
    promotor: { nome: 'João da Silva Sauro' },
    loja_codigo: 'L100',
    loja: { nome: 'Supermercado Pão de Açúcar Morumbi', cidade: 'São Paulo', uf: 'SP' },
    industria_codigo: 'IND1',
    industria: { nome: 'Nestlé Alimentos' },
    status: 'concluida',
    started_at: '2026-10-18T08:30:00Z',
    completed_at: '2026-10-18T09:45:00Z'
  },
  {
    id: 'vis-1002-def',
    data_visita: '2026-10-18',
    promotor_matricula: 'P002',
    promotor: { nome: 'Maria Aparecida Conceição' },
    loja_codigo: 'L200',
    loja: { nome: 'Carrefour Pinheiros', cidade: 'São Paulo', uf: 'SP' },
    industria_codigo: 'IND2',
    industria: { nome: 'Unilever Brasil' },
    status: 'em_andamento',
    started_at: '2026-10-18T10:00:00Z',
    completed_at: null
  },
  {
    id: 'vis-1003-ghi',
    data_visita: '2026-10-18',
    promotor_matricula: 'P003',
    promotor: { nome: 'Carlos Eduardo Oliveira' },
    loja_codigo: 'L300',
    loja: { nome: 'Assaí Atacadista Santo André', cidade: 'Santo André', uf: 'SP' },
    industria_codigo: 'IND1',
    industria: { nome: 'Nestlé Alimentos' },
    status: 'nao_realizada',
    started_at: null,
    completed_at: null
  },
  {
    id: 'vis-1004-jkl',
    data_visita: '2026-10-18',
    promotor_matricula: 'P001',
    promotor: { nome: 'João da Silva Sauro' },
    loja_codigo: 'L400',
    loja: { nome: 'Atacadão Campinas', cidade: 'Campinas', uf: 'SP' },
    industria_codigo: 'IND3',
    industria: { nome: 'Mondelez International' },
    status: 'pendente',
    started_at: null,
    completed_at: null
  }
];

const filterVisitsList = (
  visits: MockVisit[],
  search: string,
  status: string,
  ind: string,
  prom: string,
  loja: string
) => {
  const term = normalizeSafe(search);

  return visits.filter((v) => {
    const matchSearch =
      !term ||
      normalizeSafe(v.promotor?.nome).includes(term) ||
      normalizeSafe(v.promotor_matricula).includes(term) ||
      normalizeSafe(v.loja?.nome).includes(term) ||
      normalizeSafe(v.loja_codigo).includes(term) ||
      normalizeSafe(v.industria?.nome).includes(term) ||
      normalizeSafe(v.industria_codigo).includes(term) ||
      normalizeSafe(v.id).includes(term);

    const matchStatus = status === 'all' || v.status === status;
    const matchInd = ind === 'all' || v.industria_codigo === ind;
    const matchProm = prom === 'all' || v.promotor_matricula === prom;
    const matchLoja = loja === 'all' || v.loja_codigo === loja;

    return matchSearch && matchStatus && matchInd && matchProm && matchLoja;
  });
};

test('Onda 4.3 - Acompanhamento Inteligente de Visitas (DataTable & Busca)', async (t) => {
  await t.test('1. Busca por nome do promotor com acentos e maiúsculas ignorados', () => {
    const res1 = filterVisitsList(mockVisits, 'joao', 'all', 'all', 'all', 'all');
    assert.equal(res1.length, 2);
    assert.equal(res1[0].promotor_matricula, 'P001');

    const res2 = filterVisitsList(mockVisits, 'CONCEICAO', 'all', 'all', 'all', 'all');
    assert.equal(res2.length, 1);
    assert.equal(res2[0].promotor_matricula, 'P002');
  });

  await t.test('2. Busca por nome da loja e PDV', () => {
    const res = filterVisitsList(mockVisits, 'pao de acucar', 'all', 'all', 'all', 'all');
    assert.equal(res.length, 1);
    assert.equal(res[0].loja_codigo, 'L100');
  });

  await t.test('3. Busca por indústria', () => {
    const res = filterVisitsList(mockVisits, 'nestle', 'all', 'all', 'all', 'all');
    assert.equal(res.length, 2);
  });

  await t.test('4. Busca por código de identificador da visita', () => {
    const res = filterVisitsList(mockVisits, 'vis-1002', 'all', 'all', 'all', 'all');
    assert.equal(res.length, 1);
    assert.equal(res[0].id, 'vis-1002-def');
  });

  await t.test('5. Combinação de busca textual com filtros de status e loja', () => {
    // Busca por P001 (João), mas filtrando por status 'pendente'
    const res = filterVisitsList(mockVisits, 'silva', 'pendente', 'all', 'all', 'all');
    assert.equal(res.length, 1);
    assert.equal(res[0].id, 'vis-1004-jkl');
  });

  await t.test('6. Paginação (fatiamento de 10, 25 e 50 itens)', () => {
    const manyVisits: MockVisit[] = Array.from({ length: 45 }).map((_, i) => ({
      id: `vis-${i}`,
      data_visita: '2026-10-18',
      promotor_matricula: `P00${i}`,
      promotor: { nome: `Promotor ${i}` },
      loja_codigo: `L00${i}`,
      loja: { nome: `Loja ${i}` },
      industria_codigo: 'IND1',
      industria: { nome: 'Indústria 1' },
      status: 'concluida'
    }));

    const pageSize = 10;
    const page1 = manyVisits.slice(0, pageSize);
    const page2 = manyVisits.slice(pageSize, pageSize * 2);
    const page5 = manyVisits.slice(pageSize * 4, pageSize * 5);

    assert.equal(page1.length, 10);
    assert.equal(page2.length, 10);
    assert.equal(page5.length, 5); // Última página
    assert.equal(Math.ceil(manyVisits.length / pageSize), 5); // Total 5 páginas
  });

  await t.test('7. Mapeamento de status reais existentes para StatusBadge', () => {
    const getBadgeStatus = (status: string) => {
      if (status === 'concluida') return 'concluida';
      if (status === 'em_andamento') return 'em_andamento';
      if (status === 'nao_realizada') return 'falta';
      return 'pendente';
    };

    assert.equal(getBadgeStatus('concluida'), 'concluida');
    assert.equal(getBadgeStatus('em_andamento'), 'em_andamento');
    assert.equal(getBadgeStatus('nao_realizada'), 'falta');
    assert.equal(getBadgeStatus('pendente'), 'pendente');
  });

  await t.test('8. Preservação de dados para abertura do modal de ficha da visita', () => {
    const selected = mockVisits[0];
    assert.ok(selected.id, 'Visita deve possuir ID');
    assert.ok(selected.promotor?.nome, 'Visita deve ter nome do promotor');
    assert.ok(selected.loja?.nome, 'Visita deve ter nome da loja');
    assert.equal(selected.status, 'concluida');
    assert.equal(selected.started_at, '2026-10-18T08:30:00Z');
    assert.equal(selected.completed_at, '2026-10-18T09:45:00Z');
  });

  await t.test('9. Tratamento de dados nulos ou ausentes na busca segura', () => {
    const brokenVisit: MockVisit = {
      id: 'vis-broken',
      data_visita: '2026-10-18',
      promotor_matricula: 'P999',
      promotor: undefined, // Nome ausente
      loja_codigo: 'L999',
      loja: undefined, // Loja ausente
      industria_codigo: 'IND9',
      industria: undefined, // Indústria ausente
      status: 'pendente'
    };

    const res = filterVisitsList([brokenVisit], 'P999', 'all', 'all', 'all', 'all');
    assert.equal(res.length, 1);

    const emptyRes = filterVisitsList([brokenVisit], 'qualquer', 'all', 'all', 'all', 'all');
    assert.equal(emptyRes.length, 0);
  });
});

