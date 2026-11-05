export const SESSION_RESTORE_TIMEOUT_MS = 12_000;
export const PROFILE_RESTORE_TIMEOUT_MS = 12_000;

export function settleWithin<T>(
  operation: PromiseLike<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    Promise.resolve(operation).then(resolve, reject).finally(() => clearTimeout(timeout));
  });
}
