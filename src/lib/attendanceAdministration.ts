import { supabase } from './supabase';
import { validDate, validTime } from '../utils/attendanceEngine';

export const attendanceDays = ['domingo','segunda','terca','quarta','quinta','sexta','sabado'];
export interface JourneyInput {
  matriculas: string[]; days: string[]; start: string; end: string; from: string; until: string;
  interval: string; tolerance: string; timezone: string; modalidade: string; reason: string;
  exception: boolean; workUf: string; workCity: string;
}
const optionalNumber = (value: string) => {
  if (value === '') return null;
  const result = Number(value);
  if (!Number.isInteger(result) || result < 0) throw new Error('Informe minutos inteiros não negativos.');
  return result;
};
export function journeyRequest(input: JourneyInput) {
  const matriculas = [...new Set(input.matriculas.filter(Boolean))];
  const days = [...new Set(input.days)];
  if (!matriculas.length || matriculas.length > 500 || !days.length || days.some(d=>!attendanceDays.includes(d))) throw new Error('Selecione promotores e dias de trabalho.');
  if (!validDate(input.from) || input.until && (!validDate(input.until) || input.until<input.from)) throw new Error('Vigência inválida.');
  if (!validTime(input.start) || !validTime(input.end) || input.start===input.end) throw new Error('Informe horários válidos e distintos.');
  if (input.reason.trim().length<5) throw new Error('Informe justificativa com pelo menos 5 caracteres.');
  new Intl.DateTimeFormat('pt-BR',{timeZone:input.timezone});
  if (input.exception && (days.length!==1 || days[0]!==attendanceDays[new Date(input.from+'T12:00:00Z').getUTCDay()] || input.until && input.until!==input.from)) throw new Error('Exceção deve corresponder a uma única data.');
  return { p_matriculas:matriculas,p_days:days,p_start:input.start,p_end:input.end,p_from:input.from,p_to:input.until || null,
    p_interval:optionalNumber(input.interval),p_tolerance:optionalNumber(input.tolerance),p_timezone:input.timezone,
    p_modalidade:input.modalidade || null,p_reason:input.reason.trim(),p_exception:input.exception,
    p_work_uf:input.workUf.trim().toUpperCase() || null,p_work_city:input.workCity.trim() || null };
}
export async function applyJourneys(input: JourneyInput) {
  if (!supabase) throw new Error('Cliente não configurado.');
  const {data,error}=await supabase.rpc('apply_attendance_journeys',journeyRequest(input));
  if(error) throw error;
  if(!data?.success) throw new Error('O banco não confirmou a aplicação das jornadas.');
  return data.affected as number;
}
export async function assignSupervision(matriculas:string[],team:string,supervisor:string,reason:string) {
  if(!supabase) throw new Error('Cliente não configurado.');
  if(!matriculas.length || !team || !supervisor || reason.trim().length<5) throw new Error('Selecione promotores, equipe, supervisor e justificativa.');
  const {data,error}=await supabase.rpc('assign_attendance_supervisor',{p_matriculas:[...new Set(matriculas)],p_team:team,p_supervisor:supervisor,p_reason:reason.trim()});
  if(error) throw error;
  if(!data?.success) throw new Error('O banco não confirmou o vínculo.');
}
export function automaticAbsenceApproved(raw: unknown): boolean {
  return !!raw && typeof raw==='object' && 'automatic_absence_approved' in raw && raw.automatic_absence_approved===true;
}
