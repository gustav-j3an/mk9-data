import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ScreenId, ToastMessage, AttendanceItem, RouteItem, Visit } from '../types';
import { supabase } from '../lib/supabase';
import { getLocalDateString } from '../utils/routePlanner';

interface AttendanceControlViewProps {
  onNavigate: (screen: ScreenId) => void;
  onShowToast: (toast: Omit<ToastMessage, 'id'>) => void;
}

export const AttendanceControlView: React.FC<AttendanceControlViewProps> = ({
  onNavigate,
  onShowToast
}) => {
  // Data Operacional Inicializada dinamicamente com a data local (sem desvios UTC)
  const [dateVal, setDateVal] = useState<string>(() => getLocalDateString(new Date()));

  // Dados reais carregados do Supabase
  const [items, setItems] = useState<AttendanceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtros de Busca e Visualização
  const [search, setSearch] = useState('');
  const [supervisorFilter, setSupervisorFilter] = useState('');
  const [squadFilter, setSquadFilter] = useState('');
  const [quickFilter, setQuickFilter] = useState<'all' | 'presente' | 'falta' | 'atestado' | 'sem_registro'>('all');
  const [simulateEmpty, setSimulateEmpty] = useState(false);

  // Modal para Ajuste Manual de Presença / Justificativa
  const [selectedItem, setSelectedItem] = useState<AttendanceItem | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [newStatus, setNewStatus] = useState<'presente' | 'falta' | 'atestado' | 'sem_registro'>('presente');
  const [justification, setJustification] = useState('');
  const [medicalDays, setMedicalDays] = useState(2);

  /**
   * Determina o dia da semana ('segunda', 'terca', etc.) com base na data operacional (YYYY-MM-DD local)
   */
  const getDayKeyFromDateStr = (dateStr: string): 'domingo' | 'segunda' | 'terca' | 'quarta' | 'quinta' | 'sexta' | 'sabado' => {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      const d = new Date(year, month, day);
      const dayKeys: Array<'domingo' | 'segunda' | 'terca' | 'quarta' | 'quinta' | 'sexta' | 'sabado'> = [
        'domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'
      ];
      return dayKeys[d.getDay()] || 'segunda';
    }
    return 'segunda';
  };

  /**
   * Carrega promotores, rotas ativas e visitas do dia no Supabase
   */
  const fetchAttendanceData = useCallback(async () => {
    if (!supabase) {
      setError('Cliente Supabase não inicializado.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 1. Consultar promotores ativos com equipe associada
      // 2. Consultar rotas cadastradas (conforme o esquema real: não possui coluna 'status')
      // 3. Consultar visitas registradas na data operacional selecionada (data_visita = dateVal)
      const [promotoresRes, rotasRes, visitsRes] = await Promise.all([
        supabase
          .from('promotores')
          .select('id, matricula, nome, cidade, uf, telefone, equipe, supervisor, status')
          .eq('status', 'ativo')
          .not('equipe', 'is', null),
        supabase
          .from('rotas')
          .select('id, promotor_matricula, domingo, segunda, terca, quarta, quinta, sexta, sabado'),
        supabase
          .from('visits')
          .select('id, promotor_matricula, loja_codigo, status, data_visita, started_at, completed_at, motivo_nao_realizada')
          .eq('data_visita', dateVal)
      ]);

      if (promotoresRes.error) throw new Error(`Erro ao buscar promotores: ${promotoresRes.error.message}`);
      if (visitsRes.error) throw new Error(`Erro ao buscar visitas do dia: ${visitsRes.error.message}`);

      // Se houver erro específico de rotas, registrar aviso sem impedir o carregamento dos promotores
      let rawRotas: RouteItem[] = [];
      if (rotasRes.error) {
        console.warn('Aviso: Não foi possível obter escala detalhada de rotas:', rotasRes.error.message);
      } else {
        rawRotas = (rotasRes.data as unknown as RouteItem[]) || [];
      }

      const rawPromotores = promotoresRes.data || [];
      const rawVisits = (visitsRes.data as unknown as Visit[]) || [];

      // Determinar o dia da semana para checagem da escala na data selecionada
      const targetDayKey = getDayKeyFromDateStr(dateVal);

      // Indexar promotores que possuem rotas cadastradas para este dia da semana
      const scheduledMatriculas = new Set<string>();
      rawRotas.forEach((r) => {
        if (r.promotor_matricula && Boolean(r[targetDayKey as keyof RouteItem])) {
          scheduledMatriculas.add(r.promotor_matricula);
        }
      });

      // Indexar visitas do dia por matrícula do promotor
      const visitsByPromoter = new Map<string, Visit[]>();
      rawVisits.forEach((v) => {
        const list = visitsByPromoter.get(v.promotor_matricula) || [];
        list.push(v);
        visitsByPromoter.set(v.promotor_matricula, list);
      });

      // Se há rotas configuradas no sistema, escalados são aqueles com rota no dia.
      // Se ainda não há rotas cadastradas para o dia (ex: início de implantação),
      // consideramos elegíveis todos os promotores alocados em equipes ativas.
      const hasAnyRouteForDay = scheduledMatriculas.size > 0;

      const attendanceList: AttendanceItem[] = rawPromotores
        .filter((p) => {
          // Filtrar promotores cuja equipe não é vazia nem 'Nenhum'
          const eq = p.equipe ? p.equipe.trim().toLowerCase() : '';
          if (!eq || eq === 'nenhum') return false;

          // Se há rotas cadastradas para o dia, respeitar estritamente a escala da rota
          if (hasAnyRouteForDay) {
            return scheduledMatriculas.has(p.matricula);
          }
          // Caso contrário, todos os promotores com equipe alocada compõem a escala base
          return true;
        })
        .map((p) => {
          const promVisits = visitsByPromoter.get(p.matricula) || [];

          // Regra de Classificação de Presença:
          // 1. 'presente': Se possui ao menos uma visita concluída ou em andamento
          // 2. 'falta': Se todas as visitas do dia foram registradas como 'nao_realizada'
          // 3. 'sem_registro': Se não há telemetria ou as visitas continuam pendentes/sem check-in
          const hasCompleted = promVisits.some((v) => v.status === 'concluida');
          const hasInProgress = promVisits.some((v) => v.status === 'em_andamento');
          const allNotDone = promVisits.length > 0 && promVisits.every((v) => v.status === 'nao_realizada');

          let status: 'presente' | 'falta' | 'atestado' | 'sem_registro' = 'sem_registro';
          let telemetryDetail = 'Aguardando primeiro check-in no aplicativo';
          let telemetryTime = '--:--';

          if (hasCompleted || hasInProgress) {
            status = 'presente';
            const firstActive = promVisits.find((v) => v.started_at);
            if (firstActive && firstActive.started_at) {
              const dt = new Date(firstActive.started_at);
              telemetryTime = `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
              telemetryDetail = hasCompleted ? 'Atendimento concluído em loja' : 'Check-in ativo em atendimento';
            } else {
              telemetryTime = 'Confirmado';
              telemetryDetail = 'Visita registrada em campo';
            }
          } else if (allNotDone) {
            status = 'falta';
            const reason = promVisits[0]?.motivo_nao_realizada || 'Visita não realizada';
            telemetryDetail = `Atendimento não realizado: ${reason}`;
          }

          // Iniciais do nome
          const nameParts = (p.nome || '').trim().split(' ').filter(Boolean);
          const initials = nameParts.length > 1
            ? (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase()
            : (nameParts[0] ? nameParts[0].slice(0, 2).toUpperCase() : 'PR');

          return {
            id: p.id,
            promoterId: p.id,
            name: p.nome,
            initials,
            matricula: p.matricula,
            type: 'CLT',
            squad: p.equipe || 'Sem Equipe',
            supervisor: p.supervisor || 'Não atribuído',
            city: p.cidade || 'Não informada',
            state: p.uf || 'UF',
            phone: p.telefone || undefined,
            status,
            telemetryTime,
            telemetryDetail
          };
        });

      setItems(attendanceList);
    } catch (err: any) {
      console.error('Erro ao carregar dados de presença:', err);
      setError(err?.message || 'Falha ao buscar registros operacionais no Supabase.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [dateVal]);

  // Carregar dados sempre que a data operacional selecionada mudar
  useEffect(() => {
    fetchAttendanceData();
  }, [fetchAttendanceData]);

  const openStatusModal = (item: AttendanceItem) => {
    setSelectedItem(item);
    setNewStatus(item.status);
    setJustification('');
    setMedicalDays(item.medicalDays || 2);
    setModalOpen(true);
  };

  const handleSaveStatus = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem) return;

    // Atualização local do item (anotação/ajuste operacional de supervisão)
    setItems((prev) =>
      prev.map((it) => {
        if (it.id === selectedItem.id) {
          return {
            ...it,
            status: newStatus,
            telemetryDetail:
              newStatus === 'presente'
                ? 'Check-in manual aprovado pelo supervisor'
                : newStatus === 'falta'
                ? `Falta registrada: ${justification || 'Sem justificativa'}`
                : newStatus === 'atestado'
                ? `Atestado médico anexado (${medicalDays} dias)`
                : 'Aguardando validação de ponto',
            isJustified: newStatus === 'falta' ? !!justification : undefined,
            medicalNoteAttached: newStatus === 'atestado'
          };
        }
        return it;
      })
    );

    setModalOpen(false);
    onShowToast({
      title: 'Presença Atualizada',
      message: `Status de ${selectedItem.name} ajustado para ${newStatus.toUpperCase()}.`,
      type: 'success'
    });
  };

  const filteredItems = useMemo(() => {
    if (simulateEmpty) return [];

    return items.filter((item) => {
      const matchesSearch =
        item.name.toLowerCase().includes(search.toLowerCase()) ||
        item.matricula.toLowerCase().includes(search.toLowerCase()) ||
        item.city.toLowerCase().includes(search.toLowerCase());

      const matchesSupervisor =
        !supervisorFilter || item.supervisor.toLowerCase().includes(supervisorFilter.toLowerCase());

      const matchesSquad =
        !squadFilter || item.squad.toLowerCase().includes(squadFilter.toLowerCase());

      const matchesQuick =
        quickFilter === 'all' ||
        (quickFilter === 'presente' && item.status === 'presente') ||
        (quickFilter === 'falta' && item.status === 'falta') ||
        (quickFilter === 'atestado' && item.status === 'atestado') ||
        (quickFilter === 'sem_registro' && item.status === 'sem_registro');

      return matchesSearch && matchesSupervisor && matchesSquad && matchesQuick;
    });
  }, [items, search, supervisorFilter, squadFilter, quickFilter, simulateEmpty]);

  return (
    <div className="w-full px-4 lg:px-8 py-6 max-w-[1720px] mx-auto space-y-6">
      {/* Top Header HUD */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-[#171717] tracking-tight">
              Controle de Presença
            </h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#F7F6F2] border border-[#CFCDC5] text-[#171717] font-mono text-[11px]">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              Sincronizado há 1 min
            </span>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-purple-600/20 text-purple-300 border border-purple-500/30 font-mono text-[11px] font-bold uppercase">
              {items.length} promotores escalados
            </span>
          </div>
          <p className="text-xs sm:text-sm text-[#77766F]">
            Acompanhe a presença diária das equipes de trade marketing em tempo real com validação geofence e telemetria de campo.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => onShowToast({ title: 'Exportar Excel', message: 'Planilha de presenças diárias exportada.', type: 'info' })}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#F7F6F2] hover:bg-[#E4E2DB] text-cyan-300 border border-[#CFCDC5] text-xs font-semibold shadow-sm transition-all"
          >
            <span className="material-symbols-outlined text-[18px]">download</span>
            <span>Exportar Excel</span>
          </button>
          <button
            onClick={() => onNavigate('gestao-equipes')}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#222222] hover:bg-black text-white font-bold text-xs shadow-xs transition-all active:scale-95 shadow-md cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">groups</span>
            <span>Gerenciar equipes</span>
          </button>
        </div>
      </div>

      {/* Metric KPI Tiles */}
      {(() => {
        const total = items.length;
        const presentes = items.filter((i) => i.status === 'presente').length;
        const faltas = items.filter((i) => i.status === 'falta').length;
        const atestados = items.filter((i) => i.status === 'atestado').length;
        const semRegistro = items.filter((i) => i.status === 'sem_registro').length;

        const pPct = total > 0 ? ((presentes / total) * 100).toFixed(1) : '0';
        const fPct = total > 0 ? ((faltas / total) * 100).toFixed(1) : '0';
        const aPct = total > 0 ? ((atestados / total) * 100).toFixed(1) : '0';
        const sPct = total > 0 ? ((semRegistro / total) * 100).toFixed(1) : '0';

        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {/* Presentes */}
            <div className="relative overflow-hidden rounded-xl bg-[#F7F6F2] border border-[#CFCDC5] p-5 shadow-lg hover:border-emerald-500/40 transition-all">
              <div className="absolute top-0 left-0 right-0 h-1 bg-emerald-500" />
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <span className="text-[11px] font-bold text-[#77766F] uppercase tracking-wider font-mono">Presentes</span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-extrabold text-[#171717] font-mono">{presentes}</span>
                    <span className="font-mono text-xs text-emerald-400 font-semibold">({pPct}%)</span>
                  </div>
                </div>
                <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <span className="material-symbols-outlined text-2xl">check_circle</span>
                </div>
              </div>
              <div className="mt-3 pt-2 border-t border-[#CFCDC5] flex items-center justify-between text-xs text-[#77766F] font-mono">
                <span>{presentes} confirmados</span>
                <span className="text-emerald-400 font-semibold">0% vs ontem</span>
              </div>
            </div>

            {/* Faltas */}
            <div className="relative overflow-hidden rounded-xl bg-[#F7F6F2] border border-[#CFCDC5] p-5 shadow-lg hover:border-rose-500/40 transition-all">
              <div className="absolute top-0 left-0 right-0 h-1 bg-rose-500" />
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <span className="text-[11px] font-bold text-[#77766F] uppercase tracking-wider font-mono">Faltas</span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-extrabold text-[#171717] font-mono">{faltas}</span>
                    <span className="font-mono text-xs text-rose-400 font-semibold">({fPct}%)</span>
                  </div>
                </div>
                <div className="p-2 rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20">
                  <span className="material-symbols-outlined text-2xl">cancel</span>
                </div>
              </div>
              <div className="mt-3 pt-2 border-t border-[#CFCDC5] flex items-center justify-between text-xs text-[#77766F] font-mono">
                <span>{faltas} registradas</span>
                <span className="text-rose-400 font-semibold">0% vs média</span>
              </div>
            </div>

            {/* Atestados */}
            <div className="relative overflow-hidden rounded-xl bg-[#F7F6F2] border border-[#CFCDC5] p-5 shadow-lg hover:border-cyan-500/40 transition-all">
              <div className="absolute top-0 left-0 right-0 h-1 bg-cyan-400" />
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <span className="text-[11px] font-bold text-[#77766F] uppercase tracking-wider font-mono">Atestados</span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-extrabold text-[#171717] font-mono">{atestados}</span>
                    <span className="font-mono text-xs text-cyan-300 font-semibold">({aPct}%)</span>
                  </div>
                </div>
                <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  <span className="material-symbols-outlined text-2xl">clinical_notes</span>
                </div>
              </div>
              <div className="mt-3 pt-2 border-t border-[#CFCDC5] flex items-center justify-between text-xs text-[#77766F] font-mono">
                <span>{atestados} anexados</span>
                <span className="text-[#171717] font-medium">Sem variação</span>
              </div>
            </div>

            {/* Sem Registro */}
            <div className="relative overflow-hidden rounded-xl bg-[#F7F6F2] border border-[#CFCDC5] p-5 shadow-lg hover:border-purple-500/40 transition-all">
              <div className="absolute top-0 left-0 right-0 h-1 bg-slate-500" />
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <span className="text-[11px] font-bold text-[#77766F] uppercase tracking-wider font-mono">Sem Registro</span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-extrabold text-[#171717] font-mono">{semRegistro}</span>
                    <span className="font-mono text-xs text-[#77766F]">({sPct}%)</span>
                  </div>
                </div>
                <div className="p-2 rounded-lg bg-slate-800 text-[#77766F] border border-[#CFCDC5]">
                  <span className="material-symbols-outlined text-2xl">pending_actions</span>
                </div>
              </div>
              <div className="mt-3 pt-2 border-t border-[#CFCDC5] flex items-center justify-between text-xs text-[#77766F] font-mono">
                <span>Pendente de registro</span>
                <span className="text-purple-400 font-semibold">Sem dados</span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Filter & Search Bar */}
      <div className="rounded-xl bg-[#F7F6F2] border border-[#CFCDC5] p-4 shadow-md space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-3 items-center">
          {/* Date Selector */}
          <div className="lg:col-span-3 flex items-center bg-[#EAE8E2] border border-[#CFCDC5] px-3 py-2 rounded-lg text-[#171717]">
            <span className="material-symbols-outlined text-cyan-400 mr-2 text-[18px]">calendar_month</span>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-[9px] uppercase font-mono font-bold text-[#77766F]">Data Operacional</span>
              <input
                type="date"
                value={dateVal}
                onChange={(e) => setDateVal(e.target.value)}
                className="bg-transparent font-semibold text-xs text-[#171717] focus:outline-none cursor-pointer"
              />
            </div>
          </div>

          {/* Supervisor Filter */}
          <div className="lg:col-span-3 flex items-center bg-[#EAE8E2] border border-[#CFCDC5] px-3 py-2 rounded-lg">
            <span className="material-symbols-outlined text-[#77766F] mr-2 text-[18px]">badge</span>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-[9px] uppercase font-mono font-bold text-[#77766F]">Supervisor</span>
              <select
                value={supervisorFilter}
                onChange={(e) => setSupervisorFilter(e.target.value)}
                className="bg-transparent text-xs text-[#171717] focus:outline-none cursor-pointer"
              >
                <option value="" className="bg-[#F7F6F2]">Todos os Supervisores</option>
                {Array.from(new Set(items.map((i) => i.supervisor).filter(Boolean))).map((sup) => (
                  <option key={sup} value={sup} className="bg-[#F7F6F2]">{sup}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Equipe Filter */}
          <div className="lg:col-span-3 flex items-center bg-[#EAE8E2] border border-[#CFCDC5] px-3 py-2 rounded-lg">
            <span className="material-symbols-outlined text-[#77766F] mr-2 text-[18px]">hub</span>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-[9px] uppercase font-mono font-bold text-[#77766F]">Equipe Regional</span>
              <select
                value={squadFilter}
                onChange={(e) => setSquadFilter(e.target.value)}
                className="bg-transparent text-xs text-[#171717] focus:outline-none cursor-pointer"
              >
                <option value="" className="bg-[#F7F6F2]">Todas as Equipes</option>
                {Array.from(new Set(items.map((i) => i.squad).filter(Boolean))).map((sq) => (
                  <option key={sq} value={sq} className="bg-[#F7F6F2]">{sq}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Search Input */}
          <div className="lg:col-span-3 flex items-center bg-[#EAE8E2] border border-[#CFCDC5] px-3 py-2 rounded-lg">
            <span className="material-symbols-outlined text-[#77766F] mr-2 text-[18px]">search</span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar promotor, matrícula..."
              className="w-full bg-transparent text-xs text-[#171717] placeholder:text-[#5F5F5F] focus:outline-none"
            />
            {search && (
              <button onClick={() => setSearch('')} className="text-[#77766F] hover:text-white p-1">
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Filter Chips & Simulation Toggle */}
        <div className="pt-2 border-t border-[#CFCDC5] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-bold text-[#5F5F5F] uppercase tracking-wider font-mono mr-1">
              Filtro rápido:
            </span>
            <button
              onClick={() => setQuickFilter('all')}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                quickFilter === 'all'
                  ? 'bg-[#222222] text-white font-bold shadow-xs'
                  : 'bg-[#EAE8E2] text-[#222222] hover:bg-[#E4E2DB] border border-[#CFCDC5]'
              }`}
            >
              Todos ({items.length})
            </button>
            <button
              onClick={() => setQuickFilter('falta')}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                quickFilter === 'falta'
                  ? 'bg-rose-600 text-white font-bold'
                  : 'bg-[#EAE8E2] text-rose-700 hover:bg-rose-50 border border-[#CFCDC5]'
              }`}
            >
              Somente Faltas ({items.filter((i) => i.status === 'falta').length})
            </button>
            <button
              onClick={() => setQuickFilter('atestado')}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                quickFilter === 'atestado'
                  ? 'bg-[#087F9C] text-white font-bold'
                  : 'bg-[#EAE8E2] text-[#087F9C] hover:bg-cyan-50 border border-[#CFCDC5]'
              }`}
            >
              Atestados Pendentes ({items.filter((i) => i.status === 'atestado').length})
            </button>
            <button
              onClick={() => setQuickFilter('sem_registro')}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                quickFilter === 'sem_registro'
                  ? 'bg-[#5F5F5F] text-white font-bold'
                  : 'bg-[#EAE8E2] text-[#5F5F5F] hover:bg-[#E4E2DB] border border-[#CFCDC5]'
              }`}
            >
              Sem Registro ({items.filter((i) => i.status === 'sem_registro').length})
            </button>
          </div>

          <button
            onClick={() => setSimulateEmpty(!simulateEmpty)}
            className="text-cyan-400 hover:text-cyan-300 font-mono text-xs flex items-center gap-1 transition-colors"
          >
            <span className="material-symbols-outlined text-sm">
              {simulateEmpty ? 'check_circle' : 'filter_alt_off'}
            </span>
            <span>{simulateEmpty ? 'Restaurar Lista Normal' : 'Simular busca sem resultados'}</span>
          </button>
        </div>
      </div>

      {/* Main Table, Loading, Error or Empty State */}
      {loading ? (
        <div className="rounded-xl bg-[#F7F6F2] border border-[#CFCDC5] p-12 text-center shadow-xl">
          <div className="max-w-md mx-auto space-y-3 flex flex-col items-center">
            <span className="material-symbols-outlined text-4xl text-purple-600 animate-spin">sync</span>
            <h3 className="text-sm font-bold text-[#171717]">Carregando escala e registros de presença...</h3>
            <p className="text-xs text-[#77766F]">Consultando dados de promotores, rotas e visitas no Supabase.</p>
          </div>
        </div>
      ) : error ? (
        <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 p-8 text-center shadow-xl text-rose-900">
          <div className="max-w-md mx-auto space-y-2 flex flex-col items-center">
            <span className="material-symbols-outlined text-3xl text-rose-600">error</span>
            <h3 className="text-sm font-bold text-rose-800">Falha ao sincronizar presença</h3>
            <p className="text-xs text-[#5F5F5F]">{error}</p>
            <button
              onClick={fetchAttendanceData}
              className="mt-2 px-4 py-1.5 rounded-lg bg-rose-700 text-white font-semibold text-xs cursor-pointer shadow-xs"
            >
              Tentar novamente
            </button>
          </div>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="rounded-xl bg-[#F7F6F2] border border-[#CFCDC5] p-10 text-center shadow-xl">
          <div className="max-w-md mx-auto space-y-4 flex flex-col items-center">
            <div className="w-16 h-16 rounded-full bg-[#EAE8E2] border border-[#CFCDC5] flex items-center justify-center text-purple-400">
              <span className="material-symbols-outlined text-4xl">person_search</span>
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-[#171717]">Não há dados de presença cadastrados ainda.</h3>
              <p className="text-xs text-[#77766F]">
                Nenhum registro de presença ou telemetria operacional foi cadastrado ou encontrado com os filtros aplicados.
              </p>
            </div>
            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={() => {
                  setSearch('');
                  setSupervisorFilter('');
                  setSquadFilter('');
                  setQuickFilter('all');
                  setSimulateEmpty(false);
                }}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#222222] hover:bg-black text-white font-bold text-xs shadow-xs transition-all"
              >
                <span className="material-symbols-outlined text-base">restart_alt</span>
                <span>Limpar Filtros</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-xl bg-[#F7F6F2] border border-[#CFCDC5] overflow-hidden shadow-xl flex flex-col">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[980px] text-xs">
              <thead>
                <tr className="bg-[#E4E2DB] text-[#77766F] font-mono text-[10px] uppercase tracking-wider h-11 border-b border-[#CFCDC5] select-none">
                  <th className="py-3 px-4 font-semibold">Promotor / Registro</th>
                  <th className="py-3 px-4 font-semibold">Equipe</th>
                  <th className="py-3 px-4 font-semibold">Supervisor</th>
                  <th className="py-3 px-4 font-semibold">Praça / UF</th>
                  <th className="py-3 px-4 font-semibold">Status de Presença</th>
                  <th className="py-3 px-4 font-semibold">Última Telemetria</th>
                  <th className="py-3 px-4 text-right font-semibold">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#CFCDC5] text-slate-200">
                {filteredItems.map((item) => (
                  <tr key={item.id} className="hover:bg-[#E4E2DB] transition-colors group">
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${
                            item.status === 'presente'
                              ? 'bg-purple-600/30 text-purple-300 border border-purple-500/40'
                              : item.status === 'falta'
                              ? 'bg-rose-600/30 text-rose-300 border border-rose-500/40'
                              : item.status === 'atestado'
                              ? 'bg-cyan-600/30 text-cyan-300 border border-cyan-500/40'
                              : 'bg-slate-800 text-[#77766F] border border-[#CFCDC5]'
                          }`}
                        >
                          {item.initials}
                        </div>
                        <div>
                          <div className="font-bold text-[#171717] group-hover:text-purple-300 transition-colors">
                            {item.name}
                          </div>
                          <div className="font-mono text-[11px] text-[#77766F] flex items-center gap-1">
                            <span>{item.matricula}</span> •{' '}
                            <span className={item.type === 'CLT' ? 'text-emerald-400' : 'text-cyan-400'}>
                              {item.type}
                            </span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-[#222222] font-medium">{item.squad}</td>
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-1.5 text-[#222222]">
                        <span className="w-5 h-5 rounded-full bg-[#EAE8E2] border border-[#CFCDC5] flex items-center justify-center text-[10px] font-mono text-[#087F9C] font-bold">
                          {item.supervisor ? item.supervisor.split(' ').map((n) => n[0]).join('') : '--'}
                        </span>
                        <span>{item.supervisor || 'Não atribuído'}</span>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-[#5F5F5F]">{item.city}, {item.state}</td>
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-mono text-[10px] font-bold ${
                            item.status === 'presente'
                              ? 'bg-emerald-50 text-emerald-800 border border-emerald-300'
                              : item.status === 'falta'
                              ? 'bg-rose-50 text-rose-800 border border-rose-300'
                              : item.status === 'atestado'
                              ? 'bg-cyan-50 text-cyan-800 border border-cyan-300'
                              : 'bg-[#E4E2DB] border border-[#CFCDC5] text-[#5F5F5F]'
                          }`}
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-current" />
                          {item.status.toUpperCase()}
                        </span>
                        <button
                          onClick={() => openStatusModal(item)}
                          className="p-1 rounded bg-[#EAE8E2] hover:bg-[#E4E2DB] text-[#5F5F5F] hover:text-[#171717] border border-[#CFCDC5]"
                          title="Alterar status rápido"
                        >
                          <span className="material-symbols-outlined text-[14px]">edit</span>
                        </button>
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-mono text-xs text-[#171717] font-semibold">{item.telemetryTime}</div>
                      <div className="text-[11px] text-[#77766F]">{item.telemetryDetail}</div>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => onShowToast({ title: 'Espelho de Ponto', message: `Histórico biométrico de ${item.name}.`, type: 'info' })}
                          className="p-1.5 rounded-lg text-[#77766F] hover:text-cyan-400 hover:bg-[#EAE8E2]"
                          title="Espelho de Ponto"
                        >
                          <span className="material-symbols-outlined text-base">history</span>
                        </button>
                        {item.phone && (
                          <a
                            href={`https://wa.me/${item.phone.replace(/\D/g, '')}`}
                            target="_blank"
                            rel="noreferrer"
                            className="p-1.5 rounded-lg text-[#77766F] hover:text-emerald-400 hover:bg-[#EAE8E2]"
                            title="Conversar no WhatsApp"
                          >
                            <span className="material-symbols-outlined text-base">chat</span>
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Table Footer */}
          <div className="p-3 bg-[#E4E2DB] border-t border-[#CFCDC5] flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-1.5 font-mono text-[#5F5F5F]">
              <span>Exibindo</span>
              <strong className="text-[#171717]">{filteredItems.length > 0 ? `1-${filteredItems.length}` : '0'}</strong>
              <span>de</span>
              <strong className="text-[#171717]">{items.length}</strong>
              <span>promotores</span>
            </div>

            <div className="flex items-center gap-1 font-mono">
              <button disabled className="w-7 h-7 rounded bg-[#F7F6F2] border border-[#CFCDC5] text-slate-600 cursor-not-allowed flex items-center justify-center">
                <span className="material-symbols-outlined text-sm">first_page</span>
              </button>
              <button disabled className="w-7 h-7 rounded bg-[#F7F6F2] border border-[#CFCDC5] text-slate-600 cursor-not-allowed flex items-center justify-center">
                <span className="material-symbols-outlined text-sm">chevron_left</span>
              </button>
              <button className="w-7 h-7 rounded bg-[#222222] text-white font-bold shadow-xs flex items-center justify-center">1</button>
              <button disabled className="w-7 h-7 rounded bg-[#F7F6F2] border border-[#CFCDC5] text-slate-600 cursor-not-allowed flex items-center justify-center">
                <span className="material-symbols-outlined text-sm">chevron_right</span>
              </button>
              <button disabled className="w-7 h-7 rounded bg-[#F7F6F2] border border-[#CFCDC5] text-slate-600 cursor-not-allowed flex items-center justify-center">
                <span className="material-symbols-outlined text-sm">last_page</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Alterar Status de Presença */}
      {modalOpen && selectedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="relative w-full max-w-md bg-[#F7F6F2] border border-[#CFCDC5] rounded-2xl shadow-2xl p-6 overflow-hidden">
            <div className="flex items-center justify-between pb-4 border-b border-[#CFCDC5]">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-purple-600/20 text-purple-400 border border-purple-500/30 flex items-center justify-center font-bold">
                  {selectedItem.initials}
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#171717]">{selectedItem.name}</h3>
                  <p className="text-[11px] font-mono text-[#77766F]">{selectedItem.matricula} • {selectedItem.squad}</p>
                </div>
              </div>
              <button onClick={() => setModalOpen(false)} className="text-[#77766F] hover:text-white p-1">
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            <form onSubmit={handleSaveStatus} className="space-y-4 py-4 text-xs">
              <div className="space-y-1.5">
                <label className="font-bold text-[#171717]">Novo Status de Presença</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setNewStatus('presente')}
                    className={`p-2.5 rounded-lg border text-left font-bold transition-all ${
                      newStatus === 'presente'
                        ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500'
                        : 'bg-[#E4E2DB] text-[#77766F] border-[#CFCDC5]'
                    }`}
                  >
                    ✔ PRESENTE
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewStatus('falta')}
                    className={`p-2.5 rounded-lg border text-left font-bold transition-all ${
                      newStatus === 'falta'
                        ? 'bg-rose-500/20 text-rose-400 border-rose-500'
                        : 'bg-[#E4E2DB] text-[#77766F] border-[#CFCDC5]'
                    }`}
                  >
                    ✖ FALTA
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewStatus('atestado')}
                    className={`p-2.5 rounded-lg border text-left font-bold transition-all ${
                      newStatus === 'atestado'
                        ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500'
                        : 'bg-[#E4E2DB] text-[#77766F] border-[#CFCDC5]'
                    }`}
                  >
                    🏥 ATESTADO
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewStatus('sem_registro')}
                    className={`p-2.5 rounded-lg border text-left font-bold transition-all ${
                      newStatus === 'sem_registro'
                        ? 'bg-purple-500/20 text-purple-400 border-purple-500'
                        : 'bg-[#E4E2DB] text-[#77766F] border-[#CFCDC5]'
                    }`}
                  >
                    ⏳ SEM REGISTRO
                  </button>
                </div>
              </div>

              {newStatus === 'atestado' && (
                <div className="space-y-1 bg-[#E4E2DB] p-3 rounded-lg border border-[#CFCDC5]">
                  <label className="font-bold text-cyan-300">Dias de Afastamento (CID Médico)</label>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={medicalDays}
                    onChange={(e) => setMedicalDays(Number(e.target.value))}
                    className="w-full h-9 px-3 bg-[#F7F6F2] border border-[#CFCDC5] rounded-lg text-[#171717] font-mono"
                  />
                </div>
              )}

              <div className="space-y-1">
                <label className="font-bold text-[#171717]">Justificativa Operacional / Observações</label>
                <textarea
                  rows={2}
                  value={justification}
                  onChange={(e) => setJustification(e.target.value)}
                  placeholder="ex: Contato efetuado por telefone; validação de atestado médico com RH..."
                  className="w-full p-2.5 bg-[#E4E2DB] border border-[#CFCDC5] rounded-lg text-[#171717] focus:outline-none focus:border-purple-500 resize-none"
                />
              </div>

              <div className="pt-3 border-t border-[#CFCDC5] flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-[#EAE8E2] hover:bg-[#E4E2DB] text-[#171717] border border-[#CFCDC5] font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-[#222222] hover:bg-black text-white font-bold shadow-xs"
                >
                  Salvar Presença
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
