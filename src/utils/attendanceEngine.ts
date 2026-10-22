import type { AttendanceItem, RouteItem, Visit } from '../types';

export type OperationalStatus = 'presente' | 'atrasado' | 'aguardando_expediente' | 'sem_registro' | 'falta_confirmada' | 'folga' | 'ferias' | 'afastamento' | 'feriado' | 'sem_expediente' | 'atestado_pendente' | 'atestado_aprovado';
export type OverrideStatus = 'presente' | 'falta' | 'sem_registro' | 'atestado_pendente' | 'atestado_aprovado';
export interface Rules {
  timezone: string;
  close: string | null;
  tolerance: number | null;
}
export interface Schedule { id?: string; promotor_matricula: string; dia_semana: string; hora_inicio: string; hora_fim: string; ativo: boolean; valid_from?: string | null; valid_to?: string | null; interval_minutes?: number | null; tolerance_minutes?: number | null; timezone?: string; modalidade?: string | null; is_exception?: boolean; work_uf?: string|null; work_city?: string|null }
export interface AttendanceHoliday { data: string; nome: string; uf: string | null; cidade: string | null; behavior: 'follow_schedule' | 'off' | 'work' }
export interface Absence { promotor_matricula: string; tipo: string; data_inicio: string; data_fim: string; data_aprovacao: string | null }
export interface Override { promotor_matricula: string; data_operacional: string; override_status: OverrideStatus; justification?: string; medical_days: number | null }
export interface Promoter { id: string; matricula: string; nome: string; equipe: string | null; supervisor: string | null; cidade?: string | null; uf?: string | null; telefone?: string | null; status: string }
export interface Team { codigo: string; nome: string; status: string; supervisor_id: string | null; supervisor_nome: string | null }
export interface Supervisor { id: string; nome: string; status: string }
export interface PresenceItem extends Omit<AttendanceItem, 'type'> { type?: AttendanceItem['type']; operationalStatus: OperationalStatus; eligible: boolean; checkInAt: string | null; medicalStatus?: 'pendente' | 'aprovado' | null; scheduleDetail?: string }
export const LABELS: Record<OperationalStatus, string> = {
  presente: 'Presente', atrasado: 'Atrasado', aguardando_expediente: 'Aguardando expediente',
  sem_registro: 'Sem registro', falta_confirmada: 'Falta confirmada', folga: 'Folga', ferias: 'Férias', afastamento: 'Afastamento', feriado: 'Feriado',
  sem_expediente: 'Sem expediente programado', atestado_pendente: 'Atestado pendente', atestado_aprovado: 'Atestado aprovado'
};
const DAYS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
export const validTime = (value: unknown): value is string => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(value);
const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
export function parseRules(value: unknown): Rules {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const timezone = typeof raw.timezone === 'string' ? raw.timezone : 'America/Sao_Paulo';
  // Invalid configuration is an error, never an invented closing time.
  new Intl.DateTimeFormat('en', { timeZone: timezone });
  if (raw.day_close_time != null && !validTime(raw.day_close_time)) throw new Error('Horário de fechamento inválido.');
  if (raw.late_tolerance_minutes != null && (typeof raw.late_tolerance_minutes !== 'number' || !Number.isFinite(raw.late_tolerance_minutes) || raw.late_tolerance_minutes < 0)) throw new Error('Tolerância inválida.');
  return { timezone, close: validTime(raw.day_close_time) ? raw.day_close_time : null, tolerance: typeof raw.late_tolerance_minutes === 'number' ? raw.late_tolerance_minutes : null };
}
export function zoned(iso: string, timezone = 'America/Sao_Paulo') {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const p = (key: string) => parts.find(part => part.type === key)!.value;
  return { date: `${p('year')}-${p('month')}-${p('day')}`, minutes: Number(p('hour')) * 60 + Number(p('minute')), time: `${p('hour')}:${p('minute')}` };
}
export function validDate(date: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
}
export function locationDetail(input: { latitude?: number | null; longitude?: number | null; accuracy?: number | null; storeLatitude?: number | null; storeLongitude?: number | null; radius?: number | null }) {
  const { latitude: lat, longitude: lng, accuracy, storeLatitude: slat, storeLongitude: slng, radius } = input;
  const valid = (a: unknown, b: unknown) => typeof a === 'number' && typeof b === 'number' && Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180;
  if (lat == null && lng == null) return 'Localização não disponível';
  if (!valid(lat, lng)) return 'Localização inválida';
  if (accuracy != null && (!Number.isFinite(accuracy) || accuracy < 0)) return 'Precisão GPS inválida';
  if (!valid(slat, slng) || radius == null || !Number.isFinite(radius) || radius <= 0 || accuracy == null) return 'Localização capturada, não validada: faltam precisão GPS, referência da loja ou raio';
  const rad = (n: number) => n * Math.PI / 180;
  const a = Math.sin(rad(slat! - lat!) / 2) ** 2 + Math.cos(rad(lat!)) * Math.cos(rad(slat!)) * Math.sin(rad(slng! - lng!) / 2) ** 2;
  const distance = 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
  if (distance + accuracy <= radius) return `Localização validada (${Math.round(distance)} m; precisão ${accuracy} m)`;
  if (distance - accuracy > radius) return `Localização fora da área (${Math.round(distance)} m)`;
  return 'Localização não validada: precisão GPS insuficiente';
}
export function canonicalCheckIn(visits: Visit[], now: string) {
  return visits.filter(v => v.started_at && /(?:Z|[+-]\d{2}:\d{2})$/i.test(v.started_at) && Number.isFinite(Date.parse(v.started_at)) && Date.parse(v.started_at) <= Date.parse(now))
    .sort((a, b) => Date.parse(a.started_at!) - Date.parse(b.started_at!) || a.id.localeCompare(b.id))[0];
}
export function resolveSupervisor(promoter: Promoter, teams: Team[], supervisors: Supervisor[]) {
  const key = (v: string | null) => (v || '').trim().toLocaleLowerCase('pt-BR');
  const matches = teams.filter(t => ['ativa', 'ativo'].includes(t.status) && (key(t.nome) === key(promoter.equipe) || key(t.codigo) === key(promoter.equipe)));
  if (matches.length > 1) return 'Vínculo de equipe ambíguo';
  const team = matches[0];
  if (team?.supervisor_id) return supervisors.find(s => s.id === team.supervisor_id && s.status === 'ativo')?.nome || 'Supervisor indisponível';
  return team?.supervisor_nome?.trim() || promoter.supervisor?.trim() || 'Não atribuído';
}
export function buildRoster(input: {
  promoters: Promoter[]; routes: RouteItem[]; visits: Visit[]; history?: Visit[]; teams: Team[]; supervisors: Supervisor[];
  overrides: Override[]; schedules: Schedule[]; absences: Absence[]; date: string; now: string; rules: Rules;
  official: boolean; officialStart: string | null; holidays?: AttendanceHoliday[];
}): PresenceItem[] {
  if (!validDate(input.date)) throw new Error('Data operacional inválida.');
  const day = DAYS[new Date(`${input.date}T12:00:00Z`).getUTCDay()];
  return Array.from(new Map(input.promoters.map(p => [p.matricula, p])).values()).filter(p => p.status === 'ativo').map(p => {
    const allSchedules = input.schedules.filter(s => s.promotor_matricula === p.matricula && s.dia_semana === day && s.ativo && (!s.valid_from || s.valid_from <= input.date) && (!s.valid_to || s.valid_to >= input.date));
    const schedules = allSchedules.some(s => s.is_exception) ? allSchedules.filter(s => s.is_exception) : allSchedules;
    if (schedules.length > 1) throw new Error(`Expedientes sobrepostos para a matrícula ${p.matricula}. Corrija a vigência antes de classificar.`);
    const schedule = schedules[0];
    const timezone = schedule?.timezone || input.rules.timezone;
    const tolerance = schedule?.tolerance_minutes ?? input.rules.tolerance;
    const now = zoned(input.now, timezone);
    const absences = input.absences.filter(a => a.promotor_matricula === p.matricula && a.data_inicio <= input.date && a.data_fim >= input.date);
    const approved = absences.filter(a => a.data_aprovacao != null);
    if (new Set(approved.map(a => a.tipo)).size > 1) throw new Error(`Afastamentos conflitantes para a matrícula ${p.matricula}.`);
    const absence = approved[0] || absences.find(a => a.tipo === 'licenca_medica');
    const holidays = (input.holidays || []).filter(h => h.data === input.date && (!h.uf || h.uf === schedule?.work_uf) && (!h.cidade || h.cidade.toLocaleLowerCase('pt-BR') === schedule?.work_city?.toLocaleLowerCase('pt-BR')));
    const holidayLocationUnknown = (input.holidays || []).some(h => h.data===input.date && h.uf && (!schedule?.work_uf || h.uf===schedule.work_uf && h.cidade && !schedule.work_city));
    const specific = Math.max(-1, ...holidays.map(h => h.cidade ? 2 : h.uf ? 1 : 0));
    const applicableHolidays = holidays.filter(h => (h.cidade ? 2 : h.uf ? 1 : 0) === specific);
    if (new Set(applicableHolidays.map(h => h.behavior)).size > 1) throw new Error('Feriados com regras conflitantes na mesma localidade.');
    const holiday = applicableHolidays[0];
    // Visiting plans never create an employment journey.
    const scheduled = Boolean(schedule);
    const medicalAbsence = absence?.tipo === 'licenca_medica';
    const eligible = scheduled && (!absence || medicalAbsence) && holiday?.behavior !== 'off';
    const visits = input.visits.filter(v => v.promotor_matricula === p.matricula && v.data_visita === input.date);
    const checkIn = canonicalCheckIn(visits, input.now);
    const override = input.overrides.find(o => o.promotor_matricula === p.matricula && o.data_operacional === input.date);
    const absenceStatus: OperationalStatus = absence?.tipo === 'ferias' ? 'ferias' : absence?.tipo === 'folga' ? 'folga' : absence?.tipo === 'feriado' ? 'feriado' : 'afastamento';
    let operationalStatus: OperationalStatus = medicalAbsence ? absence!.data_aprovacao ? 'atestado_aprovado' : 'atestado_pendente' : absence ? absenceStatus : scheduled ? 'sem_registro' : 'sem_expediente';
    if (!absence && holiday?.behavior === 'off') operationalStatus = 'feriado';
    let detail = LABELS[operationalStatus];
    if (eligible && !absence) {
      if (input.date > now.date || (input.date === now.date && schedule && validTime(schedule.hora_inicio) && now.minutes < minutes(schedule.hora_inicio))) operationalStatus = 'aguardando_expediente';
      let end = schedule && validTime(schedule.hora_fim) ? minutes(schedule.hora_fim) : null;
      const start = schedule && validTime(schedule.hora_inicio) ? minutes(schedule.hora_inicio) : null;
      if (end != null && start != null && end < start) end += 1440;
      // No automatic absence without a known shift, tolerance, official operation and closing rule.
      if (!holidayLocationUnknown && input.official && input.officialStart && input.date >= input.officialStart && end != null && start != null && end > start && input.rules.close && tolerance != null) {
        const closing = Math.max(end, start + tolerance, minutes(input.rules.close));
        const elapsed = (Date.parse(now.date) - Date.parse(input.date)) / 86400000 * 1440 + now.minutes;
        if (elapsed >= closing) operationalStatus = 'falta_confirmada';
      }
      detail = operationalStatus === 'sem_registro' ? 'Sem check-in; falta não confirmada' : LABELS[operationalStatus];
    }
    if (checkIn) {
      const time = zoned(checkIn.started_at!, timezone);
      const elapsed = (Date.parse(time.date) - Date.parse(input.date)) / 86400000 * 1440 + time.minutes;
      operationalStatus = eligible && schedule && validTime(schedule.hora_inicio) && tolerance != null && elapsed > minutes(schedule.hora_inicio) + tolerance ? 'atrasado' : 'presente';
      detail = `${eligible ? 'Check-in registrado' : 'Check-in fora da jornada'} • ${locationDetail({ ...checkIn, accuracy: checkIn.gps_accuracy_meters })}`;
      if (absence && !medicalAbsence) { operationalStatus = absenceStatus; detail += ' • Registro durante ausência aprovada: revisar'; }
      if (!absence && holiday?.behavior === 'off') { operationalStatus = 'feriado'; detail += ' • Registro em feriado sem expediente: revisar'; }
    } else if (visits.some(v => v.status === 'concluida' || v.status === 'em_andamento')) {
      detail += ' • Visita sem horário de check-in válido';
    }
    if (medicalAbsence) {
      if (!checkIn) operationalStatus = absence!.data_aprovacao ? 'atestado_aprovado' : 'atestado_pendente';
      if (checkIn) detail += ` • ${LABELS[absence!.data_aprovacao ? 'atestado_aprovado' : 'atestado_pendente']}`;
    }
    // Overrides change the classification, never the recorded check-in or its telemetry.
    if (override) {
      if (!checkIn || !override.override_status.startsWith('atestado_')) operationalStatus = override.override_status === 'falta' ? 'falta_confirmada' : override.override_status;
      if (!checkIn) detail = 'Sem check-in original';
      detail += ` • Ajuste manual: ${LABELS[override.override_status === 'falta' ? 'falta_confirmada' : override.override_status]}`;
    }
    const status: AttendanceItem['status'] = operationalStatus === 'presente' || operationalStatus === 'atrasado' ? 'presente' : operationalStatus === 'falta_confirmada' ? 'falta' : operationalStatus.startsWith('atestado_') ? 'atestado' : 'sem_registro';
    const medicalStatus: PresenceItem['medicalStatus'] = override?.override_status.startsWith('atestado_') ? override.override_status === 'atestado_aprovado' ? 'aprovado' : 'pendente' : medicalAbsence ? absence!.data_aprovacao ? 'aprovado' : 'pendente' : null;
    if (holidayLocationUnknown) detail += ' • Localidade de trabalho pendente: feriados locais não avaliados; falta automática bloqueada';
    return { id: p.id, promoterId: p.id, name: p.nome, initials: p.nome.split(/\s+/).filter(Boolean).map(n => n[0]).slice(0, 2).join(''), matricula: p.matricula, squad: p.equipe || 'Sem equipe', supervisor: resolveSupervisor(p, input.teams, input.supervisors), city: p.cidade || 'Não informada', state: p.uf || '', phone: p.telefone || undefined, status, operationalStatus, eligible, medicalStatus, scheduleDetail: schedule ? `${schedule.hora_inicio.slice(0,5)}–${schedule.hora_fim.slice(0,5)} (${timezone})` : 'Jornada não cadastrada', checkInAt: checkIn?.started_at || null, telemetryTime: checkIn ? zoned(checkIn.started_at!, timezone).time : '--:--', telemetryDetail: detail, medicalDays: override?.medical_days || undefined };
  }).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}
