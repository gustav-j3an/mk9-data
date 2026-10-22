interface QueryResult<T> {
  data: T[];
  error: unknown | null;
}

type WhatsAppQuery = <T>(
  queryWithLink: () => Promise<QueryResult<T>>,
  queryWithoutLink: () => Promise<QueryResult<T>>,
  onFallback?: (error: unknown) => void
) => Promise<QueryResult<T> & { usedWhatsAppFallback: boolean }>;

export function isMissingWhatsAppGroupLinkColumn(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const details = error as { code?: unknown; message?: unknown; details?: unknown };
  const message = [details.message, details.details]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
  return (details.code === '42703' || details.code === 'PGRST204') && /whatsapp_group_link/i.test(message);
}

export function createWhatsAppGroupLinkQueryCompatibility(): WhatsAppQuery {
  let schemaSupportsLink: boolean | undefined;
  let schemaProbe: Promise<QueryResult<unknown>> | null = null;

  const run = async <T>(
    queryWithLink: () => Promise<QueryResult<T>>,
    queryWithoutLink: () => Promise<QueryResult<T>>,
    onFallback?: (error: unknown) => void
  ): Promise<QueryResult<T> & { usedWhatsAppFallback: boolean }> => {
    if (schemaSupportsLink === true) {
      return { ...(await queryWithLink()), usedWhatsAppFallback: false };
    }
    if (schemaSupportsLink === false) {
      return { ...(await queryWithoutLink()), usedWhatsAppFallback: true };
    }

    if (schemaProbe) {
      await schemaProbe;
      if (schemaSupportsLink === false) {
        return { ...(await queryWithoutLink()), usedWhatsAppFallback: true };
      }
      if (schemaSupportsLink === true) {
        return { ...(await queryWithLink()), usedWhatsAppFallback: false };
      }
      // A transient or unrelated first error did not establish schema support.
      return run(queryWithLink, queryWithoutLink, onFallback);
    }

    const probe = queryWithLink();
    schemaProbe = probe as Promise<QueryResult<unknown>>;
    try {
      const result = await probe;
      if (isMissingWhatsAppGroupLinkColumn(result.error)) {
        schemaSupportsLink = false;
        onFallback?.(result.error);
        return { ...(await queryWithoutLink()), usedWhatsAppFallback: true };
      }
      if (!result.error) schemaSupportsLink = true;
      return { ...result, usedWhatsAppFallback: false };
    } finally {
      if (schemaProbe === probe) schemaProbe = null;
    }
  };

  return run;
}

// The capability is stable for the lifetime of this app tab. After the first
// confirmed schema mismatch, subsequent portal refreshes skip the failing read.
export const fetchWithOptionalWhatsAppGroupLink = createWhatsAppGroupLinkQueryCompatibility();
