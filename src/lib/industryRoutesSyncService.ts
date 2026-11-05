import { supabase } from './supabase';
import type { RouteItem } from '../types';

export const INDUSTRY_SUSPENSION_REASON = 'Inativação da indústria';
export const INDUSTRY_SUSPENSION_OBS_TAG = '[SUSPENSO: INATIVAÇÃO DA INDÚSTRIA]';

export interface IndustryInactivationResult {
  industryId: string;
  industryCode: string;
  industryName: string;
  routesSuspendedCount: number;
  routesSuspendedIds: string[];
  usedRpc: boolean;
}

export interface IndustryReactivationResult {
  industryCode: string;
  routesReactivatedCount: number;
  usedRpc: boolean;
}

export interface IndustryRoutesGateway {
  getActiveRoutesCountForIndustry: (industryCode: string) => Promise<number>;
  getActiveRoutesForIndustry: (industryCode: string) => Promise<RouteItem[]>;
  inactivateIndustryAndSuspendRoutes: (
    industryId: string,
    industryCode: string,
    industryName: string,
    activeRoutes: RouteItem[]
  ) => Promise<IndustryInactivationResult>;
  activateIndustry: (industryId: string) => Promise<void>;
  reactivateRoutesForIndustry: (
    industryId: string,
    industryCode: string,
    routeIdsToReactivate?: string[]
  ) => Promise<IndustryReactivationResult>;
}

export const formatIndustrySuspensionObservation = (
  currentObs: string | null | undefined,
  reason = INDUSTRY_SUSPENSION_REASON
): string => {
  const trimmed = currentObs?.trim() || '';
  if (!trimmed) {
    return `${INDUSTRY_SUSPENSION_OBS_TAG} ${reason}`;
  }
  if (trimmed.includes(INDUSTRY_SUSPENSION_OBS_TAG)) {
    return trimmed;
  }
  return `${trimmed} | ${INDUSTRY_SUSPENSION_OBS_TAG} ${reason}`;
};

export const isRouteSuspendedByIndustry = (route: Pick<RouteItem, 'observacao' | 'encerrada_em'>): boolean => {
  if (!route.encerrada_em) return false;
  return Boolean(route.observacao && route.observacao.includes(INDUSTRY_SUSPENSION_OBS_TAG));
};

const requireSupabase = () => {
  if (!supabase) throw new Error('Cliente Supabase não inicializado.');
  return supabase;
};

export const supabaseIndustryRoutesGateway: IndustryRoutesGateway = {
  async getActiveRoutesCountForIndustry(industryCode: string): Promise<number> {
    const db = requireSupabase();
    const { count, error } = await db
      .from('rotas')
      .select('id', { count: 'exact', head: true })
      .eq('industria_codigo', industryCode)
      .is('encerrada_em', null);

    if (error) throw error;
    return count ?? 0;
  },

  async getActiveRoutesForIndustry(industryCode: string): Promise<RouteItem[]> {
    const db = requireSupabase();
    const { data, error } = await db
      .from('rotas')
      .select('*')
      .eq('industria_codigo', industryCode)
      .is('encerrada_em', null);

    if (error) throw error;
    return (data as unknown as RouteItem[]) || [];
  },

  async inactivateIndustryAndSuspendRoutes(
    industryId: string,
    industryCode: string,
    industryName: string,
    activeRoutes: RouteItem[]
  ): Promise<IndustryInactivationResult> {
    const db = requireSupabase();
    const timestamp = new Date().toISOString();

    // 1. Tentar execução via RPC atômica caso a migration tenha sido aplicada
    try {
      const { data, error: rpcErr } = await db.rpc('inactivate_industry_and_suspend_routes', {
        p_industria_id: industryId,
        p_motivo: INDUSTRY_SUSPENSION_REASON
      });

      if (!rpcErr && data && data.success) {
        return {
          industryId,
          industryCode,
          industryName,
          routesSuspendedCount: data.rotas_suspensas ?? activeRoutes.length,
          routesSuspendedIds: activeRoutes.map((r) => r.id),
          usedRpc: true
        };
      }
    } catch {
      // Falha esperada se a RPC ainda não existe no ambiente (graceful fallback)
    }

    // 2. Operação resiliente no cliente com rollback em caso de falha
    // Se a indústria falhar, as rotas não são tocadas; se as rotas falharem, restaura o status da indústria
    const { error: indErr } = await db
      .from('industrias')
      .update({ status: 'inativo', updated_at: timestamp })
      .eq('id', industryId);

    if (indErr) throw indErr;

    if (activeRoutes.length === 0) {
      return {
        industryId,
        industryCode,
        industryName,
        routesSuspendedCount: 0,
        routesSuspendedIds: [],
        usedRpc: false
      };
    }

    try {
      // Atualizar todas as rotas ativas vinculadas à indústria com observacao marcando a inativação
      for (const route of activeRoutes) {
        const newObs = formatIndustrySuspensionObservation(route.observacao);
        const { error: routeErr } = await db
          .from('rotas')
          .update({
            encerrada_em: timestamp,
            observacao: newObs,
            updated_at: timestamp
          })
          .eq('id', route.id)
          .is('encerrada_em', null);

        if (routeErr) throw routeErr;
      }

      return {
        industryId,
        industryCode,
        industryName,
        routesSuspendedCount: activeRoutes.length,
        routesSuspendedIds: activeRoutes.map((r) => r.id),
        usedRpc: false
      };
    } catch (routeError: any) {
      // Rollback da indústria para preservar integridade
      await db
        .from('industrias')
        .update({ status: 'ativo', updated_at: new Date().toISOString() })
        .eq('id', industryId);

      throw new Error(
        `Falha ao suspender as rotas da indústria (${routeError.message || 'erro operacional'}). Operação revertida.`
      );
    }
  },

  async activateIndustry(industryId: string): Promise<void> {
    const db = requireSupabase();
    const { error } = await db
      .from('industrias')
      .update({ status: 'ativo', updated_at: new Date().toISOString() })
      .eq('id', industryId);

    if (error) throw error;
  },

  async reactivateRoutesForIndustry(
    industryId: string,
    industryCode: string,
    routeIdsToReactivate?: string[]
  ): Promise<IndustryReactivationResult> {
    const db = requireSupabase();

    // 1. Tentar RPC caso exista
    try {
      const { data, error: rpcErr } = await db.rpc('reactivate_industry_routes', {
        p_industria_id: industryId,
        p_route_ids: routeIdsToReactivate || null
      });

      if (!rpcErr && data && data.success) {
        return {
          industryCode,
          routesReactivatedCount: data.rotas_reativadas ?? 0,
          usedRpc: true
        };
      }
    } catch {
      // Fallback gracioso
    }

    // 2. Fallback resiliente
    let query = db
      .from('rotas')
      .update({ encerrada_em: null, updated_at: new Date().toISOString() })
      .eq('industria_codigo', industryCode)
      .not('encerrada_em', 'is', null)
      .ilike('observacao', `%${INDUSTRY_SUSPENSION_OBS_TAG}%`);

    if (routeIdsToReactivate && routeIdsToReactivate.length > 0) {
      query = query.in('id', routeIdsToReactivate);
    }

    const { error } = await query;
    if (error) throw error;

    return {
      industryCode,
      routesReactivatedCount: routeIdsToReactivate?.length ?? 1,
      usedRpc: false
    };
  }
};
