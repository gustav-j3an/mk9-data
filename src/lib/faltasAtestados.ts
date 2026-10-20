export interface CrmBinding {
  promotor_id: string;
  matricula_interna: string;
  colaborador: string;
  equipe: string;
  supervisor: string;
  cidade: string;
  uf: string;
  identidade_status: string;
  alocacao_id: string;
  projeto_crm: string;
  matricula_externa: string;
  alocacao_status: string;
  ocorrencias_desde: string;
  ocorrencias_ate: string | null;
  valido_desde: string;
  valido_ate: string | null;
}

export interface AbsenceDraft {
  alocacaoId: string;
  tipo: string;
  inicio: string;
  fim: string;
  retorno: string;
  empresa: string;
  supervisor: string;
  localidade: string;
  loja: string;
  motivo: string;
  informacoes: string;
}

export const externalWriteEnabled = false as const;
export const reviewNotSent = 'Não enviado — integração com CRM aguardando homologação.';
export const absenceTypes = ['Falta', 'Atestado'] as const;

export function hasPreparePermission(value: unknown): value is true {
  return value === true;
}

export function isDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function isBindingSelectable(binding: CrmBinding, now = new Date()): boolean {
  if (binding.identidade_status !== 'aprovado' || binding.alocacao_status !== 'aprovado') return false;
  const start = Date.parse(binding.valido_desde);
  const end = binding.valido_ate ? Date.parse(binding.valido_ate) : Number.POSITIVE_INFINITY;
  return Number.isFinite(start) && start <= now.getTime() && now.getTime() < end;
}

export function resolveBinding(bindings: CrmBinding[], alocacaoId: string): CrmBinding | null {
  const matches = bindings.filter(binding => binding.alocacao_id === alocacaoId);
  return matches.length === 1 ? matches[0] : null;
}

export function inclusiveDays(start: string, end: string): number | null {
  if (!isDateOnly(start) || !isDateOnly(end) || end < start) return null;
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
}

export function isOccurrenceWithinBinding(binding: CrmBinding, start: string, end: string): boolean {
  if (!isDateOnly(start) || !isDateOnly(end) || end < start) return false;
  if (start < binding.ocorrencias_desde || (binding.ocorrencias_ate && end > binding.ocorrencias_ate)) return false;
  const startAt = Date.parse(`${start}T00:00:00.000Z`);
  const endAt = Date.parse(`${end}T23:59:59.999Z`);
  const validFrom = Date.parse(binding.valido_desde);
  const validUntil = binding.valido_ate ? Date.parse(binding.valido_ate) : Number.POSITIVE_INFINITY;
  return Number.isFinite(validFrom) && startAt >= validFrom && endAt < validUntil;
}

export function validateAbsenceDraft(draft: AbsenceDraft, binding: CrmBinding | null): string[] {
  const errors: string[] = [];
  if (!binding || !isBindingSelectable(binding)) errors.push('Selecione um vínculo CRM aprovado e vigente.');
  if (!(absenceTypes as readonly string[]).includes(draft.tipo)) errors.push('Selecione falta ou atestado.');
  if (!isDateOnly(draft.inicio) || !isDateOnly(draft.fim) || draft.fim < draft.inicio) errors.push('Informe um período válido.');
  if (!isDateOnly(draft.retorno) || (isDateOnly(draft.fim) && draft.retorno < draft.fim)) errors.push('Informe uma previsão de retorno igual ou posterior ao fim do período.');
  if (!draft.empresa.trim()) errors.push('Informe a empresa.');
  if (!draft.supervisor.trim()) errors.push('Informe o supervisor.');
  if (!draft.localidade.trim()) errors.push('Informe a localidade.');
  if (binding && isDateOnly(draft.inicio) && isDateOnly(draft.fim) && !isOccurrenceWithinBinding(binding, draft.inicio, draft.fim)) errors.push('O período está fora da janela de ocorrências ou da vigência do vínculo CRM.');
  return errors;
}
