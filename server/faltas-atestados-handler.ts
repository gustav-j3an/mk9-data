import type { IncomingMessage, ServerResponse } from 'node:http';
import { rhHandler } from './rh-handler.ts';
import type { RhView } from './rh-authorization.ts';
const views = new Set<RhView>(['mine', 'team', 'management']);

/** Module-specific read route: capability and per-allocation RH scope are both checked server-side. */
export default async function faltasAtestadosHandler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); res.statusCode = 405; res.end(JSON.stringify({ message: 'Consulta disponível somente para leitura.' })); return; }
  const url = new URL(req.url || '/', 'http://localhost');
  const requested = url.searchParams.getAll('view');
  if (requested.length !== 1 || !views.has(requested[0] as RhView)) {
    res.statusCode = 400; res.end(JSON.stringify({ message: 'Selecione uma visão de consulta autorizada.' })); return;
  }
  url.searchParams.delete('view');
  const delegatedRequest = { ...req, url: `${url.pathname}?${url.searchParams.toString()}` } as IncomingMessage;
  await rhHandler(requested[0] as RhView, { requirePreparePermission: true, includeExternalIdentity: true })(delegatedRequest, res);
}