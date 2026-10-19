import test from 'node:test';
import assert from 'node:assert/strict';

// Helper de normalização segura idêntico à implementação da view
const normalizeSafe = (str: string | null | undefined): string => {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
};

interface MockAlertItem {
  id: string;
  prioridade: 'critico' | 'atencao' | 'pendente' | 'resolvido';
  tipo: 'ruptura' | 'validade' | 'visita' | 'aderencia';
  data: string;
  loja: string;
  lojaCodigo: string;
  industria: string;
  industriaCodigo: string;
  promotor: string;
  promotorMatricula: string;
  titulo: string;
  descricao: string;
  origem: string;
  statusVisual: string;
  occurrenceId?: string;
  createdAtTimestamp?: number;
}

interface MockOperationalVisitItem {
  key: string;
  dataStr: string;
  dayOfWeekLabel: string;
  promotorMatricula: string;
  promotorNome: string;
  lojaCodigo: string;
  lojaNome: string;
  lojaCidade?: string;
  lojaUf?: string;
  industriaCodigo: string;
  industriaNome: string;
  frequencia: string;
  status: 'em_andamento' | 'concluida' | 'nao_realizada' | 'pendente';
  isPastOverdue?: boolean;
}

interface MockPromotorSummary {
  matricula: string;
  nome: string;
  totalPlanned: number;
  pendentes: number;
  concluidas: number;
  naoRealizadas: number;
  emAndamento: number;
  aderencia: number;
}

interface MockValidadeItem {
  id: string;
  produtoNome: string;
  quantidade: number;
  dataVencimento: string;
  lote?: string | null;
  observacao?: string | null;
  lojaCodigo: string;
  lojaNome: string;
  industriaCodigo: string;
  industriaNome: string;
  promotorMatricula: string;
  promotorNome: string;
  diffDays: number;
  categoria: 'vencidos' | 'ate3' | 'ate7' | 'ate30' | 'normal';
}

const mockAlerts: MockAlertItem[] = [
  {
    id: 'alert-1',
    prioridade: 'critico',
    tipo: 'ruptura',
    data: '2026-10-18',
    loja: 'Pão de Açúcar Morumbi',
    lojaCodigo: 'LJ-100',
    industria: 'Nestlé',
    industriaCodigo: 'IND-1',
    promotor: 'João da Silva',
    promotorMatricula: 'P001',
    titulo: 'Ruptura: Nescau 400g',
    descricao: 'Produto sem estoque na gôndola frontal',
    origem: 'Ocorrências',
    statusVisual: '🔴 Aberta',
    occurrenceId: 'occ-1',
    createdAtTimestamp: 1000
  },
  {
    id: 'alert-2',
    prioridade: 'atencao',
    tipo: 'validade',
    data: '2026-10-18',
    loja: 'Carrefour Pinheiros',
    lojaCodigo: 'LJ-200',
    industria: 'Unilever',
    industriaCodigo: 'IND-2',
    promotor: 'Maria Conceição',
    promotorMatricula: 'P002',
    titulo: 'Vencimento em 5 dias: Sabão Omo',
    descricao: 'Validade próxima identificada',
    origem: 'Validades',
    statusVisual: '🟠 4–7 dias',
    createdAtTimestamp: 2000
  },
  {
    id: 'alert-3',
    prioridade: 'resolvido',
    tipo: 'ruptura',
    data: '2026-10-17',
    loja: 'Assaí Tamboré',
    lojaCodigo: 'LJ-300',
    industria: 'Bauducco',
    industriaCodigo: 'IND-3',
    promotor: 'Carlos Eduardo',
    promotorMatricula: 'P003',
    titulo: 'Ruptura: Panettone',
    descricao: 'Reposição concluída',
    origem: 'Ocorrências',
    statusVisual: '🟢 Resolvido',
    occurrenceId: 'occ-3',
    createdAtTimestamp: 3000
  }
];

const mockPendencias: MockOperationalVisitItem[] = [
  {
    key: 'p-1',
    dataStr: '2026-10-18',
    dayOfWeekLabel: 'Domingo',
    promotorMatricula: 'P001',
    promotorNome: 'João da Silva Sauro',
    lojaCodigo: 'LJ-100',
    lojaNome: 'Pão de Açúcar Morumbi',
    lojaCidade: 'São Paulo',
    lojaUf: 'SP',
    industriaCodigo: 'IND-1',
    industriaNome: 'Nestlé Alimentos',
    frequencia: 'Diária',
    status: 'pendente',
    isPastOverdue: false
  },
  {
    key: 'p-2',
    dataStr: '2026-10-17',
    dayOfWeekLabel: 'Sábado',
    promotorMatricula: 'P002',
    promotorNome: 'Maria Conceição',
    lojaCodigo: 'LJ-200',
    lojaNome: 'Carrefour Pinheiros',
    lojaCidade: 'São Paulo',
    lojaUf: 'SP',
    industriaCodigo: 'IND-2',
    industriaNome: 'Unilever Brasil',
    frequencia: 'Semanal',
    status: 'pendente',
    isPastOverdue: true
  },
  {
    key: 'p-3',
    dataStr: '2026-10-18',
    dayOfWeekLabel: 'Domingo',
    promotorMatricula: 'P003',
    promotorNome: 'Carlos Oliveira',
    lojaCodigo: 'LJ-300',
    lojaNome: 'Assaí Tamboré',
    lojaCidade: 'Barueri',
    lojaUf: 'SP',
    industriaCodigo: 'IND-3',
    industriaNome: 'Bauducco',
    frequencia: 'Quinzenal',
    status: 'concluida',
    isPastOverdue: false
  }
];

