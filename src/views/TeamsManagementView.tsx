import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ScreenId, ToastMessage, Equipe, EquipeWithMetrics, EquipeStatus, Supervisor } from '../types';
import { equipesService } from '../lib/equipesService';
import { supervisoresService } from '../lib/supervisoresService';

interface TeamsManagementViewProps {
  onNavigate: (screen: ScreenId) => void;
  onShowToast: (toast: Omit<ToastMessage, 'id'>) => void;
}

export const TeamsManagementView: React.FC<TeamsManagementViewProps> = ({
  onNavigate,
  onShowToast
}) => {
  // Service Data State com Métricas Reais
  const [equipes, setEquipes] = useState<EquipeWithMetrics[]>([]);
  const [selectedEquipe, setSelectedEquipe] = useState<EquipeWithMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Supervisores State
  const [supervisores, setSupervisores] = useState<Supervisor[]>([]);
  const [loadingSupervisores, setLoadingSupervisores] = useState(false);
  const [supervisoresError, setSupervisoresError] = useState<string | null>(null);

  // Filters & Tabs
  const [drawerTab, setDrawerTab] = useState<'dados' | 'promotores'>('dados');
  const [search, setSearch] = useState('');
  const [regionFilter, setRegionFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | EquipeStatus>('all');

  // Modals & Forms State
  const [modalNewSquad, setModalNewSquad] = useState(false);
  const [modalEditSquad, setModalEditSquad] = useState(false);
  const [suggestedCode, setSuggestedCode] = useState('');
  const [manualCode, setManualCode] = useState('');
  const [formName, setFormName] = useState('');
  const [formRegion, setFormRegion] = useState('');
  const [formSupervisorId, setFormSupervisorId] = useState<string>('');
  const [formSupervisor, setFormSupervisor] = useState('');
  const [formStatus, setFormStatus] = useState<EquipeStatus>('ativa');

  // Drawer transfer state
  const [selectedPromoterIds, setSelectedPromoterIds] = useState<string[]>([]);
  const [targetSquadTransfer, setTargetSquadTransfer] = useState('');
  const [teamPromoters, setTeamPromoters] = useState<{ id: string; matricula: string; nome: string; cidade: string; uf: string; supervisor: string | null; status: string }[]>([]);
  const [loadingPromoters, setLoadingPromoters] = useState(false);
  const [transferring, setTransferring] = useState(false);

  // Modal Vincular Promotores Disponíveis (sem equipe)
  const [modalVincularOpen, setModalVincularOpen] = useState(false);
  const [promotoresDisponiveis, setPromotoresDisponiveis] = useState<{ id: string; matricula: string; nome: string; cidade: string; uf: string; supervisor: string | null; status: string }[]>([]);
  const [loadingDisponiveis, setLoadingDisponiveis] = useState(false);
  const [disponiveisError, setDisponiveisError] = useState<string | null>(null);
  const [selectedToVincularIds, setSelectedToVincularIds] = useState<string[]>([]);
  const [vincularSearch, setVincularSearch] = useState('');
  const [savingVinculacao, setSavingVinculacao] = useState(false);

  // 1. Carregar Equipes do Banco via equipesService.fetchTeamsWithMetrics
  const fetchEquipes = useCallback(async (selectIdAfter?: string) => {
    setLoading(true);
    setError(null);

    const res = await equipesService.fetchTeamsWithMetrics();
    if (res.error) {
      setError(res.error.message);
      setLoading(false);
      return;
    }

    const data = res.data || [];
    setEquipes(data);

    if (selectIdAfter) {
      const found = data.find((e) => e.id === selectIdAfter);
      setSelectedEquipe(found || (data.length > 0 ? data[0] : null));
    } else {
      setSelectedEquipe((prev) => {
        if (!prev) return data.length > 0 ? data[0] : null;
        const stillExists = data.find((e) => e.id === prev.id);
        return stillExists || (data.length > 0 ? data[0] : null);
      });
    }

    setLoading(false);
  }, []);

  // 1.1 Carregar Supervisores Cadastrados
  const fetchSupervisores = useCallback(async () => {
    setLoadingSupervisores(true);
    setSupervisoresError(null);
    const res = await supervisoresService.listSupervisores();
    setLoadingSupervisores(false);
    if (res.error) {
      setSupervisoresError(res.error.message);
      setSupervisores([]);
    } else {
      setSupervisores(res.data || []);
    }
  }, []);

  useEffect(() => {
    fetchEquipes();
    fetchSupervisores();
  }, [fetchEquipes, fetchSupervisores]);

  // 2. Abrir Modal de Criação consultando o próximo código sugerido via get_next_team_code()
  const handleOpenCreateModal = async () => {
    setFormName('');
    setFormRegion('');
    setFormSupervisorId('');
    setFormSupervisor('');
    setFormStatus('ativa');
    setSuggestedCode('');
    setManualCode('');
    setModalNewSquad(true);

    fetchSupervisores();
    const res = await equipesService.getNextCode();
    if (res.data) {
      setSuggestedCode(res.data);
    }
  };

  // 3. Abrir Modal de Edição com dados da equipe selecionada
  const handleOpenEditModal = (equipe: Equipe) => {
    setFormName(equipe.nome);
    setFormRegion(equipe.regional || '');
    setFormSupervisorId(equipe.supervisor_id || '');
    setFormSupervisor(equipe.supervisor_nome || '');
    setFormStatus(equipe.status);
    setManualCode(equipe.codigo);
    setModalEditSquad(true);
    fetchSupervisores();
  };

  // 4. Salvar Nova Equipe (apenas após confirmação do Supabase)
  const handleCreateSquad = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      onShowToast({
        title: 'Nome Obrigatório',
        message: 'Informe o nome da equipe.',
        type: 'warning'
      });
      return;
    }

    // Se um supervisor_id foi selecionado, obter o nome correspondente
    let resolvedSupervisorNome = formSupervisor.trim() || null;
    if (formSupervisorId) {
      const sup = supervisores.find((s) => s.id === formSupervisorId);
      if (sup) {
        resolvedSupervisorNome = sup.nome;
      }
    }

    setSaving(true);
    const res = await equipesService.createEquipe({
      nome: formName.trim(),
      codigo: manualCode.trim() ? manualCode.trim() : undefined,
      regional: formRegion.trim() ? formRegion.trim() : null,
      supervisor_id: formSupervisorId || null,
      supervisor_nome: resolvedSupervisorNome,
      status: formStatus
    });

    setSaving(false);

    if (res.error || !res.data) {
      onShowToast({
        title: 'Falha ao Criar Equipe',
        message: res.error?.message || 'Não foi possível cadastrar a equipe.',
        type: 'error'
      });
      return;
    }

    onShowToast({
      title: 'Equipe Criada com Sucesso',
      message: `Equipe ${res.data.nome} (${res.data.codigo}) cadastrada com sucesso.`,
      type: 'success'
    });

    setModalNewSquad(false);
    fetchEquipes(res.data.id);
  };

  // 5. Salvar Atualização da Equipe
  const handleUpdateSquad = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEquipe) return;

    if (!formName.trim()) {
      onShowToast({
        title: 'Nome Obrigatório',
        message: 'O nome da equipe não pode ser vazio.',
        type: 'warning'
      });
      return;
    }

    const trimmedCode = manualCode.trim();
    if (!trimmedCode && !selectedEquipe.codigo) {
      onShowToast({
        title: 'Código Obrigatório',
        message: 'O código da equipe não pode ser vazio.',
        type: 'warning'
      });
      return;
    }

    // Se um supervisor_id foi selecionado, obter o nome correspondente
    let resolvedSupervisorNome = formSupervisor.trim() || null;
    if (formSupervisorId) {
      const sup = supervisores.find((s) => s.id === formSupervisorId);
      if (sup) {
        resolvedSupervisorNome = sup.nome;
      }
    }

    setSaving(true);
    const res = await equipesService.updateEquipe(selectedEquipe.id, {
      nome: formName.trim(),
      codigo: trimmedCode || selectedEquipe.codigo,
      regional: formRegion.trim() ? formRegion.trim() : null,
      supervisor_id: formSupervisorId || null,
      supervisor_nome: resolvedSupervisorNome,
      status: formStatus
    });

    setSaving(false);

    if (res.error || !res.data) {
      onShowToast({
        title: 'Falha ao Atualizar Equipe',
        message: res.error?.message || 'Não foi possível atualizar a equipe.',
        type: 'error'
      });
      return;
    }

    onShowToast({
      title: 'Equipe Atualizada',
      message: `Dados de ${res.data.nome} foram salvos com sucesso.`,
      type: 'success'
    });

    setModalEditSquad(false);
    fetchEquipes(res.data.id);
  };

  // 6. Arquivar Equipe
  const handleArchiveSquad = async (equipe: Equipe) => {
    if (equipe.status === 'arquivada') {
      onShowToast({
        title: 'Equipe Já Arquivada',
        message: `A equipe ${equipe.nome} já se encontra arquivada.`,
        type: 'info'
      });
      return;
    }

    const confirmArchive = window.confirm(
      `Deseja realmente arquivar a equipe "${equipe.nome}" (${equipe.codigo})?`
    );
    if (!confirmArchive) return;

    setSaving(true);
    const res = await equipesService.archiveEquipe(equipe.id);
    setSaving(false);

    if (res.error || !res.data) {
      onShowToast({
        title: 'Erro ao Arquivar',
        message: res.error?.message || 'Não foi possível arquivar a equipe.',
        type: 'error'
      });
      return;
    }

    onShowToast({
      title: 'Equipe Arquivada',
      message: `A equipe ${res.data.nome} foi arquivada com sucesso.`,
      type: 'success'
    });

    fetchEquipes(res.data.id);
  };

  // 7. Extrair lista única de Regionais reais cadastradas para o select
  const availableRegions = useMemo(() => {
    const set = new Set<string>();
    equipes.forEach((e) => {
      if (e.regional && e.regional.trim()) {
        set.add(e.regional.trim());
      }
    });
    return Array.from(set).sort();
  }, [equipes]);

  // 8. Filtragem de equipes em memória derivada dos dados reais
  const filteredEquipes = useMemo(() => {
    return equipes.filter((e) => {
      const term = search.toLowerCase().trim();
      const matchesSearch =
        !term ||
        e.nome.toLowerCase().includes(term) ||
        e.codigo.toLowerCase().includes(term) ||
        (e.regional && e.regional.toLowerCase().includes(term)) ||
        (e.supervisor_nome && e.supervisor_nome.toLowerCase().includes(term));

      const matchesRegion =
        regionFilter === 'all' || e.regional === regionFilter;

      const matchesStatus =
        statusFilter === 'all' || e.status === statusFilter;

      return matchesSearch && matchesRegion && matchesStatus;
    });
  }, [equipes, search, regionFilter, statusFilter]);

  // Contadores reais derivados da base
  const countAtivas = useMemo(() => equipes.filter((e) => e.status === 'ativa').length, [equipes]);
  const countReestruturacao = useMemo(() => equipes.filter((e) => e.status === 'reestruturacao').length, [equipes]);
  const countArquivadas = useMemo(() => equipes.filter((e) => e.status === 'arquivada').length, [equipes]);

  // Auxiliares visuais para dados opcionais
  const getInitials = (name?: string | null) => {
    if (!name || !name.trim()) return 'EQ';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  // Carregar promotores da equipe selecionada
  const fetchTeamPromoters = useCallback(async (equipeNome: string) => {
    if (!equipeNome) {
      setTeamPromoters([]);
      return;
    }
    setLoadingPromoters(true);
    const res = await equipesService.listPromotoresByEquipe(equipeNome);
    if (res.data) {
      setTeamPromoters(res.data);
    } else {
      setTeamPromoters([]);
    }
    setLoadingPromoters(false);
  }, []);

  useEffect(() => {
    if (selectedEquipe?.nome) {
      setSelectedPromoterIds([]);
      fetchTeamPromoters(selectedEquipe.nome);
    } else {
      setTeamPromoters([]);
      setSelectedPromoterIds([]);
    }
  }, [selectedEquipe?.nome, fetchTeamPromoters]);

  const handleTogglePromoter = (id: string) => {
    setSelectedPromoterIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleTransferBatch = async () => {
    if (selectedPromoterIds.length === 0) {
      onShowToast({
        title: 'Nenhum Promotor Selecionado',
        message: 'Marque ao menos um promotor da lista para transferir.',
        type: 'warning'
      });
      return;
    }

    if (!targetSquadTransfer || !targetSquadTransfer.trim()) {
      onShowToast({
        title: 'Selecione a Equipe Destino',
        message: 'Escolha a equipe para onde deseja transferir os promotores.',
        type: 'warning'
      });
      return;
    }

    const validTarget = equipes.find(
      (e) => e.nome.trim() === targetSquadTransfer.trim() && e.status !== 'arquivada'
    );
    if (!validTarget) {
      onShowToast({
        title: 'Equipe Destino Inválida',
        message: 'A equipe de destino selecionada não existe ou está arquivada.',
        type: 'warning'
      });
      return;
    }

    if (selectedEquipe && validTarget.id === selectedEquipe.id) {
      onShowToast({
        title: 'Equipe de Destino Inválida',
        message: 'A equipe de destino deve ser diferente da equipe atual.',
        type: 'warning'
      });
      return;
    }

    const confirmTransfer = window.confirm(
      `Deseja transferir ${selectedPromoterIds.length} promotor(es) selecionados para a equipe "${validTarget.nome}" (${validTarget.codigo})?`
    );
    if (!confirmTransfer) return;

    setTransferring(true);
    const res = await equipesService.transferPromotoresToEquipe(
      selectedPromoterIds,
      validTarget.nome
    );
    setTransferring(false);

    if (res.error || !res.data) {
      onShowToast({
        title: 'Erro na Transferência',
        message: res.error?.message || 'Falha ao atualizar a equipe dos promotores no banco.',
        type: 'error'
      });
      return;
    }

    const requestedCount = selectedPromoterIds.length;
    const actualUpdated = res.data.updatedCount;

    if (actualUpdated < requestedCount) {
      onShowToast({
        title: 'Transferência Parcial',
        message: `${actualUpdated} de ${requestedCount} promotor(es) foram transferidos para "${validTarget.nome}". Alguns registros podem não ter sido afetados por restrições de permissão ou alteração concorrente.`,
        type: 'warning'
      });
    } else {
      onShowToast({
        title: 'Transferência Concluída',
        message: `${actualUpdated} promotor(es) transferidos com sucesso para a equipe "${validTarget.nome}".`,
        type: 'success'
      });
    }

    setSelectedPromoterIds([]);
    setTargetSquadTransfer('');
    if (selectedEquipe?.nome) {
      fetchTeamPromoters(selectedEquipe.nome);
    }
    if (selectedEquipe?.id) {
      fetchEquipes(selectedEquipe.id);
    }
  };

  // Carregar lista de promotores disponíveis para o modal de vinculação
  const handleOpenModalVincular = async () => {
    if (!selectedEquipe) return;
    setModalVincularOpen(true);
    setLoadingDisponiveis(true);
    setDisponiveisError(null);
    setSelectedToVincularIds([]);
    setVincularSearch('');

    const res = await equipesService.listPromotoresDisponiveis();
    if (res.error) {
      setDisponiveisError(res.error.message);
      setPromotoresDisponiveis([]);
    } else {
      setPromotoresDisponiveis(res.data || []);
    }
    setLoadingDisponiveis(false);
  };

  const handleToggleVincularPromoter = (id: string) => {
    setSelectedToVincularIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleConfirmarVinculacao = async () => {
    if (!selectedEquipe) return;

    if (selectedToVincularIds.length === 0) {
      onShowToast({
        title: 'Nenhum Promotor Selecionado',
        message: 'Marque ao menos um promotor disponível para vincular à equipe.',
        type: 'warning'
      });
      return;
    }

    if (selectedEquipe.status === 'arquivada') {
      onShowToast({
        title: 'Equipe Arquivada',
        message: 'Não é possível vincular promotores a uma equipe arquivada.',
        type: 'error'
      });
      return;
    }

    setSavingVinculacao(true);
    const res = await equipesService.vincularPromotoresAEquipe(
      selectedToVincularIds,
      selectedEquipe.nome
    );
    setSavingVinculacao(false);

    if (res.error || !res.data) {
      onShowToast({
        title: 'Erro ao Vincular Promotores',
        message: res.error?.message || 'Falha ao associar promotores à equipe.',
        type: 'error'
      });
      // Preservar a seleção para permitir nova tentativa
      return;
    }

    const { updatedCount, skippedCount } = res.data;

    if (skippedCount > 0) {
      onShowToast({
        title: 'Vinculação Concluída com Alerta',
        message: `${updatedCount} promotor(es) vinculado(s) à equipe "${selectedEquipe.nome}". ${skippedCount} promotor(es) já haviam sido alocados por outro usuário simultaneamente.`,
        type: 'warning'
      });
    } else {
      onShowToast({
        title: 'Promotores Vinculados',
        message: `${updatedCount} promotor(es) associado(s) com sucesso à equipe "${selectedEquipe.nome}".`,
        type: 'success'
      });
    }

    // Fechar modal, limpar seleções e atualizar lista da equipe
    setModalVincularOpen(false);
    setSelectedToVincularIds([]);
    if (selectedEquipe?.nome) {
      fetchTeamPromoters(selectedEquipe.nome);
    }
    if (selectedEquipe?.id) {
      fetchEquipes(selectedEquipe.id);
    }
  };

  // ESTADO DE CARREGAMENTO INICIAL
  if (loading && equipes.length === 0) {
    return (
      <div className="w-full px-4 lg:px-8 py-16 max-w-[1720px] mx-auto text-center">
        <div className="inline-flex items-center gap-3 px-5 py-3 rounded-xl bg-[#F7F6F2] border border-[#CFCDC5] text-[#171717] shadow-sm">
          <span className="material-symbols-outlined animate-spin text-purple-600 text-2xl">sync</span>
          <span className="text-sm font-semibold">Carregando equipes operacionais...</span>
        </div>
      </div>
    );
  }

  // ESTADO DE ERRO AO CARREGAR
  if (error && equipes.length === 0) {
    return (
      <div className="w-full px-4 lg:px-8 py-12 max-w-[1720px] mx-auto">
        <div className="rounded-2xl border border-red-200 bg-red-50/50 p-8 text-center max-w-lg mx-auto shadow-sm">
          <div className="w-16 h-16 rounded-2xl bg-red-100 border border-red-200 flex items-center justify-center text-red-600 mx-auto shadow-xs">
            <span className="material-symbols-outlined text-3xl">error</span>
          </div>
          <h1 className="mt-4 text-xl font-bold text-red-900 tracking-tight">Falha ao Carregar Equipes</h1>
          <p className="mt-2 text-xs text-red-700 leading-relaxed font-mono">
            {error}
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <button
              onClick={() => fetchEquipes()}
              className="inline-flex items-center gap-2 rounded-xl bg-[#222222] hover:bg-black px-4 py-2 text-xs font-bold text-white transition-all shadow-sm cursor-pointer"
            >
              <span className="material-symbols-outlined text-base">refresh</span>
              <span>Tentar novamente</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ESTADO DE LISTA TOTALMENTE VAZIA
  if (!selectedEquipe && equipes.length === 0) {
    return (
      <div className="w-full px-4 lg:px-8 py-12 max-w-[1720px] mx-auto">
        <div className="rounded-2xl border border-[#CFCDC5] bg-[#F7F6F2] p-12 text-center max-w-lg mx-auto shadow-sm">
          <div className="w-16 h-16 rounded-2xl bg-[#E4E2DB] border border-[#CFCDC5] flex items-center justify-center text-[#222222] mx-auto shadow-xs">
            <span className="material-symbols-outlined text-3xl">groups</span>
          </div>
          <h1 className="mt-4 text-2xl font-extrabold text-[#171717] tracking-tight">Gestão de Equipes</h1>
          <p className="mt-2 text-sm text-[#5F5F5F] leading-relaxed">
            Não há equipes operacionais cadastradas na base. Crie a primeira equipe para alocar promotores e estruturar as praças de campo.
          </p>
          <button
            onClick={handleOpenCreateModal}
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[#222222] hover:bg-black px-5 py-2.5 text-xs font-bold text-white transition-all shadow-sm cursor-pointer"
          >
            <span className="material-symbols-outlined text-base">add</span>
            <span>Criar primeira equipe</span>
          </button>
        </div>

        {/* Modal de Criação no Estado Vazio */}
        {modalNewSquad && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
            <form onSubmit={handleCreateSquad} className="w-full max-w-md rounded-2xl border border-[#CFCDC5] bg-[#F7F6F2] p-6 shadow-xl">
              <h2 className="text-lg font-bold text-[#171717]">Nova equipe</h2>
              {suggestedCode && (
                <div className="mt-2 p-2 rounded-lg bg-[#EAE8E2] border border-[#CFCDC5] text-xs flex items-center justify-between">
                  <span className="text-[#5F5F5F]">Código Sugerido:</span>
                  <span className="font-mono font-bold text-[#171717]">{suggestedCode}</span>
                </div>
              )}
              <div className="mt-4 space-y-3">
                <div>
                  <input
                    required
                    disabled={saving}
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="Nome da equipe *"
                    className="h-10 w-full rounded-lg border border-[#CFCDC5] bg-[#E4E2DB] px-3 text-sm text-[#171717] placeholder:text-[#77766F] focus:outline-none focus:border-[#222222] focus:bg-white disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                </div>
                <div>
                  <input
                    value={manualCode}
                    disabled={saving}
                    onChange={(e) => setManualCode(e.target.value)}
                    placeholder="Código manual (deixe em branco para auto-gerar)"
                    className="h-10 w-full rounded-lg border border-[#CFCDC5] bg-[#E4E2DB] px-3 text-sm text-[#171717] font-mono placeholder:text-[#77766F] focus:outline-none focus:border-[#222222] focus:bg-white disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                </div>
                <div>
                  <input
                    value={formRegion}
                    disabled={saving}
                    onChange={(e) => setFormRegion(e.target.value)}
                    placeholder="Praça / Regional (opcional)"
                    className="h-10 w-full rounded-lg border border-[#CFCDC5] bg-[#E4E2DB] px-3 text-sm text-[#171717] placeholder:text-[#77766F] focus:outline-none focus:border-[#222222] focus:bg-white disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                </div>
                <div>
                  {supervisoresError ? (
                    <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-900 text-xs space-y-1">
                      <div className="flex items-center gap-1 font-bold text-amber-800">
                        <span className="material-symbols-outlined text-sm">warning</span>
                        <span>Módulo de Supervisores indisponível</span>
                      </div>
                      <p className="text-[11px] text-[#5F5F5F]">
                        A seleção de supervisor requer o módulo de supervisores provisionado no banco. O cadastro da equipe pode prosseguir normalmente sem supervisor.
                      </p>
                    </div>
                  ) : loadingSupervisores ? (
                    <div className="h-10 w-full rounded-lg border border-[#CFCDC5] bg-[#E4E2DB] px-3 text-xs text-[#77766F] flex items-center gap-2">
                      <span className="material-symbols-outlined text-sm animate-spin">sync</span>
                      <span>Carregando supervisores...</span>
                    </div>
                  ) : (
                    <select
                      value={formSupervisorId}
                      disabled={saving}
                      onChange={(e) => {
                        const selId = e.target.value;
                        setFormSupervisorId(selId);
                        const sup = supervisores.find((s) => s.id === selId);
                        setFormSupervisor(sup ? sup.nome : '');
                      }}
                      className="h-10 w-full rounded-lg border border-[#CFCDC5] bg-[#E4E2DB] px-3 text-sm text-[#171717] focus:outline-none focus:border-[#222222] focus:bg-white disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      <option value="">-- Selecione o Supervisor (Opcional) --</option>
                      {supervisores
                        .filter((s) => s.status === 'ativo' || s.id === formSupervisorId)
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.nome} ({s.codigo}){s.regional ? ` - ${s.regional}` : ''}
                          </option>
                        ))}
                    </select>
                  )}
                </div>
                <div>
                  <select
                    value={formStatus}
                    disabled={saving}
                    onChange={(e) => setFormStatus(e.target.value as EquipeStatus)}
                    className="h-10 w-full rounded-lg border border-[#CFCDC5] bg-[#E4E2DB] px-3 text-sm text-[#171717] focus:outline-none focus:border-[#222222] focus:bg-white disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <option value="ativa">Ativa</option>
                    <option value="reestruturacao">Em Reestruturação</option>
                    <option value="arquivada">Arquivada</option>
                  </select>
                </div>
              </div>
              <div className="mt-6 flex justify-end gap-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setModalNewSquad(false)}
                  className="rounded-lg px-4 py-2 text-xs font-semibold text-[#5F5F5F] hover:text-[#171717] cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-[#222222] hover:bg-black px-4 py-2 text-xs font-bold text-white cursor-pointer shadow-xs disabled:opacity-50"
                >
                  {saving ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="w-full px-4 lg:px-8 py-6 max-w-[1720px] mx-auto space-y-6">
      {/* Screen Header */}
      <section className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="flex flex-col space-y-1.5 max-w-3xl">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full bg-purple-600/20 text-purple-700 border border-purple-500/30 font-mono text-[11px] font-bold uppercase tracking-wider">
              Módulo de Estrutura de Campo
            </span>
            <span className="font-mono text-xs text-[#77766F]">• Conectado ao Supabase</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#171717] tracking-tight">
            Gestão de Equipes
          </h1>
          <p className="text-xs sm:text-sm text-[#77766F]">
            Estruture squads operacionais de campo, vincule supervisores regionais e gerencie a distribuição de equipes com sincronização em tempo real.
          </p>

          {/* Rapid Meta Badges baseados em dados reais */}
          <div className="flex flex-wrap items-center gap-2 pt-1 font-mono text-xs">
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#F7F6F2] border border-[#CFCDC5] text-[#171717]">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>{countAtivas} Equipes Ativas</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#F7F6F2] border border-[#CFCDC5] text-[#171717]">
              <span className="material-symbols-outlined text-cyan-600 text-sm">map</span>
              <span>{equipes.length} Estruturas Cadastradas</span>
            </div>
            {countReestruturacao > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#F7F6F2] border border-[#CFCDC5] text-[#171717]">
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                <span>{countReestruturacao} em Reestruturação</span>
              </div>
            )}
            {countArquivadas > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#F7F6F2] border border-[#CFCDC5] text-[#77766F]">
                <span className="material-symbols-outlined text-xs">inventory_2</span>
                <span>{countArquivadas} Arquivadas</span>
              </div>
            )}
          </div>
        </div>

        {/* Header Actions */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => fetchEquipes()}
            title="Recarregar dados do banco"
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#F7F6F2] hover:bg-[#E4E2DB] text-[#171717] border border-[#CFCDC5] text-xs font-semibold shadow-sm"
          >
            <span className="material-symbols-outlined text-base">refresh</span>
            <span>Atualizar</span>
          </button>
          <button
            onClick={handleOpenCreateModal}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#222222] hover:bg-black text-white font-bold text-xs shadow-xs transition-all active:scale-95 shadow-md cursor-pointer"
          >
            <span className="material-symbols-outlined text-lg">add</span>
            <span>+ Nova equipe</span>
          </button>
        </div>
      </section>

      {/* Filter & Tactical Search Bar */}
      <section className="bg-[#F7F6F2] border border-[#CFCDC5] rounded-xl p-4 shadow-md space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
          <div className="md:col-span-6 relative">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#77766F] text-base">
              search
            </span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar equipe por nome, código, regional ou supervisor..."
              className="w-full h-10 pl-9 pr-20 bg-[#EAE8E2] border border-[#CFCDC5] rounded-lg text-xs text-[#171717] placeholder:text-[#5F5F5F] focus:outline-none focus:border-purple-500"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[10px] text-[#77766F]">
              {filteredEquipes.length} {filteredEquipes.length === 1 ? 'equipe' : 'equipes'}
            </span>
          </div>

          <div className="md:col-span-3">
            <select
              value={regionFilter}
              onChange={(e) => setRegionFilter(e.target.value)}
              className="w-full h-10 px-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-lg text-xs text-[#171717] focus:outline-none focus:border-purple-500 cursor-pointer"
            >
              <option value="all">Todas as Regionais ({availableRegions.length})</option>
              {availableRegions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-3 flex items-center gap-2">
            <div className="flex items-center gap-2 w-full px-3 h-10 bg-[#EAE8E2] border border-[#CFCDC5] rounded-lg text-xs text-[#77766F]">
              <span className="material-symbols-outlined text-sm">filter_alt</span>
              <span>Total: <strong className="text-[#171717]">{equipes.length} cadastradas</strong></span>
            </div>
          </div>
        </div>

        {/* Filter Chips Status com contadores derivados reais */}
        <div className="pt-2 border-t border-[#CFCDC5] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-bold text-[#5F5F5F] uppercase tracking-wider font-mono mr-1">
              Filtrar por Status:
            </span>
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                statusFilter === 'all'
                  ? 'bg-[#222222] text-white font-bold shadow-xs'
                  : 'bg-[#EAE8E2] text-[#5F5F5F] hover:text-[#171717] border border-[#CFCDC5]'
              }`}
            >
              Todas ({equipes.length})
            </button>
            <button
              onClick={() => setStatusFilter('ativa')}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                statusFilter === 'ativa'
                  ? 'bg-emerald-600 text-white font-bold'
                  : 'bg-[#EAE8E2] text-emerald-700 hover:text-emerald-900 border border-[#CFCDC5]'
              }`}
            >
              Ativas ({countAtivas})
            </button>
            <button
              onClick={() => setStatusFilter('reestruturacao')}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                statusFilter === 'reestruturacao'
                  ? 'bg-amber-600 text-white font-bold'
                  : 'bg-[#EAE8E2] text-amber-700 hover:text-amber-900 border border-[#CFCDC5]'
              }`}
            >
              Em Reestruturação ({countReestruturacao})
            </button>
            <button
              onClick={() => setStatusFilter('arquivada')}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                statusFilter === 'arquivada'
                  ? 'bg-slate-700 text-white font-bold'
                  : 'bg-[#EAE8E2] text-[#77766F] hover:text-[#171717] border border-[#CFCDC5]'
              }`}
            >
              Arquivadas ({countArquivadas})
            </button>
          </div>

          <div className="flex items-center gap-2 text-xs font-mono text-[#77766F]">
            <span>Exibindo: <strong className="text-[#171717]">{filteredEquipes.length}</strong></span>
          </div>
        </div>
      </section>

      {/* Main Content Layout (7 cols Cards + 5 cols Interactive Drawer Workspace) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Teams Cards Grid (7 cols) */}
        <section className="xl:col-span-7 flex flex-col gap-4">
          {filteredEquipes.length === 0 ? (
            <div className="bg-[#F7F6F2] border border-[#CFCDC5] rounded-xl p-12 text-center flex flex-col items-center justify-center space-y-3">
              <span className="material-symbols-outlined text-4xl text-[#77766F]">groups</span>
              <h3 className="text-base font-bold text-[#171717]">Nenhuma equipe encontrada para os filtros aplicados.</h3>
              <p className="text-xs text-[#77766F]">Tente ajustar a busca ou limpar os filtros de status e regional.</p>
              <button
                onClick={() => {
                  setSearch('');
                  setRegionFilter('all');
                  setStatusFilter('all');
                }}
                className="mt-2 text-xs text-purple-700 hover:underline font-semibold"
              >
                Limpar filtros
              </button>
            </div>
          ) : (
            filteredEquipes.map((equipe) => {
              const isSelected = selectedEquipe?.id === equipe.id;
              return (
                <div
                  key={equipe.id}
                  onClick={() => setSelectedEquipe(equipe)}
                  className={`cursor-pointer bg-[#F7F6F2] border rounded-xl p-5 shadow-lg relative overflow-hidden transition-all group ${
                    isSelected
                      ? 'border-purple-500 ring-1 ring-purple-500/40 shadow-[0_0_20px_rgba(147,51,234,0.15)]'
                      : 'border-[#CFCDC5] hover:border-slate-500'
                  }`}
                >
                  {/* Top Accent Strip */}
                  <div
                    className={`absolute top-0 left-0 right-0 h-1 ${
                      equipe.status === 'reestruturacao'
                        ? 'bg-amber-500'
                        : equipe.status === 'arquivada'
                        ? 'bg-slate-500'
                        : 'bg-gradient-to-r from-purple-600 via-indigo-500 to-cyan-500'
                    }`}
                  />

                  <div className="flex flex-col gap-4">
                    {/* Top Row */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h2 className="text-base font-bold text-[#171717] group-hover:text-purple-700 transition-colors">
                            {equipe.nome}
                          </h2>
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-mono text-[10px] font-bold ${
                              equipe.status === 'ativa'
                                ? 'bg-emerald-500/15 text-emerald-700 border border-emerald-500/30'
                                : equipe.status === 'reestruturacao'
                                ? 'bg-amber-500/15 text-amber-700 border border-amber-500/30'
                                : 'bg-slate-200 text-[#77766F] border border-[#CFCDC5]'
                            }`}
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-current" />
                            {equipe.status.toUpperCase()}
                          </span>
                          <span className="px-1.5 py-0.2 rounded bg-[#EAE8E2] text-cyan-800 font-mono text-[10px] border border-cyan-500/30">
                            {equipe.codigo}
                          </span>
                        </div>
                        <span className="text-xs text-[#77766F] mt-0.5">
                          Regional: <strong className="text-[#171717]">{equipe.regional || 'Não definida'}</strong>
                        </span>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenEditModal(equipe);
                          }}
                          title="Editar Equipe"
                          className="p-1 rounded text-[#77766F] hover:text-[#171717] hover:bg-[#EAE8E2]"
                        >
                          <span className="material-symbols-outlined text-lg">edit</span>
                        </button>
                        {equipe.status !== 'arquivada' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleArchiveSquad(equipe);
                            }}
                            title="Arquivar Equipe"
                            className="p-1 rounded text-[#77766F] hover:text-red-600 hover:bg-[#EAE8E2]"
                          >
                            <span className="material-symbols-outlined text-lg">archive</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Supervisor Block */}
                    <div className="flex items-center justify-between p-3 rounded-lg bg-[#EAE8E2] border border-[#CFCDC5]">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-purple-600/20 text-purple-700 border border-purple-500/30 flex items-center justify-center font-bold text-xs">
                          {getInitials(equipe.supervisor_nome)}
                        </div>
                        <div className="flex flex-col">
                          <span className="text-xs font-bold text-[#171717] flex items-center gap-1">
                            {equipe.supervisor_nome || 'Supervisor não atribuído'}
                            {equipe.supervisor_nome && (
                              <span className="material-symbols-outlined text-emerald-600 text-xs">verified</span>
                            )}
                          </span>
                          <span className="text-[11px] text-[#77766F]">
                            {equipe.supervisor_nome ? 'Supervisor Regional' : 'Aguardando designação de líder'}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedEquipe(equipe);
                          handleOpenEditModal(equipe);
                        }}
                        className="text-xs text-purple-700 hover:underline flex items-center gap-1 font-semibold"
                      >
                        <span className="material-symbols-outlined text-sm">edit</span> Editar
                      </button>
                    </div>

                    {/* Operational Metrics Block */}
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="flex items-center gap-2 p-2.5 rounded-lg bg-[#EAE8E2] border border-[#CFCDC5]">
                        <span className="material-symbols-outlined text-purple-600 text-lg">badge</span>
                        <div className="flex flex-col">
                          <span className="font-bold text-[#171717]">
                            {equipe.promotoresCount} {equipe.promotoresCount === 1 ? 'Promotor' : 'Promotores'}
                          </span>
                          <span className="text-[10px] text-[#77766F]">Alocados na equipe</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 p-2.5 rounded-lg bg-[#EAE8E2] border border-[#CFCDC5]">
                        <span className="material-symbols-outlined text-cyan-600 text-lg">storefront</span>
                        <div className="flex flex-col">
                          <span className="font-bold text-[#171717]">
                            {equipe.pdvsCount} {equipe.pdvsCount === 1 ? 'PDV Atendido' : 'PDVs Atendidos'}
                          </span>
                          <span className="text-[10px] text-[#77766F]">Lojas distintas na grade</span>
                        </div>
                      </div>
                    </div>

                    {/* Footer Card */}
                    <div className="flex items-center justify-between pt-1 text-xs">
                      <span className="text-[#77766F] font-mono text-[11px]">
                        ID: {equipe.id.slice(0, 8)}...
                      </span>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedEquipe(equipe);
                          setDrawerTab('dados');
                        }}
                        className="px-3 py-1.5 rounded-lg bg-purple-50 hover:bg-purple-100 text-purple-700 text-xs font-semibold flex items-center gap-1.5 transition-all border border-purple-200"
                      >
                        <span className="material-symbols-outlined text-sm">tune</span>
                        <span>Ver Detalhes</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </section>

        {/* Interactive Drawer / Slide-Over: Gestão & Detalhes da Equipe Selecionada (5 cols) */}
        {selectedEquipe && (
          <aside className="xl:col-span-5 bg-[#F7F6F2] border border-[#CFCDC5] rounded-2xl shadow-2xl p-5 flex flex-col gap-4 sticky top-20">
            {/* Drawer Top Bar */}
            <div className="flex items-center justify-between pb-3 border-b border-[#CFCDC5]">
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-purple-600 text-xl">tune</span>
                  <h2 className="text-base font-bold text-[#171717]">{selectedEquipe.nome}</h2>
                </div>
                <span className="text-xs text-[#77766F] flex items-center gap-1.5 mt-0.5 font-mono">
                  <span className="px-1.5 py-0.2 rounded bg-[#EAE8E2] text-cyan-800 font-bold border border-cyan-500/20">
                    {selectedEquipe.codigo}
                  </span>
                  <span>• Regional: {selectedEquipe.regional || 'Não definida'}</span>
                </span>
              </div>
              <button
                onClick={() => fetchEquipes(selectedEquipe.id)}
                title="Sincronizar equipe"
                className="p-1.5 rounded-lg bg-[#EAE8E2] hover:bg-[#E4E2DB] text-[#77766F] hover:text-[#171717]"
              >
                <span className="material-symbols-outlined text-lg">sync</span>
              </button>
            </div>

            {/* Segmented Tabs Switcher */}
            <div className="flex items-center bg-[#EAE8E2] border border-[#CFCDC5] p-1 rounded-xl text-xs">
              <button
                onClick={() => setDrawerTab('dados')}
                className={`flex-1 py-1.5 rounded-lg text-center font-semibold transition-all cursor-pointer ${
                  drawerTab === 'dados' ? 'bg-[#222222] text-white shadow-sm' : 'text-[#77766F] hover:text-[#171717]'
                }`}
              >
                1. Dados &amp; Supervisor
              </button>
              <button
                onClick={() => setDrawerTab('promotores')}
                className={`flex-1 py-1.5 rounded-lg text-center font-bold transition-all cursor-pointer ${
                  drawerTab === 'promotores'
                    ? 'bg-[#222222] text-white shadow-xs shadow-sm'
                    : 'text-[#77766F] hover:text-[#171717]'
                }`}
              >
                2. Promotores &amp; Movimentação
              </button>
            </div>

            {drawerTab === 'dados' ? (
              /* TAB 1: Dados & Supervisor */
              <div className="space-y-4 text-xs">
                {/* Supervisor Card */}
                <div className="flex flex-col gap-1.5 bg-[#EAE8E2] border border-[#CFCDC5] p-3 rounded-xl">
                  <label className="text-[10px] font-bold uppercase font-mono text-[#77766F]">
                    Supervisor Responsável da Equipe
                  </label>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-purple-600/20 text-purple-700 border border-purple-500/30 font-bold text-xs flex items-center justify-center shrink-0">
                        {getInitials(selectedEquipe.supervisor_nome)}
                      </div>
                      <div className="truncate">
                        <span className="text-xs font-bold text-[#171717] block truncate">
                          {selectedEquipe.supervisor_nome || 'Nenhum supervisor atribuído'}
                        </span>
                        <span className="text-[11px] text-[#77766F] block truncate">
                          {selectedEquipe.supervisor_nome ? 'Supervisor Regional' : 'Clique em Alterar para designar'}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleOpenEditModal(selectedEquipe)}
                      className="px-2.5 py-1 text-purple-700 hover:text-purple-900 bg-[#F7F6F2] border border-[#CFCDC5] rounded-lg text-xs font-semibold shrink-0 cursor-pointer"
                    >
                      Alterar
                    </button>
                  </div>
                </div>

                {/* Ficha Resumo da Equipe */}
                <div className="space-y-2 p-3.5 rounded-xl bg-[#EAE8E2] border border-[#CFCDC5]">
                  <div className="flex justify-between items-center pb-2 border-b border-[#CFCDC5]">
                    <span className="text-[#5F5F5F]">Código Cadastral:</span>
                    <span className="font-mono font-bold text-[#171717]">{selectedEquipe.codigo}</span>
                  </div>
                  <div className="flex justify-between items-center pb-2 border-b border-[#CFCDC5]">
                    <span className="text-[#5F5F5F]">Status Operacional:</span>
                    <span className="font-bold uppercase text-[11px] font-mono text-[#171717]">
                      {selectedEquipe.status}
                    </span>
                  </div>
                  <div className="flex justify-between items-center pb-2 border-b border-[#CFCDC5]">
                    <span className="text-[#5F5F5F]">Praça / Regional:</span>
                    <span className="font-bold text-[#171717]">{selectedEquipe.regional || 'Não definida'}</span>
                  </div>
                  {selectedEquipe.created_at && (
                    <div className="flex justify-between items-center text-[11px] text-[#77766F]">
                      <span>Criado em:</span>
                      <span>{new Date(selectedEquipe.created_at).toLocaleDateString('pt-BR')}</span>
                    </div>
                  )}
                </div>

                {/* Ações Rápidas */}
                <div className="flex gap-2">
                  <button
                    onClick={() => handleOpenEditModal(selectedEquipe)}
                    className="flex-1 py-2 rounded-xl bg-[#222222] hover:bg-black text-white font-bold text-xs shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-sm">edit</span>
                    <span>Editar Dados</span>
                  </button>
                  {selectedEquipe.status !== 'arquivada' && (
                    <button
                      onClick={() => handleArchiveSquad(selectedEquipe)}
                      className="py-2 px-3 rounded-xl bg-red-100 hover:bg-red-200 text-red-700 font-semibold text-xs border border-red-200 transition-all flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-sm">archive</span>
                      <span>Arquivar</span>
                    </button>
                  )}
                </div>
              </div>
            ) : (
              /* TAB 2: Promotores & Movimentação */
              <div className="space-y-3 text-xs">
                {/* Bulk Action Box: Mover Promotores em Lote */}
                <div className="p-3.5 rounded-xl bg-[#EAE8E2] border border-cyan-500/30 flex flex-col gap-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-cyan-800 flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-base">swap_horizontal_circle</span>
                      Mover Promotores em Lote
                    </span>
                    <span className="px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-800 font-mono text-[11px] font-bold border border-cyan-500/30">
                      {selectedPromoterIds.length} selecionados
                    </span>
                  </div>
                  <p className="text-[11px] text-[#77766F]">
                    Selecione promotores vinculados para transferir contratos e rotas para outra equipe cadastrada.
                  </p>
                  <div className="flex flex-col sm:flex-row items-center gap-2 pt-1">
                    <select
                      value={targetSquadTransfer}
                      onChange={(e) => setTargetSquadTransfer(e.target.value)}
                      className="w-full bg-[#F7F6F2] border border-[#CFCDC5] text-xs text-[#171717] rounded-lg px-3 py-2 focus:outline-none focus:border-purple-500"
                    >
                      <option value="">Selecione a equipe de destino...</option>
                      {equipes
                        .filter((e) => e.id !== selectedEquipe.id && e.status !== 'arquivada')
                        .map((e) => (
                          <option key={e.id} value={e.nome}>
                            {e.nome} ({e.codigo})
                          </option>
                        ))}
                    </select>
                    <button
                      disabled={transferring}
                      onClick={handleTransferBatch}
                      className="w-full sm:w-auto shrink-0 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs shadow-xs transition-all flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
                    >
                      <span className="material-symbols-outlined text-sm">forward</span>
                      {transferring ? 'Transferindo...' : 'Transferir'}
                    </button>
                  </div>
                </div>
                {/* Lista Real de Promotores Vinculados à Equipe */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between pb-1 gap-2">
                    <span className="text-[11px] font-bold text-[#171717] truncate">
                      Promotores Integrantes ({teamPromoters.length})
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={handleOpenModalVincular}
                        className="px-2.5 py-1 rounded-md bg-purple-700 hover:bg-purple-800 text-white font-bold text-[10px] transition-all flex items-center gap-1 cursor-pointer shadow-xs"
                      >
                        <span className="material-symbols-outlined text-xs">group_add</span>
                        <span>+ Vincular Promotores</span>
                      </button>
                      {teamPromoters.length > 0 && (
                        <button
                          onClick={() => {
                            if (selectedPromoterIds.length === teamPromoters.length) {
                              setSelectedPromoterIds([]);
                            } else {
                              setSelectedPromoterIds(teamPromoters.map((p) => p.id));
                            }
                          }}
                          className="text-[10px] text-purple-700 hover:underline font-semibold cursor-pointer"
                        >
                          {selectedPromoterIds.length === teamPromoters.length ? 'Desmarcar todos' : 'Selecionar todos'}
                        </button>
                      )}
                    </div>
                  </div>

                  {loadingPromoters ? (
                    <div className="p-6 text-center text-[#77766F] bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl flex items-center justify-center gap-2">
                      <span className="material-symbols-outlined animate-spin text-purple-600 text-base">sync</span>
                      <span>Carregando promotores da equipe...</span>
                    </div>
                  ) : teamPromoters.length === 0 ? (
                    <div className="p-6 rounded-xl bg-[#EAE8E2] border border-[#CFCDC5] text-center text-[#77766F] space-y-2">
                      <span className="material-symbols-outlined text-3xl text-[#77766F]">groups</span>
                      <p className="text-xs font-semibold text-[#171717]">
                        Nenhum promotor vinculado a esta equipe no momento.
                      </p>
                      <p className="text-[11px]">
                        Atribua promotores a esta equipe pelo cadastro de promotores ou pelo cadastro de rotas.
                      </p>
                      <button
                        onClick={() => onNavigate('promotores')}
                        className="w-full py-2 rounded-lg bg-[#222222] hover:bg-black text-white text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer shadow-xs mt-2"
                      >
                        <span className="material-symbols-outlined text-base">person_add</span>
                        <span>Abrir Cadastro de Promotores</span>
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-1.5 max-h-[300px] overflow-y-auto pr-1">
                      {teamPromoters.map((p) => {
                        const isChecked = selectedPromoterIds.includes(p.id);
                        return (
                          <div
                            key={p.id}
                            onClick={() => handleTogglePromoter(p.id)}
                            className={`flex items-center justify-between p-2.5 rounded-lg border cursor-pointer transition-all ${
                              isChecked
                                ? 'bg-purple-600/10 border-purple-500/40 text-[#171717]'
                                : 'bg-[#EAE8E2] border-[#CFCDC5] text-[#222222] hover:bg-[#E4E2DB]'
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {}}
                                className="w-4 h-4 rounded text-purple-600 bg-[#F7F6F2] border-slate-600 focus:ring-0 cursor-pointer"
                              />
                              <div className="flex flex-col min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-bold truncate">{p.nome}</span>
                                  <span className="px-1.5 py-0.2 rounded bg-[#F7F6F2] text-cyan-800 font-mono text-[9px] font-bold border border-cyan-500/20">
                                    {p.matricula}
                                  </span>
                                </div>
                                <span className="text-[11px] text-[#77766F] truncate font-mono">
                                  {p.cidade} - {p.uf} {p.supervisor ? `• Sup: ${p.supervisor}` : ''}
                                </span>
                              </div>
                            </div>
                            {isChecked && (
                              <span className="px-2 py-0.5 rounded bg-purple-600/20 text-purple-800 font-mono text-[10px] font-bold">
                                Selecionado
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="pt-2 border-t border-[#CFCDC5]">
                  <button
                    onClick={() => onNavigate('promotores')}
                    className="w-full py-2 rounded-xl bg-[#EAE8E2] hover:bg-[#E4E2DB] text-[#171717] border border-[#CFCDC5] text-xs font-semibold transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-purple-700 text-base">person_add</span>
                    <span>Gerenciar Todos os Promotores</span>
                  </button>
                </div>
              </div>
            )}
          </aside>
        )}
      </div>

      {/* Modal Nova Equipe */}
      {modalNewSquad && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="relative w-full max-w-lg bg-[#F7F6F2] border border-[#CFCDC5] rounded-2xl shadow-2xl p-6 overflow-hidden">
            <div className="flex items-center justify-between pb-4 border-b border-[#CFCDC5]">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-purple-600/20 text-purple-700 border border-purple-500/30 flex items-center justify-center">
                  <span className="material-symbols-outlined text-xl">groups</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#171717]">Criar Nova Equipe Operacional</h3>
                  <p className="text-[11px] text-[#77766F]">Estruture uma nova equipe regional de campo</p>
                </div>
              </div>
              <button
                disabled={saving}
                onClick={() => setModalNewSquad(false)}
                className="text-[#77766F] hover:text-[#171717] p-1 cursor-pointer"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            <form onSubmit={handleCreateSquad} className="space-y-4 py-4 text-xs">
              <div className="space-y-1">
                <label className="font-bold text-[#171717]">Nome da Equipe / Squad *</label>
                <input
                  type="text"
                  required
                  disabled={saving}
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="ex: SP Capital Sul & Litoral"
                  className="w-full h-10 px-3 bg-[#E4E2DB] border border-[#CFCDC5] rounded-lg text-[#171717] focus:outline-none focus:border-purple-500 disabled:opacity-60 disabled:cursor-not-allowed"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <label className="font-bold text-[#171717]">Código da Equipe</label>
                  {suggestedCode && (
                    <span className="text-[10px] text-purple-700 font-mono">
                      Sugerido pelo sistema: <strong>{suggestedCode}</strong>
                    </span>
                  )}
                </div>
                <input
                  type="text"
                  value={manualCode}
                  disabled={saving}
                  onChange={(e) => setManualCode(e.target.value)}
                  placeholder="Deixe em branco para auto-gerar (EQP-XXX)"
                  className="w-full h-10 px-3 bg-[#E4E2DB] border border-[#CFCDC5] rounded-lg text-[#171717] font-mono focus:outline-none focus:border-purple-500 disabled:opacity-60 disabled:cursor-not-allowed"
                />
                <span className="text-[10px] text-[#77766F] block">
                  O código sugerido não é uma reserva e pode ser ajustado antes do salvamento.
                </span>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-[#171717]">Praça / Regional de Atuação</label>
                <input
                  type="text"
                  value={formRegion}
                  disabled={saving}
                  onChange={(e) => setFormRegion(e.target.value)}
                  placeholder="ex: São Paulo - Zona Sul & Litoral"
                  className="w-full h-10 px-3 bg-[#E4E2DB] border border-[#CFCDC5] rounded-lg text-[#171717] focus:outline-none focus:border-purple-500 disabled:opacity-60 disabled:cursor-not-allowed"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <label className="font-bold text-[#171717]">Supervisor Responsável</label>
                  <button
                    type="button"
                    onClick={() => onNavigate('supervisores')}
                    className="text-[10px] text-purple-700 hover:underline font-semibold flex items-center gap-0.5 cursor-pointer"
                  >
                    <span>Cadastrar Supervisor</span>
                    <span className="material-symbols-outlined text-xs">open_in_new</span>
                  </button>
                </div>

                {supervisoresError ? (
                  <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-900 text-[11px] space-y-1">
                    <div className="flex items-center gap-1 font-bold text-amber-800">
                      <span className="material-symbols-outlined text-sm">warning</span>
                      <span>Módulo de Supervisores não provisionado</span>
                    </div>
                    <p className="text-[#5F5F5F]">
                      A seleção de supervisor requer a tabela de supervisores provisionada no banco ({supervisoresError}). A equipe pode ser cadastrada sem supervisor no momento.
                    </p>
                  </div>
                ) : loadingSupervisores ? (
                  <div className="h-10 px-3 bg-[#E4E2DB] border border-[#CFCDC5] rounded-lg text-[#77766F] flex items-center gap-2">
                    <span className="material-symbols-outlined text-base animate-spin text-purple-600">sync</span>
                    <span>Carregando supervisores disponíveis...</span>
                  </div>
                ) : (
                  <select
                    value={formSupervisorId}
                    disabled={saving}
                    onChange={(e) => {
                      const selId = e.target.value;
                      setFormSupervisorId(selId);
                      const sup = supervisores.find((s) => s.id === selId);
                      setFormSupervisor(sup ? sup.nome : '');
                    }}
                    className="w-full h-10 px-3 bg-[#E4E2DB] border border-[#CFCDC5] rounded-lg text-[#171717] focus:outline-none focus:border-purple-500 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <option value="">-- Selecione um Supervisor Responsável (Opcional) --</option>
                    {supervisores
                      .filter((s) => s.status === 'ativo' || s.id === formSupervisorId)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.nome} ({s.codigo}){s.regional ? ` - ${s.regional}` : ''}{s.status !== 'ativo' ? ` [${s.status.toUpperCase()}]` : ''}
                        </option>
                      ))}
                  </select>
                )}
                {supervisores.filter((s) => s.status === 'ativo').length === 0 && !supervisoresError && !loadingSupervisores && (
                  <span className="text-[10px] text-amber-700 flex items-center gap-1 mt-0.5">
                    <span className="material-symbols-outlined text-xs">info</span>
                    Nenhum supervisor ativo cadastrado. Cadastre supervisores no módulo correspondente.
                  </span>
                )}
              </div>

              <div className="space-y-1">
                <label className="font-bold text-[#171717]">Status Inicial</label>
                <select
                  value={formStatus}
                  disabled={saving}
                  onChange={(e) => setFormStatus(e.target.value as EquipeStatus)}
                  className="w-full h-10 px-3 bg-[#E4E2DB] border border-[#CFCDC5] rounded-lg text-[#171717] focus:outline-none focus:border-purple-500 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <option value="ativa">Ativa</option>
                  <option value="reestruturacao">Em Reestruturação</option>
                  <option value="arquivada">Arquivada</option>
                </select>
              </div>

              <div className="pt-3 border-t border-[#CFCDC5] flex items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setModalNewSquad(false)}
                  className="px-4 py-2 rounded-lg bg-[#EAE8E2] hover:bg-[#E4E2DB] text-[#171717] border border-[#CFCDC5] font-semibold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 rounded-lg bg-[#222222] hover:bg-black text-white font-bold shadow-xs cursor-pointer disabled:opacity-50"
                >
                  {saving ? 'Criando...' : 'Criar Squad'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Editar Equipe */}
      {modalEditSquad && selectedEquipe && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="relative w-full max-w-lg bg-[#F7F6F2] border border-[#CFCDC5] rounded-2xl shadow-2xl p-6 overflow-hidden">
            <div className="flex items-center justify-between pb-4 border-b border-[#CFCDC5]">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-purple-600/20 text-purple-700 border border-purple-500/30 flex items-center justify-center">
                  <span className="material-symbols-outlined text-xl">edit</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#171717]">Editar Equipe Operacional</h3>
                  <p className="text-[11px] text-[#77766F] font-mono">{selectedEquipe.codigo}</p>
                </div>
              </div>
              <button
                disabled={saving}
                onClick={() => setModalEditSquad(false)}
                className="text-[#77766F] hover:text-[#171717] p-1 cursor-pointer"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            <form onSubmit={handleUpdateSquad} className="space-y-4 py-4 text-xs">
              <div className="space-y-1">
                <label className="font-bold text-[#171717]">Nome da Equipe / Squad *</label>
                <input
                  type="text"
                  required
                  disabled={saving}
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full h-10 px-3 bg-[#E4E2DB] border border-[#CFCDC5] rounded-lg text-[#171717] focus:outline-none focus:border-purple-500 disabled:opacity-60 disabled:cursor-not-allowed"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-[#171717]">Código da Equipe</label>
                <input
                  type="text"
                  value={manualCode}
                  disabled={saving}
                  onChange={(e) => setManualCode(e.target.value)}
                  placeholder={suggestedCode || 'Deixe em branco para auto-gerar (EQP-XXX)'}
                  className="w-full h-10 px-3 bg-[#E4E2DB] border border-[#CFCDC5] rounded-lg text-[#171717] font-mono focus:outline-none focus:border-purple-500 disabled:opacity-60 disabled:cursor-not-allowed"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-[#171717]">Praça / Regional de Atuação</label>
                <input
                  type="text"
                  value={formRegion}
                  disabled={saving}
                  onChange={(e) => setFormRegion(e.target.value)}
                  placeholder="ex: São Paulo - Capital"
                  className="w-full h-10 px-3 bg-[#E4E2DB] border border-[#CFCDC5] rounded-lg text-[#171717] focus:outline-none focus:border-purple-500 disabled:opacity-60 disabled:cursor-not-allowed"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <label className="font-bold text-[#171717]">Supervisor Responsável</label>
                  <button
                    type="button"
                    onClick={() => onNavigate('supervisores')}
                    className="text-[10px] text-purple-700 hover:underline font-semibold flex items-center gap-0.5 cursor-pointer"
                  >
                    <span>Cadastrar Supervisor</span>
                    <span className="material-symbols-outlined text-xs">open_in_new</span>
                  </button>
                </div>

                {supervisoresError ? (
                  <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-900 text-[11px] space-y-1">
                    <div className="flex items-center gap-1 font-bold text-amber-800">
                      <span className="material-symbols-outlined text-sm">warning</span>
                      <span>Módulo de Supervisores não provisionado</span>
                    </div>
                    <p className="text-[#5F5F5F]">
                      A seleção de supervisor requer a tabela de supervisores provisionada no banco ({supervisoresError}). As alterações da equipe podem ser salvas mantendo ou sem supervisor.
                    </p>
                  </div>
                ) : loadingSupervisores ? (
                  <div className="h-10 px-3 bg-[#E4E2DB] border border-[#CFCDC5] rounded-lg text-[#77766F] flex items-center gap-2">
                    <span className="material-symbols-outlined text-base animate-spin text-purple-600">sync</span>
                    <span>Carregando supervisores disponíveis...</span>
                  </div>
                ) : (
                  <select
                    value={formSupervisorId}
                    disabled={saving}
                    onChange={(e) => {
                      const selId = e.target.value;
                      setFormSupervisorId(selId);
                      const sup = supervisores.find((s) => s.id === selId);
                      setFormSupervisor(sup ? sup.nome : '');
                    }}
                    className="w-full h-10 px-3 bg-[#E4E2DB] border border-[#CFCDC5] rounded-lg text-[#171717] focus:outline-none focus:border-purple-500 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <option value="">-- Sem Supervisor Atribuído --</option>
                    {supervisores
                      .filter((s) => s.status === 'ativo' || s.id === formSupervisorId)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.nome} ({s.codigo}){s.regional ? ` - ${s.regional}` : ''}{s.status !== 'ativo' ? ` [${s.status.toUpperCase()}]` : ''}
                        </option>
                      ))}
                  </select>
                )}
                {formSupervisor && !formSupervisorId && (
                  <span className="text-[10px] text-[#77766F] block mt-0.5">
                    Supervisor textual histórico: <strong>{formSupervisor}</strong>. Selecione um supervisor oficial para migrar o vínculo.
                  </span>
                )}
              </div>

              <div className="space-y-1">
                <label className="font-bold text-[#171717]">Status da Equipe</label>
                <select
                  value={formStatus}
                  disabled={saving}
                  onChange={(e) => setFormStatus(e.target.value as EquipeStatus)}
                  className="w-full h-10 px-3 bg-[#E4E2DB] border border-[#CFCDC5] rounded-lg text-[#171717] focus:outline-none focus:border-purple-500 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <option value="ativa">Ativa</option>
                  <option value="reestruturacao">Em Reestruturação</option>
                  <option value="arquivada">Arquivada</option>
                </select>
              </div>

              <div className="pt-3 border-t border-[#CFCDC5] flex items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setModalEditSquad(false)}
                  className="px-4 py-2 rounded-lg bg-[#EAE8E2] hover:bg-[#E4E2DB] text-[#171717] border border-[#CFCDC5] font-semibold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 rounded-lg bg-[#222222] hover:bg-black text-white font-bold shadow-xs cursor-pointer disabled:opacity-50"
                >
                  {saving ? 'Salvando...' : 'Salvar Alterações'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: VINCULAR PROMOTORES DISPONÍVEIS À EQUIPE */}
      {modalVincularOpen && selectedEquipe && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-[#F7F6F2] rounded-2xl max-w-xl w-full p-5 shadow-2xl border border-[#CFCDC5] space-y-4 max-h-[90vh] flex flex-col">
            {/* Cabeçalho */}
            <div className="flex items-start justify-between pb-3 border-b border-[#CFCDC5] shrink-0">
              <div>
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-purple-700 text-xl">group_add</span>
                  <h3 className="text-base font-bold text-[#171717]">Vincular Promotores à Equipe</h3>
                </div>
                <p className="text-xs text-[#77766F] mt-0.5">
                  Equipe de destino: <strong className="text-[#171717] font-semibold">{selectedEquipe.nome}</strong> ({selectedEquipe.codigo})
                </p>
              </div>
              <button
                type="button"
                disabled={savingVinculacao}
                onClick={() => setModalVincularOpen(false)}
                className="w-8 h-8 rounded-lg bg-[#EAE8E2] text-[#77766F] hover:text-[#171717] flex items-center justify-center cursor-pointer transition-colors"
              >
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            </div>

            {/* Alerta de Escopo */}
            <div className="p-2.5 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-900 text-xs flex items-center justify-between shrink-0">
              <span className="flex items-center gap-1.5 font-medium">
                <span className="material-symbols-outlined text-base text-cyan-600">info</span>
                Exibindo somente promotores sem equipe associada
              </span>
              <span className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-900 font-mono text-[11px] font-bold">
                {selectedToVincularIds.length} selecionado(s)
              </span>
            </div>

            {/* Barra de Busca e Selecionar Todos */}
            <div className="flex items-center gap-2 shrink-0">
              <div className="relative flex-1">
                <span className="material-symbols-outlined absolute left-3 top-2.5 text-[#77766F] text-base">search</span>
                <input
                  type="text"
                  value={vincularSearch}
                  onChange={(e) => setVincularSearch(e.target.value)}
                  placeholder="Buscar promotor por nome ou matrícula..."
                  className="w-full pl-9 pr-3 py-1.5 bg-[#E4E2DB] border border-[#CFCDC5] rounded-lg text-xs text-[#171717] placeholder:text-[#77766F] focus:outline-none focus:border-purple-500"
                />
              </div>
              {promotoresDisponiveis.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const filtered = promotoresDisponiveis.filter((p) => {
                      const term = vincularSearch.trim().toLowerCase();
                      if (!term) return true;
                      return (
                        p.nome.toLowerCase().includes(term) ||
                        p.matricula.toLowerCase().includes(term) ||
                        (p.cidade && p.cidade.toLowerCase().includes(term))
                      );
                    });
                    if (selectedToVincularIds.length === filtered.length) {
                      setSelectedToVincularIds([]);
                    } else {
                      setSelectedToVincularIds(filtered.map((p) => p.id));
                    }
                  }}
                  className="text-xs text-purple-700 hover:underline font-semibold shrink-0 cursor-pointer px-2"
                >
                  {selectedToVincularIds.length === promotoresDisponiveis.length ? 'Desmarcar todos' : 'Marcar todos'}
                </button>
              )}
            </div>

            {/* Corpo da Lista com Scroll */}
            <div className="flex-1 overflow-y-auto min-h-[220px] max-h-[360px] pr-1 space-y-1.5">
              {loadingDisponiveis ? (
                <div className="p-8 text-center text-[#77766F] flex flex-col items-center justify-center gap-2">
                  <span className="material-symbols-outlined animate-spin text-purple-600 text-2xl">sync</span>
                  <span className="text-xs font-semibold">Buscando promotores disponíveis no Supabase...</span>
                </div>
              ) : disponiveisError ? (
                <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-800 text-xs space-y-1">
                  <div className="flex items-center gap-1.5 font-bold">
                    <span className="material-symbols-outlined text-base">error</span>
                    <span>Falha ao consultar promotores</span>
                  </div>
                  <p className="text-[11px] text-[#5F5F5F]">{disponiveisError}</p>
                  <button
                    type="button"
                    onClick={handleOpenModalVincular}
                    className="mt-2 px-3 py-1 bg-rose-700 text-white rounded-md text-[11px] font-semibold cursor-pointer"
                  >
                    Tentar novamente
                  </button>
                </div>
              ) : promotoresDisponiveis.length === 0 ? (
                <div className="p-8 rounded-xl bg-[#EAE8E2] border border-[#CFCDC5] text-center text-[#77766F] space-y-1.5">
                  <span className="material-symbols-outlined text-3xl text-emerald-600">check_circle</span>
                  <p className="text-xs font-bold text-[#171717]">Todos os promotores já possuem equipe alocada!</p>
                  <p className="text-[11px]">Não há promotores sem equipe cadastrada no momento.</p>
                </div>
              ) : (
                (() => {
                  const filtered = promotoresDisponiveis.filter((p) => {
                    const term = vincularSearch.trim().toLowerCase();
                    if (!term) return true;
                    return (
                      p.nome.toLowerCase().includes(term) ||
                      p.matricula.toLowerCase().includes(term) ||
                      (p.cidade && p.cidade.toLowerCase().includes(term))
                    );
                  });

                  if (filtered.length === 0) {
                    return (
                      <div className="p-6 text-center text-xs text-[#77766F]">
                        Nenhum promotor encontrado para o termo "{vincularSearch}".
                      </div>
                    );
                  }

                  return filtered.map((p) => {
                    const isChecked = selectedToVincularIds.includes(p.id);
                    return (
                      <div
                        key={p.id}
                        onClick={() => handleToggleVincularPromoter(p.id)}
                        className={`flex items-center justify-between p-2.5 rounded-lg border cursor-pointer transition-all ${
                          isChecked
                            ? 'bg-purple-600/10 border-purple-500/40 text-[#171717]'
                            : 'bg-[#EAE8E2] border-[#CFCDC5] text-[#222222] hover:bg-[#E4E2DB]'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {}}
                            className="w-4 h-4 rounded text-purple-600 bg-[#F7F6F2] border-[#CFCDC5] focus:ring-0 cursor-pointer"
                          />
                          <div className="flex flex-col min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold truncate">{p.nome}</span>
                              <span className="px-1.5 py-0.2 rounded bg-[#F7F6F2] text-cyan-800 font-mono text-[9px] font-bold border border-cyan-500/20">
                                {p.matricula}
                              </span>
                            </div>
                            <span className="text-[11px] text-[#77766F] truncate font-mono">
                              {p.cidade || 'Sem cidade'} - {p.uf || 'UF'} {p.status ? `• Status: ${p.status}` : ''}
                            </span>
                          </div>
                        </div>
                        {isChecked && (
                          <span className="px-2 py-0.5 rounded bg-purple-600/20 text-purple-800 font-mono text-[10px] font-bold shrink-0">
                            Selecionado
                          </span>
                        )}
                      </div>
                    );
                  });
                })()
              )}
            </div>

            {/* Rodapé com Ações */}
            <div className="pt-3 border-t border-[#CFCDC5] flex items-center justify-between gap-2 shrink-0">
              <span className="text-xs text-[#77766F] font-mono">
                Total disponível: <strong className="text-[#171717]">{promotoresDisponiveis.length}</strong>
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={savingVinculacao}
                  onClick={() => setModalVincularOpen(false)}
                  className="px-4 py-2 rounded-lg bg-[#EAE8E2] hover:bg-[#E4E2DB] text-[#171717] border border-[#CFCDC5] text-xs font-semibold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={savingVinculacao || selectedToVincularIds.length === 0}
                  onClick={handleConfirmarVinculacao}
                  className="px-5 py-2 rounded-lg bg-purple-700 hover:bg-purple-800 text-white text-xs font-bold shadow-xs cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-sm">check</span>
                  <span>{savingVinculacao ? 'Vinculando...' : `Confirmar Vinculação (${selectedToVincularIds.length})`}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
