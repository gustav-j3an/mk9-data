import React, { useState } from 'react';
import { ScreenId, ToastMessage } from '../types';

interface OperationalDashboardViewProps {
  onNavigate: (screen: ScreenId) => void;
  onShowToast: (toast: Omit<ToastMessage, 'id'>) => void;
}

export const OperationalDashboardView: React.FC<OperationalDashboardViewProps> = ({
  onNavigate,
  onShowToast
}) => {
  const [activeTab, setActiveTab] = useState<'linear' | 'volume' | 'ruptura'>('linear');
  const [selectedRegional, setSelectedRegional] = useState('all');
  const [tableSearch, setTableSearch] = useState('');
  const [tableStatus, setTableStatus] = useState('all');
  const [activeState, setActiveState] = useState<'success' | 'loading' | 'empty' | 'error'>('success');
  const [modalNewAlert, setModalNewAlert] = useState(false);

  // Form states for new field alert
  const [alertStore, setAlertStore] = useState('Pão de Açúcar - Jardins');
  const [alertType, setAlertType] = useState('Ruptura Crítica');
  const [alertNotes, setAlertNotes] = useState('');

  const tableRows: Array<{
    id: string;
    promoter: string;
    promoterInitials: string;
    matricula: string;
    store: string;
    address: string;
    regional: string;
    checkIn: string;
    status: string;
    statusType: string;
    photos: string;
  }> = [];

  const filteredRows = tableRows.filter((row) => {
    const matchesSearch =
      row.promoter.toLowerCase().includes(tableSearch.toLowerCase()) ||
      row.store.toLowerCase().includes(tableSearch.toLowerCase()) ||
      row.regional.toLowerCase().includes(tableSearch.toLowerCase());

    const matchesStatus =
      tableStatus === 'all' ||
      (tableStatus === 'conforme' && row.statusType === 'conforme') ||
      (tableStatus === 'execucao' && row.statusType === 'execucao') ||
      (tableStatus === 'ruptura' && row.statusType === 'ruptura') ||
      (tableStatus === 'extra' && row.statusType === 'extra');

    return matchesSearch && matchesStatus;
  });

  const handleCreateAlert = (e: React.FormEvent) => {
    e.preventDefault();
    setModalNewAlert(false);
    onShowToast({
      title: 'Alerta Despachado ao Campo',
      message: `Notificação enviada aos promotores em ${alertStore}.`,
      type: 'success'
    });
  };

  return (
    <div className="w-full px-4 lg:px-8 py-6 max-w-[1720px] mx-auto space-y-6">
      {/* Top Operational Header */}
      <section className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6 bg-[#171b26] border border-[#1e2433] p-5 sm:p-6 rounded-xl shadow-xl relative overflow-hidden">
        <div className="absolute -right-16 -top-16 w-80 h-80 rounded-full bg-gradient-to-br from-purple-600/15 via-cyan-500/10 to-transparent blur-3xl pointer-events-none" />
        <div className="flex flex-col space-y-1.5 z-10">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-mono text-[11px] font-bold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
              TELEMETRIA ATIVA (4.820 PDVs)
            </span>
            <span className="font-mono text-xs text-slate-400">• CICLO BR-OUT24</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Painel Operacional de Trade Marketing
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 max-w-3xl">
            Monitoramento em tempo real de execução de campo, cumprimento de rotas, índice de ruptura e conformidade de gôndola em 4.820 PDVs de redes estratégicas.
          </p>
        </div>

        {/* Action Bar */}
        <div className="flex flex-wrap items-center gap-3 z-10">
          <div className="flex items-center gap-2 bg-[#131722] border border-[#1e2433] px-3 py-2 rounded-xl text-slate-200 text-xs shadow-sm">
            <span className="material-symbols-outlined text-[18px] text-cyan-400">calendar_today</span>
            <span>Hoje, 24 de Outubro • Turno Manhã/Tarde</span>
          </div>

          <div className="relative">
            <select
              value={selectedRegional}
              onChange={(e) => setSelectedRegional(e.target.value)}
              className="bg-[#131722] border border-[#1e2433] text-slate-200 text-xs rounded-xl px-3 py-2 pr-8 focus:outline-none focus:border-purple-500 cursor-pointer appearance-none shadow-sm"
            >
              <option value="all">Todas as Regionais (SP, RJ, Sul, NE)</option>
              <option value="sp">SP Metropolitana &amp; Interior</option>
              <option value="rj">Rio de Janeiro &amp; Litoral</option>
              <option value="sul">Sul (PR / SC / RS)</option>
              <option value="ne">Nordeste (BA / PE / CE)</option>
            </select>
            <span className="material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none text-base">
              expand_more
            </span>
          </div>

          <button
            onClick={() => onShowToast({ title: 'Exportação Iniciada', message: 'Relatório operacional (.csv) gerado.', type: 'info' })}
            className="flex items-center gap-2 bg-[#131722] hover:bg-[#1f2433] text-cyan-300 border border-[#1e2433] text-xs font-semibold px-4 py-2 rounded-xl transition-all shadow-sm"
          >
            <span className="material-symbols-outlined text-[18px]">ios_share</span>
            <span>Exportar Relatório</span>
          </button>

          <button
            onClick={() => setModalNewAlert(true)}
            className="flex items-center gap-2 bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs px-4 py-2 rounded-xl neon-purple-glow transition-all active:scale-95 shadow-md cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">add_alert</span>
            <span>+ Despachar Alerta de Campo</span>
          </button>
        </div>
      </section>

      {/* KPI Metrics Row (4 distinct tactical cards) */}
      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* KPI 1: Ruptura */}
        <div className="bg-[#171b26] border border-[#1e2433] p-5 rounded-xl shadow-lg flex flex-col justify-between relative overflow-hidden group hover:border-emerald-500/40 transition-all">
          <div className="absolute top-0 left-0 right-0 h-1 bg-emerald-500" />
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider font-mono">
                Índice de Ruptura de Estoque
              </span>
              <span className="flex items-center gap-1 font-mono text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <span className="material-symbols-outlined text-[12px]">trending_down</span> -1.2%
              </span>
            </div>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-3xl font-extrabold text-white tracking-tight font-mono">3.4%</span>
              <span className="text-xs text-slate-500">Meta &lt; 5.0%</span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-[#1e2433] flex items-center justify-between text-xs text-slate-400">
            <span>48 alertas críticos resolvidos</span>
            <div className="w-16 h-6 flex-shrink-0">
              <svg className="w-full h-full overflow-visible" viewBox="0 0 64 24" fill="none">
                <path d="M0 18 L12 14 L24 16 L36 10 L48 11 L64 3" stroke="#4edea3" strokeWidth="2" strokeLinecap="round" />
                <path d="M0 18 L12 14 L24 16 L36 10 L48 11 L64 3 L64 24 L0 24 Z" fill="#4edea3" fillOpacity="0.1" />
              </svg>
            </div>
          </div>
        </div>

        {/* KPI 2: Conformidade de Roteiro */}
        <div className="bg-[#171b26] border border-[#1e2433] p-5 rounded-xl shadow-lg flex flex-col justify-between relative overflow-hidden group hover:border-purple-500/40 transition-all">
          <div className="absolute top-0 left-0 right-0 h-1 bg-purple-600" />
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider font-mono">
                Conformidade de Roteiro
              </span>
              <span className="flex items-center gap-1 font-mono text-[10px] font-bold px-2 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">
                <span className="material-symbols-outlined text-[12px]">trending_up</span> +2.6%
              </span>
            </div>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-3xl font-extrabold text-white tracking-tight font-mono">94.8%</span>
              <span className="text-xs text-emerald-400 font-semibold font-mono">98.4% Conectados</span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-[#1e2433]">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1 font-mono">
              <span>1.346 / 1.420 em loja</span>
              <span className="text-purple-400 font-bold">94.8%</span>
            </div>
            <div className="w-full h-1.5 bg-[#10141f] rounded-full overflow-hidden">
              <div className="h-full bg-purple-600 rounded-full shadow-[0_0_8px_rgba(147,51,234,0.8)]" style={{ width: '94.8%' }} />
            </div>
          </div>
        </div>

        {/* KPI 3: Share of Shelf (SOS) */}
        <div className="bg-[#171b26] border border-[#1e2433] p-5 rounded-xl shadow-lg flex flex-col justify-between relative overflow-hidden group hover:border-cyan-500/40 transition-all">
          <div className="absolute top-0 left-0 right-0 h-1 bg-cyan-400" />
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider font-mono">
                Share of Shelf Médio
              </span>
              <span className="flex items-center gap-1 font-mono text-[10px] font-bold px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                <span className="material-symbols-outlined text-[12px]">check</span> Target 40%
              </span>
            </div>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-3xl font-extrabold text-white tracking-tight font-mono">42.1%</span>
              <span className="text-xs text-cyan-300 font-mono">+1.8% vs planograma</span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-[#1e2433] flex items-center justify-between text-xs text-slate-400">
            <span>Alimentos &amp; Bebidas Premium</span>
            <div className="relative w-8 h-8 flex items-center justify-center">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#282e40" strokeWidth="3" />
                <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#89ceff" strokeDasharray="42.1, 100" strokeWidth="3" strokeLinecap="round" />
              </svg>
              <span className="absolute text-[9px] font-mono font-bold text-white">42%</span>
            </div>
          </div>
        </div>

        {/* KPI 4: Conformidade de Preço */}
        <div className="bg-[#171b26] border border-[#1e2433] p-5 rounded-xl shadow-lg flex flex-col justify-between relative overflow-hidden group hover:border-rose-500/40 transition-all">
          <div className="absolute top-0 left-0 right-0 h-1 bg-rose-500" />
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider font-mono">
                Conformidade de Preço
              </span>
              <span className="flex items-center gap-1 font-mono text-[10px] font-bold px-2 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20">
                <span className="material-symbols-outlined text-[12px]">warning</span> 12 Pendências
              </span>
            </div>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-3xl font-extrabold text-white tracking-tight font-mono">98.2%</span>
              <span className="text-xs text-slate-500">4.733 checados</span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-[#1e2433] flex items-center justify-between text-xs text-slate-400 font-mono">
            <span>R$ 48.2k sell-out protegido</span>
            <span className="text-emerald-400 font-semibold">Audit 100% OK</span>
          </div>
        </div>
      </section>

      {/* Middle Section: Tactical Visualizations & Real-Time Live Feed */}
      <section className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Performance & Gôndola Chart (2 cols) */}
        <div className="xl:col-span-2 bg-[#171b26] border border-[#1e2433] p-5 rounded-xl shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
                  <h2 className="text-base font-bold text-white">Performance de Execução por Regional</h2>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">Share de linear executado vs índice de ruptura em 7 dias</p>
              </div>

              {/* Segmented Controls */}
              <div className="flex items-center bg-[#131722] border border-[#1e2433] p-1 rounded-xl">
                {(['linear', 'volume', 'ruptura'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setActiveTab(mode)}
                    className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
                      activeTab === mode
                        ? 'bg-purple-600 text-white neon-purple-glow shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {mode === 'linear' ? 'Share Linear' : mode === 'volume' ? 'Volume Sell-out' : 'Ruptura %'}
                  </button>
                ))}
              </div>
            </div>

            {/* Tactical SVG Chart */}
            <div className="relative w-full h-64 mt-2">
              <svg className="w-full h-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 700 240">
                <defs>
                  <linearGradient id="opPurpleGrad" x1="0%" x2="0%" y1="0%" y2="100%">
                    <stop offset="0%" stopColor="#9333ea" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="#9333ea" stopOpacity="0" />
                  </linearGradient>
                  <linearGradient id="opCyanGrad" x1="0%" x2="0%" y1="0%" y2="100%">
                    <stop offset="0%" stopColor="#00a2e6" stopOpacity="0.25" />
                    <stop offset="100%" stopColor="#00a2e6" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <line x1="0" x2="700" y1="40" y2="40" stroke="#282e40" strokeDasharray="3 3" opacity="0.4" />
                <line x1="0" x2="700" y1="100" y2="100" stroke="#282e40" strokeDasharray="3 3" opacity="0.4" />
                <line x1="0" x2="700" y1="160" y2="160" stroke="#282e40" strokeDasharray="3 3" opacity="0.4" />
                <line x1="0" x2="700" y1="220" y2="220" stroke="#282e40" opacity="0.6" />

                <path d="M0 160 Q 110 130, 200 80 T 400 90 T 560 50 T 700 35 L 700 220 L 0 220 Z" fill="url(#opPurpleGrad)" />
                <path d="M0 180 Q 120 170, 200 150 T 400 130 T 560 140 T 700 120 L 700 220 L 0 220 Z" fill="url(#opCyanGrad)" />

                <path d="M0 160 Q 110 130, 200 80 T 400 90 T 560 50 T 700 35" fill="none" stroke="#ddb8ff" strokeWidth="3" strokeLinecap="round" />
                <path d="M0 180 Q 120 170, 200 150 T 400 130 T 560 140 T 700 120" fill="none" stroke="#89ceff" strokeWidth="2" strokeDasharray="5 3" strokeLinecap="round" />

                <circle cx="200" cy="80" r="4" fill="#ddb8ff" stroke="#0a0e18" strokeWidth="2" />
                <circle cx="560" cy="50" r="4" fill="#ddb8ff" stroke="#0a0e18" strokeWidth="2" />
                <circle cx="700" cy="35" r="5" fill="#4edea3" stroke="#0a0e18" strokeWidth="2" />
              </svg>

              <div className="absolute right-4 top-2 bg-[#131722]/90 border border-cyan-500/30 px-3 py-1.5 rounded-xl shadow-lg flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <div className="flex flex-col">
                  <span className="text-[10px] font-mono font-bold text-slate-400">SP METROPOLITANA</span>
                  <span className="text-xs font-mono font-bold text-white">48.6% SOS (+4.2%)</span>
                </div>
              </div>
            </div>

            <div className="flex justify-between items-center text-slate-400 font-mono text-[11px] pt-3 px-1">
              <span>18/Out (Sex)</span>
              <span>19/Out (Sáb)</span>
              <span>20/Out (Dom)</span>
              <span>21/Out (Seg)</span>
              <span>22/Out (Ter)</span>
              <span>23/Out (Qua)</span>
              <span className="text-purple-400 font-bold">Hoje (Qui)</span>
            </div>
          </div>

          {/* Quick Metrics Pill Row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-4 mt-4 bg-[#131722]/60 border border-[#1e2433] p-3 rounded-xl">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-purple-600/20 text-purple-300 border border-purple-500/30 flex items-center justify-center">
                <span className="material-symbols-outlined text-[18px]">view_column</span>
              </div>
              <div>
                <span className="text-[10px] font-mono text-slate-400 block uppercase">Gôndola Regular</span>
                <span className="text-xs font-bold text-white">96.2% Conforme</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 flex items-center justify-center">
                <span className="material-symbols-outlined text-[18px]">shelves</span>
              </div>
              <div>
                <span className="text-[10px] font-mono text-slate-400 block uppercase">Pontos Extras / Ilhas</span>
                <span className="text-xs font-bold text-white">84.0% Ocupação</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center justify-center">
                <span className="material-symbols-outlined text-[18px]">loyalty</span>
              </div>
              <div>
                <span className="text-[10px] font-mono text-slate-400 block uppercase">Material POP Ativo</span>
                <span className="text-xs font-bold text-white">91.4% Presença</span>
              </div>
            </div>
          </div>
        </div>

        {/* Live Telemetry Alert Feed (1 col) */}
        <div className="bg-[#171b26] border border-[#1e2433] p-5 rounded-xl shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-[#1e2433]">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500" />
                </span>
                <h2 className="text-base font-bold text-white">Alertas Críticos de Campo</h2>
              </div>
              <span className="font-mono text-[11px] text-cyan-300 bg-[#131722] border border-[#1e2433] px-2 py-0.5 rounded-lg">
                Auto-refresh 3s
              </span>
            </div>

            <div className="space-y-3">
              <div className="p-3 rounded-xl bg-[#131722] border border-[#1e2433] hover:border-rose-500/40 transition-colors shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold font-mono px-2 py-0.5 rounded bg-rose-500/20 text-rose-400 border border-rose-500/30">
                    RUPTURA DETECTADA
                  </span>
                  <span className="font-mono text-[10px] text-slate-500">Há 4 min</span>
                </div>
                <p className="text-xs font-bold text-white mt-1">Pão de Açúcar Morumbi</p>
                <p className="text-[11px] text-slate-400">SKU Café Especial Moído 500g zerado no linear. Estoque virtual acusa 120 un.</p>
                <div className="flex items-center justify-between mt-3 pt-2 border-t border-[#1e2433]">
                  <span className="text-[11px] text-slate-400 flex items-center gap-1">
                    <span className="material-symbols-outlined text-[14px]">person</span> Marcos R.
                  </span>
                  <button
                    onClick={() => onShowToast({ title: 'Notificação Enviada', message: 'Promotor Marcos R. acionado via push.', type: 'info' })}
                    className="text-cyan-300 hover:text-white text-xs font-semibold flex items-center gap-1"
                  >
                    Notificar Promotor <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                  </button>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-[#131722] border border-[#1e2433] hover:border-cyan-500/40 transition-colors shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold font-mono px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                    PONTO EXTRA OCUPADO
                  </span>
                  <span className="font-mono text-[10px] text-slate-500">Há 16 min</span>
                </div>
                <p className="text-xs font-bold text-white mt-1">Carrefour Barra da Tijuca</p>
                <p className="text-[11px] text-slate-400">Ponta de gôndola contratada ocupada indevidamente por concorrente nacional.</p>
                <div className="flex items-center justify-between mt-3 pt-2 border-t border-[#1e2433]">
                  <span className="text-[11px] text-emerald-400 flex items-center gap-1">
                    <span className="material-symbols-outlined text-[14px]">photo_camera</span> Foto anexada
                  </span>
                  <button
                    onClick={() => onShowToast({ title: 'Reclamação Aberta', message: 'Notificação formal despachada à gerência do Carrefour.', type: 'warning' })}
                    className="text-purple-400 hover:text-white text-xs font-semibold flex items-center gap-1"
                  >
                    Reclamar Espaço <span className="material-symbols-outlined text-[14px]">gavel</span>
                  </button>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-[#131722] border border-[#1e2433] hover:border-amber-500/40 transition-colors shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    DESVIO DE ROTA
                  </span>
                  <span className="font-mono text-[10px] text-slate-500">Há 28 min</span>
                </div>
                <p className="text-xs font-bold text-white mt-1">Assaí Atacadista Aricanduva</p>
                <p className="text-[11px] text-slate-400">Lucas Silva - Check-in atrasado em 42 min decorrente de pane mecânica na rota.</p>
                <div className="flex items-center justify-between mt-3 pt-2 border-t border-[#1e2433]">
                  <span className="text-[11px] text-slate-400 flex items-center gap-1">
                    <span className="material-symbols-outlined text-[14px]">near_me</span> Telemetria GPS
                  </span>
                  <button
                    onClick={() => onShowToast({ title: 'Backfill Alocado', message: 'Promotor freelancer acionado para cobrir o roteiro.', type: 'success' })}
                    className="text-slate-300 hover:text-purple-400 text-xs font-semibold flex items-center gap-1"
                  >
                    Redirecionar Backfill
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-[#1e2433] flex justify-between items-center text-xs text-slate-400">
            <span>Fila de triagem prioritária</span>
            <button onClick={() => onNavigate('cockpit')} className="text-purple-400 hover:underline font-semibold">
              Ver todos (18)
            </button>
          </div>
        </div>
      </section>

      {/* Modern Tactical Operations Data Table */}
      <section className="bg-[#171b26] border border-[#1e2433] rounded-xl shadow-xl p-5 flex flex-col space-y-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-white">Status Operacional da Equipe de Campo e PDVs Auditados</h2>
            <p className="text-xs text-slate-400">Atualização contínua de promotores georreferenciados e conformidade em gôndola.</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-base">
                filter_list
              </span>
              <input
                type="text"
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                placeholder="Filtrar por loja, bandeira ou promotor..."
                className="bg-[#131722] border border-[#1e2433] text-white text-xs pl-8 pr-3 py-2 rounded-lg placeholder:text-slate-500 focus:outline-none focus:border-purple-500 w-64"
              />
            </div>

            <select
              value={tableStatus}
              onChange={(e) => setTableStatus(e.target.value)}
              className="bg-[#131722] border border-[#1e2433] text-white text-xs px-3 py-2 rounded-lg focus:outline-none focus:border-purple-500 cursor-pointer"
            >
              <option value="all">Todos os Status</option>
              <option value="conforme">Conforme</option>
              <option value="execucao">Em Execução</option>
              <option value="ruptura">Ruptura Detectada</option>
              <option value="extra">Ponto Extra Validado</option>
            </select>

            <button
              onClick={() => onShowToast({ title: 'Tabela Atualizada', message: 'Registros de telemetria sincronizados.', type: 'info' })}
              className="p-2 rounded-lg bg-[#131722] hover:bg-[#1f2433] text-slate-400 hover:text-white border border-[#1e2433]"
            >
              <span className="material-symbols-outlined text-[18px]">refresh</span>
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#10141f] text-slate-400 font-mono text-[10px] uppercase tracking-wider h-10 border-b border-[#1e2433] select-none">
                <th className="py-2.5 px-4 font-semibold">Promotor / Matrícula</th>
                <th className="py-2.5 px-4 font-semibold">PDV &amp; Bandeira</th>
                <th className="py-2.5 px-4 font-semibold">Regional</th>
                <th className="py-2.5 px-4 font-semibold">Check-in / GPS</th>
                <th className="py-2.5 px-4 font-semibold">Status da Visita</th>
                <th className="py-2.5 px-4 font-semibold">Auditoria Fotográfica</th>
                <th className="py-2.5 px-4 text-right font-semibold">Ações Táticas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1e2433] text-slate-200">
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-slate-400 font-sans">
                    <div className="flex flex-col items-center justify-center space-y-2">
                      <span className="material-symbols-outlined text-4xl text-slate-600">monitoring</span>
                      <p className="text-sm font-semibold text-slate-300">Não há dados cadastrados ainda.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredRows.map((r) => (
                <tr key={r.id} className="hover:bg-[#1c2230] transition-colors group">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-purple-600/30 text-purple-300 border border-purple-500/40 flex items-center justify-center font-bold text-xs">
                        {r.promoterInitials}
                      </div>
                      <div>
                        <span className="font-bold text-white block group-hover:text-purple-300 transition-colors">
                          {r.promoter}
                        </span>
                        <span className="font-mono text-[10px] text-slate-400">{r.matricula}</span>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="font-semibold text-slate-100">{r.store}</div>
                    <span className="text-[11px] text-slate-400">{r.address}</span>
                  </td>
                  <td className="py-3 px-4 font-mono text-cyan-300 font-semibold">{r.regional}</td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-1 text-emerald-400 font-mono text-[11px]">
                      <span className="material-symbols-outlined text-[14px]">fmd_good</span>
                      <span>{r.checkIn}</span>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                        r.statusType === 'conforme'
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                          : r.statusType === 'execucao'
                          ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                          : r.statusType === 'ruptura'
                          ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30 animate-pulse'
                          : 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                      }`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-current" />
                      {r.status}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <span className="font-mono text-[11px] text-slate-300 flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-base text-cyan-400">photo_library</span>
                      {r.photos}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => onShowToast({ title: 'Detalhes da Visita', message: `${r.promoter} em ${r.store}.`, type: 'info' })}
                        className="p-1 rounded text-slate-400 hover:text-white hover:bg-[#131722]"
                        title="Ver Detalhes"
                      >
                        <span className="material-symbols-outlined text-base">visibility</span>
                      </button>
                      <button
                        onClick={() => onShowToast({ title: 'Rastreamento de Rota', message: `Plotando telemetria de ${r.promoter}.`, type: 'info' })}
                        className="p-1 rounded text-slate-400 hover:text-cyan-400 hover:bg-[#131722]"
                        title="Rota GPS"
                      >
                        <span className="material-symbols-outlined text-base">route</span>
                      </button>
                      <button
                        onClick={() => onShowToast({ title: 'Chat Aberto', message: `Conversa com ${r.promoter} iniciada.`, type: 'info' })}
                        className="p-1 rounded text-slate-400 hover:text-purple-400 hover:bg-[#131722]"
                        title="Chat"
                      >
                        <span className="material-symbols-outlined text-base">chat</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))
              )}
            </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-3 border-t border-[#1e2433] text-xs font-mono text-slate-400">
        <span>Mostrando <strong>{filteredRows.length}</strong> de <strong>{tableRows.length}</strong> registros de campo</span>
          <div className="flex items-center gap-1">
            <button disabled className="px-2.5 py-1 rounded bg-[#131722] border border-[#1e2433] text-slate-600 cursor-not-allowed">Anterior</button>
            <button className="px-2.5 py-1 rounded bg-purple-600 text-white font-bold neon-purple-glow">1</button>
            <button className="px-2.5 py-1 rounded bg-[#131722] border border-[#1e2433] text-slate-300 hover:bg-[#1f2433]">2</button>
            <button className="px-2.5 py-1 rounded bg-[#131722] border border-[#1e2433] text-slate-300 hover:bg-[#1f2433]">3</button>
            <span className="px-1 text-slate-500">...</span>
            <button className="px-2.5 py-1 rounded bg-[#131722] border border-[#1e2433] text-slate-300 hover:bg-[#1f2433]">964</button>
            <button className="px-2.5 py-1 rounded bg-[#131722] border border-[#1e2433] text-slate-300 hover:bg-[#1f2433]">Próxima</button>
          </div>
        </div>
      </section>

      {/* Matriz de Estados de Feedback do Sistema (CRITICAL REQUIREMENT) */}
      <section className="bg-[#171b26] border border-[#1e2433] p-5 rounded-xl shadow-xl flex flex-col space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-cyan-400 text-xl">toggle_on</span>
              <h2 className="text-base font-bold text-white">Matriz de Estados de Feedback do Sistema</h2>
            </div>
            <p className="text-xs text-slate-400">Comportamentos de interface para condições assíncronas de campo e telemetria.</p>
          </div>

          <div className="flex flex-wrap items-center bg-[#131722] border border-[#1e2433] p-1 rounded-xl gap-1">
            <button
              onClick={() => setActiveState('success')}
              className={`px-3 py-1 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-all ${
                activeState === 'success' ? 'bg-emerald-600 text-white font-bold shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
            >
              <span className="material-symbols-outlined text-sm">check_circle</span> Sucesso
            </button>
            <button
              onClick={() => setActiveState('loading')}
              className={`px-3 py-1 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-all ${
                activeState === 'loading' ? 'bg-purple-600 text-white font-bold neon-purple-glow shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
            >
              <span className="material-symbols-outlined text-sm">autorenew</span> Loading
            </button>
            <button
              onClick={() => setActiveState('empty')}
              className={`px-3 py-1 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-all ${
                activeState === 'empty' ? 'bg-cyan-600 text-white font-bold shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
            >
              <span className="material-symbols-outlined text-sm">inbox</span> Vazio (Empty)
            </button>
            <button
              onClick={() => setActiveState('error')}
              className={`px-3 py-1 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-all ${
                activeState === 'error' ? 'bg-rose-600 text-white font-bold shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
            >
              <span className="material-symbols-outlined text-sm">error</span> Erro GPS
            </button>
          </div>
        </div>

        {/* State 1: Success */}
        {activeState === 'success' && (
          <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-fadeIn">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-2xl">verified</span>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-emerald-400">Sincronização em Lote Concluída com Sucesso</span>
                  <span className="font-mono text-[10px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded font-bold">STATUS 200 OK</span>
                </div>
                <p className="text-xs text-slate-300 mt-1">
                  Reabastecimento confirmado em 14 PDVs prioritários na região Sul. Indicadores de ruptura atualizados automaticamente no pipeline analítico nacional.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => onShowToast({ title: 'Log do Batch', message: '14 PDVs sincronizados sem erros.', type: 'info' })}
                className="px-3 py-1.5 rounded-lg bg-[#131722] hover:bg-[#1f2433] text-slate-200 border border-[#1e2433] text-xs font-semibold"
              >
                Ver Log do Batch
              </button>
              <button
                onClick={() => onShowToast({ title: 'Notificação Dispensada', message: 'Feed marcado como lido.', type: 'info' })}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-sm"
              >
                Dispensar Notificação
              </button>
            </div>
          </div>
        )}

        {/* State 2: Loading */}
        {activeState === 'loading' && (
          <div className="p-5 rounded-xl bg-[#131722] border border-purple-500/30 shadow-md space-y-3 animate-fadeIn">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
                <div>
                  <span className="text-sm font-bold text-purple-300">Sincronizando Telemetria de Rotas em Tempo Real</span>
                  <span className="font-mono text-xs text-slate-400 block">Processando 1.420 pacotes MQTT georreferenciados...</span>
                </div>
              </div>
              <span className="font-mono text-xs text-cyan-300 font-bold animate-pulse">78% CONCLUÍDO</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 animate-pulse pt-2">
              <div className="h-16 bg-[#171b26] rounded-xl border border-[#1e2433] p-3 flex flex-col justify-between">
                <div className="h-2.5 w-1/3 bg-slate-700 rounded" />
                <div className="h-4 w-2/3 bg-slate-600 rounded" />
              </div>
              <div className="h-16 bg-[#171b26] rounded-xl border border-[#1e2433] p-3 flex flex-col justify-between">
                <div className="h-2.5 w-1/4 bg-slate-700 rounded" />
                <div className="h-4 w-1/2 bg-slate-600 rounded" />
              </div>
              <div className="h-16 bg-[#171b26] rounded-xl border border-[#1e2433] p-3 flex flex-col justify-between">
                <div className="h-2.5 w-1/3 bg-slate-700 rounded" />
                <div className="h-4 w-3/4 bg-slate-600 rounded" />
              </div>
            </div>
          </div>
        )}

        {/* State 3: Empty State */}
        {activeState === 'empty' && (
          <div className="p-8 rounded-xl bg-[#131722] border border-[#1e2433] text-center flex flex-col items-center justify-center space-y-3 animate-fadeIn">
            <div className="w-14 h-14 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl">task_alt</span>
            </div>
            <h3 className="text-base font-bold text-white">Nenhuma Inconformidade de Preço Pendente</h3>
            <p className="text-xs text-slate-400 max-w-md">
              Todas as 4.820 etiquetas de preço e tabloides promocionais vigentes conferem com as diretrizes do plano de trade marketing para esta regional.
            </p>
            <button
              onClick={() => onShowToast({ title: 'Auditorias', message: 'Abrindo registros históricos de preços.', type: 'info' })}
              className="px-4 py-2 rounded-xl bg-[#171b26] hover:bg-[#1f2433] text-cyan-300 border border-cyan-500/30 text-xs font-semibold transition-colors"
            >
              Consultar Histórico de Auditorias
            </button>
          </div>
        )}

        {/* State 4: Error State */}
        {activeState === 'error' && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-fadeIn">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/30 flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-2xl">satellite_alt</span>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-rose-400">Falha de Recepção no Gateway de Telemetria GPS</span>
                  <span className="font-mono text-[10px] bg-rose-500/20 text-rose-300 px-2 py-0.5 rounded font-bold">ERR_TELEMETRY_TIMEOUT</span>
                </div>
                <p className="text-xs text-slate-300 mt-1">
                  A conexão com 36 dispositivos na micro-região Rio de Janeiro Baixada Fluminense excedeu o timeout de 120s. A fila offline do app móvel continuará armazenando auditorias localmente.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => onShowToast({ title: 'Diagnóstico de Rede', message: 'Serviço de telemetria operando em modo fallback.', type: 'warning' })}
                className="px-3 py-1.5 rounded-lg bg-[#131722] hover:bg-[#1f2433] text-slate-200 border border-[#1e2433] text-xs font-semibold"
              >
                Diagnóstico de Rede
              </button>
              <button
                onClick={() => {
                  onShowToast({ title: 'Reconectando Gateway...', message: 'Tentativa de handshake TLS enviada ao gateway.', type: 'info' });
                  setTimeout(() => setActiveState('success'), 1200);
                }}
                className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-sm"
              >
                Reconectar Gateway
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Modal Despachar Alerta de Campo */}
      {modalNewAlert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="relative w-full max-w-lg bg-[#171b26] border border-[#1e2433] rounded-2xl shadow-2xl p-6 overflow-hidden">
            <div className="flex items-center justify-between pb-4 border-b border-[#1e2433]">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-purple-600/20 text-purple-400 border border-purple-500/30 flex items-center justify-center">
                  <span className="material-symbols-outlined text-xl">add_alert</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Despachar Alerta de Campo</h3>
                  <p className="text-[11px] text-slate-400">Emissão de notificação tática aos promotores e líderes de loja</p>
                </div>
              </div>
              <button onClick={() => setModalNewAlert(false)} className="text-slate-400 hover:text-white p-1">
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            <form onSubmit={handleCreateAlert} className="space-y-4 py-4 text-xs">
              <div className="space-y-1">
                <label className="font-bold text-slate-300">Loja / PDV Destino *</label>
                <select
                  value={alertStore}
                  onChange={(e) => setAlertStore(e.target.value)}
                  className="w-full h-10 px-3 bg-[#10141f] border border-[#1e2433] rounded-lg text-slate-100 focus:outline-none focus:border-purple-500"
                >
                  <option value="Pão de Açúcar - Jardins">Pão de Açúcar - Jardins (SP)</option>
                  <option value="Carrefour Hipermercado - Barra">Carrefour Hipermercado - Barra (RJ)</option>
                  <option value="Assaí Atacadista - Radial Leste">Assaí Atacadista - Radial Leste (SP)</option>
                  <option value="Sam's Club - Alphaville">Sam's Club - Alphaville (SP)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-300">Tipo de Incidente *</label>
                <select
                  value={alertType}
                  onChange={(e) => setAlertType(e.target.value)}
                  className="w-full h-10 px-3 bg-[#10141f] border border-[#1e2433] rounded-lg text-slate-100 focus:outline-none focus:border-purple-500"
                >
                  <option value="Ruptura Crítica">Ruptura Crítica de SKU</option>
                  <option value="Ponto Extra Conflitante">Ponto Extra Ocupado Indevidamente</option>
                  <option value="Preço Divergente">Preço Divergente do Tabloide</option>
                  <option value="Atraso de Rota">Atraso ou Solicitação de Apoio</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-300">Instruções aos Promotores em Loja</label>
                <textarea
                  rows={3}
                  value={alertNotes}
                  onChange={(e) => setAlertNotes(e.target.value)}
                  placeholder="Descreva a ação esperada (ex: reabastecer gôndola frontal, fotografar e validar código EAN)..."
                  className="w-full p-3 bg-[#10141f] border border-[#1e2433] rounded-lg text-slate-100 focus:outline-none focus:border-purple-500 resize-none placeholder:text-slate-500"
                />
              </div>

              <div className="pt-3 border-t border-[#1e2433] flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setModalNewAlert(false)}
                  className="px-4 py-2 rounded-lg bg-[#131722] hover:bg-[#1f2433] text-slate-300 border border-[#1e2433] font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-bold neon-purple-glow"
                >
                  Disparar Alerta Agora
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
