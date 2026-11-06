import { supabase } from './supabase';

export interface IndustryInactivationResult {
  industryId: string;
  industryCode: string;
  industryName: string;
  routesSuspendedCount: number;
}

export interface IndustryReactivationResult {
  industryCode: string;
  routesReactivatedCount: number;
}

export interface IndustryRoutesGateway {
  getActiveRoutesCountForIndustry: (industryCode: string) => Promise<number>;
  inactivateIndustryAndSuspendRoutes: (
    industryId: string,
    industryCode: string,
    industryName: string
  ) => Promise<IndustryInactivationResult>;
  activateIndustry: (industryId: string) => Promise<void>;
  reactivateRoutesForIndustry: (
    industryId: string,
    industryCode: string,
    routeIdsToReactivate?: string[]
  ) => Promise<IndustryReactivationResult>;
}

const requireSupabase = () => {
  if (!supabase) throw new Error('Cliente Supabase não inicializado.');
  return supabase;
};

export const unwrapIndustrySyncRpc = <T extends { success?: boolean }>(
  operation: string,
  data: T | null,
  error: { message: string } | null
): T => {
  if (error) throw new Error(`Falha na RPC de ${operation}: ${error.message}`);
  if (!data?.success) throw new Error(`A RPC de ${operation} não confirmou a operação.`);
  return data;
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

  async inactivateIndustryAndSuspendRoutes(
    industryId: string,
    industryCode: string,
    industryName: string
  ): Promise<IndustryInactivationResult> {
    const db = requireSupabase();
    const { data, error } = await db.rpc('inactivate_industry_and_suspend_routes', {
      p_industria_id: industryId,
      p_motivo: 'Inativação da indústria'
    });

    const result = unwrapIndustrySyncRpc('inativação da indústria', data, error);

    return {
      industryId,
      industryCode,
      industryName,
      routesSuspendedCount: result.rotas_suspensas ?? 0
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

    const { data, error } = await db.rpc('reactivate_industry_routes', {
      p_industria_id: industryId,
      p_route_ids: routeIdsToReactivate || null
    });

    const result = unwrapIndustrySyncRpc('reativação de rotas', data, error);

    return {
      industryCode,
      routesReactivatedCount: result.rotas_reativadas ?? 0
    };
  }
};
