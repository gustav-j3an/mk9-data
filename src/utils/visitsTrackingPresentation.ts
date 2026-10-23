export type VisitPageSize = 15 | 25 | 50;

export function sortVisitsForDisplay<T extends { status: string; lojaNome: string }>(items: readonly T[]): T[] {
  const priority: Record<string, number> = { em_andamento: 0, pendente: 1, planejada: 1, concluida: 2, nao_realizada: 3 };
  return [...items].sort((left, right) =>
    (priority[left.status] ?? 99) - (priority[right.status] ?? 99) || left.lojaNome.localeCompare(right.lojaNome, 'pt-BR')
  );
}

export function paginateVisits<T>(items: readonly T[], page: number, pageSize: VisitPageSize): T[] {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(totalPages, Math.max(1, Math.floor(page)));
  return items.slice((safePage - 1) * pageSize, safePage * pageSize);
}

export function filterPromoterDailySummaries<T extends { nome: string; pendentes: number }>(
  items: readonly T[],
  query: string,
  onlyPending: boolean
): T[] {
  const term = query.trim().toLocaleLowerCase('pt-BR');
  return items.filter((item) =>
    (!term || item.nome.toLocaleLowerCase('pt-BR').includes(term)) &&
    (!onlyPending || item.pendentes > 0)
  );
}
