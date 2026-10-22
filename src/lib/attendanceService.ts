import { supabase } from './supabase';
import { buildRoster, parseRules, validDate, type OverrideStatus, type Promoter, type Team, type Supervisor, type Override, type Schedule, type Absence, type AttendanceHoliday } from '../utils/attendanceEngine';
import { calculateOperationalActivity, type PromoterOperationalSummary } from '../utils/visitActivityEngine';
import type { RouteItem, Visit } from '../types';
import type { PostgrestError } from '@supabase/supabase-js';
import { automaticAbsenceApproved } from './attendanceAdministration';

export const isMissingTable = (error: PostgrestError) => error.code === '42P01' || error.code === 'PGRST205';
// Every collection is paginated: PostgREST's row limit must not silently alter totals.
export async function readPages<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>) {
  const rows: T[] = [];
  const size = 500;
  for (let from = 0; ; from += size) {
    const { data, error } = await query(from, from + size - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < size) return rows;
  }
}
export async function fetchAttendance(date: string) {
  if (!supabase) throw new Error('Cliente Supabase não inicializado.');
  if (!validDate(date)) throw new Error('Data operacional inválida.');
  const db = supabase;
  // Revalidate authorization from profiles, never from editable session metadata.
  const { data: auth, error: authError } = await db.auth.getUser();
  if (authError || !auth.user) throw new Error('Sessão inválida.');
  const { data: profile, error: profileError } = await db.from('profiles').select('role,status').eq('id', auth.user.id).single();
  if (profileError) throw profileError;
  if (profile.status !== 'ativo' || !['admin', 'gestor', 'operador'].includes(profile.role)) throw new Error('Acesso não autorizado ao controle de presença.');
  const missing: string[] = [];
  type ReadQuery = ReturnType<ReturnType<typeof db.from>['select']>;
  // No generated Database type exists yet: narrow dynamic projections at this boundary.
  const page = async <T,>(table: string, columns: string, configure: (q: ReadQuery) => ReadQuery = q => q): Promise<T[]> =>
    await readPages<unknown>((from, to) => configure(db.from(table).select(columns)).order('id').range(from, to)) as T[];
  const optional = async <T,>(table: string, columns: string, configure?: (q: ReadQuery) => ReadQuery): Promise<T[]> => {
    try { return await page<T>(table, columns, configure); }
    catch (error) {
      if (isMissingTable(error as PostgrestError)) { missing.push(table); return []; }
      throw error;
    }
  };
  const visitsForDate = async () => {
    try { return await page<Visit>('visits', 'id,promotor_matricula,loja_codigo,industria_codigo,data_visita,status,started_at,completed_at,motivo_nao_realizada,latitude,longitude,gps_accuracy_meters,work_schedule_id,loja:lojas(codigo,nome),industria:industrias(codigo,nome)', q => q.eq('data_visita', date)); }
    catch (error) {
      if ((error as PostgrestError).code !== '42703') throw error;
      missing.push('telemetry');
      return page<Visit>('visits', 'id,promotor_matricula,loja_codigo,industria_codigo,data_visita,status,started_at,completed_at,motivo_nao_realizada,latitude,longitude,loja:lojas(codigo,nome),industria:industrias(codigo,nome)', q => q.eq('data_visita', date));
    }
  };
  const results = await Promise.allSettled([
    page<Promoter>('promotores', 'id,matricula,nome,equipe,supervisor,cidade,uf,telefone,status', q => q.eq('status', 'ativo')),
    visitsForDate(),
    page<Team>('equipes', 'id,codigo,nome,status,supervisor_id,supervisor_nome'),
    page<Supervisor>('supervisores', 'id,nome,status'),
    optional<Override>('attendance_override_summary', 'id,promotor_matricula,data_operacional,override_status,medical_days', q => q.eq('data_operacional', date)),
    optional<Schedule>('promoter_work_schedules', 'id,promotor_matricula,dia_semana,hora_inicio,hora_fim,ativo,valid_from,valid_to,interval_minutes,tolerance_minutes,timezone,modalidade,is_exception,work_uf,work_city', q => q.eq('ativo', true)),
    optional<Absence>('promoter_absences', 'id,promotor_matricula,tipo,data_inicio,data_fim,data_aprovacao', q => q.lte('data_inicio', date).gte('data_fim', date)),
    db.from('system_settings').select('key,value').in('key', ['attendance_rules', 'operation_mode', 'official_start_date']),
    optional<AttendanceHoliday>('attendance_holidays','id,data,nome,uf,cidade,behavior',q=>q.eq('data',date)),
    optional<RouteItem>('rotas', 'id,codigo_rota,promotor_matricula,loja_codigo,industria_codigo,frequencia,segunda,terca,quarta,quinta,sexta,sabado,domingo,encerrada_em,loja:lojas(codigo,nome),industria:industrias(codigo,nome)')
  ] as const);
  for (const result of results) if (result.status === 'rejected') throw result.reason;
  const fulfilled = <T,>(result: PromiseSettledResult<T>): T => { if(result.status==='rejected') throw result.reason; return result.value; };
  const promoters=fulfilled(results[0]), visits=fulfilled(results[1]), teams=fulfilled(results[2]), supervisors=fulfilled(results[3]), overrides=fulfilled(results[4]), schedules=fulfilled(results[5]), absences=fulfilled(results[6]), settingsResult=fulfilled(results[7]), holidays=fulfilled(results[8]), routes=fulfilled(results[9]);
  if (settingsResult.error) throw settingsResult.error;
  const readiness = await db.rpc('attendance_setup_status');
  if (readiness.error) {
    if (['PGRST202','42883'].includes(readiness.error.code)) missing.push('configuração operacional (migration 9)');
    else throw readiness.error;
  } else if (readiness.data?.version !== 9) throw new Error('Perfil sem autorização ou versão de configuração operacional incompatível.');
  const settings = new Map<string, unknown>((settingsResult.data || []).map((s: {key:string;value:unknown}) => [s.key, s.value]));
  const rules = parseRules(settings.get('attendance_rules'));
  const now = new Date().toISOString();
  const official = settings.get('operation_mode') === 'OPERACAO_OFICIAL';
  const officialStart = settings.get('official_start_date') || null;
  if (officialStart != null && (typeof officialStart !== 'string' || !validDate(officialStart))) throw new Error('Data de início oficial inválida.');
  const approvedRules = automaticAbsenceApproved(settings.get('attendance_rules'));
  const items = buildRoster({ promoters, routes, visits, teams, supervisors, overrides, schedules, absences, holidays, date, now, rules, official: official && approvedRules && missing.length === 0, officialStart });

  // Calcular atividades operacionais por atendimento
  const operationalSummary = calculateOperationalActivity({
    date,
    promoters,
    routes,
    visits,
    now,
    timezone: rules.timezone
  });
  const warnings = [];
  if (missing.length) warnings.push(`Estruturas indisponíveis: ${missing.join(', ')}. Verifique as migrations deste ambiente. Ausência de tabela não comprova ausência de jornadas; cadastros e ajustes desabilitados.`);
  if (!rules.close || rules.tolerance == null || !official || !officialStart) warnings.push('Faltas automáticas desabilitadas: fechamento, tolerância ou início da operação oficial não configurados.');
  const noSupervisor = items.filter(i => ['Não atribuído', 'Supervisor indisponível', 'Vínculo de equipe ambíguo'].includes(i.supervisor));
  if (noSupervisor.length) warnings.push(`${noSupervisor.length} promotor(es) com vínculo de supervisor pendente. Revise o responsável em Gerenciar equipes.`);
  const noJourney = missing.includes('promoter_work_schedules') ? 0 : items.filter(i=>i.operationalStatus==='sem_expediente').length;
  if (noJourney) warnings.push(`${noJourney} promotor(es) sem jornada cadastrada nesta data, fora dos indicadores. Programação de visitas não substitui jornada.`);
  if (!approvedRules) warnings.push('Faltas automáticas desabilitadas: aprovação administrativa das regras ainda pendente.');
  return { items, operationalSummary, routes, visits, fetchedAt: now, timezone: rules.timezone, warnings, promoters, missingDependencies: missing, canEdit: !missing.length && ['admin', 'gestor'].includes(profile.role) };
}
export async function fetchAttendanceAudit(matricula: string,date: string) {
  if (!supabase) throw new Error('Cliente não configurado.');
  const {data,error} = await supabase.from('promoter_attendance_audit_log').select('id,changed_at,changed_by_name,previous_value,new_value,justification').eq('promotor_matricula',matricula).eq('data_operacional',date).order('changed_at',{ascending:false});
  if(error) throw error;
  return (data || []) as AttendanceAuditEntry[];
}
export function validateOverride(status: string, justification: string, medicalDays?: number) {
  if (!['presente', 'falta', 'sem_registro', 'atestado_pendente', 'atestado_aprovado'].includes(status)) throw new Error('Status inválido.');
  if (justification.trim().length < 5) throw new Error('Informe uma justificativa com pelo menos 5 caracteres.');
  if (status.startsWith('atestado_') && (!Number.isInteger(medicalDays) || medicalDays! < 1 || medicalDays! > 30)) throw new Error('Informe de 1 a 30 dias de atestado.');
}
export interface CrmAttendanceResolution {
  status: 'pronto' | 'ambiguo' | 'pendente' | 'revogado' | 'sem_identidade' | 'sem_alocacao' | 'fora_vigencia_ou_janela' | 'indisponivel';
  alocacoes_validas: number; projeto_externo_id: string | null; matricula_externa: string | null;
}
export async function resolveCrmAttendance(matricula: string, date: string): Promise<CrmAttendanceResolution> {
  if (!supabase) return { status: 'indisponivel', alocacoes_validas: 0, projeto_externo_id: null, matricula_externa: null };
  try {
    const { data, error } = await supabase.rpc('mk9_rh_resolve_attendance', { p_matricula_local: matricula, p_data: date });
    if (error || !Array.isArray(data) || data.length !== 1) throw error || new Error('Invalid resolution response');
    const row = data[0];
    const allowed = ['pronto','ambiguo','pendente','revogado','sem_identidade','sem_alocacao','fora_vigencia_ou_janela'];
    if (!allowed.includes(row.status) || !Number.isInteger(row.alocacoes_validas)) throw new Error('Invalid resolution response');
    return { status: row.status, alocacoes_validas: row.alocacoes_validas, projeto_externo_id: row.projeto_externo_id, matricula_externa: row.matricula_externa };
  } catch {
    // An integration lookup must never mask a successful local attendance save.
    return { status: 'indisponivel', alocacoes_validas: 0, projeto_externo_id: null, matricula_externa: null };
  }
}
export async function saveAttendance(input: { matricula: string; date: string; status: OverrideStatus; justification: string; medicalDays: number }) {
  if (!supabase) throw new Error('Cliente Supabase não inicializado.');
  validateOverride(input.status, input.justification, input.medicalDays);
  if (!validDate(input.date)) throw new Error('Data operacional inválida.');
  const { data, error } = await supabase.rpc('set_promoter_attendance_override', {
    p_promotor_matricula: input.matricula, p_data_operacional: input.date, p_override_status: input.status,
    p_justification: input.justification.trim(), p_medical_days: input.status.startsWith('atestado_') ? input.medicalDays : null
  });
  if (error) throw error;
  if (!data?.success) throw new Error('O banco não confirmou a gravação do ajuste.');
}

export interface AttendanceAuditEntry { id:string; changed_at:string; changed_by_name:string|null; previous_value:{override_status?:string}|null; new_value:{override_status?:string}; justification:string }
export function attendanceErrorMessage(error: unknown):string {
  const code=error && typeof error==='object' && 'code' in error?String(error.code):'';
  const message=error && typeof error==='object' && 'message' in error?String(error.message):'Erro inesperado.';
  if(code==='42501' || code==='PGRST301') return `Permissão negada. Verifique o perfil e as políticas RLS. ${message}`;
  if(['42P01','PGRST205','PGRST202','42703'].includes(code)) return `Estrutura ou RPC indisponível; verifique as migrations e o cache do esquema. ${message}`;
  return message;
}
