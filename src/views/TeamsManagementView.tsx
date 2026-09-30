import React, { useState } from 'react';
import { ScreenId, ToastMessage, SquadTeam } from '../types';
import { INITIAL_SQUADS } from '../data/mockData';

interface TeamsManagementViewProps {
  onNavigate: (screen: ScreenId) => void;
  onShowToast: (toast: Omit<ToastMessage, 'id'>) => void;
}

export const TeamsManagementView: React.FC<TeamsManagementViewProps> = ({
  onNavigate,
  onShowToast
}) => {
  const [squads, setSquads] = useState<SquadTeam[]>(INITIAL_SQUADS);
  const [selectedSquad, setSelectedSquad] = useState<SquadTeam>(INITIAL_SQUADS[0]);
  const [drawerTab, setDrawerTab] = useState<'dados' | 'promotores'>('promotores');
  const [search, setSearch] = useState('');
  const [regionFilter, setRegionFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'ativa' | 'reestruturacao' | 'arquivada'>('all');
  const [modalNewSquad, setModalNewSquad] = useState(false);

  // Drawer transfer state
  const [selectedPromoterIds, setSelectedPromoterIds] = useState<string[]>(['p1', 'p2']);
  const [targetSquadTransfer, setTargetSquadTransfer] = useState('SP Capital Sul');

  // New Squad form
  const [newSquadName, setNewSquadName] = useState('');
  const [newSquadRegion, setNewSquadRegion] = useState('São Paulo - Capital');
  const [newSquadSupervisor, setNewSquadSupervisor] = useState('Renata Vasconcelos');

  const squadPromotersList = [
    { id: 'p1', name: 'Lucas Albuquerque', type: 'CLT', matricula: 'MAT-84920', area: 'Zona Norte SP (Santana)' },
    { id: 'p2', name: 'Marcos Faria', type: 'CLT', matricula: 'MAT-82103', area: 'Hipermercados Santana' },
    { id: 'p3', name: 'Larissa Guimarães', type: 'CLT', matricula: 'MAT-85112', area: 'Freguesia do Ó' },
    { id: 'p4', name: 'Danilo Rezende', type: 'FREELANCER', matricula: 'MAT-86301', area: 'Brasilândia' },
    { id: 'p5', name: 'Gabriela Rocha', type: 'CLT', matricula: 'MAT-83441', area: 'Tucuruvi / Jaçanã' }
  ];

  const handleTogglePromoter = (id: string) => {
    setSelectedPromoterIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleTransferBatch = () => {
    if (selectedPromoterIds.length === 0) {
      onShowToast({
        title: 'Nenhum Promotor Selecionado',
        message: 'Marque ao menos um promotor para transferir.',
        type: 'warning'
      });
      return;
    }

    onShowToast({
      title: 'Transferência de Squad Concluída',
      message: `${selectedPromoterIds.length} promotores transferidos para ${targetSquadTransfer}. Supervisor notificado.`,
      type: 'success'
    });
  };

  const handleCreateSquad = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSquadName.trim()) return;

    const newSquad: SquadTeam = {
      id: `squad-${Date.now()}`,
      code: `SQUAD-0${squads.length + 1}`,
      name: newSquadName,
      region: newSquadRegion,
      supervisorName: newSquadSupervisor,
      supervisorTitle: 'Supervisor Regional',
      supervisorInitials: newSquadSupervisor.split(' ').map((n) => n[0]).join(''),
      promotersClt: 0,
      promotersFree: 0,
      coveragePercent: 100,
      coverageTrend: 'Novo Squad',
      storesCount: 0,
      status: 'ativa',
      description: 'Squad recém-criado aguardando alocação de promotores.'
    };

    setSquads((prev) => [newSquad, ...prev]);
    setSelectedSquad(newSquad);
    setModalNewSquad(false);
    setNewSquadName('');

    onShowToast({
      title: 'Equipe Criada com Sucesso',
      message: `Squad ${newSquad.name} cadastrado e pronto para alocação.`,
      type: 'success'
    });
  };

  const filteredSquads = squads.filter((s) => {
    const matchesSearch =
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.region.toLowerCase().includes(search.toLowerCase()) ||
      s.supervisorName.toLowerCase().includes(search.toLowerCase());

    const matchesStatus =
      statusFilter === 'all' || s.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  return (
    <div className="w-full px-4 lg:px-8 py-6 max-w-[1720px] mx-auto space-y-6">
      {/* Live Status Toast Banner */}
      <div className="w-full bg-[#171b26] border border-emerald-500/30 rounded-xl p-3.5 shadow-lg flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center">
            <span className="material-symbols-outlined text-lg">check_circle</span>
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-bold text-white flex items-center gap-2">
              Atualização de Squad Concluída
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            </span>
            <span className="text-[11px] text-slate-400">
              2 promotores transferidos para <strong className="text-cyan-300">SP Capital Sul</strong>. Supervisor regional Renata Vasconcelos notificada via push.
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onShowToast({ title: 'Ação Desfeita', message: 'Alocação anterior restaurada.', type: 'info' })}
            className="px-3 py-1 rounded-lg bg-[#131722] hover:bg-[#1f2433] text-cyan-300 border border-[#1e2433] text-xs font-semibold flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-sm">undo</span> Desfazer
          </button>
        </div>
      </div>

      {/* Screen Header */}
      <section className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="flex flex-col space-y-1.5 max-w-3xl">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full bg-purple-600/20 text-purple-300 border border-purple-500/30 font-mono text-[11px] font-bold uppercase tracking-wider">
              Módulo de Estrutura de Campo
            </span>
            <span className="font-mono text-xs text-slate-400">• v2.5 Operacional</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Gestão de Equipes
          </h1>
          <p className="text-xs sm:text-sm text-slate-400">
            Estruture squads operacionais de campo, vincule supervisores regionais e gerencie a distribuição contínua de promotores CLT e terceiros com conformidade de rota.
          </p>

          {/* Rapid Meta Badges */}
          <div className="flex flex-wrap items-center gap-2 pt-1 font-mono text-xs">
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#171b26] border border-[#1e2433] text-slate-200">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span>{squads.filter((s) => s.status === 'ativa').length} Equipes Ativas</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#171b26] border border-[#1e2433] text-slate-200">
              <span className="material-symbols-outlined text-cyan-400 text-sm">map</span>
              <span>{squads.length} Estruturas</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#171b26] border border-[#1e2433] text-slate-200">
              <span className="material-symbols-outlined text-purple-400 text-sm">groups</span>
              <span>{squads.reduce((acc, s) => acc + (s.promotersClt || 0) + (s.promotersFree || 0), 0)} Promotores Alocados</span>
            </div>
          </div>
        </div>

        {/* Header Actions */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => onShowToast({ title: 'Exportar Estrutura', message: 'Organograma de squads exportado em PDF.', type: 'info' })}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#171b26] hover:bg-[#1f2433] text-slate-200 border border-[#1e2433] text-xs font-semibold shadow-sm"
          >
            <span className="material-symbols-outlined text-lg">download</span>
            <span>Exportar Estrutura</span>
          </button>
          <button
            onClick={() => setModalNewSquad(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs neon-purple-glow transition-all active:scale-95 shadow-md cursor-pointer"
          >
            <span className="material-symbols-outlined text-lg">add</span>
            <span>+ Nova equipe</span>
          </button>
        </div>
      </section>

      {/* Filter & Tactical Search Bar */}
      <section className="bg-[#171b26] border border-[#1e2433] rounded-xl p-4 shadow-md space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
          <div className="md:col-span-6 relative">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-base">
              search
            </span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar equipe, regional ou supervisor..."
              className="w-full h-10 pl-9 pr-20 bg-[#131722] border border-[#1e2433] rounded-lg text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-purple-500"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[10px] text-slate-400">
              {filteredSquads.length} squads
            </span>
          </div>

          <div className="md:col-span-3">
            <select
              value={regionFilter}
              onChange={(e) => setRegionFilter(e.target.value)}
              className="w-full h-10 px-3 bg-[#131722] border border-[#1e2433] rounded-lg text-xs text-slate-200 focus:outline-none focus:border-purple-500 cursor-pointer"
            >
              <option value="all">Todas as Regionais</option>
              <option value="SP Capital">SP Capital</option>
              <option value="Interior SP">Interior SP</option>
              <option value="Rio de Janeiro">RJ Metropolitana</option>
              <option value="Belo Horizonte">Minas Gerais</option>
              <option value="Paraná">Sul (PR/SC/RS)</option>
            </select>
          </div>

          <div className="md:col-span-3 flex items-center gap-2">
            <select className="w-full h-10 px-3 bg-[#131722] border border-[#1e2433] rounded-lg text-xs text-slate-200 focus:outline-none focus:border-purple-500 cursor-pointer">
              <option>Todos os Supervisores</option>
              <option>Renata Vasconcelos</option>
              <option>Carlos Silveira</option>
              <option>Eduardo Mendes</option>
            </select>
            <div className="flex items-center bg-[#131722] border border-[#1e2433] rounded-lg p-0.5 shrink-0">
              <button className="p-1.5 rounded bg-purple-600/30 text-purple-300" title="Grade de Cards">
                <span className="material-symbols-outlined text-base">grid_view</span>
              </button>
            </div>
          </div>
        </div>

        {/* Filter Chips Status */}
        <div className="pt-2 border-t border-[#1e2433] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider font-mono mr-1">
              Filtrar por Status:
            </span>
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                statusFilter === 'all'
                  ? 'bg-purple-600 text-white font-bold neon-purple-glow'
                  : 'bg-[#131722] text-slate-300 hover:text-white border border-[#1e2433]'
              }`}
            >
              Todas (18)
            </button>
            <button
              onClick={() => setStatusFilter('ativa')}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                statusFilter === 'ativa'
                  ? 'bg-emerald-600 text-white font-bold'
                  : 'bg-[#131722] text-emerald-400 hover:text-white border border-[#1e2433]'
              }`}
            >
              Ativas (16)
            </button>
            <button
              onClick={() => setStatusFilter('reestruturacao')}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                statusFilter === 'reestruturacao'
                  ? 'bg-amber-600 text-white font-bold'
                  : 'bg-[#131722] text-amber-300 hover:text-white border border-[#1e2433]'
              }`}
            >
              Em Reestruturação (2)
            </button>
            <button
              onClick={() => setStatusFilter('arquivada')}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                statusFilter === 'arquivada'
                  ? 'bg-slate-700 text-white font-bold'
                  : 'bg-[#131722] text-slate-400 hover:text-white border border-[#1e2433]'
              }`}
            >
              Arquivadas (4)
            </button>
          </div>

          <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
            <span>Ordenar: <strong className="text-white">Maior Cobertura ↓</strong></span>
          </div>
        </div>
      </section>

      {/* Main Content Layout (7 cols Cards + 5 cols Interactive Drawer Workspace) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Teams Cards Grid (7 cols) */}
        <section className="xl:col-span-7 flex flex-col gap-4">
          {filteredSquads.length === 0 ? (
            <div className="bg-[#171b26] border border-[#1e2433] rounded-xl p-12 text-center flex flex-col items-center justify-center space-y-3">
              <span className="material-symbols-outlined text-4xl text-slate-600">groups</span>
              <h3 className="text-base font-bold text-slate-200">Não há dados cadastrados ainda.</h3>
              <p className="text-xs text-slate-400">Cadastre uma nova equipe operacional para iniciar o gerenciamento.</p>
            </div>
          ) : (
            filteredSquads.map((squad) => {
            const isSelected = selectedSquad.id === squad.id;
            return (
              <div
                key={squad.id}
                onClick={() => setSelectedSquad(squad)}
                className={`cursor-pointer bg-[#171b26] border rounded-xl p-5 shadow-lg relative overflow-hidden transition-all group ${
                  isSelected
                    ? 'border-purple-500 ring-1 ring-purple-500/40 shadow-[0_0_20px_rgba(147,51,234,0.2)]'
                    : 'border-[#1e2433] hover:border-slate-600'
                }`}
              >
                {/* Top Accent Strip */}
                <div
                  className={`absolute top-0 left-0 right-0 h-1 ${
                    squad.status === 'reestruturacao'
                      ? 'bg-amber-500'
                      : squad.status === 'arquivada'
                      ? 'bg-slate-600'
                      : 'bg-gradient-to-r from-purple-600 via-indigo-500 to-cyan-400'
                  }`}
                />

                <div className="flex flex-col gap-4">
                  {/* Top Row */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <h2 className="text-base font-bold text-white group-hover:text-purple-300 transition-colors">
                          {squad.name}
                        </h2>
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-mono text-[10px] font-bold ${
                            squad.status === 'ativa'
                              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                              : squad.status === 'reestruturacao'
                              ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                              : 'bg-slate-800 text-slate-400 border border-slate-700'
                          }`}
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-current" />
                          {squad.status.toUpperCase()}
                        </span>
                        <span className="px-1.5 py-0.2 rounded bg-[#131722] text-cyan-400 font-mono text-[10px] border border-cyan-500/20">
                          {squad.code}
                        </span>
                      </div>
                      <span className="text-xs text-slate-400 mt-0.5">Regional: {squad.region}</span>
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onShowToast({ title: squad.name, message: squad.description || 'Squad operacional ativo.', type: 'info' });
                      }}
                      className="p-1 rounded text-slate-400 hover:text-white"
                    >
                      <span className="material-symbols-outlined text-lg">more_vert</span>
                    </button>
                  </div>

                  {/* Supervisor Block */}
                  <div className="flex items-center justify-between p-3 rounded-lg bg-[#131722] border border-[#1e2433]">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-purple-600/30 text-purple-300 border border-purple-500/40 flex items-center justify-center font-bold text-xs">
                        {squad.supervisorInitials}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-xs font-bold text-white flex items-center gap-1">
                          {squad.supervisorName}
                          <span className="material-symbols-outlined text-emerald-400 text-xs">verified</span>
                        </span>
                        <span className="text-[11px] text-slate-400">{squad.supervisorTitle}</span>
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onShowToast({ title: 'Troca de Supervisor', message: `Abrindo fluxo de reatribuição para ${squad.name}.`, type: 'info' });
                      }}
                      className="text-xs text-cyan-400 hover:underline flex items-center gap-1 font-semibold"
                    >
                      <span className="material-symbols-outlined text-sm">sync_alt</span> Trocar
                    </button>
                  </div>

                  {/* Metrics Row */}
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="p-2.5 rounded-lg bg-[#131722] border border-[#1e2433]">
                      <span className="text-[10px] uppercase font-mono font-bold text-slate-400 block">Promotores</span>
                      <span className="text-xl font-extrabold text-white font-mono">{squad.promotersClt + squad.promotersFree}</span>
                      <span className="text-[10px] text-emerald-400 font-mono block">
                        {squad.promotersClt} CLT • {squad.promotersFree} Free
                      </span>
                    </div>

                    <div className="p-2.5 rounded-lg bg-[#131722] border border-[#1e2433]">
                      <span className="text-[10px] uppercase font-mono font-bold text-slate-400 block">Cobertura</span>
                      <span className="text-xl font-extrabold text-emerald-400 font-mono">{squad.coveragePercent}%</span>
                      <span className="text-[10px] text-slate-400 font-mono block">{squad.coverageTrend}</span>
                    </div>

                    <div className="p-2.5 rounded-lg bg-[#131722] border border-[#1e2433]">
                      <span className="text-[10px] uppercase font-mono font-bold text-slate-400 block">PDVs</span>
                      <span className="text-xl font-extrabold text-cyan-300 font-mono">{squad.storesCount}</span>
                      <span className="text-[10px] text-slate-400 font-mono block">Atendidos</span>
                    </div>
                  </div>

                  {/* Footer Card */}
                  <div className="flex items-center justify-between pt-1">
                    <div className="flex items-center gap-2">
                      <div className="flex -space-x-2">
                        <div className="w-7 h-7 rounded-full bg-purple-600/30 text-purple-300 border border-[#171b26] flex items-center justify-center font-bold text-[10px]">
                          LA
                        </div>
                        <div className="w-7 h-7 rounded-full bg-cyan-600/30 text-cyan-300 border border-[#171b26] flex items-center justify-center font-bold text-[10px]">
                          CS
                        </div>
                        <div className="w-7 h-7 rounded-full bg-[#131722] text-slate-400 border border-[#171b26] flex items-center justify-center font-bold text-[10px] font-mono">
                          +{squad.promotersClt + squad.promotersFree - 2}
                        </div>
                      </div>
                      <span className="text-xs text-slate-400">integrantes</span>
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedSquad(squad);
                        onShowToast({ title: squad.name, message: 'Visualizando promotores no painel lateral.', type: 'info' });
                      }}
                      className="px-3 py-1.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 text-xs font-semibold flex items-center gap-1.5 transition-all border border-cyan-500/20"
                    >
                      <span className="material-symbols-outlined text-sm">group_add</span>
                      <span>Gerenciar promotores</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          }))}
        </section>

        {/* Interactive Drawer / Slide-Over: Gestão & Movimentação Operacional (5 cols) */}
        <aside className="xl:col-span-5 bg-[#171b26] border border-[#1e2433] rounded-2xl shadow-2xl p-5 flex flex-col gap-4 sticky top-20">
          {/* Drawer Top Bar */}
          <div className="flex items-center justify-between pb-3 border-b border-[#1e2433]">
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-purple-400 text-xl">tune</span>
                <h2 className="text-base font-bold text-white">Gerenciar: {selectedSquad.name}</h2>
              </div>
              <span className="text-xs text-emerald-400 flex items-center gap-1.5 mt-0.5 font-mono">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                {selectedSquad.promotersClt + selectedSquad.promotersFree} Promotores Ativos nesta escala
              </span>
            </div>
            <button
              onClick={() => onShowToast({ title: selectedSquad.name, message: 'Configurações sincronizadas.', type: 'info' })}
              className="p-1.5 rounded-lg bg-[#131722] hover:bg-[#1f2433] text-slate-400 hover:text-white"
            >
              <span className="material-symbols-outlined text-lg">sync</span>
            </button>
          </div>

          {/* Segmented Tabs Switcher */}
          <div className="flex items-center bg-[#131722] border border-[#1e2433] p-1 rounded-xl text-xs">
            <button
              onClick={() => setDrawerTab('dados')}
              className={`flex-1 py-1.5 rounded-lg text-center font-semibold transition-all ${
                drawerTab === 'dados' ? 'bg-[#1f2433] text-white shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
            >
              1. Dados &amp; Supervisor
            </button>
            <button
              onClick={() => setDrawerTab('promotores')}
              className={`flex-1 py-1.5 rounded-lg text-center font-bold transition-all ${
                drawerTab === 'promotores'
                  ? 'bg-purple-600 text-white neon-purple-glow shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              2. Promotores &amp; Movimentação
            </button>
          </div>

          {/* Supervisor Card */}
          <div className="flex flex-col gap-1.5 bg-[#131722] border border-[#1e2433] p-3 rounded-xl">
            <label className="text-[10px] font-bold uppercase font-mono text-slate-400">
              Supervisor Responsável da Equipe
            </label>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-full bg-purple-600/30 text-purple-300 border border-purple-500/40 font-bold text-xs flex items-center justify-center shrink-0">
                  {selectedSquad.supervisorInitials}
                </div>
                <div className="truncate">
                  <span className="text-xs font-bold text-white block truncate">{selectedSquad.supervisorName}</span>
                  <span className="text-[11px] text-slate-400 block truncate">{selectedSquad.supervisorTitle}</span>
                </div>
              </div>
              <button
                onClick={() => onShowToast({ title: 'Alterar Supervisor', message: 'Selecione novo líder para a equipe.', type: 'info' })}
                className="px-2.5 py-1 text-cyan-300 hover:text-white bg-[#171b26] border border-[#1e2433] rounded-lg text-xs font-semibold shrink-0"
              >
                Alterar
              </button>
            </div>
          </div>

          {/* Bulk Action Box: Mover Promotores em Lote */}
          <div className="p-3.5 rounded-xl bg-[#131722] border border-cyan-500/30 flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-cyan-300 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-base">swap_horizontal_circle</span>
                Mover Promotores em Lote
              </span>
              <span className="px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-300 font-mono text-[11px] font-bold border border-cyan-500/20">
                {selectedPromoterIds.length} selecionados
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Selecione promotores abaixo para transferir contratos e rotas para outra equipe regional em tempo real.
            </p>
            <div className="flex flex-col sm:flex-row items-center gap-2 pt-1">
              <select
                value={targetSquadTransfer}
                onChange={(e) => setTargetSquadTransfer(e.target.value)}
                className="w-full bg-[#171b26] border border-[#1e2433] text-xs text-white rounded-lg px-3 py-2 focus:outline-none focus:border-purple-500"
              >
                <option value="SP Capital Sul">Mover para: SP Capital Sul</option>
                <option value="SP Campinas & RMC">Mover para: SP Campinas &amp; RMC</option>
                <option value="RJ Metropolitana">Mover para: RJ Metropolitana</option>
                <option value="Minas Trade & Expansão">Mover para: Minas Trade</option>
              </select>
              <button
                onClick={handleTransferBatch}
                className="w-full sm:w-auto shrink-0 px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs neon-cyan-glow transition-all flex items-center justify-center gap-1"
              >
                <span className="material-symbols-outlined text-sm">forward</span>
                Transferir
              </button>
            </div>
          </div>

          {/* Promoters Selection List */}
          <div className="space-y-1.5 max-h-[300px] overflow-y-auto pr-1">
            {squadPromotersList.map((p) => {
              const isChecked = selectedPromoterIds.includes(p.id);
              return (
                <div
                  key={p.id}
                  onClick={() => handleTogglePromoter(p.id)}
                  className={`flex items-center justify-between p-2.5 rounded-lg border cursor-pointer transition-all ${
                    isChecked
                      ? 'bg-purple-600/10 border-purple-500/40 text-white'
                      : 'bg-[#131722] border-[#1e2433] text-slate-300 hover:bg-[#1a202d]'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => {}}
                      className="w-4 h-4 rounded text-purple-600 bg-[#171b26] border-slate-600 focus:ring-0 cursor-pointer"
                    />
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold truncate">{p.name}</span>
                        <span className="px-1.5 py-0.2 rounded bg-[#171b26] text-cyan-400 font-mono text-[9px] font-bold">
                          {p.type}
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-400 truncate font-mono">
                        {p.matricula} • {p.area}
                      </span>
                    </div>
                  </div>
                  {isChecked && (
                    <span className="px-2 py-0.5 rounded bg-purple-600/20 text-purple-300 font-mono text-[10px] font-bold">
                      Selecionado
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Quick Action: Adicionar novo promotor */}
          <button
            onClick={() => onNavigate('promotores')}
            className="w-full py-2.5 rounded-xl bg-[#131722] hover:bg-[#1f2433] text-slate-200 border border-[#1e2433] text-xs font-semibold transition-all flex items-center justify-center gap-2"
          >
            <span className="material-symbols-outlined text-purple-400 text-lg">person_add</span>
            <span>+ Adicionar novo promotor à equipe</span>
            <span className="text-[10px] text-slate-400 font-normal">(12 disponíveis)</span>
          </button>

          {/* Footer Save */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#1e2433]">
            <button
              onClick={() => onShowToast({ title: 'Configurações Descartadas', message: 'Alterações não salvas foram desfeitas.', type: 'info' })}
              className="px-4 py-2 rounded-lg text-slate-400 hover:text-white text-xs font-semibold"
            >
              Cancelar
            </button>
            <button
              onClick={() => onShowToast({ title: 'Equipe Salva', message: `Configurações de ${selectedSquad.name} atualizadas.`, type: 'success' })}
              className="px-5 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold neon-purple-glow"
            >
              Salvar Alterações
            </button>
          </div>
        </aside>
      </div>

      {/* Modal Nova Equipe */}
      {modalNewSquad && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="relative w-full max-w-lg bg-[#171b26] border border-[#1e2433] rounded-2xl shadow-2xl p-6 overflow-hidden">
            <div className="flex items-center justify-between pb-4 border-b border-[#1e2433]">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-purple-600/20 text-purple-400 border border-purple-500/30 flex items-center justify-center">
                  <span className="material-symbols-outlined text-xl">groups</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Criar Nova Equipe Operacional</h3>
                  <p className="text-[11px] text-slate-400">Estruture um novo squad regional de campo</p>
                </div>
              </div>
              <button onClick={() => setModalNewSquad(false)} className="text-slate-400 hover:text-white p-1">
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            <form onSubmit={handleCreateSquad} className="space-y-4 py-4 text-xs">
              <div className="space-y-1">
                <label className="font-bold text-slate-300">Nome da Equipe / Squad *</label>
                <input
                  type="text"
                  required
                  value={newSquadName}
                  onChange={(e) => setNewSquadName(e.target.value)}
                  placeholder="ex: SP Capital Sul & Litoral"
                  className="w-full h-10 px-3 bg-[#10141f] border border-[#1e2433] rounded-lg text-white focus:outline-none focus:border-purple-500"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-300">Praça / Regional de Atuação *</label>
                <input
                  type="text"
                  required
                  value={newSquadRegion}
                  onChange={(e) => setNewSquadRegion(e.target.value)}
                  placeholder="ex: São Paulo - Zona Sul & Litoral"
                  className="w-full h-10 px-3 bg-[#10141f] border border-[#1e2433] rounded-lg text-white focus:outline-none focus:border-purple-500"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-300">Supervisor Responsável *</label>
                <select
                  value={newSquadSupervisor}
                  onChange={(e) => setNewSquadSupervisor(e.target.value)}
                  className="w-full h-10 px-3 bg-[#10141f] border border-[#1e2433] rounded-lg text-white focus:outline-none focus:border-purple-500"
                >
                  <option value="Renata Vasconcelos">Renata Vasconcelos (SP Regional)</option>
                  <option value="Carlos Silveira">Carlos Silveira (RJ Metropolitano)</option>
                  <option value="Eduardo Mendes">Eduardo Mendes (Minas &amp; Sul)</option>
                  <option value="Beatriz Prado">Beatriz Prado (Coordenadora Especial)</option>
                </select>
              </div>

              <div className="pt-3 border-t border-[#1e2433] flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setModalNewSquad(false)}
                  className="px-4 py-2 rounded-lg bg-[#131722] hover:bg-[#1f2433] text-slate-300 border border-[#1e2433] font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-bold neon-purple-glow"
                >
                  Criar Squad
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
