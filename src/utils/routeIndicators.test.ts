import { describe, it } from 'node:test';
import assert from 'node:assert';
import type { RouteItem } from '../types';
import { calculateRouteIndicators } from './routeIndicators';

describe('Cálculo de Indicadores Individuais de Rotas Fixas', () => {
  // Cenário de teste: Promotor PRM-TEST com 3 rotas cadastradas:
  // Rota 1: Loja L01, Semanal, Segunda + Quarta (2 visitas/sem)
  // Rota 2: Loja L01 (mesma loja em outra indústria), Semanal, Sexta (1 visita/sem)
  // Rota 3: Loja L02, Quinzenal, Terça + Quinta (2 visitas quinzenais)
  const mockRoutes: RouteItem[] = [
    {
      id: '1',
      codigo_rota: 'ROT-001',
      industria_codigo: 'IND-001',
      loja_codigo: 'LOJ-101',
      promotor_matricula: 'PRM-TEST',
      uf: 'SP',
      frequencia: 'SEMANAL',
      segunda: true,
      terca: false,
      quarta: true,
      quinta: false,
      sexta: false,
      sabado: false,
      domingo: false,
      loja: { codigo: 'LOJ-101', nome: 'Supermercado Central', cidade: 'São Paulo', uf: 'SP' },
      promotor: { matricula: 'PRM-TEST', nome: 'Carlos Promotor', supervisor: 'Sup', equipe: 'Eq' }
    },
    {
      id: '2',
      codigo_rota: 'ROT-002',
      industria_codigo: 'IND-002',
      loja_codigo: 'LOJ-101', // Mesma loja em dia diferente e outra indústria
      promotor_matricula: 'PRM-TEST',
      uf: 'SP',
      frequencia: 'SEMANAL',
      segunda: false,
      terca: false,
      quarta: false,
      quinta: false,
      sexta: true,
      sabado: false,
      domingo: false,
      loja: { codigo: 'LOJ-101', nome: 'Supermercado Central', cidade: 'São Paulo', uf: 'SP' },
      promotor: { matricula: 'PRM-TEST', nome: 'Carlos Promotor', supervisor: 'Sup', equipe: 'Eq' }
    },
    {
      id: '3',
      codigo_rota: 'ROT-003',
      industria_codigo: 'IND-001',
      loja_codigo: 'LOJ-102', // Loja distinta
      promotor_matricula: 'PRM-TEST',
      uf: 'SP',
      frequencia: 'QUINZENAL',
      segunda: false,
      terca: true,
      quarta: false,
      quinta: true,
      sexta: false,
      sabado: false,
      domingo: false,
      loja: { codigo: 'LOJ-102', nome: 'Hipermercado Zona Sul', cidade: 'São Paulo', uf: 'SP' },
      promotor: { matricula: 'PRM-TEST', nome: 'Carlos Promotor', supervisor: 'Sup', equipe: 'Eq' }
    },
    // Outro promotor para validar isolamento
    {
      id: '4',
      codigo_rota: 'ROT-004',
      industria_codigo: 'IND-001',
      loja_codigo: 'LOJ-103',
      promotor_matricula: 'PRM-OUTRO',
      uf: 'RJ',
      frequencia: 'SEMANAL',
      segunda: true,
      terca: true,
      quarta: true,
      quinta: true,
      sexta: true,
      sabado: false,
      domingo: false
    }
  ];

  const countActiveDays = (r: RouteItem): number => {
    let count = 0;
    if (r.segunda) count++;
    if (r.terca) count++;
    if (r.quarta) count++;
    if (r.quinta) count++;
    if (r.sexta) count++;
    if (r.sabado) count++;
    if (r.domingo) count++;
    return count;
  };

  it('deve calcular corretamente indicadores individuais quando PRM-TEST é selecionado', () => {
    const selectedPromotor = 'PRM-TEST';
    const targetRoutes = mockRoutes.filter((r) => r.promotor_matricula === selectedPromotor);

    const totalRotas = targetRoutes.length;
    const lojasUnicas = new Set(targetRoutes.map((r) => r.loja_codigo)).size;

    let visitasSemanais = 0;
    let visitasQuinzenais = 0;

    targetRoutes.forEach((r) => {
      const days = countActiveDays(r);
      if (r.frequencia === 'SEMANAL') visitasSemanais += days;
      if (r.frequencia === 'QUINZENAL') visitasQuinzenais += days;
    });

    // Asserções
    assert.strictEqual(totalRotas, 3, 'Total de rotas cadastradas deve ser 3');
    assert.strictEqual(lojasUnicas, 2, 'Lojas distintas devem ser 2 (LOJ-101 e LOJ-102), mesmo LOJ-101 estando em 2 rotas');
    assert.strictEqual(visitasSemanais, 3, 'Visitas semanais devem ser 3 (Rota 1 = 2 dias [seg,qua] + Rota 2 = 1 dia [sex])');
    assert.strictEqual(visitasQuinzenais, 2, 'Visitas quinzenais devem ser 2 (Rota 3 = 2 dias [ter,qui])');
  });

  it('deve atualizar os indicadores individuais ao aplicar filtro de indústria ou UF', () => {
    const selectedPromotor = 'PRM-TEST';
    const selectedIndustria = 'IND-001';

    const targetRoutes = mockRoutes.filter(
      (r) => r.promotor_matricula === selectedPromotor && r.industria_codigo === selectedIndustria
    );

    const totalRotas = targetRoutes.length;
    const lojasUnicas = new Set(targetRoutes.map((r) => r.loja_codigo)).size;

    let visitasSemanais = 0;
    let visitasQuinzenais = 0;

    targetRoutes.forEach((r) => {
      const days = countActiveDays(r);
      if (r.frequencia === 'SEMANAL') visitasSemanais += days;
      if (r.frequencia === 'QUINZENAL') visitasQuinzenais += days;
    });

    assert.strictEqual(totalRotas, 2, 'Total de rotas cadastradas da IND-001 deve ser 2');
    assert.strictEqual(lojasUnicas, 2, 'Lojas distintas devem ser 2');
    assert.strictEqual(visitasSemanais, 2, 'Visitas semanais da IND-001 devem ser 2 (apenas seg,qua da Rota 1)');
    assert.strictEqual(visitasQuinzenais, 2, 'Visitas quinzenais da IND-001 devem ser 2 (ter,qui da Rota 3)');
  });

  it('deve preservar os indicadores gerais quando nenhum promotor for selecionado', () => {
    const selectedPromotor = 'TODOS';
    const isIndividual = selectedPromotor !== 'TODOS';

    assert.strictEqual(isIndividual, false);
    const totalRotasGeral = mockRoutes.length;
    const semanaisGeral = mockRoutes.filter((r) => r.frequencia === 'SEMANAL').length;
    const quinzenaisGeral = mockRoutes.filter((r) => r.frequencia === 'QUINZENAL').length;
    const promotoresGeral = new Set(mockRoutes.map((r) => r.promotor_matricula)).size;
    const lojasGeral = new Set(mockRoutes.map((r) => r.loja_codigo)).size;

    assert.strictEqual(totalRotasGeral, 4);
    assert.strictEqual(semanaisGeral, 3);
    assert.strictEqual(quinzenaisGeral, 1);
    assert.strictEqual(promotoresGeral, 2);
    assert.strictEqual(lojasGeral, 3);
  });

  it('deve excluir escalas encerradas dos indicadores ativos', () => {
    const indicators = calculateRouteIndicators([
      mockRoutes[0],
      { ...mockRoutes[1], encerrada_em: '2026-10-18T12:00:00Z' },
      mockRoutes[2]
    ]);

    assert.strictEqual(indicators.totalRotas, 2);
    assert.strictEqual(indicators.semanais, 1);
    assert.strictEqual(indicators.quinzenais, 1);
    assert.strictEqual(indicators.promotoresUnicos, 1);
    assert.strictEqual(indicators.lojasUnicas, 2);
    assert.strictEqual(indicators.visitasSemanais, 2);
    assert.strictEqual(indicators.visitasQuinzenais, 2);
  });
});
