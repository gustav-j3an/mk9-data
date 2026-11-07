import type { OperationalVisitStatus, OperationalVisitItem } from './routePlanner';
import type { RouteItem, Visit } from '../types';

export type ScheduledVisitAction = 'advance' | 'recover';

export interface ScheduledActionDecision {
  allowed: boolean;
  action?: ScheduledVisitAction;
  reason?: string;
  isSameDayConflict?: boolean;
}

export type ScheduledRouteEligibility = 'active' | 'closed' | 'unavailable';

export function getScheduledRouteEligibility(route: Pick<RouteItem, 'encerrada_em' | 'industria'> | null | undefined): ScheduledRouteEligibility {
  if (!route || route.industria?.status !== 'ativo') return 'unavailable';
  if (route.encerrada_em) return 'closed';
  return 'active';
}

export function isRouteVisibleInOperationalHistory(route: Pick<RouteItem, 'encerrada_em'>, historyStart: string): boolean {
  return !route.encerrada_em || String(route.encerrada_em).slice(0, 10) >= historyStart;
}

export function isScheduledVisitActionRpcReady(error: { code?: unknown; message?: unknown } | null | undefined): boolean {
  return error?.code === '22023' && error.message === 'Invalid scheduled visit action';
}

export function getScheduledVisitAction(input: {
  item: Pick<OperationalVisitItem, 'routeId' | 'dataStr' | 'status' | 'frequencia' | 'visitObj'> & Partial<Pick<OperationalVisitItem, 'lojaCodigo' | 'industriaCodigo'>>;
  today: string;
  weekStart: string;
  weekEnd: string;
  authorized: boolean;
  hasActiveVisit: boolean;
  routeEligibility: ScheduledRouteEligibility;
  todayVisits?: Pick<Visit, 'loja_codigo' | 'industria_codigo' | 'status'>[];
}): ScheduledActionDecision {
  const { item, todayVisits = [] } = input;
  if (!input.authorized) return { allowed: false, reason: 'A operação ainda não está autorizada.' };
  if (input.hasActiveVisit) return { allowed: false, reason: 'Finalize o atendimento atual antes de iniciar outra visita.' };
  if (!item.routeId) return { allowed: false, reason: 'A programação não está vinculada a uma rota fixa.' };
  if (input.routeEligibility === 'closed') return { allowed: false, reason: 'Esta rota foi encerrada e não pode iniciar novos atendimentos.' };
  if (input.routeEligibility !== 'active') return { allowed: false, reason: 'Não foi possível confirmar que a rota e a indústria estão ativas.' };
  if ((item.frequencia || '').toUpperCase() !== 'SEMANAL') {
    return { allowed: false, reason: 'Esta frequência ainda não pode ser validada pelo servidor para antecipação ou recuperação.' };
  }
  if (item.visitObj?.regularization_status) {
    return { allowed: false, reason: 'Esta ocorrência já foi regularizada administrativamente.' };
  }
  if (item.visitObj?.status === 'concluida' || item.visitObj?.status === 'em_andamento' || item.visitObj?.started_at) {
    return { allowed: false, reason: 'Esta ocorrência já possui atendimento iniciado ou concluído.' };
  }

  // Prevenção de duplicidade: se já existe atendimento efetivo (concluído ou em andamento) para a mesma loja e indústria hoje
  if (item.lojaCodigo && item.industriaCodigo && todayVisits.length > 0) {
    const hasConflictToday = todayVisits.some(
      (v) =>
        v.loja_codigo === item.lojaCodigo &&
        v.industria_codigo === item.industriaCodigo &&
        (v.status === 'concluida' || v.status === 'em_andamento')
    );
    if (hasConflictToday) {
      const isRecovery = item.dataStr >= input.weekStart && item.dataStr < input.today;
      const isAdvance = item.dataStr > input.today && item.dataStr <= input.weekEnd;
      return {
        allowed: false,
        action: isRecovery ? 'recover' : isAdvance ? 'advance' : undefined,
        reason: 'Já existe um atendimento para esta loja e indústria hoje.',
        isSameDayConflict: true
      };
    }
  }

  if (item.dataStr > input.today && item.dataStr <= input.weekEnd && item.status === 'planejada') {
    return { allowed: true, action: 'advance' };
  }
  if (item.dataStr >= input.weekStart && item.dataStr < input.today && (item.status === 'pendente' || item.status === 'nao_realizada')) {
    return { allowed: true, action: 'recover' };
  }
  return { allowed: false, reason: 'A programação não está dentro da janela válida da semana atual.' };
}
