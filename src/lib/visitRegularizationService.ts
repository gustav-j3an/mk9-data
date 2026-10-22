import { supabase } from './supabase';

export type VisitRegularizationAction =
  | 'closed_without_execution_proof'
  | 'administratively_completed_with_proof';

// Flip only after the migration is deployed and its auth, scope and concurrency
// tests have passed in the target environment.
export const VISIT_REGULARIZATION_BACKEND_VERIFIED = false;

export interface VisitRegularizationRpc {
  (name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
}

const GENERIC_REASONS = new Set(['ok', 'okay', 'teste', 'test', 'na', 'n/a', 'sem motivo', 'motivo', 'regularizacao']);

export function validateRegularizationReason(reason: string): string {
  const normalized = reason.trim().replace(/\s+/g, ' ');
  const comparable = normalized.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  if (normalized.length < 10 || GENERIC_REASONS.has(comparable) || /^(.)\1+$/.test(comparable)) {
    throw new Error('Descreva o motivo da análise com pelo menos 10 caracteres e sem justificativa genérica.');
  }
  return normalized;
}

export function isRegularizationReasonValid(reason: string): boolean {
  try {
    validateRegularizationReason(reason);
    return true;
  } catch {
    return false;
  }
}

export function regularizationErrorMessage(message?: string): string {
  const normalized = (message || '').toLocaleLowerCase('en');
  if (normalized.includes('insufficient existing evidence')) {
    return 'Não há evidências suficientes para concluir administrativamente. É necessária uma foto e um item de checklist respondido.';
  }
  if (normalized.includes('already regularized') || normalized.includes('duplicate key')) {
    return 'Esta visita já foi regularizada. Atualize a lista para ver a situação atual.';
  }
  if (normalized.includes('outside authorised supervisor scope') || normalized.includes('authorised administrator or supervisor')) {
    return 'Seu perfil não tem autorização para regularizar esta visita.';
  }
  if (normalized.includes('old open visit') || normalized.includes('visit not found')) {
    return 'Esta visita não está mais disponível para regularização. Atualize a lista e tente novamente.';
  }
  if (normalized.includes('reason') || normalized.includes('descriptive')) {
    return 'Descreva o motivo da análise com pelo menos 10 caracteres e sem justificativa genérica.';
  }
  if (normalized.includes('could not find the function') || normalized.includes('pgrst202')) {
    return 'A regularização ainda não está disponível no backend validado.';
  }
  return 'Não foi possível regularizar a visita. Atualize a lista ou procure um administrador.';
}

export async function submitVisitRegularization(
  rpc: VisitRegularizationRpc,
  visitId: string,
  action: VisitRegularizationAction,
  reason: string,
  backendVerified = VISIT_REGULARIZATION_BACKEND_VERIFIED
): Promise<unknown> {
  if (!backendVerified) throw new Error('A regularização aguarda a validação do backend.');
  if (!visitId) throw new Error('Visita inválida.');
  const validatedReason = validateRegularizationReason(reason);
  const { data, error } = await rpc('attendance_regularize_visit', {
    p_visit_id: visitId,
    p_action: action,
    p_reason: validatedReason
  });
  if (error) throw new Error(regularizationErrorMessage(error.message));
  return data;
}

export function regularizeOldOpenVisit(
  visitId: string,
  action: VisitRegularizationAction,
  reason: string
): Promise<unknown> {
  if (!supabase) return Promise.reject(new Error('Cliente Supabase não inicializado.'));
  const client = supabase;
  return submitVisitRegularization(
    (name, args) => client.rpc(name, args),
    visitId,
    action,
    reason
  );
}
