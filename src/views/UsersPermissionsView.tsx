import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import type { ToastMessage, UserProfile, UserRole } from '../types';

interface UsersPermissionsViewProps {
  onShowToast: (toast: Omit<ToastMessage, 'id'>) => void;
}

export interface PromoterRecord {
  id?: string;
  matricula: string;
  nome: string;
  supervisor?: string | null;
  equipe?: string | null;
  status?: string | null;
  cidade?: string | null;
  uf?: string | null;
}

export interface ExtendedUserProfile extends UserProfile {
  last_sign_in_at?: string | null;
  promotor?: PromoterRecord | null;
}

export const UsersPermissionsView: React.FC<UsersPermissionsViewProps> = ({ onShowToast }) => {
  const { profile, role, updateUserProfile, inviteUser, deleteUser } = useAuth();
  const [usersList, setUsersList] = useState<ExtendedUserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'ativo' | 'inativo'>('all');
  const [promotorFilter, setPromotorFilter] = useState<'all' | 'linked' | 'unlinked'>('all');
  const [savingUserId, setSavingUserId] = useState<string | null>(null);

  // Delete Modal state
  const [deleteModalUser, setDeleteModalUser] = useState<ExtendedUserProfile | null>(null);
  const [deletingUser, setDeletingUser] = useState(false);

  // Invite Modal state
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteDepartment, setInviteDepartment] = useState('Operações MK9');
  const [inviteRole, setInviteRole] = useState<UserRole>('promotor');
  const [invitePromotorMatricula, setInvitePromotorMatricula] = useState('');
  const [inviting, setInviting] = useState(false);

  // Edit Modal state
  const [editingUser, setEditingUser] = useState<ExtendedUserProfile | null>(null);
  const [editDepartment, setEditDepartment] = useState('');
  const [editRole, setEditRole] = useState<UserRole>('operador');
  const [editStatus, setEditStatus] = useState<'ativo' | 'inativo'>('ativo');
  const [editPromotorMatricula, setEditPromotorMatricula] = useState<string>('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Confirmation Modal for Link Change
  const [confirmModalData, setConfirmModalData] = useState<{
    user: ExtendedUserProfile;
    newMatricula: string;
    newRole: UserRole;
    newDepartment: string;
    newStatus: 'ativo' | 'inativo';
  } | null>(null);

  // Promotores options for linking
  const [promotoresOptions, setPromotoresOptions] = useState<PromoterRecord[]>([]);

  const fetchUsers = async () => {
    setLoading(true);
    setErrorMessage(null);

    if (!supabase) {
      setUsersList(profile ? [{ ...profile, role: profile.role || 'admin' }] : []);
      setLoading(false);
      return;
    }

    try {
      // Execute relational query between profiles and promotores using profiles.promotor_matricula = promotores.matricula
      const [profilesRes, promotoresRes] = await Promise.all([
        supabase
          .from('profiles')
          .select(`
            *,
            promotor:promotores!profiles_promotor_matricula_fkey(
              id,
              matricula,
              nome,
              supervisor,
              equipe,
              status
            )
          `)
          .order('created_at', { ascending: false }),
        supabase
          .from('promotores')
          .select('id, matricula, nome, supervisor, equipe, status')
          .order('nome')
      ]);

      let rawProfiles: any[] = [];
      if (profilesRes.error) {
        // Fallback select if relationship constraint alias is missing in database schema
        const fallbackRes = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
        if (fallbackRes.error) {
          setErrorMessage(`Falha ao carregar perfis do Supabase: ${fallbackRes.error.message}`);
        } else {
          rawProfiles = fallbackRes.data || [];
        }
      } else {
        rawProfiles = profilesRes.data || [];
      }

      const promotoresMap = new Map<string, PromoterRecord>();

      if (promotoresRes.data && promotoresRes.data.length > 0) {
        promotoresRes.data.forEach((p: any) => {
          promotoresMap.set(p.matricula, {
            id: p.id,
            matricula: p.matricula,
            nome: p.nome || p.name || 'Promotor Sem Nome',
            supervisor: p.supervisor || null,
            equipe: p.equipe || p.squad || null,
            status: p.status || 'ativo'
          });
        });
      }
      
      setPromotoresOptions(Array.from(promotoresMap.values()));

      const mergedList: ExtendedUserProfile[] = rawProfiles.map((p: any) => {
        let linkedPromoter: PromoterRecord | null = null;
        if (p.promotor) {
          const firstP = Array.isArray(p.promotor) ? p.promotor[0] : p.promotor;
          if (firstP) {
            linkedPromoter = {
              matricula: firstP.matricula,
              nome: firstP.nome || firstP.name || 'Promotor Sem Nome',
              supervisor: firstP.supervisor || null,
              equipe: firstP.equipe || firstP.squad || null,
              status: firstP.status || 'ativo'
            };
          }
        }
        
        const effectiveMatricula = p.promotor_matricula || null;

        if (!linkedPromoter && effectiveMatricula && promotoresMap.has(effectiveMatricula)) {
          linkedPromoter = promotoresMap.get(effectiveMatricula)!;
        }

        const effectiveRole = (p.role as UserRole) || 'operador';

        return {
          ...p,
          role: effectiveRole,
          promotor_matricula: effectiveMatricula,
          promotor: linkedPromoter
        };
      });

      setUsersList(mergedList);
    } catch (err) {
      setErrorMessage(`Erro ao conectar com o banco de dados: ${String(err)}`);
      setUsersList([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, [profile]);

  const handleQuickStatusToggle = async (targetUser: ExtendedUserProfile) => {
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
        title: newStatus === 'ativo' ? 'Acesso Liberado' : 'Acesso Bloqueado',
        message: `Status de ${targetUser.name} alterado para ${newStatus.toUpperCase()}.`,
        type: 'success'
      });
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteModalUser) return;
    if (role !== 'admin') {
      onShowToast({
        title: 'Acesso Negado',
        message: 'Apenas administradores podem excluir usuários.',
        type: 'warning'
      });
      return;
    }

    setDeletingUser(true);
    const { error } = await deleteUser(deleteModalUser.id);
    setDeletingUser(false);

    if (error) {
      onShowToast({
        title: 'Erro ao Excluir',
        message: `Falha ao excluir usuário: ${error.message}`,
        type: 'error'
      });
    } else {
      onShowToast({
        title: 'Usuário Excluído',
        message: `O usuário ${deleteModalUser.name} foi removido com sucesso.`,
        type: 'success'
      });
      setDeleteModalUser(null);
      fetchUsers();
    }
  };

  const handleRoleChange = async (targetUserId: string, targetName: string, newRole: UserRole) => {
    if (role !== 'admin') {
      onShowToast({
        title: 'Acesso Negado',
        message: 'Apenas administradores podem alterar papéis de acesso.',
        type: 'warning'
      });
      return;
    }

    setSavingUserId(targetUserId);
    const { error } = await updateUserProfile(targetUserId, { role: newRole });
    setSavingUserId(null);

    if (error) {
      onShowToast({
        title: 'Erro ao Alterar Papel',
        message: error.message,
        type: 'error'
      });
    } else {
      setUsersList((prev) =>
        prev.map((u) => (u.id === targetUserId ? { ...u, role: newRole } : u))
      );
      onShowToast({
        title: 'Papel Atualizado',
        message: `O papel de ${targetName} foi alterado para ${newRole.toUpperCase()}.`,
        type: 'success'
      });
    }
  };

  const handleOpenEditModal = (userToEdit: ExtendedUserProfile) => {
    if (role !== 'admin') {
      onShowToast({
        title: 'Acesso Restrito',
        message: 'Apenas administradores podem gerenciar vínculos e papéis de usuários.',
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

  const handlePreSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;

    const matriculaChanged = editPromotorMatricula.trim() !== (editingUser.promotor_matricula || '');

    if (matriculaChanged) {
      // Confirmação antes de alterar o vínculo
      setConfirmModalData({
        user: editingUser,
        newMatricula: editPromotorMatricula.trim(),
        newRole: editRole,
        newDepartment: editDepartment,
        newStatus: editStatus
      });
    } else {
      executeSaveEdit(editingUser.id, editPromotorMatricula.trim() || null, editRole, editDepartment, editStatus);
    }
  };

  const executeSaveEdit = async (
    userId: string,
    newMatricula: string | null,
    newRole: UserRole,
    newDepartment: string,
    newStatus: 'ativo' | 'inativo'
  ) => {
    setSavingEdit(true);
    const { error } = await updateUserProfile(userId, {
      department: newDepartment,
      role: newRole,
      status: newStatus,
      promotor_matricula: newMatricula
    });
    setSavingEdit(false);
    setConfirmModalData(null);

    if (error) {
      onShowToast({
        title: 'Erro ao Salvar Perfil',
        message: error.message,
        type: 'error'
      });
    } else {
      const newPromoterObj = newMatricula
        ? promotoresOptions.find((p) => p.matricula === newMatricula) || {
            matricula: newMatricula,
            nome: 'Promotor Vinculado',
            supervisor: 'Renata Vasconcelos',
            equipe: 'SP Capital Norte',
            status: 'ativo'
          }
        : null;

      // Atualiza a lista imediatamente
      setUsersList((prev) =>
        prev.map((u) =>
          u.id === userId
            ? {
                ...u,
                department: newDepartment,
                role: newRole,
                status: newStatus,
                promotor_matricula: newMatricula,
                promotor: newPromoterObj
              }
            : u
        )
      );

      setEditingUser(null);
      onShowToast({
        title: 'Vínculo Atualizado',
        message: `Alterações de perfil e vínculo salvas com sucesso.`,
        type: 'success'
      });
      fetchUsers();
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
      setInviteRole('promotor');
      setInvitePromotorMatricula('');
      fetchUsers();
      onShowToast({
        title: 'Convite Enviado',
        message: `Convite de acesso enviado para ${inviteEmail}.`,
        type: 'success'
      });
    }
  };

  // Busca por e-mail, nome e matrícula + Filtros por Papel, Status e Vínculo
  const filteredUsers = useMemo(() => {
    return usersList.filter((u) => {
      const q = searchTerm.toLowerCase().trim();
      const matchesSearch =
        !q ||
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.department && u.department.toLowerCase().includes(q)) ||
        (u.promotor_matricula && u.promotor_matricula.toLowerCase().includes(q)) ||
        (u.promotor?.nome && u.promotor.nome.toLowerCase().includes(q)) ||
        (u.promotor?.supervisor && u.promotor.supervisor.toLowerCase().includes(q)) ||
        (u.promotor?.equipe && u.promotor.equipe.toLowerCase().includes(q));

      const matchesRole = roleFilter === 'all' || u.role === roleFilter;
      const matchesStatus = statusFilter === 'all' || (u.status || 'ativo') === statusFilter;

      let matchesPromotorFilter = true;
      if (promotorFilter === 'linked') {
        matchesPromotorFilter = !!u.promotor_matricula;
      } else if (promotorFilter === 'unlinked') {
        matchesPromotorFilter = !u.promotor_matricula;
      }

      return matchesSearch && matchesRole && matchesStatus && matchesPromotorFilter;
    });
  }, [usersList, searchTerm, roleFilter, statusFilter, promotorFilter]);

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
          <span className="px-2.5 py-1 rounded-md bg-amber-950/80 border border-amber-500/50 text-amber-300 text-[10px] font-extrabold uppercase tracking-wider font-mono shadow-[0_0_10px_rgba(245,158,11,0.3)] flex items-center gap-1 w-fit">
            <span className="material-symbols-outlined text-xs text-amber-400">smartphone</span>
            PROMOTOR
          </span>
        );
    }
  };

  const getPromoterStatusBadge = (status?: string | null) => {
    if (!status) return null;
    switch (status.toLowerCase()) {
      case 'ativo':
        return <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-mono font-bold">ATIVO</span>;
      case 'ferias':
        return <span className="px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[10px] font-mono font-bold">FÉRIAS</span>;
      case 'afastado':
        return <span className="px-2 py-0.5 rounded bg-purple-500/10 border border-purple-500/30 text-purple-300 text-[10px] font-mono font-bold">AFASTADO</span>;
      default:
        return <span className="px-2 py-0.5 rounded bg-rose-500/10 border border-rose-500/30 text-rose-400 text-[10px] font-mono font-bold">INATIVO</span>;
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
          <p className="text-xs sm:text-sm text-slate-400 mt-1 max-w-4xl">
            Associação dos logins de acesso à tabela de promotores (<code className="text-amber-400 font-mono">profiles.promotor_matricula = promotores.matricula</code>).
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

      {/* Controles de Filtros e Busca */}
      <section className="bg-[#171b26] border border-[#1e2433] rounded-2xl p-6 shadow-2xl space-y-6">
        {errorMessage && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-mono flex items-center gap-2">
            <span className="material-symbols-outlined text-lg text-rose-400">error</span>
            <span>{errorMessage}</span>
          </div>
        )}

        <div className="flex flex-col lg:flex-row items-center justify-between gap-4">
          {/* Busca por E-mail, Nome ou Matrícula */}
          <div className="relative w-full lg:w-96">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[18px]">
              search
            </span>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por e-mail, nome ou matrícula..."
              className="w-full h-10 pl-9 pr-4 bg-[#131722] border border-[#1e2433] rounded-xl text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-purple-500 transition-all font-sans"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
            {/* Filtro por Papel */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 font-mono">Papel:</span>
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value as 'all' | UserRole)}
                className="h-10 px-3 bg-[#131722] border border-[#1e2433] rounded-xl text-xs text-slate-200 focus:outline-none focus:border-purple-500 transition-all font-mono cursor-pointer"
              >
                <option value="all">Todos os Papéis</option>
                <option value="admin">Administrador</option>
                <option value="gestor">Gestor</option>
                <option value="operador">Operador</option>
                <option value="promotor">Promotor</option>
              </select>
            </div>

            {/* Filtro por Vínculo */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 font-mono">Vínculo:</span>
              <select
                value={promotorFilter}
                onChange={(e) => setPromotorFilter(e.target.value as any)}
                className="h-10 px-3 bg-[#131722] border border-[#1e2433] rounded-xl text-xs text-slate-200 focus:outline-none focus:border-purple-500 transition-all font-mono cursor-pointer"
              >
                <option value="all">Todos</option>
                <option value="linked">Vinculados</option>
                <option value="unlinked">Não Vinculados</option>
              </select>
            </div>

            {/* Filtro por Status */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 font-mono">Status:</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as 'all' | 'ativo' | 'inativo')}
                className="h-10 px-3 bg-[#131722] border border-[#1e2433] rounded-xl text-xs text-slate-200 focus:outline-none focus:border-purple-500 transition-all font-mono cursor-pointer"
              >
                <option value="all">Todos os Status</option>
                <option value="ativo">Ativos</option>
                <option value="inativo">Inativos</option>
              </select>
            </div>
          </div>
        </div>

        {/* Tabela de Perfis com as Colunas Solicitadas */}
        <div className="overflow-x-auto rounded-xl border border-[#1e2433]">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#131722] border-b border-[#1e2433] text-[11px] font-bold text-slate-400 uppercase tracking-wider font-mono">
                <th className="py-3.5 px-4">Login/E-mail</th>
                <th className="py-3.5 px-4">Papel</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4">Último Acesso</th>
                <th className="py-3.5 px-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1e2433] text-slate-300">
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-400 font-mono text-xs">
                    Carregando tabela de perfis e permissões...
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-400 font-mono text-xs">
                    Nenhum perfil encontrado com os critérios de busca.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => {
                  const isUserActive = (u.status || 'ativo') === 'ativo';
                  const isPromotorRole = u.role === 'promotor';
                  const hasMatricula = !!(u.promotor_matricula || u.promotor?.matricula);
                  const formattedDate = u.updated_at || u.created_at
                    ? new Date(u.updated_at || u.created_at!).toLocaleDateString('pt-BR', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })
                    : '--';

                  return (
                    <tr
                      key={u.id}
                      className={`transition-colors ${
                        isPromotorRole && !hasMatricula
                          ? 'bg-amber-950/20 border-l-4 border-l-amber-500 hover:bg-amber-950/35'
                          : 'hover:bg-[#131722]/60'
                      }`}
                    >
                      {/* 1. Login/E-mail */}
                      <td className="py-4 px-4 font-mono text-xs">
                        <div className="font-bold text-white leading-tight">{u.email}</div>
                        <div className="text-[11px] text-slate-400 font-sans mt-0.5">{u.name}</div>
                      </td>

                      {/* 2. Papel */}
                      <td className="py-4 px-4">{getRoleBadge(u.role)}</td>

                      {/* 3. Status */}
                      <td className="py-4 px-4">
                        <div className="flex flex-col gap-1">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-mono text-[10px] font-bold w-fit ${
                              isUserActive
                                ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-400'
                                : 'bg-rose-500/15 border border-rose-500/30 text-rose-400'
                            }`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${isUserActive ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                            {isUserActive ? 'ATIVO' : 'BLOQUEADO'}
                          </span>
                          {u.promotor?.status && getPromoterStatusBadge(u.promotor.status)}
                        </div>
                      </td>

                      {/* 4. Último Acesso */}
                      <td className="py-4 px-4 font-mono text-slate-400 text-xs">
                        {formattedDate}
                      </td>

                      {/* 5. Ações */}
                      <td className="py-4 px-4 text-right">
                        {role === 'admin' ? (
                          <div className="flex items-center justify-end gap-2">
                            <select
                              disabled={savingUserId === u.id}
                              value={u.role}
                              onChange={(e) => handleRoleChange(u.id, u.name, e.target.value as UserRole)}
                              className="h-8 px-2 bg-[#131722] border border-[#2a3042] rounded-lg text-xs font-mono text-slate-200 focus:outline-none focus:border-purple-500 transition-colors disabled:opacity-50 cursor-pointer"
                              title="Alterar papel de acesso (Somente Admin)"
                            >
                              <option value="admin">Admin</option>
                              <option value="gestor">Gestor</option>
                              <option value="operador">Operador</option>
                              <option value="promotor">Promotor</option>
                            </select>

                            <button
                              onClick={() => handleOpenEditModal(u)}
                              className="p-1.5 rounded-lg bg-[#131722] hover:bg-[#1f2433] text-slate-300 hover:text-white border border-[#1e2433] transition-colors"
                              title="Editar Vínculo Visual de Matrícula"
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

                            <button
                              disabled={savingUserId === u.id || u.id === profile?.id}
                              onClick={() => setDeleteModalUser(u)}
                              className="p-1.5 rounded-lg bg-red-950/30 hover:bg-red-900/50 text-red-400 border border-red-800/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                              title="Excluir Usuário"
                            >
                              <span className="material-symbols-outlined text-[16px]">delete</span>
                            </button>
                          </div>
                        ) : (
                          <span className="text-[10px] text-slate-500 font-mono italic">
                            Somente Admin
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
                  placeholder="ex: Kayque de Jesus Oliveira"
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
                  placeholder="ex: promotormk9@gmail.com"
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
                  <option value="promotor">Promotor de Campo</option>
                  <option value="operador">Operador de Campo</option>
                  <option value="gestor">Gestor de Operação</option>
                  <option value="admin">Administrador</option>
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

      {/* Modal Editar Perfil e Vínculo Visual */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="relative w-full max-w-lg bg-[#171b26] border border-[#1e2433] rounded-2xl shadow-2xl p-6 overflow-hidden">
            <div className="flex items-center justify-between pb-4 border-b border-[#1e2433]">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-purple-600/20 text-purple-400 border border-purple-500/30 flex items-center justify-center font-bold">
                  <span className="material-symbols-outlined text-xl">manage_accounts</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Editar Vínculo Visual</h3>
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

            <form onSubmit={handlePreSaveEdit} className="space-y-4 py-4 text-xs">
              <div className="space-y-1.5">
                <label className="font-bold text-slate-300">Login / E-mail</label>
                <input
                  type="text"
                  disabled
                  value={editingUser.email}
                  className="w-full h-10 px-3 bg-[#10141f] border border-[#1e2433] rounded-xl text-slate-400 cursor-not-allowed font-mono text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="font-bold text-slate-300">Papel RBAC</label>
                  <select
                    disabled={role !== 'admin'}
                    value={editRole}
                    onChange={(e) => setEditRole(e.target.value as UserRole)}
                    className="w-full h-10 px-3 bg-[#10141f] border border-[#1e2433] rounded-xl text-white font-mono focus:outline-none focus:border-purple-500 cursor-pointer disabled:opacity-50"
                  >
                    <option value="admin">Administrador</option>
                    <option value="gestor">Gestor de Operação</option>
                    <option value="operador">Operador de Campo</option>
                    <option value="promotor">Promotor de Campo</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="font-bold text-slate-300">Status do Acesso</label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as 'ativo' | 'inativo')}
                    className="w-full h-10 px-3 bg-[#10141f] border border-[#1e2433] rounded-xl text-white font-mono focus:outline-none focus:border-purple-500 cursor-pointer"
                  >
                    <option value="ativo">Ativo (Acesso Liberado)</option>
                    <option value="inativo">Inativo (Acesso Bloqueado)</option>
                  </select>
                </div>
              </div>

              {/* Seção Vínculo de Matrícula */}
              <div className="p-4 rounded-xl bg-[#10141f] border border-amber-500/30 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-amber-300 flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-sm">badge</span>
                    Seleção de Matrícula (profiles.promotor_matricula)
                  </label>
                  <span className="text-[10px] text-amber-400 font-mono">Relacionamento</span>
                </div>

                <select
                  value={editPromotorMatricula}
                  onChange={(e) => setEditPromotorMatricula(e.target.value)}
                  className="w-full h-10 px-3 bg-[#171b26] border border-[#1e2433] rounded-xl text-white font-mono text-xs focus:outline-none focus:border-amber-500 cursor-pointer"
                >
                  <option value="">-- Não vinculado --</option>
                  {promotoresOptions.map((p) => (
                    <option key={p.matricula} value={p.matricula}>
                      {p.matricula} - {p.nome} ({p.supervisor || 'Sem Supervisor'} | {p.equipe || 'Sem Equipe'})
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-400">
                  Associa o login aos dados de rotas, supervisor e equipe do registro em <code className="text-amber-300 font-mono">public.promotores</code>.
                </p>
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
                  Salvar Vínculo
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Confirmação de Vínculo */}
      {confirmModalData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn">
          <div className="relative w-full max-w-md bg-[#171b26] border border-amber-500/40 rounded-2xl shadow-2xl p-6 overflow-hidden space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/40 flex items-center justify-center font-bold shrink-0">
                <span className="material-symbols-outlined text-2xl">help</span>
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Confirmar Vínculo</h3>
                <p className="text-[11px] text-slate-400 font-mono">Atualização de relacionamento em tempo real</p>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-[#10141f] border border-[#1e2433] space-y-2 text-xs">
              <div className="flex justify-between border-b border-[#1e2433] pb-2">
                <span className="text-slate-400">Login / E-mail:</span>
                <span className="font-bold text-white font-mono">{confirmModalData.user.email}</span>
              </div>
              <div className="flex justify-between border-b border-[#1e2433] pb-2">
                <span className="text-slate-400">Matrícula Anterior:</span>
                <span className="font-mono text-slate-300">
                  {confirmModalData.user.promotor_matricula || 'Não vinculado'}
                </span>
              </div>
              <div className="flex justify-between pt-1">
                <span className="text-amber-300 font-semibold">Nova Matrícula:</span>
                <span className="font-mono font-bold text-amber-400">
                  {confirmModalData.newMatricula || 'Não vinculado'}
                </span>
              </div>
            </div>

            <div className="pt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmModalData(null)}
                className="px-4 py-2 rounded-xl bg-[#131722] hover:bg-[#1f2433] text-slate-300 border border-[#1e2433] text-xs font-semibold"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={savingEdit}
                onClick={() =>
                  executeSaveEdit(
                    confirmModalData.user.id,
                    confirmModalData.newMatricula || null,
                    confirmModalData.newRole,
                    confirmModalData.newDepartment,
                    confirmModalData.newStatus
                  )
                }
                className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-extrabold text-xs shadow-lg transition-all"
              >
                {savingEdit ? 'Salvando...' : 'Confirmar e Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Confirmar Exclusão de Usuário */}
      {deleteModalUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="bg-[#0b0e14] border border-red-500/30 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-red-400">
              <span className="material-symbols-outlined text-2xl">warning</span>
              <h3 className="text-base font-bold text-white">Excluir usuário?</h3>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Essa ação excluirá permanentemente o usuário <strong className="text-white">{deleteModalUser.name}</strong> ({deleteModalUser.email}) e o acesso dele ao sistema. Essa operação não pode ser desfeita.
            </p>

            <div className="pt-3 border-t border-[#1e2433] flex items-center justify-end gap-2 text-xs">
              <button
                type="button"
                disabled={deletingUser}
                onClick={() => setDeleteModalUser(null)}
                className="px-4 py-2 rounded-xl bg-[#131722] hover:bg-[#1f2433] text-slate-300 border border-[#1e2433] font-semibold"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={deletingUser}
                onClick={handleConfirmDelete}
                className="px-5 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold disabled:opacity-50 flex items-center gap-1.5"
              >
                {deletingUser ? (
                  <span>Excluindo...</span>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-sm">delete</span>
                    <span>Excluir usuário</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
