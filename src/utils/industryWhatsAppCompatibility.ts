import { isMissingWhatsAppGroupLinkColumn } from './promoterPortalQueryCompatibility';

interface MutationResult {
  error: { code?: string; message?: string; details?: string } | null;
}

export function omitWhatsAppGroupLink<T extends { whatsapp_group_link?: unknown }>(payload: T): Omit<T, 'whatsapp_group_link'> {
  const { whatsapp_group_link, ...legacyPayload } = payload;
  void whatsapp_group_link;
  return legacyPayload;
}

export async function writeWithOptionalWhatsAppGroupLink(
  writeWithLink: () => PromiseLike<MutationResult>,
  writeWithoutLink: () => PromiseLike<MutationResult>,
  onFallback?: (error: unknown) => void
): Promise<MutationResult & { usedWhatsAppFallback: boolean }> {
  const result = await writeWithLink();
  if (!isMissingWhatsAppGroupLinkColumn(result.error)) return { ...result, usedWhatsAppFallback: false };
  onFallback?.(result.error);
  return { ...(await writeWithoutLink()), usedWhatsAppFallback: true };
}
