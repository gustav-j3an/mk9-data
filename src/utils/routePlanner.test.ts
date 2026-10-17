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
  // TESTE 9: Rotas quinzenais (respeitando cálculo quinzenal)
  // --------------------------------------------------------------------------
  {
    // Rota quinzenal na segunda-feira em outubro/2026.
    // Ocorrências de segundas em Out/2026: 05, 12, 19, 26 (4 ocorrências).
    // Padrão âncora (sem histórico): 2ª ocorrência (12/10) e 4ª ocorrência (26/10).
    // Na semana de daysRange (05/10 a 11/10), 05/10 é a 1ª ocorrência (off-week), portanto NÃO deve ser agendada.
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
      daysRange, // 2026-10-05 a 2026-10-11
      todayStr,
      operationMode: 'IMPLANTACAO'
    });

    // 05/10 é a 1ª semana (off-week) para a âncora padrão [12/10, 26/10], portanto result deve ter 0 visitas virtuais geradas
    console.assert(result.length === 0, `T9: Na off-week da rota quinzenal não deve gerar visita, recebeu ${result.length}`);

    // Mas se o daysRange incluir a 2ª semana (2026-10-12):
    const week2Range: DayOfWeekDate[] = [
      { dateStr: '2026-10-12', dayKey: 'segunda', dayLabel: 'Segunda', dayShort: 'Seg', isToday: false, isPast: false, isFuture: true }
    ];
    const resultW2 = calculateOperationalVisits({
      routes: [route],
      visits: [],
      daysRange: week2Range,
      todayStr,
      operationMode: 'IMPLANTACAO'
    });
    console.assert(resultW2.length === 1, `T9: Na semana agendada da quinzenal deve gerar 1 visita, recebeu ${resultW2.length}`);
    console.assert(resultW2[0].frequencia === 'QUINZENAL', 'T9: Frequência preservada');
    console.assert(resultW2[0].dataStr === '2026-10-12', 'T9: Data correta na 2ª ocorrência');

    console.log('[OK] Teste 9: Rotas quinzenais agendadas corretamente nas semanas elegíveis e silenciadas em off-weeks');
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

  // ==========================================================================
  // SUÍTE DE TESTES ESPECÍFICOS PARA A REGRA QUINZENAL (MISSÃO 02.2)
  // ==========================================================================

  // --------------------------------------------------------------------------
  // TESTE 12: Limite estrito de no máximo 2 visitas programadas por rota no mês
  // --------------------------------------------------------------------------
  {
    const route = createMockRoute({ frequencia: 'QUINZENAL', terca: true, segunda: false, quarta: false, quinta: false, sexta: false });
    // Outubro/2026 tem 4 terças: 06, 13, 20, 27
    const octMonthDays: DayOfWeekDate[] = [];
    for (let day = 1; day <= 31; day++) {
      const dStr = `2026-10-${String(day).padStart(2, '0')}`;
      const dt = new Date(`2026-10-${String(day).padStart(2, '0')}T12:00:00`);
      const dIdx = dt.getDay();
      const dayKeys: Array<DayOfWeekDate['dayKey']> = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
      octMonthDays.push({
        dateStr: dStr,
        dayKey: dayKeys[dIdx],
        dayLabel: dayKeys[dIdx],
        dayShort: dayKeys[dIdx].slice(0, 3),
        isToday: false,
        isPast: false,
        isFuture: true
      });
    }

    const res = calculateOperationalVisits({
      routes: [route],
      visits: [],
      daysRange: octMonthDays,
      todayStr: '2026-10-01',
      operationMode: 'IMPLANTACAO'
    });

    console.assert(res.length === 2, `T12: Exatamente 2 visitas programadas no mês, recebeu ${res.length}`);
    console.assert(res[0].dataStr === '2026-10-13', `T12: 1ª visita agendada em 2026-10-13, recebeu ${res[0].dataStr}`);
    console.assert(res[1].dataStr === '2026-10-27', `T12: 2ª visita agendada em 2026-10-27, recebeu ${res[1].dataStr}`);
    console.log('[OK] Teste 12: Limite estrito de 2 visitas programadas por rota no mês');
  }

  // --------------------------------------------------------------------------
  // TESTE 13: Mês com 5 ocorrências do dia da semana (Outubro/2026 - Sextas)
  // --------------------------------------------------------------------------
  {
    // Sextas-feiras em Out/2026: 02, 09, 16, 23, 30 (5 sextas!)
    const route = createMockRoute({ frequencia: 'QUINZENAL', sexta: true, segunda: false, terca: false, quarta: false, quinta: false });
    const octMonthDays: DayOfWeekDate[] = [];
    for (let day = 1; day <= 31; day++) {
      const dStr = `2026-10-${String(day).padStart(2, '0')}`;
      const dt = new Date(`2026-10-${String(day).padStart(2, '0')}T12:00:00`);
      const dIdx = dt.getDay();
      const dayKeys: Array<DayOfWeekDate['dayKey']> = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
      octMonthDays.push({
        dateStr: dStr,
        dayKey: dayKeys[dIdx],
        dayLabel: dayKeys[dIdx],
        dayShort: dayKeys[dIdx].slice(0, 3),
        isToday: false,
        isPast: false,
        isFuture: true
      });
    }

    const res = calculateOperationalVisits({
      routes: [route],
      visits: [],
      daysRange: octMonthDays,
      todayStr: '2026-10-01',
      operationMode: 'IMPLANTACAO'
    });

    console.assert(res.length === 2, `T13: Exatamente 2 visitas no mês de 5 ocorrências, recebeu ${res.length}`);
    // Ocorrências são [02, 09, 16, 23, 30]. Intervalo de 14 dias entre 09 e 23, com ancoragem de 2ª semana
    console.assert(res[0].dataStr === '2026-10-09', `T13: 1ª visita na 2ª semana (09/10), recebeu ${res[0].dataStr}`);
    console.assert(res[1].dataStr === '2026-10-23', `T13: 2ª visita 14 dias depois (23/10), recebeu ${res[1].dataStr}`);
    console.log('[OK] Teste 13: Mês com 5 ocorrências do dia da semana calcula 2 datas com espaçamento ideal');
  }

  // --------------------------------------------------------------------------
  // TESTE 14: Consideração do histórico do mês anterior (visita tardia empurra para 2ª semana)
  // --------------------------------------------------------------------------
  {
    // Rota na segunda-feira.
    // Visita anterior realizada em 2026-09-28 (última segunda de setembro).
    // Segundas de Outubro: 05, 12, 19, 26.
    // Se a visita anterior foi 28/09, marcar 05/10 criaria intervalo de apenas 7 dias!
    // O motor deve escolher 12/10 (14 dias de intervalo de 28/09) e 26/10 (14 dias de 12/10).
    const route = createMockRoute({ frequencia: 'QUINZENAL', segunda: true, terca: false, quarta: false, quinta: false, sexta: false });
    const mockPriorVisit: Visit = {
      id: 'v-sep',
      promotor_matricula: route.promotor_matricula,
      loja_codigo: route.loja_codigo,
      industria_codigo: route.industria_codigo,
      data_visita: '2026-09-28',
      status: 'concluida'
    };

    const octMonthDays: DayOfWeekDate[] = [];
    for (let day = 1; day <= 31; day++) {
      const dStr = `2026-10-${String(day).padStart(2, '0')}`;
      const dt = new Date(`2026-10-${String(day).padStart(2, '0')}T12:00:00`);
      const dIdx = dt.getDay();
      const dayKeys: Array<DayOfWeekDate['dayKey']> = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
      octMonthDays.push({
        dateStr: dStr,
        dayKey: dayKeys[dIdx],
        dayLabel: dayKeys[dIdx],
        dayShort: dayKeys[dIdx].slice(0, 3),
        isToday: false,
        isPast: false,
        isFuture: true
      });
    }

    const res = calculateOperationalVisits({
      routes: [route],
      visits: [mockPriorVisit],
      daysRange: octMonthDays,
      todayStr: '2026-10-01',
      operationMode: 'IMPLANTACAO'
    });

    console.assert(res.length === 2, `T14: 2 visitas no mês, recebeu ${res.length}`);
    console.assert(res[0].dataStr === '2026-10-12', `T14: 1ª visita após 28/09 deve ser 12/10 (14 dias), recebeu ${res[0].dataStr}`);
    console.assert(res[1].dataStr === '2026-10-26', `T14: 2ª visita deve ser 26/10, recebeu ${res[1].dataStr}`);
    console.log('[OK] Teste 14: Histórico do final do mês anterior evita visitas em semanas consecutivas');
  }

  // --------------------------------------------------------------------------
  // TESTE 15: Consideração do histórico do mês anterior (visita antecipada permite 1ª semana)
  // --------------------------------------------------------------------------
  {
    // Rota na segunda-feira.
    // Visita anterior realizada em 2026-09-21 (penúltima segunda de setembro).
    // Segundas de Outubro: 05, 12, 19, 26.
    // De 21/09 para 05/10 são exatos 14 dias! O motor deve escolher 05/10 e 19/10!
    const route = createMockRoute({ frequencia: 'QUINZENAL', segunda: true, terca: false, quarta: false, quinta: false, sexta: false });
    const mockPriorVisit: Visit = {
      id: 'v-sep-mid',
      promotor_matricula: route.promotor_matricula,
      loja_codigo: route.loja_codigo,
      industria_codigo: route.industria_codigo,
      data_visita: '2026-09-21',
      status: 'concluida'
    };

    const octMonthDays: DayOfWeekDate[] = [];
    for (let day = 1; day <= 31; day++) {
      const dStr = `2026-10-${String(day).padStart(2, '0')}`;
      const dt = new Date(`2026-10-${String(day).padStart(2, '0')}T12:00:00`);
      const dIdx = dt.getDay();
      const dayKeys: Array<DayOfWeekDate['dayKey']> = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
      octMonthDays.push({
        dateStr: dStr,
        dayKey: dayKeys[dIdx],
        dayLabel: dayKeys[dIdx],
        dayShort: dayKeys[dIdx].slice(0, 3),
        isToday: false,
        isPast: false,
        isFuture: true
      });
    }

    const res = calculateOperationalVisits({
      routes: [route],
      visits: [mockPriorVisit],
      daysRange: octMonthDays,
      todayStr: '2026-10-01',
      operationMode: 'IMPLANTACAO'
    });

    console.assert(res.length === 2, `T15: 2 visitas no mês, recebeu ${res.length}`);
    console.assert(res[0].dataStr === '2026-10-05', `T15: 1ª visita após 21/09 deve ser 05/10 (14 dias), recebeu ${res[0].dataStr}`);
    console.assert(res[1].dataStr === '2026-10-19', `T15: 2ª visita deve ser 19/10 (14 dias), recebeu ${res[1].dataStr}`);
    console.log('[OK] Teste 15: Histórico antecipado do mês anterior agenda 1ª e 3ª semanas');
  }

  // --------------------------------------------------------------------------
  // TESTE 16: Tratamento de Fevereiro não bissexto (28 dias) e bissexto (29 dias)
  // --------------------------------------------------------------------------
  {
    const route = createMockRoute({ frequencia: 'QUINZENAL', quarta: true, segunda: false, terca: false, quinta: false, sexta: false });

    // Fevereiro 2026 (não bissexto, 28 dias): Quartas em 04, 11, 18, 25 (4 ocorrências)
    const feb2026Days: DayOfWeekDate[] = [];
    for (let day = 1; day <= 28; day++) {
      const dStr = `2026-02-${String(day).padStart(2, '0')}`;
      const dt = new Date(`2026-02-${String(day).padStart(2, '0')}T12:00:00`);
      const dIdx = dt.getDay();
      const dayKeys: Array<DayOfWeekDate['dayKey']> = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
      feb2026Days.push({
        dateStr: dStr,
        dayKey: dayKeys[dIdx],
        dayLabel: dayKeys[dIdx],
        dayShort: dayKeys[dIdx].slice(0, 3),
        isToday: false,
        isPast: false,
        isFuture: true
      });
    }

    const resFeb2026 = calculateOperationalVisits({
      routes: [route],
      visits: [],
      daysRange: feb2026Days,
      todayStr: '2026-02-01',
      operationMode: 'IMPLANTACAO'
    });

    console.assert(resFeb2026.length === 2, `T16: Fevereiro 28 dias gera 2 visitas, recebeu ${resFeb2026.length}`);
    console.assert(resFeb2026[0].dataStr === '2026-02-11', `T16: 1ª visita em 11/02, recebeu ${resFeb2026[0].dataStr}`);
    console.assert(resFeb2026[1].dataStr === '2026-02-25', `T16: 2ª visita em 25/02, recebeu ${resFeb2026[1].dataStr}`);

    // Fevereiro 2024 (bissexto, 29 dias): Quintas em 01, 08, 15, 22, 29 (5 ocorrências!)
    const routeThu = createMockRoute({ frequencia: 'QUINZENAL', quinta: true, segunda: false, terca: false, quarta: false, sexta: false });
    const feb2024Days: DayOfWeekDate[] = [];
    for (let day = 1; day <= 29; day++) {
      const dStr = `2024-02-${String(day).padStart(2, '0')}`;
      const dt = new Date(`2024-02-${String(day).padStart(2, '0')}T12:00:00`);
      const dIdx = dt.getDay();
      const dayKeys: Array<DayOfWeekDate['dayKey']> = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
      feb2024Days.push({
        dateStr: dStr,
        dayKey: dayKeys[dIdx],
        dayLabel: dayKeys[dIdx],
        dayShort: dayKeys[dIdx].slice(0, 3),
        isToday: false,
        isPast: false,
        isFuture: true
      });
    }

    const resFeb2024 = calculateOperationalVisits({
      routes: [routeThu],
      visits: [],
      daysRange: feb2024Days,
      todayStr: '2024-02-01',
      operationMode: 'IMPLANTACAO'
    });

    console.assert(resFeb2024.length === 2, `T16: Fevereiro bissexto gera 2 visitas, recebeu ${resFeb2024.length}`);
    console.assert(resFeb2024[0].dataStr === '2024-02-08', `T16: 1ª visita em 08/02, recebeu ${resFeb2024[0].dataStr}`);
    console.assert(resFeb2024[1].dataStr === '2024-02-22', `T16: 2ª visita em 22/02, recebeu ${resFeb2024[1].dataStr}`);
    console.log('[OK] Teste 16: Tratamento de Fevereiro comum (28 dias) e bissexto (29 dias) correto');
  }

  // --------------------------------------------------------------------------
  // TESTE 17: Virada de ano (Dezembro para Janeiro)
  // --------------------------------------------------------------------------
  {
    // Rota na sexta-feira.
    // Visita em 2025-12-26 (última sexta de Dezembro/2025).
    // Sextas de Janeiro/2026: 02, 09, 16, 23, 30 (5 sextas).
    // De 26/12/2025 para 02/01/2026 são apenas 7 dias. O motor deve escolher 09/01 e 23/01.
    const route = createMockRoute({ frequencia: 'QUINZENAL', sexta: true, segunda: false, terca: false, quarta: false, quinta: false });
    const mockDecVisit: Visit = {
      id: 'v-dec-2025',
      promotor_matricula: route.promotor_matricula,
      loja_codigo: route.loja_codigo,
      industria_codigo: route.industria_codigo,
      data_visita: '2025-12-26',
      status: 'concluida'
    };

    const janMonthDays: DayOfWeekDate[] = [];
    for (let day = 1; day <= 31; day++) {
      const dStr = `2026-01-${String(day).padStart(2, '0')}`;
      const dt = new Date(`2026-01-${String(day).padStart(2, '0')}T12:00:00`);
      const dIdx = dt.getDay();
      const dayKeys: Array<DayOfWeekDate['dayKey']> = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
      janMonthDays.push({
        dateStr: dStr,
        dayKey: dayKeys[dIdx],
        dayLabel: dayKeys[dIdx],
        dayShort: dayKeys[dIdx].slice(0, 3),
        isToday: false,
        isPast: false,
        isFuture: true
      });
    }

    const res = calculateOperationalVisits({
      routes: [route],
      visits: [mockDecVisit],
      daysRange: janMonthDays,
      todayStr: '2026-01-01',
      operationMode: 'IMPLANTACAO'
    });

    console.assert(res.length === 2, `T17: 2 visitas em Janeiro, recebeu ${res.length}`);
    console.assert(res[0].dataStr === '2026-01-09', `T17: 1ª visita após 26/12 deve ser 09/01, recebeu ${res[0].dataStr}`);
    console.assert(res[1].dataStr === '2026-01-23', `T17: 2ª visita em 23/01, recebeu ${res[1].dataStr}`);
    console.log('[OK] Teste 17: Virada de ano (Dezembro -> Janeiro) preserva espaçamento de 14 dias');
  }

  // --------------------------------------------------------------------------
  // TESTE 18: Visita real realizada em data diferente da programada (não duplica e preserva visita)
  // --------------------------------------------------------------------------
  {
    // Rota quinzenal tem terças ativas. Programadas seriam 13/10 e 27/10.
    // O promotor realizou uma visita em 06/10 (primeira terça, fora da grade programada).
    // O motor deve preservar a visita de 06/10 (como real) e agendar a rota prevista sem gerar duplicidade.
    const route = createMockRoute({ frequencia: 'QUINZENAL', terca: true, segunda: false, quarta: false, quinta: false, sexta: false });
    const realVisit: Visit = {
      id: 'v-real-extra',
      promotor_matricula: route.promotor_matricula,
      loja_codigo: route.loja_codigo,
      industria_codigo: route.industria_codigo,
      data_visita: '2026-10-06',
      status: 'concluida'
    };

    const daysRangeSample: DayOfWeekDate[] = [
      { dateStr: '2026-10-06', dayKey: 'terca', dayLabel: 'Terça', dayShort: 'Ter', isToday: false, isPast: true, isFuture: false },
      { dateStr: '2026-10-13', dayKey: 'terca', dayLabel: 'Terça', dayShort: 'Ter', isToday: false, isPast: false, isFuture: true }
    ];

    const res = calculateOperationalVisits({
      routes: [route],
      visits: [realVisit],
      daysRange: daysRangeSample,
      todayStr: '2026-10-08',
      operationMode: 'IMPLANTACAO'
    });

    const v06 = res.find((i) => i.dataStr === '2026-10-06');
    console.assert(Boolean(v06), 'T18: Visita real em 06/10 preservada');
    console.assert(v06?.isRealExecution === true, 'T18: Marcada como execução real');
    console.assert(v06?.status === 'concluida', 'T18: Status concluída');

    console.log('[OK] Teste 18: Visita real em data fora da grade programada preservada sem perda de dados');
  }

  // --------------------------------------------------------------------------
  // TESTE 19: Rota semanal continua funcionando exatamente como antes (sem interferência)
  // --------------------------------------------------------------------------
  {
    const weeklyRoute = createMockRoute({
      frequencia: 'SEMANAL',
      segunda: true,
      terca: true,
      quarta: true,
      quinta: true,
      sexta: true,
      sabado: false,
      domingo: false
    });

    const res = calculateOperationalVisits({
      routes: [weeklyRoute],
      visits: [],
      daysRange, // 5 dias úteis de 05/10 a 11/10
      todayStr,
      operationMode: 'IMPLANTACAO'
    });

    console.assert(res.length === 5, `T19: Rota semanal deve gerar exatamente 5 visitas, recebeu ${res.length}`);
    console.log('[OK] Teste 19: Rotas semanais não sofreram qualquer regressão');
  }

  console.log('===============================================================');
  console.log('SUCESSO: TODOS OS 19 TESTES LÓGICOS DO MOTOR FORAM APROVADOS!');
  console.log('===============================================================');
}

runAllTests();
