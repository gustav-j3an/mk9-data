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
  const [state, setState] = useState<{ token: string; access: AccessState } | null>(null);

  useEffect(() => {
    let active = true;
    if (!token || !supabase) { setState({ token, access: denied }); return; }
    setState({ token, access: { loading: true, allowed: false } });
    void (async () => {
      try {
        const { data, error } = await supabase.rpc('mk9_faltas_atestados_can_prepare');
        if (active) setState({ token, access: { loading: false, allowed: !error && hasPreparePermission(data) } });
      } catch {
        if (active) setState({ token, access: denied });
      }
    })();
    return () => { active = false; };
  }, [token]);

  const access = state?.token === token ? state.access : denied;
  return <Context.Provider value={access}>{children}</Context.Provider>;
}
