import React, { createContext, useContext, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from './supabase';
import { hasPreparePermission } from './faltasAtestados';

interface AccessState { loading: boolean; allowed: boolean }
const denied: AccessState = { loading: false, allowed: false };
const Context = createContext<AccessState>(denied);
export const useFaltasAtestadosAccess = () => useContext(Context);

export function FaltasAtestadosAccessProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const token = session?.access_token || '';
  const [state, setState] = useState<{ userId: string; access: AccessState } | null>(null);
  const userId = session?.user.id || '';

  useEffect(() => {
    let active = true;
    if (!token || !userId || !supabase) { setState({ userId, access: denied }); return; }
    setState((previous) => ({ userId, access: previous?.userId === userId ? previous.access : { loading: true, allowed: false } }));
    void (async () => {
      try {
        const { data, error } = await supabase.rpc('mk9_faltas_atestados_can_prepare');
        if (active) setState({ userId, access: { loading: false, allowed: !error && hasPreparePermission(data) } });
      } catch {
        if (active) setState((previous) => ({ userId, access: previous?.userId === userId ? previous.access : denied }));
      }
    })();
    return () => { active = false; };
  }, [token, userId]);

  const access = state?.userId === userId ? state.access : userId ? { loading: true, allowed: false } : denied;
  return <Context.Provider value={access}>{children}</Context.Provider>;
}
