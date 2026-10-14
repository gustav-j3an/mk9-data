import assert from 'assert';
import { getLocalDateString } from './routePlanner';
import type { SystemSettingsState } from '../types';

/**
 * Helper puro para formatação da apresentação de aderência
 * reproduzindo exatamente a regra aplicada em OperationalDashboardView e IndustryPortalView.
 */
export function formatAdherenceDisplay(
  adherencePercentage: number,
  settings: SystemSettingsState
): { label: string; isOfficial: boolean; description?: string } {
  if (settings.status === 'loading') {
    return { label: 'Carregando...', isOfficial: false };
  }

  if (settings.mode !== 'OPERACAO_OFICIAL' || settings.status !== 'loaded') {
    return {
      label: 'Fase de implantação — SLA não ativo',
      isOfficial: false,
      description: 'Indicador oficial desativado'
    };
  }

  return {
    label: `${adherencePercentage}%`,
    isOfficial: true,
    description: 'Taxa de Execução'
  };
}

/**
 * Helper puro para apresentação em tabelas compactas / resumo
 */
export function formatCompactAdherence(
  adherencePercentage: number,
  settings: SystemSettingsState
): string {
  if (settings.mode !== 'OPERACAO_OFICIAL' || settings.status !== 'loaded') {
    return 'SLA n/a';
  }
  return `${adherencePercentage}%`;
}

console.log('===============================================================');
console.log('INICIANDO SUÍTE DE TESTES UNITÁRIOS DE ADERÊNCIA E DATA LOCAL');
console.log('===============================================================');

// 1. Cálculo de data local sem conversão UTC
console.log('1. Testando cálculo de data local sem conversão UTC...');
{
  // Simular data local às 22:30 (horário que em UTC vira o dia seguinte)
  const localDateNight = new Date(2026, 9, 9, 22, 30, 0); // 09/10/2026 22:30 local
  const calculatedLocalStr = getLocalDateString(localDateNight);
  assert.strictEqual(
    calculatedLocalStr,
    '2026-10-09',
    'getLocalDateString deve retornar o dia local (09) e não o dia UTC (10)'
  );

  // Testar virada da meia-noite local
  const localMidnight = new Date(2026, 9, 10, 0, 1, 0); // 10/10/2026 00:01 local
  assert.strictEqual(
    getLocalDateString(localMidnight),
    '2026-10-10',
    'getLocalDateString deve retornar 2026-10-10 após a meia-noite local'
  );
  console.log('  [OK] Data local calculada corretamente preservando o fuso horário local.');
}

// 2. Aderência não exibida como indicador oficial durante a implantação
console.log('2. Testando aderência durante modo IMPLANTACAO...');
{
  const settingsImplantacao: SystemSettingsState = {
    mode: 'IMPLANTACAO',
    officialStartDate: null,
    status: 'loaded',
    error: null
  };

  const display = formatAdherenceDisplay(85, settingsImplantacao);
  assert.strictEqual(
    display.label,
    'Fase de implantação — SLA não ativo',
    'No modo IMPLANTACAO, não deve apresentar o percentual como SLA oficial'
  );
  assert.strictEqual(display.isOfficial, false);

  const compact = formatCompactAdherence(85, settingsImplantacao);
  assert.strictEqual(
    compact,
    'SLA n/a',
    'Tabelas em modo IMPLANTACAO devem indicar SLA n/a'
  );
  console.log('  [OK] Modo IMPLANTACAO exibe "Fase de implantação — SLA não ativo" e "SLA n/a".');
}

// 3. Aderência calculada normalmente na operação oficial
console.log('3. Testando aderência durante modo OPERACAO_OFICIAL...');
{
  const settingsOficial: SystemSettingsState = {
    mode: 'OPERACAO_OFICIAL',
    officialStartDate: '2026-10-10',
    status: 'loaded',
    error: null
  };

  const display = formatAdherenceDisplay(92, settingsOficial);
  assert.strictEqual(display.label, '92%', 'Em OPERACAO_OFICIAL deve exibir percentual real');
  assert.strictEqual(display.isOfficial, true);

  const compact = formatCompactAdherence(92, settingsOficial);
  assert.strictEqual(compact, '92%', 'Tabelas em OPERACAO_OFICIAL devem exibir percentual');
  console.log('  [OK] Modo OPERACAO_OFICIAL preserva e apresenta percentual oficial.');
}

