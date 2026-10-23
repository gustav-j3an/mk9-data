import type { PromoterAppointmentsTab, PromoterMetricStatus } from './promoterPortalPresentation';

export interface PromoterPortalViewState {
  appointmentsTab: PromoterAppointmentsTab;
  isWeekHistoryOpen: boolean;
  weekOffset: number;
  selectedDayDateStr: string;
  weekHistoryFilterMode: 'day' | 'all';
  statusFilter: 'all' | PromoterMetricStatus;
}

export interface ViewStateStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const DEFAULT_PROMOTER_PORTAL_VIEW_STATE: PromoterPortalViewState = {
  appointmentsTab: 'today',
  isWeekHistoryOpen: false,
  weekOffset: 0,
  selectedDayDateStr: '',
  weekHistoryFilterMode: 'day',
  statusFilter: 'all'
};

const FILTERS = new Set(['all', 'planejada', 'em_andamento', 'pendente', 'concluida', 'nao_realizada']);

export function getPromoterPortalViewStateKey(userId: string | null | undefined): string | null {
  return userId ? `mk9:promoter-portal-view:${userId}` : null;
}

export function readPromoterPortalViewState(storage: ViewStateStorage | null, key: string | null): PromoterPortalViewState {
  if (!storage || !key) return DEFAULT_PROMOTER_PORTAL_VIEW_STATE;
  try {
    const saved = JSON.parse(storage.getItem(key) || 'null') as Partial<PromoterPortalViewState> | null;
    if (!saved || typeof saved !== 'object') return DEFAULT_PROMOTER_PORTAL_VIEW_STATE;
    const dateIsValid = typeof saved.selectedDayDateStr === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(saved.selectedDayDateStr);
    return {
      appointmentsTab: saved.appointmentsTab === 'history' ? 'history' : 'today',
      isWeekHistoryOpen: saved.isWeekHistoryOpen === true,
      weekOffset: Number.isInteger(saved.weekOffset) && Math.abs(saved.weekOffset as number) <= 104 ? saved.weekOffset as number : 0,
      selectedDayDateStr: dateIsValid ? saved.selectedDayDateStr! : '',
      weekHistoryFilterMode: saved.weekHistoryFilterMode === 'all' ? 'all' : 'day',
      statusFilter: FILTERS.has(saved.statusFilter || '') ? saved.statusFilter as PromoterPortalViewState['statusFilter'] : 'all'
    };
  } catch {
    return DEFAULT_PROMOTER_PORTAL_VIEW_STATE;
  }
}

export function writePromoterPortalViewState(storage: ViewStateStorage | null, key: string | null, state: PromoterPortalViewState): void {
  if (!storage || !key) return;
  try {
    storage.setItem(key, JSON.stringify(state));
  } catch {
    // Storage may be disabled or full. Navigation remains usable in memory.
  }
}
