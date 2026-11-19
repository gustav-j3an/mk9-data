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
  const [state, setState] = useState<{ userId: string; access: ReconciliationAccess } | null>(null);
  const userId = session?.user.id || '';

  useEffect(() => {
    let active = true;
    if (!token || !userId || !supabase) { setState({ userId, access: denied }); return; }
    setState((previous) => ({ userId, access: previous?.userId === userId ? previous.access : { loading: true, allowed: false } }));
    void Promise.resolve(supabase.rpc('mk9_rh_reconciliation_can_manage')).then(({ data, error }) => {
      if (active) setState({ userId, access: { loading: false, allowed: !error && data === true } });
    }).catch(() => { if (active) setState((previous) => ({ userId, access: previous?.userId === userId ? previous.access : denied })); });
    return () => { active = false; };
  }, [token, userId]);

  const access = state?.userId === userId ? state.access : userId ? { loading: true, allowed: false } : denied;
  return <Context.Provider value={access}>{children}</Context.Provider>;
}
