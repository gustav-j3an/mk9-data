export async function signOutAndNavigateToLogin(
  signOut: () => Promise<void>,
  clearTemporaryState: () => void,
  navigate: (path: '/login', options: { replace: true }) => void
): Promise<void> {
  await signOut();
  clearTemporaryState();
  navigate('/login', { replace: true });
}
