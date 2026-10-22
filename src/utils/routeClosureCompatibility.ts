interface RouteQueryResult<T> {
  data: T[];
  error: unknown | null;
}

type RouteQuery = <T>(query: (filterByClosure: boolean) => Promise<RouteQueryResult<T>>) => Promise<
  RouteQueryResult<T> & { usedClosureFallback: boolean; closureFallbackError?: unknown }
>;

export function isMissingRouteClosureColumn(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const details = error as { code?: unknown; message?: unknown; details?: unknown };
  const code = details.code;
  const message = [details.message, details.details]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
  return (code === '42703' || code === 'PGRST204') && /encerrada_em/i.test(message);
}

export function createRouteClosureCompatibility(): RouteQuery {
  let schemaSupportsClosure: boolean | undefined;
  let schemaProbe: Promise<RouteQueryResult<unknown>> | null = null;

  const run = async <T>(query: (filterByClosure: boolean) => Promise<RouteQueryResult<T>>) => {
    if (schemaSupportsClosure === true) {
      return { ...(await query(true)), usedClosureFallback: false };
    }
    if (schemaSupportsClosure === false) {
      return { ...(await query(false)), usedClosureFallback: true };
    }

    if (schemaProbe) {
      await schemaProbe;
      if (schemaSupportsClosure === false) {
        return { ...(await query(false)), usedClosureFallback: true };
      }
      if (schemaSupportsClosure === true) {
        return { ...(await query(true)), usedClosureFallback: false };
      }
      return run(query);
    }

    const probe = query(true);
    schemaProbe = probe as Promise<RouteQueryResult<unknown>>;
    try {
      const result = await probe;
      if (isMissingRouteClosureColumn(result.error)) {
        schemaSupportsClosure = false;
        return {
          ...(await query(false)),
          usedClosureFallback: true,
          closureFallbackError: result.error
        };
      }
      if (!result.error) schemaSupportsClosure = true;
      return { ...result, usedClosureFallback: false };
    } finally {
      if (schemaProbe === probe) schemaProbe = null;
    }
  };

  return run;
}

// Keep the confirmed capability for this app tab so refreshes don't repeat
// the same undefined-column request against the API.
export const loadRoutesWithClosureFallback = createRouteClosureCompatibility();
