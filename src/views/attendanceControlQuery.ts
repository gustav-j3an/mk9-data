export type AttendanceControlQueryState = {
  date: string;
  search: string;
  supervisor: string;
  scope: 'com_roteiro' | 'todos' | 'sem_programacao';
  status: string;
  squad: string;
  quick: 'all' | 'presente' | 'falta' | 'atestado' | 'atestado_pendente' | 'sem_registro' | 'sem_expediente';
  offSchedule: boolean;
};

const keys = ['data', 'busca', 'supervisor', 'escopo', 'status_roteiro', 'equipe', 'filtro_rapido', 'fora_grade'];

export function parseAttendanceControlQuery(params: URLSearchParams): Partial<AttendanceControlQueryState> {
  const result: Partial<AttendanceControlQueryState> = {};
  const date = params.get('data');
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) result.date = date;

  const search = params.get('busca');
  if (search) result.search = search;

  const supervisor = params.get('supervisor');
  if (supervisor) result.supervisor = supervisor;

  const scope = params.get('escopo');
  if (scope === 'com_roteiro' || scope === 'todos' || scope === 'sem_programacao') {
    result.scope = scope;
  }

  const status = params.get('status_roteiro');
  if (status) result.status = status;

  const squad = params.get('equipe');
  if (squad) result.squad = squad;

  const quick = params.get('filtro_rapido');
  if (
    quick === 'all' ||
    quick === 'presente' ||
    quick === 'falta' ||
    quick === 'atestado' ||
    quick === 'atestado_pendente' ||
    quick === 'sem_registro' ||
    quick === 'sem_expediente'
  ) {
    result.quick = quick;
  }

  const offSchedule = params.get('fora_grade');
  if (offSchedule === '1' || offSchedule === 'true') {
    result.offSchedule = true;
  }

  return result;
}

export function updateAttendanceControlQuery(
  current: URLSearchParams,
  state: AttendanceControlQueryState
): URLSearchParams {
  const next = new URLSearchParams(current);
  for (const key of Array.from(next.keys())) {
    if (/token|secret|password|authorization|\bcode\b/i.test(key)) next.delete(key);
  }
  keys.forEach((key) => next.delete(key));

  if (state.date) next.set('data', state.date);
  if (state.search.trim()) next.set('busca', state.search.trim());
  if (state.supervisor) next.set('supervisor', state.supervisor);
  if (state.scope && state.scope !== 'com_roteiro') next.set('escopo', state.scope);
  if (state.status && state.status !== 'ALL') next.set('status_roteiro', state.status);
  if (state.squad) next.set('equipe', state.squad);
  if (state.quick && state.quick !== 'all') next.set('filtro_rapido', state.quick);
  if (state.offSchedule) next.set('fora_grade', '1');

  return next;
}
