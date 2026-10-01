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
  const { profile, role, updateUserProfile, inviteUser } = useAuth();
  const [usersList, setUsersList] = useState<ExtendedUserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'ativo' | 'inativo'>('all');
  const [promotorFilter, setPromotorFilter] = useState<'all' | 'linked' | 'unlinked' | 'unlinked_promoter'>('all');
  const [savingUserId, setSavingUserId] = useState<string | null>(null);

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
      setUsersList(profile ? [profile] : []);
      setLoading(false);
      return;
    }

    try {
      // Execute relational query between profiles and promotores
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
        // Fallback standard select if FK relationship alias varies in PostgREST schema
        const fallbackRes = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
        if (fallbackRes.error) {
          setErrorMessage(`Falha ao carregar perfis do Supabase: ${fallbackRes.error.message}`);
          if (profile) setUsersList([profile]);
        } else {
          rawProfiles = fallbackRes.data || [];
        }
      } else {
        rawProfiles = profilesRes.data || [];
      }

      const promotoresMap = new Map<string, PromoterRecord>();
      if (promotoresRes.data) {
        const list: PromoterRecord[] = promotoresRes.data.map((p: any) => ({
          id: p.id,
          matricula: p.matricula,
          nome: p.nome || p.name || 'Promotor Sem Nome',
          supervisor: p.supervisor || null,
          equipe: p.equipe || p.squad || null,
          status: p.status || 'ativo'
        }));
        setPromotoresOptions(list);
        list.forEach((p) => promotoresMap.set(p.matricula, p));
      }

      const mergedList: ExtendedUserProfile[] = rawProfiles.map((p: any) => {
        let linkedPromoter: PromoterRecord | null = null;
        if (p.promotor) {
          linkedPromoter = Array.isArray(p.promotor) ? p.promotor[0] : p.promotor;
          if (linkedPromoter) {
            linkedPromoter = {
              matricula: linkedPromoter.matricula,
              nome: linkedPromoter.nome || (linkedPromoter as any).name || 'Promotor Sem Nome',
              supervisor: linkedPromoter.supervisor || null,
              equipe: linkedPromoter.equipe || (linkedPromoter as any).squad || null,
              status: linkedPromoter.status || 'ativo'
            };
          }
        }
        
        if (!linkedPromoter && p.promotor_matricula && promotoresMap.has(p.promotor_matricula)) {
          linkedPromoter = promotoresMap.get(p.promotor_matricula)!;
        }

        return {
          ...p,
          role: (p.role as UserRole) || 'operador',
          promotor: linkedPromoter
        };
      });

      setUsersList(mergedList);
    } catch (err) {
      setErrorMessage(`Erro ao conectar com o banco de dados: ${String(err)}`);
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
      // Abre modal de confirmação antes de alterar o vínculo
      setConfirmModalData({
        user: editingUser,
        newMatricula: editPromotorMatricula.trim(),
        newRole: editRole,
        newDepartment: editDepartment,
        newStatus: editStatus
      });
    } else {
      // Executa direto se a matrícula não mudou
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
      // Encontra dados do novo promotor vinculado
      const newPromoterObj = newMatricula
        ? promotoresOptions.find((p) => p.matricula === newMatricula) || {
            matricula: newMatricula,
            nome: 'Promotor Vinculado',
            status: 'ativo'
          }
        : null;

      // Atualiza lista local imediatamente
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
        title: 'Vínculo e Perfil Atualizados',
        message: `As alterações de perfil e vínculo para ${editingUser?.name || 'o usuário'} foram aplicadas com sucesso.`,
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
        message: 'Preencha o e-mail e o nome completo do usuário.',
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
        message: `Convite de acesso enviado com sucesso para ${inviteEmail}.`,
        type: 'success'
      });
    }
  };

  // Filtragem avançada dos usuários
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
      } else if (promotorFilter === 'unlinked_promoter') {
        matchesPromotorFilter = u.role === 'promotor' && !u.promotor_matricula;
      }

      return matchesSearch && matchesRole && matchesStatus && matchesPromotorFilter;
    });
  }, [usersList, searchTerm, roleFilter, statusFilter, promotorFilter]);

  // Contadores para resumos e alertas
  const totalPromotores = usersList.filter((u) => u.role === 'promotor').length;
  const unlinkedPromotoresCount = usersList.filter((u) => u.role === 'promotor' && !u.promotor_matricula).length;

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
            Gestão de usuários Auth, associação de papéis RBAC (<code className="text-purple-400 font-mono">Admin</code>, <code className="text-cyan-400 font-mono">Gestor</code>, <code className="text-emerald-400 font-mono">Operador</code>, <code className="text-amber-400 font-mono">Promotor</code>) e vínculo direto com o cadastro de <strong>public.promotores</strong>.
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

      {/* Alerta de Promotores sem Vínculo */}
      {unlinkedPromotoresCount > 0 && (
        <section className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between gap-4 shadow-lg animate-fadeIn">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/40 flex items-center justify-center shrink-0 font-bold">
              <span className="material-symbols-outlined text-2xl">warning</span>
            </div>
            <div>
              <h4 className="text-sm font-bold text-amber-200">
                {unlinkedPromotoresCount} {unlinkedPromotoresCount === 1 ? 'usuário promotor sem matrícula vinculada' : 'usuários promotores sem matrícula vinculada'}
              </h4>
              <p className="text-xs text-amber-300/80">
                Usuários com o papel <strong>Promotor</strong> precisam estar vinculados a um registro em <strong>public.promotores</strong> para acessar suas rotas e visitas.
              </p>
            </div>
          </div>
          <button
            onClick={() => setPromotorFilter('unlinked_promoter')}
            className="px-3.5 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 font-bold text-xs shrink-0 transition-colors"
          >
            Filtrar Pendentes ({unlinkedPromotoresCount})
          </button>
        </section>
      )}

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
            Acesso irrestrito a todos os módulos, parametrizações globais, usuários e finanças.
          </p>
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
            Supervisão operacional, gestão de equipes, acompanhamento de presença e criação de rotas.
          </p>
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
            Painéis operacionais de rotas, lojas e relatórios gerais da central.
          </p>
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
            Acesso exclusivo ao Portal Mobile do Promotor, suas rotas, check-in e fotos de campo.
          </p>
        </div>
      </section>

      {/* Controls & Filters */}
      <section className="bg-[#171b26] border border-[#1e2433] rounded-2xl p-6 shadow-2xl space-y-6">
        {errorMessage && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-mono flex items-center gap-2">
            <span className="material-symbols-outlined text-lg text-rose-400">error</span>
            <span>{errorMessage}</span>
          </div>
        )}

        <div className="flex flex-col lg:flex-row items-center justify-between gap-4">
          <div className="relative w-full lg:w-96">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[18px]">
              search
            </span>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por nome, e-mail, matrícula, supervisor ou equipe..."
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
                <option value="admin">Admin</option>
                <option value="gestor">Gestor</option>
                <option value="operador">Operador</option>
                <option value="promotor">Promotor</option>
              </select>
            </div>

            {/* Filtro por Vínculo de Promotor */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 font-mono">Vínculo:</span>
              <select
                value={promotorFilter}
                onChange={(e) => setPromotorFilter(e.target.value as any)}
                className="h-10 px-3 bg-[#131722] border border-[#1e2433] rounded-xl text-xs text-slate-200 focus:outline-none focus:border-purple-500 transition-all font-mono cursor-pointer"
              >
                <option value="all">Todos os Registros</option>
                <option value="linked">Apenas Vinculados</option>
                <option value="unlinked">Apenas Não Vinculados</option>
                <option value="unlinked_promoter">⚠️ Promotores Sem Vínculo</option>
              </select>
            </div>

            {/* Filtro por Status da Conta */}
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

        {/* Tabela de Usuários e Vínculos */}
        <div className="overflow-x-auto rounded-xl border border-[#1e2433]">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#131722] border-b border-[#1e2433] text-[11px] font-bold text-slate-400 uppercase tracking-wider font-mono">
                <th className="py-3.5 px-4">Usuário Auth</th>
                <th className="py-3.5 px-4">Papel</th>
                <th className="py-3.5 px-4">Matrícula Promotor</th>
                <th className="py-3.5 px-4">Nome no Cadastro</th>
                <th className="py-3.5 px-4">Status Promotor</th>
                <th className="py-3.5 px-4">Supervisor / Equipe</th>
                <th className="py-3.5 px-4">Último Acesso</th>
                <th className="py-3.5 px-4">Status Acesso</th>
                <th className="py-3.5 px-4 text-right">Ações de Vínculo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1e2433] text-slate-300">
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400 font-mono text-xs">
                    Carregando tabela de usuários e relacionamentos...
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400 font-mono text-xs">
                    Nenhum perfil encontrado com os filtros selecionados.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => {
                  const isUserActive = (u.status || 'ativo') === 'ativo';
                  const isPromotorRole = u.role === 'promotor';
                  const isUnlinkedPromoter = isPromotorRole && !u.promotor_matricula;
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
                        isUnlinkedPromoter
                          ? 'bg-amber-950/20 border-l-4 border-l-amber-500 hover:bg-amber-950/35'
                          : 'hover:bg-[#131722]/60'
                      }`}
                    >
                      {/* Usuário Auth */}
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-3">
                          <div className={`w-9 h-9 rounded-full font-extrabold flex items-center justify-center text-xs shadow-inner ${
                            isUnlinkedPromoter 
                              ? 'bg-amber-950/90 border border-amber-500/50 text-amber-200' 
                              : 'bg-purple-950/80 border border-purple-500/40 text-purple-200'
                          }`}>
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

                      {/* Papel */}
                      <td className="py-4 px-4">{getRoleBadge(u.role)}</td>

                      {/* Matrícula do Promotor */}
                      <td className="py-4 px-4 font-mono text-xs">
                        {u.promotor_matricula ? (
                          <span className="px-2.5 py-1 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300 font-bold flex items-center gap-1 w-fit">
                            <span className="material-symbols-outlined text-xs">badge</span>
                            {u.promotor_matricula}
                          </span>
                        ) : (
                          <span className={`px-2.5 py-1 rounded text-[11px] font-mono font-bold flex items-center gap-1 w-fit ${
                            isPromotorRole
                              ? 'bg-rose-500/15 border border-rose-500/40 text-rose-300 animate-pulse'
                              : 'bg-slate-800/60 border border-slate-700/50 text-slate-500'
                          }`}>
                            {isPromotorRole && <span className="material-symbols-outlined text-xs">warning</span>}
                            Não vinculado
                          </span>
                        )}
                      </td>

                      {/* Nome no Cadastro (Promotor) */}
                      <td className="py-4 px-4 font-sans font-medium text-slate-200">
                        {u.promotor?.nome ? (
                          <div className="flex flex-col">
                            <span className="font-semibold text-slate-100">{u.promotor.nome}</span>
                            <span className="text-[10px] text-slate-500 font-mono">public.promotores</span>
                          </div>
                        ) : (
                          <span className="text-slate-500 text-xs italic">Não vinculado</span>
                        )}
                      </td>

                      {/* Status Promotor */}
                      <td className="py-4 px-4">
                        {u.promotor ? getPromoterStatusBadge(u.promotor.status) : <span className="text-slate-600">—</span>}
                      </td>

                      {/* Supervisor & Equipe */}
                      <td className="py-4 px-4">
                        {u.promotor ? (
                          <div className="flex flex-col text-[11px]">
                            <span className="text-slate-200 font-medium">{u.promotor.supervisor || 'Sem Supervisor'}</span>
                            <span className="text-cyan-400/80 font-mono text-[10px]">{u.promotor.equipe || 'Sem Equipe'}</span>
                          </div>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>

                      {/* Último Acesso */}
                      <td className="py-4 px-4 font-mono text-slate-400 text-xs">
                        {formattedDate}
                      </td>

                      {/* Status do Acesso */}
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

                      {/* Ações de Vínculo */}
                      <td className="py-4 px-4 text-right">
                        {role === 'admin' ? (
                          <div className="flex items-center justify-end gap-2">
                            <select
                              disabled={savingUserId === u.id}
                              value={u.role}
                              onChange={(e) => handleRoleChange(u.id, u.name, e.target.value as UserRole)}
                              className="h-8 px-2 bg-[#131722] border border-[#2a3042] rounded-lg text-xs font-mono text-slate-200 focus:outline-none focus:border-purple-500 transition-colors disabled:opacity-50 cursor-pointer"
                              title="Alterar papel (Privilégio de Admin)"
                            >
                              <option value="admin">Admin</option>
                              <option value="gestor">Gestor</option>
                              <option value="operador">Operador</option>
                              <option value="promotor">Promotor</option>
                            </select>

                            <button
                              onClick={() => handleOpenEditModal(u)}
                              className={`p-1.5 rounded-lg border transition-all ${
                                isUnlinkedPromoter
                                  ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border-amber-500/50 shadow-[0_0_10px_rgba(245,158,11,0.2)]'
                                  : 'bg-[#131722] hover:bg-[#1f2433] text-slate-300 hover:text-white border-[#1e2433]'
                              }`}
                              title="Editar Perfil e Vínculo de Matrícula"
                            >
                              <span className="material-symbols-outlined text-[16px]">link</span>
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

      {/* Modal Editar Perfil e Vínculo */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="relative w-full max-w-lg bg-[#171b26] border border-[#1e2433] rounded-2xl shadow-2xl p-6 overflow-hidden">
            <div className="flex items-center justify-between pb-4 border-b border-[#1e2433]">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-purple-600/20 text-purple-400 border border-purple-500/30 flex items-center justify-center font-bold">
                  <span className="material-symbols-outlined text-xl">manage_accounts</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Vincular Login ao Promotor</h3>
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
                <label className="font-bold text-slate-300">Nome do Usuário</label>
                <input
                  type="text"
                  disabled
                  value={editingUser.name}
                  className="w-full h-10 px-3 bg-[#10141f] border border-[#1e2433] rounded-xl text-slate-400 cursor-not-allowed font-medium"
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

              <div className="space-y-1.5">
                <label className="font-bold text-slate-300">Departamento</label>
                <input
                  type="text"
                  value={editDepartment}
                  onChange={(e) => setEditDepartment(e.target.value)}
                  className="w-full h-10 px-3 bg-[#10141f] border border-[#1e2433] rounded-xl text-white focus:outline-none focus:border-purple-500"
                />
              </div>

              {/* Seção Vínculo com public.promotores */}
              <div className="p-4 rounded-xl bg-[#10141f] border border-amber-500/30 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-amber-300 flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-sm">badge</span>
                    Vínculo de Matrícula (public.promotores)
                  </label>
                  <span className="text-[10px] text-amber-400 font-mono">Chave relacional</span>
                </div>

                {promotoresOptions.length > 0 ? (
                  <select
                    value={editPromotorMatricula}
                    onChange={(e) => setEditPromotorMatricula(e.target.value)}
                    className="w-full h-10 px-3 bg-[#171b26] border border-[#1e2433] rounded-xl text-white font-mono text-xs focus:outline-none focus:border-amber-500 cursor-pointer"
                  >
                    <option value="">-- Sem Matrícula Vinculada --</option>
                    {promotoresOptions.map((p) => (
                      <option key={p.matricula} value={p.matricula}>
                        {p.matricula} - {p.nome} ({p.supervisor || 'Sem Sup.'} | {p.equipe || 'Sem Eq.'})
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    placeholder="Digite a matrícula do promotor (ex: PROM001)"
                    value={editPromotorMatricula}
                    onChange={(e) => setEditPromotorMatricula(e.target.value)}
                    className="w-full h-10 px-3 bg-[#171b26] border border-[#1e2433] rounded-xl text-white font-mono text-xs focus:outline-none focus:border-amber-500"
                  />
                )}
                <p className="text-[11px] text-slate-400">
                  O Portal do Promotor filtra rotas e visitas baseando-se no campo <code className="text-amber-300 font-mono">promotor_matricula</code>.
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
                  Salvar Alterações
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Confirmação de Alteração de Vínculo */}
      {confirmModalData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn">
          <div className="relative w-full max-w-md bg-[#171b26] border border-amber-500/40 rounded-2xl shadow-2xl p-6 overflow-hidden space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/40 flex items-center justify-center font-bold shrink-0">
                <span className="material-symbols-outlined text-2xl">help</span>
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Confirmar Alteração de Vínculo</h3>
                <p className="text-[11px] text-slate-400 font-mono">Associação de conta de acesso a promotor</p>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-[#10141f] border border-[#1e2433] space-y-2 text-xs">
              <div className="flex justify-between border-b border-[#1e2433] pb-2">
                <span className="text-slate-400">Usuário Auth:</span>
                <span className="font-bold text-white">{confirmModalData.user.email}</span>
              </div>
              <div className="flex justify-between border-b border-[#1e2433] pb-2">
                <span className="text-slate-400">Vínculo Atual:</span>
                <span className="font-mono text-slate-300">
                  {confirmModalData.user.promotor_matricula || 'Nenhum'}
                </span>
              </div>
              <div className="flex justify-between pt-1">
                <span className="text-amber-300 font-semibold">Novo Vínculo:</span>
                <span className="font-mono font-bold text-amber-400">
                  {confirmModalData.newMatricula || 'Remover Vínculo'}
                </span>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Tem certeza que deseja aplicar esta alteração? O usuário passará a visualizar apenas os dados da nova matrícula especificada.
            </p>

            <div className="pt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmModalData(null)}
                className="px-4 py-2 rounded-xl bg-[#131722] hover:bg-[#1f2433] text-slate-300 border border-[#1e2433] text-xs font-semibold"
              >
                Voltar
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
                {savingEdit ? 'Gravando...' : 'Confirmar e Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
