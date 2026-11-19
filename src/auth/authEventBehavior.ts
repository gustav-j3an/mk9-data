export function shouldKeepAuthenticatedViewMountedOnAuthEvent(
  event: string,
  previousUserId: string | null,
  nextUserId: string | null
): boolean {
  // Same-user session updates do not change the authorization boundary. Keep the
  // mounted view while refreshed credentials and profile data are synchronized.
  const sameAuthenticatedUser = previousUserId !== null
    && previousUserId === nextUserId;
  return sameAuthenticatedUser
    && (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN' || event === 'USER_UPDATED');
}
