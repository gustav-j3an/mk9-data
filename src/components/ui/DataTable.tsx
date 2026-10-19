import React, { useState, useMemo } from 'react';

export interface Column<T> {
  key: string;
  header: string;
  className?: string;
  headerClassName?: string;
  sortable?: boolean;
  render?: (item: T, index: number) => React.ReactNode;
  accessor?: (item: T) => any;
}

export interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  keyExtractor: (item: T, index: number) => string;
  loading?: boolean;
  loadingMessage?: string;
  error?: string | null;
  emptyTitle?: string;
  emptyMessage?: string;
  searchPlaceholder?: string;
  searchFilter?: (item: T, query: string) => boolean;
  defaultPageSize?: 10 | 25 | 50;
  pageSizeOptions?: number[];
  rowClassName?: (item: T, index: number) => string;
  onRowClick?: (item: T, index: number) => void;
  headerActions?: React.ReactNode;
  title?: string;
  titleIcon?: string;
  badgeCount?: number;
}

type SortDirection = 'asc' | 'desc' | null;

export function DataTable<T>({
  data,
  columns,
  keyExtractor,
  loading = false,
  loadingMessage = 'Carregando dados...',
  error = null,
  emptyTitle = 'Nenhum registro encontrado',
  emptyMessage = 'Não há dados que correspondam aos filtros ou critérios aplicados.',
  searchPlaceholder,
  searchFilter,
  defaultPageSize = 10,
  pageSizeOptions = [10, 25, 50],
  rowClassName,
  onRowClick,
  headerActions,
  title,
  titleIcon,
  badgeCount
}: DataTableProps<T>) {
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(defaultPageSize);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);

  // 1. Filtragem por busca interna (se searchFilter for fornecido)
  const filteredData = useMemo(() => {
    if (!searchFilter || !searchQuery.trim()) {
      return data;
    }
    const q = searchQuery.toLowerCase().trim();
    return data.filter((item) => searchFilter(item, q));
  }, [data, searchFilter, searchQuery]);

  // 2. Ordenação
  const sortedData = useMemo(() => {
    if (!sortKey || !sortDirection) {
      return filteredData;
    }

    const column = columns.find((c) => c.key === sortKey);
    if (!column) return filteredData;

    return [...filteredData].sort((a, b) => {
      let valA = column.accessor ? column.accessor(a) : (a as any)[sortKey];
      let valB = column.accessor ? column.accessor(b) : (b as any)[sortKey];

      if (valA === undefined || valA === null) valA = '';
      if (valB === undefined || valB === null) valB = '';

      if (typeof valA === 'string' && typeof valB === 'string') {
        const comparison = valA.localeCompare(valB, 'pt-BR', { numeric: true, sensitivity: 'base' });
        return sortDirection === 'asc' ? comparison : -comparison;
      }

      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredData, sortKey, sortDirection, columns]);

  // 3. Paginação
  const totalItems = sortedData.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  // Ajustar página se filtros ou busca reduzirem a quantidade de itens
  React.useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [totalPages, currentPage]);

  const validCurrentPage = Math.min(currentPage, totalPages);

  const paginatedData = useMemo(() => {
    const start = (validCurrentPage - 1) * pageSize;
    return sortedData.slice(start, start + pageSize);
  }, [sortedData, validCurrentPage, pageSize]);

  // Toggle ordenação
  const handleSort = (column: Column<T>) => {
    if (!column.sortable) return;

    if (sortKey !== column.key) {
      setSortKey(column.key);
      setSortDirection('asc');
    } else if (sortDirection === 'asc') {
      setSortDirection('desc');
    } else {
      setSortKey(null);
      setSortDirection(null);
    }
  };

  const startIndex = totalItems === 0 ? 0 : (validCurrentPage - 1) * pageSize + 1;
  const endIndex = Math.min(validCurrentPage * pageSize, totalItems);

  return (
    <section className="bg-[#F7F6F2] border border-[#CFCDC5] rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
      {/* Top Header & Controles da Tabela */}
      {(title || searchFilter || headerActions) && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-[#CFCDC5]/60">
          <div className="flex items-center gap-2">
            {titleIcon && (
              <span className="material-symbols-outlined text-lg text-[#286FF5]">
                {titleIcon}
              </span>
            )}
            {title && (
              <h3 className="text-sm font-bold text-[#171717] uppercase tracking-wider font-mono">
                {title}
              </h3>
            )}
            {badgeCount !== undefined && (
              <span className="font-mono text-xs px-2 py-0.5 rounded-full bg-[#EAE8E2] border border-[#CFCDC5] text-[#525252] font-bold">
                {badgeCount}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {searchFilter && (
              <div className="relative min-w-[220px] sm:w-64">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#737373] text-[18px]">
                  search
                </span>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setCurrentPage(1);
                  }}
                  placeholder={searchPlaceholder || 'Buscar na tabela...'}
                  className="w-full h-9 pl-9 pr-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-lg text-xs text-[#171717] placeholder:text-[#737373] focus:outline-none focus:border-[#111114] transition-all font-sans"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#737373] hover:text-[#171717]"
                  >
                    <span className="material-symbols-outlined text-[14px]">close</span>
                  </button>
                )}
              </div>
            )}
            {headerActions}
          </div>
        </div>
      )}

      {/* Estados: Loading, Erro, Vazio ou Tabela */}
      {loading ? (
        <div className="py-16 text-center space-y-3">
          <div className="w-10 h-10 border-3 border-[#286FF5]/20 border-t-[#286FF5] rounded-full animate-spin mx-auto" />
          <p className="text-xs font-mono text-[#737373]">{loadingMessage}</p>
        </div>
      ) : error ? (
        <div className="p-6 bg-[#FDF2F2] border border-[#F8C8C8] rounded-xl text-center space-y-2">
          <span className="material-symbols-outlined text-[#D93636] text-3xl">error</span>
          <h4 className="text-sm font-bold text-[#D93636]">Erro ao carregar dados</h4>
          <p className="text-xs text-[#525252] font-mono">{error}</p>
        </div>
      ) : totalItems === 0 ? (
        <div className="py-14 text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-[#EAE8E2] border border-[#CFCDC5] flex items-center justify-center text-[#737373] mx-auto">
            <span className="material-symbols-outlined text-2xl">search_off</span>
          </div>
          <h4 className="text-sm font-bold text-[#171717]">{emptyTitle}</h4>
          <p className="text-xs text-[#737373] max-w-sm mx-auto font-sans leading-relaxed">
            {emptyMessage}
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-[#CFCDC5]">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#E4E2DB] border-b border-[#CFCDC5] text-[11px] font-bold text-[#171717] uppercase tracking-wider font-mono">
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      onClick={() => handleSort(col)}
                      className={`py-3 px-4 select-none ${col.sortable ? 'cursor-pointer hover:bg-[#DCDAD2]' : ''} ${
                        col.headerClassName || ''
                      }`}
                    >
                      <div className="inline-flex items-center gap-1.5">
                        <span>{col.header}</span>
                        {col.sortable && (
                          <span className="material-symbols-outlined text-[14px] text-[#737373]">
                            {sortKey === col.key
                              ? sortDirection === 'asc'
                                ? 'arrow_upward'
                                : 'arrow_downward'
                              : 'unfold_more'}
                          </span>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#CFCDC5] text-[#171717] font-sans">
                {paginatedData.map((item, idx) => {
                  const key = keyExtractor(item, idx);
                  const customClass = rowClassName ? rowClassName(item, idx) : '';
                  return (
                    <tr
                      key={key}
                      tabIndex={onRowClick ? 0 : undefined}
                      onClick={onRowClick ? (event) => {
                        if (event.target instanceof Element && event.target.closest('button,a,input,select,textarea,[role="button"]')) return;
                        onRowClick(item, idx);
                      } : undefined}
                      onKeyDown={onRowClick ? (event) => {
                        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                          event.preventDefault();
                          onRowClick(item, idx);
                        }
                      } : undefined}
                      className={`hover:bg-[#EAE8E2] transition-colors ${customClass}`}
                    >
                      {columns.map((col) => (
                        <td key={col.key} className={`py-3 px-4 ${col.className || ''}`}>
                          {col.render
                            ? col.render(item, idx)
                            : (item as any)[col.key] !== undefined
                            ? String((item as any)[col.key])
                            : '—'}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Rodapé de Paginação */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 text-xs font-mono text-[#737373]">
            <div className="flex items-center gap-3">
              <span>
                Mostrando <strong>{startIndex}</strong>-<strong>{endIndex}</strong> de{' '}
                <strong>{totalItems}</strong> registros
              </span>
              <div className="hidden sm:flex items-center gap-1.5 ml-2">
                <span className="text-[11px]">Itens:</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="bg-[#EAE8E2] border border-[#CFCDC5] rounded-md px-1.5 py-0.5 text-xs text-[#171717] focus:outline-none"
                >
                  {pageSizeOptions.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={validCurrentPage <= 1}
                className="px-2.5 py-1 rounded-md border border-[#CFCDC5] bg-[#EAE8E2] text-[#171717] hover:bg-[#E4E2DB] disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-bold text-xs"
                title="Página Anterior"
              >
                Anterior
              </button>

              <span className="px-2 font-bold text-[#171717]">
                {validCurrentPage} / {totalPages}
              </span>

              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={validCurrentPage >= totalPages}
                className="px-2.5 py-1 rounded-md border border-[#CFCDC5] bg-[#EAE8E2] text-[#171717] hover:bg-[#E4E2DB] disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-bold text-xs"
                title="Próxima Página"
              >
                Próxima
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

