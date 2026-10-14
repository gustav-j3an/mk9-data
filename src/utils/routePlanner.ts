import { RouteItem, Visit, OperationMode } from '../types';

export type OperationalVisitStatus = 'concluida' | 'em_andamento' | 'nao_realizada' | 'pendente' | 'planejada';

export interface OperationalVisitItem {
  key: string;
  routeId: string;
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
  status: OperationalVisitStatus;
  motivoNaoRealizada?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  duracaoFormatada?: string | null;
  visitObj?: Visit | null;
  isPastOverdue: boolean;
  priorityOrder: number;
  isRealExecution?: boolean;
}

export interface DayOfWeekDate {
  dateStr: string;
  dayKey: 'domingo' | 'segunda' | 'terca' | 'quarta' | 'quinta' | 'sexta' | 'sabado';
  dayLabel: string;
  dayShort: string;
  isToday: boolean;
  isPast: boolean;
  isFuture: boolean;
}

/**
 * Formata um objeto Date em YYYY-MM-DD considerando a timezone local do usuário.
 */
export const getLocalDateString = (d: Date): string => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Retorna os dias da semana (Segunda a Domingo) para uma determinada data base ou deslocamento.
 */
export const getWeekDaysRange = (baseDate: Date = new Date(), weekOffset: number = 0): DayOfWeekDate[] => {
  const current = new Date(baseDate);
  current.setDate(current.getDate() + weekOffset * 7);

  // Ajusta para a segunda-feira da semana (0 = domingo, 1 = segunda, ..., 6 = sábado)
  const day = current.getDay();
  const diffToMonday = current.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(current.setDate(diffToMonday));

  const dayKeys: Array<'segunda' | 'terca' | 'quarta' | 'quinta' | 'sexta' | 'sabado' | 'domingo'> = [
    'segunda',
    'terca',
    'quarta',
    'quinta',
    'sexta',
    'sabado',
    'domingo'
  ];

  const dayLabels = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
  const dayShorts = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

  const todayStr = getLocalDateString(new Date());

  const days: DayOfWeekDate[] = [];

  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dateStr = getLocalDateString(d);

    days.push({
      dateStr,
      dayKey: dayKeys[i],
      dayLabel: dayLabels[i],
      dayShort: dayShorts[i],
      isToday: dateStr === todayStr,
      isPast: dateStr < todayStr,
      isFuture: dateStr > todayStr
    });
  }

  return days;
};

/**
 * Motor central compartilhado de cálculo de Pendências e Agenda Operacional.
 * Garante que Gestor e Promotor utilizem EXATAMENTE a mesma verdade lógica.
 */
export interface CalculateOperationalVisitsParams {
  routes: RouteItem[];
  visits: Visit[];
  promotoresList?: any[];
  industriasList?: any[];
  daysRange: DayOfWeekDate[];
  todayStr?: string;
  operationMode?: OperationMode | 'DESCONHECIDO';
  officialStartDate?: string | null;
}

/**
 * Motor central compartilhado de cálculo de Pendências e Agenda Operacional.
 * Garante que Gestor e Promotor utilizem EXATAMENTE a mesma verdade lógica.
 * 
 * Regras Operacionais por Modo:
 * - IMPLANTACAO (ou desconhecido/inválido): Rotas sem visita não geram atrasos virtuais.
 *   Visitas reais registradas no banco são integralmente preservadas.
 * - OPERACAO_OFICIAL: Usa officialStartDate como corte inicial para geração de pendências e atrasos.
 *   Períodos anteriores ao início oficial constam como planejamento, sem gerar atraso.
 */
