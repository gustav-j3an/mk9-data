import React, { useState, useEffect, useCallback } from 'react';
import { ScreenId, ToastMessage } from '../types';
import { supabase } from '../lib/supabase';

interface CockpitViewProps {
  onNavigate: (screen: ScreenId) => void;
  onShowToast: (toast: Omit<ToastMessage, 'id'>) => void;
}

interface CockpitMetrics {
  totalPromotoresAtivos: number;
  cltCount: number;
  freelanceCount: number;
  totalLojas: number;
  totalIndustrias: number;
  totalRotas: number;
  rotasComVisitaDiaAtual: number;
  presentesHoje: number;
  faltasHoje: number;
  atestadosHoje: number;
  presencaPerc: number;
  totalAPagar: number;
}

export const CockpitView: React.FC<CockpitViewProps> = ({ onNavigate, onShowToast }) => {
  const [period, setPeriod] = useState('today');
  const [chartDays, setChartDays] = useState<'7' | '15' | '30'>('7');
  const [activityFilter, setActivityFilter] = useState<'todos' | 'checkin' | 'auditoria' | 'ruptura'>('todos');
  const [searchActivity, setSearchActivity] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncText, setLastSyncText] = useState('—');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Estados dos KPIs reais
  const [metrics, setMetrics] = useState<CockpitMetrics>({
    totalPromotoresAtivos: 0,
    cltCount: 0,
    freelanceCount: 0,
    totalLojas: 0,
    totalIndustrias: 0,
    totalRotas: 0,
    rotasComVisitaDiaAtual: 0,
    presentesHoje: 0,
    faltasHoje: 0,
    atestadosHoje: 0,
    presencaPerc: 0,
    totalAPagar: 0
  });

  // Atividades recentes reais a partir de rotas cadastradas
  const [recentActivities, setRecentActivities] = useState<Array<{
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
  }>>([]);

  // Função resiliente de carregamento de dados do Supabase
  const loadCockpitData = useCallback(async (isManualRefresh = false) => {
    if (isManualRefresh) {
      setIsSyncing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    if (!supabase) {
      setError('Cliente Supabase não inicializado.');
      setLoading(false);
      setIsSyncing(false);
      return;
    }

    try {
      // Dia da semana atual em português: segunda, terca, quarta, quinta, sexta, sabado, domingo
      const now = new Date();
      const dayIndex = now.getDay(); // 0 = Domingo, 1 = Segunda...
      const dayKeys = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
      const currentDayKey = dayKeys[dayIndex];

      // Usar Promise.allSettled para garantir resiliência caso tabelas opcionais não existam
      const results = await Promise.allSettled([
        supabase.from('promotores').select('*'),
        supabase.from('lojas').select('*'),
        supabase.from('industrias').select('*'),
        supabase.from('rotas').select(`
          id,
          codigo_rota,
          industria_codigo,
          loja_codigo,
          promotor_matricula,
          uf,
          frequencia,
          segunda,
          terca,
          quarta,
          quinta,
          sexta,
          sabado,
          domingo,
          industria:industrias(nome),
          loja:lojas(nome, cidade),
          promotor:promotores(nome)
        `),
        supabase.from('presenca').select('*'),
        supabase.from('diarias').select('*')
      ]);

      const [promotoresSettled, lojasSettled, industriasSettled, rotasSettled, presencaSettled, diariasSettled] = results;

      // Verificar falha APENAS nas tabelas obrigatórias existentes
      let mandatoryError: string | null = null;
      if (promotoresSettled.status === 'rejected' || (promotoresSettled.status === 'fulfilled' && promotoresSettled.value.error)) {
        mandatoryError = promotoresSettled.status === 'rejected' ? String(promotoresSettled.reason) : promotoresSettled.value.error?.message || 'Erro em promotores';
      } else if (lojasSettled.status === 'rejected' || (lojasSettled.status === 'fulfilled' && lojasSettled.value.error)) {
        mandatoryError = lojasSettled.status === 'rejected' ? String(lojasSettled.reason) : lojasSettled.value.error?.message || 'Erro em lojas';
      } else if (industriasSettled.status === 'rejected' || (industriasSettled.status === 'fulfilled' && industriasSettled.value.error)) {
        mandatoryError = industriasSettled.status === 'rejected' ? String(industriasSettled.reason) : industriasSettled.value.error?.message || 'Erro em industrias';
      } else if (rotasSettled.status === 'rejected' || (rotasSettled.status === 'fulfilled' && rotasSettled.value.error)) {
        mandatoryError = rotasSettled.status === 'rejected' ? String(rotasSettled.reason) : rotasSettled.value.error?.message || 'Erro em rotas';
      }

      if (mandatoryError) {
        throw new Error(`Falha nas tabelas principais: ${mandatoryError}`);
      }

      // Extrair dados seguros
      const promotores = (promotoresSettled.status === 'fulfilled' && !promotoresSettled.value.error) ? promotoresSettled.value.data || [] : [];
      const lojas = (lojasSettled.status === 'fulfilled' && !lojasSettled.value.error) ? lojasSettled.value.data || [] : [];
      const industrias = (industriasSettled.status === 'fulfilled' && !industriasSettled.value.error) ? industriasSettled.value.data || [] : [];
      const rotas = (rotasSettled.status === 'fulfilled' && !rotasSettled.value.error) ? rotasSettled.value.data || [] : [];

      // Tabelas Opcionais (Presença & Diárias): tratar erros graciosamente como array vazio
      const presencas = (presencaSettled.status === 'fulfilled' && !presencaSettled.value.error) ? presencaSettled.value.data || [] : [];
      const diarias = (diariasSettled.status === 'fulfilled' && !diariasSettled.value.error) ? diariasSettled.value.data || [] : [];

      // 1. Promotores Ativos (CLT vs Freelancer)
      const promotoresAtivos = promotores.filter((p: any) => p.status === 'ativo');
      const totalPromotoresAtivos = promotoresAtivos.length;
      
      let cltCount = 0;
      let freelanceCount = 0;

      promotoresAtivos.forEach((p: any) => {
        const typeStr = String(p.tipo || p.contrato || p.equipe || '').toUpperCase();
        if (typeStr.includes('FREE') || typeStr.includes('DIARIA')) {
          freelanceCount++;
        } else {
          cltCount++;
        }
      });

      // 2. Visitas/Rotas (Colunas exatas: segunda, terca, quarta, quinta, sexta, sabado, domingo)
      const totalRotas = rotas.length;
      const rotasComVisitaDiaAtual = rotas.filter((r: any) => Boolean(r[currentDayKey])).length;

      // 3. Presença (Dados opcionais realistas)
      let presentesHoje = 0;
      let faltasHoje = 0;
      let atestadosHoje = 0;
      let presencaPerc = 0;

      if (presencas.length > 0) {
        presencas.forEach((pr: any) => {
          const st = String(pr.status || '').toLowerCase();
          if (st === 'presente') presentesHoje++;
          else if (st === 'falta') faltasHoje++;
          else if (st === 'atestado') atestadosHoje++;
        });
        const totalRegistrosPresenca = presencas.length;
        presencaPerc = totalRegistrosPresenca > 0 ? Math.round((presentesHoje / totalRegistrosPresenca) * 100) : 0;
      }

      // 4. Diárias (Dados opcionais realistas)
      let totalAPagar = 0;
      if (diarias.length > 0) {
        diarias.forEach((d: any) => {
          if (d.status === 'a_pagar' || d.status === 'pendente') {
            totalAPagar += Number(d.valor || d.amount || 0);
          }
        });
      }

      setMetrics({
        totalPromotoresAtivos,
        cltCount,
        freelanceCount,
        totalLojas: lojas.length,
        totalIndustrias: industrias.length,
        totalRotas,
        rotasComVisitaDiaAtual,
        presentesHoje,
        faltasHoje,
        atestadosHoje,
        presencaPerc,
        totalAPagar
      });

      // Atividades recentes mapeadas a partir das rotas reais existentes
      const activitiesMapped = rotas.slice(0, 10).map((r: any, idx: number) => {
        const pName = r.promotor?.nome || r.promotor_matricula || 'Promotor';
        const pInitials = pName.substring(0, 2).toUpperCase();
        const storeName = r.loja?.nome || r.loja_codigo || 'PDV Cadastrado';
        const cityName = r.loja?.cidade || r.uf || 'SP';
        const clientName = r.industria?.nome || r.industria_codigo || 'Indústria';

        return {
          id: r.id || `act-${idx}`,
          promoter: pName,
          promoterInitials: pInitials,
          type: r.frequencia || 'SEMANAL',
          store: storeName,
          city: cityName,
          client: clientName,
          activity: `Escala Rota ${r.codigo_rota}`,
          time: 'Hoje',
          category: 'checkin',
          status: 'Agendado',
          statusColor: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
        };
      });

      setRecentActivities(activitiesMapped);
      setLastSyncText(now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));

      if (isManualRefresh) {
        onShowToast({
          title: 'Cockpit Sincronizado',
          message: 'Métricas atualizadas com sucesso a partir das tabelas ativas no Supabase.',
          type: 'success'
        });
      }
    } catch (err: any) {
      console.error('Erro no Cockpit:', err);
      setError(err.message || 'Falha ao sincronizar dados com o Supabase.');
      onShowToast({
        title: 'Erro de Sincronização',
        message: err.message || 'Erro ao carregar dados do Supabase.',
        type: 'error'
      });
    } finally {
      setLoading(false);
      setIsSyncing(false);
    }
  }, [onShowToast]);

  useEffect(() => {
    loadCockpitData();
  }, [loadCockpitData]);

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
    <div className="w-full px-4 lg:px-8 py-6 max-w-[1720px] mx-auto space-y-6 font-sans">
      {/* Ambient Glow */}
      <div className="absolute top-16 left-0 right-0 h-96 bg-gradient-to-b from-purple-900/15 via-cyan-900/5 to-transparent pointer-events-none -z-10 blur-3xl" />

      {/* Header Area */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-col">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-extrabold text-white tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white via-purple-200 to-cyan-300">
              Cockpit
            </h1>
            <span className="px-2.5 py-0.5 rounded-full bg-[#1e2433] text-cyan-400 font-mono text-xs border border-cyan-500/30">
              SUPABASE REALTIME
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-400 flex items-center gap-2 mt-1">
            <span>Visão geral da operação comercial e de campo</span>
            <span className="w-1.5 h-1.5 rounded-full bg-slate-600" />
            <span className="text-emerald-400 font-medium">Sincronizado com Banco Supabase</span>
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative inline-flex items-center bg-[#171b26] border border-[#1e2433] px-3 py-2 rounded-xl shadow-md font-mono text-xs">
            <span className="material-symbols-outlined text-cyan-400 text-[18px] mr-2">calendar_today</span>
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="bg-transparent text-slate-100 text-xs font-semibold focus:outline-none cursor-pointer pr-4 appearance-none"
            >
              <option value="today" className="bg-[#171b26] text-white">Hoje</option>
              <option value="7d" className="bg-[#171b26] text-white">Últimos 7 dias</option>
              <option value="month" className="bg-[#171b26] text-white">Mês Atual</option>
            </select>
            <span className="material-symbols-outlined text-slate-400 text-sm pointer-events-none">expand_more</span>
          </div>

          <div className="flex items-center gap-2 bg-[#0a0d14] border border-[#1e2433] p-1 rounded-xl shadow-md">
            <button
              onClick={() => loadCockpitData(true)}
              disabled={isSyncing || loading}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold neon-purple-glow active:scale-95 transition-all disabled:opacity-60 cursor-pointer"
            >
              <span className={`material-symbols-outlined text-[18px] ${isSyncing || loading ? 'animate-spin' : ''}`}>
                sync
              </span>
              <span>{isSyncing || loading ? 'Carregando...' : 'Atualizar Dados'}</span>
            </button>
            <span className="px-2 font-mono text-[11px] text-slate-400 whitespace-nowrap hidden sm:inline">
              Atualizado: {lastSyncText}
            </span>
          </div>
        </div>
      </div>

      {/* BANNER DE ERRO REAL DE TABELAS OBRIGATÓRIAS */}
      {error && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs font-mono text-rose-300 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-rose-400">warning</span>
            <span>{error}</span>
          </div>
          <button
            onClick={() => loadCockpitData(true)}
            className="px-3 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white font-bold text-[11px] cursor-pointer"
          >
            Tentar Novamente
          </button>
        </div>
      )}

      {/* 5 CARDS TÁTICOS CONECTADOS AO SUPABASE */}
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
            <span className="text-3xl font-extrabold text-white tracking-tight">
              {loading ? '...' : metrics.totalPromotoresAtivos}
            </span>
            <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 font-mono text-[11px] font-semibold border border-slate-700">
              {metrics.totalPromotoresAtivos > 0 ? 'Cadastrados' : 'Sem dados'}
            </span>
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-[#1e2433] text-[11px] font-mono text-slate-400">
            <span>{metrics.cltCount} CLT • {metrics.freelanceCount} Free</span>
            <div className="flex items-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full ${metrics.totalPromotoresAtivos > 0 ? 'bg-emerald-400' : 'bg-slate-600'}`} />
            </div>
          </div>
        </div>

        {/* KPI 2: Rotas e Visitas Hoje */}
        <div
          onClick={() => onNavigate('rotas-fixas')}
          className="cursor-pointer bg-[#171b26] border border-[#1e2433] hover:border-cyan-500/40 p-4 rounded-xl shadow-lg relative overflow-hidden transition-all group"
        >
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-cyan-500 to-blue-500" />
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Rotas &amp; Visitas Hoje</span>
            <span className="p-1.5 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              <span className="material-symbols-outlined text-[18px]">alt_route</span>
            </span>
          </div>
          <div className="flex items-baseline gap-2 my-2">
            <span className="text-3xl font-extrabold text-white tracking-tight">
              {loading ? '...' : metrics.rotasComVisitaDiaAtual}
            </span>
            <span className="text-xs text-slate-500">/ {metrics.totalRotas} rotas</span>
          </div>
          <div className="w-full bg-[#10141f] rounded-full h-1.5 my-1 overflow-hidden">
            <div
              className="bg-cyan-400 h-1.5 rounded-full"
              style={{
                width: `${metrics.totalRotas > 0 ? Math.round((metrics.rotasComVisitaDiaAtual / metrics.totalRotas) * 100) : 0}%`
              }}
            />
          </div>
          <div className="flex items-center justify-between pt-1 text-[11px] font-mono">
            <span className="text-cyan-400 font-semibold">
              {metrics.totalRotas > 0 ? `${Math.round((metrics.rotasComVisitaDiaAtual / metrics.totalRotas) * 100)}% hoje` : 'Sem rotas'}
            </span>
            <span className="text-slate-400">{metrics.totalRotas} total</span>
          </div>
        </div>

        {/* KPI 3: Lojas & Indústrias */}
        <div
          onClick={() => onNavigate('lojas')}
          className="cursor-pointer bg-[#171b26] border border-[#1e2433] hover:border-amber-500/40 p-4 rounded-xl shadow-lg relative overflow-hidden transition-all group"
        >
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500 to-orange-500" />
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Lojas &amp; Indústrias</span>
            <span className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <span className="material-symbols-outlined text-[18px]">store</span>
            </span>
          </div>
          <div className="flex items-baseline gap-2 my-2">
            <span className="text-3xl font-extrabold text-amber-400 tracking-tight">
              {loading ? '...' : metrics.totalLojas}
            </span>
            <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 font-mono text-[11px] font-semibold border border-slate-700">
              {metrics.totalIndustrias} indústrias
            </span>
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-[#1e2433] text-[11px] font-mono text-slate-400">
            <span>{metrics.totalLojas} PDVs cadastrados</span>
            <span className="text-amber-400 font-bold">Base Real</span>
          </div>
        </div>

        {/* KPI 4: Presença (Tabela opcional tratada com resiliência) */}
        <div
          onClick={() => onNavigate('presenca')}
          className="cursor-pointer bg-[#171b26] border border-[#1e2433] hover:border-emerald-500/40 p-4 rounded-xl shadow-lg relative overflow-hidden transition-all group"
        >
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 to-teal-400" />
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Presença do Dia</span>
            <span className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <span className="material-symbols-outlined text-[18px]">how_to_reg</span>
            </span>
          </div>
          <div className="flex items-baseline gap-2 my-2">
            <span className="text-3xl font-extrabold text-white tracking-tight">
              {metrics.presentesHoje > 0 ? `${metrics.presencaPerc}%` : '0'}
            </span>
            <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 font-mono text-[11px] font-semibold border border-slate-700">
              {metrics.presentesHoje > 0 ? `${metrics.presentesHoje} presentes` : 'Sem dados'}
            </span>
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-[#1e2433] text-[11px] font-mono text-slate-400">
            <span>{metrics.faltasHoje} faltas • {metrics.atestadosHoje} atestados</span>
            <span className={`w-2 h-2 rounded-full ${metrics.presentesHoje > 0 ? 'bg-emerald-400' : 'bg-slate-600'}`} />
          </div>
        </div>

        {/* KPI 5: Total a Pagar Diárias (Tabela opcional tratada com resiliência) */}
        <div
          onClick={() => onNavigate('controle-diarias')}
          className="cursor-pointer bg-[#171b26] border border-[#1e2433] hover:border-purple-500/40 p-4 rounded-xl shadow-lg relative overflow-hidden transition-all group"
        >
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-400 to-pink-500" />
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Diárias a Pagar</span>
            <span className="p-1.5 rounded-lg bg-purple-600/20 text-purple-300 border border-purple-500/30">
              <span className="material-symbols-outlined text-[18px]">payments</span>
            </span>
          </div>
          <div className="flex items-baseline gap-2 my-2">
            <span className="text-2xl font-extrabold text-white font-mono tracking-tight truncate">
              R$ {metrics.totalAPagar.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </span>
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-[#1e2433] text-[11px] font-mono text-slate-400">
            <span className="truncate">{metrics.totalAPagar > 0 ? 'Lotes Pendentes' : 'Sem dados'}</span>
            <span className="text-purple-400 font-bold">{metrics.freelanceCount} Freelancers</span>
          </div>
        </div>
      </div>

      {/* SEÇÃO INTERMEDIÁRIA: VISUALIZAÇÃO E GRÁFICOS */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 xl:col-span-8 bg-[#171b26] border border-[#1e2433] rounded-xl p-5 shadow-xl flex flex-col justify-between relative overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span className="material-symbols-outlined text-cyan-400 text-lg">analytics</span>
                Cobertura Operacional de Rotas
              </h2>
              <p className="text-xs text-slate-400">Volume semanal consolidado de indústrias, lojas e promotores ativos</p>
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

          <div className="relative w-full h-64 flex flex-col items-center justify-center border border-[#1e2433] rounded-xl bg-[#131722]/50 p-6 space-y-4 font-mono">
            {metrics.totalRotas > 0 ? (
              <div className="w-full space-y-4">
                <div className="flex items-center justify-between text-xs text-slate-300">
                  <span>Capacidade Total de Cobertura das Rotas</span>
                  <span className="font-bold text-cyan-400">{metrics.totalRotas} rotas ativas</span>
                </div>
                <div className="w-full bg-[#10141f] h-4 rounded-full overflow-hidden p-0.5 border border-[#1e2433]">
                  <div
                    className="bg-gradient-to-r from-purple-500 via-cyan-400 to-emerald-400 h-3 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, Math.max(10, (metrics.rotasComVisitaDiaAtual / (metrics.totalRotas || 1)) * 100))}%` }}
                  />
                </div>
                <div className="grid grid-cols-3 gap-4 text-center text-xs pt-2">
                  <div className="p-3 bg-[#171b26] border border-[#1e2433] rounded-lg">
                    <span className="text-slate-400 block text-[10px]">INDÚSTRIAS</span>
                    <span className="text-purple-400 font-bold text-base">{metrics.totalIndustrias}</span>
                  </div>
                  <div className="p-3 bg-[#171b26] border border-[#1e2433] rounded-lg">
                    <span className="text-slate-400 block text-[10px]">LOJAS / PDVs</span>
                    <span className="text-cyan-400 font-bold text-base">{metrics.totalLojas}</span>
                  </div>
                  <div className="p-3 bg-[#171b26] border border-[#1e2433] rounded-lg">
                    <span className="text-slate-400 block text-[10px]">PROMOTORES</span>
                    <span className="text-amber-400 font-bold text-base">{metrics.totalPromotoresAtivos}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center space-y-2">
                <span className="material-symbols-outlined text-4xl text-slate-600">bar_chart</span>
                <p className="text-xs text-slate-400 font-bold">Sem dados suficientes para exibição do gráfico</p>
                <p className="text-[11px] text-slate-500">Importe planilhas de rotas e cadastros para gerar a telemetria.</p>
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-[#1e2433] flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-slate-400">
            <div>Rotas no Supabase: <strong className="text-white">{metrics.totalRotas}</strong></div>
            <div>Visitas Previstas Hoje: <strong className="text-cyan-400">{metrics.rotasComVisitaDiaAtual}</strong></div>
            <div>PDVs Únicos: <strong className="text-emerald-400">{metrics.totalLojas}</strong></div>
          </div>
        </div>

        <div className="lg:col-span-5 xl:col-span-4 bg-[#171b26] border border-[#1e2433] rounded-xl p-5 shadow-xl flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span className="material-symbols-outlined text-emerald-400 text-lg">donut_large</span>
                Composição da Equipe
              </h2>
              <p className="text-xs text-slate-400">Divisão contratual dos promotores de campo</p>
            </div>
            <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 font-mono text-xs font-semibold border border-slate-700">
              {metrics.totalPromotoresAtivos} Ativos
            </span>
          </div>

          <div className="relative flex items-center justify-center my-6">
            <div className="w-36 h-36 rounded-full border-8 border-[#10141f] border-t-purple-500 border-r-cyan-400 flex items-center justify-center text-center font-mono">
              <div>
                <span className="text-2xl font-extrabold text-white block leading-none">{metrics.totalPromotoresAtivos}</span>
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mt-1">Promotores</span>
              </div>
            </div>
          </div>

          <div className="space-y-2 pt-3 border-t border-[#1e2433] text-xs font-mono">
            <div className="flex items-center justify-between py-1.5 px-2.5 rounded bg-[#131722]">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-purple-500" />
                <span className="text-slate-200">Equipe CLT</span>
              </div>
              <span className="font-bold text-purple-300">{metrics.cltCount} colaboradores</span>
            </div>

            <div className="flex items-center justify-between py-1.5 px-2.5 rounded bg-[#131722]">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-cyan-400" />
                <span className="text-slate-200">Equipe Freelancer / Diárias</span>
              </div>
              <span className="font-bold text-cyan-300">{metrics.freelanceCount} colaboradores</span>
            </div>
          </div>
        </div>
      </div>

      {/* SEÇÃO INFERIOR: ATIVIDADES E ALERTAS */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 xl:col-span-8 bg-[#171b26] border border-[#1e2433] rounded-xl shadow-xl flex flex-col justify-between overflow-hidden">
          <div className="p-4 border-b border-[#1e2433] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white">Escala &amp; Atividade Recente</h2>
                <span className="px-2 py-0.5 rounded bg-[#131722] text-cyan-400 font-mono text-[10px] border border-cyan-500/20">
                  Supabase Live
                </span>
              </div>
              <p className="text-xs text-slate-400">Relação de rotas e promotores ativos na operação</p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#10141f] font-mono text-[10px] text-slate-400 tracking-wider uppercase border-b border-[#1e2433] h-10">
                  <th className="py-2.5 px-4 font-semibold">Promotor &amp; Tipo</th>
                  <th className="py-2.5 px-4 font-semibold">Loja / PDV</th>
                  <th className="py-2.5 px-4 font-semibold">Indústria</th>
                  <th className="py-2.5 px-4 font-semibold">Atividade</th>
                  <th className="py-2.5 px-4 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1e2433] text-slate-200 font-mono">
                {filteredActivities.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-12 text-slate-400 font-sans">
                      <div className="flex flex-col items-center justify-center space-y-2">
                        <span className="material-symbols-outlined text-4xl text-slate-600">monitor_heart</span>
                        <p className="text-sm font-semibold text-slate-300">Nenhum registro de rota encontrado no banco.</p>
                        <p className="text-xs text-slate-500">Importe planilhas de rotas para alimentar este painel.</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredActivities.map((act) => (
                    <tr key={act.id} className="hover:bg-[#1c2230] transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-purple-600/30 text-purple-300 border border-purple-500/40 flex items-center justify-center font-bold text-xs">
                            {act.promoterInitials}
                          </div>
                          <div>
                            <div className="font-bold text-slate-100">{act.promoter}</div>
                            <span className="font-mono text-[10px] text-emerald-400">{act.type}</span>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-200">{act.store}</div>
                        <span className="text-[10px] text-slate-500">{act.city}</span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded bg-[#1f2433] text-slate-300 font-medium border border-[#334155]/40">
                          {act.client}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-300">{act.activity}</td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${act.statusColor}`}>
                          {act.status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="lg:col-span-5 xl:col-span-4 bg-[#171b26] border border-[#1e2433] rounded-xl p-5 shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30">
                  <span className="material-symbols-outlined text-lg">notifications_active</span>
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">Alertas do Sistema</h2>
                  <p className="text-xs text-slate-400">Auditoria e integridade da base</p>
                </div>
              </div>
              <span className="px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-mono text-xs font-bold border border-amber-500/30">
                {metrics.totalRotas === 0 ? 'Atenção' : 'OK'}
              </span>
            </div>

            <div className="space-y-3 font-mono text-xs">
              {metrics.totalRotas === 0 ? (
                <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-2">
                  <div className="font-bold text-amber-300 flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-sm">warning</span>
                    <span>Sem Rotas Cadastradas</span>
                  </div>
                  <p className="text-slate-400 text-[11px]">
                    Não há rotas no banco de dados. Utilize o módulo de <strong>Importação de Planilhas</strong> ou <strong>Rotas Fixas</strong> para cadastrar.
                  </p>
                </div>
              ) : (
                <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-2">
                  <div className="font-bold text-emerald-300 flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-sm">check_circle</span>
                    <span>Base de Dados Operacional</span>
                  </div>
                  <p className="text-slate-400 text-[11px]">
                    {metrics.totalRotas} rotas ativas associadas a {metrics.totalLojas} lojas e {metrics.totalIndustrias} indústrias.
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="pt-3 mt-4 border-t border-[#1e2433] flex items-center justify-between text-xs font-mono">
            <span className="text-slate-400">Controle Operacional MK9</span>
            <button
              onClick={() => onNavigate('rotas-fixas')}
              className="font-bold text-purple-400 hover:text-purple-300 flex items-center gap-1 cursor-pointer"
            >
              Ver Rotas Fixas <span className="material-symbols-outlined text-sm">arrow_forward</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
