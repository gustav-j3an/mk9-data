import { RouteItem, Visit } from '../types';

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
export const calculateOperationalVisits = ({
  routes,
  visits,
  promotoresList = [],
  industriasList = [],
  daysRange,
  todayStr = getLocalDateString(new Date())
}: {
  routes: RouteItem[];
  visits: Visit[];
  promotoresList?: any[];
  industriasList?: any[];
  daysRange: DayOfWeekDate[];
  todayStr?: string;
}): OperationalVisitItem[] => {
  // Indexar visitas reais pela chave única: `promotor_matricula|loja_codigo|industria_codigo|data_visita`
  const visitsMap = new Map<string, Visit>();
  visits.forEach((v) => {
    const k = `${v.promotor_matricula}|${v.loja_codigo}|${v.industria_codigo}|${v.data_visita}`;
    visitsMap.set(k, v);
  });

  const plannedItems: OperationalVisitItem[] = [];

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

        if (v) {
          startedAt = v.started_at || null;
          completedAt = v.completed_at || null;
          motivoNaoRealizada = v.motivo_nao_realizada || null;

          if (v.status === 'concluida' && v.completed_at != null) {
            status = 'concluida';
            priorityOrder = 4;
          } else if (v.status === 'em_andamento') {
            status = 'em_andamento';
            priorityOrder = 3;
          } else if (v.status === 'nao_realizada') {
            status = 'nao_realizada';
            priorityOrder = 2;
          } else {
            // Se o status da visita for 'pendente' ou incompleto
            if (dayInfo.dateStr === todayStr) {
              status = 'pendente';
              priorityOrder = 1;
            } else if (dayInfo.dateStr < todayStr) {
              status = 'pendente';
              isPastOverdue = true;
              priorityOrder = 1.5;
            } else {
              status = 'planejada';
              priorityOrder = 5;
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
          // Sem registro de visita no banco para essa chave
          if (dayInfo.dateStr === todayStr) {
            status = 'pendente';
            priorityOrder = 1;
          } else if (dayInfo.dateStr < todayStr) {
            status = 'pendente';
            isPastOverdue = true;
            priorityOrder = 1.5;
          } else {
            status = 'planejada';
            priorityOrder = 5;
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
          priorityOrder
        });
      }
    });
  });

  // Ordenação das pendências (Conforme Requisito 17):
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
