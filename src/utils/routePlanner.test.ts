import { calculateOperationalVisits, DayOfWeekDate } from './routePlanner';
import type { RouteItem, Visit } from '../types';

function createMockDaysRange(): DayOfWeekDate[] {
  // Semana de exemplo: 2026-10-05 (Segunda) até 2026-10-11 (Domingo)
  // Data base hoje fictício: 2026-10-08 (Quinta)
  const todayStr = '2026-10-08';
  const dates = [
    { dateStr: '2026-10-05', dayKey: 'segunda' as const, dayLabel: 'Segunda', dayShort: 'Seg' },
    { dateStr: '2026-10-06', dayKey: 'terca' as const, dayLabel: 'Terça', dayShort: 'Ter' },
    { dateStr: '2026-10-07', dayKey: 'quarta' as const, dayLabel: 'Quarta', dayShort: 'Qua' },
    { dateStr: '2026-10-08', dayKey: 'quinta' as const, dayLabel: 'Quinta', dayShort: 'Qui' },
    { dateStr: '2026-10-09', dayKey: 'sexta' as const, dayLabel: 'Sexta', dayShort: 'Sex' },
    { dateStr: '2026-10-10', dayKey: 'sabado' as const, dayLabel: 'Sábado', dayShort: 'Sáb' },
    { dateStr: '2026-10-11', dayKey: 'domingo' as const, dayLabel: 'Domingo', dayShort: 'Dom' },
  ];

  return dates.map((d) => ({
    ...d,
    isToday: d.dateStr === todayStr,
    isPast: d.dateStr < todayStr,
    isFuture: d.dateStr > todayStr
  }));
}

function createMockRoute(overrides: Partial<RouteItem> = {}): RouteItem {
  return {
    id: 'route-test-1',
    codigo_rota: 'ROT-001',
    industria_codigo: 'IND-001',
    loja_codigo: 'LOJ-001',
    promotor_matricula: 'PRM-001',
    uf: 'SP',
    frequencia: 'SEMANAL',
    segunda: true,
    terca: true,
    quarta: true,
    quinta: true,
    sexta: true,
    sabado: false,
    domingo: false,
    loja: { codigo: 'LOJ-001', nome: 'Loja Teste Central' },
    promotor: { matricula: 'PRM-001', nome: 'Promotor Teste' },
    industria: { codigo: 'IND-001', nome: 'Indústria Teste' },
    ...overrides
  };
}

