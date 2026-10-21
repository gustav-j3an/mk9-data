import type { AbsenceStatus } from '../../shared/mk9';
import { isBindingSelectable, isDateOnly, type CrmBinding } from './faltasAtestados';

export interface NormalizedCrmAbsence {
  externalRecordId: string | null; externalProtocol: string; projectId: string; externalMatricula: string;
  internalMatricula: string; personId: string; allocationId: string; collaboratorName: string; projectName: string;
  type: 'Falta' | 'Atestado' | 'Ausência'; startDate: string; endDate: string | null; returnDate: string | null;
  days: number | null; status: AbsenceStatus; supervisor: string;
}
export interface AbsenceHistoryDisplay {
  key: string; collaborator: string; internalMatricula: string; externalMatricula: string; project: string; projectId: string;
  type: NormalizedCrmAbsence['type']; period: string; days: string; status: AbsenceStatus; protocol: string; supervisor: string;
}
export interface ParsedAbsenceHistory { records: NormalizedCrmAbsence[]; display: AbsenceHistoryDisplay[]; updatedAt: string; unmatchedCount: number }
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string';
const statuses = new Set<AbsenceStatus>(['Em análise', 'Processado', 'Necessita atenção', 'Cancelado', 'Em processamento']);
const types = new Set<NormalizedCrmAbsence['type']>(['Falta', 'Atestado', 'Ausência']);

/** Converts the sanitized server DTO to a normalized record, then to a separate display projection. */
export function parseAbsenceHistory(value: unknown, bindings: CrmBinding[], now = new Date()): ParsedAbsenceHistory {
  if (!isObject(value) || !Array.isArray(value.data) || !text(value.updatedAt) || !Number.isFinite(Date.parse(value.updatedAt))) throw new Error('Resposta de histórico inválida.');
  const records = new Map<string, NormalizedCrmAbsence>();
  let unmatchedCount = 0;
  for (const item of value.data) {
    if (!isObject(item) || !isObject(item.externalIdentity)) throw new Error('Registro externo inválido.');
    const identity = item.externalIdentity;
    const { recordId, projectId, matricula: externalMatricula } = identity;
    const { matricula: internalMatricula, inicio, fim, retorno, tipo, status, dias } = item;
    if (!(recordId === null || text(recordId)) || ![projectId, externalMatricula, internalMatricula].every(text) || !text(item.protocolo) || (recordId === null && !item.protocolo) || !isDateOnly(inicio as string) ||
      (fim !== null && !isDateOnly(fim as string)) || (retorno !== null && !isDateOnly(retorno as string)) ||
      !text(item.protocolo) || !text(item.nome) || !text(item.projeto) || !text(tipo) || !types.has(tipo as NormalizedCrmAbsence['type']) ||
      !text(status) || !statuses.has(status as AbsenceStatus) || !(dias === null || (typeof dias === 'number' && Number.isFinite(dias) && dias >= 0))) throw new Error('Registro externo incompleto.');
    if (fim && (fim as string) < (inicio as string)) throw new Error('Período externo inválido.');
    const matches = bindings.filter(binding => binding.projeto_crm === projectId && binding.matricula_externa === externalMatricula && binding.matricula_interna === internalMatricula && isBindingSelectable(binding, now));
    if (matches.length !== 1) { unmatchedCount++; continue; }
    const binding = matches[0];
    const normalized: NormalizedCrmAbsence = {
      externalRecordId: recordId as string | null, externalProtocol: item.protocolo as string, projectId: projectId as string,
      externalMatricula: externalMatricula as string, internalMatricula: binding.matricula_interna, personId: binding.promotor_id,
      allocationId: binding.alocacao_id, collaboratorName: binding.colaborador, projectName: item.projeto,
      type: tipo as NormalizedCrmAbsence['type'], startDate: inicio as string, endDate: fim as string | null,
      returnDate: retorno as string | null, days: dias as number | null, status: status as AbsenceStatus, supervisor: binding.supervisor
    };
    const key = JSON.stringify([normalized.projectId, normalized.externalMatricula, normalized.externalRecordId || normalized.externalProtocol]);
    const previous = records.get(key);
    if (previous && JSON.stringify(previous) !== JSON.stringify(normalized)) throw new Error('Registro externo duplicado com conteúdo divergente.');
    records.set(key, normalized);
  }
  const normalizedRecords = [...records.values()];
  const display = normalizedRecords.map(record => ({
    key: JSON.stringify([record.projectId, record.externalMatricula, record.externalRecordId || record.externalProtocol]), collaborator: record.collaboratorName,
    internalMatricula: record.internalMatricula, externalMatricula: record.externalMatricula, project: record.projectName,
    projectId: record.projectId, type: record.type,
    period: record.endDate && record.endDate !== record.startDate ? `${record.startDate} a ${record.endDate}` : record.startDate,
    days: record.days === null ? 'Não informado' : `${record.days} ${record.days === 1 ? 'dia' : 'dias'}`,
    status: record.status, protocol: record.externalProtocol || record.externalRecordId || '', supervisor: record.supervisor
  }));
  return { records: normalizedRecords, display, updatedAt: value.updatedAt, unmatchedCount };
}

export function filterAbsenceHistory(records: NormalizedCrmAbsence[], filters: { start: string; end: string; projectId: string; type: string; matricula: string }): NormalizedCrmAbsence[] {
  if (!isDateOnly(filters.start) || !isDateOnly(filters.end) || filters.start > filters.end) return [];
  const search = filters.matricula.trim().toLocaleLowerCase('pt-BR');
  return records.filter(record => {
    const recordEnd = record.endDate || record.startDate;
    return record.startDate <= filters.end && recordEnd >= filters.start && (!filters.projectId || record.projectId === filters.projectId) &&
      (!filters.type || record.type === filters.type) && (!search || record.externalMatricula.toLocaleLowerCase('pt-BR').includes(search) || record.internalMatricula.toLocaleLowerCase('pt-BR').includes(search));
  });
}