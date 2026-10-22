import type { IncomingMessage, ServerResponse } from 'node:http';
import { authenticatedClient, loadScope, SessionError, type RhView } from './rh-authorization.ts';
export default async function rhAccessHandler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); res.statusCode = 405; res.end('{}'); return; }
  try {
    const client = await authenticatedClient(req.headers.authorization);
    const [mine, team, management] = await Promise.all(['mine', 'team', 'management'].map(v => loadScope(client, v as RhView)));
    res.end(JSON.stringify({ mine: !!mine.length, team: !!team.length, management: !!management.length }));
  } catch (e) { res.statusCode = e instanceof SessionError ? 401 : 503; res.end(JSON.stringify({ message: 'Não foi possível verificar os acessos de RH agora.' })); }
}
