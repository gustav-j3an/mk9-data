import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ScreenId, ToastMessage, Supervisor, SupervisorStatus } from '../types';
import { supervisoresService } from '../lib/supervisoresService';
import { equipesService } from '../lib/equipesService';
import { useAuth } from '../auth/AuthProvider';

interface SupervisorsManagementViewProps {
  onNavigate: (screen: ScreenId) => void;
  onShowToast: (toast: Omit<ToastMessage, 'id'>) => void;
}

export const SupervisorsManagementView: React.FC<SupervisorsManagementViewProps> = ({
  onNavigate,
  onShowToast
}) => {
  const { role } = useAuth();
  const canEdit = role === 'admin' || role === 'gestor';

  // State
  const [supervisores, setSupervisores] = useState<Supervisor[]>([]);
  const [equipes, setEquipes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | SupervisorStatus>('all');
  const [regionFilter, setRegionFilter] = useState('all');

  // Modals
  const [modalOpen, setModalOpen] = useState(false);
  const [editingSupervisor, setEditingSupervisor] = useState<Supervisor | null>(null);
  const [suggestedCode, setSuggestedCode] = useState('');
  const [manualCode, setManualCode] = useState('');
  const [formNome, setFormNome] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formTelefone, setFormTelefone] = useState('');
  const [formRegional, setFormRegional] = useState('');
  const [formStatus, setFormStatus] = useState<SupervisorStatus>('ativo');

  // Drawer / Details Modal
  const [selectedSupervisor, setSelectedSupervisor] = useState<Supervisor | null>(null);

  // Inactivation Modal
  const [inactivateModalSupervisor, setInactivateModalSupervisor] = useState<Supervisor | null>(null);

  // 1. Carregar dados de Supervisores e Equipes
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [supRes, eqRes] = await Promise.all([
      supervisoresService.listSupervisores(),
      equipesService.listEquipes()
    ]);

    if (supRes.error) {
      setError(supRes.error.message);
      setSupervisores([]);
    } else {
      setSupervisores(supRes.data || []);
    }

    if (eqRes.data) {
      setEquipes(eqRes.data);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 2. Mapeamento de equipes supervisionadas por supervisor
  // Associa por supervisor_id OU por supervisor_nome (para compatibilidade histórica)
  const supervisorEquipesMap = useMemo(() => {
    const map = new Map<string, any[]>();
    equipes.forEach((eq) => {
      const supId = eq.supervisor_id;
      const supNome = eq.supervisor_nome?.trim().toLowerCase();

      // Procurar supervisor correspondente
      const match = supervisores.find(
        (s) => s.id === supId || (supNome && s.nome.trim().toLowerCase() === supNome)
      );

      if (match) {
        const list = map.get(match.id) || [];
        list.push(eq);
        map.set(match.id, list);
      }
    });
    return map;
  }, [equipes, supervisores]);

  // 3. Abrir Modal de Criação
  const handleOpenCreateModal = async () => {
    setEditingSupervisor(null);
    setFormNome('');
    setFormEmail('');
    setFormTelefone('');
    setFormRegional('');
    setFormStatus('ativo');
    setSuggestedCode('');
    setManualCode('');
    setModalOpen(true);

    const res = await supervisoresService.getNextCode();
    if (res.data) {
      setSuggestedCode(res.data);
    }
  };

  // 4. Abrir Modal de Edição
  const handleOpenEditModal = (sup: Supervisor) => {
    setEditingSupervisor(sup);
    setFormNome(sup.nome);
    setFormEmail(sup.email || '');
    setFormTelefone(sup.telefone || '');
    setFormRegional(sup.regional || '');
    setFormStatus(sup.status);
    setManualCode(sup.codigo);
    setModalOpen(true);
  };

  // 5. Salvar Supervisor (Create ou Update)
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formNome.trim()) {
      onShowToast({
        title: 'Nome Obrigatório',
        message: 'O nome completo do supervisor é obrigatório.',
        type: 'warning'
      });
      return;
    }

    setSaving(true);

    if (editingSupervisor) {
      const res = await supervisoresService.updateSupervisor(editingSupervisor.id, {
        nome: formNome.trim(),
        codigo: manualCode.trim() || undefined,
        email: formEmail.trim() || null,
        telefone: formTelefone.trim() || null,
        regional: formRegional.trim() || null,
        status: formStatus
      });

      setSaving(false);

      if (res.error || !res.data) {
        onShowToast({
          title: 'Erro ao Atualizar',
          message: res.error?.message || 'Falha ao atualizar supervisor.',
          type: 'error'
        });
        return;
      }

      onShowToast({
        title: 'Supervisor Atualizado',
        message: `Dados de ${res.data.nome} foram salvos com sucesso.`,
        type: 'success'
      });

      setModalOpen(false);
      loadData();
    } else {
      const res = await supervisoresService.createSupervisor({
        nome: formNome.trim(),
        codigo: manualCode.trim() || undefined,
        email: formEmail.trim() || null,
        telefone: formTelefone.trim() || null,
        regional: formRegional.trim() || null,
        status: formStatus
      });

      setSaving(false);

      if (res.error || !res.data) {
        onShowToast({
          title: 'Erro ao Cadastrar',
          message: res.error?.message || 'Falha ao cadastrar supervisor.',
          type: 'error'
        });
        return;
      }

      onShowToast({
        title: 'Supervisor Cadastrado',
        message: `${res.data.nome} (${res.data.codigo}) cadastrado com sucesso.`,
        type: 'success'
      });

      setModalOpen(false);
      loadData();
    }
  };

  // 6. Inativação com Verificação de Vínculos
  const handleConfirmInactivation = async () => {
    if (!inactivateModalSupervisor) return;

    setSaving(true);
    const res = await supervisoresService.inactivateSupervisor(inactivateModalSupervisor.id);
    setSaving(false);

    if (res.error || !res.data) {
      onShowToast({
        title: 'Erro ao Inativar',
        message: res.error?.message || 'Falha ao inativar supervisor.',
        type: 'error'
      });
      return;
    }

    onShowToast({
      title: 'Supervisor Inativado',
      message: `${res.data.nome} foi inativado. Suas equipes continuam registradas no histórico.`,
      type: 'info'
    });

    setInactivateModalSupervisor(null);
    loadData();
  };

  // 7. Extrair Regionais disponíveis
  const availableRegions = useMemo(() => {
    const set = new Set<string>();
    supervisores.forEach((s) => {
      if (s.regional && s.regional.trim()) {
        set.add(s.regional.trim());
      }
    });
    return Array.from(set).sort();
  }, [supervisores]);

  // 8. Filtragem de supervisores
  const filteredSupervisores = useMemo(() => {
    return supervisores.filter((s) => {
      const term = search.toLowerCase().trim();
      const matchesSearch =
        !term ||
        s.nome.toLowerCase().includes(term) ||
        s.codigo.toLowerCase().includes(term) ||
        (s.email && s.email.toLowerCase().includes(term)) ||
        (s.regional && s.regional.toLowerCase().includes(term));

      const matchesStatus = statusFilter === 'all' || s.status === statusFilter;
      const matchesRegion = regionFilter === 'all' || s.regional === regionFilter;

      return matchesSearch && matchesStatus && matchesRegion;
    });
  }, [supervisores, search, statusFilter, regionFilter]);

  // Contadores
  const totalSupervisores = supervisores.length;
  const totalAtivos = useMemo(() => supervisores.filter((s) => s.status === 'ativo').length, [supervisores]);
  const totalInativos = useMemo(() => supervisores.filter((s) => s.status === 'inativo').length, [supervisores]);
  const totalFerias = useMemo(() => supervisores.filter((s) => s.status === 'ferias').length, [supervisores]);

  const getInitials = (nome: string) => {
    if (!nome) return 'SP';
    const parts = nome.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  return (
    <div className="w-full px-4 lg:px-8 py-6 max-w-[1720px] mx-auto space-y-6">
      {/* Header */}
      <section className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="flex flex-col space-y-1.5 max-w-3xl">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full bg-cyan-600/20 text-cyan-800 border border-cyan-500/30 font-mono text-[11px] font-bold uppercase tracking-wider">
              Liderança &amp; Gestão de Campo
            </span>
            <span className="font-mono text-xs text-[#77766F]">• Conectado ao Supabase</span>
          </div>
          <h1 className="text-2xl lg:text-3xl font-extrabold text-[#171717] tracking-tight">
            Gestão de Supervisores
          </h1>
          <p className="text-sm text-[#5F5F5F] leading-relaxed">
            Cadastre a liderança regional de campo, acompanhe equipes subordinadas e mantenha os vínculos operacionais sem duplicações.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => onNavigate('gestao-equipes')}
            className="px-4 py-2.5 rounded-xl border border-[#CFCDC5] bg-[#EAE8E2] hover:bg-[#E4E2DB] text-[#171717] text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer"
          >
            <span className="material-symbols-outlined text-purple-700 text-lg">groups</span>
            <span>Gestão de Equipes</span>
          </button>

          {canEdit && (
            <button
              onClick={handleOpenCreateModal}
              className="px-4 py-2.5 rounded-xl bg-[#222222] hover:bg-black text-white text-xs font-bold flex items-center gap-2 transition-all shadow-md cursor-pointer"
            >
              <span className="material-symbols-outlined text-lg">person_add</span>
              <span>Novo Supervisor</span>
            </button>
          )}
        </div>
      </section>

      {/* KPI Cards */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-[#F7F6F2] border border-[#CFCDC5] shadow-xs">
          <span className="text-[11px] text-[#77766F] font-semibold uppercase tracking-wider block">Total Cadastrado</span>
          <div className="text-2xl font-black text-[#171717] mt-1 font-mono">{totalSupervisores}</div>
        </div>
        <div className="p-4 rounded-xl bg-[#F7F6F2] border border-[#CFCDC5] shadow-xs">
          <span className="text-[11px] text-emerald-800 font-semibold uppercase tracking-wider block">Supervisores Ativos</span>
          <div className="text-2xl font-black text-emerald-700 mt-1 font-mono">{totalAtivos}</div>
        </div>
        <div className="p-4 rounded-xl bg-[#F7F6F2] border border-[#CFCDC5] shadow-xs">
          <span className="text-[11px] text-cyan-800 font-semibold uppercase tracking-wider block">Em Férias / Afastados</span>
          <div className="text-2xl font-black text-cyan-700 mt-1 font-mono">{totalFerias}</div>
        </div>
        <div className="p-4 rounded-xl bg-[#F7F6F2] border border-[#CFCDC5] shadow-xs">
          <span className="text-[11px] text-[#77766F] font-semibold uppercase tracking-wider block">Inativos</span>
          <div className="text-2xl font-black text-[#5F5F5F] mt-1 font-mono">{totalInativos}</div>
        </div>
      </section>

      {/* Alerta de Tabela Inexistente / Erro Orientativo */}
      {error && (
        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-900 flex items-start gap-3">
          <span className="material-symbols-outlined text-amber-600 text-2xl shrink-0 mt-0.5">warning</span>
          <div className="space-y-1">
            <h4 className="font-bold text-sm text-amber-800">Aviso do Módulo de Supervisores</h4>
            <p className="text-xs text-amber-900 leading-relaxed">
              Não foi possível consultar a tabela <code className="font-mono bg-amber-200/50 px-1 py-0.5 rounded">public.supervisores</code> ({error}).
            </p>
            <p className="text-xs text-[#5F5F5F]">
              Certifique-se de que a migração de estrutura <code className="font-mono text-purple-700">20261016100000_create_supervisores_table.sql</code> foi devidamente aplicada no banco Supabase conectado.
            </p>
          </div>
        </div>
      )}

      {/* Filtros e Busca */}
      <section className="p-4 rounded-xl bg-[#F7F6F2] border border-[#CFCDC5] shadow-xs flex flex-col md:flex-row gap-3 items-center justify-between">
        <div className="relative w-full md:w-96">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-lg">search</span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome, código, e-mail ou regional..."
            className="w-full h-10 pl-9 pr-3 bg-[#E4E2DB] border border-[#CFCDC5] rounded-lg text-xs text-[#171717] focus:outline-none focus:border-purple-500"
          />
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="h-10 px-3 bg-[#E4E2DB] border border-[#CFCDC5] rounded-lg text-xs text-[#171717] focus:outline-none focus:border-purple-500"
          >
            <option value="all">Todos os Status</option>
            <option value="ativo">Apenas Ativos</option>
            <option value="ferias">Em Férias</option>
            <option value="afastado">Afastados</option>
            <option value="inativo">Inativos</option>
          </select>

          <select
            value={regionFilter}
            onChange={(e) => setRegionFilter(e.target.value)}
            className="h-10 px-3 bg-[#E4E2DB] border border-[#CFCDC5] rounded-lg text-xs text-[#171717] focus:outline-none focus:border-purple-500"
          >
            <option value="all">Todas as Regionais</option>
            {availableRegions.map((reg) => (
              <option key={reg} value={reg}>
                {reg}
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* Grid de Cards de Supervisores */}
      {loading ? (
        <div className="py-20 text-center text-[#77766F] space-y-3">
          <span className="material-symbols-outlined text-4xl animate-spin text-purple-600">sync</span>
          <p className="text-xs font-semibold">Carregando liderança de campo do Supabase...</p>
        </div>
      ) : filteredSupervisores.length === 0 ? (
        <div className="py-16 text-center rounded-2xl bg-[#F7F6F2] border border-[#CFCDC5] p-8 space-y-4">
          <div className="w-14 h-14 rounded-full bg-[#EAE8E2] border border-[#CFCDC5] flex items-center justify-center mx-auto text-[#77766F]">
            <span className="material-symbols-outlined text-3xl">supervisor_account</span>
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-bold text-[#171717]">Nenhum supervisor encontrado</h3>
            <p className="text-xs text-[#5F5F5F] max-w-md mx-auto">
              {search || statusFilter !== 'all' || regionFilter !== 'all'
                ? 'Nenhum registro corresponde aos filtros de busca aplicados.'
                : 'Cadastre o primeiro supervisor para organizar a gestão de equipes e promotores.'}
            </p>
          </div>
          {canEdit && (
            <button
              onClick={handleOpenCreateModal}
              className="px-4 py-2 rounded-xl bg-[#222222] hover:bg-black text-white text-xs font-bold inline-flex items-center gap-2 cursor-pointer shadow-xs"
            >
              <span className="material-symbols-outlined text-base">person_add</span>
              <span>Cadastrar Primeiro Supervisor</span>
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredSupervisores.map((sup) => {
            const squads = supervisorEquipesMap.get(sup.id) || [];
            const isInactive = sup.status === 'inativo';

            return (
              <div
                key={sup.id}
                className={`p-5 rounded-2xl border transition-all space-y-4 ${
                  isInactive
                    ? 'bg-[#F0EEE8] border-[#CFCDC5] opacity-80'
                    : 'bg-[#F7F6F2] border-[#CFCDC5] hover:border-purple-500/50 shadow-xs'
                }`}
              >
                {/* Card Top */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-purple-600/20 text-purple-700 border border-purple-500/30 flex items-center justify-center font-bold font-mono text-sm">
                      {getInitials(sup.nome)}
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-[#171717] leading-tight">{sup.nome}</h3>
                      <span className="text-[10px] text-cyan-800 font-mono font-bold bg-[#EAE8E2] px-1.5 py-0.2 rounded border border-[#CFCDC5]">
                        {sup.codigo}
                      </span>
                    </div>
                  </div>

                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold font-mono ${
                      sup.status === 'ativo'
                        ? 'bg-emerald-500/15 text-emerald-800 border border-emerald-500/30'
                        : sup.status === 'ferias'
                        ? 'bg-cyan-500/15 text-cyan-800 border border-cyan-500/30'
                        : sup.status === 'afastado'
                        ? 'bg-amber-500/15 text-amber-800 border border-amber-500/30'
                        : 'bg-slate-700 text-[#77766F] border border-slate-600'
                    }`}
                  >
                    {sup.status.toUpperCase()}
                  </span>
                </div>

                {/* Card Info */}
                <div className="space-y-1.5 text-xs text-[#5F5F5F] pt-2 border-t border-[#CFCDC5]/60">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-sm text-[#77766F]">location_on</span>
                    <span>{sup.regional || 'Regional não definida'}</span>
                  </div>
                  {sup.email && (
                    <div className="flex items-center gap-2 truncate">
                      <span className="material-symbols-outlined text-sm text-[#77766F]">mail</span>
                      <span className="truncate">{sup.email}</span>
                    </div>
                  )}
                  {sup.telefone && (
                    <div className="flex items-center gap-2 font-mono">
                      <span className="material-symbols-outlined text-sm text-emerald-600">call</span>
                      <span>{sup.telefone}</span>
                    </div>
                  )}
                </div>

                {/* Squads Supervised Summary */}
                <div className="p-2.5 rounded-xl bg-[#EAE8E2] border border-[#CFCDC5] flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-purple-700 text-base">groups</span>
                    <span className="font-semibold text-[#171717]">{squads.length} equipe(s) liderada(s)</span>
                  </div>
                  <button
                    onClick={() => setSelectedSupervisor(sup)}
                    className="text-[11px] text-purple-700 font-bold hover:underline cursor-pointer"
                  >
                    Ver detalhes
                  </button>
                </div>

                {/* Actions */}
                {canEdit && (
                  <div className="flex items-center justify-end gap-2 pt-1 border-t border-[#CFCDC5]/60">
                    <button
                      onClick={() => handleOpenEditModal(sup)}
                      className="px-3 py-1.5 rounded-lg bg-[#EAE8E2] hover:bg-[#E4E2DB] text-[#171717] text-xs font-semibold flex items-center gap-1 border border-[#CFCDC5] cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-sm text-purple-700">edit</span>
                      <span>Editar</span>
                    </button>

                    {sup.status !== 'inativo' && (
                      <button
                        onClick={() => setInactivateModalSupervisor(sup)}
                        className="px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-700 text-xs font-semibold flex items-center gap-1 border border-red-500/30 cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-sm">block</span>
                        <span>Inativar</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal Cadastro / Edição */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="relative w-full max-w-lg bg-[#F7F6F2] border border-[#CFCDC5] rounded-2xl shadow-2xl p-6 overflow-hidden">
            <div className="flex items-center justify-between pb-4 border-b border-[#CFCDC5]">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-cyan-600/20 text-cyan-800 border border-cyan-500/30 flex items-center justify-center">
                  <span className="material-symbols-outlined text-xl">supervisor_account</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#171717]">
                    {editingSupervisor ? 'Editar Supervisor' : 'Novo Supervisor de Campo'}
                  </h3>
                  <p className="text-[11px] text-[#77766F]">
                    {editingSupervisor ? `Código: ${editingSupervisor.codigo}` : 'Cadastro de liderança regional'}
                  </p>
                </div>
              </div>
              <button
                disabled={saving}
                onClick={() => setModalOpen(false)}
                className="text-[#77766F] hover:text-[#171717] p-1 cursor-pointer"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 py-4 text-xs">
              <div className="space-y-1">
                <label className="font-bold text-[#171717]">Nome Completo *</label>
                <input
                  type="text"
                  required
                  disabled={saving}
                  value={formNome}
                  onChange={(e) => setFormNome(e.target.value)}
                  placeholder="ex: Renata Vasconcelos de Souza"
                  className="w-full h-10 px-3 bg-[#E4E2DB] border border-[#CFCDC5] rounded-lg text-[#171717] focus:outline-none focus:border-purple-500 disabled:opacity-60"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <label className="font-bold text-[#171717]">Código do Supervisor</label>
                  {suggestedCode && !editingSupervisor && (
                    <span className="text-[10px] text-cyan-800 font-mono font-bold">
                      Sugerido: <strong>{suggestedCode}</strong>
                    </span>
                  )}
                </div>
                <input
                  type="text"
                  value={manualCode}
                  disabled={saving}
                  onChange={(e) => setManualCode(e.target.value)}
                  placeholder={suggestedCode ? `Auto: ${suggestedCode}` : 'Deixe em branco para auto-gerar (SUP-XXX)'}
                  className="w-full h-10 px-3 bg-[#E4E2DB] border border-[#CFCDC5] rounded-lg text-[#171717] font-mono focus:outline-none focus:border-purple-500 disabled:opacity-60"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-[#171717]">E-mail</label>
                  <input
                    type="email"
                    disabled={saving}
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    placeholder="supervisor@mk9.com.br"
                    className="w-full h-10 px-3 bg-[#E4E2DB] border border-[#CFCDC5] rounded-lg text-[#171717] focus:outline-none focus:border-purple-500 disabled:opacity-60"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-bold text-[#171717]">Telefone / WhatsApp</label>
                  <input
                    type="text"
                    disabled={saving}
                    value={formTelefone}
                    onChange={(e) => setFormTelefone(e.target.value)}
                    placeholder="(11) 98765-4321"
                    className="w-full h-10 px-3 bg-[#E4E2DB] border border-[#CFCDC5] rounded-lg text-[#171717] focus:outline-none focus:border-purple-500 disabled:opacity-60"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-[#171717]">Regional de Atuação</label>
                  <input
                    type="text"
                    disabled={saving}
                    value={formRegional}
                    onChange={(e) => setFormRegional(e.target.value)}
                    placeholder="ex: São Paulo - Capital"
                    className="w-full h-10 px-3 bg-[#E4E2DB] border border-[#CFCDC5] rounded-lg text-[#171717] focus:outline-none focus:border-purple-500 disabled:opacity-60"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-bold text-[#171717]">Status</label>
                  <select
                    value={formStatus}
                    disabled={saving}
                    onChange={(e) => setFormStatus(e.target.value as SupervisorStatus)}
                    className="w-full h-10 px-3 bg-[#E4E2DB] border border-[#CFCDC5] rounded-lg text-[#171717] focus:outline-none focus:border-purple-500 disabled:opacity-60"
                  >
                    <option value="ativo">Ativo</option>
                    <option value="ferias">Em Férias</option>
                    <option value="afastado">Afastado</option>
                    <option value="inativo">Inativo</option>
                  </select>
                </div>
              </div>

              <div className="pt-3 border-t border-[#CFCDC5] flex items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-[#EAE8E2] hover:bg-[#E4E2DB] text-[#171717] border border-[#CFCDC5] font-semibold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-lg bg-[#222222] hover:bg-black text-white font-bold cursor-pointer disabled:opacity-50 flex items-center gap-2"
                >
                  {saving && <span className="material-symbols-outlined text-sm animate-spin">sync</span>}
                  <span>{saving ? 'Gravando...' : editingSupervisor ? 'Salvar Alterações' : 'Criar Supervisor'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Confirmação de Inativação */}
      {inactivateModalSupervisor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="w-full max-w-md bg-[#F7F6F2] border border-[#CFCDC5] rounded-2xl shadow-2xl p-6 space-y-4">
            <div className="flex items-center gap-3 text-amber-700">
              <span className="material-symbols-outlined text-2xl">warning</span>
              <h3 className="font-bold text-base text-[#171717]">Inativar Supervisor</h3>
            </div>

            <p className="text-xs text-[#5F5F5F] leading-relaxed">
              Deseja realmente inativar o supervisor{' '}
              <strong className="text-[#171717]">{inactivateModalSupervisor.nome}</strong> ({inactivateModalSupervisor.codigo})?
            </p>

            {/* Aviso de Equipes Vinculadas */}
            {(() => {
              const squads = supervisorEquipesMap.get(inactivateModalSupervisor.id) || [];
              if (squads.length > 0) {
                return (
                  <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-900 text-xs space-y-1">
                    <span className="font-bold block">⚠️ Atenção: Equipes Vinculadas</span>
                    <p className="text-[11px] text-amber-800">
                      Este supervisor está vinculado a <strong>{squads.length} equipe(s)</strong> (ex:{' '}
                      {squads.map((e) => e.nome).join(', ')}).
                    </p>
                    <p className="text-[11px] text-[#5F5F5F]">
                      A inativação preserva o histórico dessas equipes, mas o supervisor deixará de ser ofertado para novas atribuições.
                    </p>
                  </div>
                );
              }
              return null;
            })()}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#CFCDC5]">
              <button
                disabled={saving}
                onClick={() => setInactivateModalSupervisor(null)}
                className="px-4 py-2 rounded-lg bg-[#EAE8E2] text-[#171717] border border-[#CFCDC5] text-xs font-semibold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                disabled={saving}
                onClick={handleConfirmInactivation}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold cursor-pointer flex items-center gap-1.5"
              >
                {saving && <span className="material-symbols-outlined text-xs animate-spin">sync</span>}
                <span>Confirmar Inativação</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Detalhes do Supervisor e Equipes */}
      {selectedSupervisor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="w-full max-w-xl bg-[#F7F6F2] border border-[#CFCDC5] rounded-2xl shadow-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-[#CFCDC5]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-600/20 text-purple-700 border border-purple-500/30 flex items-center justify-center font-bold font-mono">
                  {getInitials(selectedSupervisor.nome)}
                </div>
                <div>
                  <h3 className="font-bold text-base text-[#171717]">{selectedSupervisor.nome}</h3>
                  <span className="text-xs font-mono text-cyan-800 font-bold">{selectedSupervisor.codigo}</span>
                </div>
              </div>
              <button
                onClick={() => setSelectedSupervisor(null)}
                className="text-[#77766F] hover:text-[#171717] cursor-pointer p-1"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs bg-[#EAE8E2] p-3 rounded-xl border border-[#CFCDC5]">
              <div>
                <span className="text-[10px] text-[#77766F] block font-semibold">REGIONAL</span>
                <span className="font-bold text-[#171717]">{selectedSupervisor.regional || '—'}</span>
              </div>
              <div>
                <span className="text-[10px] text-[#77766F] block font-semibold">STATUS</span>
                <span className="font-mono font-bold uppercase text-purple-700">{selectedSupervisor.status}</span>
              </div>
              <div>
                <span className="text-[10px] text-[#77766F] block font-semibold">E-MAIL</span>
                <span className="text-[#171717]">{selectedSupervisor.email || '—'}</span>
              </div>
              <div>
                <span className="text-[10px] text-[#77766F] block font-semibold">TELEFONE</span>
                <span className="font-mono text-[#171717]">{selectedSupervisor.telefone || '—'}</span>
              </div>
            </div>

            {/* Lista de Equipes Subordinadas */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-[#171717] uppercase tracking-wider flex items-center gap-1.5">
                <span className="material-symbols-outlined text-purple-700 text-sm">groups</span>
                <span>Equipes Supervisionadas</span>
              </h4>

              {(() => {
                const squads = supervisorEquipesMap.get(selectedSupervisor.id) || [];
                if (squads.length === 0) {
                  return (
                    <div className="p-4 rounded-xl bg-[#EAE8E2] border border-[#CFCDC5] text-center text-xs text-[#77766F]">
                      Nenhuma equipe está vinculada a este supervisor no momento.
                    </div>
                  );
                }

                return (
                  <div className="space-y-2">
                    {squads.map((eq) => (
                      <div
                        key={eq.id}
                        className="p-3 rounded-xl bg-[#EAE8E2] border border-[#CFCDC5] flex items-center justify-between text-xs"
                      >
                        <div>
                          <div className="font-bold text-[#171717] flex items-center gap-2">
                            <span>{eq.nome}</span>
                            <span className="text-[10px] font-mono text-purple-700 bg-purple-100 px-1.5 py-0.2 rounded border border-purple-200">
                              {eq.codigo}
                            </span>
                          </div>
                          <span className="text-[11px] text-[#5F5F5F]">{eq.regional || 'Sem regional'}</span>
                        </div>
                        <span
                          className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full ${
                            eq.status === 'ativa'
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                              : 'bg-slate-200 text-[#5F5F5F]'
                          }`}
                        >
                          {eq.status.toUpperCase()}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>

            <div className="pt-2 border-t border-[#CFCDC5] flex justify-end">
              <button
                onClick={() => setSelectedSupervisor(null)}
                className="px-4 py-2 rounded-lg bg-[#222222] hover:bg-black text-white text-xs font-bold cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

