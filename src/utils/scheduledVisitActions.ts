import type { OperationalVisitStatus, OperationalVisitItem } from './routePlanner';

export type ScheduledVisitAction = 'advance' | 'recover';

export interface ScheduledActionDecision {
  allowed: boolean;
  action?: ScheduledVisitAction;
  reason?: string;
}

export function isScheduledVisitActionRpcReady(error: { code?: unknown; message?: unknown } | null | undefined): boolean {
  return error?.code === '22023' && error.message === 'Invalid scheduled visit action';
}

export function getScheduledVisitAction(input: {
  item: Pick<OperationalVisitItem, 'routeId' | 'dataStr' | 'status' | 'frequencia' | 'visitObj' | 'industriaStatus'>;
  today: string;
  weekStart: string;
  weekEnd: string;
  authorized: boolean;
  hasActiveVisit: boolean;
}): ScheduledActionDecision {
  const { item } = input;
  if (!input.authorized) return { allowed: false, reason: 'A operação ainda não está autorizada.' };
  if (input.hasActiveVisit) return { allowed: false, reason: 'Finalize o atendimento atual antes de iniciar outra visita.' };
  if (item.industriaStatus === 'inativo') return { allowed: false, reason: 'A indústria vinculada está inativa. A visita permanece no histórico, mas não pode ser executada.' };
  if (!item.routeId) return { allowed: false, reason: 'A programação não está vinculada a uma rota fixa.' };
  if ((item.frequencia || '').toUpperCase() !== 'SEMANAL') {
    return { allowed: false, reason: 'Esta frequência ainda não pode ser validada pelo servidor para antecipação ou recuperação.' };
  }
  if (item.visitObj?.regularization_status) {
    return { allowed: false, reason: 'Esta ocorrência já foi regularizada administrativamente.' };
  }
  const retryableClosedVisit = item.visitObj?.status === 'nao_realizada' &&
    item.visitObj.started_at &&
    (item.visitObj.motivo_nao_realizada === 'Não finalizada até o encerramento do dia operacional' ||
      item.visitObj.motivo_nao_realizada?.startsWith('Cancelada pelo promotor: '));
  if (item.visitObj?.status === 'concluida' || item.visitObj?.status === 'em_andamento' || (item.visitObj?.started_at && !retryableClosedVisit)) {
    return { allowed: false, reason: 'Esta ocorrência já possui atendimento iniciado ou concluído.' };
  }
  if (item.dataStr > input.today && item.dataStr <= input.weekEnd && item.status === 'planejada') {
    return { allowed: true, action: 'advance' };
  }
  if (item.dataStr >= input.weekStart && item.dataStr < input.today && (item.status === 'pendente' || item.status === 'nao_realizada')) {
    return { allowed: true, action: 'recover' };
  }
  return { allowed: false, reason: 'A programação não está dentro da janela válida da semana atual.' };
}
