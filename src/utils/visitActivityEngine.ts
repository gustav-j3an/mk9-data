import type { RouteItem, Visit } from '../types';
import { zoned, validDate } from './attendanceEngine';

export type OperationalPresenceStatus = 'presente' | 'sem_atividade';

export type RouteExecutionStatus =
  | 'COMPLETO'
  | 'PARCIAL'
  | 'NAO_REALIZADO'
  | 'EM_ATIVIDADE'
  | 'AGUARDANDO_INICIO'
  | 'SEM_PROGRAMACAO';

export interface PromoterOperationalSummary {
  promoterId: string;
  matricula: string;
  name: string;
  equipe: string;
  supervisor: string;
  presenceStatus: OperationalPresenceStatus;
  firstActivityTime: string | null;
  scheduledVisitsCount: number;
  completedVisitsCount: number;
  inProgressVisitsCount: number;
  pendingVisitsCount: number;
  routeStatus: RouteExecutionStatus;
  visits: PromoterVisitDetail[];
}

export interface PromoterVisitDetail {
  id: string;
  lojaCodigo: string;
  lojaNome: string;
  industriaCodigo: string;
  industriaNome: string;
  startedAt: string | null;
  completedAt: string | null;
  startedTimeFormatted: string | null;
  completedTimeFormatted: string | null;
  status: 'concluida' | 'em_andamento' | 'nao_realizada' | 'pendente';
  motivoNaoRealizada?: string | null;
  isScheduled: boolean;
}

export interface DayActivityInput {
  date: string;
  promoters: Array<{
    id: string;
    matricula: string;
    nome: string;
    equipe?: string | null;
    supervisor?: string | null;
    status: string;
  }>;
  routes: RouteItem[];
  visits: Visit[];
  now?: string;
  timezone?: string;
}

const DAY_KEYS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'] as const;

/**
 * Calcula a Presença Operacional e a Situação do Roteiro para todos os promotores na data.
 *
 * REGRAS OPERACIONAIS:
 * 1. Presença operacional é confirmada ('presente') quando o promotor inicia sua primeira visita válida do dia (started_at ou status 'em_andamento'/'concluida').
 * 2. Horário da primeira atividade registrado no fuso operacional (padrão 'America/Sao_Paulo').
 * 3. Classificação semântica precisa do Roteiro:
 *    - SEM_PROGRAMACAO: promotor não possui nenhuma visita programada para a data. Não gera falta.
 *    - COMPLETO: concluiu todas as visitas programadas (completedVisitsCount >= scheduledVisitsCount && scheduledVisitsCount > 0).
 *    - Se o dia operacional foi encerrado (date < today):
 *        * PARCIAL: concluiu pelo menos 1 visita, mas não todas.
 *        * NAO_REALIZADO: nenhuma visita programada concluída. Não gera falta automática CLT.
 *    - Se o dia operacional está em andamento (date >= today):
 *        * EM_ATIVIDADE: iniciou pelo menos uma visita válida (em andamento ou concluída), com visitas ainda pendentes para completar.
 *        * AGUARDANDO_INICIO: possui visitas programadas, mas nenhuma visita foi iniciada ainda no dia.
 * 4. Contagem precisa de visitas:
 *    - Respeita cada rota cadastrada válida para o dia da semana da data.
 *    - Chave de obrigação: promotor + loja + indústria. Múltiplas indústrias na mesma loja são obrigações distintas e ambas contam.
 *    - Rotas duplicadas com mesmo promotor, loja, indústria e frequência são desduplicadas por ID/chave idêntica.
 */
