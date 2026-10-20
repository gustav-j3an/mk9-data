import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { IntegrationError } from './mk9-faltas.ts';
export type RhView = 'mine' | 'team' | 'management';
export class AccessError extends Error {}
export class SessionError extends Error {}
export interface RhAllocation {
  alocacao_id: string; promotor_id: string; matricula_local: string; nome_local: string;
  projeto_id: string; matricula_externa: string; ocorrencias_desde: string;
  ocorrencias_ate: string | null; supervisor_nome: string; promotor_ativo: boolean; versao: string;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const validDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
export async function authenticatedClient(header: string | undefined): Promise<SupabaseClient> {
  const token = header?.match(/^Bearer ([^\s]+)$/)?.[1];
  if (!token) throw new SessionError();
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key || key.startsWith('sb_secret_')) throw new IntegrationError('configuration');
  if (key.split('.').length === 3) {
    try { if (JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role === 'service_role') throw new IntegrationError('configuration'); }
    catch (e) { if (e instanceof IntegrationError) throw e; }
  }
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` }, fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(8000) }) } });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new SessionError();
  return client;
}
export function validateAllocations(value: unknown): RhAllocation[] {
  if (!Array.isArray(value) || value.length >= 500) throw new IntegrationError('incomplete');
  const seen = new Set<string>(); const pairs = new Set<string>();
  for (const a of value) {
    if (!a || ![a.alocacao_id, a.promotor_id, a.projeto_id].every(v => typeof v === 'string' && uuid.test(v)) ||
      ![a.matricula_local, a.matricula_externa, a.versao].every(v => typeof v === 'string' && v.length > 0) || typeof a.nome_local !== 'string' || typeof a.supervisor_nome !== 'string' || typeof a.promotor_ativo !== 'boolean' || !validDate(a.ocorrencias_desde) ||
      (a.ocorrencias_ate !== null && (!validDate(a.ocorrencias_ate) || a.ocorrencias_ate < a.ocorrencias_desde))) throw new IntegrationError('invalid');
    const pair = JSON.stringify([a.projeto_id, a.matricula_externa]);
    if (seen.has(a.alocacao_id) || pairs.has(pair)) throw new IntegrationError('invalid');
    seen.add(a.alocacao_id); pairs.add(pair);
  }
  return value;
}
export async function loadScope(client: SupabaseClient, view: RhView): Promise<RhAllocation[]> {
  // Scope decisions are always fresh, never cached alongside provider data.
  const { data, error } = await client.rpc('mk9_rh_scope', { p_view: view }).range(0, 499).abortSignal(AbortSignal.timeout(8000));
  if (error) throw new IntegrationError('upstream');
  return validateAllocations(data);
}
