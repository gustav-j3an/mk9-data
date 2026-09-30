import React, { useState, useEffect } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import type { ToastMessage, UserProfile, UserRole } from '../types';

interface UsersPermissionsViewProps {
  onShowToast: (toast: Omit<ToastMessage, 'id'>) => void;
}

export const UsersPermissionsView: React.FC<UsersPermissionsViewProps> = ({ onShowToast }) => {
  const { profile, role, updateProfileRole } = useAuth();
  const [usersList, setUsersList] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all');
  const [savingUserId, setSavingUserId] = useState<string | null>(null);

  const fetchUsers = async () => {
    setLoading(true);
    if (!supabase) {
      // Mocked data if local fallback
      const mockUsers: UserProfile[] = [
        {
          id: profile?.id || 'usr-1',
          name: profile?.name || 'Mariana Vasconcellos',
          email: profile?.email || 'mariana.vasconcellos@mk9.com.br',
          role: profile?.role || 'admin',
          department: 'Diretoria de Operações',
          created_at: new Date().toISOString()
        },
        {
          id: 'usr-2',
          name: 'Carlos Eduardo Santos',
          email: 'carlos.eduardo@mk9.com.br',
          role: 'gestor',
          department: 'Supervisão de Campo',
          created_at: '2026-01-15T10:00:00Z'
        },
        {
          id: 'usr-3',
          name: 'Ana Paula Mendonça',
          email: 'ana.mendonca@mk9.com.br',
          role: 'operador',
          department: 'Trade Ops & Auditoria',
          created_at: '2026-02-01T14:30:00Z'
        }
      ];
      setUsersList(mockUsers);
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
      if (error) {
        console.warn('Erro ao carregar perfis do Supabase:', error.message);
        if (profile) setUsersList([profile]);
      } else if (data) {
        setUsersList(data as UserProfile[]);
      }
    } catch (err) {
      console.error('Falha ao conectar no Supabase para buscar perfis:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, [profile]);

  const handleRoleChange = async (targetUserId: string, targetName: string, newRole: UserRole) => {
    if (role !== 'admin') {
      onShowToast({
        title: 'Acesso Negado',
        message: 'Apenas administradores podem alterar permissões de perfis.',
        type: 'warning'
      });
      return;
    }

    setSavingUserId(targetUserId);
    const { error } = await updateProfileRole(targetUserId, newRole);
    setSavingUserId(null);

    if (error) {
      onShowToast({
        title: 'Erro de Atualização',
        message: `Falha ao atualizar papel: ${error.message}`,
        type: 'error'
      });
    } else {
      setUsersList((prev) =>
        prev.map((u) => (u.id === targetUserId ? { ...u, role: newRole } : u))
      );
      onShowToast({
        title: 'Permissão Atualizada',
        message: `O usuário ${targetName} agora possui o papel ${newRole.toUpperCase()}.`,
        type: 'success'
      });
    }
  };

  const filteredUsers = usersList.filter((u) => {
    const matchesSearch =
      u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.email.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesRole = roleFilter === 'all' || u.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  const getRoleBadge = (userRole: UserRole) => {
    switch (userRole) {
      case 'admin':
        return (
          <span className="px-2.5 py-1 rounded-md bg-purple-950/80 border border-purple-500/50 text-purple-300 text-[10px] font-extrabold uppercase tracking-wider font-mono shadow-[0_0_10px_rgba(147,51,234,0.3)]">
            ADMINISTRADOR
          </span>
        );
      case 'gestor':
        return (
          <span className="px-2.5 py-1 rounded-md bg-cyan-950/80 border border-cyan-500/50 text-cyan-300 text-[10px] font-extrabold uppercase tracking-wider font-mono shadow-[0_0_10px_rgba(6,182,212,0.3)]">
            GESTOR DE OPERAÇÃO
          </span>
        );
      case 'operador':
        return (
          <span className="px-2.5 py-1 rounded-md bg-emerald-950/80 border border-emerald-500/50 text-emerald-300 text-[10px] font-extrabold uppercase tracking-wider font-mono">
            OPERADOR DE CAMPO
          </span>
        );
    }
  };

  return (
    <div className="w-full px-4 lg:px-8 py-6 max-w-[1720px] mx-auto space-y-8 font-sans">
      {/* Header */}
      <section className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#1e2433] pb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-purple-600 to-indigo-500 flex items-center justify-center font-bold text-white shadow-[0_0_14px_rgba(147,51,234,0.6)]">
              <span className="material-symbols-outlined text-[20px]">admin_panel_settings</span>
            </div>
            <h1 className="text-3xl font-extrabold text-white tracking-tight">
              Perfis &amp; Permissões de Acesso
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-slate-400 mt-1 max-w-3xl">
            Gestão centralizada de papéis RBAC (<code className="text-purple-400 font-mono">Admin</code>, <code className="text-cyan-400 font-mono">Gestor</code>, <code className="text-emerald-400 font-mono">Operador</code>) e políticas de segurança RLS no <strong>MK9 Command Center</strong>.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchUsers}
            className="px-3 py-2 rounded-lg bg-[#131722] border border-[#1e2433] text-xs font-semibold text-slate-300 hover:text-white hover:border-purple-500/40 transition-colors flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">refresh</span>
            Sincronizar Perfis
          </button>
        </div>
      </section>

      {/* Role Matrix Info Cards */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="p-5 rounded-2xl bg-[#171b26] border border-purple-500/30 shadow-xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <span className="material-symbols-outlined text-6xl text-purple-400">shield_person</span>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-purple-500 animate-pulse"></span>
            <h3 className="text-sm font-extrabold text-white uppercase tracking-wider font-mono">Papel: Admin</h3>
          </div>
          <p className="text-xs text-slate-400 mt-2 leading-relaxed">
            Acesso irrestrito a todos os módulos, gerenciamento de usuários, parametrizações globais do sistema e aprovação final de reembolsos/diárias.
          </p>
          <div className="mt-4 pt-3 border-t border-[#1e2433] flex items-center justify-between text-[11px] font-mono text-purple-300">
            <span>Privilégios: Totais</span>
            <span className="font-bold">Nível 1</span>
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-[#171b26] border border-cyan-500/30 shadow-xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <span className="material-symbols-outlined text-6xl text-cyan-400">supervisor_account</span>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-500"></span>
            <h3 className="text-sm font-extrabold text-white uppercase tracking-wider font-mono">Papel: Gestor</h3>
          </div>
          <p className="text-xs text-slate-400 mt-2 leading-relaxed">
            Supervisão operacional de equipes, acompanhamento de presença ao vivo, cadastro de promotores/freelancers e criação de rotas.
          </p>
          <div className="mt-4 pt-3 border-t border-[#1e2433] flex items-center justify-between text-[11px] font-mono text-cyan-300">
            <span>Privilégios: Gestão Operacional</span>
            <span className="font-bold">Nível 2</span>
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-[#171b26] border border-emerald-500/30 shadow-xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <span className="material-symbols-outlined text-6xl text-emerald-400">badge</span>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
            <h3 className="text-sm font-extrabold text-white uppercase tracking-wider font-mono">Papel: Operador</h3>
          </div>
          <p className="text-xs text-slate-400 mt-2 leading-relaxed">
            Acesso direcionado para registro de ponto georreferenciado, relatórios de campo, confirmação de presença e checagem de SKUs.
          </p>
          <div className="mt-4 pt-3 border-t border-[#1e2433] flex items-center justify-between text-[11px] font-mono text-emerald-300">
            <span>Privilégios: Execução de Campo</span>
            <span className="font-bold">Nível 3</span>
          </div>
        </div>
      </section>

      {/* Users List & Controls */}
      <section className="bg-[#171b26] border border-[#1e2433] rounded-2xl p-6 shadow-2xl space-y-6">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="relative w-full sm:w-80">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[18px]">
              search
            </span>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por nome ou e-mail..."
              className="w-full h-10 pl-9 pr-4 bg-[#131722] border border-[#1e2433] rounded-xl text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-purple-500 transition-all"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <span className="text-xs text-slate-400 font-mono">Filtrar Papel:</span>
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value as 'all' | UserRole)}
              className="h-10 px-3 bg-[#131722] border border-[#1e2433] rounded-xl text-xs text-slate-200 focus:outline-none focus:border-purple-500 transition-all font-mono"
            >
              <option value="all">Todos os Papéis</option>
              <option value="admin">Administrador</option>
              <option value="gestor">Gestor</option>
              <option value="operador">Operador</option>
            </select>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto rounded-xl border border-[#1e2433]">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#131722] border-b border-[#1e2433] text-[11px] font-bold text-slate-400 uppercase tracking-wider font-mono">
                <th className="py-3.5 px-4">Usuário</th>
                <th className="py-3.5 px-4">Departamento</th>
                <th className="py-3.5 px-4">Papel Atual</th>
                <th className="py-3.5 px-4 text-right">Ação de Permissão</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1e2433] text-slate-300">
              {loading ? (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-slate-400 font-mono text-xs">
                    Carregando perfis registrados...
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-slate-400 font-mono text-xs">
                    Nenhum usuário encontrado com os filtros aplicados.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => (
                  <tr key={u.id} className="hover:bg-[#131722]/60 transition-colors">
                    <td className="py-4 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-purple-950/80 border border-purple-500/40 text-purple-200 font-extrabold flex items-center justify-center text-xs shadow-inner">
                          {u.name.substring(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-bold text-slate-100 flex items-center gap-1.5">
                            {u.name}
                            {u.id === profile?.id && (
                              <span className="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 text-[9px] font-mono font-bold">
                                VOCÊ
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-4 font-mono text-slate-400">
                      {u.department || 'Operações MK9'}
                    </td>
                    <td className="py-4 px-4">{getRoleBadge(u.role)}</td>
                    <td className="py-4 px-4 text-right">
                      {role === 'admin' ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <select
                            disabled={savingUserId === u.id}
                            value={u.role}
                            onChange={(e) => handleRoleChange(u.id, u.name, e.target.value as UserRole)}
                            className="h-8 px-2 bg-[#131722] border border-[#2a3042] rounded-lg text-xs font-mono text-slate-200 focus:outline-none focus:border-purple-500 transition-colors disabled:opacity-50"
                          >
                            <option value="admin">Admin</option>
                            <option value="gestor">Gestor</option>
                            <option value="operador">Operador</option>
                          </select>
                        </div>
                      ) : (
                        <span className="text-[10px] text-slate-500 font-mono italic">
                          Somente Admin altera
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