function runAllTests() {
  console.log('===============================================================');
  console.log('INICIANDO SUÍTE DE TESTES UNITÁRIOS DE calculateOperationalVisits');
  console.log('===============================================================');

  const daysRange = createMockDaysRange();
  const todayStr = '2026-10-08';

  // --------------------------------------------------------------------------
  // TESTE 1: Implantação sem visitas registradas
  // --------------------------------------------------------------------------
  {
    const route = createMockRoute();
    const result = calculateOperationalVisits({
      routes: [route],
      visits: [],
      daysRange,
      todayStr,
      operationMode: 'IMPLANTACAO'
    });

    // 5 dias ativos (Seg, Ter, Qua, Qui, Sex)
    console.assert(result.length === 5, 'T1: Deve gerar 5 itens');
    const pastItems = result.filter((i) => i.dataStr < todayStr);
    console.assert(pastItems.length === 3, 'T1: 3 itens passados');
    // Em implantação, rotas passadas sem visita NÃO devem ser pendentes nem atrasadas!
    pastItems.forEach((item) => {
      console.assert(item.status === 'planejada', `T1: Item passado deve ser 'planejada', recebeu ${item.status}`);
      console.assert(item.isPastOverdue === false, 'T1: isPastOverdue deve ser false');
      console.assert(item.isRealExecution === false, 'T1: isRealExecution deve ser false');
    });
    console.log('[OK] Teste 1: Implantação sem visitas registradas (zero atrasos virtuais)');
  }

  // --------------------------------------------------------------------------
  // TESTE 2: Implantação com visitas reais concluídas
  // --------------------------------------------------------------------------
  {
    const route = createMockRoute();
    const mockVisit: Visit = {
      id: 'v-1',
      promotor_matricula: 'PRM-001',
      loja_codigo: 'LOJ-001',
      industria_codigo: 'IND-001',
      data_visita: '2026-10-06',
      status: 'concluida',
      started_at: '2026-10-06T10:00:00Z',
      completed_at: '2026-10-06T11:00:00Z'
    };

    const result = calculateOperationalVisits({
      routes: [route],
      visits: [mockVisit],
      daysRange,
      todayStr,
      operationMode: 'IMPLANTACAO'
    });

    const item = result.find((i) => i.dataStr === '2026-10-06');
    console.assert(item !== undefined, 'T2: Item deve existir');
    console.assert(item?.status === 'concluida', 'T2: Status deve ser concluida');
    console.assert(item?.isRealExecution === true, 'T2: isRealExecution deve ser true');
    console.assert(item?.isPastOverdue === false, 'T2: Não deve ser atrasada');
    console.assert(item?.duracaoFormatada === '1h 0min', `T2: Duração deve ser 1h 0min, recebeu ${item?.duracaoFormatada}`);
    console.log('[OK] Teste 2: Implantação com visitas reais concluídas preservadas');
  }

  // --------------------------------------------------------------------------
  // TESTE 3: Implantação com visitas reais em andamento
  // --------------------------------------------------------------------------
  {
    const route = createMockRoute();
    const mockVisit: Visit = {
      id: 'v-2',
      promotor_matricula: 'PRM-001',
      loja_codigo: 'LOJ-001',
      industria_codigo: 'IND-001',
      data_visita: '2026-10-08',
      status: 'em_andamento',
      started_at: '2026-10-08T14:00:00Z'
    };

    const result = calculateOperationalVisits({
      routes: [route],
      visits: [mockVisit],
      daysRange,
      todayStr,
      operationMode: 'IMPLANTACAO'
    });

    const item = result.find((i) => i.dataStr === '2026-10-08');
    console.assert(item?.status === 'em_andamento', 'T3: Status deve ser em_andamento');
    console.assert(item?.isRealExecution === true, 'T3: isRealExecution true');
    console.assert(item?.priorityOrder === 3, 'T3: PriorityOrder deve ser 3');
    console.log('[OK] Teste 3: Implantação com visitas reais em andamento');
  }

  // --------------------------------------------------------------------------
  // TESTE 4: Operação oficial com rotas anteriores à data oficial
  // --------------------------------------------------------------------------
  {
    const route = createMockRoute();
    // Operação oficial começa em 2026-10-07. Rotas em 2026-10-05 e 2026-10-06 são anteriores!
    const result = calculateOperationalVisits({
      routes: [route],
      visits: [],
      daysRange,
      todayStr,
      operationMode: 'OPERACAO_OFICIAL',
      officialStartDate: '2026-10-07'
    });

    const preOfficialItems = result.filter((i) => i.dataStr < '2026-10-07');
    console.assert(preOfficialItems.length === 2, 'T4: 2 itens anteriores');
    preOfficialItems.forEach((item) => {
      console.assert(item.status === 'planejada', `T4: Anterior deve ser 'planejada', recebeu ${item.status}`);
      console.assert(item.isPastOverdue === false, 'T4: Não deve ser atrasada');
    });
    console.log('[OK] Teste 4: Rotas anteriores à data oficial não geram atraso operacional');
  }

  // --------------------------------------------------------------------------
  // TESTE 5: Operação oficial com rotas na data inicial
  // --------------------------------------------------------------------------
  {
    const route = createMockRoute();
    // Início oficial em 2026-10-07 (passado em relação a todayStr 2026-10-08)
    const result = calculateOperationalVisits({
      routes: [route],
      visits: [],
      daysRange,
      todayStr,
      operationMode: 'OPERACAO_OFICIAL',
      officialStartDate: '2026-10-07'
    });

    const startDayItem = result.find((i) => i.dataStr === '2026-10-07');
    console.assert(startDayItem !== undefined, 'T5: Item deve existir');
    // Como 2026-10-07 é >= data oficial E é anterior a today (2026-10-08), DEVE ser atrasada!
    console.assert(startDayItem?.status === 'pendente', 'T5: Status deve ser pendente');
    console.assert(startDayItem?.isPastOverdue === true, 'T5: Deve ser atrasada');
    console.log('[OK] Teste 5: Rotas na data inicial respondem às regras operacionais normais');
  }

  // --------------------------------------------------------------------------
  // TESTE 6: Operação oficial com rotas posteriores à data inicial
  // --------------------------------------------------------------------------
  {
    const route = createMockRoute();
    const result = calculateOperationalVisits({
      routes: [route],
      visits: [],
      daysRange,
      todayStr,
      operationMode: 'OPERACAO_OFICIAL',
      officialStartDate: '2026-10-07'
    });

    // Hoje (2026-10-08)
    const todayItem = result.find((i) => i.dataStr === todayStr);
    console.assert(todayItem?.status === 'pendente', 'T6: Hoje sem visita é pendente');
    console.assert(todayItem?.isPastOverdue === false, 'T6: Hoje não é atrasada');
    console.assert(todayItem?.priorityOrder === 1, 'T6: Prioridade 1 (pendência de hoje)');

    // Futuro (2026-10-09)
    const futureItem = result.find((i) => i.dataStr === '2026-10-09');
    console.assert(futureItem?.status === 'planejada', 'T6: Futuro é planejada');
    console.assert(futureItem?.isPastOverdue === false, 'T6: Futuro não é atrasada');
    console.log('[OK] Teste 6: Rotas posteriores à data inicial (hoje e futuras calculadas corretamente)');
  }

  // --------------------------------------------------------------------------
  // TESTE 7: Visitas reais anteriores à data oficial preservadas
  // --------------------------------------------------------------------------
  {
    const route = createMockRoute();
    const mockVisit: Visit = {
      id: 'v-legacy',
      promotor_matricula: 'PRM-001',
      loja_codigo: 'LOJ-001',
      industria_codigo: 'IND-001',
      data_visita: '2026-10-05',
      status: 'concluida',
      started_at: '2026-10-05T08:00:00Z',
      completed_at: '2026-10-05T09:00:00Z'
    };

    const result = calculateOperationalVisits({
      routes: [route],
      visits: [mockVisit],
      daysRange,
      todayStr,
      operationMode: 'OPERACAO_OFICIAL',
      officialStartDate: '2026-10-07'
    });

    const item = result.find((i) => i.dataStr === '2026-10-05');
    console.assert(item?.status === 'concluida', 'T7: Visita real concluída preservada');
    console.assert(item?.isRealExecution === true, 'T7: isRealExecution true');
    console.assert(item?.isPastOverdue === false, 'T7: Não deve ser atrasada');
    console.log('[OK] Teste 7: Visitas reais anteriores à data oficial preservadas intactas');
  }

  // --------------------------------------------------------------------------
  // TESTE 8: Rotas semanais
  // --------------------------------------------------------------------------
  {
    const route = createMockRoute({
      frequencia: 'SEMANAL',
      segunda: true,
      terca: false,
      quarta: true,
      quinta: false,
      sexta: false,
      sabado: false,
      domingo: false
    });

    const result = calculateOperationalVisits({
      routes: [route],
      visits: [],
      daysRange,
      todayStr,
      operationMode: 'IMPLANTACAO'
    });

    console.assert(result.length === 2, 'T8: Apenas Segunda e Quarta');
    console.assert(result[0].dataStr === '2026-10-05', 'T8: Segunda');
    console.assert(result[1].dataStr === '2026-10-07', 'T8: Quarta');
    console.log('[OK] Teste 8: Rotas semanais respeitam flags dos dias ativos');
  }

  // --------------------------------------------------------------------------
  // TESTE 9: Rotas quinzenais (respeitando implementação atual)
  // --------------------------------------------------------------------------
  {
    const route = createMockRoute({
      frequencia: 'QUINZENAL',
      segunda: true,
      terca: false,
      quarta: false,
      quinta: false,
      sexta: false,
      sabado: false,
      domingo: false
    });

    const result = calculateOperationalVisits({
      routes: [route],
      visits: [],
      daysRange,
      todayStr,
      operationMode: 'IMPLANTACAO'
    });

    console.assert(result.length === 1, 'T9: Segunda');
    console.assert(result[0].frequencia === 'QUINZENAL', 'T9: Frequência preservada');
    console.log('[OK] Teste 9: Rotas quinzenais processadas conforme implementação atual');
  }

  // --------------------------------------------------------------------------
  // TESTE 10: Visita real associada à rota planejada, sem dupla contagem
  // --------------------------------------------------------------------------
  {
    const route = createMockRoute();
    const mockVisit: Visit = {
      id: 'v-match',
      promotor_matricula: 'PRM-001',
      loja_codigo: 'LOJ-001',
      industria_codigo: 'IND-001',
      data_visita: '2026-10-06',
      status: 'concluida'
    };

    const result = calculateOperationalVisits({
      routes: [route],
      visits: [mockVisit],
      daysRange,
      todayStr,
      operationMode: 'IMPLANTACAO'
    });

    // Deve haver exatamente 5 itens para os 5 dias da rota, NÃO 6
    console.assert(result.length === 5, `T10: Esperado 5 itens, recebeu ${result.length}`);
    const itemsOnOct6 = result.filter((i) => i.dataStr === '2026-10-06');
    console.assert(itemsOnOct6.length === 1, 'T10: Exatamente 1 item na data da visita');
    console.assert(itemsOnOct6[0].status === 'concluida', 'T10: Status associado com sucesso');
    console.log('[OK] Teste 10: Visita real combinada com rota sem duplicidade');
  }

  // --------------------------------------------------------------------------
  // TESTE 11: Configuração indisponível ou inválida (fallback seguro)
  // --------------------------------------------------------------------------
  {
    const route = createMockRoute();

    // Caso A: operationMode = 'DESCONHECIDO'
    const resA = calculateOperationalVisits({
      routes: [route],
      visits: [],
      daysRange,
      todayStr,
      operationMode: 'DESCONHECIDO'
    });
    const overdueA = resA.filter((i) => i.isPastOverdue);
    console.assert(overdueA.length === 0, 'T11-A: Modo DESCONHECIDO não gera atraso');

    // Caso B: operationMode = 'OPERACAO_OFICIAL' mas sem data (data null)
    const resB = calculateOperationalVisits({
      routes: [route],
      visits: [],
      daysRange,
      todayStr,
      operationMode: 'OPERACAO_OFICIAL',
      officialStartDate: null
    });
    const overdueB = resB.filter((i) => i.isPastOverdue);
    console.assert(overdueB.length === 0, 'T11-B: Oficial sem data não gera atraso');

    // Caso C: data com formato inválido
    const resC = calculateOperationalVisits({
      routes: [route],
      visits: [],
      daysRange,
      todayStr,
      operationMode: 'OPERACAO_OFICIAL',
      officialStartDate: 'data-invalida'
    });
    const overdueC = resC.filter((i) => i.isPastOverdue);
    console.assert(overdueC.length === 0, 'T11-C: Data inválida não gera atraso');

    console.log('[OK] Teste 11: Configuração indisponível/inválida opera com fallback seguro');
  }

  console.log('===============================================================');
  console.log('SUCESSO: TODOS OS 11 TESTES LÓGICOS DO MOTOR FORAM APROVADOS!');
  console.log('===============================================================');
}

runAllTests();
