import type { OperationalVisitItem } from './routePlanner';

export type OperationalStatusFilter = 'all' | 'concluida' | 'em_andamento' | 'pendente' | 'nao_realizada';
export type OperationalVisitSearchItem = Pick<OperationalVisitItem,
  'lojaNome' | 'lojaCodigo' | 'lojaCidade' | 'promotorNome' | 'status'> & Partial<Pick<OperationalVisitItem, 'industriaNome' | 'industriaCodigo'>>;

export type IndustryVisitIdentity = Pick<OperationalVisitItem, 'industriaCodigo' | 'industriaNome'>;
export type IndustryVisitPerformanceItem = IndustryVisitIdentity & Pick<OperationalVisitItem, 'key' | 'status'>;

export interface IndustryPerformance {
  codigo: string | null;
  nome: string;
  previstas: number;
  concluidas: number;
  pendentes: number;
  naoRealizadas: number;
  taxaExecucao: number;
}

export function getIndustryDisplayName(name?: string | null, code?: string | null): string {
  return name?.trim() || code?.trim() || 'Indústria não identificada';
}

export function getChecklistDisplayValue(item: { checked: boolean | null; valor_texto?: string | null }): string {
  const textValue = item.valor_texto?.trim();
  if (textValue) return textValue;
  if (item.checked === true) return 'Sim';
  if (item.checked === false) return 'Não';
  return 'Não informado';
}

export function groupIndustryPerformance(
  items: readonly IndustryVisitPerformanceItem[],
  activeIndustryCode?: string | null
): IndustryPerformance[] {
  const groups = new Map<string, IndustryPerformance>();
  const seenVisitKeys = new Set<string>();

  for (const item of items) {
    const code = item.industriaCodigo?.trim() || null;
    if (activeIndustryCode && code !== activeIndustryCode) continue;
    if (seenVisitKeys.has(item.key)) continue;
    seenVisitKeys.add(item.key);

    const groupKey = code ?? '__unidentified__';
    let group = groups.get(groupKey);
    if (!group) {
      group = {
        codigo: code,
        nome: getIndustryDisplayName(item.industriaNome, code),
        previstas: 0,
        concluidas: 0,
        pendentes: 0,
        naoRealizadas: 0,
        taxaExecucao: 0
      };
      groups.set(groupKey, group);
    }

    group.previstas += 1;
    if (item.status === 'concluida') group.concluidas += 1;
    else if (item.status === 'pendente') group.pendentes += 1;
    else if (item.status === 'nao_realizada') group.naoRealizadas += 1;
  }

  return Array.from(groups.values())
    .map((group) => ({ ...group, taxaExecucao: group.previstas ? Math.round((group.concluidas / group.previstas) * 100) : 0 }))
    .sort((left, right) => left.nome.localeCompare(right.nome, 'pt-BR'));
}

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
    const matchesSearch = !term || [item.lojaNome, item.lojaCodigo, item.lojaCidade, item.promotorNome, item.industriaNome, item.industriaCodigo]
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

