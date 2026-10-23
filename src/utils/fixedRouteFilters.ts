import type { RouteItem } from '../types';

export type RouteStatusFilter = 'active' | 'closed' | 'all';

export interface FixedRouteFilters {
  search: string;
  industry: string;
  store: string;
  promoter: string;
  uf: string;
  frequency: string;
  day: string;
  status: RouteStatusFilter;
}

export const normalizeRouteSearch = (value: string): string =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();

export const filterFixedRoutes = (routes: RouteItem[], filters: FixedRouteFilters): RouteItem[] => {
  const term = normalizeRouteSearch(filters.search);
  return routes.filter((route) => {
    if (filters.status === 'active' && route.encerrada_em) return false;
    if (filters.status === 'closed' && !route.encerrada_em) return false;
    if (filters.industry !== 'TODAS' && route.industria_codigo !== filters.industry) return false;
    if (filters.store !== 'TODAS' && route.loja_codigo !== filters.store) return false;
    if (filters.promoter !== 'TODOS' && route.promotor_matricula !== filters.promoter) return false;
    if (filters.frequency !== 'TODAS' && route.frequencia !== filters.frequency) return false;
    if (filters.day !== 'TODOS' && !route[filters.day as keyof Pick<RouteItem, 'segunda' | 'terca' | 'quarta' | 'quinta' | 'sexta' | 'sabado' | 'domingo'>]) return false;

    const uf = route.uf || route.loja?.uf || '';
    if (filters.uf !== 'TODAS' && uf.toUpperCase() !== filters.uf) return false;
    if (!term) return true;

    const searchable = [
      route.codigo_rota, route.industria_codigo, route.industria?.nome,
      route.loja_codigo, route.loja?.codigo, route.loja?.nome, route.loja?.rede,
      route.loja?.cidade, route.loja?.bairro, route.loja?.endereco, route.loja?.uf, uf,
      route.promotor_matricula, route.promotor?.matricula, route.promotor?.nome
    ].filter(Boolean).join(' ');
    return normalizeRouteSearch(searchable).includes(term);
  });
};

export const clearFixedRouteFilters = (): FixedRouteFilters => ({
  search: '', industry: 'TODAS', store: 'TODAS', promoter: 'TODOS',
  uf: 'TODAS', frequency: 'TODAS', day: 'TODOS', status: 'active'
});
