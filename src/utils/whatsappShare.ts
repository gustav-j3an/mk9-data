import type { Visit } from '../types';

/**
 * Valida se um link informado corresponde a um convite legítimo de grupo do WhatsApp.
 * Aceita:
 * - https://chat.whatsapp.com/...
 * - chat.whatsapp.com/...
 */
export function isValidWhatsAppGroupLink(url?: string | null): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;

  try {
    const parsed = trimmed.startsWith('http://') || trimmed.startsWith('https://')
      ? new URL(trimmed)
      : new URL(`https://${trimmed}`);

    return (
      (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
      parsed.hostname.toLowerCase() === 'chat.whatsapp.com' &&
      parsed.pathname.length > 1
    );
  } catch {
    return false;
  }
}

/**
 * Formata a data ISO YYYY-MM-DD para DD/MM/YYYY
 */
export function formatDateBR(dateStr?: string | null): string {
  if (!dateStr) return '—';
  const clean = dateStr.slice(0, 10);
  const parts = clean.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateStr;
}

/**
 * Formata um timestamp ISO para o formato de hora HH:mm
 */
export function formatTimeBR(isoStr?: string | null): string {
  if (!isoStr) return '—';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
}

/**
 * Monta o texto limpo, enxuto e profissional para compartilhamento via WhatsApp
 * NUNCA inventa dados e NÃO insere links assinados no corpo da mensagem.
 */
export function buildWhatsAppReportText(visit: Visit): string {
  const lines: string[] = [];

  // Cabeçalho
  lines.push('📋 *RELATÓRIO DE VISITA — MK9 DATE*');
  lines.push('');

  // Dados Principais
  const industriaNome = visit.industria?.nome || visit.industria_codigo || 'Não informada';
  const lojaNome = visit.loja?.nome || visit.loja_codigo || 'Não informada';
  const promotorNome = visit.promotor?.nome || visit.promotor_matricula || 'Não informado';
  const dataVisita = formatDateBR(visit.data_visita);
  const entrada = formatTimeBR(visit.started_at);
  const saida = formatTimeBR(visit.completed_at);

  lines.push(`🏭 *Indústria:* ${industriaNome}`);
  lines.push(`🏪 *Loja:* ${lojaNome}`);
  lines.push(`📅 *Data:* ${dataVisita}`);
  lines.push(`👤 *Promotor:* ${promotorNome}`);
  lines.push(`⏰ *Horário:* ${entrada} às ${saida}`);

  // Status
  const statusFormatado =
    visit.status === 'concluida'
      ? '✅ Concluída'
      : visit.status === 'em_andamento'
      ? '⏳ Em andamento'
      : visit.status === 'nao_realizada'
      ? '❌ Não realizada'
      : '⚪ Pendente';
  lines.push(`📌 *Status:* ${statusFormatado}`);

  if (visit.status === 'nao_realizada' && visit.motivo_nao_realizada) {
    lines.push(`⚠️ *Motivo:* ${visit.motivo_nao_realizada}`);
  }

  // Resumo do Checklist
  if (visit.checklist_items && visit.checklist_items.length > 0) {
    lines.push('');
    lines.push('📦 *Checklist Operacional:*');
    visit.checklist_items.forEach((item) => {
      const valor = item.valor_texto !== null && item.valor_texto !== undefined && item.valor_texto.trim() !== ''
        ? `${item.valor_texto} un.`
        : item.checked ? 'Sim' : 'Não';
      lines.push(`  • ${item.item_label || item.item_key}: ${valor}`);
    });
  }

  // Ocorrências e Rupturas
  if (visit.occurrences && visit.occurrences.length > 0) {
    lines.push('');
    lines.push(`🚨 *Ocorrências / Rupturas (${visit.occurrences.length}):*`);
    visit.occurrences.forEach((occ) => {
      const tipo = occ.tipo.replace('_', ' ').toUpperCase();
      const status = occ.resolvido ? 'Resolvido' : 'Pendente';
      lines.push(`  • [${tipo}] ${occ.descricao} (${status})`);
    });
  }

  // Controle de Validades
  if (visit.validity_items && visit.validity_items.length > 0) {
    lines.push('');
    lines.push(`⏳ *Controle de Validades (${visit.validity_items.length}):*`);
    visit.validity_items.forEach((val) => {
      const dataVenc = formatDateBR(val.data_vencimento);
      lines.push(`  • ${val.produto_nome}: ${val.quantidade} un. — Vence: ${dataVenc}`);
    });
  }

  // Fotos disponíveis
  if (visit.photos && visit.photos.length > 0) {
    lines.push('');
    lines.push(`📸 *Evidências Fotográficas:* ${visit.photos.length} foto(s) anexada(s)`);
  }

  // Observações Gerais
  if (visit.observacao_geral && visit.observacao_geral.trim()) {
    lines.push('');
    lines.push(`📝 *Observações:* ${visit.observacao_geral.trim()}`);
  }

  return lines.join('\n');
}

/**
 * Converte o texto do relatório em link wa.me para abertura web/app direta
 */
export function buildWhatsAppWebUrl(text: string, phone?: string | null): string {
  const encodedText = encodeURIComponent(text);
  const cleanPhone = phone ? phone.replace(/\D/g, '') : '';
  if (cleanPhone) {
    return `https://wa.me/${cleanPhone}?text=${encodedText}`;
  }
  return `https://wa.me/?text=${encodedText}`;
}

/**
 * Validação de suporte da Web Share API no ambiente atual
 */
export function canShareFiles(files: File[]): boolean {
  if (typeof navigator === 'undefined' || !navigator.share) {
    return false;
  }
  if (!navigator.canShare) {
    return false;
  }
  try {
    return navigator.canShare({ files });
  } catch {
    return false;
  }
}

/**
 * Executa o compartilhamento nativo através da Web Share API
 * Retorna:
 * - 'shared': sucesso
 * - 'canceled': cancelado pelo usuário
 * - 'unsupported': API ou compartilhamento de arquivo não suportado
 * - 'error': falha de execução
 */
export async function shareViaWebShare(
  data: { title: string; text: string; files?: File[] }
): Promise<'shared' | 'canceled' | 'unsupported' | 'error'> {
  if (typeof navigator === 'undefined' || !navigator.share) {
    return 'unsupported';
  }

  // Se houver arquivos, valida suporte prévio
  if (data.files && data.files.length > 0) {
    if (!navigator.canShare || !navigator.canShare({ files: data.files })) {
      return 'unsupported';
    }
  }

  try {
    await navigator.share({
      title: data.title,
      text: data.text,
      files: data.files && data.files.length > 0 ? data.files : undefined
    });
    return 'shared';
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return 'canceled';
    }
    console.warn('Erro ao invocar navigator.share:', err);
    return 'error';
  }
}

/**
 * Baixa um arquivo File gerando download direto no navegador
 */
export function triggerFileDownload(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
