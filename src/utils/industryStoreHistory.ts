import type { OperationalVisitItem, OperationalVisitStatus } from './routePlanner';

export type StoreHistoryStatusFilter = 'all' | OperationalVisitStatus;

export interface StoreHistorySummary {
  planejadas: number;
  concluidas: number;
  pendentes: number;
  naoRealizadas: number;
  aderencia: number | null;
}

export const getStoreHistorySummary = (items: OperationalVisitItem[]): StoreHistorySummary => {
  const planejadas = items.length;
  const concluidas = items.filter((item) => item.status === 'concluida').length;
  const pendentes = items.filter((item) => item.status === 'pendente').length;
  const naoRealizadas = items.filter((item) => item.status === 'nao_realizada').length;

  return {
    planejadas,
    concluidas,
    pendentes,
    naoRealizadas,
    aderencia: planejadas > 0 ? Math.round((concluidas / planejadas) * 100) : null
  };
};

export const filterStoreHistoryItems = (
  items: OperationalVisitItem[],
  status: StoreHistoryStatusFilter
): OperationalVisitItem[] => status === 'all' ? items : items.filter((item) => item.status === status);

export const canOpenStoreVisitReport = (item: OperationalVisitItem): boolean =>
  item.status === 'concluida' && Boolean(item.visitObj);

export const getStoreHistoryStatusLabel = (item: OperationalVisitItem): string => {
  if (item.status === 'concluida') return 'Concluída';
  if (item.status === 'em_andamento') return 'Em andamento';
  if (item.status === 'nao_realizada') return 'Não realizada';
  if (item.status === 'pendente' && item.isPastOverdue) return 'Atrasada';
  if (item.status === 'pendente') return 'Pendente';
  return 'Planejada';
};

export const getStoreHistoryStatusTone = (item: OperationalVisitItem): string => {
  if (item.status === 'concluida') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (item.status === 'em_andamento') return 'border-sky-200 bg-sky-50 text-sky-800';
  if (item.status === 'nao_realizada') return 'border-orange-200 bg-orange-50 text-orange-800';
  if (item.status === 'pendente' && item.isPastOverdue) return 'border-rose-200 bg-rose-50 text-rose-800';
  if (item.status === 'pendente') return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-slate-200 bg-slate-50 text-slate-700';
};