export const calculateOperationalVisits = ({
  routes,
  visits,
  promotoresList = [],
  industriasList = [],
  daysRange,
  todayStr = getLocalDateString(new Date()),
  operationMode = 'IMPLANTACAO',
  officialStartDate = null
}: CalculateOperationalVisitsParams): OperationalVisitItem[] => {
  // 1. Determinar o modo operacional efetivo com tratamento de segurança
  // Se o modo for desconhecido, inválido ou diferente de OPERACAO_OFICIAL, adota IMPLANTACAO
  const isOfficialMode = operationMode === 'OPERACAO_OFICIAL';

  // Validar se há data oficial válida no formato YYYY-MM-DD
  const hasValidOfficialDate =
    isOfficialMode &&
    typeof officialStartDate === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(officialStartDate.trim());

  const cleanOfficialStartDate = hasValidOfficialDate ? officialStartDate!.trim() : null;

  // A operação oficial só gera pendências/atrasos se estiver no modo oficial E possuir data de corte válida
  const isOfficialLive = isOfficialMode && cleanOfficialStartDate !== null;

  // 2. Indexar visitas reais pela chave única: `promotor_matricula|loja_codigo|industria_codigo|data_visita`
  const visitsMap = new Map<string, Visit>();
  visits.forEach((v) => {
    const k = `${v.promotor_matricula}|${v.loja_codigo}|${v.industria_codigo}|${v.data_visita}`;
    visitsMap.set(k, v);
  });

  const plannedItems: OperationalVisitItem[] = [];
  const matchedVisitKeys = new Set<string>();

  // 3. Processar cada rota ativa para os dias solicitados
  routes.forEach((r) => {
    daysRange.forEach((dayInfo) => {
      const isDayActive = Boolean(r[dayInfo.dayKey as keyof RouteItem]);
      if (isDayActive) {
        const key = `${r.promotor_matricula}|${r.loja_codigo}|${r.industria_codigo}|${dayInfo.dateStr}`;
        const v = visitsMap.get(key);

        const promotorObj = r.promotor || promotoresList.find((p) => p.matricula === r.promotor_matricula);
        const industriaObj = r.industria || industriasList.find((ind) => ind.codigo === r.industria_codigo);

        let status: OperationalVisitStatus = 'planejada';
        let startedAt: string | null = null;
        let completedAt: string | null = null;
        let motivoNaoRealizada: string | null = null;
        let duracaoFormatada: string | null = null;
        let isPastOverdue = false;
        let priorityOrder = 5;
        let isRealExecution = false;

        if (v) {
          matchedVisitKeys.add(key);
          isRealExecution = true;
          startedAt = v.started_at || null;
          completedAt = v.completed_at || null;
          motivoNaoRealizada = v.motivo_nao_realizada || null;

          if (v.status === 'concluida') {
            status = 'concluida';
            priorityOrder = 4;
            isPastOverdue = false;
          } else if (v.status === 'em_andamento') {
            status = 'em_andamento';
            priorityOrder = 3;
            isPastOverdue = false;
          } else if (v.status === 'nao_realizada') {
            status = 'nao_realizada';
            priorityOrder = 2;
            isPastOverdue = false;
          } else {
            // Se o status da visita no banco for 'pendente' ou incompleto
            if (isOfficialLive) {
              if (dayInfo.dateStr < cleanOfficialStartDate!) {
                // Período anterior ao início oficial: não gera atraso artificial
                status = 'planejada';
                priorityOrder = 5;
                isPastOverdue = false;
              } else if (dayInfo.dateStr === todayStr) {
                status = 'pendente';
                priorityOrder = 1;
                isPastOverdue = false;
              } else if (dayInfo.dateStr < todayStr) {
                status = 'pendente';
                isPastOverdue = true;
                priorityOrder = 1.5;
              } else {
                status = 'planejada';
                priorityOrder = 5;
                isPastOverdue = false;
              }
            } else {
              // Modo IMPLANTACAO ou sem corte oficial: não gera atrasos
              if (dayInfo.dateStr === todayStr) {
                status = 'pendente';
                priorityOrder = 1;
                isPastOverdue = false;
              } else {
                status = 'planejada';
                priorityOrder = 5;
                isPastOverdue = false;
              }
            }
          }

          // Calcular Duração para Visitas Concluídas
          if (startedAt && completedAt) {
            const sTime = new Date(startedAt).getTime();
            const cTime = new Date(completedAt).getTime();
            const diffMs = cTime - sTime;
            if (diffMs > 0) {
              const totalMin = Math.floor(diffMs / 60000);
              const hours = Math.floor(totalMin / 60);
              const mins = totalMin % 60;
              duracaoFormatada = hours > 0 ? `${hours}h ${mins}min` : `${mins}min`;
            }
          }
        } else {
          // Sem registro de visita no banco para essa chave (apenas rota cadastrada)
          isRealExecution = false;

          if (isOfficialLive) {
            // Modo OPERACAO_OFICIAL com data de início válida
            if (dayInfo.dateStr < cleanOfficialStartDate!) {
              // Data anterior ao início oficial: planejamento histórico, sem atraso
              status = 'planejada';
              priorityOrder = 5;
              isPastOverdue = false;
            } else if (dayInfo.dateStr === todayStr) {
              status = 'pendente';
              priorityOrder = 1;
              isPastOverdue = false;
            } else if (dayInfo.dateStr < todayStr) {
              status = 'pendente';
              isPastOverdue = true;
              priorityOrder = 1.5;
            } else {
              status = 'planejada';
              priorityOrder = 5;
              isPastOverdue = false;
            }
          } else {
            // Modo IMPLANTACAO: rotas cadastradas são planejamento sem pendências/atrasos artificiais
            status = 'planejada';
            priorityOrder = 5;
            isPastOverdue = false;
          }
        }

        plannedItems.push({
          key,
          routeId: r.id,
          dataStr: dayInfo.dateStr,
          dayOfWeekLabel: dayInfo.dayLabel,
          promotorMatricula: r.promotor_matricula,
          promotorNome: promotorObj?.nome || r.promotor_matricula,
          lojaCodigo: r.loja_codigo,
          lojaNome: r.loja?.nome || r.loja_codigo,
          lojaCidade: r.loja?.cidade,
          lojaUf: r.loja?.uf,
          industriaCodigo: r.industria_codigo,
          industriaNome: industriaObj?.nome || r.industria_codigo,
          frequencia: r.frequencia || 'SEMANAL',
          status,
          motivoNaoRealizada,
          startedAt,
          completedAt,
          duracaoFormatada,
          visitObj: v || null,
          isPastOverdue,
          priorityOrder,
          isRealExecution
        });
      }
    });
  });

  // 4. Preservar visitas reais avulsas ou fora da grade que estejam no daysRange
  // Garante que NENHUMA visita real é perdida e NENHUMA visita é contada em dobro
  visits.forEach((v) => {
    const dayInfo = daysRange.find((d) => d.dateStr === v.data_visita);
    if (!dayInfo) return;

    const key = `${v.promotor_matricula}|${v.loja_codigo}|${v.industria_codigo}|${v.data_visita}`;
    if (matchedVisitKeys.has(key)) return; // Já incluída e combinada com a rota planejada

    matchedVisitKeys.add(key);

    const promotorObj = v.promotor || promotoresList.find((p) => p.matricula === v.promotor_matricula);
    const industriaObj = v.industria || industriasList.find((ind) => ind.codigo === v.industria_codigo);
    const lojaObj = v.loja;

    let priorityOrder = 5;
    if (v.status === 'pendente') priorityOrder = 1;
    else if (v.status === 'nao_realizada') priorityOrder = 2;
    else if (v.status === 'em_andamento') priorityOrder = 3;
    else if (v.status === 'concluida') priorityOrder = 4;

    let duracaoFormatada: string | null = null;
    if (v.started_at && v.completed_at) {
      const sTime = new Date(v.started_at).getTime();
      const cTime = new Date(v.completed_at).getTime();
      const diffMs = cTime - sTime;
      if (diffMs > 0) {
        const totalMin = Math.floor(diffMs / 60000);
        const hours = Math.floor(totalMin / 60);
        const mins = totalMin % 60;
        duracaoFormatada = hours > 0 ? `${hours}h ${mins}min` : `${mins}min`;
      }
    }

    plannedItems.push({
      key,
      routeId: v.rota_id || '',
      dataStr: dayInfo.dateStr,
      dayOfWeekLabel: dayInfo.dayLabel,
      promotorMatricula: v.promotor_matricula,
      promotorNome: promotorObj?.nome || v.promotor_matricula,
      lojaCodigo: v.loja_codigo,
      lojaNome: lojaObj?.nome || v.loja_codigo,
      lojaCidade: lojaObj?.cidade,
      lojaUf: lojaObj?.uf,
      industriaCodigo: v.industria_codigo,
      industriaNome: industriaObj?.nome || v.industria_codigo,
      frequencia: 'AVULSA',
      status: v.status as OperationalVisitStatus,
      motivoNaoRealizada: v.motivo_nao_realizada || null,
      startedAt: v.started_at || null,
      completedAt: v.completed_at || null,
      duracaoFormatada,
      visitObj: v,
      isPastOverdue: false,
      priorityOrder,
      isRealExecution: true
    });
  });

  // 5. Ordenação das pendências:
  // 1. Pendências de hoje; 2. Pendências atrasadas; 3. Não realizadas; 4. Em andamento; 5. Demais registros.
  // Dentro de cada grupo, data mais antiga primeiro.
  return plannedItems.sort((a, b) => {
    if (a.priorityOrder !== b.priorityOrder) {
      return a.priorityOrder - b.priorityOrder;
    }
    const timeA = new Date(a.dataStr).getTime();
    const timeB = new Date(b.dataStr).getTime();
    if (timeA !== timeB) return timeA - timeB;
    return a.lojaNome.localeCompare(b.lojaNome);
  });
};
