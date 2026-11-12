type VisitStartError = {
  code?: unknown;
  message?: unknown;
};

export function getVisitStartErrorMessage(error: unknown): string {
  const details = error && typeof error === 'object' ? error as VisitStartError : {};
  const message = typeof details.message === 'string' ? details.message : '';
  const code = typeof details.code === 'string' ? details.code : '';

  if (!message) return 'Erro ao registrar check-in no servidor.';
  if (message.includes('Industry is not active or does not exist')) {
    return 'Esta indústria está inativa ou não foi encontrada. O check-in foi bloqueado.';
  }
  if (message.includes('row-level security') || code === '42501') {
    return 'Acesso não autorizado pelas regras do sistema para esta matrícula.';
  }
  if (message.includes('foreign key') || code === '23503') {
    return 'Dados da loja, indústria ou rota não encontrados no cadastro.';
  }
  if (message.includes('duplicate key') || code === '23505') {
    return 'Já existe um registro de visita ativo para esta loja e data.';
  }

  // Não expor mensagens internas, tokens, senhas ou URLs completas.
  return 'Não foi possível iniciar o atendimento. Tente novamente ou solicite apoio ao suporte.';
}
