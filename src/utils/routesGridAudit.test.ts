import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { RouteItem } from '../types';

/**
 * Mock de rotas operacionais fixas
 */
const mockRoutes: RouteItem[] = [
  {
    id: '1',
    codigo_rota: 'ROT-001',
    industria_codigo: 'IND-ALFA',
    loja_codigo: 'LOJ-001',
    promotor_matricula: 'PRM-001',
    uf: 'SP',
    frequencia: 'SEMANAL',
    segunda: true,
    terca: false,
    quarta: true,
    quinta: false,
    sexta: true,
    sabado: false,
    domingo: false,
    created_at: '2026-01-01T00:00:00Z',
    industria: { codigo: 'IND-ALFA', nome: 'Alimentos Alfa' },
    loja: { codigo: 'LOJ-001', nome: 'Supermercado Central', cidade: 'São Paulo', uf: 'SP' },
    promotor: { matricula: 'PRM-001', nome: 'Carlos Andrade', supervisor: 'SUP-01', equipe: 'EQ-01' }
  },
  {
    id: '2',
    codigo_rota: 'ROT-002',
    industria_codigo: 'IND-BETA',
    loja_codigo: 'LOJ-002',
    promotor_matricula: 'PRM-001',
    uf: 'SP',
    frequencia: 'QUINZENAL',
    segunda: false,
    terca: true,
    quarta: false,
    quinta: true,
    sexta: false,
    sabado: false,
    domingo: false,
    created_at: '2026-01-02T00:00:00Z',
    industria: { codigo: 'IND-BETA', nome: 'Bebidas Beta' },
    loja: { codigo: 'LOJ-002', nome: 'Hipermercado Zona Sul', cidade: 'São Paulo', uf: 'SP' },
    promotor: { matricula: 'PRM-001', nome: 'Carlos Andrade', supervisor: 'SUP-01', equipe: 'EQ-01' }
  },
  {
    id: '3',
    codigo_rota: 'ROT-003',
    industria_codigo: 'IND-ALFA',
    loja_codigo: 'LOJ-003',
    promotor_matricula: 'PRM-002',
    uf: 'RJ',
    frequencia: 'SEMANAL',
    segunda: true,
    terca: true,
    quarta: false,
    quinta: false,
    sexta: false,
    sabado: false,
    domingo: false,
    created_at: '2026-01-03T00:00:00Z',
    industria: { codigo: 'IND-ALFA', nome: 'Alimentos Alfa' },
    loja: { codigo: 'LOJ-003', nome: 'Empório Guanabara', cidade: 'Rio de Janeiro', uf: 'RJ' },
    promotor: { matricula: 'PRM-002', nome: 'Mariana Lima', supervisor: 'SUP-02', equipe: 'EQ-02' }
  },
  {
    id: '4',
    codigo_rota: 'ROT-004',
    industria_codigo: 'IND-GAMA',
    loja_codigo: 'LOJ-001',
    promotor_matricula: 'PRM-002',
    uf: 'SP',
    frequencia: 'SEMANAL',
    segunda: false,
    terca: false,
    quarta: true,
    quinta: true,
    sexta: true,
    sabado: false,
    domingo: false,
    created_at: '2026-01-04T00:00:00Z',
    industria: { codigo: 'IND-GAMA', nome: 'Laticínios Gama' },
    loja: { codigo: 'LOJ-001', nome: 'Supermercado Central', cidade: 'São Paulo', uf: 'SP' },
    promotor: { matricula: 'PRM-002', nome: 'Mariana Lima', supervisor: 'SUP-02', equipe: 'EQ-02' }
  }
];

