import type { Visit, UserRole } from '../types';

export interface OldOpenVisitFilters {
  promoter: string;
  store: string;
  industry: string;
  from: string;
  to: string;
  before: string;
}

export function canManageOldOpenVisits(role: UserRole): boolean {
  return role === 'admin' || role === 'gestor';
}

export function getAdministrativeResolutionLabel(status: Visit['regularization_status']): string | null {
  if (status === 'closed_without_execution_proof') return 'Encerrada administrativamente · sem execução comprovada';
  if (status === 'administratively_completed_with_proof') return 'Concluída administrativamente · com comprovação';
  return null;
}

export function getVisitResolutionCounts(visits: Array<{ status: string; regularization_status?: Visit['regularization_status'] }>) {
  return visits.reduce((counts, visit) => {
    if (visit.regularization_status === 'closed_without_execution_proof') counts.closedWithoutProof++;
    else if (visit.regularization_status === 'administratively_completed_with_proof') counts.administrativelyCompleted++;
    else if (visit.status === 'em_andamento') counts.inProgress++;
    if (!visit.regularization_status && visit.status === 'concluida') counts.operationallyCompleted++;
    return counts;
  }, { inProgress: 0, operationallyCompleted: 0, administrativelyCompleted: 0, closedWithoutProof: 0 });
}

export function filterOldOpenVisits<T extends Visit>(visits: T[], filters: OldOpenVisitFilters): T[] {
  return visits.filter((visit) => {
    if (visit.status !== 'em_andamento' || visit.regularization_status) return false;
    if (!filters.before || visit.data_visita >= filters.before) return false;
    if (filters.promoter !== 'all' && visit.promotor_matricula !== filters.promoter) return false;
    if (filters.store !== 'all' && visit.loja_codigo !== filters.store) return false;
    if (filters.industry !== 'all' && visit.industria_codigo !== filters.industry) return false;
    if (filters.from && visit.data_visita < filters.from) return false;
    if (filters.to && visit.data_visita > filters.to) return false;
    return true;
  });
}

export function getVisitDurationLabel(startedAt: string | null | undefined, now = Date.now()): string {
  if (!startedAt) return 'Duração indisponível';
  const start = new Date(startedAt).getTime();
  if (!Number.isFinite(start) || start > now) return 'Duração indisponível';
  const minutes = Math.floor((now - start) / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const remainder = minutes % 60;
  return days > 0 ? `${days}d ${hours}h ${remainder}min` : hours > 0 ? `${hours}h ${remainder}min` : `${remainder}min`;
}
