import { supabase } from './supabase';

export interface VisitCancellationRpc {
  (name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
}

const GENERIC_REASONS = new Set(['ok', 'okay', 'teste', 'test', 'na', 'n/a', 'sem motivo', 'motivo', 'regularizacao']);

export function validateVisitCancellationReason(reason: string): string {
  const normalized = reason.trim().replace(/\s+/g, ' ');
  const comparable = normalized.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  if (normalized.length < 10 || normalized.length > 1000 || GENERIC_REASONS.has(comparable) || /^(.)\1+$/.test(comparable)) {
    throw new Error('Informe uma justificativa específica com pelo menos 10 caracteres.');
  }
  return normalized;
}

export async function submitVisitCancellation(
  rpc: VisitCancellationRpc,
  visitId: string,
  reason: string
): Promise<unknown> {
  if (!visitId.trim()) throw new Error('Visita inválida.');
  const validatedReason = validateVisitCancellationReason(reason);
  const { data, error } = await rpc('attendance_cancel_visit', {
    p_visit_id: visitId,
    p_reason: validatedReason
  });
  if (error) {
    const message = error.message?.toLocaleLowerCase('en') || '';
    if (message.includes('visit not authorised') || message.includes('visit not found')) {
      throw new Error('Esta visita não pertence ao seu usuário ou não está mais disponível para cancelamento.');
    }
    if (message.includes('visit is not active') || message.includes('already completed') || message.includes('already cancelled')) {
      throw new Error('A visita já foi encerrada. Atualize a tela para ver o status atual.');
    }
    if (message.includes('reason')) throw new Error('Informe uma justificativa específica com pelo menos 10 caracteres.');
    throw new Error('Não foi possível cancelar a visita. Atualize a tela e tente novamente.');
  }
  return data;
}

export function cancelVisit(visitId: string, reason: string): Promise<unknown> {
  if (!supabase) return Promise.reject(new Error('Cliente Supabase não inicializado.'));
  const client = supabase;
  return submitVisitCancellation((name, args) => client.rpc(name, args), visitId, reason);
}