export function calculateOperationalActivity(input: DayActivityInput): PromoterOperationalSummary[] {
  const { date, promoters, routes, visits, timezone = 'America/Sao_Paulo' } = input;
  if (!validDate(date)) {
    throw new Error('Data operacional inválida.');
  }

  const nowIso = input.now || new Date().toISOString();
  const todayDateStr = zoned(nowIso, timezone).date;
  const isDayClosed = date < todayDateStr;

  const dayOfWeekIndex = new Date(`${date}T12:00:00Z`).getUTCDay();
  const dayKey = DAY_KEYS[dayOfWeekIndex];

  // Filtrar apenas promotores ativos
  const activePromoters = promoters.filter(p => p.status === 'ativo');

  // Indexar visitas do dia por promotor
  const visitsByPromoter = new Map<string, Visit[]>();
  visits.forEach(v => {
    if (v.data_visita === date) {
      const list = visitsByPromoter.get(v.promotor_matricula) || [];
      list.push(v);
      visitsByPromoter.set(v.promotor_matricula, list);
    }
  });

  // Indexar rotas ativas no dia da semana por promotor
  const routesByPromoter = new Map<string, RouteItem[]>();
  routes.forEach(r => {
    const isActiveForDay = Boolean(r[dayKey]);
    if (isActiveForDay) {
      const list = routesByPromoter.get(r.promotor_matricula) || [];
      list.push(r);
      routesByPromoter.set(r.promotor_matricula, list);
    }
  });

  return activePromoters.map(p => {
    const matricula = p.matricula;
    const promoterRoutes = routesByPromoter.get(matricula) || [];
    const promoterVisits = visitsByPromoter.get(matricula) || [];

    // Cada rota programada para o promotor na data representa uma obrigação de visita.
    // Chave única de obrigação: loja_codigo + '|' + industria_codigo.
    // Lojas diferentes para a mesma indústria OU indústrias diferentes na mesma loja são obrigações legítimas separadas.
    const scheduledKeys = new Set<string>();
    const deduplicatedRoutes: RouteItem[] = [];
    promoterRoutes.forEach(r => {
      const key = `${r.loja_codigo}|${r.industria_codigo}`;
      if (!scheduledKeys.has(key)) {
        scheduledKeys.add(key);
        deduplicatedRoutes.push(r);
      }
    });

    const scheduledVisitsCount = deduplicatedRoutes.length;

    // Mapear visitas existentes
    const visitDetails: PromoterVisitDetail[] = [];
    const visitedKeys = new Set<string>();

    promoterVisits.forEach(v => {
      const key = `${v.loja_codigo}|${v.industria_codigo}`;
      visitedKeys.add(key);
      const isScheduled = scheduledKeys.has(key);

      const startedFormatted = v.started_at ? zoned(v.started_at, timezone).time : null;
      const completedFormatted = v.completed_at ? zoned(v.completed_at, timezone).time : null;

      visitDetails.push({
        id: v.id,
        lojaCodigo: v.loja_codigo,
        lojaNome: (v as any).loja?.nome || v.loja_codigo,
        industriaCodigo: v.industria_codigo,
        industriaNome: (v as any).industria?.nome || v.industria_codigo,
        startedAt: v.started_at || null,
        completedAt: v.completed_at || null,
        startedTimeFormatted: startedFormatted,
        completedTimeFormatted: completedFormatted,
        status: (v.status as any) || 'pendente',
        motivoNaoRealizada: v.motivo_nao_realizada || null,
        isScheduled
      });
    });

    // Para rotas programadas que ainda não possuem registro de visita no banco, adicionar como 'pendente'
    deduplicatedRoutes.forEach(r => {
      const key = `${r.loja_codigo}|${r.industria_codigo}`;
      if (!visitedKeys.has(key)) {
        visitDetails.push({
          id: `planned-${r.id}`,
          lojaCodigo: r.loja_codigo,
          lojaNome: (r as any).loja?.nome || r.loja_codigo,
          industriaCodigo: r.industria_codigo,
          industriaNome: (r as any).industria?.nome || r.industria_codigo,
          startedAt: null,
          completedAt: null,
          startedTimeFormatted: null,
          completedTimeFormatted: null,
          status: 'pendente',
          isScheduled: true
        });
      }
    });

    // Contagem de visitas programadas
    const completedScheduled = visitDetails.filter(vd => vd.isScheduled && vd.status === 'concluida').length;
    const inProgressScheduled = visitDetails.filter(vd => vd.isScheduled && vd.status === 'em_andamento').length;
    const pendingScheduled = Math.max(0, scheduledVisitsCount - completedScheduled);

    // Presença operacional: confirmada se qualquer visita (programada ou avulsa) foi iniciada (started_at ou em_andamento ou concluída)
    // Visitas canceladas sem started_at ou marcadas como nao_realizada sem ter sido iniciada não contam
    const validStartedVisits = visitDetails.filter(vd => {
      if (vd.status === 'nao_realizada' && !vd.startedAt) return false;
      return Boolean(vd.startedAt) || vd.status === 'concluida' || vd.status === 'em_andamento';
    });

    const isPresent = validStartedVisits.length > 0;
    const presenceStatus: OperationalPresenceStatus = isPresent ? 'presente' : 'sem_atividade';

    // Primeiro horário de atividade (menor started_at)
    let firstActivityTime: string | null = null;
    const visitsWithStartedAt = validStartedVisits
      .filter(v => v.startedAt && Number.isFinite(Date.parse(v.startedAt)))
      .sort((a, b) => Date.parse(a.startedAt!) - Date.parse(b.startedAt!));

    if (visitsWithStartedAt.length > 0) {
      firstActivityTime = zoned(visitsWithStartedAt[0].startedAt!, timezone).time;
    }

    // Determinar Situação Semântica do Roteiro
    let routeStatus: RouteExecutionStatus = 'SEM_PROGRAMACAO';

    if (scheduledVisitsCount === 0) {
      routeStatus = 'SEM_PROGRAMACAO';
    } else if (completedScheduled >= scheduledVisitsCount) {
      routeStatus = 'COMPLETO';
    } else {
      if (isDayClosed) {
        // Dia encerrado no passado
        if (completedScheduled > 0) {
          routeStatus = 'PARCIAL';
        } else {
          routeStatus = 'NAO_REALIZADO';
        }
      } else {
        // Dia de hoje ou futuro (em andamento)
        if (isPresent) {
          routeStatus = 'EM_ATIVIDADE';
        } else {
          routeStatus = 'AGUARDANDO_INICIO';
        }
      }
    }

    return {
      promoterId: p.id,
      matricula: p.matricula,
      name: p.nome,
      equipe: p.equipe || 'Geral',
      supervisor: p.supervisor || 'Não atribuído',
      presenceStatus,
      firstActivityTime,
      scheduledVisitsCount,
      completedVisitsCount: completedScheduled,
      inProgressVisitsCount: inProgressScheduled,
      pendingVisitsCount: pendingScheduled,
      routeStatus,
      visits: visitDetails
    };
  }).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}
