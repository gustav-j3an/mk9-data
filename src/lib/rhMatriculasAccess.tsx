import React, { createContext, useContext, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from './supabase';

interface ReconciliationAccess { loading: boolean; allowed: boolean }
const denied: ReconciliationAccess = { loading: false, allowed: false };
const Context = createContext<ReconciliationAccess>(denied);
export const useRhMatriculasAccess = () => useContext(Context);

export function RhMatriculasAccessProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const token = session?.access_token || '';
  const [state, setState] = useState<{ token: string; access: ReconciliationAccess } | null>(null);

  useEffect(() => {
    let active = true;
    if (!token || !supabase) { setState({ token, access: denied }); return; }
    setState({ token, access: { loading: true, allowed: false } });
    void Promise.resolve(supabase.rpc('mk9_rh_reconciliation_can_manage')).then(({ data, error }) => {
      if (active) setState({ token, access: { loading: false, allowed: !error && data === true } });
    }).catch(() => { if (active) setState({ token, access: denied }); });
    return () => { active = false; };
  }, [token]);

  const access = state?.token === token ? state.access : token ? { loading: true, allowed: false } : denied;
  return <Context.Provider value={access}>{children}</Context.Provider>;
}
