import type { PromoterOperationalSummary, RouteExecutionStatus } from '../utils/visitActivityEngine';

export type RouteStatusFilter = 'ALL' | RouteExecutionStatus;

export interface FilterPromotersOptions {
  search?: string;
  supervisorFilter?: string;
  scopeFilter?: 'com_roteiro' | 'todos' | 'sem_programacao';
  statusFilter?: RouteStatusFilter;
}
/**
 * Filtra a lista de promotores na visão do Controle Diário.
 * Combina simultaneamente:
 * 1. Escopo de programação ('com_roteiro', 'todos', 'sem_programacao')
 * 2. Termo de busca (nome ou matrícula)
 * 3. Supervisor responsável
 * 4. Indicador interativo de situação de roteiro (statusFilter)
 */
export function filterPromoterSummaries(
  summaries: PromoterOperationalSummary[],
  options: FilterPromotersOptions
): PromoterOperationalSummary[] {
  const {
    search = '',
    supervisorFilter = '',
    scopeFilter = 'com_roteiro',
    statusFilter = 'ALL'
  } = options;

  const term = search.trim().toLowerCase();

  return summaries.filter((summary) => {
    // 1. Escopo de programação
    if (scopeFilter === 'com_roteiro' && summary.scheduledVisitsCount === 0) return false;
    if (scopeFilter === 'sem_programacao' && summary.scheduledVisitsCount > 0) return false;

    // 2. Busca por nome ou matrícula
    const matchSearch =
      !term ||
      summary.name.toLowerCase().includes(term) ||
      summary.matricula.toLowerCase().includes(term);
    if (!matchSearch) return false;

    // 3. Supervisor
    const matchSupervisor = !supervisorFilter || summary.supervisor === supervisorFilter;
    if (!matchSupervisor) return false;

    // 4. Indicador interativo de situação de roteiro (statusFilter)
    if (statusFilter && statusFilter !== 'ALL') {
      if (summary.routeStatus !== statusFilter) return false;
    }

    return true;
  });
}

/**
 * Calcula as métricas dos indicadores a partir da lista base de promotores.
 * Para preservar a contagem original dos cartões (visão da operação),
 * as métricas consideram os filtros gerais (data, escopo, busca, supervisor),
 * mantendo as contagens visíveis para o usuário saber quantos promotores existem em cada categoria.
 */
export function calculateOperationalMetrics(summaries: PromoterOperationalSummary[]) {
  let completos = 0;
  let parciais = 0;
  let naoRealizados = 0;
  let emAtividade = 0;
  let aguardandoInicio = 0;

  let totalProgramadas = 0;
  let totalConcluidas = 0;
  let totalPendentes = 0;

  summaries.forEach((s) => {
    if (s.routeStatus === 'COMPLETO') completos++;
    else if (s.routeStatus === 'PARCIAL') parciais++;
    else if (s.routeStatus === 'NAO_REALIZADO') naoRealizados++;
    else if (s.routeStatus === 'EM_ATIVIDADE') emAtividade++;
    else if (s.routeStatus === 'AGUARDANDO_INICIO') aguardandoInicio++;

    totalProgramadas += s.scheduledVisitsCount;
    totalConcluidas += s.completedVisitsCount;
    totalPendentes += s.pendingVisitsCount;
  });

  const percentualExecucao =
    totalProgramadas > 0 ? Math.round((totalConcluidas / totalProgramadas) * 100) : 0;

  return {
    completos,
    parciais,
    naoRealizados,
    emAtividade,
    aguardandoInicio,
    totalProgramadas,
    totalConcluidas,
    totalPendentes,
    percentualExecucao
  };
}
