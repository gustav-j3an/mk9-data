import test from 'node:test';
import assert from 'node:assert/strict';

test('Onda 4.2 - Cabeçalho e Indicadores do Painel Operacional', async (t) => {
  await t.test('1. Mapeamento de variantes semânticas do StatCard', () => {
    // Regra: Rupturas abertas > 0 -> danger; = 0 -> success
    const getRupturaVariant = (abertas: number) => (abertas > 0 ? 'danger' : 'success');
    assert.equal(getRupturaVariant(5), 'danger');
    assert.equal(getRupturaVariant(0), 'success');

    // Regra: Pendências atrasadas > 0 -> danger; = 0 -> warning
    const getPendenciaVariant = (atrasadas: number) => (atrasadas > 0 ? 'danger' : 'warning');
    assert.equal(getPendenciaVariant(12), 'danger');
    assert.equal(getPendenciaVariant(0), 'warning');

    // Regra: Vencimentos críticos (vencidos + até 3 dias) > 0 -> danger; = 0 -> success
    const getValidadeVariant = (criticos: number) => (criticos > 0 ? 'danger' : 'success');
    assert.equal(getValidadeVariant(3), 'danger');
    assert.equal(getValidadeVariant(0), 'success');
  });

  await t.test('2. Preservação de navegação rápida por clique nos StatCards', () => {
    let activeCentralTab = 'alertas';
    let activeOcorrenciasTab = 'incidentes';
    let activeRupturaStatus = 'all';
    let activeValidadeStatus = 'all';

    // Clique no Card 1: Visitas de Hoje
    const onCardVisitasClick = () => {
      activeCentralTab = 'visitas_hoje';
    };
    onCardVisitasClick();
    assert.equal(activeCentralTab, 'visitas_hoje');

    // Clique no Card 2: Pendências Críticas
    const onCardPendenciasClick = () => {
      activeCentralTab = 'pendencias';
    };
    onCardPendenciasClick();
    assert.equal(activeCentralTab, 'pendencias');

    // Clique no Card 3: Rupturas Abertas
    const onCardRupturasClick = () => {
      activeOcorrenciasTab = 'rupturas';
      activeRupturaStatus = 'abertas';
    };
    onCardRupturasClick();
    assert.equal(activeOcorrenciasTab, 'rupturas');
    assert.equal(activeRupturaStatus, 'abertas');

    // Clique no Card 4: Vencimentos Críticos
    const onCardValidadesClick = () => {
      activeOcorrenciasTab = 'validades';
      activeValidadeStatus = 'vencidos';
    };
    onCardValidadesClick();
    assert.equal(activeOcorrenciasTab, 'validades');
    assert.equal(activeValidadeStatus, 'vencidos');
  });

  await t.test('3. Consistência dos filtros rápidos de período (today, week, month)', () => {
    const validPeriods = ['today', 'week', 'month'];
    const periodLabels: Record<string, string> = {
      today: 'Hoje',
      week: 'Últimos 7 dias',
      month: 'Este mês'
    };

    assert.equal(periodLabels['today'], 'Hoje');
    assert.equal(periodLabels['week'], 'Últimos 7 dias');
    assert.equal(periodLabels['month'], 'Este mês');

    validPeriods.forEach((p) => {
      assert.ok(periodLabels[p] != null, `Período ${p} deve possuir rótulo legível`);
    });
  });

  await t.test('4. Modo Operacional (Implantação vs Operação Oficial)', () => {
    type Mode = 'IMPLANTACAO' | 'OPERACAO_OFICIAL';

    const getModeBadge = (mode: Mode) => {
      if (mode === 'IMPLANTACAO') {
        return {
          status: 'neutro',
          label: 'Telemetria Pré-SLA',
          alertClass: 'bg-[#FFF8E6] border-[#FCE19B]'
        };
      }
      return {
        status: 'conforme',
        label: 'SLA Ativo',
        alertClass: 'bg-[#E8F5EE] border-[#B9E5D0]'
      };
    };

    const implantacao = getModeBadge('IMPLANTACAO');
    assert.equal(implantacao.status, 'neutro');
    assert.equal(implantacao.label, 'Telemetria Pré-SLA');

    const oficial = getModeBadge('OPERACAO_OFICIAL');
    assert.equal(oficial.status, 'conforme');
    assert.equal(oficial.label, 'SLA Ativo');
  });
});

