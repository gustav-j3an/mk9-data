import type { IncomingMessage, ServerResponse } from 'node:http';
import { IntegrationError, queryMk9Window } from './mk9-faltas.ts';
import { AccessError, SessionError, authenticatedClient, loadScope, validDate, type RhView } from './rh-authorization.ts';
import type { AbsencesResult } from '../shared/mk9.ts';
export function rhHandler(view: RhView) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const send = (status: number, body: unknown) => { res.statusCode = status; res.end(JSON.stringify(body)); };
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return send(405, { message: 'Consulta disponível somente para leitura.' }); }
    try {
      const client = await authenticatedClient(req.headers.authorization);
      const params = new URL(req.url || '/', 'http://localhost').searchParams;
      for (const k of params.keys()) if (!['data_inicio', 'data_fim'].includes(k) || params.getAll(k).length !== 1) return send(400, { message: 'Use apenas os filtros de período disponíveis na tela.' });
      const start = params.get('data_inicio'); const end = params.get('data_fim');
      if (!validDate(start) || !validDate(end) || start > end || Date.parse(end) - Date.parse(start) > 366 * 86400000) return send(400, { message: 'Selecione um período de até um ano.' });
      const scope = await loadScope(client, view);
      if (!scope.length) throw new AccessError();
      if (!process.env.MK9_FALTAS_API_KEY) throw new IntegrationError('configuration');
      const budget = { deadline: Date.now() + 20_000, requests: 0 };
      const collected: AbsencesResult['data'] = [];
      let updatedAt = new Date().toISOString();
      let next = 0; let failure: unknown;
      const projectNames = new Map<string, string>();
      await Promise.all(Array.from({ length: Math.min(4, scope.length) }, async () => {
        while (!failure && next < scope.length) {
          const a = scope[next++];
          const from = start > a.ocorrencias_desde ? start : a.ocorrencias_desde;
          const to = a.ocorrencias_ate && a.ocorrencias_ate < end ? a.ocorrencias_ate : end;
          if (from > to) continue;
          try {
            const result = await queryMk9Window({ projeto_id: a.projeto_id, matricula: a.matricula_externa, data_inicio: from, data_fim: to }, budget, view === 'management' ? 90_000 : 45_000);
            if (result.updatedAt < updatedAt) updatedAt = result.updatedAt;
            for (const item of result.data) {
              if (item.projectId !== a.projeto_id || item.matricula !== a.matricula_externa || !validDate(item.inicio) ||
                (item.fim !== null && !validDate(item.fim)) || (item.fim && item.fim < item.inicio)) continue;
              const finish = item.fim || (item.dias === 1 ? item.inicio : null);
              if (!finish) continue; // An unknown multi-day end cannot prove history authorization.
              if (item.inicio < a.ocorrencias_desde || (a.ocorrencias_ate && finish > a.ocorrencias_ate) || finish < from || item.inicio > to) continue;
              const { projectId: _, recordKey: __, ...safe } = item;
              projectNames.set(a.projeto_id, safe.projeto);
              collected.push({ ...safe, matricula: a.matricula_local, nome: a.nome_local || safe.nome, supervisor: view === 'mine' ? '' : a.supervisor_nome });
            }
          } catch (e) { failure = e; }
        }
      }));
      if (failure) throw failure;
      // Revalidate AFTER the provider/cache read. A revoked/expired/edited grant denies all output.
      const refreshed = await loadScope(client, view);
      const latest = new Map(refreshed.map(a => [a.alocacao_id, JSON.stringify(a)]));
      if (scope.some(a => latest.get(a.alocacao_id) !== JSON.stringify(a))) throw new AccessError();
      const projectIds = [...new Set(scope.map(a => a.projeto_id))];
      const projects = projectIds.map((id, i) => ({ nome: projectNames.get(id) || `Projeto autorizado ${i + 1}`, activePromoters: new Set(scope.filter(a => a.projeto_id === id && a.promotor_ativo).map(a => a.promotor_id)).size }));
      return send(200, { data: collected, projects, activePromoters: new Set(scope.filter(a => a.promotor_ativo).map(a => a.promotor_id)).size, updatedAt } satisfies AbsencesResult);
    } catch (error) {
      if (error instanceof SessionError) return send(401, { message: 'Entre novamente para consultar suas informações.' });
      if (error instanceof AccessError) return send(403, { message: 'Seu acesso a estas informações de RH não está autorizado. Verifique os vínculos com o administrador.' });
      console.warn('[MK9 RH]', error instanceof IntegrationError ? error.code : 'unavailable');
      return send(503, { message: error instanceof IntegrationError && error.code === 'incomplete' ? 'Há muitas ocorrências neste período. Selecione um intervalo menor.' : 'Informações de faltas e atestados temporariamente indisponíveis. Tente novamente em alguns instantes.' });
    }
  };
}
