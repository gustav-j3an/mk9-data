import { friendlyStatus, type Absence, type Mk9ApiAbsenceRecord } from '../shared/mk9.ts';

export class IntegrationError extends Error {
  constructor(public readonly code: 'configuration' | 'upstream' | 'incomplete' | 'invalid') { super(code); }
}
const text = (v: unknown) => typeof v === 'string' ? v.slice(0, 200) : '';
const date = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v ? v : null;
export interface InternalAbsence extends Absence { projectId: string; recordKey: string; externalMatricula: string }
// Explicit projection: raw MK9 objects and medical fields stay server-side; only scoped identity is added.
export function normalizeAbsence(value: unknown): InternalAbsence | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Mk9ApiAbsenceRecord;
  const matricula = text(v.colaborador?.matricula);
  const projectId = text(v.projeto?.id);
  const recordId = text(v.id) || null;
  const recordKey = recordId || text(v.protocolo);
  if (!matricula || !projectId || !recordKey || !date(v.periodo?.inicio) ||
    (v.periodo?.fim != null && !date(v.periodo.fim)) || (v.periodo?.retorno != null && !date(v.periodo.retorno))) return null;
  return {
    projectId, recordKey, externalMatricula: matricula, matricula, nome: text(v.colaborador?.nome), projeto: text(v.projeto?.nome) || 'Projeto',
    supervisor: '', protocolo: text(v.protocolo), externalIdentity: { recordId, projectId, matricula },
    tipo: v.tipo?.categoria === 'FALTA' ? 'Falta' : v.tipo?.categoria === 'ATESTADO' ? 'Atestado' : 'Ausência',
    inicio: date(v.periodo?.inicio), fim: date(v.periodo?.fim), retorno: date(v.periodo?.retorno),
    dias: typeof v.periodo?.dias === 'number' && Number.isFinite(v.periodo.dias) && v.periodo.dias >= 0 ? v.periodo.dias : null,
    status: friendlyStatus(v.status, v.status_processamento)
  };
}

export interface QueryBudget { deadline: number; requests: number }
/** The provider has no cursor/offset contract. Partition dates for the SAME approved pair.
 * Deduplicate spanning records, and fail closed when even one day reaches the provider cap.
 * Never invent cursor parameters or silently return truncated totals.
 */
export async function queryMk9Window(filters: { projeto_id: string; matricula: string; data_inicio: string; data_fim: string }, budget: QueryBudget, ttl: number, env = process.env, fetcher = fetch): Promise<{ data: InternalAbsence[]; updatedAt: string }> {
  if (Date.now() > budget.deadline || ++budget.requests > 160) throw new IntegrationError('incomplete');
  try { return await queryMk9(filters, env, fetcher, ttl); }
  catch (e) {
    if (!(e instanceof IntegrationError) || e.code !== 'incomplete' || filters.data_inicio === filters.data_fim) throw e;
    const middle = new Date(Math.floor((Date.parse(filters.data_inicio) / 86400000 + Date.parse(filters.data_fim) / 86400000) / 2) * 86400000).toISOString().slice(0, 10);
    const tomorrow = new Date(Date.parse(middle) + 86400000).toISOString().slice(0, 10);
    const left = await queryMk9Window({ ...filters, data_fim: middle }, budget, ttl, env, fetcher);
    const right = await queryMk9Window({ ...filters, data_inicio: tomorrow }, budget, ttl, env, fetcher);
    const unique = new Map<string, InternalAbsence>();
    for (const row of [...left.data, ...right.data]) {
      if (!row.recordKey) throw new IntegrationError('incomplete');
      const key = JSON.stringify([row.projectId, row.matricula, row.recordKey]);
      const previous = unique.get(key);
      if (previous && JSON.stringify(previous) !== JSON.stringify(row)) throw new IntegrationError('incomplete');
      unique.set(key, row);
    }
    return { data: [...unique.values()], updatedAt: left.updatedAt < right.updatedAt ? left.updatedAt : right.updatedAt };
  }
}
/** @deprecated Legacy configuration reader only; never used to authorize RH requests. */
export function projectMapping(env: NodeJS.ProcessEnv): Record<string, string[]> {
  try {
    const map = JSON.parse(env.MK9_FALTAS_PROJECT_TEAMS || '{}');
    if (!map || Array.isArray(map) || typeof map !== 'object' || !Object.keys(map).length || Object.keys(map).length > 30) throw 0;
    for (const [id, teams] of Object.entries(map)) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || !Array.isArray(teams) || !teams.length || teams.some(t => typeof t !== 'string' || !/^EQP-\d+$/.test(t))) throw 0;
    }
    return map;
  } catch { throw new IntegrationError('configuration'); }
}
const cache = new Map<string, { expires: number; data: InternalAbsence[]; updatedAt: string }>();
export async function queryMk9(filters: Record<string, string>, env = process.env, fetcher = fetch, ttl = 45_000) {
  if (!env.MK9_FALTAS_API_KEY) throw new IntegrationError('configuration');
  let url: URL;
  try {
    url = new URL('/api/integracoes/ausencias', env.MK9_FALTAS_API_URL || 'https://mk9-faltas-atestados-atualizado.vercel.app');
    if (url.protocol !== 'https:' || url.username || url.password) throw 0;
  } catch { throw new IntegrationError('configuration'); }
  for (const [k, v] of Object.entries(filters)) url.searchParams.set(k, v);
  url.searchParams.set('limit', '100');
  // Credential rotation cannot reuse an old credential's cache. Key is never logged/returned.
  const cacheKey = JSON.stringify([env.MK9_FALTAS_API_KEY, url.href]);
  const existing = cache.get(cacheKey);
  if (existing && existing.expires > Date.now() && Date.parse(existing.updatedAt) + ttl > Date.now()) return existing;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetcher(url, { headers: { Authorization: `Bearer ${env.MK9_FALTAS_API_KEY}`, Accept: 'application/json' }, signal: controller.signal, redirect: 'error' });
    if (!response.ok) throw new IntegrationError('upstream');
    const body = await response.json();
    if (body?.ok !== true || !Array.isArray(body.data) || body.data.length > 100) throw new IntegrationError('invalid');
    // No cursor/pagination contract was supplied. Never present truncated totals as complete.
    const reportedLimit = typeof body.meta?.limit === 'number' && body.meta.limit > 0 ? Math.min(100, body.meta.limit) : 100;
    if (body.data.length >= reportedLimit || (typeof body.meta?.count === 'number' && body.meta.count > body.data.length)) throw new IntegrationError('incomplete');
    const data = body.data.map(normalizeAbsence);
    if (data.some((v: InternalAbsence | null) => !v)) throw new IntegrationError('invalid');
    const entry = { data: data as InternalAbsence[], expires: Date.now() + ttl, updatedAt: new Date().toISOString() };
    if (cache.size >= 250) cache.delete(cache.keys().next().value!);
    cache.set(cacheKey, entry);
    return entry;
  } catch (error) {
    throw error instanceof IntegrationError ? error : new IntegrationError('upstream');
  } finally { clearTimeout(timer); }
}
