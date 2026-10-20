// Opt-in, read-only real integration checks. Never print credentials or provider bodies.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { config } from 'dotenv';
import mine from '../api/rh/minhas-ausencias.ts';
import team from '../api/rh/equipe/ausencias.ts';
import management from '../api/rh/gestao/ausencias.ts';
import { queryMk9, queryMk9Window } from '../server/mk9-faltas.ts';

config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });
interface ProjectCase { id: string; matriculas: string[]; expectedProtocols: string[] }
interface ActorCase { label: string; role: 'promotor' | 'gestor' | 'admin'; tokenEnv: string; alocacoes: { projeto_id: string; matricula_local: string; matricula_externa: string }[]; expectedProtocols: string[]; allowedViews?: ('mine' | 'team' | 'management')[] }
interface Cases { start: string; end: string; projects: ProjectCase[]; actors: ActorCase[]; forbiddenProjectId: string }
const routes = { '/api/rh/minhas-ausencias': mine, '/api/rh/equipe/ausencias': team, '/api/rh/gestao/ausencias': management };
const paths = { promotor: '/api/rh/minhas-ausencias', gestor: '/api/rh/equipe/ausencias', admin: '/api/rh/gestao/ausencias' };
class CheckError extends Error {}
function requireCheck(value: unknown, code: string): asserts value { if (!value) throw new CheckError(code); }
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.every(x => typeof x === 'string' && x.trim() === x && x.length > 0);

