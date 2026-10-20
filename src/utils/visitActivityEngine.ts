import type { RouteItem, Visit } from '../types';
import { zoned } from './attendanceEngine';

export type ActivityPresenceStatus =
  | 'confirmada'
  | 'em_atividade'
  | 'sem_evidencia';

export interface PromoterOperationalActivity {
  matricula: string;
  dataOperacional: string;
  status: ActivityPresenceStatus;
  statusLabel: string;
  totalProgramadas: number;
  totalIniciadas: number;
  totalConcluidas: number;
  primeiraAtividade: string | null;
  ultimaAtividade: string | null;
  origemEvidencia: string;
  visitas: Visit[];
}

export const ACTIVITY_LABELS: Record<ActivityPresenceStatus, string> = {
  confirmada: 'Presença Confirmada por Atendimento',
  em_atividade: 'Em Atividade em Campo',
  sem_evidencia: 'Sem Evidência de Atendimento'
};

const DAYS_MAP = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'] as const;

export function isRouteScheduledForDate(route: RouteItem, dateStr: string): boolean {
  if (route.encerrada_em) return false;
  const dayName = DAYS_MAP[new Date(`${dateStr}T12:00:00Z`).getUTCDay()];
  return Boolean((route as unknown as Record<string, unknown>)[dayName]);
}

/**
 * Motor de apuração de atividade operacional a partir das visitas do promotor no dia.
 * Separa a presença operacional por atendimento do controle formal CLT de jornada.
 */
export function computePromoterActivity(
  matricula: string,
  dateStr: string,
  visits: Visit[],
  routes: RouteItem[],
  timezone = 'America/Sao_Paulo'
): PromoterOperationalActivity {
  // Isolar rigorosamente apenas as visitas do promotor na data operacional, excluindo canceladas/não realizadas
  const promoterVisits = visits.filter(
    v => v.promotor_matricula === matricula && v.data_visita === dateStr
  );

  // Visitas com atendimento real (concluídas ou em andamento)
  const concluidas = promoterVisits.filter(v => v.status === 'concluida');

  // Quantidade de visitas programadas (rotas ativas com flag para o dia)
  const scheduledRoutes = routes.filter(
    r => r.promotor_matricula === matricula && isRouteScheduledForDate(r, dateStr)
  );

  const totalProgramadas = scheduledRoutes.length;
  const totalIniciadas = promoterVisits.filter(
    v => v.status === 'em_andamento' || v.status === 'concluida' || Boolean(v.started_at)
  ).length;
  const totalConcluidas = concluidas.length;

  // Extrair horários válidos de atividade (started_at ou completed_at)
  const timestamps: number[] = [];
  const addTs = (iso?: string | null) => {
    if (iso && Number.isFinite(Date.parse(iso))) {
      timestamps.push(Date.parse(iso));
    }
  };

  for (const v of promoterVisits) {
    if (v.status === 'concluida' || v.status === 'em_andamento') {
      addTs(v.started_at);
      addTs(v.completed_at);
    }
  }

  timestamps.sort((a, b) => a - b);

  const primeiraAtividade = timestamps.length > 0 ? zoned(new Date(timestamps[0]).toISOString(), timezone).time : null;
  const ultimaAtividade = timestamps.length > 0 ? zoned(new Date(timestamps[timestamps.length - 1]).toISOString(), timezone).time : null;

  // Regras de Classificação Operacional:
  // Regra 1: Pelo menos uma visita concluída -> Presença confirmada
  // Regra 2: Pelo menos uma visita iniciada, nenhuma concluída -> Em atividade
  // Regra 3: Sem visitas válidas -> Sem evidência de atendimento (nunca gera falta)
  let status: ActivityPresenceStatus = 'sem_evidencia';
  let origemEvidencia = 'Nenhum atendimento registrado nesta data';

  if (totalConcluidas > 0) {
    status = 'confirmada';
    origemEvidencia = `${totalConcluidas} visita(s) concluída(s) em campo`;
  } else if (totalIniciadas > 0) {
    status = 'em_atividade';
    origemEvidencia = `${totalIniciadas} visita(s) em andamento (aguardando conclusão)`;
  } else if (totalProgramadas > 0) {
    origemEvidencia = `${totalProgramadas} visita(s) programada(s), sem início reportado`;
  }

  return {
    matricula,
    dataOperacional: dateStr,
    status,
    statusLabel: ACTIVITY_LABELS[status],
    totalProgramadas,
    totalIniciadas,
    totalConcluidas,
    primeiraAtividade,
    ultimaAtividade,
    origemEvidencia,
    visitas: promoterVisits
  };
}
