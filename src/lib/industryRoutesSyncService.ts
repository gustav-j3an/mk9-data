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

    // Execução estritamente atômica via RPC transacional do PostgreSQL
    const { data, error: rpcErr } = await db.rpc('inactivate_industry_and_suspend_routes', {
      p_industria_id: industryId,
      p_motivo: INDUSTRY_SUSPENSION_REASON
    });

    if (rpcErr) {
      // Se a RPC não estiver disponível ou falhar no banco, não executa mutação parcial no frontend
      const missingRpc = rpcErr.code === '42883' || rpcErr.message?.includes('function') || rpcErr.message?.includes('does not exist');
      if (missingRpc) {
        throw new Error(
          'A função transacional de inativação não está disponível no banco de dados. A operação foi cancelada com segurança sem alterar dados.'
        );
      }
      throw new Error(`Falha na inativação atômica da indústria: ${rpcErr.message || 'Erro no banco de dados.'}`);
    }

    if (!data || !data.success) {
      throw new Error('A operação de inativação não retornou confirmação de sucesso do banco de dados.');
    }

    return {
      industryId,
      industryCode,
      industryName,
      routesSuspendedCount: data.rotas_suspensas ?? activeRoutes.length,
      routesSuspendedIds: activeRoutes.map((r) => r.id),
      usedRpc: true
    };
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

    // Execução estritamente via RPC transacional do PostgreSQL
    const { data, error: rpcErr } = await db.rpc('reactivate_industry_routes', {
      p_industria_id: industryId,
      p_route_ids: routeIdsToReactivate || null
    });

    if (rpcErr) {
      const missingRpc = rpcErr.code === '42883' || rpcErr.message?.includes('function') || rpcErr.message?.includes('does not exist');
      if (missingRpc) {
        throw new Error(
          'A função transacional de reativação não está disponível no banco de dados. A operação foi cancelada com segurança sem alterar dados.'
        );
      }
      throw new Error(`Falha na reativação das rotas: ${rpcErr.message || 'Erro no banco de dados.'}`);
    }

    if (!data || !data.success) {
      throw new Error('A operação de reativação não retornou confirmação de sucesso do banco de dados.');
    }

    return {
      industryCode,
      routesReactivatedCount: data.rotas_reativadas ?? 0,
      usedRpc: true
    };
  }
};
