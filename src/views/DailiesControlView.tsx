import React, { useState } from 'react';
import { ScreenId, ToastMessage, DailyRecord } from '../types';
import { INITIAL_DAILIES, INITIAL_FREELANCERS } from '../data/mockData';

interface DailiesControlViewProps {
  onNavigate: (screen: ScreenId) => void;
  onShowToast: (toast: Omit<ToastMessage, 'id'>) => void;
}

export const DailiesControlView: React.FC<DailiesControlViewProps> = ({
  onNavigate,
  onShowToast
}) => {
  const [dailies, setDailies] = useState<DailyRecord[]>(INITIAL_DAILIES);
  const [selectedQuinzena, setSelectedQuinzena] = useState<'current' | 'past'>('current');
  const [filterStatus, setFilterStatus] = useState<'all' | 'a_pagar' | 'pago'>('all');
  const [filterFreelancer, setFilterFreelancer] = useState('all');
  const [filterStore, setFilterStore] = useState('all');
  const [filterIndustry, setFilterIndustry] = useState('all');
  const [dateFrom, setDateFrom] = useState('2024-10-18');
  const [dateTo, setDateTo] = useState('2024-10-31');

  // Modal New Daily state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalFreelancerId, setModalFreelancerId] = useState(INITIAL_FREELANCERS[0]?.id ?? '');
  const [modalDate, setModalDate] = useState('2024-10-24');
  const [modalStore, setModalStore] = useState('Atacadão Santo Amaro - SP');
  const [modalIndustry, setModalIndustry] = useState('Ambev');
  const [modalAmount, setModalAmount] = useState('190,00');
  const [modalNotes, setModalNotes] = useState('Substituição pontual por ausência CLT. Roteiro de abastecimento de gôndolas e ponto extra sazonal de cervejas.');

  const handleApprovePix = (id: string, name: string) => {
    setDailies((prev) =>
      prev.map((d) => (d.id === id ? { ...d, status: 'pago' } : d))
    );
    onShowToast({
      title: 'Diária Liquidada via PIX',
      message: `Pagamento de ${name} aprovado e lote conciliado.`,
      type: 'success'
    });
  };

  const handleSaveDaily = (e: React.FormEvent) => {
    e.preventDefault();
    const freelancer = INITIAL_FREELANCERS.find((f) => f.id === modalFreelancerId);
    if (!freelancer) {
      setModalOpen(false);
      onShowToast({
        title: 'Nenhum freelancer disponível',
        message: 'Cadastre um freelancer antes de registrar uma diária.',
        type: 'warning'
      });
      return;
    }
    const amountNum = parseFloat(modalAmount.replace(',', '.')) || 190;

    const indColors: Record<string, string> = {
      Ambev: '#f59e0b',
      "L'Oréal Brasil": '#ec4899',
      Nestlé: '#38bdf8',
      Unilever: '#22d3ee',
      Mondelez: '#818cf8',
      'P&G': '#2563eb'
    };

    const newRecord: DailyRecord = {
      id: `daily-${Date.now()}`,
      date: new Date(modalDate).toLocaleDateString('pt-BR'),
      dayOfWeek: 'Quinta-feira',
      freelancerId: freelancer.id,
      freelancerName: freelancer.name,
      freelancerInitials: freelancer.initials,
      freelancerCpf: freelancer.cpf,
      storeName: modalStore.split('-')[0].trim(),
      storeCity: modalStore.split('-')[1]?.trim() || 'São Paulo • SP',
      industry: modalIndustry,
      industryColor: indColors[modalIndustry] || '#a855f7',
      amount: amountNum,
      quinzena: '18–31 Out',
      status: 'a_pagar',
      geofenceValidated: true,
      notes: modalNotes
    };

    setDailies((prev) => [newRecord, ...prev]);
    setModalOpen(false);
    onShowToast({
      title: 'Diária Registrada',
      message: `Diária de R$ ${amountNum.toFixed(2)} para ${freelancer.name} cadastrada.`,
      type: 'success'
    });
  };

  const filteredDailies = dailies.filter((d) => {
    const matchesQuinzena =
      selectedQuinzena === 'current' ? d.quinzena.includes('18–31') : d.quinzena.includes('04–17');

    const matchesStatus =
      filterStatus === 'all' || d.status === filterStatus;

    const matchesFreelancer =
      filterFreelancer === 'all' || d.freelancerName.toLowerCase().includes(filterFreelancer.toLowerCase());

    const matchesStore =
      filterStore === 'all' || d.storeName.toLowerCase().includes(filterStore.toLowerCase());

    const matchesIndustry =
      filterIndustry === 'all' || d.industry.toLowerCase().includes(filterIndustry.toLowerCase());

    return matchesQuinzena && matchesStatus && matchesFreelancer && matchesStore && matchesIndustry;
  });

  return (
    <div className="w-full px-4 lg:px-8 py-6 max-w-[1720px] mx-auto space-y-6">
      {/* Cabeçalho & Comandos Táticos */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-2">
        <div className="flex flex-col">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-purple-600/20 text-purple-300 border border-purple-500/30">
              <span className="material-symbols-outlined text-[20px]">payments</span>
            </span>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              Controle de Diárias
            </h1>
            <span className="px-2.5 py-0.5 rounded-full bg-[#171b26] text-cyan-400 font-mono text-xs flex items-center gap-1.5 border border-cyan-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
              SYNC LIVE
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Registre diárias e acompanhe os pagamentos quinzenais com conciliação biométrica e de rota.
          </p>
          <div className="flex items-center gap-2 mt-2">
            <span className="material-symbols-outlined text-sm text-purple-400">verified_user</span>
            <span className="font-mono text-xs text-slate-300">
              Ciclo Operacional Vigente • Fechamento Quinzenal Automático
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => onShowToast({ title: 'Exportar Excel', message: 'Relatório financeiro gerado com sucesso.', type: 'info' })}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#171b26] hover:bg-[#1f2433] text-slate-200 border border-[#1e2433] text-xs font-semibold shadow-sm transition-all"
          >
            <span className="material-symbols-outlined text-[18px] text-emerald-400">download</span>
            <span>Exportar Excel</span>
          </button>
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs neon-purple-glow transition-all active:scale-95 shadow-md cursor-pointer"
          >
            <span className="material-symbols-outlined text-[20px] font-bold">add</span>
            <span>+ Nova diária</span>
          </button>
        </div>
      </div>

      {/* Cards de KPI (4 Colunas) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1 */}
        <div className="relative overflow-hidden rounded-xl bg-[#171b26] border border-[#1e2433] p-5 shadow-lg flex flex-col justify-between hover:border-purple-500/40 transition-colors">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold uppercase font-mono text-slate-400">Total de diárias</span>
            <span className="p-1.5 rounded-lg bg-[#131722] text-purple-400 border border-[#1e2433]">
              <span className="material-symbols-outlined text-[18px]">calendar_month</span>
            </span>
          </div>
          <div className="flex items-baseline gap-3 my-1">
            <span className="text-3xl font-extrabold text-white font-mono">{dailies.length}</span>
            <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 font-mono text-[11px] font-bold border border-emerald-500/20">
              0
            </span>
          </div>
          <div className="flex items-center gap-2 pt-3 border-t border-[#1e2433] text-slate-400 font-mono text-xs">
            <span className="material-symbols-outlined text-[15px] text-emerald-400">my_location</span>
            <span>{dailies.filter((d) => d.geofenceValidated).length} validadas por geofence</span>
          </div>
        </div>

        {/* KPI 2 */}
        <div className="relative overflow-hidden rounded-xl bg-[#171b26] border border-[#1e2433] p-5 shadow-lg flex flex-col justify-between hover:border-amber-500/40 transition-colors">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold uppercase font-mono text-slate-400">A pagar</span>
            <span className="p-1.5 rounded-lg bg-[#131722] text-amber-400 border border-[#1e2433]">
              <span className="material-symbols-outlined text-[18px]">pending_actions</span>
            </span>
          </div>
          <div className="flex items-baseline gap-2 my-1">
            <span className="text-3xl font-extrabold text-white font-mono">R$ {dailies.filter((d) => d.status === 'a_pagar').reduce((sum, d) => sum + d.amount, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          <div className="flex items-center justify-between pt-3 border-t border-[#1e2433] font-mono text-xs">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-300 border border-amber-500/30">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              {dailies.filter((d) => d.status === 'a_pagar').length} diárias em aberto
            </span>
            <span className="text-slate-400">Em aberto</span>
          </div>
        </div>

        {/* KPI 3 */}
        <div className="relative overflow-hidden rounded-xl bg-[#171b26] border border-[#1e2433] p-5 shadow-lg flex flex-col justify-between hover:border-emerald-500/40 transition-colors">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold uppercase font-mono text-slate-400">Pagas</span>
            <span className="p-1.5 rounded-lg bg-[#131722] text-emerald-400 border border-[#1e2433]">
              <span className="material-symbols-outlined text-[18px]">check_circle</span>
            </span>
          </div>
          <div className="flex items-baseline gap-2 my-1">
            <span className="text-3xl font-extrabold text-white font-mono">R$ {dailies.filter((d) => d.status === 'pago').reduce((sum, d) => sum + d.amount, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          <div className="flex items-center justify-between pt-3 border-t border-[#1e2433] font-mono text-xs">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              {dailies.filter((d) => d.status === 'pago').length} diárias liquidadas
            </span>
            <span className="text-slate-400">100% conciliação PIX</span>
          </div>
        </div>

        {/* KPI 4 */}
        <div className="relative overflow-hidden rounded-xl bg-[#171b26] border border-[#1e2433] p-5 shadow-lg flex flex-col justify-between hover:border-cyan-500/40 transition-colors">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold uppercase font-mono text-slate-400">Valor total do período</span>
            <span className="p-1.5 rounded-lg bg-[#131722] text-cyan-400 border border-[#1e2433]">
              <span className="material-symbols-outlined text-[18px]">query_stats</span>
            </span>
          </div>
          <div className="flex items-baseline gap-2 my-1">
            <span className="text-3xl font-extrabold text-white font-mono">R$ {dailies.reduce((sum, d) => sum + d.amount, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          <div className="flex items-center justify-between pt-3 border-t border-[#1e2433] text-slate-400 font-mono text-xs">
            <span className="text-cyan-300 font-semibold">Média: R$ {(dailies.length > 0 ? (dailies.reduce((sum, d) => sum + d.amount, 0) / dailies.length) : 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / diária</span>
            <span>{dailies.length} lançamentos</span>
          </div>
        </div>
      </div>

      {/* Área de Resumo da Quinzena Selecionada */}
      <div className="rounded-xl bg-[#171b26] border border-[#1e2433] p-6 shadow-xl relative overflow-hidden">
        <div className="absolute -top-12 left-1/4 w-96 h-28 bg-purple-600/10 blur-3xl pointer-events-none" />

        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 pb-5 border-b border-[#1e2433]">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded bg-purple-600/20 text-purple-300 font-mono text-[11px] font-bold uppercase border border-purple-500/30">
                CICLO CORRENTE
              </span>
              <span className="font-mono text-xs text-slate-400">• Fechamento automático integrado</span>
            </div>
            <h2 className="text-xl font-bold text-white mt-1.5">
              Quinzena Vigente
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Execução em campo: <strong className="text-white">Período Vigente</strong> • Data de fechamento: <strong className="text-white">Fim do Ciclo</strong>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 font-mono text-xs">
            <div className="px-3 py-2 rounded-lg bg-[#131722] border border-[#1e2433] flex items-center gap-2 text-slate-200">
              <span className="material-symbols-outlined text-[16px] text-amber-400">schedule</span>
              <span>Status: <strong className="text-amber-400">Em Andamento</strong></span>
            </div>
            <div className="px-3 py-2 rounded-lg bg-[#131722] border border-[#1e2433] flex items-center gap-2 text-slate-200">
              <span className="material-symbols-outlined text-[16px] text-emerald-400">event_available</span>
              <span>Repasse PIX: <strong className="text-white">No Fechamento</strong></span>
            </div>
          </div>
        </div>

        {/* Seletor Rápido de Quinzenas e Métricas */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 pt-5">
          {/* Seletor */}
          <div className="xl:col-span-4 flex flex-col gap-2.5">
            <span className="text-[10px] uppercase font-mono font-bold text-slate-400">
              Alternar Ciclo de Visualização
            </span>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => setSelectedQuinzena('current')}
                className={`w-full text-left p-3 rounded-lg border flex items-center justify-between transition-all ${
                  selectedQuinzena === 'current'
                    ? 'bg-[#1f2433] border-purple-500/50 shadow-md ring-1 ring-purple-500/20'
                    : 'bg-[#131722] border-[#1e2433] hover:bg-[#1a202d]'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                  <div>
                    <div className="text-xs font-bold text-white">Quinzena Atual</div>
                    <div className="font-mono text-[11px] text-slate-400">Em aberto • {dailies.filter((d) => d.status === 'a_pagar').length} diárias</div>
                  </div>
                </div>
                <span className="font-mono text-xs font-bold text-cyan-300">R$ {dailies.filter((d) => d.status === 'a_pagar').reduce((sum, d) => sum + d.amount, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </button>

              <button
                onClick={() => setSelectedQuinzena('past')}
                className={`w-full text-left p-3 rounded-lg border flex items-center justify-between transition-all ${
                  selectedQuinzena === 'past'
                    ? 'bg-[#1f2433] border-purple-500/50 shadow-md ring-1 ring-purple-500/20'
                    : 'bg-[#131722] border-[#1e2433] hover:bg-[#1a202d]'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  <div>
                    <div className="text-xs font-bold text-white">Quinzena Anterior</div>
                    <div className="font-mono text-[11px] text-slate-400">Liquidada • {dailies.filter((d) => d.status === 'pago').length} diárias</div>
                  </div>
                </div>
                <span className="font-mono text-xs font-bold text-emerald-400">R$ {dailies.filter((d) => d.status === 'pago').reduce((sum, d) => sum + d.amount, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </button>
            </div>
          </div>

          {/* Mini Métricas */}
          <div className="xl:col-span-8 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-lg bg-[#131722] border border-[#1e2433] flex flex-col justify-between">
              <span className="text-[10px] uppercase font-mono font-bold text-slate-400">Lançadas</span>
              <div className="my-1 text-2xl font-extrabold text-white font-mono">{dailies.length}</div>
              <span className="font-mono text-[10px] text-slate-400">100% registradas</span>
            </div>

            <div className="p-3.5 rounded-lg bg-[#131722] border border-[#1e2433] flex flex-col justify-between">
              <span className="text-[10px] uppercase font-mono font-bold text-slate-400">Aprov. Supervisor</span>
              <div className="my-1 text-2xl font-extrabold text-emerald-400 font-mono">{dailies.filter((d) => d.status === 'pago').length}</div>
              <div className="w-full bg-[#10141f] h-1.5 rounded-full overflow-hidden mt-1">
                <div className="bg-emerald-400 h-full w-full rounded-full" />
              </div>
            </div>

            <div className="p-3.5 rounded-lg bg-[#131722] border border-[#1e2433] flex flex-col justify-between">
              <span className="text-[10px] uppercase font-mono font-bold text-slate-400">Análise Geofence</span>
              <div className="my-1 text-2xl font-extrabold text-amber-400 font-mono">0</div>
              <div className="w-full bg-[#10141f] h-1.5 rounded-full overflow-hidden mt-1">
                <div className="bg-amber-400 h-full w-0 rounded-full" />
              </div>
            </div>

            <div className="p-3.5 rounded-lg bg-[#131722] border border-[#1e2433] flex flex-col justify-between">
              <span className="text-[10px] uppercase font-mono font-bold text-slate-400">Estimativa Quinzena</span>
              <div className="my-1 text-xl font-bold text-cyan-300 font-mono">R$ {dailies.filter((d) => d.status === 'a_pagar').reduce((sum, d) => sum + d.amount, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              <span className="font-mono text-[10px] text-slate-400">Previsão no fechamento</span>
            </div>
          </div>
        </div>
      </div>

      {/* Barra de Filtros Avançados */}
      <div className="rounded-xl bg-[#171b26] border border-[#1e2433] p-4 shadow-md space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase font-mono font-bold text-slate-400">Período De</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-10 px-3 rounded-lg bg-[#131722] border border-[#1e2433] text-white focus:outline-none focus:border-purple-500"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase font-mono font-bold text-slate-400">Período Até</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-10 px-3 rounded-lg bg-[#131722] border border-[#1e2433] text-white focus:outline-none focus:border-purple-500"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase font-mono font-bold text-slate-400">Quinzena</label>
            <select
              value={selectedQuinzena}
              onChange={(e) => setSelectedQuinzena(e.target.value as any)}
              className="h-10 px-3 rounded-lg bg-[#131722] border border-[#1e2433] text-white focus:outline-none focus:border-purple-500 cursor-pointer"
            >
              <option value="current">18–31 Outubro (Atual)</option>
              <option value="past">04–17 Outubro (Paga)</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase font-mono font-bold text-slate-400">Freelancer</label>
            <select
              value={filterFreelancer}
              onChange={(e) => setFilterFreelancer(e.target.value)}
              className="h-10 px-3 rounded-lg bg-[#131722] border border-[#1e2433] text-white focus:outline-none focus:border-purple-500 cursor-pointer"
            >
              <option value="all">Todos os Freelancers</option>
              <option value="Carlos Eduardo">Carlos Eduardo Silva</option>
              <option value="Rodrigo Fagundes">Rodrigo Fagundes</option>
              <option value="Juliana Mendes">Juliana Mendes Rocha</option>
              <option value="Camila Nogueira">Camila Nogueira</option>
              <option value="Lucas Pinheiro">Lucas Pinheiro</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase font-mono font-bold text-slate-400">Loja / PDV</label>
            <select
              value={filterStore}
              onChange={(e) => setFilterStore(e.target.value)}
              className="h-10 px-3 rounded-lg bg-[#131722] border border-[#1e2433] text-white focus:outline-none focus:border-purple-500 cursor-pointer"
            >
              <option value="all">Todas as Lojas</option>
              <option value="Atacadão">Atacadão</option>
              <option value="Carrefour">Carrefour</option>
              <option value="Pão de Açúcar">Pão de Açúcar</option>
              <option value="Sam's Club">Sam's Club</option>
              <option value="Assaí">Assaí Atacadista</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase font-mono font-bold text-slate-400">Indústria</label>
            <select
              value={filterIndustry}
              onChange={(e) => setFilterIndustry(e.target.value)}
              className="h-10 px-3 rounded-lg bg-[#131722] border border-[#1e2433] text-white focus:outline-none focus:border-purple-500 cursor-pointer"
            >
              <option value="all">Todas as Indústrias</option>
              <option value="Ambev">Ambev</option>
              <option value="L'Oréal">L'Oréal Brasil</option>
              <option value="Nestlé">Nestlé</option>
              <option value="Unilever">Unilever</option>
              <option value="Mondelez">Mondelez</option>
              <option value="P&G">P&amp;G</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[#1e2433]">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase font-mono font-bold text-slate-400">Filtrar por Status:</span>
            <div className="flex items-center gap-1.5 text-xs font-mono">
              <button
                onClick={() => setFilterStatus('all')}
                className={`px-3 py-1 rounded-md transition-all ${
                  filterStatus === 'all'
                    ? 'bg-purple-600 text-white font-bold neon-purple-glow'
                    : 'bg-[#131722] text-slate-300 hover:text-white border border-[#1e2433]'
                }`}
              >
                Todos ({dailies.length})
              </button>
              <button
                onClick={() => setFilterStatus('a_pagar')}
                className={`px-3 py-1 rounded-md transition-all ${
                  filterStatus === 'a_pagar'
                    ? 'bg-amber-600 text-white font-bold'
                    : 'bg-[#131722] text-amber-300 hover:text-white border border-[#1e2433]'
                }`}
              >
                A PAGAR ({dailies.filter((d) => d.status === 'a_pagar').length})
              </button>
              <button
                onClick={() => setFilterStatus('pago')}
                className={`px-3 py-1 rounded-md transition-all ${
                  filterStatus === 'pago'
                    ? 'bg-emerald-600 text-white font-bold'
                    : 'bg-[#131722] text-emerald-400 hover:text-white border border-[#1e2433]'
                }`}
              >
                PAGO ({dailies.filter((d) => d.status === 'pago').length})
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setFilterStatus('all');
                setFilterFreelancer('all');
                setFilterStore('all');
                setFilterIndustry('all');
              }}
              className="px-3 py-1.5 rounded-lg bg-[#131722] hover:bg-[#1f2433] text-slate-300 text-xs font-semibold border border-[#1e2433] flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-sm">restart_alt</span>
              Limpar filtros
            </button>
            <button
              onClick={() => onShowToast({ title: 'Filtros Aplicados', message: 'Tabela recalculada.', type: 'info' })}
              className="px-4 py-1.5 rounded-lg bg-purple-600/30 hover:bg-purple-600/50 text-purple-200 border border-purple-500/40 text-xs font-bold flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-sm">search</span>
              Aplicar busca
            </button>
          </div>
        </div>
      </div>

      {/* Tabela de Controle de Diárias */}
      <div className="rounded-xl bg-[#171b26] border border-[#1e2433] shadow-xl overflow-hidden flex flex-col">
        <div className="overflow-x-auto w-full">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#10141f] text-slate-400 font-mono text-[10px] uppercase tracking-wider h-11 border-b border-[#1e2433] select-none">
                <th className="py-2.5 px-4 font-semibold">Data</th>
                <th className="py-2.5 px-4 font-semibold">Freelancer</th>
                <th className="py-2.5 px-4 font-semibold">Loja / PDV</th>
                <th className="py-2.5 px-4 font-semibold">Indústria</th>
                <th className="py-2.5 px-4 font-semibold text-right">Valor</th>
                <th className="py-2.5 px-4 font-semibold text-center">Quinzena</th>
                <th className="py-2.5 px-4 font-semibold text-center">Status</th>
                <th className="py-2.5 px-4 font-semibold text-center">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1e2433] text-slate-200">
              {filteredDailies.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-slate-400 font-sans">
                    <div className="flex flex-col items-center justify-center space-y-2">
                      <span className="material-symbols-outlined text-4xl text-slate-600">receipt_long</span>
                      <p className="text-sm font-semibold text-slate-300">Não há dados cadastrados ainda.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredDailies.map((daily) => (
                <tr key={daily.id} className="hover:bg-[#1c2230] transition-colors group">
                  <td className="py-3 px-4 font-mono whitespace-nowrap">
                    <div className="text-white font-bold">{daily.date}</div>
                    <div className="text-[10px] text-slate-400">{daily.dayOfWeek}</div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-purple-600/30 text-purple-300 border border-purple-500/40 flex items-center justify-center font-bold text-xs shrink-0">
                        {daily.freelancerInitials}
                      </div>
                      <div>
                        <div className="font-bold text-white group-hover:text-purple-300 transition-colors">
                          {daily.freelancerName}
                        </div>
                        <div className="font-mono text-[11px] text-slate-400">CPF: {daily.freelancerCpf}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="font-semibold text-slate-100">{daily.storeName}</div>
                    <div className="text-slate-400 text-[11px]">{daily.storeCity}</div>
                  </td>
                  <td className="py-3 px-4">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#131722] border border-[#1e2433] text-slate-100 font-medium">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: daily.industryColor }} />
                      {daily.industry}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-sm font-bold text-white whitespace-nowrap">
                    R$ {daily.amount.toFixed(2).replace('.', ',')}
                  </td>
                  <td className="py-3 px-4 text-center">
                    <span className="font-mono text-xs px-2 py-0.5 rounded bg-[#131722] border border-[#1e2433] text-slate-300">
                      {daily.quinzena}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-center whitespace-nowrap">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-mono text-xs font-bold ${
                        daily.status === 'a_pagar'
                          ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                          : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${daily.status === 'a_pagar' ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`} />
                      {daily.status === 'a_pagar' ? 'A PAGAR' : 'PAGO'}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => onShowToast({ title: 'Detalhes da Diária', message: `${daily.freelancerName} • ${daily.storeName}`, type: 'info' })}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-cyan-400 hover:bg-[#131722]"
                        title="Visualizar Detalhes"
                      >
                        <span className="material-symbols-outlined text-base">visibility</span>
                      </button>
                      {daily.status === 'a_pagar' ? (
                        <button
                          onClick={() => handleApprovePix(daily.id, daily.freelancerName)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-400 hover:bg-[#131722]"
                          title="Aprovar para PIX"
                        >
                          <span className="material-symbols-outlined text-base">price_check</span>
                        </button>
                      ) : (
                        <button
                          onClick={() => onShowToast({ title: 'Comprovante PIX', message: `Autenticação bancária de R$ ${daily.amount.toFixed(2)} emitida.`, type: 'success' })}
                          className="p-1.5 rounded-lg text-emerald-400 hover:text-white hover:bg-[#131722]"
                          title="Comprovante PIX"
                        >
                          <span className="material-symbols-outlined text-base">receipt_long</span>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
              )}
            </tbody>
          </table>
        </div>

        {/* Rodapé da Tabela */}
        <div className="px-5 py-3.5 bg-[#10141f] border-t border-[#1e2433] flex flex-col sm:flex-row items-center justify-between gap-3 font-mono text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <span>Exibindo <strong>{filteredDailies.length}</strong> de <strong>{dailies.length}</strong> diárias registradas</span>
            <span>•</span>
            <span>Total filtrado: <strong className="text-white">R$ {filteredDailies.reduce((sum, d) => sum + d.amount, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></span>
          </div>

          <div className="flex items-center gap-1">
            <button disabled className="p-1.5 rounded-lg bg-[#171b26] border border-[#1e2433] text-slate-600 cursor-not-allowed">
              <span className="material-symbols-outlined text-sm">chevron_left</span>
            </button>
            <button className="w-8 h-8 rounded-lg bg-purple-600 text-white font-bold flex items-center justify-center neon-purple-glow">1</button>




            <button disabled className="p-1.5 rounded-lg bg-[#171b26] border border-[#1e2433] text-slate-600 cursor-not-allowed">
              <span className="material-symbols-outlined text-sm">chevron_right</span>
            </button>
          </div>
        </div>
      </div>

      {/* Modal Nova Diária */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
          <div className="relative w-full max-w-2xl bg-[#171b26] border border-[#1e2433] rounded-2xl shadow-2xl p-6 overflow-hidden flex flex-col max-h-[92vh]">
            <div className="flex items-center justify-between pb-4 border-b border-[#1e2433]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-600/20 text-purple-400 border border-purple-500/30 flex items-center justify-center">
                  <span className="material-symbols-outlined text-2xl">add_circle</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Nova Diária de Freelancer</h3>
                  <p className="text-[11px] text-slate-400">Cadastre uma diária avulsa de campo para a quinzena em curso</p>
                </div>
              </div>
              <button onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-white p-1">
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            <form onSubmit={handleSaveDaily} className="py-4 space-y-4 overflow-y-auto text-xs">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="font-bold text-slate-300">Freelancer Responsável *</label>
                  <select
                    value={modalFreelancerId}
                    onChange={(e) => setModalFreelancerId(e.target.value)}
                    className="w-full h-10 px-3 bg-[#10141f] border border-[#1e2433] rounded-lg text-white focus:outline-none focus:border-purple-500 cursor-pointer"
                  >
                    {INITIAL_FREELANCERS.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name} ({f.cpf})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="font-bold text-slate-300">Data de Execução *</label>
                  <input
                    type="date"
                    required
                    value={modalDate}
                    onChange={(e) => setModalDate(e.target.value)}
                    className="w-full h-10 px-3 bg-[#10141f] border border-[#1e2433] rounded-lg text-white focus:outline-none focus:border-purple-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="font-bold text-slate-300">Loja / PDV Destino *</label>
                  <select
                    value={modalStore}
                    onChange={(e) => setModalStore(e.target.value)}
                    className="w-full h-10 px-3 bg-[#10141f] border border-[#1e2433] rounded-lg text-white focus:outline-none focus:border-purple-500 cursor-pointer"
                  >
                    <option value="Atacadão Santo Amaro - SP">Atacadão Santo Amaro - SP</option>
                    <option value="Carrefour D. Pedro - Campinas">Carrefour D. Pedro - Campinas</option>
                    <option value="Pão de Açúcar Morumbi - SP">Pão de Açúcar Morumbi - SP</option>
                    <option value="Assaí Radial Leste - SP">Assaí Radial Leste - SP</option>
                    <option value="Sam's Club Alphaville - SP">Sam's Club Alphaville - SP</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="font-bold text-slate-300">Indústria Contratante *</label>
                  <select
                    value={modalIndustry}
                    onChange={(e) => setModalIndustry(e.target.value)}
                    className="w-full h-10 px-3 bg-[#10141f] border border-[#1e2433] rounded-lg text-white focus:outline-none focus:border-purple-500 cursor-pointer"
                  >
                    <option value="Ambev">Ambev - Cervejas &amp; Bebidas</option>
                    <option value="L'Oréal Brasil">L'Oréal Brasil</option>
                    <option value="Nestlé">Nestlé</option>
                    <option value="Unilever">Unilever</option>
                    <option value="Mondelez">Mondelez</option>
                    <option value="P&G">P&amp;G</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="font-bold text-slate-300">Valor da Diária (R$) *</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono font-bold text-slate-400">
                      R$
                    </span>
                    <input
                      type="text"
                      required
                      value={modalAmount}
                      onChange={(e) => setModalAmount(e.target.value)}
                      className="w-full h-10 pl-9 pr-3 bg-[#10141f] border border-[#1e2433] rounded-lg text-white font-mono font-bold focus:outline-none focus:border-purple-500"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="font-bold text-slate-300">Quinzena Vinculada</label>
                  <div className="w-full h-10 px-3 bg-[#10141f] border border-[#1e2433] rounded-lg flex items-center justify-between text-slate-300 font-mono">
                    <span className="text-white font-semibold">18–31 Outubro / 2024</span>
                    <span className="text-purple-400 font-bold">Repasse 05/11</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="font-bold text-slate-300">Observações da Operação</label>
                <textarea
                  rows={3}
                  value={modalNotes}
                  onChange={(e) => setModalNotes(e.target.value)}
                  className="w-full p-3 bg-[#10141f] border border-[#1e2433] rounded-lg text-white focus:outline-none focus:border-purple-500 resize-none"
                />
              </div>

              <div className="pt-3 border-t border-[#1e2433] flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-[#131722] hover:bg-[#1f2433] border border-[#1e2433] text-slate-300 font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-bold neon-purple-glow flex items-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-[18px]">save</span>
                  <span>Salvar Diária</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
