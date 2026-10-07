import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import type { Session } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import type { UserProfile, UserRole } from '../types';

interface AuthContextValue {
  session: Session | null;
  profile: UserProfile | null;
  role: UserRole;
  loading: boolean;
  configured: boolean;
  error: string | null;
  hasPermission: (requiredRoles: UserRole[]) => boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateProfileRole: (userId: string, newRole: UserRole) => Promise<{ error: Error | null }>;
  updateUserProfile: (userId: string, updates: { role?: UserRole; department?: string; status?: 'ativo' | 'inativo'; promotor_matricula?: string | null }) => Promise<{ error: Error | null }>;
  inviteUser: (data: { email: string; name: string; department: string; role: UserRole }) => Promise<{ error: Error | null }>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = useCallback(async (currentSession: Session | null) => {
    if (!currentSession?.user) {
      setProfile(null);
      return;
    }

    const user = currentSession.user;
    const defaultProfile: UserProfile = {
      id: user.id,
      email: user.email ?? '',
      name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Usuário MK9',
      role: 'operador',
      department: 'Operações'
    };

    if (!supabase) {
      setProfile(defaultProfile);
      return;
    }

    try {
      const { data, error: profileErr } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      if (profileErr) {
        console.warn('Profile fetch warning (fallback to session metadata):', profileErr.message);
      }

      const matricula = data?.promotor_matricula || null;

      let promotorInfo: {
        matricula: string;
        nome?: string;
        cidade?: string;
        uf?: string;
        supervisor?: string;
        equipe?: string;
        status?: string;
      } | null = null;

      if (matricula) {
        const { data: pData, error: pErr } = await supabase
          .from('promotores')
          .select('matricula, nome, cidade, uf, supervisor, equipe, status')
          .eq('matricula', matricula)
          .maybeSingle();

        if (pErr) {
          console.error('Erro ao buscar promotor em public.promotores:', pErr.message);
        } else if (pData) {
          promotorInfo = {
            matricula: pData.matricula,
            nome: pData.nome,
            cidade: pData.cidade,
            uf: pData.uf,
            supervisor: pData.supervisor,
            equipe: pData.equipe,
            status: pData.status
          };
        }
      }

      const realRole = (data?.role as UserRole) || defaultProfile.role;
      const realName = promotorInfo?.nome || data?.name || defaultProfile.name;

      setProfile({
        id: user.id,
        email: user.email || defaultProfile.email,
        name: realName,
        role: realRole,
        promotor_matricula: matricula,
        promotor_nome: promotorInfo?.nome || null,
        promotor_cidade: promotorInfo?.cidade || null,
        promotor_uf: promotorInfo?.uf || null,
        promotor_supervisor: promotorInfo?.supervisor || null,
        promotor_equipe: promotorInfo?.equipe || null,
        avatar_url: data?.avatar_url,
        department: data?.department || defaultProfile.department,
        created_at: data?.created_at,
        updated_at: data?.updated_at
      });
    } catch (e) {
      console.warn('Profile load error, using default fallback:', e);
      setProfile(defaultProfile);
    }
  }, []);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (sessionError) setError(sessionError.message);
      setSession(data.session);
      fetchProfile(data.session).finally(() => setLoading(false));
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      fetchProfile(nextSession).finally(() => setLoading(false));
    });

    return () => data.subscription.unsubscribe();
  }, [fetchProfile]);

  const role: UserRole = profile?.role ?? 'operador';

  const hasPermission = useCallback((requiredRoles: UserRole[]) => {
    if (!requiredRoles || requiredRoles.length === 0) return true;
    return requiredRoles.includes(role);
  }, [role]);

  const updateProfileRole = useCallback(async (userId: string, newRole: UserRole) => {
    if (!supabase) return { error: new Error('Supabase não configurado.') };
    if (role !== 'admin') return { error: new Error('Apenas administradores podem alterar permissões.') };

    const { error: updateErr } = await supabase
      .from('profiles')
      .update({ role: newRole, updated_at: new Date().toISOString() })
      .eq('id', userId);

    if (updateErr) {
      return { error: new Error(updateErr.message) };
    }

    if (session?.user?.id === userId) {
      setProfile((prev) => prev ? { ...prev, role: newRole } : null);
    }
    return { error: null };
  }, [role, session]);

  const updateUserProfile = useCallback(async (
    userId: string, 
    updates: { role?: UserRole; department?: string; status?: 'ativo' | 'inativo'; promotor_matricula?: string | null }
  ) => {
    if (!supabase) return { error: new Error('Supabase não configurado.') };
    if (role !== 'admin') return { error: new Error('Apenas administradores podem alterar permissões de usuários.') };

    const { status, ...dbUpdates } = updates;

    const { error: updateErr } = await supabase
      .from('profiles')
      .update({ ...dbUpdates, updated_at: new Date().toISOString() })
      .eq('id', userId);

    if (updateErr) {
      return { error: new Error(updateErr.message) };
    }

    if (session?.user?.id === userId) {
      setProfile((prev) => prev ? { ...prev, ...dbUpdates } : null);
    }
    return { error: null };
  }, [role, session]);

  const inviteUser = useCallback(async ({ email, name, department, role: initialRole }: { email: string; name: string; department: string; role: UserRole | string }) => {
    if (!supabase) return { error: new Error('Supabase não configurado.') };
    if (role !== 'admin') return { error: new Error('Apenas administradores podem convidar usuários.') };

    // Standard client invitation flow: trigger a password reset/magic link email from Supabase Auth
    // and pre-insert or upsert profile in public.profiles.
    const { data: authData, error: authError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/login`
    });

    if (authError) {
      console.warn('Erro no envio de e-mail Supabase Auth:', authError.message);
    }

    const roleMap: Record<string, UserRole> = {
      'administrador': 'admin',
      'admin': 'admin',
      'gestor': 'gestor',
      'operador': 'operador',
      'promotor': 'promotor'
    };
    const validRole: UserRole = roleMap[String(initialRole).toLowerCase().trim()] || 'promotor';

    // Insert pending/active invited profile into profiles table
    // Generates a deterministically unique UUID for initial tracking if auth user record trigger hasn't fired yet
    const tempId = crypto.randomUUID();
    const { error: profileErr } = await supabase.from('profiles').insert([
      {
        id: tempId,
        email,
        name,
        department,
        role: validRole
      }
    ]);

    if (profileErr) {
      // If profile with email already exists, update it
      const { error: upsertErr } = await supabase.from('profiles').upsert([
        {
          email,
          name,
          department,
          role: validRole
        }
      ], { onConflict: 'email' });
      if (upsertErr) {
        return { error: new Error(upsertErr.message) };
      }
    }

    return { error: null };
  }, [role]);

  const value = useMemo<AuthContextValue>(() => ({
    session,
    profile,
    role,
    loading,
    configured: isSupabaseConfigured,
    error,
    hasPermission,
    signIn: async (email, password) => {
      if (!supabase) return { error: new Error('Supabase ainda não foi configurado.') };
      const result = await supabase.auth.signInWithPassword({ email, password });
      if (result.data.session) {
        setSession(result.data.session);
        await fetchProfile(result.data.session);
      }
      return { error: result.error ? new Error(result.error.message) : null };
    },
    signOut: async () => {
      setSession(null);
      setProfile(null);
      if (supabase) await supabase.auth.signOut();
    },
    refreshProfile: async () => {
      await fetchProfile(session);
    },
    updateProfileRole,
    updateUserProfile,
    inviteUser
  }), [error, fetchProfile, hasPermission, inviteUser, loading, profile, role, session, updateProfileRole, updateUserProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth deve ser usado dentro de AuthProvider.');
  return context;
}