export function filterRoster(items: PresenceItem[], filters: { search: string; supervisor: string; squad: string; quick: string; offSchedule?: boolean }) {
  const search = filters.search.trim().toLocaleLowerCase('pt-BR');
  return items.filter(i => (filters.offSchedule || filters.quick === 'sem_expediente' || filters.quick === 'folga' || i.eligible) && (!search || [i.name, i.matricula, i.city].some(v => v.toLocaleLowerCase('pt-BR').includes(search))) && (!filters.supervisor || i.supervisor === filters.supervisor) && (!filters.squad || i.squad === filters.squad) && (filters.quick === 'all' || (filters.quick === 'atestado_pendente' ? i.medicalStatus === 'pendente' : filters.quick === 'atestado' ? Boolean(i.medicalStatus) : filters.quick === 'sem_expediente' ? i.operationalStatus === 'sem_expediente' : i.status === filters.quick)));
}
export function exportRows(items: PresenceItem[], date: string) {
  return items.map(i => ({ Data: date, Promotor: i.name, Matrícula: i.matricula, Equipe: i.squad, Supervisor: i.supervisor, Status: LABELS[i.operationalStatus], Atestado: i.medicalStatus || '', Jornada: i.scheduleDetail || '', Elegível: i.eligible ? 'Sim' : 'Não', 'Check-in original': i.checkInAt || '', Horário: i.telemetryTime, Telemetria: i.telemetryDetail }));
}
