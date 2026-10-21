import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ScreenId, ToastMessage, RouteItem, Visit } from '../types';
import { fetchAttendance, saveAttendance, fetchAttendanceAudit, attendanceErrorMessage, type AttendanceAuditEntry } from '../lib/attendanceService';
import { AttendanceJourneyPanel } from '../components/AttendanceJourneyPanel';
import type { Promoter } from '../utils/attendanceEngine';
import { zoned, type PresenceItem, type OverrideStatus } from '../utils/attendanceEngine';
import { type PromoterOperationalSummary, type RouteExecutionStatus } from '../utils/visitActivityEngine';
import { filterPromoterSummaries, calculateOperationalMetrics, type RouteStatusFilter } from '../utils/attendanceFilters';
import * as XLSX from 'xlsx';

interface AttendanceControlViewProps {
  onNavigate: (screen: ScreenId) => void;
  onShowToast: (toast: Omit<ToastMessage, 'id'>) => void;
}

export const AttendanceControlView: React.FC<AttendanceControlViewProps> = ({
  onNavigate,
  onShowToast
}) => {
  // Data Operacional Inicializada dinamicamente com a data local (sem desvios UTC)
  const [dateVal, setDateVal] = useState<string>(() => zoned(new Date().toISOString()).date);

  // Dados carregados do Supabase
  const [items, setItems] = useState<PresenceItem[]>([]);
  const [operationalSummaries, setOperationalSummaries] = useState<PromoterOperationalSummary[]>([]);
  const [routesData, setRoutesData] = useState<RouteItem[]>([]);
  const [visitsData, setVisitsData] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtros de Busca e Visualização
  const [search, setSearch] = useState('');
  const [supervisorFilter, setSupervisorFilter] = useState('');
  // Filtro de Programação: 'com_roteiro' (padrão), 'todos', 'sem_programacao'
  const [scopeFilter, setScopeFilter] = useState<'com_roteiro' | 'todos' | 'sem_programacao'>('com_roteiro');
  // Filtro Interativo por Situação de Roteiro (Cards de Indicadores)
  const [statusFilter, setStatusFilter] = useState<RouteStatusFilter>('ALL');

  const [promoters, setPromoters] = useState<Promoter[]>([]);
  const [audit, setAudit] = useState<{ name: string; rows: AttendanceAuditEntry[] } | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [timezone, setTimezone] = useState('America/Sao_Paulo');
  const requestId = useRef(0);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Área de Configurações (Jornadas, modelos, calendário e avisos consolidados)
  const [showConfig, setShowConfig] = useState(false);

  // Detalhes do Promotor (Painel Modal Simples)
  const [detailPromoter, setDetailPromoter] = useState<PromoterOperationalSummary | null>(null);

  // Modal para Ajuste Manual de Presença / Justificativa (Legado/Auditoria)
  const [selectedItem, setSelectedItem] = useState<PresenceItem | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [newStatus, setNewStatus] = useState<OverrideStatus>('presente');
  const [justification, setJustification] = useState('');
  const [medicalDays, setMedicalDays] = useState(2);

  useEffect(() => {
    if (!modalOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea, select') || []);
    focusable()[0]?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) setModalOpen(false);
      if (event.key !== 'Tab') return;
      const elements = focusable();
      const first = elements[0];
      const last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('keydown', handleKey); previous?.focus(); };
  }, [modalOpen, saving]);

  const fetchAttendanceData = useCallback(async () => {
    const request = ++requestId.current;
    setLoading(true);
    setError(null);
    setItems([]);
    setOperationalSummaries([]);
    setCanEdit(false);
    setWarnings([]);
    setSyncedAt(null);
    try {
      const result = await fetchAttendance(dateVal);
      if (request !== requestId.current) return;
      setItems(result.items);
      setOperationalSummaries(result.operationalSummary || []);
      setRoutesData(result.routes || []);
      setVisitsData(result.visits || []);
      setPromoters(result.promoters);
      setWarnings(result.warnings);
      setCanEdit(result.canEdit);
      setTimezone(result.timezone);
      setSyncedAt(result.fetchedAt);
    } catch (err: unknown) {
      if (request !== requestId.current) return;
      setError(attendanceErrorMessage(err));
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }, [dateVal]);

  useEffect(() => {
    setModalOpen(false);
    void fetchAttendanceData();
    const timer = window.setInterval(() => {
      if (dialogRef.current || document.querySelector('[data-attendance-journey][open]')) return;
      void fetchAttendanceData();
    }, 60000);
    return () => { ++requestId.current; window.clearInterval(timer); };
  }, [fetchAttendanceData]);

  const handleSaveStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem || !canEdit || saving) return;
    setSaving(true);
    try {
      await saveAttendance({ matricula: selectedItem.matricula, date: dateVal, status: newStatus, justification, medicalDays });
      setModalOpen(false);
      onShowToast({ title: 'Ajuste registrado', message: 'Alteração persistida com trilha de auditoria.', type: 'success' });
      await fetchAttendanceData();
    } catch (err: unknown) {
      onShowToast({ title: 'Ajuste não salvo', message: attendanceErrorMessage(err), type: 'error' });
    } finally { setSaving(false); }
  };

  // Base de promotores sob os filtros gerais (escopo, busca e supervisor)
  // Utilizada para preservar a contagem fidedigna dos cartões de indicadores
  const baseSummaries = useMemo(() => {
    return filterPromoterSummaries(operationalSummaries, {
      search,
      supervisorFilter,
      scopeFilter,
      statusFilter: 'ALL'
    });
  }, [operationalSummaries, scopeFilter, search, supervisorFilter]);

  // Filtragem final dos promotores (inclui o filtro interativo por indicador)
  const filteredSummaries = useMemo(() => {
    return filterPromoterSummaries(operationalSummaries, {
      search,
      supervisorFilter,
      scopeFilter,
      statusFilter
    });
  }, [operationalSummaries, scopeFilter, search, supervisorFilter, statusFilter]);

  // Lista única de supervisores para o filtro
  const availableSupervisors = useMemo(() => {
    const set = new Set<string>();
    operationalSummaries.forEach(s => {
      if (s.supervisor && s.supervisor !== 'Não atribuído') {
        set.add(s.supervisor);
      }
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [operationalSummaries]);

  // Indicadores de Roteiro e Resumo de Visitas da Operação
  // Calculados a partir de baseSummaries para manter as contagens dos cartões estáveis
  const metrics = useMemo(() => {
    return calculateOperationalMetrics(baseSummaries);
  }, [baseSummaries]);

  // Alterna o filtro de status ao clicar no card (ou remove se já estiver ativo)
  const handleToggleStatusFilter = (targetStatus: RouteStatusFilter) => {
    setStatusFilter(prev => prev === targetStatus ? 'ALL' : targetStatus);
  };

  const handleExport = () => {
    try {
      const rows = filteredSummaries.map(s => ({
        Data: dateVal,
        Promotor: s.name,
        Matrícula: s.matricula,
        Equipe: s.equipe,
        Supervisor: s.supervisor,
        'Presença Operacional': s.presenceStatus === 'presente' ? 'Presente' : 'Sem atividade',
        'Primeira Atividade': s.firstActivityTime || '--:--',
        'Visitas Concluídas': s.completedVisitsCount,
        'Visitas Programadas': s.scheduledVisitsCount,
        'Visitas Pendentes': s.pendingVisitsCount,
        'Relação': `${s.completedVisitsCount}/${s.scheduledVisitsCount}`,
        'Situação do Roteiro': s.routeStatus
      }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Controle Diário');
      XLSX.writeFile(wb, `MK9_Controle_Diario_${dateVal}.xlsx`);
    } catch {
      onShowToast({ title: 'Exportação não concluída', message: 'Não foi possível gerar a planilha.', type: 'error' });
    }
  };

  // Badge para Situação do Roteiro
  const renderRouteBadge = (status: RouteExecutionStatus) => {
    switch (status) {
      case 'COMPLETO':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-300">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
            COMPLETO
          </span>
        );
      case 'PARCIAL':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-300">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-600" />
            PARCIAL
          </span>
        );
      case 'NAO_REALIZADO':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-800 border border-rose-300">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-600" />
            NÃO REALIZADO
          </span>
        );
      case 'EM_ATIVIDADE':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-800 border border-blue-300">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse" />
            EM ATIVIDADE
          </span>
        );
      case 'AGUARDANDO_INICIO':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-300">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
            AGUARDANDO INÍCIO
          </span>
        );
      case 'SEM_PROGRAMACAO':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-[#E4E2DB] text-[#5F5F5F] border border-[#CFCDC5]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#77766F]" />
            SEM PROGRAMAÇÃO
          </span>
        );
    }
  };

  return (
    <div aria-busy={loading} className="w-full px-4 lg:px-8 py-6 max-w-[1400px] mx-auto space-y-6">
      {/* 1. CABEÇALHO SIMPLES */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-[#CFCDC5]">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-[#171717] tracking-tight">
              Controle Diário
            </h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#F7F6F2] border border-[#CFCDC5] text-[#171717] font-mono text-[11px]">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              {loading ? 'Consultando…' : syncedAt ? `Atualizado às ${zoned(syncedAt, timezone).time}` : 'Pronto'}
            </span>
          </div>
          <p className="text-xs sm:text-sm text-[#77766F] mt-0.5">
            Acompanhe o cumprimento operacional das rotas e atendimentos de campo.
          </p>
        </div>

        {/* Botão de Configurações e Exportação */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            onClick={handleExport}
            disabled={loading || filteredSummaries.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#F7F6F2] hover:bg-[#E4E2DB] text-[#171717] border border-[#CFCDC5] text-xs font-semibold shadow-xs transition-all cursor-pointer"
            title="Exportar planilha"
          >
            <span className="material-symbols-outlined text-[18px]">download</span>
            <span className="hidden sm:inline">Exportar</span>
          </button>
          <button
            onClick={() => setShowConfig(!showConfig)}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl border text-xs font-bold transition-all shadow-xs cursor-pointer ${
              showConfig
                ? 'bg-[#222222] text-white border-black'
                : 'bg-[#F7F6F2] hover:bg-[#E4E2DB] text-[#171717] border-[#CFCDC5]'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">settings</span>
            <span>Configurações</span>
          </button>
        </div>
      </div>

      {/* ÁREA DE CONFIGURAÇÕES (RECOLHÍVEL) */}
      {showConfig && (
        <div className="p-5 rounded-2xl bg-[#EAE8E2] border border-[#CFCDC5] space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-[#CFCDC5]">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-purple-700">tune</span>
              <h2 className="font-bold text-sm text-[#171717]">Configurações Operacionais e Administrativas</h2>
            </div>
            <button
              onClick={() => setShowConfig(false)}
              className="p-1 text-[#77766F] hover:text-[#171717] rounded-lg cursor-pointer"
            >
              <span className="material-symbols-outlined text-lg">close</span>
            </button>
          </div>

          {/* Avisos consolidados recolhíveis */}
          {warnings.length > 0 && (
            <details className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
              <summary className="font-bold cursor-pointer select-none">
                Avisos do Sistema ({warnings.length})
              </summary>
              <ul className="mt-2 list-disc list-inside space-y-1">
                {warnings.map((msg, i) => <li key={i}>{msg}</li>)}
              </ul>
            </details>
          )}

          {canEdit && (
            <AttendanceJourneyPanel
              promoters={promoters}
              onSaved={() => void fetchAttendanceData()}
            />
          )}

          <div className="flex justify-end pt-2">
            <button
              onClick={() => onNavigate('gestao-equipes')}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#222222] text-white text-xs font-semibold hover:bg-black cursor-pointer"
            >
              <span className="material-symbols-outlined text-[16px]">groups</span>
              <span>Gerenciar equipes</span>
            </button>
          </div>
        </div>
      )}

      {/* BARRA DE FILTROS: DATA, ESCOPO, BUSCA POR PROMOTOR E SUPERVISOR */}
      <div className="p-4 rounded-xl bg-[#F7F6F2] border border-[#CFCDC5] space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3">
          {/* Data selecionada */}
          <div className="lg:col-span-3 flex items-center bg-[#EAE8E2] border border-[#CFCDC5] px-3 py-2 rounded-lg">
            <span className="material-symbols-outlined text-[#77766F] mr-2 text-[18px]">calendar_today</span>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-[9px] uppercase font-mono font-bold text-[#77766F]">Data Operacional</span>
              <input
                type="date"
                aria-label="Data operacional"
                value={dateVal}
                onChange={(e) => {
                  setDateVal(e.target.value);
                  setStatusFilter('ALL');
                }}
                className="bg-transparent font-semibold text-xs text-[#171717] focus:outline-none cursor-pointer"
              />
            </div>
          </div>

          {/* Busca por Promotor */}
          <div className="lg:col-span-5 flex items-center bg-[#EAE8E2] border border-[#CFCDC5] px-3 py-2 rounded-lg">
            <span className="material-symbols-outlined text-[#77766F] mr-2 text-[18px]">search</span>
            <input
              type="text"
              aria-label="Buscar promotor ou matrícula"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar promotor por nome ou matrícula..."
              className="w-full bg-transparent text-xs text-[#171717] placeholder:text-[#77766F] focus:outline-none"
            />
            {search && (
              <button onClick={() => setSearch('')} className="text-[#77766F] hover:text-[#171717] p-1 cursor-pointer">
                ✕
              </button>
            )}
          </div>

          {/* Filtro por Supervisor */}
          <div className="lg:col-span-4 flex items-center bg-[#EAE8E2] border border-[#CFCDC5] px-3 py-2 rounded-lg">
            <span className="material-symbols-outlined text-[#77766F] mr-2 text-[18px]">supervisor_account</span>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-[9px] uppercase font-mono font-bold text-[#77766F]">Supervisor</span>
              <select
                aria-label="Filtrar por supervisor"
                value={supervisorFilter}
                onChange={(e) => setSupervisorFilter(e.target.value)}
                className="bg-transparent text-xs text-[#171717] focus:outline-none cursor-pointer font-medium"
              >
                <option value="" className="bg-[#F7F6F2]">Todos os supervisores</option>
                {availableSupervisors.map(sup => (
                  <option key={sup} value={sup} className="bg-[#F7F6F2]">{sup}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Filtro rápido de Escopo de Programação */}
        <div className="flex items-center gap-2 pt-2 border-t border-[#CFCDC5] text-xs">
          <span className="text-[10px] font-bold text-[#77766F] uppercase tracking-wider font-mono mr-1">
            Visualizar:
          </span>
          <button
            onClick={() => setScopeFilter('com_roteiro')}
            className={`px-3 py-1 rounded-full font-semibold transition-all cursor-pointer ${
              scopeFilter === 'com_roteiro'
                ? 'bg-[#222222] text-white shadow-xs'
                : 'bg-[#EAE8E2] text-[#5F5F5F] hover:bg-[#E4E2DB] border border-[#CFCDC5]'
            }`}
          >
            Com roteiro programado ({operationalSummaries.filter(s => s.scheduledVisitsCount > 0).length})
          </button>
          <button
            onClick={() => setScopeFilter('todos')}
            className={`px-3 py-1 rounded-full font-semibold transition-all cursor-pointer ${
              scopeFilter === 'todos'
                ? 'bg-[#222222] text-white shadow-xs'
                : 'bg-[#EAE8E2] text-[#5F5F5F] hover:bg-[#E4E2DB] border border-[#CFCDC5]'
            }`}
          >
            Todos os promotores ({operationalSummaries.length})
          </button>
          <button
            onClick={() => setScopeFilter('sem_programacao')}
            className={`px-3 py-1 rounded-full font-semibold transition-all cursor-pointer ${
              scopeFilter === 'sem_programacao'
                ? 'bg-[#222222] text-white shadow-xs'
                : 'bg-[#EAE8E2] text-[#5F5F5F] hover:bg-[#E4E2DB] border border-[#CFCDC5]'
            }`}
          >
            Sem programação ({operationalSummaries.filter(s => s.scheduledVisitsCount === 0).length})
          </button>
        </div>
      </div>

      {/* 2. QUATRO INDICADORES DE ROTEIRO + RESUMO COMPACTO DE PENDÊNCIAS */}
      <div className="space-y-3">
        {/* Quatro Indicadores Interativos */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Completos */}
          <button
            type="button"
            onClick={() => handleToggleStatusFilter('COMPLETO')}
            aria-pressed={statusFilter === 'COMPLETO'}
            aria-label={`Filtrar por roteiros completos: ${metrics.completos} promotores`}
            className={`p-4 rounded-xl flex items-center justify-between text-left transition-all duration-200 cursor-pointer border ${
              statusFilter === 'COMPLETO'
                ? 'bg-emerald-50/90 border-emerald-500 shadow-sm ring-2 ring-emerald-500/20'
                : 'bg-[#F7F6F2] hover:bg-[#EAE8E2] border-[#CFCDC5] hover:border-[#B5B3A8] shadow-xs'
            }`}
          >
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-bold text-[#77766F] uppercase tracking-wider font-mono">Completos</span>
                {statusFilter === 'COMPLETO' && (
                  <span className="inline-flex items-center px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-emerald-600 text-white font-mono">
                    Ativo
                  </span>
                )}
              </div>
              <div className="text-2xl font-extrabold text-emerald-700 font-mono mt-0.5">
                {loading ? '—' : metrics.completos}
              </div>
              <p className="text-[10px] text-[#77766F] mt-1">100% visitas realizadas</p>
            </div>
            <div className={`p-2.5 rounded-lg border transition-colors ${
              statusFilter === 'COMPLETO'
                ? 'bg-emerald-600 text-white border-emerald-600'
                : 'bg-emerald-50 text-emerald-700 border-emerald-200'
            }`}>
              <span className="material-symbols-outlined text-2xl">task_alt</span>
            </div>
          </button>

          {/* Parciais */}
          <button
            type="button"
            onClick={() => handleToggleStatusFilter('PARCIAL')}
            aria-pressed={statusFilter === 'PARCIAL'}
            aria-label={`Filtrar por roteiros parciais: ${metrics.parciais} promotores`}
            className={`p-4 rounded-xl flex items-center justify-between text-left transition-all duration-200 cursor-pointer border ${
              statusFilter === 'PARCIAL'
                ? 'bg-amber-50/90 border-amber-500 shadow-sm ring-2 ring-amber-500/20'
                : 'bg-[#F7F6F2] hover:bg-[#EAE8E2] border-[#CFCDC5] hover:border-[#B5B3A8] shadow-xs'
            }`}
          >
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-bold text-[#77766F] uppercase tracking-wider font-mono">Parciais</span>
                {statusFilter === 'PARCIAL' && (
                  <span className="inline-flex items-center px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-amber-600 text-white font-mono">
                    Ativo
                  </span>
                )}
              </div>
              <div className="text-2xl font-extrabold text-amber-700 font-mono mt-0.5">
                {loading ? '—' : metrics.parciais}
              </div>
              <p className="text-[10px] text-[#77766F] mt-1">Dia fechado com pendência</p>
            </div>
            <div className={`p-2.5 rounded-lg border transition-colors ${
              statusFilter === 'PARCIAL'
                ? 'bg-amber-600 text-white border-amber-600'
                : 'bg-amber-50 text-amber-700 border-amber-200'
            }`}>
              <span className="material-symbols-outlined text-2xl">timelapse</span>
            </div>
          </button>

          {/* Não realizados */}
          <button
            type="button"
            onClick={() => handleToggleStatusFilter('NAO_REALIZADO')}
            aria-pressed={statusFilter === 'NAO_REALIZADO'}
            aria-label={`Filtrar por roteiros não realizados: ${metrics.naoRealizados} promotores`}
            className={`p-4 rounded-xl flex items-center justify-between text-left transition-all duration-200 cursor-pointer border ${
              statusFilter === 'NAO_REALIZADO'
                ? 'bg-rose-50/90 border-rose-500 shadow-sm ring-2 ring-rose-500/20'
                : 'bg-[#F7F6F2] hover:bg-[#EAE8E2] border-[#CFCDC5] hover:border-[#B5B3A8] shadow-xs'
            }`}
          >
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-bold text-[#77766F] uppercase tracking-wider font-mono">Não Realizados</span>
                {statusFilter === 'NAO_REALIZADO' && (
                  <span className="inline-flex items-center px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-rose-600 text-white font-mono">
                    Ativo
                  </span>
                )}
              </div>
              <div className="text-2xl font-extrabold text-rose-700 font-mono mt-0.5">
                {loading ? '—' : metrics.naoRealizados}
              </div>
              <p className="text-[10px] text-[#77766F] mt-1">Nenhuma visita concluída</p>
            </div>
            <div className={`p-2.5 rounded-lg border transition-colors ${
              statusFilter === 'NAO_REALIZADO'
                ? 'bg-rose-600 text-white border-rose-600'
                : 'bg-rose-50 text-rose-700 border-rose-200'
            }`}>
              <span className="material-symbols-outlined text-2xl">cancel</span>
            </div>
          </button>

          {/* Em atividade / Aguardando início */}
          <button
            type="button"
            onClick={() => handleToggleStatusFilter('EM_ATIVIDADE')}
            aria-pressed={statusFilter === 'EM_ATIVIDADE'}
            aria-label={`Filtrar por roteiros em atividade: ${metrics.emAtividade} promotores`}
            className={`p-4 rounded-xl flex items-center justify-between text-left transition-all duration-200 cursor-pointer border ${
              statusFilter === 'EM_ATIVIDADE'
                ? 'bg-blue-50/90 border-blue-500 shadow-sm ring-2 ring-blue-500/20'
                : 'bg-[#F7F6F2] hover:bg-[#EAE8E2] border-[#CFCDC5] hover:border-[#B5B3A8] shadow-xs'
            }`}
          >
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-bold text-[#77766F] uppercase tracking-wider font-mono">Em Atividade</span>
                {statusFilter === 'EM_ATIVIDADE' && (
                  <span className="inline-flex items-center px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-blue-600 text-white font-mono">
                    Ativo
                  </span>
                )}
              </div>
              <div className="text-2xl font-extrabold text-blue-700 font-mono mt-0.5">
                {loading ? '—' : metrics.emAtividade}
              </div>
              <p className="text-[10px] text-[#77766F] mt-1">
                {metrics.aguardandoInicio > 0 ? `${metrics.aguardandoInicio} aguardando início` : 'Dia em andamento'}
              </p>
            </div>
            <div className={`p-2.5 rounded-lg border transition-colors ${
              statusFilter === 'EM_ATIVIDADE'
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-blue-50 text-blue-700 border-blue-200'
            }`}>
              <span className="material-symbols-outlined text-2xl">person_pin_circle</span>
            </div>
          </button>
        </div>

        {/* Filtro Adicional Dedicado: Aguardando Início (quando houver promotores aguardando) */}
        {metrics.aguardandoInicio > 0 && (
          <div className="flex items-center justify-between px-3.5 py-2 rounded-xl bg-[#F7F6F2] border border-[#CFCDC5] text-xs">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-slate-500" />
              <span className="text-[#5F5F5F]">
                Há <strong className="text-[#171717]">{metrics.aguardandoInicio}</strong> promotor(es) com roteiro programado aguardando início de visitas hoje:
              </span>
            </div>
            <button
              type="button"
              onClick={() => handleToggleStatusFilter('AGUARDANDO_INICIO')}
              aria-pressed={statusFilter === 'AGUARDANDO_INICIO'}
              className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                statusFilter === 'AGUARDANDO_INICIO'
                  ? 'bg-slate-800 text-white border-slate-900 shadow-xs ring-2 ring-slate-400/30'
                  : 'bg-[#EAE8E2] text-slate-700 hover:bg-[#DCDAD2] border-[#CFCDC5]'
              }`}
            >
              {statusFilter === 'AGUARDANDO_INICIO' ? '✓ Filtro Ativo (Limpar)' : 'Filtrar Aguardando Início'}
            </button>
          </div>
        )}
        {/* Resumo Compacto de Visitas e Pendências Operacionais */}
        <div className="px-4 py-2.5 rounded-xl bg-[#EAE8E2] border border-[#CFCDC5] flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
          <div className="flex items-center gap-4 flex-wrap">
            <span>
              Visitas Programadas: <strong className="text-[#171717]">{metrics.totalProgramadas}</strong>
            </span>
            <span>•</span>
            <span>
              Concluídas: <strong className="text-emerald-800">{metrics.totalConcluidas}</strong>
            </span>
            <span>•</span>
            <span className="flex items-center gap-1">
              Pendentes: <strong className={metrics.totalPendentes > 0 ? 'text-amber-800 font-bold' : 'text-[#171717]'}>{metrics.totalPendentes}</strong>
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[#5F5F5F]">Execução Geral:</span>
            <div className="w-24 h-2 rounded-full bg-[#CFCDC5] overflow-hidden">
              <div
                className="h-full bg-emerald-600 transition-all duration-300"
                style={{ width: `${metrics.percentualExecucao}%` }}
              />
            </div>
            <strong className="text-emerald-800">{metrics.percentualExecucao}%</strong>
          </div>
        </div>
      </div>

      {/* 3. TABELA PRINCIPAL SIMPLES */}
      {loading ? (
        <div className="rounded-xl bg-[#F7F6F2] border border-[#CFCDC5] p-12 text-center shadow-xs">
          <div className="max-w-md mx-auto space-y-3 flex flex-col items-center">
            <span className="material-symbols-outlined text-4xl text-purple-600 animate-spin">sync</span>
            <h3 className="text-sm font-bold text-[#171717]">Calculando presença e roteiros...</h3>
            <p className="text-xs text-[#77766F]">Cruzando visitas de campo com a programação do dia.</p>
          </div>
        </div>
      ) : error ? (
        <div className="rounded-xl bg-rose-50 border border-rose-300 p-8 text-center text-rose-900">
          <div className="max-w-md mx-auto space-y-2 flex flex-col items-center">
            <span className="material-symbols-outlined text-3xl text-rose-600">error</span>
            <h3 className="text-sm font-bold text-rose-800">Falha ao carregar registros</h3>
            <p className="text-xs text-[#5F5F5F]">{error}</p>
            <button
              onClick={fetchAttendanceData}
              className="mt-2 px-4 py-1.5 rounded-lg bg-rose-700 text-white font-semibold text-xs cursor-pointer shadow-xs"
            >
              Tentar novamente
            </button>
          </div>
        </div>
      ) : filteredSummaries.length === 0 ? (
        <div className="rounded-xl bg-[#F7F6F2] border border-[#CFCDC5] p-10 text-center shadow-xs">
          <div className="max-w-md mx-auto space-y-3 flex flex-col items-center">
            <div className="w-14 h-14 rounded-full bg-[#EAE8E2] border border-[#CFCDC5] flex items-center justify-center text-[#77766F]">
              <span className="material-symbols-outlined text-3xl">person_off</span>
            </div>
            <h3 className="text-base font-bold text-[#171717]">
              {statusFilter !== 'ALL' ? 'Nenhum promotor encontrado para este filtro.' : 'Nenhum promotor encontrado'}
            </h3>
            <p className="text-xs text-[#77766F]">
              {statusFilter !== 'ALL'
                ? 'Nenhum promotor corresponde ao indicador selecionado nesta data operacional.'
                : 'Não foram encontrados promotores para os filtros informados nesta data operacional.'}
            </p>
            {(search || supervisorFilter || scopeFilter !== 'com_roteiro' || statusFilter !== 'ALL') && (
              <div className="flex items-center gap-2 flex-wrap justify-center pt-1">
                {statusFilter !== 'ALL' && (
                  <button
                    onClick={() => setStatusFilter('ALL')}
                    className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold cursor-pointer shadow-xs"
                  >
                    Limpar filtro do indicador
                  </button>
                )}
                <button
                  onClick={() => { setSearch(''); setSupervisorFilter(''); setScopeFilter('com_roteiro'); setStatusFilter('ALL'); }}
                  className="px-3 py-1.5 rounded-lg bg-[#222222] hover:bg-[#333333] text-white text-xs font-semibold cursor-pointer shadow-xs"
                >
                  Restaurar visualização padrão
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-xl bg-[#F7F6F2] border border-[#CFCDC5] overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[700px] text-xs">
              <thead>
                <tr className="bg-[#E4E2DB] text-[#77766F] font-mono text-[10px] uppercase tracking-wider h-10 border-b border-[#CFCDC5] select-none">
                  <th className="py-2.5 px-4 font-semibold">Promotor</th>
                  <th className="py-2.5 px-4 font-semibold">Presença Operacional</th>
                  <th className="py-2.5 px-4 font-semibold text-center">Visitas (Concluídas / Programadas)</th>
                  <th className="py-2.5 px-4 font-semibold">Situação do Roteiro</th>
                  <th className="py-2.5 px-4 text-right font-semibold">Detalhes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#CFCDC5]">
                {filteredSummaries.map((summary) => (
                  <tr key={summary.promoterId} className="hover:bg-[#EAE8E2] transition-colors">
                    {/* Promotor */}
                    <td className="py-3 px-4">
                      <div className="font-bold text-[#171717]">{summary.name}</div>
                      <div className="font-mono text-[11px] text-[#77766F]">
                        {summary.matricula} • {summary.supervisor}
                      </div>
                    </td>

                    {/* Presença Operacional */}
                    <td className="py-3 px-4">
                      {summary.presenceStatus === 'presente' ? (
                        <div className="flex items-center gap-1.5">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-300">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
                            Presente
                          </span>
                          {summary.firstActivityTime && (
                            <span className="text-[11px] font-mono text-[#5F5F5F]">
                              (1º início às {summary.firstActivityTime})
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-[#E4E2DB] text-[#5F5F5F] border border-[#CFCDC5]">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#77766F]" />
                          Sem atividade
                        </span>
                      )}
                    </td>

                    {/* Visitas Concluídas / Programadas */}
                    <td className="py-3 px-4 text-center">
                      <div className="inline-flex items-center gap-1.5 font-mono">
                        <span className="text-sm font-bold text-[#171717]">
                          {summary.completedVisitsCount} / {summary.scheduledVisitsCount}
                        </span>
                        {summary.pendingVisitsCount > 0 && (
                          <span className="text-[11px] text-amber-800 font-semibold">
                            ({summary.pendingVisitsCount} pendente{summary.pendingVisitsCount > 1 ? 's' : ''})
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Situação do Roteiro */}
                    <td className="py-3 px-4">
                      {renderRouteBadge(summary.routeStatus)}
                    </td>

                    {/* Botão de Detalhes */}
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => setDetailPromoter(summary)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#EAE8E2] hover:bg-[#DCDAD2] text-[#171717] font-semibold text-xs border border-[#CFCDC5] transition-all cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[16px]">visibility</span>
                        <span>Ver visitas</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Rodapé da tabela */}
          <div className="p-3 bg-[#E4E2DB] border-t border-[#CFCDC5] flex flex-wrap items-center justify-between gap-2 text-xs text-[#5F5F5F]">
            <div className="flex items-center gap-2 flex-wrap">
              <span>
                Exibindo <strong>{filteredSummaries.length}</strong> de <strong>{operationalSummaries.length}</strong> promotores
                {baseSummaries.length !== operationalSummaries.length && (
                  <span className="text-[#77766F]"> ({baseSummaries.length} no escopo)</span>
                )}
              </span>
              {statusFilter !== 'ALL' && (
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[#F7F6F2] border border-[#CFCDC5] font-mono text-[11px] text-[#171717]">
                  Filtro: <strong className="uppercase">{statusFilter.replace('_', ' ')}</strong>
                  <button
                    onClick={() => setStatusFilter('ALL')}
                    title="Remover filtro de status"
                    aria-label="Remover filtro de status"
                    className="hover:text-rose-600 font-bold ml-0.5 cursor-pointer"
                  >
                    ✕
                  </button>
                </span>
              )}
            </div>
            <span className="text-[11px]">MK9 Date — Presença Operacional por Atendimentos</span>
          </div>
        </div>
      )}

      {/* 4. MODAL / PAINEL SIMPLES DE DETALHES DO PROMOTOR */}
      {detailPromoter && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Detalhamento de Visitas — ${detailPromoter.name}`}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs"
        >
          <div className="relative w-full max-w-2xl max-h-[85vh] flex flex-col bg-[#F7F6F2] border border-[#CFCDC5] rounded-2xl shadow-2xl overflow-hidden">
            {/* Cabeçalho do Modal */}
            <div className="flex items-center justify-between p-4 bg-[#EAE8E2] border-b border-[#CFCDC5]">
              <div>
                <h3 className="text-base font-bold text-[#171717]">{detailPromoter.name}</h3>
                <p className="text-xs font-mono text-[#77766F]">
                  Matrícula: {detailPromoter.matricula} • Supervisor: {detailPromoter.supervisor} • Data: {dateVal}
                </p>
              </div>
              <button
                onClick={() => setDetailPromoter(null)}
                className="p-1.5 rounded-lg text-[#77766F] hover:text-[#171717] hover:bg-[#DCDAD2] cursor-pointer"
                title="Fechar"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            {/* Conteúdo: Lista de Lojas e Visitas */}
            <div className="p-4 overflow-y-auto space-y-3 flex-1">
              <div className="flex items-center justify-between text-xs pb-1 font-mono">
                <span className="font-bold text-[#171717]">
                  Atendimentos ({detailPromoter.visits.length})
                </span>
                <span className="text-[#5F5F5F]">
                  <strong>{detailPromoter.completedVisitsCount}</strong> concluídas • <strong className={detailPromoter.pendingVisitsCount > 0 ? 'text-amber-800' : ''}>{detailPromoter.pendingVisitsCount}</strong> pendentes de {detailPromoter.scheduledVisitsCount}
                </span>
              </div>

              {detailPromoter.visits.length === 0 ? (
                <div className="p-6 text-center text-xs text-[#77766F] border border-dashed border-[#CFCDC5] rounded-xl">
                  Nenhuma visita ou rota programada nesta data.
                </div>
              ) : (
                <div className="space-y-2">
                  {detailPromoter.visits.map((v) => {
                    const isPending = v.status === 'pendente' || v.status === 'nao_realizada';
                    return (
                      <div
                        key={v.id}
                        className={`p-3 rounded-xl border text-xs space-y-1.5 transition-all ${
                          v.status === 'concluida'
                            ? 'bg-emerald-50/50 border-emerald-200'
                            : v.status === 'nao_realizada'
                            ? 'bg-rose-50/40 border-rose-200'
                            : v.status === 'em_andamento'
                            ? 'bg-blue-50/40 border-blue-200'
                            : 'bg-amber-50/30 border-amber-200'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-bold text-[#171717] text-sm flex items-center gap-2">
                              <span>{v.lojaNome}</span>
                              <span className="text-[10px] font-mono text-[#77766F]">({v.lojaCodigo})</span>
                              {isPending && (
                                <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                                  Pendente
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-[#5F5F5F]">
                              Indústria: <strong>{v.industriaNome}</strong>
                              {!v.isScheduled && (
                                <span className="ml-2 text-purple-700 font-semibold">• Atendimento avulso</span>
                              )}
                            </div>
                          </div>
                          <div>
                            {v.status === 'concluida' ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800">
                                Concluída
                              </span>
                            ) : v.status === 'em_andamento' ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-blue-100 text-blue-800">
                                Em andamento
                              </span>
                            ) : v.status === 'nao_realizada' ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800">
                                Não realizada
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#E4E2DB] text-[#5F5F5F]">
                                Aguardando visita
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Horários */}
                        <div className="flex flex-wrap gap-4 text-[11px] font-mono text-[#5F5F5F] pt-1 border-t border-[#CFCDC5]/50">
                          <div>
                            Início: <strong>{v.startedTimeFormatted || '—'}</strong>
                          </div>
                          <div>
                            Conclusão: <strong>{v.completedTimeFormatted || '—'}</strong>
                          </div>
                        </div>

                        {/* Destaque para motivo quando não realizada */}
                        {v.motivoNaoRealizada && (
                          <div className="text-[11px] text-rose-800 bg-rose-100/70 p-2 rounded-lg font-medium">
                            Motivo registrado: {v.motivoNaoRealizada}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Rodapé do Modal */}
            <div className="p-3 bg-[#EAE8E2] border-t border-[#CFCDC5] flex justify-end">
              <button
                onClick={() => setDetailPromoter(null)}
                className="px-4 py-1.5 rounded-xl bg-[#222222] text-white text-xs font-semibold hover:bg-black cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Histórico de auditoria administrativa de ajustes manuais */}
      {audit && (
        <div role="dialog" aria-modal="true" aria-label="Histórico de ajustes" className="fixed inset-0 z-50 bg-black/70 p-4 flex items-center justify-center">
          <div className="bg-[#F7F6F2] text-[#171717] p-5 rounded-xl max-w-2xl w-full max-h-[80vh] overflow-auto">
            <h2 className="font-bold">Histórico de ajustes — {audit.name}</h2>
            <button className="my-3 border rounded px-3 py-2 text-xs" onClick={() => setAudit(null)}>
              Fechar histórico
            </button>
            {audit.rows.length === 0 ? (
              <p className="text-xs text-[#77766F]">Nenhum ajuste manual nesta data.</p>
            ) : (
              audit.rows.map(row => (
                <article key={row.id} className="border-t py-3 text-xs">
                  <p className="font-medium">{row.changed_by_name} • {zoned(row.changed_at, timezone).date} {zoned(row.changed_at, timezone).time}</p>
                  <p>Anterior: {row.previous_value?.override_status || 'Sem ajuste'} → Novo: {row.new_value?.override_status}</p>
                  <p className="text-[#5F5F5F]">Justificativa: {row.justification}</p>
                </article>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
