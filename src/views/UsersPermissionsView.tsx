import React, { useState, useEffect } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import type { ToastMessage, UserProfile, UserRole } from '../types';

interface UsersPermissionsViewProps {
  onShowToast: (toast: Omit<ToastMessage, 'id'>) => void;
}

export const UsersPermissionsView: React.FC<UsersPermissionsViewProps> = ({ onShowToast }) => {
  const { profile, role, updateUserProfile, inviteUser } = useAuth();
  const [usersList, setUsersList] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'ativo' | 'inativo'>('all');
  const [savingUserId, setSavingUserId] = useState<string | null>(null);

  // Invite Modal state
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteDepartment, setInviteDepartment] = useState('Operações MK9');
  const [inviteRole, setInviteRole] = useState<UserRole>('operador');
  const [inviting, setInviting] = useState(false);

  // Edit Modal state
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [editDepartment, setEditDepartment] = useState('');
  const [editRole, setEditRole] = useState<UserRole>('operador');
  const [editStatus, setEditStatus] = useState<'ativo' | 'inativo'>('ativo');
  const [editPromotorMatricula, setEditPromotorMatricula] = useState<string>('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Promotores options for linking
  const [promotoresOptions, setPromotoresOptions] = useState<{ matricula: string; name: string }[]>([]);

  const fetchUsers = async () => {
    setLoading(true);
    setErrorMessage(null);

    if (!supabase) {
      setUsersList(profile ? [profile] : []);
      setLoading(false);
      return;
    }

    try {
      const [profilesRes, promotoresRes] = await Promise.all([
        supabase.from('profiles').select('*').order('created_at', { ascending: false }),
        supabase.from('promotores').select('matricula, name').order('name')
      ]);

      if (profilesRes.error) {
        setErrorMessage(`Falha ao buscar usuários do Supabase: ${profilesRes.error.message}`);
        if (profile) setUsersList([profile]);
      } else if (profilesRes.data) {
        setUsersList(profilesRes.data as UserProfile[]);
      }

      if (promotoresRes.data) {
        setPromotoresOptions(promotoresRes.data as { matricula: string; name: string }[]);
      }
    } catch (err) {
      setErrorMessage(`Erro de conexão com o banco de dados: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, [profile]);

  const handleQuickStatusToggle = async (targetUser: UserProfile) => {
    if (role !== 'admin') {
      onShowToast({
        title: 'Acesso Negado',
        message: 'Apenas administradores podem alterar o status dos usuários.',
        type: 'warning'
      });
      return;
    }

    const newStatus = targetUser.status === 'inativo' ? 'ativo' : 'inativo';
    setSavingUserId(targetUser.id);

    const { error } = await updateUserProfile(targetUser.id, { status: newStatus });
    setSavingUserId(null);

    if (error) {
      onShowToast({
        title: 'Erro de Atualização',
        message: `Falha ao alterar status: ${error.message}`,
        type: 'error'
      });
    } else {
      setUsersList((prev) =>
        prev.map((u) => (u.id === targetUser.id ? { ...u, status: newStatus } : u))
      );
      onShowToast({
        title: newStatus === 'ativo' ? 'Acesso Desbloqueado' : 'Acesso Bloqueado',
        message: `O status de ${targetUser.name} foi alterado para ${newStatus.toUpperCase()}.`,
        type: 'success'
      });
    }
  };

  const handleRoleChange = async (targetUserId: string, targetName: string, newRole: UserRole) => {
    if (role !== 'admin') {
      onShowToast({
        title: 'Acesso Negado',
        message: 'Apenas administradores podem alterar papéis de permissão.',
        type: 'warning'
      });
      return;
    }

    setSavingUserId(targetUserId);
    const { error } = await updateUserProfile(targetUserId, { role: newRole });
    setSavingUserId(null);

    if (error) {
      onShowToast({
        title: 'Erro de Permissão',
        message: `Falha ao atualizar papel: ${error.message}`,
        type: 'error'
      });
    } else {
      setUsersList((prev) =>
        prev.map((u) => (u.id === targetUserId ? { ...u, role: newRole } : u))
      );
      onShowToast({
        title: 'Permissão Atualizada',
        message: `O papel de ${targetName} foi alterado para ${newRole.toUpperCase()}.`,
        type: 'success'
      });
    }
  };

  const handleOpenEditModal = (userToEdit: UserProfile) => {
    if (role !== 'admin') {
      onShowToast({
        title: 'Acesso Negado',
        message: 'Apenas administradores podem editar perfis de usuários.',
        type: 'warning'
      });
      return;
    }
    setEditingUser(userToEdit);
    setEditDepartment(userToEdit.department || 'Operações MK9');
    setEditRole(userToEdit.role);
    setEditStatus(userToEdit.status || 'ativo');
    setEditPromotorMatricula(userToEdit.promotor_matricula || '');
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;

    setSavingEdit(true);
    const { error } = await updateUserProfile(editingUser.id, {
      department: editDepartment,
      role: editRole,
      status: editStatus,
      promotor_matricula: editPromotorMatricula.trim() || null
    });
    setSavingEdit(false);

    if (error) {
      onShowToast({
        title: 'Erro ao Salvar Perfil',
        message: error.message,
        type: 'error'
      });
    } else {
      setUsersList((prev) =>
        prev.map((u) =>
          u.id === editingUser.id
            ? {
                ...u,
                department: editDepartment,
                role: editRole,
                status: editStatus,
                promotor_matricula: editPromotorMatricula.trim() || null
              }
            : u
        )
      );
      setEditingUser(null);
      onShowToast({
        title: 'Perfil Atualizado',
        message: `As alterações no perfil de ${editingUser.name} foram salvas com sucesso.`,
        type: 'success'
      });
    }
  };

  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail || !inviteName) {
      onShowToast({
        title: 'Campos Obrigatórios',
        message: 'Preencha o e-mail e o nome do usuário.',
        type: 'warning'
      });
      return;
    }

    setInviting(true);
    const { error } = await inviteUser({
      email: inviteEmail.trim(),
      name: inviteName.trim(),
      department: inviteDepartment.trim() || 'Operações MK9',
      role: inviteRole
    });
    setInviting(false);

    if (error) {
      onShowToast({
        title: 'Erro no Convite',
        message: `Falha ao convidar usuário: ${error.message}`,
        type: 'error'
      });
    } else {
      setIsInviteModalOpen(false);
      setInviteEmail('');
      setInviteName('');
      setInviteDepartment('Operações MK9');
      setInviteRole('operador');
      fetchUsers();
      onShowToast({
        title: 'Convite Enviado',
        message: `Convite de acesso enviado com sucesso para ${inviteEmail}.`,
        type: 'success'
      });
    }
  };

  const filteredUsers = usersList.filter((u) => {
    const matchesSearch =
      u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (u.department && u.department.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesRole = roleFilter === 'all' || u.role === roleFilter;
    const matchesStatus =
      statusFilter === 'all' || (u.status || 'ativo') === statusFilter;

    return matchesSearch && matchesRole && matchesStatus;
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
      case 'promotor':
        return (
          <span className="px-2.5 py-1 rounded-md bg-amber-950/80 border border-amber-500/50 text-amber-300 text-[10px] font-extrabold uppercase tracking-wider font-mono shadow-[0_0_10px_rgba(245,158,11,0.3)]">
            PROMOTOR DE CAMPO
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
            Gestão centralizada de papéis RBAC (<code className="text-purple-400 font-mono">Admin</code>, <code className="text-cyan-400 font-mono">Gestor</code>, <code className="text-emerald-400 font-mono">Operador</code>, <code className="text-amber-400 font-mono">Promotor</code>) e vínculo de matrículas do Portal do Promotor.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchUsers}
            className="px-3.5 py-2 rounded-xl bg-[#131722] border border-[#1e2433] text-xs font-semibold text-slate-300 hover:text-white hover:border-purple-500/40 transition-colors flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">refresh</span>
            Atualizar Lista
          </button>

          {role === 'admin' && (
            <button
              onClick={() => setIsInviteModalOpen(true)}
              className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs neon-purple-glow transition-all active:scale-95 shadow-md flex items-center gap-1.5 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[18px]">person_add</span>
              <span>Convidar Usuário</span>
            </button>
          )}
        </div>
      </section>

      {/* Role Matrix Info Cards */}
      <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-[#171b26] border border-purple-500/30 shadow-xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
            <span className="material-symbols-outlined text-5xl text-purple-400">shield_person</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-purple-500 animate-pulse"></span>
            <h3 className="text-xs font-extrabold text-white uppercase tracking-wider font-mono">Admin</h3>
          </div>
          <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
            Acesso irrestrito a todos os módulos, usuários, parametrizações e financeiro.
          </p>
          <div className="mt-3 pt-2 border-t border-[#1e2433] flex items-center justify-between text-[10px] font-mono text-purple-300">
            <span>Totais</span>
            <span className="font-bold">Nível 1</span>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-[#171b26] border border-cyan-500/30 shadow-xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
            <span className="material-symbols-outlined text-5xl text-cyan-400">supervisor_account</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-500"></span>
            <h3 className="text-xs font-extrabold text-white uppercase tracking-wider font-mono">Gestor</h3>
          </div>
          <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
            Supervisão operacional, rotas, cadastros e acompanhamento de equipes.
          </p>
          <div className="mt-3 pt-2 border-t border-[#1e2433] flex items-center justify-between text-[10px] font-mono text-cyan-300">
            <span>Operacional</span>
            <span className="font-bold">Nível 2</span>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-[#171b26] border border-emerald-500/30 shadow-xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
            <span className="material-symbols-outlined text-5xl text-emerald-400">badge</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
            <h3 className="text-xs font-extrabold text-white uppercase tracking-wider font-mono">Operador</h3>
          </div>
          <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
            Painel operacional, rotas, cadastros e diárias do dia a dia.
          </p>
          <div className="mt-3 pt-2 border-t border-[#1e2433] flex items-center justify-between text-[10px] font-mono text-emerald-300">
            <span>Campo & Ops</span>
            <span className="font-bold">Nível 3</span>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-[#171b26] border border-amber-500/30 shadow-xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
            <span className="material-symbols-outlined text-5xl text-amber-400">smartphone</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
            <h3 className="text-xs font-extrabold text-white uppercase tracking-wider font-mono">Promotor</h3>
          </div>
          <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
            Acesso exclusivo ao Portal do Promotor, suas rotas, check-in e fotos de visita.
          </p>
          <div className="mt-3 pt-2 border-t border-[#1e2433] flex items-center justify-between text-[10px] font-mono text-amber-300">
            <span>Portal Mobile</span>
            <span className="font-bold">Nível 4</span>
          </div>
        </div>
      </section>

      {/* Users List & Controls */}
      <section className="bg-[#171b26] border border-[#1e2433] rounded-2xl p-6 shadow-2xl space-y-6">
        {errorMessage && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-mono flex items-center gap-2">
            <span className="material-symbols-outlined text-lg text-rose-400">error</span>
            <span>{errorMessage}</span>
          </div>
        )}

        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="relative w-full sm:w-80">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[18px]">
              search
            </span>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por nome, e-mail ou matrícula..."
              className="w-full h-10 pl-9 pr-4 bg-[#131722] border border-[#1e2433] rounded-xl text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-purple-500 transition-all"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 font-mono">Papel:</span>
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value as 'all' | UserRole)}
                className="h-10 px-3 bg-[#131722] border border-[#1e2433] rounded-xl text-xs text-slate-200 focus:outline-none focus:border-purple-500 transition-all font-mono"
              >
                <option value="all">Todos os Papéis</option>
                <option value="admin">Administrador</option>
                <option value="gestor">Gestor</option>
                <option value="operador">Operador</option>
                <option value="promotor">Promotor</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 font-mono">Status:</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as 'all' | 'ativo' | 'inativo')}
                className="h-10 px-3 bg-[#131722] border border-[#1e2433] rounded-xl text-xs text-slate-200 focus:outline-none focus:border-purple-500 transition-all font-mono"
              >
                <option value="all">Todos os Status</option>
                <option value="ativo">Ativos</option>
                <option value="inativo">Inativos</option>
              </select>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto rounded-xl border border-[#1e2433]">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#131722] border-b border-[#1e2433] text-[11px] font-bold text-slate-400 uppercase tracking-wider font-mono">
                <th className="py-3.5 px-4">Usuário Auth</th>
                <th className="py-3.5 px-4">Matrícula Promotor</th>
                <th className="py-3.5 px-4">Departamento</th>
                <th className="py-3.5 px-4">Papel Atual</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4 text-right">Ações de Vínculo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1e2433] text-slate-300">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-400 font-mono text-xs">
                    Carregando usuários registrados do Supabase...
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-400 font-mono text-xs">
                    Nenhum usuário cadastrado ou encontrado com os filtros aplicados.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => {
                  const isUserActive = (u.status || 'ativo') === 'ativo';

                  return (
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
                      <td className="py-4 px-4 font-mono text-xs">
                        {u.promotor_matricula ? (
                          <span className="px-2 py-1 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300 font-bold">
                            {u.promotor_matricula}
                          </span>
                        ) : (
                          <span className="text-slate-600 font-mono">—</span>
                        )}
                      </td>
                      <td className="py-4 px-4 font-mono text-slate-300">
                        {u.department || 'Operações MK9'}
                      </td>
                      <td className="py-4 px-4">{getRoleBadge(u.role)}</td>
                      <td className="py-4 px-4">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-mono text-[10px] font-bold ${
                            isUserActive
                              ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-400'
                              : 'bg-rose-500/15 border border-rose-500/30 text-rose-400'
                          }`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${isUserActive ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                          {isUserActive ? 'ATIVO' : 'BLOQUEADO'}
                        </span>
                      </td>
                      <td className="py-4 px-4 text-right">
                        {role === 'admin' ? (
                          <div className="flex items-center justify-end gap-2">
                            <select
                              disabled={savingUserId === u.id}
                              value={u.role}
                              onChange={(e) => handleRoleChange(u.id, u.name, e.target.value as UserRole)}
                              className="h-8 px-2 bg-[#131722] border border-[#2a3042] rounded-lg text-xs font-mono text-slate-200 focus:outline-none focus:border-purple-500 transition-colors disabled:opacity-50 cursor-pointer"
                              title="Alterar papel de acesso"
                            >
                              <option value="admin">Admin</option>
                              <option value="gestor">Gestor</option>
                              <option value="operador">Operador</option>
                              <option value="promotor">Promotor</option>
                            </select>

                            <button
                              onClick={() => handleOpenEditModal(u)}
                              className="p-1.5 rounded-lg bg-[#131722] hover:bg-[#1f2433] text-slate-300 hover:text-white border border-[#1e2433] transition-colors"
                              title="Editar Perfil e Vínculo de Matrícula"
                            >
                              <span className="material-symbols-outlined text-[16px]">edit</span>
                            </button>

                            <button
                              disabled={savingUserId === u.id || u.id === profile?.id}
                              onClick={() => handleQuickStatusToggle(u)}
                              className={`p-1.5 rounded-lg border transition-colors ${
                                isUserActive
                                  ? 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border-rose-500/30'
                                  : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                              } disabled:opacity-40 disabled:cursor-not-allowed`}
                              title={isUserActive ? 'Bloquear Acesso' : 'Desbloquear Acesso'}
                            >
                              <span className="material-symbols-outlined text-[16px]">
                                {isUserActive ? 'block' : 'check_circle'}
                              </span>
                            </button>
                          </div>
                        ) : (
                          <span className="text-[10px] text-slate-500 font-mono italic">
                            Somente Admin altera
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Modal Convidar Usuário */}
      {isInviteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="relative w-full max-w-md bg-[#171b26] border border-[#1e2433] rounded-2xl shadow-2xl p-6 overflow-hidden">
            <div className="flex items-center justify-between pb-4 border-b border-[#1e2433]">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-purple-600/20 text-purple-400 border border-purple-500/30 flex items-center justify-center font-bold">
                  <span className="material-symbols-outlined text-xl">person_add</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Convidar Novo Usuário</h3>
                  <p className="text-[11px] font-mono text-slate-400">Conceda acesso à plataforma via convite seguro</p>
                </div>
              </div>
              <button
                onClick={() => setIsInviteModalOpen(false)}
                className="text-slate-400 hover:text-white p-1"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            <form onSubmit={handleSendInvite} className="space-y-4 py-4 text-xs">
              <div className="space-y-1.5">
                <label className="font-bold text-slate-300">Nome Completo</label>
                <input
                  type="text"
                  required
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  placeholder="ex: Roberto Carlos Alencar"
                  className="w-full h-10 px-3 bg-[#10141f] border border-[#1e2433] rounded-xl text-white placeholder:text-slate-500 focus:outline-none focus:border-purple-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-slate-300">E-mail Corporativo</label>
                <input
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="ex: roberto.alencar@mk9.com.br"
                  className="w-full h-10 px-3 bg-[#10141f] border border-[#1e2433] rounded-xl text-white placeholder:text-slate-500 focus:outline-none focus:border-purple-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-slate-300">Departamento / Área</label>
                <input
                  type="text"
                  value={inviteDepartment}
                  onChange={(e) => setInviteDepartment(e.target.value)}
                  placeholder="ex: Campo SP"
                  className="w-full h-10 px-3 bg-[#10141f] border border-[#1e2433] rounded-xl text-white placeholder:text-slate-500 focus:outline-none focus:border-purple-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-slate-300">Papel Inicial</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as UserRole)}
                  className="w-full h-10 px-3 bg-[#10141f] border border-[#1e2433] rounded-xl text-white font-mono focus:outline-none focus:border-purple-500 cursor-pointer"
                >
                  <option value="gestor">Gestor de Operação</option>
                  <option value="operador">Operador de Campo</option>
                  <option value="promotor">Promotor de Campo</option>
                </select>
              </div>

              <div className="pt-3 border-t border-[#1e2433] flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsInviteModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-[#131722] hover:bg-[#1f2433] text-slate-300 border border-[#1e2433] font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={inviting}
                  className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold neon-purple-glow disabled:opacity-50 flex items-center gap-1.5"
                >
                  {inviting ? (
                    <span>Enviando...</span>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-base">send</span>
                      <span>Enviar Convite</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Editar Perfil / Permissões */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="relative w-full max-w-md bg-[#171b26] border border-[#1e2433] rounded-2xl shadow-2xl p-6 overflow-hidden">
            <div className="flex items-center justify-between pb-4 border-b border-[#1e2433]">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-purple-600/20 text-purple-400 border border-purple-500/30 flex items-center justify-center font-bold">
                  <span className="material-symbols-outlined text-xl">manage_accounts</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Editar Usuário &amp; Vínculo</h3>
                  <p className="text-[11px] font-mono text-slate-400">{editingUser.email}</p>
                </div>
              </div>
              <button
                onClick={() => setEditingUser(null)}
                className="text-slate-400 hover:text-white p-1"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-4 py-4 text-xs">
              <div className="space-y-1.5">
                <label className="font-bold text-slate-300">Nome do Usuário</label>
                <input
                  type="text"
                  disabled
                  value={editingUser.name}
                  className="w-full h-10 px-3 bg-[#10141f] border border-[#1e2433] rounded-xl text-slate-400 cursor-not-allowed font-medium"
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-slate-300">Departamento</label>
                <input
                  type="text"
                  value={editDepartment}
                  onChange={(e) => setEditDepartment(e.target.value)}
                  className="w-full h-10 px-3 bg-[#10141f] border border-[#1e2433] rounded-xl text-white focus:outline-none focus:border-purple-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-slate-300">Papel RBAC</label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as UserRole)}
                  className="w-full h-10 px-3 bg-[#10141f] border border-[#1e2433] rounded-xl text-white font-mono focus:outline-none focus:border-purple-500 cursor-pointer"
                >
                  <option value="admin">Administrador</option>
                  <option value="gestor">Gestor de Operação</option>
                  <option value="operador">Operador de Campo</option>
                  <option value="promotor">Promotor de Campo</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-slate-300 flex items-center justify-between">
                  <span>Vincular Matrícula de Promotor</span>
                  <span className="text-[10px] text-amber-400 font-mono">(public.promotores)</span>
                </label>
                {promotoresOptions.length > 0 ? (
                  <select
                    value={editPromotorMatricula}
                    onChange={(e) => setEditPromotorMatricula(e.target.value)}
                    className="w-full h-10 px-3 bg-[#10141f] border border-[#1e2433] rounded-xl text-white font-mono text-xs focus:outline-none focus:border-purple-500 cursor-pointer"
                  >
                    <option value="">-- Sem Matrícula Vinculada --</option>
                    {promotoresOptions.map((p) => (
                      <option key={p.matricula} value={p.matricula}>
                        Matrícula: {p.matricula} - {p.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    placeholder="Digite a matrícula (ex: PROM001)"
                    value={editPromotorMatricula}
                    onChange={(e) => setEditPromotorMatricula(e.target.value)}
                    className="w-full h-10 px-3 bg-[#10141f] border border-[#1e2433] rounded-xl text-white font-mono text-xs focus:outline-none focus:border-purple-500"
                  />
                )}
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-slate-300">Status da Conta</label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value as 'ativo' | 'inativo')}
                  className="w-full h-10 px-3 bg-[#10141f] border border-[#1e2433] rounded-xl text-white font-mono focus:outline-none focus:border-purple-500 cursor-pointer"
                >
                  <option value="ativo">Ativo (Acesso Liberado)</option>
                  <option value="inativo">Inativo (Acesso Bloqueado)</option>
                </select>
              </div>

              <div className="pt-3 border-t border-[#1e2433] flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="px-4 py-2 rounded-xl bg-[#131722] hover:bg-[#1f2433] text-slate-300 border border-[#1e2433] font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold neon-purple-glow disabled:opacity-50"
                >
                  {savingEdit ? 'Salvando...' : 'Salvar Alterações'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
