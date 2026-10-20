/**
 * MK9 Date - Utilitário de Compartilhamento WhatsApp
 * Reconstrução sem dependência de API paga e sem envio automático.
 * Suporta navigator.share, fallback para texto e download de fotos.
 */

export interface VisitShareData {
  visitId: string;
  promotorNome?: string;
  promotorMatricula?: string;
  lojaNome?: string;
  lojaCodigo?: string;
  industriaNome?: string;
  industriaCodigo?: string;
  dataVisita: string;
  horaInicio?: string | null;
  horaFim?: string | null;
  status: string;
  observacoes?: string | null;
  resumoAtendimento?: string | null;
  fotos?: Array<{
    id?: string;
    url: string;
    tipo?: string;
    descricao?: string;
  }>;
  whatsappGroupLink?: string | null;
}

export interface ShareResult {
  success: boolean;
  action: 'native_share' | 'whatsapp_link' | 'clipboard_fallback' | 'canceled' | 'error';
  message?: string;
}

/**
 * Valida se um link é estritamente um link de convite oficial de grupo de WhatsApp.
 * Formato aceito: https://chat.whatsapp.com/[A-Za-z0-9_-]+
 * Rejeita: wa.me, whatsapp://, outros domínios ou links malformados.
 */
export function isValidWhatsAppGroupLink(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  const pattern = /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9_-]+$/;
  return pattern.test(trimmed);
}

/**
 * Sanitiza e valida o link de grupo, retornando a string limpa ou null se inválida.
 */
export function sanitizeWhatsAppGroupLink(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  return isValidWhatsAppGroupLink(trimmed) ? trimmed : null;
}

/**
 * Formata os dados da visita em mensagem de texto estruturada para WhatsApp.
 */
export function formatVisitReportText(data: VisitShareData): string {
  const parts: string[] = [];

  parts.push('*📋 RELATÓRIO DE VISITA — MK9 DATE*');
  parts.push('──────────────────────');

  if (data.industriaNome) {
    parts.push(`*Indústria:* ${data.industriaNome}${data.industriaCodigo ? ` (${data.industriaCodigo})` : ''}`);
  }
  if (data.lojaNome) {
    parts.push(`*Loja:* ${data.lojaNome}${data.lojaCodigo ? ` (${data.lojaCodigo})` : ''}`);
  }
  if (data.promotorNome) {
    parts.push(`*Promotor:* ${data.promotorNome}${data.promotorMatricula ? ` [${data.promotorMatricula}]` : ''}`);
  }

  // Data e Horário
  const dataFormatada = data.dataVisita ? data.dataVisita.split('-').reverse().join('/') : 'Não informada';
  parts.push(`*Data:* ${dataFormatada}`);

  if (data.horaInicio || data.horaFim) {
    const inicio = data.horaInicio ? data.horaInicio.slice(0, 5) : '--:--';
    const fim = data.horaFim ? data.horaFim.slice(0, 5) : '--:--';
    parts.push(`*Horário:* ${inicio} às ${fim}`);
  }

  parts.push(`*Status:* ${data.status ? data.status.toUpperCase() : 'CONCLUÍDA'}`);

  if (data.resumoAtendimento && data.resumoAtendimento.trim()) {
    parts.push('');
    parts.push('*Resumo do Atendimento:*');
    parts.push(data.resumoAtendimento.trim());
  }

  if (data.observacoes && data.observacoes.trim()) {
    parts.push('');
    parts.push('*Observações:*');
    parts.push(data.observacoes.trim());
  }

  const qtdFotos = data.fotos ? data.fotos.length : 0;
  if (qtdFotos > 0) {
    parts.push('');
    parts.push(`*Fotos registradas:* ${qtdFotos} foto(s) anexada(s)`);
  }

  parts.push('');
  parts.push('_Relatório gerado via MK9 Date Operacional_');

  return parts.join('\n');
}

/**
 * Faz download de uma foto via URL (blob seguro/mecanismo existente) e a converte em File.
 */
