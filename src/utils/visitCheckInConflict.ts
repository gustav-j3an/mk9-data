export interface OpenVisitConflict {
  id: string;
  promotor_matricula: string;
  loja_codigo: string;
  loja?: { nome?: string | null } | null;
  industria_codigo: string;
  industria?: { nome?: string | null } | null;
  data_visita: string;
  started_at?: string | null;
  status: string;
  regularization_status?: string | null;
  work_schedule?: VisitWorkSchedule | null;
}

export interface VisitWorkSchedule {
  timezone?: string | null;
  hora_inicio?: string | null;
  hora_fim?: string | null;
}

export interface OperationalVisit {
  status: string;
  data_visita: string;
  started_at?: string | null;
  regularization_status?: string | null;
  work_schedule?: VisitWorkSchedule | null;
}

const DEFAULT_OPERATIONAL_TIMEZONE = 'America/Sao_Paulo';

function shiftDate(date: string, days: number): string {
  const shifted = new Date(`${date}T12:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

export function getVisitOperationalDate(visit: OperationalVisit, now: Date | string = new Date()): string {
  const instant = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(instant.getTime())) return visit.data_visita;

  const schedule = visit.work_schedule;
  let timezone = schedule?.timezone || DEFAULT_OPERATIONAL_TIMEZONE;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(instant);
  } catch {
    timezone = DEFAULT_OPERATIONAL_TIMEZONE;
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(instant);
  }
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(value => value.type === type)?.value || '';
  let date = `${part('year')}-${part('month')}-${part('day')}`;
  const localTime = `${part('hour')}:${part('minute')}`;
  const isOvernight = Boolean(schedule?.hora_inicio && schedule.hora_fim && schedule.hora_fim < schedule.hora_inicio);
  if (isOvernight && schedule?.hora_fim && localTime < schedule.hora_fim) date = shiftDate(date, -1);
  return date;
}

export function isAnotherVisitInProgressError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const message = 'message' in error && typeof error.message === 'string' ? error.message : '';
  return message.includes('Another visit is in progress');
}

export function findOwnOpenVisit<T extends { promotor_matricula: string; status: string }>(
  visits: T[],
  matricula: string
): T | undefined {
  return visits.find(visit => visit.promotor_matricula === matricula
    && visit.status === 'em_andamento'
    && !('regularization_status' in visit && visit.regularization_status));
}

export function findReusableActiveCheckInVisit<T extends {
  status: string;
  regularization_status?: string | null;
  scheduled_date?: string | null;
  rota_id?: string | null;
}>(visits: T[], routeId?: string | null): T | undefined {
  return visits.find(visit => visit.status === 'em_andamento'
    && !visit.regularization_status
    && (!visit.scheduled_date || !routeId || visit.rota_id === routeId));
}

export function isOpenVisitFromToday(visit: OperationalVisit, now: Date | string = new Date()): boolean {
  return visit.status === 'em_andamento'
    && !visit.regularization_status
    && visit.data_visita === getVisitOperationalDate(visit, now);
}

export function getStaleOpenVisits<T extends OperationalVisit>(visits: T[], now: Date | string = new Date()): T[] {
  return visits.filter(visit => visit.status === 'em_andamento'
    && !visit.regularization_status
    && !isOpenVisitFromToday(visit, now));
}

export function formatOpenVisitConflictMessage(
  visit: OpenVisitConflict | undefined,
  now: Date | string = new Date()
): string {
  if (visit && !isOpenVisitFromToday(visit, now)) {
    return 'A visita antiga será encerrada como não realizada antes de liberar o novo atendimento.';
  }
  return 'Não foi possível iniciar a visita. Existe outro atendimento ativo. Use “Continuar Visita”.';
}

export function getOldOpenVisitsLabel(count: number): string {
  return `${count} ${count === 1 ? 'visita antiga aguardando encerramento automático' : 'visitas antigas aguardando encerramento automático'}.`;
}

export function getOldOpenVisitCheckInBlockMessage(): string {
  return 'Esta visita antiga será registrada como não realizada automaticamente no fechamento do dia operacional. Você pode iniciar outro atendimento; a data original, o horário de início, a justificativa e as evidências permanecem no histórico.';
}

export function getPromoterOpenVisitAction(visit: OperationalVisit, now: Date | string = new Date()): 'continue_today' | 'automatic_expiry' {
  return isOpenVisitFromToday(visit, now) ? 'continue_today' : 'automatic_expiry';
}

export function canReviewOldOpenVisits(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'gestor';
}

export function createRequestGate() {
  let locked = false;
  return {
    tryAcquire() {
      if (locked) return false;
      locked = true;
      return true;
    },
    release() {
      locked = false;
    }
  };
}
