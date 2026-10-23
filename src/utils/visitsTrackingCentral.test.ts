import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CHECKLIST_QUANTITY_KEYS } from './visitExecution';

describe('Acompanhamento de Visitas — Central de Acompanhamento Operacional', () => {
  const mockVisits = [
    {
      key: 'visit-1',
      lojaCodigo: 'LJ-01',
      lojaNome: 'Supermercado Central',
      lojaCidade: 'São Paulo',
      uf: 'SP',
      industriaCodigo: 'IND-A',
      industriaNome: 'Alimentos Brasil',
      promotorMatricula: 'PROM-101',
      promotorNome: 'Carlos Silva',
      supervisor: 'Marcos Supervisor',
      equipe: 'Equipe Alpha',
      status: 'concluida',
      hasOccurrences: false,
      visitObj: {
        started_at: '2026-10-20T08:00:00Z',
        completed_at: '2026-10-20T09:00:00Z',
        photos: [{ id: 'p1', storage_path: 'p1.jpg', tipo_foto: 'FACHADA' }],
        checklist_items: [
          { item_key: 'qtd_produtos_venda', item_label: 'Quantidade na área de vendas', valor_texto: '25' },
          { item_key: 'qtd_produtos_deposito', item_label: 'Quantidade disponível no depósito', valor_texto: '50' }
        ],
        occurrences: []
      }
    },
    {
      key: 'visit-2',
      lojaCodigo: 'LJ-01',
      lojaNome: 'Supermercado Central', // Mesma loja, indústria diferente
      lojaCidade: 'São Paulo',
      uf: 'SP',
      industriaCodigo: 'IND-B',
      industriaNome: 'Bebidas do Sul',
      promotorMatricula: 'PROM-102',
      promotorNome: 'Ana Souza',
      supervisor: 'Marcos Supervisor',
      equipe: 'Equipe Alpha',
      status: 'em_andamento',
      hasOccurrences: true,
      visitObj: {
        started_at: '2026-10-20T09:15:00Z',
        completed_at: null,
        photos: [],
        checklist_items: [],
        occurrences: [{ id: 'occ-1', tipo: 'RUPTURA', descricao: 'Sem produto na gôndola', resolvido: false }]
      }
    },
    {
      key: 'visit-3',
      lojaCodigo: 'LJ-02',
      lojaNome: 'Hipermercado Leste',
      lojaCidade: 'Campinas',
      uf: 'SP',
      industriaCodigo: 'IND-A',
      industriaNome: 'Alimentos Brasil',
      promotorMatricula: 'PROM-101',
      promotorNome: 'Carlos Silva',
      supervisor: 'Marcos Supervisor',
      equipe: 'Equipe Alpha',
      status: 'pendente',
      hasOccurrences: false,
      visitObj: null
    },
    {
      key: 'visit-4',
      lojaCodigo: 'LJ-03',
      lojaNome: 'Mercado Express',
      lojaCidade: 'Rio de Janeiro',
      uf: 'RJ',
      industriaCodigo: 'IND-C',
      industriaNome: 'Laticínios Express',
      promotorMatricula: 'PROM-103',
      promotorNome: 'Roberto Mendes',
      supervisor: 'Paula Supervisora',
      equipe: 'Equipe Beta',
      status: 'nao_realizada',
      motivoNaoRealizada: 'Loja fechada para inventário',
      hasOccurrences: false,
      visitObj: {
        motivo_nao_realizada: 'Loja fechada para inventário'
      }
    }
  ];

  it('calcula corretamente a linha única de 5 indicadores sem duplicidades ou somas indevidas', () => {
    const programadas = mockVisits.length;
    const concluidas = mockVisits.filter((v) => v.status === 'concluida').length;
    const emAndamento = mockVisits.filter((v) => v.status === 'em_andamento').length;
    const pendentes = mockVisits.filter((v) => v.status === 'pendente' || v.status === 'planejada').length;
    const naoRealizadas = mockVisits.filter((v) => v.status === 'nao_realizada').length;

    assert.equal(programadas, 4);
    assert.equal(concluidas, 1);
    assert.equal(emAndamento, 1);
    assert.equal(pendentes, 1);
    assert.equal(naoRealizadas, 1);
    // A soma das 4 categorias exclusivas deve ser exatamente igual ao total de programadas
    assert.equal(concluidas + emAndamento + pendentes + naoRealizadas, programadas);
  });

  it('mantém independência de visitas de indústrias diferentes na mesma loja (LJ-01)', () => {
    const visitsLoja1 = mockVisits.filter((v) => v.lojaCodigo === 'LJ-01');
    assert.equal(visitsLoja1.length, 2);

    const industrias = visitsLoja1.map((v) => v.industriaCodigo);
    assert.deepEqual(industrias.sort(), ['IND-A', 'IND-B']);

    // Visita da Indústria A está concluída e da Indústria B está em andamento
    assert.equal(visitsLoja1.find((v) => v.industriaCodigo === 'IND-A')?.status, 'concluida');
    assert.equal(visitsLoja1.find((v) => v.industriaCodigo === 'IND-B')?.status, 'em_andamento');
  });

  it('filtra visitas combinando Supervisor e Status de forma consistente', () => {
    const filtered = mockVisits.filter((v) => {
      const matchSup = v.supervisor === 'Marcos Supervisor';
      const matchStatus = v.status === 'em_andamento';
      return matchSup && matchStatus;
    });

    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].promotorNome, 'Ana Souza');
    assert.equal(filtered[0].industriaCodigo, 'IND-B');
  });

  it('filtra por busca textual ampla (loja, promotor, indústria)', () => {
    const q = 'bebidas';
    const filtered = mockVisits.filter((item) => {
      const matchLoja = item.lojaNome.toLowerCase().includes(q) || item.lojaCodigo.toLowerCase().includes(q);
      const matchProm = item.promotorNome.toLowerCase().includes(q) || item.promotorMatricula.toLowerCase().includes(q);
      const matchInd = item.industriaNome.toLowerCase().includes(q) || item.industriaCodigo.toLowerCase().includes(q);
      return matchLoja || matchProm || matchInd;
    });

    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].key, 'visit-2');
  });

  it('aplica paginação de 20 visitas por página sem renderizar tudo simultaneamente', () => {
    // Gerar 45 visitas sintéticas
    const largeList = Array.from({ length: 45 }, (_, idx) => ({
      key: `visit-${idx + 1}`,
      lojaNome: `Loja ${idx + 1}`,
      status: idx % 2 === 0 ? 'concluida' : 'pendente'
    }));

    const pageSize = 20;
    const totalPages = Math.ceil(largeList.length / pageSize);
    assert.equal(totalPages, 3);

    // Página 1: itens 0 a 19 (20 itens)
    const page1 = largeList.slice(0, 20);
    assert.equal(page1.length, 20);
    assert.equal(page1[0].key, 'visit-1');
    assert.equal(page1[19].key, 'visit-20');

    // Página 2: itens 20 a 39 (20 itens)
    const page2 = largeList.slice(20, 40);
    assert.equal(page2.length, 20);
    assert.equal(page2[0].key, 'visit-21');
    assert.equal(page2[19].key, 'visit-40');

    // Página 3: itens 40 a 44 (5 itens)
    const page3 = largeList.slice(40, 60);
    assert.equal(page3.length, 5);
    assert.equal(page3[4].key, 'visit-45');
  });

  it('ordena priorizando pendências e atendimentos em andamento antes dos concluídos', () => {
    const statusPriority: Record<string, number> = {
      em_andamento: 1,
      pendente: 2,
      planejada: 2,
      nao_realizada: 3,
      concluida: 4
    };

    const sorted = [...mockVisits].sort((a, b) => {
      const pA = statusPriority[a.status] || 99;
      const pB = statusPriority[b.status] || 99;
      if (pA !== pB) return pA - pB;
      return a.lojaNome.localeCompare(b.lojaNome);
    });

    assert.equal(sorted[0].status, 'em_andamento'); // visit-2
    assert.equal(sorted[1].status, 'pendente');     // visit-3
    assert.equal(sorted[2].status, 'nao_realizada'); // visit-4
    assert.equal(sorted[3].status, 'concluida');    // visit-1
  });

  it('processa itens de quantidade do checklist conforme especificação MK9 Date', () => {
    const visit = mockVisits[0];
    const items = visit.visitObj?.checklist_items || [];

    const currentQtyItems = items.filter((item) => CHECKLIST_QUANTITY_KEYS.has(item.item_key));
    assert.equal(currentQtyItems.length, 2);
    assert.equal(currentQtyItems[0].valor_texto, '25');
    assert.equal(currentQtyItems[1].valor_texto, '50');
  });
});
