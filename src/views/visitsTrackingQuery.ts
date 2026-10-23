export type VisitsTrackingQueryState = {
  date: string;
  supervisor: string;
  team: string;
  promoter: string;
  store: string;
  industry: string;
  status: string;
  occurrence: string;
  search: string;
  page: number;
  pageSize: 15 | 25 | 50;
};

const keys = ['data', 'supervisor', 'equipe', 'promotor', 'loja', 'industria', 'status', 'ocorrencia', 'busca', 'pagina', 'por_pagina'];

export function parseVisitsTrackingQuery(params: URLSearchParams): Partial<VisitsTrackingQueryState> {
  const result: Partial<VisitsTrackingQueryState> = {};
  const date = params.get('data');
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) result.date = date;
  for (const [key, field] of [['supervisor', 'supervisor'], ['equipe', 'team'], ['promotor', 'promoter'], ['loja', 'store'], ['industria', 'industry'], ['status', 'status'], ['ocorrencia', 'occurrence'], ['busca', 'search']] as const) {
    const value = params.get(key);
    if (value) result[field] = value;
  }
  const page = Number(params.get('pagina'));
  if (Number.isSafeInteger(page) && page > 0) result.page = page;
  const pageSize = Number(params.get('por_pagina'));
  if (pageSize === 15 || pageSize === 25 || pageSize === 50) result.pageSize = pageSize;
  return result;
}

export function updateVisitsTrackingQuery(current: URLSearchParams, state: VisitsTrackingQueryState): URLSearchParams {
  const next = new URLSearchParams(current);
  for (const key of Array.from(next.keys())) {
    if (/token|secret|password|authorization|\bcode\b/i.test(key)) next.delete(key);
  }
  keys.forEach(key => next.delete(key));
  const values: Array<[string, string]> = [
    ['data', state.date], ['supervisor', state.supervisor], ['equipe', state.team], ['promotor', state.promoter],
    ['loja', state.store], ['industria', state.industry], ['status', state.status], ['ocorrencia', state.occurrence],
    ['busca', state.search.trim()]
  ];
  values.forEach(([key, value]) => { if (value && value !== 'all') next.set(key, value); });
  if (state.page > 1) next.set('pagina', String(state.page));
  if (state.pageSize !== 15) next.set('por_pagina', String(state.pageSize));
  return next;
}
