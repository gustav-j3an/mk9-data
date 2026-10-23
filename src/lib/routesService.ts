import { supabase } from './supabase';
import { isMissingRouteClosureColumn } from '../utils/routeClosureCompatibility';
import type { RouteItem, UserRole } from '../types';

export const ROUTE_DAYS = [
  { key: 'segunda', label: 'Segunda' },
  { key: 'terca', label: 'Terça' },
  { key: 'quarta', label: 'Quarta' },
  { key: 'quinta', label: 'Quinta' },
  { key: 'sexta', label: 'Sexta' },
  { key: 'sabado', label: 'Sábado' },
  { key: 'domingo', label: 'Domingo' }
] as const;

export type RouteDayKey = (typeof ROUTE_DAYS)[number]['key'];

export interface RouteFormValues {
  codigo_rota?: string;
  industria_codigo: string;
  loja_codigo: string;
  promotor_matricula: string;
  uf: string | null;
  frequencia: RouteItem['frequencia'];
  segunda: boolean;
  terca: boolean;
  quarta: boolean;
  quinta: boolean;
  sexta: boolean;
  sabado: boolean;
  domingo: boolean;
  observacao?: string | null;
}

export const canManageFixedRoutes = (role: UserRole | null | undefined): boolean =>
  role === 'admin' || role === 'gestor';

export const isActiveFixedRoute = (route: Pick<RouteItem, 'encerrada_em'>): boolean =>
  !route.encerrada_em;

export const hasAnyScheduledDay = (values: Pick<RouteFormValues, RouteDayKey>): boolean =>
  ROUTE_DAYS.some(({ key }) => values[key]);

export const isDuplicateActiveRoute = (
  routes: RouteItem[],
  candidate: Pick<RouteFormValues, 'promotor_matricula' | 'loja_codigo' | 'industria_codigo'>,
  ignoreId?: string
): boolean =>
  routes.some(
    (route) =>
      route.id !== ignoreId &&
      isActiveFixedRoute(route) &&
      route.promotor_matricula === candidate.promotor_matricula &&
      route.loja_codigo === candidate.loja_codigo &&
      route.industria_codigo === candidate.industria_codigo
  );

export const buildRoutePayload = (values: RouteFormValues) => ({
  codigo_rota: values.codigo_rota?.trim() || `ROT-${values.promotor_matricula}`,
  industria_codigo: values.industria_codigo,
  loja_codigo: values.loja_codigo,
  promotor_matricula: values.promotor_matricula,
  uf: values.uf,
  frequencia: values.frequencia,
  segunda: values.segunda,
  terca: values.terca,
  quarta: values.quarta,
  quinta: values.quinta,
  sexta: values.sexta,
  sabado: values.sabado,
  domingo: values.domingo,
  observacao: values.observacao?.trim() || null
});

export interface FixedRouteGateway {
  create: (payload: ReturnType<typeof buildRoutePayload>) => Promise<void>;
  updateSchedule: (
    routeId: string,
    schedule: Pick<RouteFormValues, 'frequencia' | RouteDayKey | 'observacao'>
  ) => Promise<void>;
  close: (routeId: string, closedAt: string) => Promise<void>;
}

const requireSupabase = () => {
  if (!supabase) throw new Error('Cliente Supabase não inicializado.');
  return supabase;
};

export const supabaseFixedRouteGateway: FixedRouteGateway = {
  async create(payload) {
    const { error } = await requireSupabase().from('rotas').insert(payload);
    if (error) throw error;
  },
  async updateSchedule(routeId, schedule) {
    const updatePayload = { ...schedule, updated_at: new Date().toISOString() };
    const { data, error } = await requireSupabase()
      .from('rotas')
      .update(updatePayload)
      .eq('id', routeId)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('A escala não foi encontrada ou você não tem permissão para alterá-la.');
  },
  async close(routeId, closedAt) {
    const { data, error } = await requireSupabase()
      .from('rotas')
      .update({ encerrada_em: closedAt, updated_at: closedAt })
      .eq('id', routeId)
      .select('id')
      .maybeSingle();

    if (error) {
      // Se a coluna encerrada_em ainda não existe no banco (migration pendente)
      if (isMissingRouteClosureColumn(error)) {
        throw new Error(
          'Não foi possível encerrar esta escala. A funcionalidade de encerramento ainda precisa ser habilitada no sistema.'
        );
      }
      throw error;
    }
    if (!data) throw new Error('A escala não está mais ativa ou você não tem permissão para encerrá-la.');
  }
};

export const createFixedRoute = (
  values: RouteFormValues,
  gateway: FixedRouteGateway = supabaseFixedRouteGateway
): Promise<void> => gateway.create(buildRoutePayload(values));

export const updateFixedRouteSchedule = (
  routeId: string,
  schedule: Pick<RouteFormValues, 'frequencia' | RouteDayKey | 'observacao'>,
  gateway: FixedRouteGateway = supabaseFixedRouteGateway
): Promise<void> => gateway.updateSchedule(routeId, schedule);

export const closeFixedRoute = (
  routeId: string,
  gateway: FixedRouteGateway = supabaseFixedRouteGateway,
  closedAt = new Date().toISOString()
): Promise<void> => gateway.close(routeId, closedAt);
