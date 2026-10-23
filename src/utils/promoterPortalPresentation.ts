export const PROMOTER_APPOINTMENT_TABS = [
  { id: 'today', label: 'Hoje' },
  { id: 'history', label: 'Histórico' }
] as const;
export type PromoterAppointmentsTab = typeof PROMOTER_APPOINTMENT_TABS[number]['id'];
export type PromoterMetricStatus = 'planejada' | 'em_andamento' | 'pendente' | 'concluida' | 'nao_realizada';

export interface PromoterAppointmentGroup<T> {
  date: string;
  appointments: T[];
}

export function getAppointmentsTabForMetric(status: PromoterMetricStatus): PromoterAppointmentsTab {
  if (status === 'pendente') return 'history';
  if (status === 'concluida' || status === 'nao_realizada') return 'history';
  return 'today';
}

export function filterPromoterAppointments<T extends { status: string; isPastOverdue?: boolean; regularization_status?: string | null; visitObj?: { regularization_status?: string | null } | null }>(
  appointments: T[],
  status: 'all' | PromoterMetricStatus
): T[] {
  return status === 'all' ? appointments : appointments.filter(appointment => {
    const regularization = appointment.regularization_status || appointment.visitObj?.regularization_status;
    if (status === 'nao_realizada' && (regularization === 'closed_without_execution_proof'
      || (appointment.status === 'pendente' && appointment.isPastOverdue))) return true;
    if (status === 'concluida' && regularization === 'administratively_completed_with_proof') return true;
    return appointment.status === status && !(status === 'em_andamento' && regularization);
  });
}

export function isUnresolvedVisitInProgress(visit: { status: string; regularization_status?: string | null }): boolean {
  return visit.status === 'em_andamento' && !visit.regularization_status;
}

export function getRegularizationPresentation(status?: string | null): string | null {
  if (status === 'closed_without_execution_proof') return 'Encerrada administrativamente · sem execução comprovada';
  if (status === 'administratively_completed_with_proof') return 'Concluída administrativamente · com comprovação';
  return null;
}

export function getRegularizationCounts(visits: Array<{ status: string; regularization_status?: string | null }>) {
  return visits.reduce((counts, visit) => {
    if (visit.regularization_status === 'closed_without_execution_proof') counts.closedWithoutProof += 1;
    else if (visit.regularization_status === 'administratively_completed_with_proof') counts.administrativelyCompleted += 1;
    else if (visit.status === 'em_andamento') counts.inProgress += 1;
    return counts;
  }, { inProgress: 0, administrativelyCompleted: 0, closedWithoutProof: 0 });
}

export function getWeeklyPromoterMetricCounts(appointments: Array<{
  status: string;
  isPastOverdue?: boolean;
  regularization_status?: string | null;
  visitObj?: { regularization_status?: string | null } | null;
}>) {
  return appointments.reduce((counts, appointment) => {
    const regularization = appointment.regularization_status || appointment.visitObj?.regularization_status;
    if (appointment.status === 'planejada') counts.scheduled += 1;
    if (appointment.status === 'concluida' || regularization === 'administratively_completed_with_proof') counts.completed += 1;
    if (appointment.status === 'em_andamento' && !regularization) counts.inProgress += 1;
    if (appointment.status === 'nao_realizada' || (appointment.status === 'pendente' && appointment.isPastOverdue)
      || regularization === 'closed_without_execution_proof') counts.notDone += 1;
    return counts;
  }, { scheduled: 0, completed: 0, inProgress: 0, notDone: 0 });
}

export function getMetricDisplayValue(value: number, loading: boolean, hasError: boolean): number | '—' {
  return loading || hasError ? '—' : value;
}

export function filterHistoricalAttendances<T extends { status: string; visitObj?: unknown | null }>(appointments: T[]): T[] {
  return appointments.filter(appointment => Boolean(appointment.visitObj)
    && ['concluida', 'nao_realizada', 'em_andamento'].includes(appointment.status));
}

export function groupAppointmentsByDate<T extends { dataStr: string }>(appointments: T[]): PromoterAppointmentGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const appointment of appointments) {
    const group = groups.get(appointment.dataStr) || [];
    group.push(appointment);
    groups.set(appointment.dataStr, group);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, entries]) => ({ date, appointments: entries }));
}

export function formatAppointmentDateHeading(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const weekday = new Date(year, month - 1, day)
    .toLocaleDateString('pt-BR', { weekday: 'long' })
    .toLocaleUpperCase('pt-BR');
  return `${weekday} — ${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}`;
}
