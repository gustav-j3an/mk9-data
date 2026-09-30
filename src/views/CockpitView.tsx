import React, { useState } from 'react';
import { ScreenId, ToastMessage } from '../types';

interface CockpitViewProps {
  onNavigate: (screen: ScreenId) => void;
  onShowToast: (toast: Omit<ToastMessage, 'id'>) => void;
}

export const CockpitView: React.FC<CockpitViewProps> = ({ onNavigate, onShowToast }) => {
  const [period, setPeriod] = useState('today');
  const [chartDays, setChartDays] = useState<'7' | '15' | '30'>('7');
  const [activityFilter, setActivityFilter] = useState<'todos' | 'checkin' | 'auditoria' | 'ruptura'>('todos');
  const [searchActivity, setSearchActivity] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncText, setLastSyncText] = useState('há 42s');
  const [resolvedAlerts, setResolvedAlerts] = useState<string[]>([]);

  const handleRefresh = () => {
    setIsSyncing(true);
    setTimeout(() => {
      setIsSyncing(false);
      setLastSyncText('Agora mesmo');
      onShowToast({
        title: 'Dados Operacionais Atualizados',
        message: 'Telemetria de campo e roteiros sincronizados com êxito.',
        type: 'success'
      });
    }, 800);
  };

  const handleExport = () => {
    onShowToast({
      title: 'Exportando Relatório Geral',
      message: 'Download do relatório consolidado (.xlsx) iniciado.',
      type: 'info'
    });
  };

  const handleResolveAlert = (id: string, actionName: string) => {
    setResolvedAlerts((prev) => [...prev, id]);
    onShowToast({
      title: 'Ação Tática Disparada',
      message: `Ação "${actionName}" registrada e despachada ao supervisor de campo.`,
      type: 'success'
    });
  };

  const recentActivities: Array<{
    id: string;
    promoter: string;
    promoterInitials: string;
    type: string;
    store: string;
    city: string;
    client: string;
    activity: string;
    time: string;
    category: string;
    status: string;
    statusColor: string;
  }> = [];

  const filteredActivities = recentActivities.filter((act) => {
    const matchesCategory =
      activityFilter === 'todos' ||
      (activityFilter === 'checkin' && act.category === 'checkin') ||
      (activityFilter === 'auditoria' && act.category === 'auditoria') ||
      (activityFilter === 'ruptura' && act.category === 'ruptura');

    const matchesSearch =
      act.promoter.toLowerCase().includes(searchActivity.toLowerCase()) ||
      act.store.toLowerCase().includes(searchActivity.toLowerCase()) ||
      act.client.toLowerCase().includes(searchActivity.toLowerCase());

    return matchesCategory && matchesSearch;
  });

  return (
    <div className="w-full px-4 lg:px-8 py-6 max-w-[1720px] mx-auto space-y-6">
      {/* Top Ambient Glow */}
      <div className="absolute top-16 left-0 right-0 h-96 bg-gradient-to-b from-purple-900/15 via-cyan-900/5 to-transparent pointer-events-none -z-10 blur-3xl" />

      {/* Header Area */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-col">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-extrabold text-white tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white via-purple-200 to-cyan-300">
              Cockpit
            </h1>
            <span className="px-2.5 py-0.5 rounded-full bg-[#1e2433] text-cyan-400 font-mono text-xs border border-cyan-500/30">
              SP-NODE-01
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-400 flex items-center gap-2 mt-1">
            <span>Visão geral da operação em tempo real</span>
            <span className="w-1.5 h-1.5 rounded-full bg-slate-600" />
            <span className="text-emerald-400 font-medium">99.8% dos roteiros sincronizados</span>
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Period Selector */}
          <div className="relative inline-flex items-center bg-[#171b26] border border-[#1e2433] px-3 py-2 rounded-xl shadow-md">
            <span className="material-symbols-outlined text-cyan-400 text-[18px] mr-2">calendar_today</span>
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="bg-transparent text-slate-100 text-xs font-semibold focus:outline-none cursor-pointer pr-4 appearance-none"
            >
              <option value="today" className="bg-[#171b26] text-white">Hoje (24 Out)</option>
              <option value="7d" className="bg-[#171b26] text-white">Últimos 7 dias</option>
              <option value="month" className="bg-[#171b26] text-white">Mês Atual (Out/24)</option>
              <option value="custom" className="bg-[#171b26] text-white">Personalizado</option>
            </select>
            <span className="material-symbols-outlined text-slate-400 text-sm pointer-events-none">expand_more</span>
          </div>

          {/* Quick Action: Export */}
          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#171b26] hover:bg-[#1f2433] text-cyan-300 border border-[#1e2433] text-xs font-semibold transition-all shadow-md active:scale-95"
          >
            <span className="material-symbols-outlined text-[18px]">download</span>
            <span>Exportar Relatório</span>
          </button>

          {/* Primary Command: Sync / Refresh */}
          <div className="flex items-center gap-2 bg-[#0a0d14] border border-[#1e2433] p-1 rounded-xl shadow-md">
            <button
              onClick={handleRefresh}
              disabled={isSyncing}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold neon-purple-glow active:scale-95 transition-all disabled:opacity-60 cursor-pointer"
            >
              <span className={`material-symbols-outlined text-[18px] ${isSyncing ? 'animate-spin' : ''}`}>
                sync
              </span>
              <span>{isSyncing ? 'Sincronizando...' : 'Atualizar dados'}</span>
            </button>
            <span className="px-2 font-mono text-[11px] text-slate-400 whitespace-nowrap hidden sm:inline">
              {lastSyncText}
            </span>
          </div>
        </div>
      </div>

      {/* 5 Distinct Tactical KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* KPI 1: Promotores Ativos */}
        <div
          onClick={() => onNavigate('promotores')}
          className="cursor-pointer bg-[#171b26] border border-[#1e2433] hover:border-purple-500/40 p-4 rounded-xl shadow-lg relative overflow-hidden transition-all group"
        >
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-500 to-indigo-500" />
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Promotores ativos</span>
            <span className="p-1.5 rounded-lg bg-purple-600/20 text-purple-300 border border-purple-500/30">
              <span className="material-symbols-outlined text-[18px]">badge</span>
            </span>
          </div>
          <div className="flex items-baseline gap-2 my-2">
            <span className="text-3xl font-extrabold text-white tracking-tight">1.428</span>
            <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-mono text-[11px] font-semibold border border-emerald-500/20">
              +4.2%
            </span>
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-[#1e2433] text-[11px] font-mono text-slate-400">
            <span>1.385 CLT • 43 Free</span>
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-2.5 rounded-full bg-emerald-400" />
              <span className="w-1.5 h-3.5 rounded-full bg-emerald-400" />
              <span className="w-1.5 h-2 rounded-full bg-emerald-400" />
              <span className="w-1.5 h-4 rounded-full bg-emerald-400 neon-green-glow" />
            </div>
          </div>
        </div>

        {/* KPI 2: Visitas Realizadas */}
        <div
          onClick={() => onNavigate('painel-operacional')}
          className="cursor-pointer bg-[#171b26] border border-[#1e2433] hover:border-cyan-500/40 p-4 rounded-xl shadow-lg relative overflow-hidden transition-all group"
        >
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-cyan-500 to-blue-500" />
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Visitas realizadas</span>
            <span className="p-1.5 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              <span className="material-symbols-outlined text-[18px]">checklist</span>
            </span>
          </div>
          <div className="flex items-baseline gap-2 my-2">
            <span className="text-3xl font-extrabold text-white tracking-tight">5.842</span>
            <span className="text-xs text-slate-500">/ 6.200</span>
          </div>
          <div className="w-full bg-[#10141f] rounded-full h-1.5 my-1 overflow-hidden">
            <div className="bg-cyan-400 h-1.5 rounded-full shadow-[0_0_8px_rgba(137,206,255,0.8)]" style={{ width: '94.2%' }} />
          </div>
          <div className="flex items-center justify-between pt-1 text-[11px] font-mono">
            <span className="text-cyan-400 font-semibold">94.2% meta</span>
            <span className="text-slate-400">318 em andamento</span>
          </div>
        </div>

        {/* KPI 3: Pendências de Auditoria */}
        <div
          onClick={() => onNavigate('painel-operacional')}
          className="cursor-pointer bg-[#171b26] border border-[#1e2433] hover:border-rose-500/40 p-4 rounded-xl shadow-lg relative overflow-hidden transition-all group"
        >
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-rose-600 to-rose-400" />
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Pendências auditoria</span>
            <span className="p-1.5 rounded-lg bg-rose-500/20 text-rose-400 border border-rose-500/30 animate-pulse">
              <span className="material-symbols-outlined text-[18px]">crisis_alert</span>
            </span>
          </div>
          <div className="flex items-baseline gap-2 my-2">
            <span className="text-3xl font-extrabold text-rose-400 tracking-tight">38</span>
            <span className="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 font-mono text-[11px] font-semibold border border-rose-500/30">
              12 críticas
            </span>
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-[#1e2433] text-[11px] font-mono text-slate-400">
            <span>24 fotos • 14 rupturas</span>
            <span className="text-rose-400 font-bold flex items-center gap-0.5 hover:underline">
              Fila <span className="material-symbols-outlined text-xs">arrow_forward</span>
            </span>
          </div>
        </div>

        {/* KPI 4: Presença do Dia */}
        <div
          onClick={() => onNavigate('presenca')}
          className="cursor-pointer bg-[#171b26] border border-[#1e2433] hover:border-emerald-500/40 p-4 rounded-xl shadow-lg relative overflow-hidden transition-all group"
        >
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 to-teal-400" />
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Presença do dia</span>
            <span className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <span className="material-symbols-outlined text-[18px]">pin_drop</span>
            </span>
          </div>
          <div className="flex items-baseline gap-2 my-2">
            <span className="text-3xl font-extrabold text-white tracking-tight">97.6%</span>
            <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-mono text-[11px] font-semibold border border-emerald-500/20">
              +1.1%
            </span>
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-[#1e2433] text-[11px] font-mono text-slate-400">
            <span>1.428 ok • 35 atrasos</span>
            <span className="w-2 h-2 rounded-full bg-emerald-400 neon-green-glow" />
          </div>
        </div>

        {/* KPI 5: Total a Pagar */}
        <div
          onClick={() => onNavigate('controle-diarias')}
          className="cursor-pointer bg-[#171b26] border border-[#1e2433] hover:border-purple-500/40 p-4 rounded-xl shadow-lg relative overflow-hidden transition-all group"
        >
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-400 to-pink-500" />
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Total a pagar</span>
            <span className="p-1.5 rounded-lg bg-purple-600/20 text-purple-300 border border-purple-500/30">
              <span className="material-symbols-outlined text-[18px]">payments</span>
            </span>
          </div>
          <div className="flex items-baseline gap-2 my-2">
            <span className="text-2xl font-extrabold text-white font-mono tracking-tight truncate">
              R$ 184.650
            </span>
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-[#1e2433] text-[11px] font-mono text-slate-400">
            <span className="truncate">Diárias &amp; Reembolsos</span>
            <span className="text-purple-400 font-bold">43 Free</span>
          </div>
        </div>
      </div>

      {/* Mid Section: Charts (Visitas Realizadas vs Planejadas + Donut Presença) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Analytical Chart */}
        <div className="lg:col-span-7 xl:col-span-8 bg-[#171b26] border border-[#1e2433] rounded-xl p-5 shadow-xl flex flex-col justify-between relative overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span className="material-symbols-outlined text-cyan-400 text-lg">analytics</span>
                Visitas Realizadas vs. Planejadas
              </h2>
              <p className="text-xs text-slate-400">Acompanhamento de volume diário da operação em campo</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="inline-flex rounded-lg bg-[#10141f] p-1 border border-[#1e2433]">
                {(['7', '15', '30'] as const).map((d) => (
                  <button
                    key={d}
                    onClick={() => setChartDays(d)}
                    className={`px-3 py-1 rounded text-xs font-mono font-semibold transition-all ${
                      chartDays === d
                        ? 'bg-purple-600 text-white neon-purple-glow shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {d} Dias
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap items-center gap-4 mb-4 text-xs font-mono">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(137,206,255,0.7)]" />
              <span className="text-white font-medium">Realizadas (Executadas)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-1 bg-purple-400 rounded-full" />
              <span className="text-slate-400">Planejadas (Meta Roteiro)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-rose-400 border-dashed border-t border-rose-400" />
              <span className="text-slate-400">Gaps de Cobertura</span>
            </div>
          </div>

          {/* Chart Canvas */}
          <div className="relative w-full h-64 sm:h-72">
            <svg className="w-full h-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 700 240">
              <defs>
                <linearGradient id="areaGradCockpit" x1="0%" x2="0%" y1="0%" y2="100%">
                  <stop offset="0%" stopColor="#89ceff" stopOpacity="0.3" />
                  <stop offset="70%" stopColor="#9333ea" stopOpacity="0.08" />
                  <stop offset="100%" stopColor="#0f131d" stopOpacity="0" />
                </linearGradient>
                <linearGradient id="lineGradCockpit" x1="0%" x2="100%" y1="0%" y2="0%">
                  <stop offset="0%" stopColor="#9333ea" />
                  <stop offset="50%" stopColor="#89ceff" />
                  <stop offset="100%" stopColor="#4edea3" />
                </linearGradient>
              </defs>

              {/* Horizontal Grid */}
              <line x1="40" x2="680" y1="30" y2="30" stroke="#282e40" strokeDasharray="3 3" opacity="0.5" />
              <line x1="40" x2="680" y1="80" y2="80" stroke="#282e40" strokeDasharray="3 3" opacity="0.5" />
              <line x1="40" x2="680" y1="130" y2="130" stroke="#282e40" strokeDasharray="3 3" opacity="0.5" />
              <line x1="40" x2="680" y1="180" y2="180" stroke="#282e40" strokeDasharray="3 3" opacity="0.5" />

              {/* Y Axis text */}
              <text x="32" y="34" fill="#64748b" fontSize="10" fontFamily="JetBrains Mono" textAnchor="end">6.500</text>
              <text x="32" y="84" fill="#64748b" fontSize="10" fontFamily="JetBrains Mono" textAnchor="end">6.000</text>
              <text x="32" y="134" fill="#64748b" fontSize="10" fontFamily="JetBrains Mono" textAnchor="end">5.500</text>
              <text x="32" y="184" fill="#64748b" fontSize="10" fontFamily="JetBrains Mono" textAnchor="end">5.000</text>

              {/* Planned Target Line */}
              <path d="M 60 70 Q 160 68 260 65 T 460 62 T 660 60" fill="none" stroke="#ddb8ff" strokeDasharray="6 4" strokeWidth="2" opacity="0.6" />

              {/* Area Fill */}
              <path
                d="M 60 135 C 110 120, 130 110, 160 105 C 200 100, 220 90, 260 75 C 310 60, 330 85, 360 80 C 410 70, 430 45, 460 48 C 510 52, 530 68, 560 64 C 610 60, 630 62, 660 65 L 660 210 L 60 210 Z"
                fill="url(#areaGradCockpit)"
              />

              {/* Actual Line */}
              <path
                d="M 60 135 C 110 120, 130 110, 160 105 C 200 100, 220 90, 260 75 C 310 60, 330 85, 360 80 C 410 70, 430 45, 460 48 C 510 52, 530 68, 560 64 C 610 60, 630 62, 660 65"
                fill="none"
                stroke="url(#lineGradCockpit)"
                strokeWidth="3.5"
              />

              {/* Dots */}
              <circle cx="60" cy="135" r="4" fill="#89ceff" stroke="#0f131d" strokeWidth="2" />
              <circle cx="160" cy="105" r="4" fill="#89ceff" stroke="#0f131d" strokeWidth="2" />
              <circle cx="260" cy="75" r="4" fill="#89ceff" stroke="#0f131d" strokeWidth="2" />
              <circle cx="360" cy="80" r="4" fill="#89ceff" stroke="#0f131d" strokeWidth="2" />
              <circle cx="460" cy="48" r="5" fill="#4edea3" stroke="#0f131d" strokeWidth="2" />
              <circle cx="560" cy="64" r="5" fill="#89ceff" stroke="#0f131d" strokeWidth="2" />
              <circle cx="660" cy="65" r="6" fill="#89ceff" stroke="#f6e6ff" strokeWidth="3" />

              {/* X Labels */}
              <text x="60" y="228" fill="#64748b" fontSize="11" textAnchor="middle">Sex (18)</text>
              <text x="160" y="228" fill="#64748b" fontSize="11" textAnchor="middle">Sáb (19)</text>
              <text x="260" y="228" fill="#64748b" fontSize="11" textAnchor="middle">Seg (21)</text>
              <text x="360" y="228" fill="#64748b" fontSize="11" textAnchor="middle">Ter (22)</text>
              <text x="460" y="228" fill="#64748b" fontSize="11" textAnchor="middle">Qua (23)</text>
              <text x="560" y="228" fill="#64748b" fontSize="11" textAnchor="middle">Qui (24 Hoje)</text>
              <text x="660" y="228" fill="#89ceff" fontSize="11" fontWeight="700" textAnchor="middle">Agora (17:40)</text>
            </svg>

            {/* Hover Tooltip Overlay */}
            <div className="absolute right-4 top-2 sm:right-6 sm:top-4 bg-[#0a0d14]/90 backdrop-blur-md border border-cyan-500/40 p-3 rounded-lg shadow-2xl flex flex-col pointer-events-none">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                <span className="font-mono text-xs text-cyan-300 font-bold">Hoje: 5.842 visitas</span>
              </div>
              <span className="text-[11px] text-slate-300">94.2% da meta concluída (6.200)</span>
              <span className="font-mono text-[10px] text-emerald-400 mt-0.5">+320 vs ontem mesmo horário</span>
            </div>
          </div>

          <div className="pt-3 border-t border-[#1e2433] flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-slate-400">
            <div>Média diária: <strong className="text-white">5.680 visitas</strong></div>
            <div>Pico semanal: <strong className="text-emerald-400">6.140 (Qua, 23 Out)</strong></div>
            <div>Ruptura média geral: <strong className="text-cyan-400">3.2%</strong></div>
          </div>
        </div>

        {/* Right Analytical Card: Donut Presença */}
        <div className="lg:col-span-5 xl:col-span-4 bg-[#171b26] border border-[#1e2433] rounded-xl p-5 shadow-xl flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span className="material-symbols-outlined text-emerald-400 text-lg">donut_large</span>
                Distribuição de Presença
              </h2>
              <p className="text-xs text-slate-400">Auditoria biométrica e geofencing</p>
            </div>
            <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-mono text-xs font-semibold border border-emerald-500/30">
              92.4% Pontual
            </span>
          </div>

          {/* Donut Visualization */}
          <div className="relative flex items-center justify-center my-4">
            <svg className="w-44 h-44 -rotate-90 transform" viewBox="0 0 140 140">
              {/* Background Track */}
              <circle cx="70" cy="70" r="54" fill="transparent" stroke="#1f2433" strokeWidth="14" />
              {/* Segment 1: No Horário (86.5%) */}
              <circle
                cx="70"
                cy="70"
                r="54"
                fill="transparent"
                stroke="#89ceff"
                strokeWidth="14"
                strokeDasharray="293.48 339.29"
                strokeDashoffset="0"
                strokeLinecap="round"
              />
              {/* Segment 2: Tolerância (11.1%) */}
              <circle
                cx="70"
                cy="70"
                r="54"
                fill="transparent"
                stroke="#9333ea"
                strokeWidth="14"
                strokeDasharray="37.66 339.29"
                strokeDashoffset="-296"
                strokeLinecap="round"
              />
              {/* Segment 3: Atrasos (2.1%) */}
              <circle
                cx="70"
                cy="70"
                r="54"
                fill="transparent"
                stroke="#f59e0b"
                strokeWidth="14"
                strokeDasharray="7.12 339.29"
                strokeDashoffset="-334"
                strokeLinecap="round"
              />
              {/* Segment 4: Ausência (0.3%) */}
              <circle
                cx="70"
                cy="70"
                r="54"
                fill="transparent"
                stroke="#f43f5e"
                strokeWidth="14"
                strokeDasharray="2 339.29"
                strokeDashoffset="-342"
                strokeLinecap="round"
              />
            </svg>

            {/* Donut Center Content */}
            <div className="absolute flex flex-col items-center justify-center text-center">
              <span className="text-3xl font-extrabold text-white leading-none font-mono">97.6%</span>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1 font-mono">Efetiva</span>
              <span className="text-[10px] text-emerald-400 font-mono">1.428 Ativos</span>
            </div>
          </div>

          {/* Breakdown Legend List */}
          <div className="space-y-1.5 pt-3 border-t border-[#1e2433] text-xs">
            <div className="flex items-center justify-between py-1 px-2 rounded hover:bg-[#131722] transition-colors">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(137,206,255,0.7)]" />
                <span className="text-slate-200">No Horário / Geofence</span>
              </div>
              <span className="font-mono font-semibold text-cyan-300">
                86.5% <span className="text-slate-400 font-normal">(1.270)</span>
              </span>
            </div>

            <div className="flex items-center justify-between py-1 px-2 rounded hover:bg-[#131722] transition-colors">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-purple-500 shadow-[0_0_6px_rgba(147,51,234,0.7)]" />
                <span className="text-slate-200">Check-in c/ Tolerância</span>
              </div>
              <span className="font-mono font-semibold text-purple-400">
                11.1% <span className="text-slate-400 font-normal">(158)</span>
              </span>
            </div>

            <div className="flex items-center justify-between py-1 px-2 rounded hover:bg-[#131722] transition-colors">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                <span className="text-slate-200">Atrasos (&gt;15 min)</span>
              </div>
              <span className="font-mono font-semibold text-amber-400">
                2.1% <span className="text-slate-400 font-normal">(35)</span>
              </span>
            </div>

            <div className="flex items-center justify-between py-1 px-2 rounded hover:bg-[#131722] transition-colors">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-400" />
                <span className="text-slate-200">Ausências Injustificadas</span>
              </div>
              <span className="font-mono font-semibold text-rose-400">
                0.3% <span className="text-slate-400 font-normal">(2)</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Section: Atividade Recente (65%) & Alertas Operacionais (35%) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Atividade Recente da Operação */}
        <div className="lg:col-span-7 xl:col-span-8 bg-[#171b26] border border-[#1e2433] rounded-xl shadow-xl flex flex-col justify-between overflow-hidden">
          <div className="p-4 border-b border-[#1e2433] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white">Atividade Recente da Operação</h2>
                <span className="px-2 py-0.5 rounded bg-[#131722] text-cyan-400 font-mono text-[10px] border border-cyan-500/20">
                  Ao Vivo
                </span>
              </div>
              <p className="text-xs text-slate-400">Transmissão em tempo real de auditorias, check-ins e validações</p>
            </div>

            {/* Filter chips */}
            <div className="flex items-center gap-1.5 overflow-x-auto">
              {(['todos', 'checkin', 'auditoria', 'ruptura'] as const).map((cat) => (
                <button
                  key={cat}
                  onClick={() => setActivityFilter(cat)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold capitalize transition-all ${
                    activityFilter === cat
                      ? 'bg-purple-600 text-white neon-purple-glow shadow-sm'
                      : 'bg-[#131722] text-slate-400 hover:text-white border border-[#1e2433]'
                  }`}
                >
                  {cat === 'todos' ? 'Todos' : cat === 'checkin' ? 'Check-in' : cat === 'auditoria' ? 'Auditoria' : 'Ruptura'}
                </button>
              ))}
            </div>
          </div>

          {/* Quick Search */}
          <div className="px-4 py-2 bg-[#131722]/50 border-b border-[#1e2433] flex items-center gap-2">
            <span className="material-symbols-outlined text-slate-400 text-base">filter_alt</span>
            <input
              type="text"
              value={searchActivity}
              onChange={(e) => setSearchActivity(e.target.value)}
              placeholder="Filtrar por promotor, loja ou cliente..."
              className="w-full bg-transparent text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none"
            />
            {searchActivity && (
              <button onClick={() => setSearchActivity('')} className="text-slate-400 hover:text-white text-xs">
                ✕
              </button>
            )}
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#10141f] font-mono text-[10px] text-slate-400 tracking-wider uppercase border-b border-[#1e2433] h-10 select-none">
                  <th className="py-2.5 px-4 font-semibold">Promotor &amp; Tipo</th>
                  <th className="py-2.5 px-4 font-semibold">Loja / Rede</th>
                  <th className="py-2.5 px-4 font-semibold">Cliente / Indústria</th>
                  <th className="py-2.5 px-4 font-semibold">Atividade</th>
                  <th className="py-2.5 px-4 font-semibold">Horário</th>
                  <th className="py-2.5 px-4 font-semibold">Status</th>
                  <th className="py-2.5 px-4 text-right font-semibold">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1e2433] text-slate-200">
                {filteredActivities.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-slate-400 font-sans">
                      <div className="flex flex-col items-center justify-center space-y-2">
                        <span className="material-symbols-outlined text-4xl text-slate-600">monitor_heart</span>
                        <p className="text-sm font-semibold text-slate-300">Não há dados cadastrados ainda.</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredActivities.map((act) => (
                    <tr key={act.id} className="hover:bg-[#1c2230] transition-colors group">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-purple-600/30 text-purple-300 border border-purple-500/40 flex items-center justify-center font-bold text-xs">
                            {act.promoterInitials}
                          </div>
                          <div>
                            <div className="font-bold text-slate-100 group-hover:text-purple-300 transition-colors">
                              {act.promoter}
                            </div>
                            <span className="font-mono text-[10px] text-emerald-400">{act.type}</span>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-200">{act.store}</div>
                        <span className="font-mono text-[10px] text-slate-500">{act.city}</span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded bg-[#1f2433] font-mono text-[11px] text-slate-300 font-medium border border-[#334155]/40">
                          {act.client}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-300">{act.activity}</td>
                      <td className="py-3 px-4 font-mono text-slate-400 whitespace-nowrap">{act.time}</td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border ${act.statusColor}`}>
                          <span className="w-1.5 h-1.5 rounded-full bg-current" />
                          {act.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() => onShowToast({
                            title: `Checklist de ${act.promoter}`,
                            message: `Loja ${act.store} • Auditoria carregada.`,
                            type: 'info'
                          })}
                          className="p-1 rounded text-slate-400 hover:text-cyan-400 hover:bg-[#131722] transition-colors"
                          title="Ver checklist"
                        >
                          <span className="material-symbols-outlined text-[17px]">visibility</span>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Table Footer */}
          <div className="p-3 bg-[#10141f] border-t border-[#1e2433] flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
            <span className="font-mono text-slate-400">
              Exibindo <strong className="text-white">1-5</strong> de <strong className="text-white">842</strong> atividades hoje
            </span>
            <div className="flex items-center gap-1 font-mono">
              <button disabled className="w-7 h-7 rounded bg-[#171b26] border border-[#1e2433] text-slate-600 cursor-not-allowed flex items-center justify-center">
                <span className="material-symbols-outlined text-sm">chevron_left</span>
              </button>
              <button className="w-7 h-7 rounded bg-purple-600 text-white font-bold flex items-center justify-center neon-purple-glow">1</button>
              <button className="w-7 h-7 rounded bg-[#171b26] border border-[#1e2433] text-slate-300 hover:bg-[#1f2433] flex items-center justify-center">2</button>
              <button className="w-7 h-7 rounded bg-[#171b26] border border-[#1e2433] text-slate-300 hover:bg-[#1f2433] flex items-center justify-center">3</button>
              <span className="px-1 text-slate-500">...</span>
              <button className="w-7 h-7 rounded bg-[#171b26] border border-[#1e2433] text-slate-300 hover:bg-[#1f2433] flex items-center justify-center">168</button>
              <button className="w-7 h-7 rounded bg-[#171b26] border border-[#1e2433] text-slate-300 hover:bg-[#1f2433] flex items-center justify-center">
                <span className="material-symbols-outlined text-sm">chevron_right</span>
              </button>
            </div>
          </div>
        </div>

        {/* Painel de Alertas Operacionais */}
        <div className="lg:col-span-5 xl:col-span-4 bg-[#171b26] border border-[#1e2433] rounded-xl p-5 shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-rose-500/20 text-rose-400 border border-rose-500/30">
                  <span className="material-symbols-outlined text-lg">notifications_active</span>
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">Alertas Operacionais</h2>
                  <p className="text-xs text-slate-400">Incidentes em campo que exigem decisão</p>
                </div>
              </div>
              <span className="px-2.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 font-mono text-xs font-bold animate-pulse border border-rose-500/30">
                6 Críticos
              </span>
            </div>

            {/* List of alerts */}
            <div className="space-y-3">
              {/* Alert 1 */}
              {!resolvedAlerts.includes('alert-1') && (
                <div className="p-3.5 rounded-xl bg-[#131722] border border-rose-500/40 hover:border-rose-400 transition-all shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <span className="inline-flex items-center gap-1 font-mono text-[11px] font-bold text-rose-400 uppercase">
                      <span className="w-2 h-2 rounded-full bg-rose-400 animate-ping" />
                      Ruptura Crítica • 4 SKUs Zerados
                    </span>
                    <span className="font-mono text-[10px] text-slate-500">Há 6 min</span>
                  </div>
                  <p className="text-xs font-bold text-slate-100 mt-1">L'Oréal - Linha Revitalift &amp; Elseve</p>
                  <p className="text-[11px] text-slate-400">Pão de Açúcar Morumbi • Promotor Lucas A.</p>
                  <div className="flex items-center gap-2 mt-3 pt-2 border-t border-[#1e2433]">
                    <button
                      onClick={() => handleResolveAlert('alert-1', 'Reposição Emergencial')}
                      className="flex-1 py-1.5 px-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-colors"
                    >
                      Disparar Reposição
                    </button>
                    <button
                      onClick={() => onShowToast({ title: 'Supervisor Notificado', message: 'Chamada aberta com supervisor regional.', type: 'info' })}
                      className="py-1.5 px-3 rounded-lg bg-[#171b26] hover:bg-[#1f2433] text-slate-300 text-xs font-semibold border border-[#1e2433]"
                    >
                      Supervisor
                    </button>
                  </div>
                </div>
              )}

              {/* Alert 2 */}
              {!resolvedAlerts.includes('alert-2') && (
                <div className="p-3.5 rounded-xl bg-[#131722] border border-amber-500/40 hover:border-amber-400 transition-all shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <span className="inline-flex items-center gap-1 font-mono text-[11px] font-bold text-amber-300 uppercase">
                      <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                      Geofence Inválido (&gt;350m)
                    </span>
                    <span className="font-mono text-[10px] text-slate-500">Há 18 min</span>
                  </div>
                  <p className="text-xs font-bold text-slate-100 mt-1">Check-in a 412m do raio da loja</p>
                  <p className="text-[11px] text-slate-400">Atacadão Santo Amaro • Carlos Eduardo (Free)</p>
                  <div className="flex items-center gap-2 mt-3 pt-2 border-t border-[#1e2433]">
                    <button
                      onClick={() => handleResolveAlert('alert-2', 'Exceção Geofence Validada')}
                      className="flex-1 py-1.5 px-2 rounded-lg bg-[#171b26] hover:bg-[#1f2433] text-cyan-300 text-xs font-semibold border border-[#1e2433]"
                    >
                      Validar Exceção
                    </button>
                    <button
                      onClick={() => onShowToast({ title: 'Visualização de Mapa', message: 'Abrindo coordenadas GPS do Atacadão Santo Amaro.', type: 'info' })}
                      className="py-1.5 px-3 rounded-lg bg-[#171b26] hover:bg-[#1f2433] text-slate-300 text-xs font-semibold border border-[#1e2433] flex items-center gap-1"
                    >
                      <span className="material-symbols-outlined text-sm">map</span> Mapa
                    </button>
                  </div>
                </div>
              )}

              {/* Alert 3 */}
              {!resolvedAlerts.includes('alert-3') && (
                <div className="p-3.5 rounded-xl bg-[#131722] border border-purple-500/40 hover:border-purple-400 transition-all shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <span className="inline-flex items-center gap-1 font-mono text-[11px] font-bold text-purple-300 uppercase">
                      <span className="w-2 h-2 rounded-full bg-purple-400" />
                      Foto Reprovada por IA
                    </span>
                    <span className="font-mono text-[10px] text-slate-500">Há 32 min</span>
                  </div>
                  <p className="text-xs font-bold text-slate-100 mt-1">Plano Cortado / Baixa Iluminação</p>
                  <p className="text-[11px] text-slate-400">Carrefour Anchieta • Juliana C. (Score 41%)</p>
                  <div className="mt-3 pt-2 border-t border-[#1e2433]">
                    <button
                      onClick={() => handleResolveAlert('alert-3', 'Nova Foto Requisitada via App')}
                      className="w-full py-1.5 px-2 rounded-lg bg-purple-600/30 hover:bg-purple-600/50 text-purple-200 border border-purple-500/40 text-xs font-bold transition-colors"
                    >
                      Requisitar Nova Foto
                    </button>
                  </div>
                </div>
              )}

              {/* Alert 4 */}
              {!resolvedAlerts.includes('alert-4') && (
                <div className="p-3.5 rounded-xl bg-[#131722] border border-cyan-500/40 hover:border-cyan-400 transition-all shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <span className="inline-flex items-center gap-1 font-mono text-[11px] font-bold text-cyan-300 uppercase">
                      <span className="w-2 h-2 rounded-full bg-cyan-400" />
                      Diária Sem Pré-Aprovação
                    </span>
                    <span className="font-mono text-[10px] text-slate-500">Há 45 min</span>
                  </div>
                  <p className="text-xs font-bold text-slate-100 mt-1">R$ 180,00 • Roberto Mendonça</p>
                  <p className="text-[11px] text-slate-400">Roteiro Fim de Semana Extraordinário</p>
                  <div className="flex items-center gap-2 mt-3 pt-2 border-t border-[#1e2433]">
                    <button
                      onClick={() => handleResolveAlert('alert-4', 'Diária Aprovada para Pagamento')}
                      className="flex-1 py-1.5 px-2 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 text-xs font-bold transition-colors"
                    >
                      Aprovar
                    </button>
                    <button
                      onClick={() => handleResolveAlert('alert-4', 'Diária Recusada')}
                      className="py-1.5 px-3 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 text-xs font-semibold transition-colors"
                    >
                      Recusar
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="pt-3 mt-4 border-t border-[#1e2433] flex items-center justify-between text-xs">
            <span className="font-mono text-slate-400">Modo de Resolução Rápida Ativo</span>
            <button
              onClick={() => onNavigate('painel-operacional')}
              className="font-mono font-bold text-purple-400 hover:text-purple-300 flex items-center gap-1"
            >
              Ver todos (18) <span className="material-symbols-outlined text-sm">arrow_forward</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