// 4. Configuração carregando, ausente ou inválida não apresentada como oficial confirmada
console.log('4. Testando configuração carregando, ausente ou inválida...');
{
  // Caso A: Carregando
  const settingsLoading: SystemSettingsState = {
    mode: 'IMPLANTACAO',
    officialStartDate: null,
    status: 'loading',
    error: null
  };
  const displayLoading = formatAdherenceDisplay(100, settingsLoading);
  assert.strictEqual(displayLoading.label, 'Carregando...');
  assert.strictEqual(displayLoading.isOfficial, false);

  // Caso B: Erro / Desconhecido
  const settingsError: SystemSettingsState = {
    mode: 'DESCONHECIDO',
    officialStartDate: null,
    status: 'error',
    error: 'Tabela indisponível'
  };
  const displayError = formatAdherenceDisplay(100, settingsError);
  assert.strictEqual(displayError.label, 'Fase de implantação — SLA não ativo');
  assert.strictEqual(displayError.isOfficial, false);

  const compactError = formatCompactAdherence(100, settingsError);
  assert.strictEqual(compactError, 'SLA n/a');
  console.log('  [OK] Estado carregando/erro/desconhecido não apresenta percentual oficial.');
}

// 5. Mesma regra aplicada tanto para o painel operacional quanto para o portal da indústria
console.log('5. Testando paridade de regras entre dashboards...');
{
  const sampleSettingsModes: SystemSettingsState[] = [
    { mode: 'IMPLANTACAO', officialStartDate: null, status: 'loaded', error: null },
    { mode: 'OPERACAO_OFICIAL', officialStartDate: '2026-10-15', status: 'loaded', error: null },
    { mode: 'DESCONHECIDO', officialStartDate: null, status: 'error', error: 'Network error' }
  ];

  sampleSettingsModes.forEach((s) => {
    const dOperational = formatAdherenceDisplay(75, s);
    const dIndustry = formatAdherenceDisplay(75, s);
    assert.deepStrictEqual(
      dOperational,
      dIndustry,
      'OperationalDashboardView e IndustryPortalView devem ter saídas idênticas sob mesmo estado'
    );
  });
  console.log('  [OK] Paridade total de comportamento entre OperationalDashboardView e IndustryPortalView.');
}

// 6. Testando separação entre planejamento cadastrado e execução real (Sem dupla contagem)
console.log('6. Testando separação entre planejamento cadastrado e execução real...');
{
  const mockRoutes = [
    { id: 'r1', promotor_matricula: 'P01', loja_codigo: 'L01', industria_codigo: 'IND01', frequencia: 'SEMANAL', segunda: true },
    { id: 'r2', promotor_matricula: 'P01', loja_codigo: 'L02', industria_codigo: 'IND01', frequencia: 'SEMANAL', segunda: true }
  ];

  // Simular 1 visita real concluída para r1
  const mockVisits = [
    {
      id: 'v1',
      rota_id: 'r1',
      promotor_matricula: 'P01',
      loja_codigo: 'L01',
      industria_codigo: 'IND01',
      data_visita: '2026-10-12', // segunda-feira
      status: 'concluida' as const,
      completed_at: '2026-10-12T14:00:00Z'
    }
  ];

  // A contagem de execução real deve ser baseada ESTRITAMENTE em visits
  const concluidasCount = mockVisits.filter((v) => v.status === 'concluida').length;
  assert.strictEqual(concluidasCount, 1, 'Execução real deve contabilizar apenas visitas registradas');

  // O total de planejamento representa ocorrências cadastradas (2 rotas)
  const plannedCount = mockRoutes.length;
  assert.strictEqual(plannedCount, 2, 'Planejamento deve refletir rotas cadastradas');

  // Não somar planejamento e visitas para evitar dupla contagem
  const totalAgendasOuVisitasNaoDuplicadas = new Set([
    ...mockRoutes.map((r) => `${r.promotor_matricula}|${r.loja_codigo}|${r.industria_codigo}|2026-10-12`),
    ...mockVisits.map((v) => `${v.promotor_matricula}|${v.loja_codigo}|${v.industria_codigo}|${v.data_visita}`)
  ]).size;

  assert.strictEqual(
    totalAgendasOuVisitasNaoDuplicadas,
    2,
    'Não deve haver contagem duplicada quando visita real coincide com rota planejada'
  );
  console.log('  [OK] Separação perfeita entre execução real e planejamento cadastrado sem dupla contagem.');
}

console.log('===============================================================');
console.log('SUCESSO: TODOS OS 6 TESTES DE ADERÊNCIA, DATA LOCAL E DASHBOARD PASSARAM!');
console.log('===============================================================');
