import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import type { RouteItem, ToastMessage } from '../types';

interface RoutesViewProps {
  onNavigate?: (screen: any) => void;
  onShowToast: (toast: Omit<ToastMessage, 'id'>) => void;
}

type GroupByOption = 'none' | 'promotor' | 'industria' | 'loja' | 'frequencia';
type SortByOption = 'promotor' | 'industria' | 'loja' | 'frequencia' | 'codigo';

export const RoutesView: React.FC<RoutesViewProps> = ({ onShowToast }) => {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission(['admin', 'gestor']);

  const [routes, setRoutes] = useState<RouteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtros
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedFrequencia, setSelectedFrequencia] = useState<string>('TODAS');
  const [selectedDay, setSelectedDay] = useState<string>('TODOS');
  const [selectedUF, setSelectedUF] = useState<string>('TODAS');
  const [selectedIndustria, setSelectedIndustria] = useState<string>('TODAS');
  const [selectedLoja, setSelectedLoja] = useState<string>('TODAS');
  const [selectedPromotor, setSelectedPromotor] = useState<string>('TODOS');

  // Agrupamento & Ordenação
  const [groupBy, setGroupBy] = useState<GroupByOption>('none');
  const [sortBy, setSortBy] = useState<SortByOption>('promotor');

  // Paginação simples
  const [pageSize, setPageSize] = useState<number>(50);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Modais de Visualização, Edição e Criação
  const [viewingRoute, setViewingRoute] = useState<RouteItem | null>(null);
  const [editingRoute, setEditingRoute] = useState<RouteItem | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [saving, setSaving] = useState(false);

  // State para nova rota
  const [newRouteForm, setNewRouteForm] = useState({
    codigo_rota: '',
    industria_codigo: '',
    loja_codigo: '',
    promotor_matricula: '',
    uf: 'SP',
    frequencia: 'SEMANAL' as 'SEMANAL' | 'QUINZENAL',
    segunda: false,
    terca: false,
    quarta: false,
    quinta: false,
    sexta: false,
    sabado: false,
    domingo: false,
    observacao: ''
  });

  // Opções para select na criação
  const [industriasList, setIndustriasList] = useState<{ codigo: string; nome: string }[]>([]);
  const [lojasList, setLojasList] = useState<{ codigo: string; nome: string; uf: string }[]>([]);
  const [promotoresList, setPromotoresList] = useState<{ matricula: string; nome: string }[]>([]);

  // Carregar dados de public.rotas com joins para industrias, lojas e promotores
  const fetchRoutes = async () => {
    setLoading(true);
    setError(null);

    if (!supabase) {
      setError('Cliente Supabase não inicializado.');
      setLoading(false);
      return;
    }

    try {
      const [rotasRes, indRes, lojRes, prmRes] = await Promise.all([
        supabase
          .from('rotas')
          .select(`
            *,
            industria:industrias(codigo, nome),
            loja:lojas(codigo, nome, cidade, uf),
            promotor:promotores(matricula, nome, supervisor, equipe)
          `)
          .order('created_at', { ascending: false }),
        supabase.from('industrias').select('codigo, nome').eq('status', 'ativo'),
        supabase.from('lojas').select('codigo, nome, uf').eq('status', 'ativo'),
        supabase.from('promotores').select('matricula, nome').eq('status', 'ativo')
      ]);

      if (rotasRes.error) throw rotasRes.error;

      setRoutes((rotasRes.data as unknown as RouteItem[]) || []);
      if (indRes.data) setIndustriasList(indRes.data);
      if (lojRes.data) setLojasList(lojRes.data);
      if (prmRes.data) setPromotoresList(prmRes.data);
    } catch (err: any) {
      console.error('Erro ao carregar rotas:', err);
      setError(err.message || 'Falha ao carregar rotas fixas do servidor.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRoutes();
  }, []);

  // Listas para filtros encadeados
  const availableUFs = useMemo(() => {
    const set = new Set<string>();
    routes.forEach((r) => {
      const uf = r.uf || r.loja?.uf;
      if (uf) set.add(uf.toUpperCase());
    });
    return Array.from(set).sort();
  }, [routes]);

  const availableIndustrias = useMemo(() => {
    const map = new Map<string, string>();
    routes.forEach((r) => {
      if (r.industria_codigo) {
        map.set(r.industria_codigo, r.industria?.nome || r.industria_codigo);
      }
    });
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [routes]);

  const availableLojas = useMemo(() => {
    const map = new Map<string, string>();
    routes.forEach((r) => {
      if (r.loja_codigo) {
        map.set(r.loja_codigo, r.loja?.nome || r.loja_codigo);
      }
    });
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [routes]);

  const availablePromotores = useMemo(() => {
    const map = new Map<string, string>();
    routes.forEach((r) => {
      if (r.promotor_matricula) {
        map.set(r.promotor_matricula, r.promotor?.nome || r.promotor_matricula);
      }
    });
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [routes]);

  // Resumo de métricas no topo
  const metrics = useMemo(() => {
    const totalRotas = routes.length;
    const semanais = routes.filter((r) => r.frequencia === 'SEMANAL').length;
    const quinzenais = routes.filter((r) => r.frequencia === 'QUINZENAL').length;
    const promotoresUnicos = new Set(routes.map((r) => r.promotor_matricula)).size;
    const lojasUnicas = new Set(routes.map((r) => r.loja_codigo)).size;

    return { totalRotas, semanais, quinzenais, promotoresUnicos, lojasUnicas };
  }, [routes]);

  // Filtragem e Ordenação
  const filteredAndSortedRoutes = useMemo(() => {
    let result = routes.filter((r) => {
      const term = searchTerm.toLowerCase().trim();
      if (term) {
        const indName = (r.industria?.nome || '').toLowerCase();
        const indCode = (r.industria_codigo || '').toLowerCase();
        const lojName = (r.loja?.nome || '').toLowerCase();
        const lojCode = (r.loja_codigo || '').toLowerCase();
        const prmName = (r.promotor?.nome || '').toLowerCase();
        const prmCode = (r.promotor_matricula || '').toLowerCase();
        const rCode = (r.codigo_rota || '').toLowerCase();

        const matchesSearch =
          indName.includes(term) ||
          indCode.includes(term) ||
          lojName.includes(term) ||
          lojCode.includes(term) ||
          prmName.includes(term) ||
          prmCode.includes(term) ||
          rCode.includes(term);

        if (!matchesSearch) return false;
      }

      if (selectedFrequencia !== 'TODAS' && r.frequencia !== selectedFrequencia) return false;
      if (selectedIndustria !== 'TODAS' && r.industria_codigo !== selectedIndustria) return false;
      if (selectedLoja !== 'TODAS' && r.loja_codigo !== selectedLoja) return false;
      if (selectedPromotor !== 'TODOS' && r.promotor_matricula !== selectedPromotor) return false;

      if (selectedDay !== 'TODOS') {
        const dayKey = selectedDay as keyof Pick<
          RouteItem,
          'segunda' | 'terca' | 'quarta' | 'quinta' | 'sexta' | 'sabado' | 'domingo'
        >;
        if (!r[dayKey]) return false;
      }

      if (selectedUF !== 'TODAS') {
        const routeUf = r.uf || r.loja?.uf || '';
        if (routeUf.toUpperCase() !== selectedUF) return false;
      }

      return true;
    });

    // Ordenação
    result.sort((a, b) => {
      if (sortBy === 'promotor') {
        const nameA = a.promotor?.nome || a.promotor_matricula;
        const nameB = b.promotor?.nome || b.promotor_matricula;
        return nameA.localeCompare(nameB);
      }
      if (sortBy === 'industria') {
        const nameA = a.industria?.nome || a.industria_codigo;
        const nameB = b.industria?.nome || b.industria_codigo;
        return nameA.localeCompare(nameB);
      }
      if (sortBy === 'loja') {
        const nameA = a.loja?.nome || a.loja_codigo;
        const nameB = b.loja?.nome || b.loja_codigo;
        return nameA.localeCompare(nameB);
      }
      if (sortBy === 'frequencia') {
        return a.frequencia.localeCompare(b.frequencia);
      }
      return a.codigo_rota.localeCompare(b.codigo_rota);
    });

    return result;
  }, [routes, searchTerm, selectedFrequencia, selectedDay, selectedUF, selectedIndustria, selectedLoja, selectedPromotor, sortBy]);

  // Agrupamento Opcional
  const groupedRoutes = useMemo(() => {
    if (groupBy === 'none') {
      return { 'Todas as Rotas': filteredAndSortedRoutes };
    }

    const groups: Record<string, RouteItem[]> = {};

    filteredAndSortedRoutes.forEach((r) => {
      let groupKey = 'Outros';

      if (groupBy === 'promotor') {
        groupKey = r.promotor?.nome ? `${r.promotor.nome} (${r.promotor_matricula})` : `Promotor ${r.promotor_matricula}`;
      } else if (groupBy === 'industria') {
        groupKey = r.industria?.nome ? `${r.industria.nome} (${r.industria_codigo})` : `Indústria ${r.industria_codigo}`;
      } else if (groupBy === 'loja') {
        groupKey = r.loja?.nome ? `${r.loja.nome} (${r.loja_codigo})` : `Loja ${r.loja_codigo}`;
      } else if (groupBy === 'frequencia') {
        groupKey = `Frequência ${r.frequencia}`;
      }

      if (!groups[groupKey]) groups[groupKey] = [];
      groups[groupKey].push(r);
    });

    return groups;
  }, [filteredAndSortedRoutes, groupBy]);

  // Paginação nos dados filtrados
  const totalItems = filteredAndSortedRoutes.length;
  const totalPages = Math.ceil(totalItems / pageSize) || 1;
  const paginatedRoutes = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredAndSortedRoutes.slice(start, start + pageSize);
  }, [filteredAndSortedRoutes, currentPage, pageSize]);

  // Salvar Edição
  const handleSaveEdit = async () => {
    if (!editingRoute) return;

    const { segunda, terca, quarta, quinta, sexta, sabado, domingo } = editingRoute;
    if (!segunda && !terca && !quarta && !quinta && !sexta && !sabado && !domingo) {
      onShowToast({
        title: 'Sem Dias Marcados',
        message: 'Atenção: A rota continuará salva, porém está sem nenhum dia de visita marcado.',
        type: 'warning'
      });
    }

    setSaving(true);

    try {
      if (!supabase) throw new Error('Cliente Supabase não inicializado.');

      const { error: updateErr } = await supabase
        .from('rotas')
        .update({
          frequencia: editingRoute.frequencia,
          segunda: editingRoute.segunda,
          terca: editingRoute.terca,
          quarta: editingRoute.quarta,
          quinta: editingRoute.quinta,
          sexta: editingRoute.sexta,
          sabado: editingRoute.sabado,
          domingo: editingRoute.domingo,
          observacao: editingRoute.observacao || null,
          updated_at: new Date().toISOString()
        })
        .eq('id', editingRoute.id);

      if (updateErr) throw updateErr;

      onShowToast({
        title: 'Rota Salva',
        message: `Escala da rota ${editingRoute.codigo_rota} atualizada no Supabase!`,
        type: 'success'
      });

      setEditingRoute(null);
      fetchRoutes();
    } catch (err: any) {
      console.error('Erro ao atualizar rota:', err);
      onShowToast({
        title: 'Falha ao Salvar Rota',
        message: err.message || 'Ocorreu um erro ao atualizar a rota.',
        type: 'error'
      });
    } finally {
      setSaving(false);
    }
  };

  // Salvar Nova Rota
  const handleSaveNewRoute = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!newRouteForm.industria_codigo || !newRouteForm.loja_codigo || !newRouteForm.promotor_matricula) {
      onShowToast({
        title: 'Campos Obrigatórios',
        message: 'Indústria, Loja e Promotor são campos obrigatórios.',
        type: 'warning'
      });
      return;
    }

    setSaving(true);

    try {
      if (!supabase) throw new Error('Cliente Supabase indisponível.');

      const code = newRouteForm.codigo_rota.trim() || `ROT-${newRouteForm.promotor_matricula}`;
      const payload = {
        codigo_rota: code,
        industria_codigo: newRouteForm.industria_codigo,
        loja_codigo: newRouteForm.loja_codigo,
        promotor_matricula: newRouteForm.promotor_matricula,
        uf: newRouteForm.uf,
        frequencia: newRouteForm.frequencia,
        segunda: newRouteForm.segunda,
        terca: newRouteForm.terca,
        quarta: newRouteForm.quarta,
        quinta: newRouteForm.quinta,
        sexta: newRouteForm.sexta,
        sabado: newRouteForm.sabado,
        domingo: newRouteForm.domingo,
        observacao: newRouteForm.observacao.trim() || null
      };

      const { error: insertErr } = await supabase.from('rotas').insert([payload]);
      if (insertErr) throw insertErr;

      onShowToast({
        title: 'Rota Criada',
        message: `Rota ${code} cadastrada com sucesso!`,
        type: 'success'
      });

      setShowCreateModal(false);
      fetchRoutes();
    } catch (err: any) {
      console.error(err);
      onShowToast({
        title: 'Falha ao Criar Rota',
        message: err.message || 'Não foi possível cadastrar a nova rota.',
        type: 'error'
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="w-full px-4 lg:px-8 py-6 max-w-[1720px] mx-auto space-y-8 font-sans">
      {/* HEADER PRINCIPAL */}
      <section className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#1e2433] pb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-amber-500 to-orange-600 flex items-center justify-center font-bold text-white shadow-[0_0_14px_rgba(245,158,11,0.5)]">
              <span className="material-symbols-outlined text-[20px]">alt_route</span>
            </div>
            <h1 className="text-3xl font-extrabold text-white tracking-tight">
              Escala Operacional de Rotas Fixas
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-slate-400 mt-1 max-w-3xl">
            Grade semanal de atendimento em campo por indústria, loja/PDV e promotor responsável.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchRoutes}
            disabled={loading}
            className="px-4 py-2 rounded-xl bg-[#171b26] border border-[#1e2433] text-xs font-semibold text-slate-300 hover:text-white hover:border-amber-500/40 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <span className={`material-symbols-outlined text-[18px] ${loading ? 'animate-spin' : ''}`}>
              refresh
            </span>
            <span>Atualizar Dados</span>
          </button>

          {canEdit && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs flex items-center gap-2 cursor-pointer transition-all shadow-[0_0_15px_rgba(245,158,11,0.3)]"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              <span>Nova Rota Fixa</span>
            </button>
          )}
        </div>
      </section>

      {/* CARDS DE RESUMO NO TOPO */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <div className="p-4 rounded-2xl bg-[#171b26] border border-[#1e2433] shadow-xl">
          <div className="text-[11px] font-mono text-slate-400 font-bold uppercase">Total de Rotas</div>
          <div className="text-2xl font-extrabold text-white font-mono mt-1">{metrics.totalRotas}</div>
        </div>

        <div className="p-4 rounded-2xl bg-[#171b26] border border-[#1e2433] shadow-xl">
          <div className="text-[11px] font-mono text-cyan-400 font-bold uppercase">Rotas Semanais</div>
          <div className="text-2xl font-extrabold text-cyan-400 font-mono mt-1">{metrics.semanais}</div>
        </div>

        <div className="p-4 rounded-2xl bg-[#171b26] border border-[#1e2433] shadow-xl">
          <div className="text-[11px] font-mono text-purple-400 font-bold uppercase">Rotas Quinzenais</div>
          <div className="text-2xl font-extrabold text-purple-400 font-mono mt-1">{metrics.quinzenais}</div>
        </div>

        <div className="p-4 rounded-2xl bg-[#171b26] border border-[#1e2433] shadow-xl">
          <div className="text-[11px] font-mono text-amber-400 font-bold uppercase">Promotores Ativos</div>
          <div className="text-2xl font-extrabold text-amber-400 font-mono mt-1">{metrics.promotoresUnicos}</div>
        </div>

        <div className="p-4 rounded-2xl bg-[#171b26] border border-[#1e2433] shadow-xl col-span-2 sm:col-span-1">
          <div className="text-[11px] font-mono text-emerald-400 font-bold uppercase">Lojas / PDVs Atendidos</div>
          <div className="text-2xl font-extrabold text-emerald-400 font-mono mt-1">{metrics.lojasUnicas}</div>
        </div>
      </div>

      {/* PAINEL DE CONTROLES: FILTROS COMBINÁVEIS, BUSCA, AGRUPAMENTO & ORDENAÇÃO */}
      <div className="bg-[#171b26] border border-[#1e2433] rounded-2xl p-5 shadow-2xl space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 text-xs font-mono">
          {/* Busca Rápida */}
          <div className="lg:col-span-4 relative">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-base">
              search
            </span>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Buscar código, rota, indústria, loja ou promotor..."
              className="w-full h-9 pl-9 pr-3 bg-[#131722] border border-[#1e2433] rounded-xl text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-amber-500"
            />
          </div>

          {/* Filtro Indústria */}
          <div className="lg:col-span-2">
            <select
              value={selectedIndustria}
              onChange={(e) => {
                setSelectedIndustria(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full h-9 px-2 bg-[#131722] border border-[#1e2433] rounded-xl text-slate-200 focus:outline-none focus:border-amber-500"
            >
              <option value="TODAS">Indústria: Todas</option>
              {availableIndustrias.map(([code, name]) => (
                <option key={code} value={code}>{name}</option>
              ))}
            </select>
          </div>

          {/* Filtro Loja */}
          <div className="lg:col-span-2">
            <select
              value={selectedLoja}
              onChange={(e) => {
                setSelectedLoja(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full h-9 px-2 bg-[#131722] border border-[#1e2433] rounded-xl text-slate-200 focus:outline-none focus:border-amber-500"
            >
              <option value="TODAS">Loja: Todas</option>
              {availableLojas.map(([code, name]) => (
                <option key={code} value={code}>{name}</option>
              ))}
            </select>
          </div>

          {/* Filtro Promotor */}
          <div className="lg:col-span-2">
            <select
              value={selectedPromotor}
              onChange={(e) => {
                setSelectedPromotor(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full h-9 px-2 bg-[#131722] border border-[#1e2433] rounded-xl text-slate-200 focus:outline-none focus:border-amber-500"
            >
              <option value="TODOS">Promotor: Todos</option>
              {availablePromotores.map(([mat, name]) => (
                <option key={mat} value={mat}>{name}</option>
              ))}
            </select>
          </div>

          {/* Filtro UF */}
          <div className="lg:col-span-2">
            <select
              value={selectedUF}
              onChange={(e) => {
                setSelectedUF(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full h-9 px-2 bg-[#131722] border border-[#1e2433] rounded-xl text-slate-200 focus:outline-none focus:border-amber-500"
            >
              <option value="TODAS">UF: Todas</option>
              {availableUFs.map((uf) => (
                <option key={uf} value={uf}>{uf}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Segunda Linha de Controles: Frequência, Dia, Agrupamento & Ordenação */}
        <div className="pt-3 border-t border-[#1e2433] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 text-xs font-mono">
          <div className="lg:col-span-3">
            <select
              value={selectedFrequencia}
              onChange={(e) => {
                setSelectedFrequencia(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full h-9 px-2 bg-[#131722] border border-[#1e2433] rounded-xl text-slate-200 focus:outline-none focus:border-amber-500"
            >
              <option value="TODAS">Frequência: Todas</option>
              <option value="SEMANAL">Semanal</option>
              <option value="QUINZENAL">Quinzenal</option>
            </select>
          </div>

          <div className="lg:col-span-3">
            <select
              value={selectedDay}
              onChange={(e) => {
                setSelectedDay(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full h-9 px-2 bg-[#131722] border border-[#1e2433] rounded-xl text-slate-200 focus:outline-none focus:border-amber-500"
            >
              <option value="TODOS">Dia: Qualquer dia</option>
              <option value="segunda">Segunda-feira</option>
              <option value="terca">Terça-feira</option>
              <option value="quarta">Quarta-feira</option>
              <option value="quinta">Quinta-feira</option>
              <option value="sexta">Sexta-feira</option>
              <option value="sabado">Sábado</option>
              <option value="domingo">Domingo</option>
            </select>
          </div>

          <div className="lg:col-span-3">
            <select
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as GroupByOption)}
              className="w-full h-9 px-2 bg-[#131722] border border-[#1e2433] rounded-xl text-amber-300 font-bold focus:outline-none focus:border-amber-500"
            >
              <option value="none">Agrupar por: Nenhum</option>
              <option value="promotor">Agrupar por Promotor</option>
              <option value="industria">Agrupar por Indústria</option>
              <option value="loja">Agrupar por Loja</option>
              <option value="frequencia">Agrupar por Frequência</option>
            </select>
          </div>

          <div className="lg:col-span-3">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortByOption)}
              className="w-full h-9 px-2 bg-[#131722] border border-[#1e2433] rounded-xl text-slate-200 focus:outline-none focus:border-amber-500"
            >
              <option value="promotor">Ordenar por: Promotor</option>
              <option value="industria">Ordenar por: Indústria</option>
              <option value="loja">Ordenar por: Loja</option>
              <option value="frequencia">Ordenar por: Frequência</option>
              <option value="codigo">Ordenar por: Código Rota</option>
            </select>
          </div>
        </div>
      </div>

      {/* MATRIZ / GRADE SEMANAL OPERACIONAL DE ROTAS */}
      <section className="bg-[#171b26] border border-[#1e2433] rounded-2xl p-6 shadow-2xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono flex items-center gap-2">
            <span className="material-symbols-outlined text-amber-400">grid_on</span>
            Grade Semanal de Rotas ({filteredAndSortedRoutes.length} filtradas)
          </h3>

          <div className="flex items-center gap-3 text-xs font-mono text-slate-400">
            <div className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
              <span>Visita Agendada</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-slate-600 font-bold">—</span>
              <span>Sem Visita</span>
            </div>
          </div>
        </div>

        {/* LOADING */}
        {loading && (
          <div className="py-16 text-center space-y-3">
            <div className="w-10 h-10 border-4 border-amber-500/20 border-t-amber-500 rounded-full animate-spin mx-auto"></div>
            <p className="text-xs font-mono text-slate-400">Carregando dados da grade semanal...</p>
          </div>
        )}

        {/* ERRO */}
        {!loading && error && (
          <div className="p-6 bg-rose-500/10 border border-rose-500/30 rounded-xl text-center space-y-3">
            <span className="material-symbols-outlined text-rose-400 text-3xl">warning</span>
            <h4 className="text-sm font-bold text-rose-300">Erro de Carregamento</h4>
            <p className="text-xs text-slate-400 font-mono">{error}</p>
            <button
              onClick={fetchRoutes}
              className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs cursor-pointer"
            >
              Tentar Novamente
            </button>
          </div>
        )}

        {/* VAZIO */}
        {!loading && !error && filteredAndSortedRoutes.length === 0 && (
          <div className="py-16 text-center space-y-3">
            <div className="w-14 h-14 rounded-full bg-[#131722] border border-[#1e2433] flex items-center justify-center text-slate-500 mx-auto">
              <span className="material-symbols-outlined text-3xl">search_off</span>
            </div>
            <h4 className="text-sm font-bold text-white">Nenhuma Rota Encontrada</h4>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              Não há rotas cadastradas correspondentes aos critérios selecionados.
            </p>
          </div>
        )}

        {/* TABELA / GRADE COM STICKY HEADER E STICKY FIRST COLUMN */}
        {!loading && !error && filteredAndSortedRoutes.length > 0 && (
          <div className="space-y-6">
            {Object.entries(groupedRoutes).map(([groupTitle, routeList]) => (
              <div key={groupTitle} className="space-y-2">
                {groupBy !== 'none' && (
                  <div className="px-3 py-1.5 rounded-lg bg-[#131722] border border-[#1e2433] text-xs font-bold font-mono text-amber-300 flex items-center gap-2">
                    <span className="material-symbols-outlined text-base">folder_open</span>
                    <span>{groupTitle} ({routeList.length})</span>
                  </div>
                )}

                <div className="overflow-x-auto max-h-[600px] overflow-y-auto rounded-xl border border-[#1e2433]">
                  <table className="w-full text-left text-xs border-collapse font-mono">
                    <thead className="sticky top-0 bg-[#0f131d] z-20 shadow-md">
                      <tr className="border-b border-[#1e2433] text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                        <th className="py-3 px-4 sticky left-0 bg-[#0f131d] z-30 min-w-[140px] border-r border-[#1e2433]">
                          Rota / Code
                        </th>
                        <th className="py-3 px-4 min-w-[160px]">Indústria</th>
                        <th className="py-3 px-4 min-w-[180px]">Loja / PDV</th>
                        <th className="py-3 px-4 min-w-[60px]">UF</th>
                        <th className="py-3 px-4 min-w-[180px]">Promotor</th>
                        <th className="py-3 px-4 min-w-[110px]">Frequência</th>
                        {/* GRADE SEMANAL DE SEGUNDA A DOMINGO */}
                        <th className="py-3 px-2 text-center w-12 bg-slate-900/60">SEG</th>
                        <th className="py-3 px-2 text-center w-12 bg-slate-900/60">TER</th>
                        <th className="py-3 px-2 text-center w-12 bg-slate-900/60">QUA</th>
                        <th className="py-3 px-2 text-center w-12 bg-slate-900/60">QUI</th>
                        <th className="py-3 px-2 text-center w-12 bg-slate-900/60">SEX</th>
                        <th className="py-3 px-2 text-center w-12 bg-amber-950/40 text-amber-300">SÁB</th>
                        <th className="py-3 px-2 text-center w-12 bg-rose-950/40 text-rose-300">DOM</th>
                        <th className="py-3 px-4 text-right min-w-[90px]">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1e2433] text-slate-300">
                      {routeList.map((r) => {
                        const hasNoDays =
                          !r.segunda && !r.terca && !r.quarta && !r.quinta && !r.sexta && !r.sabado && !r.domingo;
                        const missingRel = !r.industria || !r.loja || !r.promotor;
                        const ufVal = r.uf || r.loja?.uf || '-';

                        return (
                          <tr
                            key={r.id}
                            className={`hover:bg-[#131722]/80 transition-colors ${
                              hasNoDays ? 'bg-rose-950/20 border-l-4 border-l-rose-500' : ''
                            } ${missingRel ? 'bg-amber-950/10' : ''}`}
                          >
                            {/* COLUNA FIXA DA ROTA */}
                            <td className="py-3 px-4 sticky left-0 bg-[#171b26] z-10 font-bold border-r border-[#1e2433]">
                              <div className="text-amber-400 flex items-center gap-1">
                                {r.codigo_rota}
                                {hasNoDays && (
                                  <span className="material-symbols-outlined text-rose-400 text-xs" title="Nenhum dia marcado!">
                                    warning
                                  </span>
                                )}
                                {missingRel && (
                                  <span className="material-symbols-outlined text-amber-400 text-xs" title="Registro relacionado ausente no cadastro!">
                                    link_off
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* Indústria */}
                            <td className="py-3 px-4">
                              <div className="font-bold text-white truncate max-w-[150px]" title={r.industria?.nome || r.industria_codigo}>
                                {r.industria?.nome || <span className="text-amber-400 italic">{r.industria_codigo} (Não achado)</span>}
                              </div>
                              <div className="text-[10px] text-slate-500">{r.industria_codigo}</div>
                            </td>

                            {/* Loja */}
                            <td className="py-3 px-4">
                              <div className="font-bold text-white truncate max-w-[170px]" title={r.loja?.nome || r.loja_codigo}>
                                {r.loja?.nome || <span className="text-amber-400 italic">{r.loja_codigo} (Não achado)</span>}
                              </div>
                              <div className="text-[10px] text-slate-500">{r.loja_codigo}</div>
                            </td>

                            {/* UF */}
                            <td className="py-3 px-4 font-bold text-slate-200">{ufVal}</td>

                            {/* Promotor */}
                            <td className="py-3 px-4">
                              <div className="font-bold text-cyan-300 truncate max-w-[170px]" title={r.promotor?.nome || r.promotor_matricula}>
                                {r.promotor?.nome || <span className="text-amber-400 italic">{r.promotor_matricula} (Não achado)</span>}
                              </div>
                              <div className="text-[10px] text-slate-500">Mat: {r.promotor_matricula}</div>
                            </td>

                            {/* Frequência */}
                            <td className="py-3 px-4">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                                  r.frequencia === 'SEMANAL'
                                    ? 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30'
                                    : 'bg-purple-500/10 text-purple-300 border-purple-500/30'
                                }`}
                              >
                                {r.frequencia}
                              </span>
                            </td>

                            {/* GRADE SEMANAL DE 7 DIAS */}
                            {[
                              { dayKey: 'segunda', label: 'SEG' },
                              { dayKey: 'terca', label: 'TER' },
                              { dayKey: 'quarta', label: 'QUA' },
                              { dayKey: 'quinta', label: 'QUI' },
                              { dayKey: 'sexta', label: 'SEX' },
                              { dayKey: 'sabado', label: 'SÁB' },
                              { dayKey: 'domingo', label: 'DOM' }
                            ].map((day) => {
                              const marked = Boolean(r[day.dayKey as keyof RouteItem]);
                              return (
                                <td key={day.dayKey} className="py-3 px-2 text-center border-l border-[#1e2433]">
                                  {marked ? (
                                    <div className="w-6 h-6 rounded-md bg-emerald-500/20 border border-emerald-500/50 text-emerald-400 flex items-center justify-center mx-auto font-bold shadow-[0_0_8px_rgba(16,185,129,0.3)]">
                                      <span className="material-symbols-outlined text-sm">check</span>
                                    </div>
                                  ) : (
                                    <span className="text-slate-600 font-bold">—</span>
                                  )}
                                </td>
                              );
                            })}

                            {/* Ações */}
                            <td className="py-3 px-4 text-right space-x-1.5">
                              <button
                                onClick={() => setViewingRoute(r)}
                                className="p-1.5 rounded-lg bg-[#131722] hover:bg-[#1f2433] text-slate-300 hover:text-white border border-[#1e2433] cursor-pointer"
                                title="Ver Detalhes Operacionais"
                              >
                                <span className="material-symbols-outlined text-[16px]">visibility</span>
                              </button>

                              {canEdit && (
                                <button
                                  onClick={() => setEditingRoute({ ...r })}
                                  className="p-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 cursor-pointer"
                                  title="Editar Escala"
                                >
                                  <span className="material-symbols-outlined text-[16px]">edit</span>
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}

            {/* CONTROLES DE PAGINAÇÃO */}
            {groupBy === 'none' && totalPages > 1 && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-[#1e2433] font-mono text-xs text-slate-400">
                <div>
                  Exibindo página <strong className="text-white">{currentPage}</strong> de <strong className="text-white">{totalPages}</strong> ({totalItems} rotas no total)
                </div>

                <div className="flex items-center gap-2">
                  <button
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    className="px-3 py-1.5 rounded-lg bg-[#131722] border border-[#1e2433] text-slate-300 hover:text-white disabled:opacity-40 cursor-pointer"
                  >
                    Anterior
                  </button>
                  <button
                    disabled={currentPage >= totalPages}
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    className="px-3 py-1.5 rounded-lg bg-[#131722] border border-[#1e2433] text-slate-300 hover:text-white disabled:opacity-40 cursor-pointer"
                  >
                    Próxima
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* MODAL DETALHES DA ROTA */}
      {viewingRoute && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#171b26] border border-[#1e2433] rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-6">
            <div className="flex items-center justify-between border-b border-[#1e2433] pb-4">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-amber-400 text-xl">alt_route</span>
                <h3 className="text-base font-bold text-white font-mono">
                  Ficha Operacional da Rota {viewingRoute.codigo_rota}
                </h3>
              </div>
              <button onClick={() => setViewingRoute(null)} className="text-slate-400 hover:text-white">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4 text-xs font-mono">
              <div className="p-3 rounded-xl bg-[#131722] border border-[#1e2433] space-y-1">
                <span className="text-slate-500 block text-[10px]">INDÚSTRIA</span>
                <span className="text-white font-bold block">{viewingRoute.industria?.nome || viewingRoute.industria_codigo}</span>
                <span className="text-amber-400 block text-[10px]">{viewingRoute.industria_codigo}</span>
              </div>

              <div className="p-3 rounded-xl bg-[#131722] border border-[#1e2433] space-y-1">
                <span className="text-slate-500 block text-[10px]">LOJA / PDV</span>
                <span className="text-white font-bold block">{viewingRoute.loja?.nome || viewingRoute.loja_codigo}</span>
                <span className="text-cyan-400 block text-[10px]">Código: {viewingRoute.loja_codigo} • UF: {viewingRoute.uf || viewingRoute.loja?.uf || '-'}</span>
              </div>

              <div className="p-3 rounded-xl bg-[#131722] border border-[#1e2433] space-y-1">
                <span className="text-slate-500 block text-[10px]">PROMOTOR RESPONSÁVEL</span>
                <span className="text-white font-bold block">{viewingRoute.promotor?.nome || viewingRoute.promotor_matricula}</span>
                <span className="text-purple-400 block text-[10px]">Matrícula: {viewingRoute.promotor_matricula}</span>
              </div>

              <div className="p-3 rounded-xl bg-[#131722] border border-[#1e2433] space-y-1">
                <span className="text-slate-500 block text-[10px]">FREQUÊNCIA DE VISITA</span>
                <span className="text-emerald-400 font-bold block uppercase">{viewingRoute.frequencia}</span>
              </div>
            </div>

            {/* Escala semanal em 7 blocos */}
            <div className="space-y-2 font-mono">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
                Escala Semanal de Visitas:
              </span>
              <div className="grid grid-cols-7 gap-1.5 text-center">
                {[
                  { key: 'segunda', label: 'Seg' },
                  { key: 'terca', label: 'Ter' },
                  { key: 'quarta', label: 'Qua' },
                  { key: 'quinta', label: 'Qui' },
                  { key: 'sexta', label: 'Sex' },
                  { key: 'sabado', label: 'Sáb' },
                  { key: 'domingo', label: 'Dom' }
                ].map((day) => {
                  const marked = Boolean(viewingRoute[day.key as keyof RouteItem]);
                  return (
                    <div
                      key={day.key}
                      className={`p-2.5 rounded-xl border flex flex-col items-center justify-center space-y-1 ${
                        marked
                          ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300 font-bold'
                          : 'bg-[#131722] border-[#1e2433] text-slate-600'
                      }`}
                    >
                      <span className="text-[10px]">{day.label}</span>
                      <span className="material-symbols-outlined text-sm">
                        {marked ? 'check_circle' : 'cancel'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {viewingRoute.observacao && (
              <div className="p-3 rounded-xl bg-[#131722] border border-[#1e2433] space-y-1 font-mono text-xs">
                <span className="text-slate-500 text-[10px] font-bold uppercase block">Observações</span>
                <p className="text-slate-300">{viewingRoute.observacao}</p>
              </div>
            )}

            <div className="pt-3 border-t border-[#1e2433] flex justify-end">
              <button
                onClick={() => setViewingRoute(null)}
                className="px-5 py-2 rounded-xl bg-[#131722] hover:bg-[#1f2433] text-slate-300 border border-[#1e2433] text-xs font-semibold cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL EDITAR ESCALA DA ROTA */}
      {editingRoute && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#171b26] border border-[#1e2433] rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-6">
            <div className="flex items-center justify-between border-b border-[#1e2433] pb-4">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-amber-400 text-xl">edit</span>
                <h3 className="text-base font-bold text-white font-mono">
                  Editar Escala da Rota {editingRoute.codigo_rota}
                </h3>
              </div>
              <button onClick={() => setEditingRoute(null)} className="text-slate-400 hover:text-white">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="space-y-4 text-xs font-mono">
              <div className="p-3 rounded-xl bg-[#131722] border border-[#1e2433] text-slate-300 space-y-1">
                <div><span className="text-slate-500">Indústria:</span> <strong className="text-white">{editingRoute.industria?.nome || editingRoute.industria_codigo}</strong></div>
                <div><span className="text-slate-500">Loja:</span> <strong className="text-white">{editingRoute.loja?.nome || editingRoute.loja_codigo}</strong></div>
                <div><span className="text-slate-500">Promotor:</span> <strong className="text-cyan-300">{editingRoute.promotor?.nome || editingRoute.promotor_matricula}</strong></div>
              </div>

              <div>
                <label className="text-slate-300 block mb-1">FREQUÊNCIA DE VISITA</label>
                <select
                  value={editingRoute.frequencia}
                  onChange={(e) =>
                    setEditingRoute({ ...editingRoute, frequencia: e.target.value as any })
                  }
                  className="w-full h-10 px-3 bg-[#131722] border border-[#1e2433] rounded-xl text-slate-200 focus:outline-none focus:border-amber-500"
                >
                  <option value="SEMANAL">SEMANAL</option>
                  <option value="QUINZENAL">QUINZENAL</option>
                </select>
              </div>

              {/* Checkboxes de dias */}
              <div className="space-y-2">
                <label className="text-slate-300 block font-bold uppercase">
                  DIAS DA SEMANA COM VISITA:
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { key: 'segunda', label: 'Segunda' },
                    { key: 'terca', label: 'Terça' },
                    { key: 'quarta', label: 'Quarta' },
                    { key: 'quinta', label: 'Quinta' },
                    { key: 'sexta', label: 'Sexta' },
                    { key: 'sabado', label: 'Sábado' },
                    { key: 'domingo', label: 'Domingo' }
                  ].map((day) => {
                    const checked = Boolean(editingRoute[day.key as keyof RouteItem]);
                    return (
                      <label
                        key={day.key}
                        className={`p-2.5 rounded-xl border flex items-center gap-2 cursor-pointer transition-colors ${
                          checked
                            ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 font-bold'
                            : 'bg-[#131722] border-[#1e2433] text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setEditingRoute({ ...editingRoute, [day.key]: e.target.checked })
                          }
                          className="rounded border-[#1e2433] text-amber-500 focus:ring-amber-400 w-4 h-4"
                        />
                        <span>{day.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="text-slate-300 block mb-1">OBSERVAÇÕES DA ESCALA</label>
                <textarea
                  value={editingRoute.observacao || ''}
                  onChange={(e) => setEditingRoute({ ...editingRoute, observacao: e.target.value })}
                  placeholder="Observações da rota..."
                  className="w-full p-3 bg-[#131722] border border-[#1e2433] rounded-xl text-slate-200 focus:outline-none focus:border-amber-500 h-20 resize-none"
                />
              </div>
            </div>

            <div className="pt-4 border-t border-[#1e2433] flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setEditingRoute(null)}
                className="px-5 py-2 rounded-xl bg-[#131722] hover:bg-[#1f2433] text-slate-300 border border-[#1e2433] text-xs font-semibold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={saving}
                className="px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {saving ? (
                  <span>Salvando no Supabase...</span>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-sm">save</span>
                    <span>Salvar Alterações</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CRIAR NOVA ROTA FIXA */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveNewRoute}
            className="bg-[#171b26] border border-[#1e2433] rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5"
          >
            <div className="flex items-center justify-between border-b border-[#1e2433] pb-3">
              <h3 className="text-sm font-bold text-white font-mono flex items-center gap-2">
                <span className="material-symbols-outlined text-amber-400">add</span>
                Cadastrar Nova Rota Fixa
              </h3>
              <button type="button" onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-white">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-mono">
              <div className="sm:col-span-2">
                <label className="text-slate-300 block mb-1">CÓDIGO DA ROTA (OPCIONAL)</label>
                <input
                  type="text"
                  value={newRouteForm.codigo_rota}
                  onChange={(e) => setNewRouteForm({ ...newRouteForm, codigo_rota: e.target.value })}
                  placeholder="Ex: ROT-PRM-001 (Gerado automaticamente se vazio)"
                  className="w-full h-10 px-3 bg-[#131722] border border-[#1e2433] rounded-xl text-slate-200 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="text-slate-300 block mb-1">INDÚSTRIA (*)</label>
                <select
                  required
                  value={newRouteForm.industria_codigo}
                  onChange={(e) => setNewRouteForm({ ...newRouteForm, industria_codigo: e.target.value })}
                  className="w-full h-10 px-3 bg-[#131722] border border-[#1e2433] rounded-xl text-slate-200 focus:outline-none focus:border-amber-500"
                >
                  <option value="">Selecione a Indústria</option>
                  {industriasList.map((i) => (
                    <option key={i.codigo} value={i.codigo}>{i.nome} ({i.codigo})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-slate-300 block mb-1">LOJA / PDV (*)</label>
                <select
                  required
                  value={newRouteForm.loja_codigo}
                  onChange={(e) => {
                    const selected = lojasList.find((l) => l.codigo === e.target.value);
                    setNewRouteForm({
                      ...newRouteForm,
                      loja_codigo: e.target.value,
                      uf: selected?.uf || newRouteForm.uf
                    });
                  }}
                  className="w-full h-10 px-3 bg-[#131722] border border-[#1e2433] rounded-xl text-slate-200 focus:outline-none focus:border-amber-500"
                >
                  <option value="">Selecione a Loja</option>
                  {lojasList.map((l) => (
                    <option key={l.codigo} value={l.codigo}>{l.nome} ({l.codigo})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-slate-300 block mb-1">PROMOTOR (*)</label>
                <select
                  required
                  value={newRouteForm.promotor_matricula}
                  onChange={(e) => setNewRouteForm({ ...newRouteForm, promotor_matricula: e.target.value })}
                  className="w-full h-10 px-3 bg-[#131722] border border-[#1e2433] rounded-xl text-slate-200 focus:outline-none focus:border-amber-500"
                >
                  <option value="">Selecione o Promotor</option>
                  {promotoresList.map((p) => (
                    <option key={p.matricula} value={p.matricula}>{p.nome} ({p.matricula})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-slate-300 block mb-1">FREQUÊNCIA (*)</label>
                <select
                  value={newRouteForm.frequencia}
                  onChange={(e) => setNewRouteForm({ ...newRouteForm, frequencia: e.target.value as any })}
                  className="w-full h-10 px-3 bg-[#131722] border border-[#1e2433] rounded-xl text-slate-200 focus:outline-none focus:border-amber-500"
                >
                  <option value="SEMANAL">SEMANAL</option>
                  <option value="QUINZENAL">QUINZENAL</option>
                </select>
              </div>

              <div className="sm:col-span-2 space-y-2">
                <label className="text-slate-300 block font-bold uppercase">DIAS DE ATENDIMENTO:</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { key: 'segunda', label: 'Segunda' },
                    { key: 'terca', label: 'Terça' },
                    { key: 'quarta', label: 'Quarta' },
                    { key: 'quinta', label: 'Quinta' },
                    { key: 'sexta', label: 'Sexta' },
                    { key: 'sabado', label: 'Sábado' },
                    { key: 'domingo', label: 'Domingo' }
                  ].map((day) => {
                    const checked = Boolean(newRouteForm[day.key as keyof typeof newRouteForm]);
                    return (
                      <label
                        key={day.key}
                        className={`p-2.5 rounded-xl border flex items-center gap-2 cursor-pointer ${
                          checked ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 font-bold' : 'bg-[#131722] border-[#1e2433] text-slate-400'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => setNewRouteForm({ ...newRouteForm, [day.key]: e.target.checked })}
                          className="rounded border-[#1e2433] text-amber-500 focus:ring-amber-400 w-4 h-4"
                        />
                        <span>{day.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-[#1e2433] flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 rounded-xl bg-[#131722] hover:bg-[#1f2433] text-slate-300 border border-[#1e2433] text-xs font-semibold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {saving ? (
                  <span>Cadastrando...</span>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-sm">save</span>
                    <span>Criar Rota</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
