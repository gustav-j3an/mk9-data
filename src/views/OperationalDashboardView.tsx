import React, { useState, useEffect, useCallback } from 'react';
import { ScreenId, ToastMessage, Visit, RouteItem } from '../types';
import { supabase } from '../lib/supabase';

interface OperationalDashboardViewProps {
  onNavigate: (screen: ScreenId) => void;
  onShowToast: (toast: Omit<ToastMessage, 'id'>) => void;
}

export const OperationalDashboardView: React.FC<OperationalDashboardViewProps> = ({
  onNavigate,
  onShowToast
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtro de Período Simples (today | week | month)
  const [periodFilter, setPeriodFilter] = useState<'today' | 'week' | 'month'>('today');

  const [visits, setVisits] = useState<Visit[]>([]);
  const [routes, setRoutes] = useState<RouteItem[]>([]);
  const [promotoresList, setPromotoresList] = useState<any[]>([]);
  const [industriasList, setIndustriasList] = useState<any[]>([]);

  const [tableSearch, setTableSearch] = useState('');
  const [tableStatus, setTableStatus] = useState<string>('all');
  const [selectedVisit, setSelectedVisit] = useState<Visit | null>(null);

  // Métrica de última atualização
  const [lastUpdate, setLastUpdate] = useState('—');

  // Carregar dados operacionais reais do Supabase
  const fetchOperationalData = useCallback(async () => {
    setLoading(true);
    setError(null);

    if (!supabase) {
      setError('Cliente Supabase não inicializado.');
      setLoading(false);
      return;
    }

    try {
      const now = new Date();
      let startDateStr = now.toISOString().split('T')[0];

      if (periodFilter === 'week') {
        const weekAgo = new Date();
        weekAgo.setDate(now.getDate() - 7);
        startDateStr = weekAgo.toISOString().split('T')[0];
      } else if (periodFilter === 'month') {
        const monthAgo = new Date();
        monthAgo.setDate(now.getDate() - 30);
        startDateStr = monthAgo.toISOString().split('T')[0];
      }

      // 1. Query das Visitas no Período
      let visitsQuery = supabase
        .from('visits')
        .select(`
          *,
          promotor:promotores(matricula, nome),
          loja:lojas(codigo, nome, cidade, uf, endereco),
          industria:industrias(codigo, nome),
          checklist_items:visit_checklist_items(*),
          photos:visit_photos(*),
          occurrences:visit_occurrences(*)
        `)
        .order('created_at', { ascending: false });

      if (periodFilter === 'today') {
        visitsQuery = visitsQuery.eq('data_visita', startDateStr);
      } else {
        visitsQuery = visitsQuery.gte('data_visita', startDateStr);
      }

      // 2. Rotas, Promotores e Indústrias
      const [visitsRes, rotasRes, promotoresRes, industriasRes] = await Promise.all([
        visitsQuery,
        supabase.from('rotas').select(`
          *,
          industria:industrias(codigo, nome),
          loja:lojas(codigo, nome, cidade, uf),
          promotor:promotores(matricula, nome)
        `),
        supabase.from('promotores').select('*'),
        supabase.from('industrias').select('*')
      ]);

      if (visitsRes.error) throw visitsRes.error;
      if (rotasRes.error) throw rotasRes.error;

      const realVisits = (visitsRes.data as unknown as Visit[]) || [];
      const realRoutes = (rotasRes.data as unknown as RouteItem[]) || [];

      setVisits(realVisits);
      setRoutes(realRoutes);
      setPromotoresList(promotoresRes.data || []);
      setIndustriasList(industriasRes.data || []);

      setLastUpdate(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    } catch (err: any) {
      console.error('Erro ao carregar dados do Painel Operacional:', err);
      setError(err.message || 'Falha ao carregar telemetria de visitas do Supabase.');
    } finally {
      setLoading(false);
    }
  }, [periodFilter]);

  useEffect(() => {
    fetchOperationalData();
  }, [fetchOperationalData]);

  // 1. GERAR DATAS DO PERÍODO SELECIONADO (Hoje, 7 dias, Este mês)
  const now = new Date();
  const dayKeys = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];

  const datesInPeriod: Array<{ dateStr: string; dayKey: string }> = [];

  if (periodFilter === 'today') {
    const todayStr = now.toISOString().split('T')[0];
    const currentDayKey = dayKeys[now.getDay()];
    datesInPeriod.push({ dateStr: todayStr, dayKey: currentDayKey });
  } else if (periodFilter === 'week') {
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(now.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const dayKey = dayKeys[d.getDay()];
      datesInPeriod.push({ dateStr, dayKey });
    }
  } else if (periodFilter === 'month') {
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(now.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const dayKey = dayKeys[d.getDay()];
      datesInPeriod.push({ dateStr, dayKey });
    }
  }

  // 2. EXPANDIR OCORRÊNCIAS DE PLANEJAMENTO REAL POR DATA E ROTA
  // Chave de desduplicação única: `promotor_matricula|loja_codigo|industria_codigo|dataStr`
  const plannedMap = new Map<string, {
    routeId: string;
    promotorMatricula: string;
    lojaCodigo: string;
    industriaCodigo: string;
    dataStr: string;
    frequencia: string;
  }>();

  routes.forEach((r) => {
    datesInPeriod.forEach(({ dateStr, dayKey }) => {
      // Verificar se o dia da semana está marcado na rota (segunda, terca, etc.)
      const isDayActive = Boolean(r[dayKey as keyof RouteItem]);
      if (isDayActive) {
        const uniqueKey = `${r.promotor_matricula}|${r.loja_codigo}|${r.industria_codigo}|${dateStr}`;
        if (!plannedMap.has(uniqueKey)) {
          plannedMap.set(uniqueKey, {
            routeId: r.id,
            promotorMatricula: r.promotor_matricula,
            lojaCodigo: r.loja_codigo,
            industriaCodigo: r.industria_codigo,
            dataStr: dateStr,
            frequencia: r.frequencia
          });
        }
      }
    });
  });

  const totalPlannedItems = Array.from(plannedMap.values());
  const rotasPlanejadasCount = totalPlannedItems.length;

  // 3. CRUZAMENTO DE VISITAS REALIZADAS COM PLANEJAMENTO NO PERÍODO
  const totalVisitas = visits.length;
  const concluidasCount = visits.filter((v) => v.status === 'concluida').length;
  const iniciadasCount = visits.filter((v) => v.status === 'em_andamento').length;
  const naoRealizadasCount = visits.filter((v) => v.status === 'nao_realizada').length;

  // Taxa de Execução Real (Visitas Concluídas / Ocorrências Planejadas no Período)
  const taxaExecucao = rotasPlanejadasCount > 0
    ? Math.round((concluidasCount / rotasPlanejadasCount) * 100)
    : (totalVisitas > 0 ? Math.round((concluidasCount / totalVisitas) * 100) : 0);

  // 4. Métricas de Fotos, Checklist e Ocorrências
  let totalFotos = 0;
  let totalChecklistItems = 0;
  let totalChecklistChecked = 0;

  let totalOcorrencias = 0;
  const ocorrenciasPorTipo = {
    ruptura: 0,
    preco_divergente: 0,
    falta_espaco: 0,
    outro: 0
  };

  const listaOcorrenciasCriticas: Array<{
    id: string;
    visitId: string;
    promotor: string;
    loja: string;
    industria: string;
    tipo: string;
    descricao: string;
    dataHora?: string;
  }> = [];

  visits.forEach((v) => {
    if (v.photos) totalFotos += v.photos.length;

    if (v.checklist_items) {
      totalChecklistItems += v.checklist_items.length;
      totalChecklistChecked += v.checklist_items.filter((c) => c.checked).length;
    }

    if (v.occurrences && v.occurrences.length > 0) {
      totalOcorrencias += v.occurrences.length;
      v.occurrences.forEach((occ) => {
        const t = occ.tipo as keyof typeof ocorrenciasPorTipo;
        if (ocorrenciasPorTipo[t] !== undefined) {
          ocorrenciasPorTipo[t]++;
        } else {
          ocorrenciasPorTipo.outro++;
        }

        listaOcorrenciasCriticas.push({
          id: occ.id || `occ-${Math.random()}`,
          visitId: v.id,
          promotor: v.promotor?.nome || v.promotor_matricula,
          loja: v.loja?.nome || v.loja_codigo,
          industria: v.industria?.nome || v.industria_codigo,
          tipo: occ.tipo,
          descricao: occ.descricao,
          dataHora: occ.created_at
        });
      });
    }
  });

  const checklistPerc = totalChecklistItems > 0 ? Math.round((totalChecklistChecked / totalChecklistItems) * 100) : 0;

  // 5. Agregação de Visitas por Promotor (Ranking Operacional)
  const rankingPromotores = promotoresList.map((p) => {
    const pPlannedItems = totalPlannedItems.filter((pi) => pi.promotorMatricula === p.matricula);
    const pPlannedCount = pPlannedItems.length;
    const pVisits = visits.filter((v) => v.promotor_matricula === p.matricula);
    const pConcluidas = pVisits.filter((v) => v.status === 'concluida').length;
    const pPendentes = Math.max(0, pPlannedCount - pConcluidas);
    const pTaxa = pPlannedCount > 0 ? Math.round((pConcluidas / pPlannedCount) * 100) : 0;

    return {
      matricula: p.matricula,
      nome: p.nome,
      cidade: p.cidade,
      planejadas: pPlannedCount,
      concluidas: pConcluidas,
      pendentes: pPendentes,
      taxa: pTaxa
    };
  }).sort((a, b) => b.concluidas - a.concluidas).slice(0, 8);

  // 6. Agregação de Visitas por Indústria
  const rankingIndustrias = industriasList.map((ind) => {
    const iPlannedItems = totalPlannedItems.filter((pi) => pi.industriaCodigo === ind.codigo);
    const iPlannedCount = iPlannedItems.length;
    const iVisits = visits.filter((v) => v.industria_codigo === ind.codigo);
    const iConcluidas = iVisits.filter((v) => v.status === 'concluida').length;

    let iOcorrencias = 0;
    iVisits.forEach((v) => {
      if (v.occurrences) iOcorrencias += v.occurrences.length;
    });

    return {
      codigo: ind.codigo,
      nome: ind.nome,
      planejadas: iPlannedCount,
      concluidas: iConcluidas,
      ocorrencias: iOcorrencias
    };
  }).sort((a, b) => b.concluidas - a.concluidas).slice(0, 8);

  // Filtragem da tabela de visitas
  const filteredVisits = visits.filter((v) => {
    const term = tableSearch.toLowerCase().trim();
    const matchesSearch =
      !term ||
      (v.promotor?.nome || '').toLowerCase().includes(term) ||
      (v.loja?.nome || '').toLowerCase().includes(term) ||
      (v.industria?.nome || '').toLowerCase().includes(term) ||
      (v.loja_codigo || '').toLowerCase().includes(term);

    const matchesStatus =
      tableStatus === 'all' || v.status === tableStatus;

    return matchesSearch && matchesStatus;
  });

  return (
    <div className="w-full px-4 lg:px-8 py-6 max-w-[1720px] mx-auto space-y-6 font-sans">
      {/* HEADER OPERACIONAL */}
      <section className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6 bg-[#171b26] border border-[#1e2433] p-5 sm:p-6 rounded-2xl shadow-xl relative overflow-hidden">
        <div className="absolute -right-16 -top-16 w-80 h-80 rounded-full bg-gradient-to-br from-purple-600/15 via-cyan-500/10 to-transparent blur-3xl pointer-events-none" />
        <div className="flex flex-col space-y-1.5 z-10">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-400 font-mono text-[11px] font-bold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
              TELEMETRIA OPERACIONAL REALTIME
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Painel Operacional de Trade Marketing
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 max-w-3xl">
            Indicadores gerenciais consolidados em tempo real a partir da execução do Portal do Promotor.
          </p>
        </div>

        {/* Action Bar & Filtro de Período */}
        <div className="flex flex-wrap items-center gap-3 z-10 font-mono text-xs">
          <div className="flex items-center bg-[#131722] border border-[#1e2433] rounded-xl p-1">
            <button
              onClick={() => setPeriodFilter('today')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${periodFilter === 'today' ? 'bg-purple-600 text-white shadow-md' : 'text-slate-400 hover:text-white'}`}
            >
              Hoje
            </button>
            <button
              onClick={() => setPeriodFilter('week')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${periodFilter === 'week' ? 'bg-purple-600 text-white shadow-md' : 'text-slate-400 hover:text-white'}`}
            >
              Últimos 7 dias
            </button>
            <button
              onClick={() => setPeriodFilter('month')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${periodFilter === 'month' ? 'bg-purple-600 text-white shadow-md' : 'text-slate-400 hover:text-white'}`}
            >
              Este Mês
            </button>
          </div>

          <button
            onClick={fetchOperationalData}
            disabled={loading}
            className="flex items-center gap-2 bg-purple-600 hover:bg-purple-500 text-white font-bold px-4 py-2 rounded-xl neon-purple-glow transition-all active:scale-95 shadow-md cursor-pointer disabled:opacity-50"
          >
            <span className={`material-symbols-outlined text-[18px] ${loading ? 'animate-spin' : ''}`}>
              refresh
            </span>
            <span>Atualizar</span>
          </button>

          <div className="px-3 py-2 bg-[#131722] border border-[#1e2433] rounded-xl text-slate-400">
            Sincronizado: <strong className="text-white">{lastUpdate}</strong>
          </div>
        </div>
      </section>

      {/* ERRO SUPABASE */}
      {error && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs font-mono text-rose-300 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-rose-400">warning</span>
            <span>{error}</span>
          </div>
          <button onClick={fetchOperationalData} className="px-3 py-1 bg-rose-600 text-white font-bold rounded text-[11px]">
            Tentar Novamente
          </button>
        </div>
      )}

      {/* CARDS DE KPIS OPERACIONAIS REAIS */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 font-mono">
        <div className="p-4 rounded-2xl bg-[#171b26] border border-[#1e2433] shadow-lg">
          <span className="text-[10px] text-slate-400 block font-bold uppercase">Planejadas</span>
          <span className="text-2xl font-extrabold text-white mt-1 block">{rotasPlanejadasCount}</span>
        </div>

        <div className="p-4 rounded-2xl bg-[#171b26] border border-emerald-500/30 shadow-lg">
          <span className="text-[10px] text-emerald-400 block font-bold uppercase">Concluídas</span>
          <span className="text-2xl font-extrabold text-emerald-400 mt-1 block">{concluidasCount}</span>
        </div>

        <div className="p-4 rounded-2xl bg-[#171b26] border border-amber-500/30 shadow-lg">
          <span className="text-[10px] text-amber-400 block font-bold uppercase">Em Andamento</span>
          <span className="text-2xl font-extrabold text-amber-400 mt-1 block">{iniciadasCount}</span>
        </div>

        <div className="p-4 rounded-2xl bg-[#171b26] border border-rose-500/30 shadow-lg">
          <span className="text-[10px] text-rose-400 block font-bold uppercase">Não Realizadas</span>
          <span className="text-2xl font-extrabold text-rose-400 mt-1 block">{naoRealizadasCount}</span>
        </div>

        <div className="p-4 rounded-2xl bg-[#171b26] border border-purple-500/40 shadow-lg">
          <span className="text-[10px] text-purple-300 block font-bold uppercase">% Taxa Execução</span>
          <span className="text-2xl font-extrabold text-purple-300 mt-1 block">{taxaExecucao}%</span>
        </div>

        <div className="p-4 rounded-2xl bg-[#171b26] border border-cyan-500/30 shadow-lg">
          <span className="text-[10px] text-cyan-400 block font-bold uppercase">Fotos Enviadas</span>
          <span className="text-2xl font-extrabold text-cyan-400 mt-1 block">{totalFotos}</span>
        </div>
      </div>

      {/* SEÇÃO 2: CHECKLIST & DISTRIBUIÇÃO DE OCORRÊNCIAS */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Desempenho de Checklist */}
        <div className="p-6 rounded-2xl bg-[#171b26] border border-[#1e2433] shadow-xl space-y-4 font-mono">
          <div className="flex items-center justify-between border-b border-[#1e2433] pb-3">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <span className="material-symbols-outlined text-amber-400">fact_check</span>
              Validação de Checklist em Campo
            </h3>
            <span className="px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-xs font-bold border border-amber-500/30">
              {checklistPerc}% Conclusão
            </span>
          </div>

          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="p-3 rounded-xl bg-[#131722] border border-[#1e2433]">
              <span className="text-[10px] text-slate-400 block font-bold">TOTAL ITENS</span>
              <span className="text-xl font-extrabold text-white">{totalChecklistItems}</span>
            </div>
            <div className="p-3 rounded-xl bg-[#131722] border border-emerald-500/30">
              <span className="text-[10px] text-emerald-400 block font-bold">CONCLUÍDOS</span>
              <span className="text-xl font-extrabold text-emerald-400">{totalChecklistChecked}</span>
            </div>
            <div className="p-3 rounded-xl bg-[#131722] border border-slate-700">
              <span className="text-[10px] text-slate-400 block font-bold">PENDENTES</span>
              <span className="text-xl font-extrabold text-slate-300">{totalChecklistItems - totalChecklistChecked}</span>
            </div>
          </div>

          <div className="w-full bg-[#10141f] h-3 rounded-full overflow-hidden p-0.5 border border-[#1e2433]">
            <div
              className="bg-gradient-to-r from-amber-500 to-emerald-400 h-2 rounded-full transition-all duration-500"
              style={{ width: `${checklistPerc}%` }}
            />
          </div>
        </div>

        {/* Distribuição por Tipo de Ocorrência */}
        <div className="p-6 rounded-2xl bg-[#171b26] border border-[#1e2433] shadow-xl space-y-4 font-mono">
          <div className="flex items-center justify-between border-b border-[#1e2433] pb-3">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <span className="material-symbols-outlined text-rose-400">report_problem</span>
              Incidentes &amp; Rupturas ({totalOcorrencias})
            </h3>
            <span className="text-xs text-rose-300 font-bold">Total Registrado</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div className="p-3 rounded-xl bg-rose-950/20 border border-rose-500/30">
              <span className="text-[10px] text-rose-400 block font-bold uppercase">Rupturas</span>
              <span className="text-xl font-extrabold text-rose-300">{ocorrenciasPorTipo.ruptura}</span>
            </div>

            <div className="p-3 rounded-xl bg-amber-950/20 border border-amber-500/30">
              <span className="text-[10px] text-amber-400 block font-bold uppercase">Preço Div.</span>
              <span className="text-xl font-extrabold text-amber-300">{ocorrenciasPorTipo.preco_divergente}</span>
            </div>

            <div className="p-3 rounded-xl bg-cyan-950/20 border border-cyan-500/30">
              <span className="text-[10px] text-cyan-400 block font-bold uppercase">Falta Espaço</span>
              <span className="text-xl font-extrabold text-cyan-300">{ocorrenciasPorTipo.falta_espaco}</span>
            </div>

            <div className="p-3 rounded-xl bg-slate-900 border border-slate-700">
              <span className="text-[10px] text-slate-400 block font-bold uppercase">Outros</span>
              <span className="text-xl font-extrabold text-slate-300">{ocorrenciasPorTipo.outro}</span>
            </div>
          </div>
        </div>
      </div>

      {/* SEÇÃO 3: RANKINGS OPERACIONAIS (PROMOTORES E INDÚSTRIAS) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 font-mono text-xs">
        {/* Desempenho por Promotor */}
        <div className="p-6 rounded-2xl bg-[#171b26] border border-[#1e2433] shadow-xl space-y-4">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2 border-b border-[#1e2433] pb-3">
            <span className="material-symbols-outlined text-cyan-400">badge</span>
            Desempenho por Promotor (Atendimento Real)
          </h3>

          {rankingPromotores.length === 0 ? (
            <p className="text-slate-500 italic text-center py-6">Nenhum promotor cadastrado.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#1e2433] text-[10px] text-slate-400 uppercase">
                    <th className="py-2 px-2">Promotor</th>
                    <th className="py-2 px-2 text-center">Plan.</th>
                    <th className="py-2 px-2 text-center">Conc.</th>
                    <th className="py-2 px-2 text-center">Pend.</th>
                    <th className="py-2 px-2 text-right">Taxa</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e2433]">
                  {rankingPromotores.map((p) => (
                    <tr key={p.matricula} className="hover:bg-[#131722]/50">
                      <td className="py-2.5 px-2 font-bold text-white">
                        {p.nome}
                        <span className="text-[10px] text-slate-500 block">Mat: {p.matricula}</span>
                      </td>
                      <td className="py-2.5 px-2 text-center text-slate-300">{p.planejadas}</td>
                      <td className="py-2.5 px-2 text-center font-bold text-emerald-400">{p.concluidas}</td>
                      <td className="py-2.5 px-2 text-center text-amber-300">{p.pendentes}</td>
                      <td className="py-2.5 px-2 text-right font-bold text-purple-300">{p.taxa}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Desempenho por Indústria */}
        <div className="p-6 rounded-2xl bg-[#171b26] border border-[#1e2433] shadow-xl space-y-4">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2 border-b border-[#1e2433] pb-3">
            <span className="material-symbols-outlined text-purple-400">factory</span>
            Cobertura por Indústria Parceira
          </h3>

          {rankingIndustrias.length === 0 ? (
            <p className="text-slate-500 italic text-center py-6">Nenhuma indústria cadastrada.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#1e2433] text-[10px] text-slate-400 uppercase">
                    <th className="py-2 px-2">Indústria</th>
                    <th className="py-2 px-2 text-center">Plan.</th>
                    <th className="py-2 px-2 text-center">Conc.</th>
                    <th className="py-2 px-2 text-right">Ocorrências</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e2433]">
                  {rankingIndustrias.map((ind) => (
                    <tr key={ind.codigo} className="hover:bg-[#131722]/50">
                      <td className="py-2.5 px-2 font-bold text-purple-300">{ind.nome}</td>
                      <td className="py-2.5 px-2 text-center text-slate-300">{ind.planejadas}</td>
                      <td className="py-2.5 px-2 text-center font-bold text-emerald-400">{ind.concluidas}</td>
                      <td className="py-2.5 px-2 text-right font-bold text-rose-400">{ind.ocorrencias}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* SEÇÃO 4: OCORRÊNCIAS CRÍTICAS RECENTES */}
      {listaOcorrenciasCriticas.length > 0 && (
        <section className="bg-[#171b26] border border-rose-500/30 rounded-2xl p-6 shadow-2xl space-y-3 font-mono text-xs">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <span className="material-symbols-outlined text-rose-400">warning</span>
            Últimas Ocorrências Críticas Registradas em Campo ({listaOcorrenciasCriticas.length})
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {listaOcorrenciasCriticas.slice(0, 6).map((occ) => (
              <div key={occ.id} className="p-3.5 rounded-xl bg-[#131722] border border-rose-500/20 space-y-1">
                <div className="flex justify-between items-center text-[10px]">
                  <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 font-bold uppercase">
                    {occ.tipo.replace('_', ' ')}
                  </span>
                  {occ.dataHora && (
                    <span className="text-slate-500">
                      {new Date(occ.dataHora).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </div>
                <div className="font-bold text-white truncate">{occ.loja}</div>
                <div className="text-slate-400 text-[11px] truncate">Ind: {occ.industria} • Promotor: {occ.promotor}</div>
                <p className="text-slate-300 text-[11px] pt-1">{occ.descricao}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* FILTROS E TABELA DE VISITAS */}
      <section className="bg-[#171b26] border border-[#1e2433] rounded-2xl p-6 shadow-2xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono flex items-center gap-2">
            <span className="material-symbols-outlined text-purple-400">checklist</span>
            Visitas Registradas ({filteredVisits.length})
          </h3>

          <div className="flex flex-wrap items-center gap-3 font-mono text-xs">
            <input
              type="text"
              value={tableSearch}
              onChange={(e) => setTableSearch(e.target.value)}
              placeholder="Buscar por promotor, loja ou indústria..."
              className="h-9 px-3 bg-[#131722] border border-[#1e2433] rounded-xl text-slate-200 focus:outline-none focus:border-purple-500 min-w-[240px]"
            />

            <select
              value={tableStatus}
              onChange={(e) => setTableStatus(e.target.value)}
              className="h-9 px-3 bg-[#131722] border border-[#1e2433] rounded-xl text-slate-200 focus:outline-none focus:border-purple-500"
            >
              <option value="all">Status: Todos</option>
              <option value="em_andamento">Em Andamento</option>
              <option value="concluida">Concluída</option>
              <option value="nao_realizada">Não Realizada</option>
              <option value="pendente">Pendente</option>
            </select>
          </div>
        </div>

        {/* LOADING */}
        {loading && (
          <div className="py-16 text-center space-y-3 font-mono">
            <div className="w-10 h-10 border-4 border-purple-500/20 border-t-purple-500 rounded-full animate-spin mx-auto"></div>
            <p className="text-xs text-slate-400">Carregando telemetria de visitas do Supabase...</p>
          </div>
        )}

        {/* VAZIO */}
        {!loading && filteredVisits.length === 0 && (
          <div className="py-16 text-center space-y-3 font-mono">
            <div className="w-14 h-14 rounded-full bg-[#131722] border border-[#1e2433] flex items-center justify-center text-slate-500 mx-auto">
              <span className="material-symbols-outlined text-3xl">inbox</span>
            </div>
            <h4 className="text-sm font-bold text-white">Nenhuma Visita Encontrada</h4>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              Não foram encontradas visitas de campo registradas. O promotor pode iniciar os atendimentos pelo <strong>Portal do Promotor</strong>.
            </p>
          </div>
        )}

        {/* TABELA REALS */}
        {!loading && filteredVisits.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-[#1e2433]">
            <table className="w-full text-left text-xs border-collapse font-mono">
              <thead>
                <tr className="bg-[#131722] border-b border-[#1e2433] text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  <th className="py-3.5 px-4">Promotor</th>
                  <th className="py-3.5 px-4">Loja / PDV</th>
                  <th className="py-3.5 px-4">Indústria</th>
                  <th className="py-3.5 px-4">Início / Fim</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4">Checklist / Fotos</th>
                  <th className="py-3.5 px-4 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1e2433] text-slate-300">
                {filteredVisits.map((v) => (
                  <tr key={v.id} className="hover:bg-[#131722]/60 transition-colors">
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-white">{v.promotor?.nome || v.promotor_matricula}</div>
                      <div className="text-[10px] text-slate-500">Mat: {v.promotor_matricula}</div>
                    </td>

                    <td className="py-3.5 px-4">
                      <div className="font-bold text-white">{v.loja?.nome || v.loja_codigo}</div>
                      <div className="text-[10px] text-slate-500">{v.loja?.cidade || '—'}</div>
                    </td>

                    <td className="py-3.5 px-4 font-bold text-purple-300">
                      {v.industria?.nome || v.industria_codigo}
                    </td>

                    <td className="py-3.5 px-4 text-slate-400 text-[11px]">
                      <div>Início: {v.started_at ? new Date(v.started_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'}</div>
                      <div>Fim: {v.completed_at ? new Date(v.completed_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'}</div>
                    </td>

                    <td className="py-3.5 px-4">
                      <span
                        className={`px-2.5 py-1 rounded-full text-[10px] font-bold border uppercase ${
                          v.status === 'concluida'
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                            : v.status === 'em_andamento'
                            ? 'bg-amber-500/10 text-amber-300 border-amber-500/30 animate-pulse'
                            : v.status === 'nao_realizada'
                            ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                            : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}
                      >
                        {v.status.replace('_', ' ')}
                      </span>
                    </td>

                    <td className="py-3.5 px-4 text-slate-300 text-[11px]">
                      <div>Checklist: {v.checklist_items?.filter((c) => c.checked).length || 0} ok</div>
                      <div>Fotos: {v.photos?.length || 0} anexadas</div>
                    </td>

                    <td className="py-3.5 px-4 text-right">
                      <button
                        onClick={() => setSelectedVisit(v)}
                        className="p-1.5 rounded-lg bg-[#131722] hover:bg-[#1f2433] text-cyan-300 border border-[#1e2433] cursor-pointer"
                        title="Ver Detalhes da Visita"
                      >
                        <span className="material-symbols-outlined text-[16px]">visibility</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* MODAL DETALHE COMPLETO DA VISITA */}
      {selectedVisit && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#171b26] border border-[#1e2433] rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-6 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-[#1e2433] pb-4">
              <div className="flex items-center gap-2 font-mono">
                <span className="material-symbols-outlined text-purple-400 text-xl">assignment</span>
                <h3 className="text-base font-bold text-white">
                  Ficha Completa da Visita ({selectedVisit.id.substring(0, 8)})
                </h3>
              </div>
              <button onClick={() => setSelectedVisit(null)} className="text-slate-400 hover:text-white">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs font-mono">
              <div className="p-3 rounded-xl bg-[#131722] border border-[#1e2433]">
                <span className="text-slate-500 block">PROMOTOR:</span>
                <span className="text-white font-bold">{selectedVisit.promotor?.nome || selectedVisit.promotor_matricula}</span>
              </div>

              <div className="p-3 rounded-xl bg-[#131722] border border-[#1e2433]">
                <span className="text-slate-500 block">LOJA / PDV:</span>
                <span className="text-white font-bold">{selectedVisit.loja?.nome || selectedVisit.loja_codigo}</span>
              </div>

              <div className="p-3 rounded-xl bg-[#131722] border border-[#1e2433]">
                <span className="text-slate-500 block">INDÚSTRIA:</span>
                <span className="text-purple-300 font-bold">{selectedVisit.industria?.nome || selectedVisit.industria_codigo}</span>
              </div>

              <div className="p-3 rounded-xl bg-[#131722] border border-[#1e2433]">
                <span className="text-slate-500 block">STATUS DA VISITA:</span>
                <span className="text-emerald-400 font-bold uppercase">{selectedVisit.status}</span>
              </div>
            </div>

            {/* Checklist */}
            {selectedVisit.checklist_items && selectedVisit.checklist_items.length > 0 && (
              <div className="space-y-2 font-mono text-xs">
                <span className="text-slate-400 font-bold uppercase block">Itens do Checklist Validados:</span>
                <div className="space-y-1">
                  {selectedVisit.checklist_items.map((item, idx) => (
                    <div key={idx} className="p-2 rounded bg-[#131722] border border-[#1e2433] flex justify-between items-center">
                      <span className={item.checked ? 'text-emerald-300 font-bold' : 'text-slate-400'}>
                        {item.checked ? '✓' : '✗'} {item.item_label}
                      </span>
                      {item.valor_texto && <span className="text-cyan-300 font-bold">{item.valor_texto}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Ocorrências */}
            {selectedVisit.occurrences && selectedVisit.occurrences.length > 0 && (
              <div className="space-y-2 font-mono text-xs">
                <span className="text-rose-400 font-bold uppercase block">Ocorrências / Rupturas:</span>
                {selectedVisit.occurrences.map((occ, idx) => (
                  <div key={idx} className="p-2 rounded bg-rose-500/10 border border-rose-500/30 text-rose-300">
                    <strong>{occ.tipo.toUpperCase()}:</strong> {occ.descricao}
                  </div>
                ))}
              </div>
            )}

            {/* Fotos */}
            {selectedVisit.photos && selectedVisit.photos.length > 0 && (
              <div className="space-y-2 font-mono text-xs">
                <span className="text-cyan-400 font-bold uppercase block">Galeria de Fotos Anexadas:</span>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {selectedVisit.photos.map((p, idx) => (
                    <div key={idx} className="p-2 rounded bg-[#131722] border border-[#1e2433] space-y-1">
                      <span className="px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 text-[9px] font-bold block uppercase">
                        {p.tipo_foto}
                      </span>
                      <a
                        href={p.file_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-purple-400 text-[10px] underline block truncate"
                      >
                        Abrir Foto Privada
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedVisit.motivo_nao_realizada && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs font-mono text-rose-300">
                <strong>Motivo de Não Realização:</strong> {selectedVisit.motivo_nao_realizada}
              </div>
            )}

            <div className="pt-3 border-t border-[#1e2433] flex justify-end font-mono">
              <button
                onClick={() => setSelectedVisit(null)}
                className="px-5 py-2 rounded-xl bg-[#131722] hover:bg-[#1f2433] text-slate-300 border border-[#1e2433] text-xs font-semibold"
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