async function main() {
  requireCheck(process.argv.slice(2).length === 1 && ['--check', '--real'].includes(process.argv[2]), 'use --check or --real');
  const env = process.env;
  const required = ['MK9_FALTAS_API_KEY', 'MK9_FALTAS_API_URL'];
  for (const name of required) requireCheck(env[name]?.trim(), `configuration missing: ${name}`);
  requireCheck(env.SUPABASE_URL || env.VITE_SUPABASE_URL, 'application Supabase URL missing');
  requireCheck(env.SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY, 'application public Supabase key missing');
  const origin = new URL(env.MK9_FALTAS_API_URL!);
  requireCheck(origin.protocol === 'https:' && !origin.username && !origin.password && origin.pathname === '/' && !origin.search && !origin.hash, 'MK9 URL must be an HTTPS origin');
  const cases: Cases = JSON.parse(readFileSync(env.MK9_QA_CASES_FILE || '.env.mk9-qa-cases.json', 'utf8'));
  // Independent administrator-confirmed project cases, NEVER the former project/team fallback.
  requireCheck(Array.isArray(cases.projects) && cases.projects.length > 0, 'verified project cases required');
  const map = Object.fromEntries(cases.projects.map(p => [p.id, true]));
  requireCheck(/^\d{4}-\d{2}-\d{2}$/.test(cases.start) && /^\d{4}-\d{2}-\d{2}$/.test(cases.end) && cases.start <= cases.end && Date.parse(cases.end) - Date.parse(cases.start) <= 366 * 86400000, 'case period invalid');
  requireCheck(Array.isArray(cases.projects) && cases.projects.length === Object.keys(map).length && new Set(cases.projects.map(p => p.id)).size === cases.projects.length, 'every configured project needs a verified case');
  for (const p of cases.projects) requireCheck(map[p.id] && strings(p.matriculas) && strings(p.expectedProtocols), 'project needs real matriculas and known protocols');
  requireCheck(Array.isArray(cases.actors) && cases.actors.length >= 3, 'three role cases required');
  for (const role of ['promotor', 'gestor', 'admin']) requireCheck(cases.actors.some(a => a.role === role), 'all three roles required');
  for (const a of cases.actors) {
    requireCheck(Object.hasOwn(paths, a.role) && /^MK9_QA_[A-Z_]+_TOKEN$/.test(a.tokenEnv) && env[a.tokenEnv] && Array.isArray(a.alocacoes) && a.alocacoes.length > 0 && a.alocacoes.every(b => Object.hasOwn(map,b.projeto_id) && strings([b.matricula_local,b.matricula_externa])) && strings(a.expectedProtocols), 'actor configuration incomplete');
    requireCheck(a.role !== 'promotor' || new Set(a.alocacoes.map(b=>b.matricula_local)).size === 1, 'promotor needs one exact local identity');
  }
  requireCheck(new Set(cases.actors.map(a => env[a.tokenEnv])).size === cases.actors.length, 'each actor needs a distinct session');
  requireCheck(/^[0-9a-f-]{36}$/i.test(cases.forbiddenProjectId) && !map[cases.forbiddenProjectId], 'a real project outside the integration scope is required');
  console.log('PASS: configuration structurally complete; no credentials printed.');
  if (process.argv[2] === '--check') { console.log('No network requests performed. Business links still require administrator verification.'); return; }

  const period = { data_inicio: cases.start, data_fim: cases.end };
  const reference = new Map<string, Awaited<ReturnType<typeof queryMk9>>['data'][number]>();
  for (const p of cases.projects) {
    const projectRows: Awaited<ReturnType<typeof queryMk9>>['data'] = [];
    for (const matricula of p.matriculas) {
      const response = await queryMk9Window({ ...period, projeto_id: p.id, matricula }, { deadline: Date.now()+20_000, requests: 0 }, 45_000);
      requireCheck(response.data.every(r => r.projectId === p.id && r.matricula === matricula), 'MK9 returned an unexpected external identity');
      projectRows.push(...response.data);
    }
    for (const protocol of p.expectedProtocols) requireCheck(projectRows.some(r => r.protocolo === protocol), 'known MK9 project occurrence missing or matricula differs');
    for (const r of projectRows) {
      requireCheck(r.protocolo && !reference.has(r.protocolo), 'protocol is absent or ambiguous across project cases'); reference.set(r.protocolo, r);
    }
  }
  // A successful empty response does not prove authorization was denied.
  const forbiddenUrl = new URL('/api/integracoes/ausencias', origin);
  forbiddenUrl.search = new URLSearchParams({ ...period, projeto_id: cases.forbiddenProjectId, limit: '1' }).toString();
  const forbidden = await fetch(forbiddenUrl, { method: 'GET', headers: { Authorization: `Bearer ${env.MK9_FALTAS_API_KEY}` }, redirect: 'error', signal: AbortSignal.timeout(8000) });
  requireCheck([403, 404].includes(forbidden.status), 'MK9 project denial not confirmed; inspect provider contract privately');
  await forbidden.body?.cancel();
  console.log('PASS: real MK9 project scope and known occurrences.');

  // Execute the actual three route exports over a temporary loopback HTTP server.
  // No deployment, browser, SQL writes, Auth mutations or production configuration changes.
  const server = createServer((req, res) => {
    const handler = routes[new URL(req.url || '/', 'http://localhost').pathname as keyof typeof routes];
    if (!handler) { res.statusCode = 404; res.end(); } else void handler(req, res);
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try {
    const address = server.address();
    requireCheck(address && typeof address !== 'string', 'local test server unavailable');
    const base = `http://127.0.0.1:${address.port}`;
    async function call(path: string, token?: string, extra: Record<string, string> = {}) {
      return fetch(`${base}${path}?${new URLSearchParams({ ...period, ...extra })}`, { method: 'GET', headers: token ? { Authorization: `Bearer ${token}` } : {}, redirect: 'error', signal: AbortSignal.timeout(45_000) });
    }
    const allowedFields = new Set(['protocolo', 'matricula', 'nome', 'projeto', 'supervisor', 'tipo', 'inicio', 'fim', 'retorno', 'dias', 'status']);
    for (const path of Object.keys(routes)) {
      const response = await call(path); requireCheck(response.status === 401, 'unauthenticated route must deny access'); await response.body?.cancel();
    }
    for (const actor of cases.actors) {
      const path = paths[actor.role];
      const token = env[actor.tokenEnv]!;
      const response = await call(path, token);
      requireCheck(response.status === 200 && response.headers.get('cache-control')?.includes('no-store'), 'authenticated route unavailable or unsafe cache header');
      const body = await response.json();
      requireCheck(Array.isArray(body.data) && Array.isArray(body.projects), 'internal response malformed');
      requireCheck(body.data.every((r: any) => Object.keys(r).every(k => allowedFields.has(k)) && actor.alocacoes.some(b => b.matricula_local === r.matricula && reference.get(r.protocolo)?.matricula === b.matricula_externa && reference.get(r.protocolo)?.projectId === b.projeto_id) && reference.get(r.protocolo)?.projeto === r.projeto), 'internal response exceeds approved case scope or reference');
      const expected = [...reference.values()].filter(r => actor.alocacoes.some(b=>b.projeto_id===r.projectId && b.matricula_externa===r.matricula));
      requireCheck(expected.length === body.data.length && expected.every(r => body.data.some((actual: any) => actual.protocolo === r.protocolo)), 'internal result is incomplete or duplicated');
      requireCheck([...reference.values()].some(r => !actor.alocacoes.some(b=>b.projeto_id===r.projectId && b.matricula_externa===r.matricula)), 'a known occurrence outside this actor scope is needed to prove isolation');
      for (const protocol of actor.expectedProtocols) requireCheck(body.data.some((r: any) => r.protocolo === protocol), 'known actor occurrence missing; empty success is not a pass');
      const serialized = JSON.stringify(body);
      requireCheck(!serialized.includes(env.MK9_FALTAS_API_KEY!) && !serialized.includes(token) && !Object.keys(map).some(id => serialized.includes(id)), 'sensitive server information exposed');
      const manipulations: Record<string, string>[] = [{ matricula: 'untrusted-test-value' }, { projeto_id: cases.forbiddenProjectId }, { team_id: 'untrusted-team' }, { role: 'admin' }];
      for (const extra of manipulations) {
        const denied = await call(path, token, extra); requireCheck(denied.status === 400, 'manipulated query not rejected'); await denied.body?.cancel();
      }
      for (const otherPath of Object.keys(routes).filter(p => p !== path)) {
        const otherView = otherPath.includes('minhas-') ? 'mine' : otherPath.includes('/equipe/') ? 'team' : 'management';
        const denied = await call(otherPath, token);
        requireCheck(denied.status === (actor.allowedViews?.includes(otherView) ? 200 : 403), 'cross-view capability differs from approved cases'); await denied.body?.cancel();
      }
    }
    console.log('PASS: real sessions, all routes, known occurrences, identity/project/role tampering and response privacy.');
    console.log('No records or credentials saved. Read-only homologation checks completed.');
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
main().catch(error => {
  // Intentionally omit exception text: libraries may include credentials or response bodies.
  console.error('NOT APPROVED: configuration or real integration check failed. No secret/body printed. Review the private configuration and the last PASS stage.');
  if (error instanceof CheckError) console.error(`Check: ${error.message}`);
  process.exitCode = 1;
});
