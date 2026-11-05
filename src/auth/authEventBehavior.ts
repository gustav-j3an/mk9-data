export function shouldKeepAuthenticatedViewMountedOnAuthEvent(
  event: string,
  previousUserId: string | null,
  nextUserId: string | null
): boolean {
  // A same-user token refresh changes credentials, not the user's identity or authorization boundary.
  return event === 'TOKEN_REFRESHED'
    && previousUserId !== null
    && previousUserId === nextUserId;
}
