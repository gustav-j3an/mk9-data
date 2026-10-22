import type { DayOfWeekDate } from './routePlanner';

export const PAST_DUE_WINDOW_DAYS = 90;

export function selectPastVisitsFromAgenda<T extends { data_visita: string }>(visits: readonly T[], todayStr: string): T[] {
  return visits.filter((visit) => visit.data_visita < todayStr);
}

const DAY_KEYS: DayOfWeekDate['dayKey'][] = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
const DAY_LABELS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

export function getOperationalDateRange(todayStr: string, daysBack = PAST_DUE_WINDOW_DAYS): DayOfWeekDate[] {
  const [year, month, day] = todayStr.split('-').map(Number);
  const today = new Date(Date.UTC(year, month - 1, day, 12));
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - daysBack);
  const range: DayOfWeekDate[] = [];
  for (let current = new Date(start); current <= today; current.setUTCDate(current.getUTCDate() + 1)) {
    const dateStr = `${current.getUTCFullYear()}-${String(current.getUTCMonth() + 1).padStart(2, '0')}-${String(current.getUTCDate()).padStart(2, '0')}`;
    const dayIndex = current.getUTCDay();
    range.push({ dateStr, dayKey: DAY_KEYS[dayIndex], dayLabel: DAY_LABELS[dayIndex], dayShort: DAY_LABELS[dayIndex].slice(0, 3), isToday: dateStr === todayStr, isPast: dateStr < todayStr, isFuture: false });
  }
  return range;
}

export function getCurrentWeekBounds(todayStr: string): { start: string; end: string } {
  const [year, month, day] = todayStr.split('-').map(Number);
  const today = new Date(Date.UTC(year, month - 1, day, 12));
  const dayFromMonday = (today.getUTCDay() + 6) % 7;
  const monday = new Date(today);
  monday.setUTCDate(monday.getUTCDate() - dayFromMonday);
  const sunday = new Date(monday);
  sunday.setUTCDate(sunday.getUTCDate() + 6);
  const toDateStr = (date: Date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
  return { start: toDateStr(monday), end: toDateStr(sunday) };
}

export function getDaysLate(dateStr: string, todayStr: string): number {
  const parse = (value: string) => {
    const [year, month, day] = value.split('-').map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.max(0, Math.round((parse(todayStr) - parse(dateStr)) / 86400000));
}
