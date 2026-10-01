import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import type { RouteItem, ToastMessage } from '../types';

interface RoutesViewProps {
  onNavigate?: (screen: any) => void;
  onShowToast: (toast: Omit<ToastMessage, 'id'>) => void;
}

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

  // Modais de Visualização e Edição
  const [viewingRoute, setViewingRoute] = useState<RouteItem | null>(null);
  const [editingRoute, setEditingRoute] = useState<RouteItem | null>(null);
  const [saving, setSaving] = useState(false);

  // Busca dados de public.rotas com joins para industrias, lojas e promotores
  const fetchRoutes = async () => {
    setLoading(true);
    setError(null);

    if (!supabase) {
      setError('Cliente Supabase não inicializado.');
      setLoading(false);
      return;
    }

    try {
      const { data, error: fetchErr } = await supabase
        .from('rotas')
        .select(`
          *,
          industria:industrias(codigo, nome),
          loja:lojas(codigo, nome, cidade, uf),
          promotor:promotores(matricula, nome, supervisor, equipe)
        `)
        .order('created_at', { ascending: false });

      if (fetchErr) {
        throw fetchErr;
      }

      setRoutes((data as unknown as RouteItem[]) || []);
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

  // Lista de UFs únicas disponíveis nos dados
  const availableUFs = useMemo(() => {
    const ufs = new Set<string>();
    routes.forEach((r) => {
      const ufVal = r.uf || r.loja?.uf;
      if (ufVal) ufs.add(ufVal.toUpperCase());
    });
    return Array.from(ufs).sort();
  }, [routes]);

  // Filtragem local
  const filteredRoutes = useMemo(() => {
    return routes.filter((r) => {
      // Busca textual (indústria código/nome, loja código/nome, promotor matrícula/nome, código rota)
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

      // Filtro Frequência
      if (selectedFrequencia !== 'TODAS' && r.frequencia !== selectedFrequencia) {
        return false;
      }

      // Filtro Dia da semana
      if (selectedDay !== 'TODOS') {
        const dayKey = selectedDay as keyof Pick<
          RouteItem,
          'segunda' | 'terca' | 'quarta' | 'quinta' | 'sexta' | 'sabado' | 'domingo'
        >;
        if (!r[dayKey]) return false;
      }

      // Filtro UF
      if (selectedUF !== 'TODAS') {
        const routeUf = r.uf || r.loja?.uf || '';
        if (routeUf.toUpperCase() !== selectedUF) return false;
      }

      return true;
    });
  }, [routes, searchTerm, selectedFrequencia, selectedDay, selectedUF]);

  // Handler para salvar edição
  const handleSaveEdit = async () => {
    if (!editingRoute) return;

    // Verificar se pelo menos um dia está marcado
    const { segunda, terca, quarta, quinta, sexta, sabado, domingo } = editingRoute;
    if (!segunda && !terca && !quarta && !quinta && !sexta && !sabado && !domingo) {
      onShowToast({
        title: 'Dia da Semana Obrigatório',
        message: 'Por favor, selecione pelo menos um dia de visita para a rota.',
        type: 'warning'
      });
      return;
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
        title: 'Rota Atualizada',
        message: `Escala de visita da rota ${editingRoute.codigo_rota} salva com sucesso!`,
        type: 'success'
      });

      // Atualizar lista local
      setRoutes((prev) =>
        prev.map((r) => (r.id === editingRoute.id ? { ...editingRoute } : r))
      );
      setEditingRoute(null);
    } catch (err: any) {
      console.error('Erro ao atualizar rota:', err);
      onShowToast({
        title: 'Falha ao Salvar Rota',
        message: err.message || 'Ocorreu um erro ao atualizar os dados da rota no servidor.',
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
              Gestão de Rotas Fixas
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-slate-400 mt-1 max-w-3xl">
            Escalas operacionais de atendimento dos promotores de campo por indústria, loja e frequência semanal.
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
        </div>
      </section>

      {/* CARDS DE RESUMO OPERACIONAL */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <div className="p-5 rounded-2xl bg-[#171b26] border border-[#1e2433] shadow-xl">
          <div className="flex items-center justify-between text-slate-400 font-mono text-xs">
            <span>TOTAL DE ROTAS CADASTRADAS</span>
            <span className="material-symbols-outlined text-amber-400">route</span>
          </div>
          <div className="text-3xl font-extrabold text-white font-mono mt-2">{routes.length}</div>
        </div>

        <div className="p-5 rounded-2xl bg-[#171b26] border border-[#1e2433] shadow-xl">
          <div className="flex items-center justify-between text-slate-400 font-mono text-xs">
            <span>ROTAS SEMANAIS</span>
            <span className="material-symbols-outlined text-cyan-400">calendar_view_week</span>
          </div>
          <div className="text-3xl font-extrabold text-cyan-400 font-mono mt-2">
            {routes.filter((r) => r.frequencia === 'SEMANAL').length}
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-[#171b26] border border-[#1e2433] shadow-xl">
          <div className="flex items-center justify-between text-slate-400 font-mono text-xs">
            <span>ROTAS QUINZENAIS</span>
            <span className="material-symbols-outlined text-purple-400">date_range</span>
          </div>
          <div className="text-3xl font-extrabold text-purple-400 font-mono mt-2">
            {routes.filter((r) => r.frequencia === 'QUINZENAL').length}
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-[#171b26] border border-[#1e2433] shadow-xl">
          <div className="flex items-center justify-between text-slate-400 font-mono text-xs">
            <span>FILTRADAS NA EXIBIÇÃO</span>
            <span className="material-symbols-outlined text-emerald-400">filter_alt</span>
          </div>
          <div className="text-3xl font-extrabold text-emerald-400 font-mono mt-2">
            {filteredRoutes.length}
          </div>
        </div>
      </div>

      {/* BARRA DE FILTROS & BUSCA */}
      <div className="bg-[#171b26] border border-[#1e2433] rounded-2xl p-5 shadow-2xl space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-4">
          {/* Busca Textual */}
          <div className="lg:col-span-4 relative">
            <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-lg">
              search
            </span>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por Indústria, Loja, Promotor ou Rota..."
              className="w-full h-10 pl-10 pr-4 bg-[#131722] border border-[#1e2433] rounded-xl text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-amber-500 transition-all"
            />
          </div>

          {/* Filtro por Frequência */}
          <div className="lg:col-span-3">
            <select
              value={selectedFrequencia}
              onChange={(e) => setSelectedFrequencia(e.target.value)}
              className="w-full h-10 px-3 bg-[#131722] border border-[#1e2433] rounded-xl text-xs text-slate-200 focus:outline-none focus:border-amber-500 font-mono"
            >
              <option value="TODAS">Frequência: Todas</option>
              <option value="SEMANAL">Semanal</option>
              <option value="QUINZENAL">Quinzenal</option>
            </select>
          </div>

          {/* Filtro por Dia da Semana */}
          <div className="lg:col-span-3">
            <select
              value={selectedDay}
              onChange={(e) => setSelectedDay(e.target.value)}
              className="w-full h-10 px-3 bg-[#131722] border border-[#1e2433] rounded-xl text-xs text-slate-200 focus:outline-none focus:border-amber-500 font-mono"
            >
              <option value="TODOS">Dia da Semana: Todos</option>
              <option value="segunda">Segunda-feira</option>
              <option value="terca">Terça-feira</option>
              <option value="quarta">Quarta-feira</option>
              <option value="quinta">Quinta-feira</option>
              <option value="sexta">Sexta-feira</option>
              <option value="sabado">Sábado</option>
              <option value="domingo">Domingo</option>
            </select>
          </div>

          {/* Filtro por UF */}
          <div className="lg:col-span-2">
            <select
              value={selectedUF}
              onChange={(e) => setSelectedUF(e.target.value)}
              className="w-full h-10 px-3 bg-[#131722] border border-[#1e2433] rounded-xl text-xs text-slate-200 focus:outline-none focus:border-amber-500 font-mono"
            >
              <option value="TODAS">UF: Todas</option>
              {availableUFs.map((uf) => (
                <option key={uf} value={uf}>{uf}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* PAINEL DA TABELA DE ROTAS FIXAS */}
      <section className="bg-[#171b26] border border-[#1e2433] rounded-2xl p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono flex items-center gap-2">
            <span className="material-symbols-outlined text-amber-400">table_chart</span>
            Lista Operacional de Rotas Fixas ({filteredRoutes.length})
          </h3>
        </div>

        {/* LOADING STATE */}
        {loading && (
          <div className="py-16 text-center space-y-3">
            <div className="w-10 h-10 border-4 border-amber-500/20 border-t-amber-500 rounded-full animate-spin mx-auto"></div>
            <p className="text-xs font-mono text-slate-400">Carregando rotas reais do Supabase...</p>
          </div>
        )}

        {/* ERROR STATE */}
        {!loading && error && (
          <div className="p-6 bg-rose-500/10 border border-rose-500/30 rounded-xl text-center space-y-3">
            <span className="material-symbols-outlined text-rose-400 text-3xl">warning</span>
            <h4 className="text-sm font-bold text-rose-300">Erro ao Carregar Rotas</h4>
            <p className="text-xs text-slate-400 font-mono">{error}</p>
            <button
              onClick={fetchRoutes}
              className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs cursor-pointer"
            >
              Tentar Novamente
            </button>
          </div>
        )}

        {/* EMPTY STATE */}
        {!loading && !error && filteredRoutes.length === 0 && (
          <div className="py-16 text-center space-y-3">
            <div className="w-14 h-14 rounded-full bg-[#131722] border border-[#1e2433] flex items-center justify-center text-slate-500 mx-auto">
              <span className="material-symbols-outlined text-3xl">search_off</span>
            </div>
            <h4 className="text-sm font-bold text-white">Nenhuma Rota Encontrada</h4>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              Não foram encontradas rotas fixas que correspondam aos filtros selecionados ou à busca efetuada.
            </p>
          </div>
        )}

        {/* DATA TABLE */}
        {!loading && !error && filteredRoutes.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-[#1e2433]">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#131722] border-b border-[#1e2433] text-[11px] font-bold text-slate-400 uppercase tracking-wider font-mono">
                  <th className="py-3.5 px-4">Rota / UF</th>
                  <th className="py-3.5 px-4">Indústria</th>
                  <th className="py-3.5 px-4">Loja / PDV</th>
                  <th className="py-3.5 px-4">Promotor</th>
                  <th className="py-3.5 px-4">Frequência</th>
                  <th className="py-3.5 px-4">Dias de Atendimento</th>
                  <th className="py-3.5 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1e2433] text-slate-300">
                {filteredRoutes.map((r) => {
                  const ufVal = r.uf || r.loja?.uf || '-';

                  return (
                    <tr key={r.id} className="hover:bg-[#131722]/60 transition-colors">
                      {/* Rota / UF */}
                      <td className="py-3.5 px-4 font-mono">
                        <div className="font-bold text-amber-400">{r.codigo_rota}</div>
                        <div className="text-[10px] text-slate-400">UF: <span className="text-slate-200 font-bold">{ufVal}</span></div>
                      </td>

                      {/* Indústria */}
                      <td className="py-3.5 px-4 font-mono">
                        <div className="font-bold text-white">{r.industria?.nome || '—'}</div>
                        <div className="text-[10px] text-slate-500">{r.industria_codigo}</div>
                      </td>

                      {/* Loja */}
                      <td className="py-3.5 px-4 font-mono">
                        <div className="font-bold text-white">{r.loja?.nome || '—'}</div>
                        <div className="text-[10px] text-slate-500">
                          {r.loja_codigo} {r.loja?.cidade ? `• ${r.loja.cidade}` : ''}
                        </div>
                      </td>

                      {/* Promotor */}
                      <td className="py-3.5 px-4 font-mono">
                        <div className="font-bold text-cyan-300">{r.promotor?.nome || '—'}</div>
                        <div className="text-[10px] text-slate-500">Mat: {r.promotor_matricula}</div>
                      </td>

                      {/* Frequência */}
                      <td className="py-3.5 px-4 font-mono">
                        <span
                          className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${
                            r.frequencia === 'SEMANAL'
                              ? 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30'
                              : 'bg-purple-500/10 text-purple-300 border-purple-500/30'
                          }`}
                        >
                          {r.frequencia}
                        </span>
                      </td>

                      {/* Chips de Dias Marcados */}
                      <td className="py-3.5 px-4">
                        <div className="flex flex-wrap gap-1">
                          {r.segunda && <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">Seg</span>}
                          {r.terca && <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">Ter</span>}
                          {r.quarta && <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">Qua</span>}
                          {r.quinta && <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">Qui</span>}
                          {r.sexta && <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">Sex</span>}
                          {r.sabado && <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">Sáb</span>}
                          {r.domingo && <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40">Dom</span>}
                        </div>
                      </td>

                      {/* Botões de Ação */}
                      <td className="py-3.5 px-4 text-right space-x-2">
                        <button
                          onClick={() => setViewingRoute(r)}
                          className="p-1.5 rounded-lg bg-[#131722] hover:bg-[#1f2433] text-slate-300 hover:text-white border border-[#1e2433] transition-colors cursor-pointer"
                          title="Visualizar Detalhes"
                        >
                          <span className="material-symbols-outlined text-[16px]">visibility</span>
                        </button>

                        {canEdit && (
                          <button
                            onClick={() => setEditingRoute({ ...r })}
                            className="p-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 transition-colors cursor-pointer"
                            title="Editar Escala da Rota"
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
        )}
      </section>

      {/* MODAL: VISUALIZAR DETALHES DA ROTA */}
      {viewingRoute && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#171b26] border border-[#1e2433] rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-6">
            <div className="flex items-center justify-between border-b border-[#1e2433] pb-4">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-amber-400 text-xl">alt_route</span>
                <h3 className="text-base font-bold text-white font-mono">
                  Detalhes da Rota {viewingRoute.codigo_rota}
                </h3>
              </div>
              <button
                onClick={() => setViewingRoute(null)}
                className="text-slate-400 hover:text-white p-1"
              >
                <span className="material-symbols-outlined text-xl">close</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4 text-xs font-mono">
              <div className="p-3 rounded-xl bg-[#131722] border border-[#1e2433] space-y-1">
                <span className="text-slate-500 block text-[10px]">INDÚSTRIA</span>
                <span className="text-white font-bold block">{viewingRoute.industria?.nome || '—'}</span>
                <span className="text-amber-400 block text-[10px]">{viewingRoute.industria_codigo}</span>
              </div>

              <div className="p-3 rounded-xl bg-[#131722] border border-[#1e2433] space-y-1">
                <span className="text-slate-500 block text-[10px]">LOJA / PDV</span>
                <span className="text-white font-bold block">{viewingRoute.loja?.nome || '—'}</span>
                <span className="text-cyan-400 block text-[10px]">{viewingRoute.loja_codigo} • UF: {viewingRoute.uf || viewingRoute.loja?.uf || '-'}</span>
              </div>

              <div className="p-3 rounded-xl bg-[#131722] border border-[#1e2433] space-y-1">
                <span className="text-slate-500 block text-[10px]">PROMOTOR RESPONSÁVEL</span>
                <span className="text-white font-bold block">{viewingRoute.promotor?.nome || '—'}</span>
                <span className="text-purple-400 block text-[10px]">Matrícula: {viewingRoute.promotor_matricula}</span>
              </div>

              <div className="p-3 rounded-xl bg-[#131722] border border-[#1e2433] space-y-1">
                <span className="text-slate-500 block text-[10px]">FREQUÊNCIA DE VISITA</span>
                <span className="text-emerald-400 font-bold block uppercase">{viewingRoute.frequencia}</span>
              </div>
            </div>

            {/* Dias da semana em grade detalhada */}
            <div className="space-y-2">
              <span className="text-xs font-bold text-slate-400 font-mono uppercase tracking-wider block">
                Escala Semanal de Atendimento:
              </span>
              <div className="grid grid-cols-7 gap-1.5 text-center font-mono">
                {[
                  { key: 'segunda', label: 'Seg' },
                  { key: 'terca', label: 'Ter' },
                  { key: 'quarta', label: 'Qua' },
                  { key: 'quinta', label: 'Qui' },
                  { key: 'sexta', label: 'Sex' },
                  { key: 'sabado', label: 'Sáb' },
                  { key: 'domingo', label: 'Dom' }
                ].map((day) => {
                  const isMarked = Boolean(viewingRoute[day.key as keyof RouteItem]);
                  return (
                    <div
                      key={day.key}
                      className={`p-2.5 rounded-xl border flex flex-col items-center justify-center space-y-1 ${
                        isMarked
                          ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                          : 'bg-[#131722] border-[#1e2433] text-slate-600'
                      }`}
                    >
                      <span className="text-[10px] font-bold">{day.label}</span>
                      <span className="material-symbols-outlined text-sm">
                        {isMarked ? 'check_circle' : 'cancel'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {viewingRoute.observacao && (
              <div className="p-3 rounded-xl bg-[#131722] border border-[#1e2433] space-y-1">
                <span className="text-slate-500 text-[10px] font-mono font-bold uppercase block">Observações</span>
                <p className="text-slate-300 text-xs font-mono">{viewingRoute.observacao}</p>
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

      {/* MODAL: EDITAR ESCALA E FREQUÊNCIA DA ROTA (ADMIN/GESTOR) */}
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
              <button
                onClick={() => setEditingRoute(null)}
                className="text-slate-400 hover:text-white p-1"
              >
                <span className="material-symbols-outlined text-xl">close</span>
              </button>
            </div>

            <div className="space-y-4 text-xs font-mono">
              {/* Info de referência */}
              <div className="p-3 rounded-xl bg-[#131722] border border-[#1e2433] text-slate-300 space-y-1">
                <div><span className="text-slate-500">Indústria:</span> <strong className="text-white">{editingRoute.industria?.nome || editingRoute.industria_codigo}</strong></div>
                <div><span className="text-slate-500">Loja:</span> <strong className="text-white">{editingRoute.loja?.nome || editingRoute.loja_codigo}</strong></div>
                <div><span className="text-slate-500">Promotor:</span> <strong className="text-cyan-300">{editingRoute.promotor?.nome || editingRoute.promotor_matricula}</strong></div>
              </div>

              {/* Frequência */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                  Frequência de Visita
                </label>
                <select
                  value={editingRoute.frequencia}
                  onChange={(e) =>
                    setEditingRoute({ ...editingRoute, frequencia: e.target.value as 'SEMANAL' | 'QUINZENAL' })
                  }
                  className="w-full h-10 px-3 bg-[#131722] border border-[#1e2433] rounded-xl text-slate-200 focus:outline-none focus:border-amber-500 font-mono"
                >
                  <option value="SEMANAL">SEMANAL</option>
                  <option value="QUINZENAL">QUINZENAL</option>
                </select>
              </div>

              {/* Dias da Semana (Checkboxes de Seleção) */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                  Dias de Atendimento (Selecione pelo menos um):
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
                            ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
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
                        <span className="font-bold text-xs">{day.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Observação */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                  Observações da Rota
                </label>
                <textarea
                  value={editingRoute.observacao || ''}
                  onChange={(e) => setEditingRoute({ ...editingRoute, observacao: e.target.value })}
                  placeholder="Informações adicionais da escala..."
                  className="w-full p-3 bg-[#131722] border border-[#1e2433] rounded-xl text-slate-200 focus:outline-none focus:border-amber-500 font-mono text-xs h-20 resize-none"
                />
              </div>
            </div>

            <div className="pt-4 border-t border-[#1e2433] flex items-center justify-end gap-3">
              <button
                onClick={() => setEditingRoute(null)}
                className="px-5 py-2 rounded-xl bg-[#131722] hover:bg-[#1f2433] text-slate-300 border border-[#1e2433] text-xs font-semibold cursor-pointer"
              >
                Cancelar
              </button>
              <button
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
    </div>
  );
};
