import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import type { Session } from '@supabase/supabase-js';
import { createIsolatedClient, isSupabaseConfigured, supabase } from '../lib/supabase';
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
  deleteUser: (userId: string) => Promise<{ error: Error | null }>;
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

    const roleMap: Record<string, UserRole> = {
      'administrador': 'admin',
      'admin': 'admin',
      'gestor': 'gestor',
      'operador': 'operador',
      'promotor': 'promotor'
    };
    const validRole: UserRole = roleMap[String(initialRole).toLowerCase().trim()] || 'promotor';

    // 1. Look up existing profile by email to reuse primary key ID if user already exists
    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    let targetId = existingProfile?.id;

    // 2. If user does not exist yet, create user in Supabase Auth to obtain a real auth.users.id
    // Use an isolated Supabase client (persistSession: false) so the logged in admin session is preserved.
    if (!targetId) {
      const isolatedClient = createIsolatedClient();
      if (!isolatedClient) return { error: new Error('Supabase não configurado.') };

      const tempPassword = `Mk9@${crypto.randomUUID().slice(0, 12)}`;
      const { data: signUpData, error: signUpError } = await isolatedClient.auth.signUp({
        email,
        password: tempPassword,
        options: {
          data: { full_name: name }
        }
      });

      if (signUpError) {
        return { error: new Error(`Erro ao criar usuário no Auth: ${signUpError.message}`) };
      }

      targetId = signUpData.user?.id;
    }

    if (!targetId) {
      return { error: new Error('Não foi possível obter o ID do usuário no Supabase Auth.') };
    }

    // 3. Trigger password reset / magic link so user sets their own password
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/login`
    });

    if (resetError) {
      console.warn('Aviso no envio de e-mail de redefinição:', resetError.message);
    }

    // 4. Create or update profile in public.profiles using real auth.users.id (satisfies profiles_id_fkey)
    const { error: upsertErr } = await supabase.from('profiles').upsert([
      {
        id: targetId,
        email,
        name,
        department,
        role: validRole
      }
    ], { onConflict: 'id' });

    if (upsertErr) {
      return { error: new Error(upsertErr.message) };
    }

    return { error: null };
  }, [role]);

  const deleteUser = useCallback(async (userId: string) => {
    if (!supabase) return { error: new Error('Supabase não configurado.') };
    if (role !== 'admin') return { error: new Error('Apenas administradores podem excluir usuários.') };
    if (session?.user?.id === userId) return { error: new Error('Não é possível excluir a própria conta em uso.') };

    const { error: rpcErr } = await supabase.rpc('delete_user_by_admin', { target_user_id: userId });
    if (rpcErr) {
      return { error: new Error(rpcErr.message) };
    }

    return { error: null };
  }, [role, session]);

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
    inviteUser,
    deleteUser
  }), [deleteUser, error, fetchProfile, hasPermission, inviteUser, loading, profile, role, session, updateProfileRole, updateUserProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth deve ser usado dentro de AuthProvider.');
  return context;
}