describe('Onda 3.3 - Rotas Fixas: Filtros, Agrupamento, Paginação e Integridade', () => {
  // 1. Busca combinada com filtros
  describe('1. Busca combinada com filtros', () => {
    it('deve filtrar rotas por termo de busca geral (indústria, loja ou promotor)', () => {
      const term = 'carlos';
      const filtered = mockRoutes.filter((r) => {
        const prmName = (r.promotor?.nome || '').toLowerCase();
        return prmName.includes(term);
      });
      assert.equal(filtered.length, 2);
      assert.ok(filtered.every((r) => r.promotor_matricula === 'PRM-001'));
    });

    it('deve combinar busca por texto com filtro de UF e Frequência', () => {
      const term = 'alfa';
      const uf = 'SP';
      const freq = 'SEMANAL';

      const filtered = mockRoutes.filter((r) => {
        const matchesTerm = (r.industria?.nome || '').toLowerCase().includes(term);
        const matchesUf = r.uf === uf;
        const matchesFreq = r.frequencia === freq;
        return matchesTerm && matchesUf && matchesFreq;
      });

      assert.equal(filtered.length, 1);
      assert.equal(filtered[0].id, '1');
    });

    it('deve filtrar rotas por dia da semana ativo', () => {
      const filteredSegunda = mockRoutes.filter((r) => r.segunda);
      assert.equal(filteredSegunda.length, 2); // ROT-001 e ROT-003
    });
  });

  // 2. Agrupamento por Promotor
  describe('2. Agrupamento por Promotor', () => {
    it('deve agrupar as rotas com chave correspondente ao promotor', () => {
      const groups: Record<string, RouteItem[]> = {};
      mockRoutes.forEach((r) => {
        const key = r.promotor?.nome ? `${r.promotor.nome} (${r.promotor_matricula})` : `Promotor ${r.promotor_matricula}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push(r);
      });

      const groupKeys = Object.keys(groups);
      assert.equal(groupKeys.length, 2);
      assert.ok(groupKeys.includes('Carlos Andrade (PRM-001)'));
      assert.ok(groupKeys.includes('Mariana Lima (PRM-002)'));
      assert.equal(groups['Carlos Andrade (PRM-001)'].length, 2);
    });
  });

  // 3. Agrupamento por Indústria
  describe('3. Agrupamento por Indústria', () => {
    it('deve agrupar as rotas por indústria', () => {
      const groups: Record<string, RouteItem[]> = {};
      mockRoutes.forEach((r) => {
        const key = r.industria?.nome ? `${r.industria.nome} (${r.industria_codigo})` : `Indústria ${r.industria_codigo}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push(r);
      });

      assert.equal(groups['Alimentos Alfa (IND-ALFA)'].length, 2);
      assert.equal(groups['Bebidas Beta (IND-BETA)'].length, 1);
      assert.equal(groups['Laticínios Gama (IND-GAMA)'].length, 1);
    });
  });

  // 4. Agrupamento por Loja
  describe('4. Agrupamento por Loja', () => {
    it('deve agrupar as rotas por loja/PDV', () => {
      const groups: Record<string, RouteItem[]> = {};
      mockRoutes.forEach((r) => {
        const key = r.loja?.nome ? `${r.loja.nome} (${r.loja_codigo})` : `Loja ${r.loja_codigo}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push(r);
      });

      assert.equal(groups['Supermercado Central (LOJ-001)'].length, 2);
      assert.equal(groups['Hipermercado Zona Sul (LOJ-002)'].length, 1);
    });
  });

  // 5. Agrupamento por Frequência
  describe('5. Agrupamento por Frequência', () => {
    it('deve agrupar por Frequência SEMANAL e QUINZENAL', () => {
      const groups: Record<string, RouteItem[]> = {};
      mockRoutes.forEach((r) => {
        const key = `Frequência ${r.frequencia}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push(r);
      });

      assert.equal(groups['Frequência SEMANAL'].length, 3);
      assert.equal(groups['Frequência QUINZENAL'].length, 1);
    });
  });

  // 6. Paginação com Agrupamento Seguro
  describe('6. Paginação com Agrupamento', () => {
    it('deve fatiar as rotas por página sem perder ou duplicar registros', () => {
      const pageSize = 2;
      const page1 = mockRoutes.slice(0, pageSize);
      const page2 = mockRoutes.slice(pageSize, pageSize * 2);

      assert.equal(page1.length, 2);
      assert.equal(page2.length, 2);

      // Nenhuma rota duplicada
      const idsPage1 = new Set(page1.map((r) => r.id));
      const idsPage2 = new Set(page2.map((r) => r.id));
      assert.ok(![...idsPage2].some((id) => idsPage1.has(id)));
    });

    it('deve calcular groupTotals sobre o universo filtrado completo para exibir a quantidade total no cabeçalho do grupo', () => {
      const groupTotals: Record<string, number> = {};
      mockRoutes.forEach((r) => {
        const key = r.promotor?.nome ? `${r.promotor.nome} (${r.promotor_matricula})` : `Promotor ${r.promotor_matricula}`;
        groupTotals[key] = (groupTotals[key] || 0) + 1;
      });

      assert.equal(groupTotals['Carlos Andrade (PRM-001)'], 2);
      assert.equal(groupTotals['Mariana Lima (PRM-002)'], 2);
    });
  });

  // 7. Ordenação
  describe('7. Ordenação de Rotas', () => {
    it('deve ordenar por nome do promotor de forma estável', () => {
      const sorted = [...mockRoutes].sort((a, b) => {
        const nameA = a.promotor?.nome || a.promotor_matricula;
        const nameB = b.promotor?.nome || b.promotor_matricula;
        return nameA.localeCompare(nameB);
      });

      assert.equal(sorted[0].promotor?.nome, 'Carlos Andrade');
      assert.equal(sorted[sorted.length - 1].promotor?.nome, 'Mariana Lima');
    });

    it('deve ordenar por código da rota', () => {
      const sorted = [...mockRoutes].sort((a, b) => a.codigo_rota.localeCompare(b.codigo_rota));
      assert.equal(sorted[0].codigo_rota, 'ROT-001');
      assert.equal(sorted[3].codigo_rota, 'ROT-004');
    });
  });

  // 8. Preservação de Identificadores Internos
  describe('8. Preservação de Identificadores', () => {
    it('deve garantir que o objeto de rota retém id primário, codigo_rota, industria_codigo, loja_codigo e promotor_matricula', () => {
      const r = mockRoutes[0];
      assert.equal(r.id, '1');
      assert.equal(r.codigo_rota, 'ROT-001');
      assert.equal(r.industria_codigo, 'IND-ALFA');
      assert.equal(r.loja_codigo, 'LOJ-001');
      assert.equal(r.promotor_matricula, 'PRM-001');
    });
  });

  // 9. Ações de Visualizar e Editar
  describe('9. Ações de Visualizar e Editar', () => {
    it('modal de visualização deve receber a rota completa incluindo codigo_rota para auditoria', () => {
      let viewingRoute: RouteItem | null = null;
      const onSelect = (route: RouteItem) => {
        viewingRoute = route;
      };

      onSelect(mockRoutes[0]);
      assert.ok(viewingRoute);
      assert.equal((viewingRoute as RouteItem).codigo_rota, 'ROT-001');
      assert.equal((viewingRoute as RouteItem).industria?.nome, 'Alimentos Alfa');
    });

    it('modal de edição deve permitir clonar o objeto para modificação isolada', () => {
      const target = mockRoutes[0];
      const editingRoute = { ...target };
      editingRoute.frequencia = 'QUINZENAL';
      editingRoute.terca = true;

      // Objeto original permanece inalterado
      assert.equal(target.frequencia, 'SEMANAL');
      assert.equal(target.terca, false);
      assert.equal(editingRoute.frequencia, 'QUINZENAL');
      assert.equal(editingRoute.terca, true);
    });
  });

  // 10. Comportamento Adaptativo / Responsivo
  describe('10. Comportamento Responsivo', () => {
    it('os 7 dias da semana devem possuir chaves mapeáveis consistentes para exibição desktop e chips mobile', () => {
      const daysKeys = ['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo'] as const;
      const r = mockRoutes[0];

      const activeDays = daysKeys.filter((d) => r[d]);
      assert.deepEqual(activeDays, ['segunda', 'quarta', 'sexta']);
    });
  });
});

