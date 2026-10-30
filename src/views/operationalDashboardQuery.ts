export type OperationalDashboardQueryState = {
  period: 'today' | 'week' | 'month';
  centralTab: 'alertas' | 'pendencias' | 'visitas_hoje' | 'promotores';
  ocorrenciasTab: 'rupturas' | 'incidentes' | 'validades' | 'checklist';
  industry: string;
  promoter: string;
  store: string;
  ruptureStatus: string;
  validityStatus: string;
  agendaStatus: string;
  alertPriority: string;
  pendenciaStatus: string;
};

const keys = [
  'periodo',
  'aba_central',
  'aba_ocorrencias',
  'industria',
  'promotor',
  'loja',
  'ruptura_status',
  'validade_status',
  'agenda_status',
  'alerta_prioridade',
  'pendencia_status'
];

export function parseOperationalDashboardQuery(params: URLSearchParams): Partial<OperationalDashboardQueryState> {
  const result: Partial<OperationalDashboardQueryState> = {};

  const period = params.get('periodo');
  if (period === 'today' || period === 'week' || period === 'month') {
    result.period = period;
  }

  const centralTab = params.get('aba_central');
  if (
    centralTab === 'alertas' ||
    centralTab === 'pendencias' ||
    centralTab === 'visitas_hoje' ||
    centralTab === 'promotores'
  ) {
    result.centralTab = centralTab;
  }

  const ocorrenciasTab = params.get('aba_ocorrencias');
  if (
    ocorrenciasTab === 'rupturas' ||
    ocorrenciasTab === 'incidentes' ||
    ocorrenciasTab === 'validades' ||
    ocorrenciasTab === 'checklist'
  ) {
    result.ocorrenciasTab = ocorrenciasTab;
  }

  const industry = params.get('industria');
  if (industry) result.industry = industry;

  const promoter = params.get('promotor');
  if (promoter) result.promoter = promoter;

  const store = params.get('loja');
  if (store) result.store = store;

  const ruptureStatus = params.get('ruptura_status');
  if (ruptureStatus) result.ruptureStatus = ruptureStatus;

  const validityStatus = params.get('validade_status');
  if (validityStatus) result.validityStatus = validityStatus;

  const agendaStatus = params.get('agenda_status');
  if (agendaStatus) result.agendaStatus = agendaStatus;

  const alertPriority = params.get('alerta_prioridade');
  if (alertPriority) result.alertPriority = alertPriority;

  const pendenciaStatus = params.get('pendencia_status');
  if (pendenciaStatus) result.pendenciaStatus = pendenciaStatus;

  return result;
}

export function updateOperationalDashboardQuery(
  current: URLSearchParams,
  state: OperationalDashboardQueryState
): URLSearchParams {
  const next = new URLSearchParams(current);
  for (const key of Array.from(next.keys())) {
    if (/token|secret|password|authorization|\bcode\b/i.test(key)) next.delete(key);
  }
  keys.forEach((key) => next.delete(key));

  if (state.period && state.period !== 'today') next.set('periodo', state.period);
  if (state.centralTab && state.centralTab !== 'alertas') next.set('aba_central', state.centralTab);
  if (state.ocorrenciasTab && state.ocorrenciasTab !== 'rupturas') next.set('aba_ocorrencias', state.ocorrenciasTab);
  if (state.industry && state.industry !== 'all') next.set('industria', state.industry);
  if (state.promoter && state.promoter !== 'all') next.set('promotor', state.promoter);
  if (state.store && state.store !== 'all') next.set('loja', state.store);
  if (state.ruptureStatus && state.ruptureStatus !== 'abertas') next.set('ruptura_status', state.ruptureStatus);
  if (state.validityStatus && state.validityStatus !== 'all') next.set('validade_status', state.validityStatus);
  if (state.agendaStatus && state.agendaStatus !== 'all') next.set('agenda_status', state.agendaStatus);
  if (state.alertPriority && state.alertPriority !== 'active') next.set('alerta_prioridade', state.alertPriority);
  if (state.pendenciaStatus && state.pendenciaStatus !== 'pendente') next.set('pendencia_status', state.pendenciaStatus);

  return next;
}