export async function fetchImageAsFile(url: string, filename: string): Promise<File> {
  const response = await fetch(url, { credentials: 'omit' });
  if (!response.ok) {
    throw new Error(`Falha ao obter imagem (${response.status})`);
  }
  const blob = await response.blob();
  const mimeType = blob.type || 'image/jpeg';
  return new File([blob], filename, { type: mimeType });
}

/**
 * Prepara a lista de arquivos de fotos a partir dos URLs autorizados.
 */
export async function preparePhotoFiles(
  fotos: Array<{ url: string; descricao?: string; id?: string }>
): Promise<File[]> {
  const files: File[] = [];
  for (let i = 0; i < fotos.length; i++) {
    const item = fotos[i];
    if (!item.url) continue;
    try {
      const ext = item.url.includes('.png') ? 'png' : 'jpg';
      const filename = `visita_foto_${i + 1}_${item.id || Date.now()}.${ext}`;
      const file = await fetchImageAsFile(item.url, filename);
      files.push(file);
    } catch (err) {
      console.warn(`[whatsappShare] Não foi possível carregar a imagem ${i + 1}:`, err);
    }
  }
  return files;
}

/**
 * Executa o compartilhamento da visita.
 * 1. Tenta navigator.share com arquivos (se suportado e houver fotos).
 * 2. Tenta navigator.share apenas com texto (se suportado).
 * 3. Fallback: abre api.whatsapp.com/send com o texto codificado.
 * Nunca considera a abertura do WhatsApp como confirmação de envio.
 */
export async function shareVisitReport(
  data: VisitShareData,
  options?: { photoFiles?: File[] }
): Promise<ShareResult> {
  const text = formatVisitReportText(data);
  const title = `Relatório de Visita - ${data.lojaNome || 'MK9 Date'}`;

  // 1. Tenta compartilhamento nativo com fotos
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    const files = options?.photoFiles;
    if (files && files.length > 0 && typeof navigator.canShare === 'function') {
      const shareDataWithFiles: ShareData = {
        title,
        text,
        files,
      };

      if (navigator.canShare(shareDataWithFiles)) {
        try {
          await navigator.share(shareDataWithFiles);
          return {
            success: true,
            action: 'native_share',
            message: 'Compartilhamento nativo aberto com sucesso.',
          };
        } catch (err: unknown) {
          if (err instanceof Error && err.name === 'AbortError') {
            return {
              success: false,
              action: 'canceled',
              message: 'Compartilhamento cancelado pelo usuário.',
            };
          }
          // Caso falhe por arquivos não aceitos, tenta o fallback sem arquivos abaixo
          console.warn('[whatsappShare] navigator.share com fotos falhou, tentando apenas texto:', err);
        }
      }
    }

    // 2. Tenta navigator.share apenas texto
    try {
      await navigator.share({ title, text });
      return {
        success: true,
        action: 'native_share',
        message: 'Compartilhamento nativo de texto aberto.',
      };
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        return {
          success: false,
          action: 'canceled',
          message: 'Compartilhamento cancelado pelo usuário.',
        };
      }
      console.warn('[whatsappShare] navigator.share de texto falhou:', err);
    }
  }

  // 3. Fallback para abertura direta via link web do WhatsApp
  try {
    const encodedText = encodeURIComponent(text);
    const whatsappWebUrl = `https://api.whatsapp.com/send?text=${encodedText}`;
    window.open(whatsappWebUrl, '_blank', 'noopener,noreferrer');
    return {
      success: true,
      action: 'whatsapp_link',
      message: 'WhatsApp aberto no navegador. Cole o relatório na conversa desejada.',
    };
  } catch (err) {
    return {
      success: false,
      action: 'error',
      message: 'Não foi possível abrir o WhatsApp automaticamente.',
    };
  }
}

/**
 * Abre o link do grupo da indústria no navegador.
 * Apenas abre a conversa/convite; não promete anexar automaticamente o relatório.
 */
export function openIndustryWhatsAppGroup(groupLink: string | null | undefined): boolean {
  if (!isValidWhatsAppGroupLink(groupLink)) {
    return false;
  }
  window.open(groupLink!.trim(), '_blank', 'noopener,noreferrer');
  return true;
}
