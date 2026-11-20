export function getScheduledVisitRpcErrorMessage(error: { code?: unknown; message?: unknown } | null | undefined): string {
  const message = typeof error?.message === 'string' ? error.message : '';
  if (message.includes('This scheduled occurrence already has an execution')) {
    return 'Esta ocorrência já possui um atendimento registrado. Atualize a agenda para conferir o estado mais recente.';
  }
  if (message.includes('Only a cancelled or automatically closed attempt can be retried')) {
    return 'Esta visita não está elegível para recuperação.';
  }
  if (message.includes('A completed occurrence cannot be recovered again')) {
    return 'Uma ocorrência concluída não pode ser recuperada novamente.';
  }
  if (message.includes('A visit for this store and industry already exists today')) {
    return 'Já existe um atendimento para esta loja e indústria na data operacional atual.';
  }
  if (message.includes('Já existe um atendimento para esta loja e indústria na data operacional atual.')) {
    return message;
  }
  if (message.includes('Another visit is in progress')) {
    return 'Finalize o atendimento atual antes de iniciar outra visita.';
  }
  if (error?.code === '23505') {
    return 'A ocorrência não pode ser iniciada novamente. Atualize a agenda e tente de novo se ela continuar elegível.';
  }
  return 'Não foi possível confirmar a programação no servidor. Atualize a agenda e tente novamente.';
}
