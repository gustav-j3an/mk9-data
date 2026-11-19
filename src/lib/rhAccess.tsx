import React, { createContext, useContext, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
export type RhView = 'mine' | 'team' | 'management';
interface RhAccess { mine: boolean; team: boolean; management: boolean; loading: boolean }
const denied: RhAccess = { mine: false, team: false, management: false, loading: false };
const Context = createContext<RhAccess>(denied);
export const useRhAccess = () => useContext(Context);
export function RhAccessProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const [state, setState] = useState<{ userId: string; access: RhAccess } | null>(null);
  const userId = session?.user.id || '';
  const token = session?.access_token || '';
  useEffect(() => {
    if (!token || !userId) { setState({ userId, access: denied }); return; }
    const controller = new AbortController();
    setState((previous) => ({ userId, access: previous?.userId === userId ? previous.access : { ...denied, loading: true } }));
    const timeout = setTimeout(() => controller.abort(), 8000);
    void fetch('/api/rh/acessos', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal })
      .then(async res => { if (!res.ok) throw new Error(); return res.json(); })
      .then(body => { if (!controller.signal.aborted) setState({ userId, access: { mine: body.mine === true, team: body.team === true, management: body.management === true, loading: false } }); })
      .catch(() => { if (!controller.signal.aborted) setState((previous) => ({ userId, access: previous?.userId === userId ? previous.access : denied })); })
      .finally(() => clearTimeout(timeout));
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [token, userId]);
  const access = state?.userId === userId ? state.access : userId ? { ...denied, loading: true } : denied;
  return <Context.Provider value={access}>{children}</Context.Provider>;
}
