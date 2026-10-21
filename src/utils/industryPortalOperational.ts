import type { OperationalVisitItem } from './routePlanner';

export type OperationalStatusFilter = 'all' | 'concluida' | 'em_andamento' | 'pendente' | 'nao_realizada';
export type OperationalVisitSearchItem = Pick<OperationalVisitItem,
  'lojaNome' | 'lojaCodigo' | 'lojaCidade' | 'promotorNome' | 'status'>;

function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function filterOperationalVisits<T extends OperationalVisitSearchItem>(
  items: readonly T[],
  status: OperationalStatusFilter,
  query: string
): T[] {
  const term = normalizeSearchText(query);
  return items.filter((item) => {
    const matchesStatus = status === 'all' || item.status === status;
    const matchesSearch = !term || [item.lojaNome, item.lojaCodigo, item.lojaCidade, item.promotorNome]
      .some((value) => normalizeSearchText(String(value || '')).includes(term));
    return matchesStatus && matchesSearch;
  });
}

export function paginateOperationalVisits<T>(items: T[], page: number, pageSize = 12): T[] {
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const totalPages = Math.max(1, Math.ceil(items.length / safePageSize));
  const safePage = Math.min(totalPages, Math.max(1, Math.floor(page)));
  return items.slice((safePage - 1) * safePageSize, safePage * safePageSize);
}

