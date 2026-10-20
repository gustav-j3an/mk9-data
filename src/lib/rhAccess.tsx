import React, { createContext, useContext, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
export type RhView = 'mine' | 'team' | 'management';
interface RhAccess { mine: boolean; team: boolean; management: boolean }
const denied: RhAccess = { mine: false, team: false, management: false };
const Context = createContext<RhAccess>(denied);
export const useRhAccess = () => useContext(Context);
export function RhAccessProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const [state, setState] = useState<{ token: string; access: RhAccess } | null>(null);
  const token = session?.access_token || '';
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    void fetch('/api/rh/acessos', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal })
      .then(async res => { if (!res.ok) throw new Error(); return res.json(); })
      .then(body => { if (!controller.signal.aborted) setState({ token, access: { mine: body.mine === true, team: body.team === true, management: body.management === true } }); })
      .catch(() => { if (!controller.signal.aborted) setState({ token, access: denied }); })
      .finally(() => clearTimeout(timeout));
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [token]);
  return <Context.Provider value={state?.token === token ? state.access : denied}>{children}</Context.Provider>;
}
