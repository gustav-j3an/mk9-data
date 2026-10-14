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
      const now = new Date();
      const dayIndex = now.getDay();
      const dayKeys = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
      const currentDayKey = dayKeys[dayIndex];

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

      const promotores = (promotoresSettled.status === 'fulfilled' && !promotoresSettled.value.error) ? promotoresSettled.value.data || [] : [];
      const lojas = (lojasSettled.status === 'fulfilled' && !lojasSettled.value.error) ? lojasSettled.value.data || [] : [];
      const industrias = (industriasSettled.status === 'fulfilled' && !industriasSettled.value.error) ? industriasSettled.value.data || [] : [];
      const rotas = (rotasSettled.status === 'fulfilled' && !rotasSettled.value.error) ? rotasSettled.value.data || [] : [];

      const presencas = (presencaSettled.status === 'fulfilled' && !presencaSettled.value.error) ? presencaSettled.value.data || [] : [];
      const diarias = (diariasSettled.status === 'fulfilled' && !diariasSettled.value.error) ? diariasSettled.value.data || [] : [];

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

      const totalLojas = lojas.filter((l: any) => l.status === 'ativo').length || lojas.length;
      const totalIndustrias = industrias.filter((i: any) => i.status === 'ativo').length || industrias.length;
      const totalRotas = rotas.length;

      const rotasHoje = rotas.filter((r: any) => Boolean(r[currentDayKey]));
      const rotasComVisitaDiaAtual = rotasHoje.length;

      let presentesHoje = 0;
      let faltasHoje = 0;
      let atestadosHoje = 0;

      if (presencas.length > 0) {
        const todayStr = now.toISOString().split('T')[0];
        const presencasHoje = presencas.filter((pr: any) => (pr.data || pr.created_at || '').startsWith(todayStr));
        
        presencasHoje.forEach((pr: any) => {
          const s = String(pr.status || '').toLowerCase();
          if (s === 'presente' || s === 'confirmado') presentesHoje++;
          else if (s === 'falta') faltasHoje++;
          else if (s === 'atestado') atestadosHoje++;
        });
      }

      const presencaPerc = totalPromotoresAtivos > 0 ? Math.round((presentesHoje / totalPromotoresAtivos) * 100) : 0;

      let totalAPagar = 0;
      if (diarias.length > 0) {
        diarias.forEach((d: any) => {
          const s = String(d.status || '').toLowerCase();
          if (s === 'a_pagar' || s === 'pendente') {
            const val = typeof d.valor === 'number' ? d.valor : parseFloat(d.valor || 0);
            totalAPagar += isNaN(val) ? 0 : val;
          }
        });
      }

      setMetrics({
        totalPromotoresAtivos,
        cltCount,
        freelanceCount,
        totalLojas,
        totalIndustrias,
        totalRotas,
        rotasComVisitaDiaAtual,
        presentesHoje,
        faltasHoje,
        atestadosHoje,
        presencaPerc,
        totalAPagar
      });

      const mappedActivities = rotas.slice(0, 10).map((r: any, idx: number) => {
        const pName = r.promotor?.nome || `Promotor Mat: ${r.promotor_matricula}`;
        const initials = pName
          .split(' ')
          .map((n: string) => n[0])
          .slice(0, 2)
          .join('')
          .toUpperCase() || 'PR';

        const isToday = Boolean(r[currentDayKey]);
        const status = isToday ? 'Em Rota Hoje' : 'Programada';
        const statusColor = isToday
          ? 'bg-[#E8F5EE] text-[#16845B] border-[#B9E5D0]'
          : 'bg-[#F7F6F2] text-[#737373] border-[#CFCDC5]';

        return {
          id: r.id || `act-${idx}`,
          promoter: pName,
          promoterInitials: initials,
          type: r.frequencia || 'SEMANAL',
          store: r.loja?.nome || `Loja Cód: ${r.loja_codigo}`,
          city: r.loja?.cidade || r.uf || 'SP',
          client: r.industria?.nome || r.industria_codigo || 'Indústria',
          activity: `Atendimento em PDV • Rota ${r.codigo_rota}`,
          time: isToday ? 'Hoje' : 'Escala Semanal',
          category: 'checkin',
          status,
          statusColor
        };
      });

      setRecentActivities(mappedActivities);

      const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      setLastSyncText(timeStr);

      if (isManualRefresh) {
        onShowToast({
          title: 'Dados Sincronizados',
          message: 'As métricas operacionais foram atualizadas com sucesso.',
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
      {/* Header Area - Editorial GridCraft */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-[#CFCDC5] pb-5">
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-[#737373] tracking-widest uppercase font-mono">
              COCKPIT OPERACIONAL
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#171717] tracking-tight mt-0.5">
            Visão Geral da Operação
          </h1>
          <p className="text-xs sm:text-sm text-[#737373] mt-1">
            Acompanhe em tempo real o desempenho dos promotores, visitas, rotas e indicadores de Trade Marketing.
          </p>
        </div>

        {/* Action Controls - ArtCraft buttons & filters */}
        <div className="flex flex-wrap items-center gap-2.5 font-mono text-xs">
          <div className="relative inline-flex items-center bg-[#F7F6F2] border border-[#CFCDC5] px-3 py-1.5 rounded-lg text-xs">
            <span className="material-symbols-outlined text-[#737373] text-[16px] mr-2">calendar_today</span>
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="bg-transparent text-[#171717] text-xs font-semibold focus:outline-none cursor-pointer pr-4 appearance-none"
            >
              <option value="today">Hoje</option>
              <option value="7d">Últimos 7 dias</option>
              <option value="month">Mês Atual</option>
            </select>
            <span className="material-symbols-outlined text-[#737373] text-sm pointer-events-none">expand_more</span>
          </div>

          <button
            onClick={() => loadCockpitData(true)}
            disabled={isSyncing || loading}
            className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-[#111114] hover:bg-black text-white text-xs font-semibold transition-all disabled:opacity-60 cursor-pointer shadow-xs"
          >
            <span className={`material-symbols-outlined text-[16px] ${isSyncing || loading ? 'animate-spin' : ''}`}>
              sync
            </span>
            <span>{isSyncing || loading ? 'Atualizando...' : 'Atualizar Dados'}</span>
          </button>

          <span className="px-2 font-mono text-[11px] text-[#737373] whitespace-nowrap hidden sm:inline">
            Sincronizado: {lastSyncText}
          </span>
        </div>
      </div>

      {/* BANNER DE ERRO CASO OCORRA */}
      {error && (
        <div className="p-4 bg-[#FDF2F2] border border-[#F8C8C8] rounded-lg text-xs font-mono text-[#D93636] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#D93636]">warning</span>
            <span>{error}</span>
          </div>
          <button
            onClick={() => loadCockpitData(true)}
            className="px-3 py-1 rounded bg-[#D93636] hover:bg-[#b52626] text-white font-bold text-[11px] cursor-pointer"
          >
            Tentar Novamente
          </button>
        </div>
      )}

      {/* 5 CARDS TÁTICOS - GridCraft Surfaces (#F7F6F2, border #CFCDC5, typography focus) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
        {/* KPI 1: Promotores Ativos */}
        <div
          onClick={() => onNavigate('promotores')}
          className="cursor-pointer bg-[#F7F6F2] border border-[#CFCDC5] hover:border-[#111114] p-4 rounded-xl transition-all group"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-[#737373] uppercase tracking-wider font-mono">Promotores Ativos</span>
            <span className="p-1.5 rounded-md bg-[#EBF2FE] text-[#286FF5] border border-[#C3D9FD]">
              <span className="material-symbols-outlined text-[18px]">badge</span>
            </span>
          </div>
          <div className="flex items-baseline gap-2 my-2.5">
            <span className="text-3xl font-extrabold text-[#171717] tracking-tight font-sans">
              {loading ? '...' : metrics.totalPromotoresAtivos}
            </span>
            <span className="px-1.5 py-0.5 rounded bg-[#E8F5EE] text-[#16845B] font-mono text-[10px] font-bold border border-[#B9E5D0]">
              Base Ativa
            </span>
          </div>
          <div className="flex items-center justify-between pt-2.5 border-t border-[#CFCDC5] text-[11px] font-mono text-[#737373]">
            <span>{metrics.cltCount} CLT • {metrics.freelanceCount} Free</span>
            <span className="w-1.5 h-1.5 rounded-full bg-[#16845B]" />
          </div>
        </div>

        {/* KPI 2: Rotas e Visitas Hoje */}
        <div
          onClick={() => onNavigate('rotas-fixas')}
          className="cursor-pointer bg-[#F7F6F2] border border-[#CFCDC5] hover:border-[#111114] p-4 rounded-xl transition-all group"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-[#737373] uppercase tracking-wider font-mono">Rotas Hoje</span>
            <span className="p-1.5 rounded-md bg-[#E4E2DB] text-[#171717] border border-[#CFCDC5]">
              <span className="material-symbols-outlined text-[18px]">alt_route</span>
            </span>
          </div>
          <div className="flex items-baseline gap-2 my-2.5">
            <span className="text-3xl font-extrabold text-[#171717] tracking-tight font-sans">
              {loading ? '...' : metrics.rotasComVisitaDiaAtual}
            </span>
            <span className="text-xs text-[#737373]">/ {metrics.totalRotas} cadastradas</span>
          </div>
          <div className="w-full bg-[#E4E2DB] rounded-full h-1 my-1 overflow-hidden">
            <div
              className="bg-[#286FF5] h-1 rounded-full"
              style={{
                width: `${metrics.totalRotas > 0 ? Math.round((metrics.rotasComVisitaDiaAtual / metrics.totalRotas) * 100) : 0}%`
              }}
            />
          </div>
          <div className="flex items-center justify-between pt-1 text-[11px] font-mono text-[#737373]">
            <span className="font-semibold text-[#286FF5]">
              {metrics.totalRotas > 0 ? `${Math.round((metrics.rotasComVisitaDiaAtual / metrics.totalRotas) * 100)}% na escala` : 'Sem rotas'}
            </span>
            <span>{metrics.totalRotas} rotas</span>
          </div>
        </div>

        {/* KPI 3: Lojas & Indústrias */}
        <div
          onClick={() => onNavigate('lojas')}
          className="cursor-pointer bg-[#F7F6F2] border border-[#CFCDC5] hover:border-[#111114] p-4 rounded-xl transition-all group"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-[#737373] uppercase tracking-wider font-mono">PDVs Atendidos</span>
            <span className="p-1.5 rounded-md bg-[#FFF8E6] text-[#D98A00] border border-[#FCE19B]">
              <span className="material-symbols-outlined text-[18px]">store</span>
            </span>
          </div>
          <div className="flex items-baseline gap-2 my-2.5">
            <span className="text-3xl font-extrabold text-[#171717] tracking-tight font-sans">
              {loading ? '...' : metrics.totalLojas}
            </span>
            <span className="px-1.5 py-0.5 rounded bg-[#E4E2DB] text-[#171717] font-mono text-[10px] font-bold border border-[#CFCDC5]">
              {metrics.totalIndustrias} indústrias
            </span>
          </div>
          <div className="flex items-center justify-between pt-2.5 border-t border-[#CFCDC5] text-[11px] font-mono text-[#737373]">
            <span>Lojas ativas na rede</span>
            <span className="text-[#171717] font-bold">100% Cadastradas</span>
          </div>
        </div>

        {/* KPI 4: Presença do Dia */}
        <div
          onClick={() => onNavigate('presenca')}
          className="cursor-pointer bg-[#F7F6F2] border border-[#CFCDC5] hover:border-[#111114] p-4 rounded-xl transition-all group"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-[#737373] uppercase tracking-wider font-mono">Presença Hoje</span>
            <span className="p-1.5 rounded-md bg-[#E8F5EE] text-[#16845B] border border-[#B9E5D0]">
              <span className="material-symbols-outlined text-[18px]">how_to_reg</span>
            </span>
          </div>
          <div className="flex items-baseline gap-2 my-2.5">
            <span className="text-3xl font-extrabold text-[#171717] tracking-tight font-sans">
              {metrics.presentesHoje > 0 ? `${metrics.presencaPerc}%` : '—'}
            </span>
            <span className="px-1.5 py-0.5 rounded bg-[#E4E2DB] text-[#737373] font-mono text-[10px] font-bold border border-[#CFCDC5]">
              {metrics.presentesHoje > 0 ? `${metrics.presentesHoje} confirmados` : 'Sem registros'}
            </span>
          </div>
          <div className="flex items-center justify-between pt-2.5 border-t border-[#CFCDC5] text-[11px] font-mono text-[#737373]">
            <span>{metrics.faltasHoje} faltas • {metrics.atestadosHoje} atestados</span>
            <span className={`w-1.5 h-1.5 rounded-full ${metrics.presentesHoje > 0 ? 'bg-[#16845B]' : 'bg-[#CFCDC5]'}`} />
          </div>
        </div>

        {/* KPI 5: Diárias a Pagar */}
        <div
          onClick={() => onNavigate('controle-diarias')}
          className="cursor-pointer bg-[#F7F6F2] border border-[#CFCDC5] hover:border-[#111114] p-4 rounded-xl transition-all group"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-[#737373] uppercase tracking-wider font-mono">Diárias a Pagar</span>
            <span className="p-1.5 rounded-md bg-[#F7F6F2] text-[#111114] border border-[#CFCDC5]">
              <span className="material-symbols-outlined text-[18px]">payments</span>
            </span>
          </div>
          <div className="flex items-baseline gap-2 my-2.5">
            <span className="text-2xl font-extrabold text-[#171717] font-mono tracking-tight truncate">
              R$ {metrics.totalAPagar.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </span>
          </div>
          <div className="flex items-center justify-between pt-2.5 border-t border-[#CFCDC5] text-[11px] font-mono text-[#737373]">
            <span className="truncate">{metrics.totalAPagar > 0 ? 'Lotes Pendentes' : 'Conciliado'}</span>
            <span className="text-[#171717] font-bold">{metrics.freelanceCount} Freelancers</span>
          </div>
        </div>
      </div>

      {/* SEÇÃO INTERMEDIÁRIA: COBERTURA E COMPOSIÇÃO */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 xl:col-span-8 bg-[#F7F6F2] border border-[#CFCDC5] rounded-xl p-5 flex flex-col justify-between">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-sm font-bold text-[#171717] flex items-center gap-2 uppercase tracking-wider font-mono">
                <span className="material-symbols-outlined text-[#286FF5] text-base">analytics</span>
                Cobertura Operacional de Rotas
              </h2>
              <p className="text-xs text-[#737373]">Volume consolidado de rotas, lojas e cobertura por escala</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="inline-flex rounded-lg bg-[#E4E2DB] p-0.5 border border-[#CFCDC5]">
                {(['7', '15', '30'] as const).map((d) => (
                  <button
                    key={d}
                    onClick={() => setChartDays(d)}
                    className={`px-3 py-1 rounded text-xs font-mono font-semibold transition-all cursor-pointer ${
                      chartDays === d
                        ? 'bg-[#111114] text-white'
                        : 'text-[#737373] hover:text-[#171717]'
                    }`}
                  >
                    {d} Dias
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="relative w-full h-60 flex flex-col items-center justify-center border border-[#CFCDC5] rounded-xl bg-white p-6 space-y-4 font-mono">
            {metrics.totalRotas > 0 ? (
              <div className="w-full space-y-4">
                <div className="flex items-center justify-between text-xs text-[#171717]">
                  <span className="font-semibold">Capacidade Total de Cobertura das Rotas</span>
                  <span className="font-bold text-[#286FF5]">{metrics.totalRotas} rotas ativas</span>
                </div>
                <div className="w-full bg-[#E4E2DB] h-3 rounded-full overflow-hidden p-0.5 border border-[#CFCDC5]">
                  <div
                    className="bg-[#286FF5] h-2 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, Math.max(10, (metrics.rotasComVisitaDiaAtual / (metrics.totalRotas || 1)) * 100))}%` }}
                  />
                </div>
                <div className="grid grid-cols-3 gap-3 text-center text-xs pt-2">
                  <div className="p-3 bg-[#F7F6F2] border border-[#CFCDC5] rounded-lg">
                    <span className="text-[#737373] block text-[10px] font-bold uppercase">INDÚSTRIAS</span>
                    <span className="text-[#171717] font-extrabold text-lg">{metrics.totalIndustrias}</span>
                  </div>
                  <div className="p-3 bg-[#F7F6F2] border border-[#CFCDC5] rounded-lg">
                    <span className="text-[#737373] block text-[10px] font-bold uppercase">LOJAS / PDVs</span>
                    <span className="text-[#286FF5] font-extrabold text-lg">{metrics.totalLojas}</span>
                  </div>
                  <div className="p-3 bg-[#F7F6F2] border border-[#CFCDC5] rounded-lg">
                    <span className="text-[#737373] block text-[10px] font-bold uppercase">PROMOTORES</span>
                    <span className="text-[#171717] font-extrabold text-lg">{metrics.totalPromotoresAtivos}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center space-y-2">
                <span className="material-symbols-outlined text-4xl text-[#737373]">bar_chart</span>
                <p className="text-xs text-[#171717] font-bold">Sem dados suficientes para exibição</p>
                <p className="text-[11px] text-[#737373]">Cadastre rotas ou importe planilhas para visualizar métricas.</p>
              </div>
            )}
          </div>

          <div className="pt-3 mt-3 border-t border-[#CFCDC5] flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-[#737373]">
            <div>Rotas Cadastradas: <strong className="text-[#171717]">{metrics.totalRotas}</strong></div>
            <div>Programadas Hoje: <strong className="text-[#286FF5]">{metrics.rotasComVisitaDiaAtual}</strong></div>
            <div>PDVs Únicos: <strong className="text-[#16845B]">{metrics.totalLojas}</strong></div>
          </div>
        </div>

        {/* Composição da Equipe */}
        <div className="lg:col-span-5 xl:col-span-4 bg-[#F7F6F2] border border-[#CFCDC5] rounded-xl p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-[#171717] flex items-center gap-2 uppercase tracking-wider font-mono">
                <span className="material-symbols-outlined text-[#16845B] text-base">donut_large</span>
                Composição da Equipe
              </h2>
              <p className="text-xs text-[#737373]">Divisão contratual dos promotores</p>
            </div>
            <span className="px-2 py-0.5 rounded bg-[#E4E2DB] text-[#171717] font-mono text-xs font-bold border border-[#CFCDC5]">
              {metrics.totalPromotoresAtivos} Total
            </span>
          </div>

          <div className="relative flex items-center justify-center my-6">
            <div className="w-32 h-32 rounded-full border-4 border-[#E4E2DB] border-t-[#111114] border-r-[#286FF5] flex items-center justify-center text-center font-mono bg-white">
              <div>
                <span className="text-2xl font-extrabold text-[#171717] block leading-none">{metrics.totalPromotoresAtivos}</span>
                <span className="text-[9px] text-[#737373] font-bold uppercase tracking-wider block mt-1">Promotores</span>
              </div>
            </div>
          </div>

          <div className="space-y-2 pt-3 border-t border-[#CFCDC5] text-xs font-mono">
            <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-white border border-[#CFCDC5]">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#111114]" />
                <span className="text-[#171717] font-medium">Equipe CLT</span>
              </div>
              <span className="font-bold text-[#171717]">{metrics.cltCount} ativos</span>
            </div>

            <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-white border border-[#CFCDC5]">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#286FF5]" />
                <span className="text-[#171717] font-medium">Equipe Freelancer / Diárias</span>
              </div>
              <span className="font-bold text-[#286FF5]">{metrics.freelanceCount} ativos</span>
            </div>
          </div>
        </div>
      </div>

      {/* SEÇÃO INFERIOR: TABELA DE ATIVIDADE RECENTE & ALERTAS */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 xl:col-span-8 bg-[#F7F6F2] border border-[#CFCDC5] rounded-xl flex flex-col justify-between overflow-hidden">
          <div className="p-4 border-b border-[#CFCDC5] flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-[#171717] uppercase tracking-wider font-mono">
                  Escala &amp; Atividade Recente
                </h2>
                <span className="px-1.5 py-0.5 rounded bg-[#E8F5EE] text-[#16845B] font-mono text-[10px] font-bold border border-[#B9E5D0]">
                  Sincronizado
                </span>
              </div>
              <p className="text-xs text-[#737373]">Rotas e promotores programados para atendimento</p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#E4E2DB] font-mono text-[10px] text-[#737373] tracking-wider uppercase border-b border-[#CFCDC5] h-9">
                  <th className="py-2 px-4 font-bold text-[#171717]">Promotor</th>
                  <th className="py-2 px-4 font-bold text-[#171717]">Loja / PDV</th>
                  <th className="py-2 px-4 font-bold text-[#171717]">Indústria</th>
                  <th className="py-2 px-4 font-bold text-[#171717]">Atividade</th>
                  <th className="py-2 px-4 font-bold text-[#171717]">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#CFCDC5] text-[#171717] font-mono bg-white">
                {filteredActivities.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-12 text-[#737373] font-sans">
                      <div className="flex flex-col items-center justify-center space-y-2">
                        <span className="material-symbols-outlined text-4xl text-[#CFCDC5]">monitor_heart</span>
                        <p className="text-sm font-semibold text-[#171717]">Nenhum registro de rota encontrado.</p>
                        <p className="text-xs text-[#737373]">Importe planilhas de rotas para alimentar este painel.</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredActivities.map((act) => (
                    <tr key={act.id} className="hover:bg-[#EAE8E2] transition-colors">
                      <td className="py-2.5 px-4">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-md bg-[#E4E2DB] text-[#171717] border border-[#CFCDC5] flex items-center justify-center font-bold text-[10px]">
                            {act.promoterInitials}
                          </div>
                          <div>
                            <div className="font-bold text-[#171717] font-sans">{act.promoter}</div>
                            <span className="font-mono text-[9px] text-[#737373]">{act.type}</span>
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 px-4 font-sans">
                        <div className="font-medium text-[#171717]">{act.store}</div>
                        <span className="text-[10px] text-[#737373]">{act.city}</span>
                      </td>
                      <td className="py-2.5 px-4 font-sans">
                        <span className="px-2 py-0.5 rounded bg-[#F7F6F2] text-[#171717] font-medium border border-[#CFCDC5] text-[11px]">
                          {act.client}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-[#525252] font-sans text-xs">{act.activity}</td>
                      <td className="py-2.5 px-4">
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

        {/* Alertas do Sistema */}
        <div className="lg:col-span-5 xl:col-span-4 bg-[#F7F6F2] border border-[#CFCDC5] rounded-xl p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-[#E4E2DB] text-[#171717] border border-[#CFCDC5]">
                  <span className="material-symbols-outlined text-base">notifications_active</span>
                </div>
                <div>
                  <h2 className="text-sm font-bold text-[#171717] uppercase tracking-wider font-mono">Alertas Operacionais</h2>
                  <p className="text-xs text-[#737373]">Auditoria e integridade da base</p>
                </div>
              </div>
              <span className="px-2 py-0.5 rounded bg-[#E8F5EE] text-[#16845B] font-mono text-[10px] font-bold border border-[#B9E5D0]">
                {metrics.totalRotas === 0 ? 'Atenção' : 'Conforme'}
              </span>
            </div>

            <div className="space-y-3 font-mono text-xs">
              {metrics.totalRotas === 0 ? (
                <div className="p-3.5 rounded-lg bg-[#FFF8E6] border border-[#FCE19B] space-y-1.5">
                  <div className="font-bold text-[#D98A00] flex items-center gap-1.5 font-sans text-xs">
                    <span className="material-symbols-outlined text-sm">warning</span>
                    <span>Sem Rotas Cadastradas</span>
                  </div>
                  <p className="text-[#737373] text-[11px] font-sans leading-relaxed">
                    Não há rotas no banco de dados. Utilize o módulo de <strong>Importação de Planilhas</strong> ou <strong>Rotas Fixas</strong> para cadastrar.
                  </p>
                </div>
              ) : (
                <div className="p-3.5 rounded-lg bg-white border border-[#CFCDC5] space-y-1.5">
                  <div className="font-bold text-[#16845B] flex items-center gap-1.5 font-sans text-xs">
                    <span className="material-symbols-outlined text-sm">check_circle</span>
                    <span>Base Operacional Carregada</span>
                  </div>
                  <p className="text-[#525252] text-[11px] font-sans leading-relaxed">
                    {metrics.totalRotas} rotas ativas associadas a {metrics.totalLojas} lojas e {metrics.totalIndustrias} indústrias cadastradas.
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="pt-3 mt-4 border-t border-[#CFCDC5] flex items-center justify-between text-xs font-mono">
            <span className="text-[#737373]">Controle MK9 Date</span>
            <button
              onClick={() => onNavigate('rotas-fixas')}
              className="font-bold text-[#111114] hover:text-[#286FF5] flex items-center gap-1 cursor-pointer transition-colors"
            >
              Ver Rotas Fixas <span className="material-symbols-outlined text-sm">arrow_forward</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