const mockPromotoresSummary: MockPromotorSummary[] = [
  {
    matricula: 'P001',
    nome: 'João da Silva',
    totalPlanned: 10,
    pendentes: 2,
    concluidas: 6,
    naoRealizadas: 1,
    emAndamento: 1,
    aderencia: 60
  },
  {
    matricula: 'P002',
    nome: 'Maria Conceição',
    totalPlanned: 8,
    pendentes: 0,
    concluidas: 7,
    naoRealizadas: 1,
    emAndamento: 0,
    aderencia: 88
  }
];

const mockValidades: MockValidadeItem[] = [
  {
    id: 'val-1',
    produtoNome: 'Iogurte Natural 170g',
    quantidade: 15,
    dataVencimento: '2026-10-16',
    lote: 'LT-9821',
    observacao: 'Gôndola fria',
    lojaCodigo: 'LJ-100',
    lojaNome: 'Pão de Açúcar Morumbi',
    industriaCodigo: 'IND-1',
    industriaNome: 'Nestlé',
    promotorMatricula: 'P001',
    promotorNome: 'João da Silva',
    diffDays: -2,
    categoria: 'vencidos'
  },
  {
    id: 'val-2',
    produtoNome: 'Requeijão Cremoso 200g',
    quantidade: 30,
    dataVencimento: '2026-10-20',
    lote: 'LT-7712',
    observacao: null,
    lojaCodigo: 'LJ-200',
    lojaNome: 'Carrefour Pinheiros',
    industriaCodigo: 'IND-2',
    industriaNome: 'Unilever',
    promotorMatricula: 'P002',
    promotorNome: 'Maria Conceição',
    diffDays: 2,
    categoria: 'ate3'
  }
];

test('Onda 4.4A - normalizeSafe lida com acentuação, maiúsculas e espaços', () => {
  assert.equal(normalizeSafe('São Paulo'), 'sao paulo');
  assert.equal(normalizeSafe('  CONCEIÇÃO  '), 'conceicao');
  assert.equal(normalizeSafe('Nestlé Alimentos'), 'nestle alimentos');
  assert.equal(normalizeSafe(null), '');
  assert.equal(normalizeSafe(undefined), '');
});

test('Onda 4.4A - Filtro de Alertas com busca diacrítico-insensível e prioridade', () => {
  // 1. Busca por nome do promotor com acento vs sem acento
  const searchAcento = 'joao';
  const filtrados = mockAlerts.filter((item) => {
    const term = normalizeSafe(searchAcento);
    return (
      normalizeSafe(item.promotor).includes(term) ||
      normalizeSafe(item.loja).includes(term) ||
      normalizeSafe(item.industria).includes(term)
    );
  });
  assert.equal(filtrados.length, 1);
  assert.equal(filtrados[0].id, 'alert-1');

  // 2. Filtro de prioridade "active" exclui resolvidos
  const ativos = mockAlerts.filter((item) => item.prioridade !== 'resolvido');
  assert.equal(ativos.length, 2);
  assert.ok(ativos.every((a) => a.prioridade !== 'resolvido'));

  // 3. Filtro específico "critico"
  const criticos = mockAlerts.filter((item) => item.prioridade === 'critico');
  assert.equal(criticos.length, 1);
  assert.equal(criticos[0].id, 'alert-1');
});

test('Onda 4.4A - Filtro de Pendências de Rotas com status e busca por indústria/loja', () => {
  // 1. Busca por indústria 'nestle'
  const termo = normalizeSafe('nestle');
  const porInd = mockPendencias.filter((item) => {
    return normalizeSafe(item.industriaNome).includes(termo);
  });
  assert.equal(porInd.length, 1);
  assert.equal(porInd[0].promotorMatricula, 'P001');

  // 2. Filtro de pendentes com identificação de atrasada
  const pendentes = mockPendencias.filter((p) => p.status === 'pendente');
  assert.equal(pendentes.length, 2);
  const atrasadas = pendentes.filter((p) => p.isPastOverdue);
  assert.equal(atrasadas.length, 1);
  assert.equal(atrasadas[0].key, 'p-2');
});

test('Onda 4.4A - Resumo por Promotor com busca diacrítico-insensível', () => {
  const termo = normalizeSafe('conceicao');
  const filtrados = mockPromotoresSummary.filter((p) => {
    return normalizeSafe(p.nome).includes(termo) || normalizeSafe(p.matricula).includes(termo);
  });
  assert.equal(filtrados.length, 1);
  assert.equal(filtrados[0].matricula, 'P002');
  assert.equal(filtrados[0].aderencia, 88);
});

test('Onda 4.4A - Monitoramento de Validades com categorias e busca por produto/lote', () => {
  // 1. Busca por lote
  const termLote = normalizeSafe('9821');
  const porLote = mockValidades.filter((v) => normalizeSafe(v.lote).includes(termLote));
  assert.equal(porLote.length, 1);
  assert.equal(porLote[0].produtoNome, 'Iogurte Natural 170g');

  // 2. Filtro por categoria 'vencidos'
  const vencidos = mockValidades.filter((v) => v.categoria === 'vencidos');
  assert.equal(vencidos.length, 1);
  assert.ok(vencidos[0].diffDays < 0);

  // 3. Filtro por categoria 'ate3'
  const ate3 = mockValidades.filter((v) => v.categoria === 'ate3');
  assert.equal(ate3.length, 1);
  assert.equal(ate3[0].diffDays, 2);
});

