import React, { useState, useEffect, useCallback } from 'react';
import { ScreenId, ToastMessage, Visit } from '../types';
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

  const [visits, setVisits] = useState<Visit[]>([]);
  const [tableSearch, setTableSearch] = useState('');
  const [tableStatus, setTableStatus] = useState<string>('all');
  const [selectedVisit, setSelectedVisit] = useState<Visit | null>(null);

  // Métrica de última atualização
  const [lastUpdate, setLastUpdate] = useState('—');

  // Carregar dados de visitas do Supabase
  const fetchOperationalData = useCallback(async () => {
    setLoading(true);
    setError(null);

    if (!supabase) {
      setError('Cliente Supabase não inicializado.');
      setLoading(false);
      return;
    }

    try {
      const todayStr = new Date().toISOString().split('T')[0];

      // Query para buscar todas as visitas reais de hoje com joins
      const { data, error: fetchErr } = await supabase
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

      if (fetchErr) throw fetchErr;

      const realVisits = (data as unknown as Visit[]) || [];
      setVisits(realVisits);
      setLastUpdate(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    } catch (err: any) {
      console.error('Erro ao carregar dados do Painel Operacional:', err);
      setError(err.message || 'Falha ao carregar visitas reais do servidor.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOperationalData();
  }, [fetchOperationalData]);

  // Cálculo de Métricas Reais
  const totalVisitas = visits.length;
  const iniciadasCount = visits.filter((v) => v.status === 'em_andamento').length;
  const concluidasCount = visits.filter((v) => v.status === 'concluida').length;
  const naoRealizadasCount = visits.filter((v) => v.status === 'nao_realizada').length;
  const pendentesCount = visits.filter((v) => v.status === 'pendente').length;

  let totalFotos = 0;
  let totalRupturas = 0;
  let totalPendencias = 0;

  visits.forEach((v) => {
    if (v.photos) totalFotos += v.photos.length;
    if (v.occurrences) {
      v.occurrences.forEach((occ) => {
        if (occ.tipo === 'ruptura') totalRupturas++;
        if (!occ.resolvido) totalPendencias++;
      });
    }
  });

  // Filtragem da tabela
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
              PAINEL AO VIVO (SUPABASE REALTIME)
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Painel Operacional de Trade Marketing
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 max-w-3xl">
            Monitoramento das visitas de campo registradas pelos promotores via Portal do Promotor.
          </p>
        </div>

        {/* Action Bar */}
        <div className="flex flex-wrap items-center gap-3 z-10 font-mono text-xs">
          <button
            onClick={fetchOperationalData}
            disabled={loading}
            className="flex items-center gap-2 bg-purple-600 hover:bg-purple-500 text-white font-bold px-4 py-2 rounded-xl neon-purple-glow transition-all active:scale-95 shadow-md cursor-pointer disabled:opacity-50"
          >
            <span className={`material-symbols-outlined text-[18px] ${loading ? 'animate-spin' : ''}`}>
              refresh
            </span>
            <span>Atualizar Painel</span>
          </button>

          <div className="px-3 py-2 bg-[#131722] border border-[#1e2433] rounded-xl text-slate-400">
            Última Sincronização: <strong className="text-white">{lastUpdate}</strong>
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

      {/* CARDS DE RESUMO DE VISITAS REAIS */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3 font-mono">
        <div className="p-4 rounded-xl bg-[#171b26] border border-[#1e2433] shadow-lg">
          <span className="text-[10px] text-slate-400 block font-bold">VISITAS TOTAIS</span>
          <span className="text-2xl font-extrabold text-white mt-1 block">{totalVisitas}</span>
        </div>

        <div className="p-4 rounded-xl bg-[#171b26] border border-amber-500/30 shadow-lg">
          <span className="text-[10px] text-amber-400 block font-bold">EM ANDAMENTO</span>
          <span className="text-2xl font-extrabold text-amber-400 mt-1 block">{iniciadasCount}</span>
        </div>

        <div className="p-4 rounded-xl bg-[#171b26] border border-emerald-500/30 shadow-lg">
          <span className="text-[10px] text-emerald-400 block font-bold">CONCLUÍDAS</span>
          <span className="text-2xl font-extrabold text-emerald-400 mt-1 block">{concluidasCount}</span>
        </div>

        <div className="p-4 rounded-xl bg-[#171b26] border border-rose-500/30 shadow-lg">
          <span className="text-[10px] text-rose-400 block font-bold">NÃO REALIZADAS</span>
          <span className="text-2xl font-extrabold text-rose-400 mt-1 block">{naoRealizadasCount}</span>
        </div>

        <div className="p-4 rounded-xl bg-[#171b26] border border-cyan-500/30 shadow-lg">
          <span className="text-[10px] text-cyan-400 block font-bold">FOTOS ENVIADAS</span>
          <span className="text-2xl font-extrabold text-cyan-400 mt-1 block">{totalFotos}</span>
        </div>

        <div className="p-4 rounded-xl bg-[#171b26] border border-rose-500/30 shadow-lg">
          <span className="text-[10px] text-rose-300 block font-bold">RUPTURAS</span>
          <span className="text-2xl font-extrabold text-rose-300 mt-1 block">{totalRupturas}</span>
        </div>

        <div className="p-4 rounded-xl bg-[#171b26] border border-purple-500/30 shadow-lg col-span-2 sm:col-span-1">
          <span className="text-[10px] text-purple-300 block font-bold">PENDÊNCIAS</span>
          <span className="text-2xl font-extrabold text-purple-300 mt-1 block">{totalPendencias}</span>
        </div>
      </div>

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
