import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ScreenId, ToastMessage, Promoter } from '../types';
import { supabase } from '../lib/supabase';

interface PromotersViewProps {
  onNavigate: (screen: ScreenId) => void;
  onShowToast: (toast: Omit<ToastMessage, 'id'>) => void;
}

function mapRowToPromoter(row: any): Promoter {
  const name = row.nome || '';
  const initials = name
    ? name
        .split(' ')
        .map((n: string) => n[0])
        .filter(Boolean)
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : 'PR';

  let status: 'ativo' | 'ferias' | 'afastado' | 'arquivado' = 'ativo';
  const rawStatus = (row.status || '').toLowerCase();
  if (rawStatus === 'ferias') status = 'ferias';
  else if (rawStatus === 'afastado') status = 'afastado';
  else if (rawStatus === 'inativo' || rawStatus === 'arquivado') status = 'arquivado';
  else status = 'ativo';

  return {
    id: row.id,
    matricula: row.matricula || '',
    name,
    initials,
    contractType: 'CLT',
    cpf: row.cpf || '',
    phone: row.telefone || '',
    email: row.email || '',
    city: row.cidade || '',
    state: row.uf || 'SP',
    supervisor: row.supervisor || '',
    squad: row.equipe || '',
    status,
    operationalTodayStatus: 'campo'
  };
}

export const PromotersView: React.FC<PromotersViewProps> = ({
  onNavigate,
  onShowToast
}) => {
  const [promoters, setPromoters] = useState<Promoter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [supervisorFilter, setSupervisorFilter] = useState('all');
  const [squadFilter, setSquadFilter] = useState('all');
  const [cityFilter, setCityFilter] = useState('all');
  const [chipFilter, setChipFilter] = useState<'all' | 'ativo' | 'alerta' | 'ferias' | 'arquivado'>('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPromoter, setEditingPromoter] = useState<Promoter | null>(null);

  // Form State
  const [formName, setFormName] = useState('');
  const [formCpf, setFormCpf] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formMatricula, setFormMatricula] = useState('');
  const [formCity, setFormCity] = useState('');
  const [formSupervisor, setFormSupervisor] = useState('');
  const [formSquad, setFormSquad] = useState('');
  const [formStatus, setFormStatus] = useState<'ativo' | 'ferias' | 'afastado' | 'arquivado'>('ativo');

  const fetchPromoters = useCallback(async () => {
    setLoading(true);
    setError(null);

    if (!supabase) {
      setError('Cliente Supabase não inicializado.');
      setLoading(false);
      return;
    }

    try {
      const { data, error: fetchErr } = await supabase
        .from('promotores')
        .select('*')
        .order('created_at', { ascending: false });

      if (fetchErr) throw fetchErr;

      const list = (data || []).map(mapRowToPromoter);
      setPromoters(list);
    } catch (err: any) {
      console.error('Erro ao carregar promotores:', err);
      setError(err.message || 'Falha ao buscar promotores no banco de dados.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPromoters();
  }, [fetchPromoters]);

  const openNewModal = () => {
    setEditingPromoter(null);
    setFormName('');
    setFormCpf('');
    setFormPhone('');
    setFormEmail('');
    setFormMatricula(`PRM-${Math.floor(1000 + Math.random() * 9000)}`);
    setFormCity('São Paulo - SP');
    setFormSupervisor('');
    setFormSquad('');
    setFormStatus('ativo');
    setModalOpen(true);
  };

  const openEditModal = (p: Promoter) => {
    setEditingPromoter(p);
    setFormName(p.name);
    setFormCpf(p.cpf);
    setFormPhone(p.phone);
    setFormEmail(p.email || '');
    setFormMatricula(p.matricula);
    setFormCity(p.city && p.state ? `${p.city} - ${p.state}` : p.city || 'São Paulo - SP');
    setFormSupervisor(p.supervisor || '');
    setFormSquad(p.squad || '');
    setFormStatus(p.status);
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formMatricula.trim()) {
      onShowToast({
        title: 'Campo Obrigatório',
        message: 'A Matrícula é obrigatória.',
        type: 'warning'
      });
      return;
    }

    if (!formName.trim()) {
      onShowToast({
        title: 'Campo Obrigatório',
        message: 'O Nome Completo é obrigatório.',
        type: 'warning'
      });
      return;
    }

    const cleanMatricula = formMatricula.trim();
    const duplicate = promoters.find(
      (p) => p.matricula.toLowerCase() === cleanMatricula.toLowerCase() && p.id !== editingPromoter?.id
    );

    if (duplicate) {
      onShowToast({
        title: 'Matrícula Duplicada',
        message: `A matrícula "${cleanMatricula}" já pertence ao promotor ${duplicate.name}.`,
        type: 'error'
      });
      return;
    }

    if (!supabase) {
      onShowToast({
        title: 'Erro de Supabase',
        message: 'Cliente Supabase não configurado.',
        type: 'error'
      });
      return;
    }

    setSaving(true);

    const [city, state] = formCity.includes('-')
      ? formCity.split('-').map((s) => s.trim())
      : [formCity.trim() || 'São Paulo', 'SP'];

    const dbStatus = formStatus === 'arquivado' ? 'inativo' : formStatus;

    const payload = {
      matricula: cleanMatricula,
      nome: formName.trim(),
      cpf: formCpf.trim() || null,
      telefone: formPhone.trim() || null,
      email: formEmail.trim() || null,
      cidade: city || 'São Paulo',
      uf: state || 'SP',
      supervisor: formSupervisor.trim() || null,
      equipe: formSquad.trim() || null,
      status: dbStatus
    };

    try {
      if (editingPromoter) {
        const { error: updateErr } = await supabase
          .from('promotores')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', editingPromoter.id);

        if (updateErr) throw updateErr;

        onShowToast({
          title: 'Promotor Atualizado',
          message: `Ficha cadastral de ${formName} atualizada no banco.`,
          type: 'success'
        });
      } else {
        const { error: insertErr } = await supabase
          .from('promotores')
          .insert([payload]);

        if (insertErr) {
          if (insertErr.code === '23505') {
            throw new Error(`A matrícula "${cleanMatricula}" já está cadastrada no sistema.`);
          }
          throw insertErr;
        }

        onShowToast({
          title: 'Novo Promotor Cadastrado',
          message: `${formName} gravado no banco de dados com sucesso.`,
          type: 'success'
        });
      }

      setModalOpen(false);
      await fetchPromoters();
    } catch (err: any) {
      console.error('Erro ao salvar promotor:', err);
      onShowToast({
        title: 'Erro ao Salvar',
        message: err.message || 'Falha ao gravar promotor no banco de dados.',
        type: 'error'
      });
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async (id: string, name: string) => {
    if (!supabase) return;

    setSaving(true);
    try {
      const { error: err } = await supabase
        .from('promotores')
        .update({ status: 'inativo', updated_at: new Date().toISOString() })
        .eq('id', id);

      if (err) throw err;

      onShowToast({
        title: 'Promotor Inativado',
        message: `${name} foi inativado no banco de dados. Histórico de presenças preservado.`,
        type: 'info'
      });

      setModalOpen(false);
      await fetchPromoters();
    } catch (err: any) {
      console.error('Erro ao inativar promotor:', err);
      onShowToast({
        title: 'Erro ao Inativar',
        message: err.message || 'Não foi possível inativar o promotor.',
        type: 'error'
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSelectAll = (checked: boolean) => {
    setSelectedIds(checked ? filteredPromoters.map((p) => p.id) : []);
  };

  const availableSupervisors = useMemo(() => {
    return Array.from(new Set(promoters.map((p) => p.supervisor).filter(Boolean))).sort();
  }, [promoters]);

  const availableSquads = useMemo(() => {
    return Array.from(new Set(promoters.map((p) => p.squad).filter(Boolean))).sort();
  }, [promoters]);

  const availableCities = useMemo(() => {
    return Array.from(
      new Set(
        promoters
          .map((p) => (p.city && p.state ? `${p.city} - ${p.state}` : p.city))
          .filter(Boolean)
      )
    ).sort();
  }, [promoters]);

  const filteredPromoters = promoters.filter((p) => {
    const matchesSearch =
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.cpf.toLowerCase().includes(search.toLowerCase()) ||
      p.matricula.toLowerCase().includes(search.toLowerCase());

    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'arquivado' ? p.status === 'arquivado' : p.status === statusFilter);

    const matchesSupervisor =
      supervisorFilter === 'all' ||
      (supervisorFilter === 'none' ? !p.supervisor : p.supervisor === supervisorFilter);

    const matchesSquad =
      squadFilter === 'all' || (squadFilter === 'none' ? !p.squad : p.squad === squadFilter);

    const matchesCity =
      cityFilter === 'all' || `${p.city} - ${p.state}` === cityFilter || p.city === cityFilter;

    let matchesChip = true;
    if (chipFilter === 'ativo') matchesChip = p.status === 'ativo';
    if (chipFilter === 'alerta') matchesChip = !p.supervisor || !p.squad || p.supervisor === 'Nenhum' || p.squad === 'Nenhum';
    if (chipFilter === 'ferias') matchesChip = p.status === 'ferias' || p.status === 'afastado';
    if (chipFilter === 'arquivado') matchesChip = p.status === 'arquivado';

    return matchesSearch && matchesStatus && matchesSupervisor && matchesSquad && matchesCity && matchesChip;
  });

  return (
    <div className="w-full px-4 lg:px-8 py-6 max-w-[1720px] mx-auto space-y-6">
      {/* Top Header */}
      <section className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div className="flex flex-col space-y-1">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              Promotores
            </h1>
            <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 font-mono text-[10px] font-bold">
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
              <span>CADASTRO OPERACIONAL CLT</span>
            </div>
          </div>
          <p className="text-xs sm:text-sm text-slate-400 max-w-2xl">
            Gerencie o quadro de promotores de campo, alocações de equipe, supervisão regional e histórico operacional.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => fetchPromoters()}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#171b26] hover:bg-[#1f2433] text-slate-200 border border-[#1e2433] text-xs font-semibold shadow-sm cursor-pointer"
            title="Atualizar lista"
          >
            <span className="material-symbols-outlined text-base text-cyan-400">refresh</span>
            <span>Atualizar</span>
          </button>
          <button
            onClick={() => onShowToast({ title: 'Exportar Base CLT', message: 'Planilha completa de promotores gerada.', type: 'info' })}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#171b26] hover:bg-[#1f2433] text-slate-200 border border-[#1e2433] text-xs font-semibold shadow-sm"
          >
            <span className="material-symbols-outlined text-base text-cyan-400">file_download</span>
            <span>Exportar Base</span>
          </button>
          <button
            onClick={openNewModal}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs neon-purple-glow transition-all active:scale-95 shadow-md cursor-pointer"
          >
            <span className="material-symbols-outlined text-lg">person_add</span>
            <span>+ Novo promotor</span>
          </button>
        </div>
      </section>

      {/* Error Alert */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-between gap-4 text-xs text-rose-300">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-lg">error</span>
            <span>{error}</span>
          </div>
          <button
            onClick={fetchPromoters}
            className="px-3 py-1 rounded bg-rose-500/20 hover:bg-rose-500/30 font-bold border border-rose-500/40 text-rose-200 cursor-pointer"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {/* KPI Summary Cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* Card 1: Total */}
        <div className="relative overflow-hidden rounded-xl bg-[#171b26] border border-[#1e2433] p-4 shadow-md flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <span className="text-[11px] font-bold uppercase font-mono text-slate-400">Total de Promotores</span>
            <span className="px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 font-mono text-[11px] font-bold border border-purple-500/20">
              Quadro CLT
            </span>
          </div>
          <div className="my-2">
            <div className="text-3xl font-extrabold text-white font-mono tracking-tight">
              {loading ? '...' : promoters.length}
            </div>
            <div className="flex items-center gap-1.5 mt-1 text-slate-400 text-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span>{promoters.filter((p) => p.status === 'ativo').length} CLT Ativos em folha</span>
            </div>
          </div>
          <div className="h-1 w-full bg-[#10141f] rounded-full overflow-hidden">
            <div className="h-full bg-purple-600 rounded-full shadow-[0_0_8px_rgba(147,51,234,0.8)]" style={{ width: promoters.length ? '100%' : '0%' }} />
          </div>
        </div>

        {/* Card 2: Alocados */}
        <div className="relative overflow-hidden rounded-xl bg-[#171b26] border border-[#1e2433] p-4 shadow-md flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <span className="text-[11px] font-bold uppercase font-mono text-slate-400">Promotores Alocados</span>
            <span className="font-mono text-xs text-cyan-300 font-bold">Cobertura</span>
          </div>
          <div className="my-2">
            <div className="text-3xl font-extrabold text-white font-mono tracking-tight">
              {loading ? '...' : promoters.filter((p) => p.squad && p.squad !== 'Nenhum').length}
            </div>
            <div className="flex items-center gap-1.5 mt-1 text-slate-400 text-xs">
              <span className="material-symbols-outlined text-cyan-400 text-sm">groups</span>
              <span>Squads regionais ativos</span>
            </div>
          </div>
          <div className="h-1 w-full bg-[#10141f] rounded-full overflow-hidden">
            <div className="h-full bg-cyan-400 rounded-full shadow-[0_0_8px_rgba(56,189,248,0.8)]" style={{ width: promoters.length ? `${Math.round((promoters.filter((p) => p.squad && p.squad !== 'Nenhum').length / promoters.length) * 100)}%` : '0%' }} />
          </div>
        </div>

        {/* Card 3: Pendentes de Alocação */}
        <div className="relative overflow-hidden rounded-xl bg-[#171b26] border border-[#1e2433] p-4 shadow-md flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <span className="text-[11px] font-bold font-mono text-slate-400 uppercase flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-slate-500" />
              Pendentes de Alocação
            </span>
            <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 font-mono text-[10px] font-bold border border-slate-700">
              Quadro
            </span>
          </div>
          <div className="my-2">
            <div className="text-3xl font-extrabold text-white font-mono tracking-tight">
              {loading ? '...' : promoters.filter((p) => !p.supervisor || !p.squad || p.supervisor === 'Nenhum' || p.squad === 'Nenhum').length}
            </div>
            <div className="flex items-center gap-3 mt-1 font-mono text-[11px] text-slate-400">
              <span className="flex items-center gap-1">
                <span className="w-1 h-1 rounded-full bg-slate-500" />
                {promoters.filter((p) => !p.squad || p.squad === 'Nenhum').length} sem equipe
              </span>
              <span className="flex items-center gap-1">
                <span className="w-1 h-1 rounded-full bg-slate-500" />
                {promoters.filter((p) => !p.supervisor || p.supervisor === 'Nenhum').length} sem supervisor
              </span>
            </div>
          </div>
          <button
            onClick={() => setChipFilter('alerta')}
            className="w-full py-1 text-center font-mono text-[11px] uppercase font-bold tracking-wider text-slate-300 bg-[#131722] hover:bg-[#1f2433] rounded border border-[#1e2433] transition-colors cursor-pointer"
          >
            Filtrar pendências →
          </button>
        </div>

        {/* Card 4: Status Operacional Hoje */}
        <div className="relative overflow-hidden rounded-xl bg-[#171b26] border border-[#1e2433] p-4 shadow-md flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <span className="text-[11px] font-bold uppercase font-mono text-slate-400">Status Operacional Hoje</span>
            <span className="font-mono text-xs text-slate-400 font-bold flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
              Tempo Real
            </span>
          </div>
          <div className="my-2 space-y-1 text-xs">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-slate-200">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                Em campo
              </span>
              <span className="font-mono font-bold text-white">
                {loading ? '...' : promoters.filter((p) => p.operationalTodayStatus === 'campo' && p.status === 'ativo').length}
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-400">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-cyan-400" />
                Folga / Férias
              </span>
              <span className="font-mono font-medium">
                {loading ? '...' : promoters.filter((p) => p.status === 'ferias' || p.operationalTodayStatus === 'folga').length}
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-400">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-rose-400" />
                Faltas / Atestados
              </span>
              <span className="font-mono font-bold text-rose-400">
                {loading ? '...' : promoters.filter((p) => p.operationalTodayStatus === 'falta' || p.operationalTodayStatus === 'atestado').length}
              </span>
            </div>
          </div>
          <div className="text-[10px] text-slate-500 font-mono text-right">
            Sincronizado com Supabase (public.promotores)
          </div>
        </div>
      </section>

      {/* Search & Telemetry Filters Panel */}
      <section className="p-4 rounded-xl bg-[#171b26] border border-[#1e2433] shadow-md space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
          <div className="md:col-span-4 relative flex items-center">
            <span className="material-symbols-outlined absolute left-3 text-slate-400 text-base">search</span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por promotor, CPF, matrícula..."
              className="w-full bg-[#131722] border border-[#1e2433] pl-9 pr-14 py-2 rounded-lg text-white placeholder:text-slate-500 text-xs focus:outline-none focus:border-purple-500"
            />
            <kbd className="absolute right-2.5 font-mono text-[10px] text-slate-400 px-1 py-0.5 rounded bg-[#1f2433]">
              Ctrl+K
            </kbd>
          </div>

          <div className="md:col-span-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full bg-[#131722] border border-[#1e2433] px-3 py-2 rounded-lg text-slate-200 text-xs focus:outline-none cursor-pointer"
            >
              <option value="all">Todos os Status</option>
              <option value="ativo">Ativo</option>
              <option value="ferias">Em Férias</option>
              <option value="afastado">Afastado</option>
              <option value="arquivado">Inativo / Arquivado</option>
            </select>
          </div>

          <div className="md:col-span-2">
            <select
              value={supervisorFilter}
              onChange={(e) => setSupervisorFilter(e.target.value)}
              className="w-full bg-[#131722] border border-[#1e2433] px-3 py-2 rounded-lg text-slate-200 text-xs focus:outline-none cursor-pointer"
            >
              <option value="all">Todos os Supervisores</option>
              {availableSupervisors.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
              <option value="none">⚠️ Sem Supervisor</option>
            </select>
          </div>

          <div className="md:col-span-2">
            <select
              value={squadFilter}
              onChange={(e) => setSquadFilter(e.target.value)}
              className="w-full bg-[#131722] border border-[#1e2433] px-3 py-2 rounded-lg text-slate-200 text-xs focus:outline-none cursor-pointer"
            >
              <option value="all">Todas as Equipes</option>
              {availableSquads.map((sq) => (
                <option key={sq} value={sq}>{sq}</option>
              ))}
              <option value="none">⚠️ Sem Equipe</option>
            </select>
          </div>

          <div className="md:col-span-2">
            <select
              value={cityFilter}
              onChange={(e) => setCityFilter(e.target.value)}
              className="w-full bg-[#131722] border border-[#1e2433] px-3 py-2 rounded-lg text-slate-200 text-xs focus:outline-none cursor-pointer"
            >
              <option value="all">Todas as Cidades</option>
              {availableCities.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Quick Filter Chips */}
        <div className="flex items-center justify-between flex-wrap gap-2 pt-2 border-t border-[#1e2433]">
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => setChipFilter('all')}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                chipFilter === 'all'
                  ? 'bg-purple-600 text-white font-bold neon-purple-glow'
                  : 'bg-[#131722] text-slate-300 hover:text-white border border-[#1e2433]'
              }`}
            >
              Todos ({promoters.length})
            </button>
            <button
              onClick={() => setChipFilter('ativo')}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                chipFilter === 'ativo'
                  ? 'bg-emerald-600 text-white font-bold'
                  : 'bg-[#131722] text-emerald-400 hover:text-white border border-[#1e2433]'
              }`}
            >
              Ativos ({promoters.filter((p) => p.status === 'ativo').length})
            </button>
            <button
              onClick={() => setChipFilter('alerta')}
              className={`px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                chipFilter === 'alerta'
                  ? 'bg-amber-600 text-white font-bold'
                  : 'bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 border border-amber-500/30'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              ⚠️ Sem Equipe / Supervisor ({promoters.filter((p) => !p.supervisor || !p.squad || p.supervisor === 'Nenhum' || p.squad === 'Nenhum').length})
            </button>
            <button
              onClick={() => setChipFilter('ferias')}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                chipFilter === 'ferias'
                  ? 'bg-cyan-600 text-white font-bold'
                  : 'bg-[#131722] text-slate-300 hover:text-white border border-[#1e2433]'
              }`}
            >
              Em Férias / Afastados ({promoters.filter((p) => p.status === 'ferias' || p.status === 'afastado').length})
            </button>
            <button
              onClick={() => setChipFilter('arquivado')}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                chipFilter === 'arquivado'
                  ? 'bg-slate-700 text-white font-bold'
                  : 'bg-[#131722] text-slate-400 hover:text-white border border-[#1e2433]'
              }`}
            >
              Inativos ({promoters.filter((p) => p.status === 'arquivado').length})
            </button>
          </div>

          <div className="flex items-center gap-2 text-slate-400 font-mono text-[11px]">
            <span className="material-symbols-outlined text-sm text-emerald-400">database</span>
            <span>Conectado ao Supabase (public.promotores)</span>
          </div>
        </div>
      </section>

      {/* Data Table */}
      <section className="rounded-xl bg-[#171b26] border border-[#1e2433] shadow-xl overflow-hidden flex flex-col">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[1040px] text-xs">
            <thead>
              <tr className="bg-[#10141f] text-slate-400 font-mono text-[10px] uppercase tracking-wider h-11 border-b border-[#1e2433] select-none">
                <th className="w-10 px-4 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={selectedIds.length === filteredPromoters.length && filteredPromoters.length > 0}
                    onChange={(e) => handleSelectAll(e.target.checked)}
                    className="rounded bg-[#131722] border-slate-600 text-purple-600 focus:ring-0 cursor-pointer"
                  />
                </th>
                <th className="px-4 py-2">Promotor / Matrícula</th>
                <th className="px-4 py-2">Telefone / Contato</th>
                <th className="px-4 py-2">Cidade / UF</th>
                <th className="px-4 py-2">Supervisor</th>
                <th className="px-4 py-2">Equipe / Squad</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1e2433] text-slate-200">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center">
                    <div className="flex flex-col items-center justify-center space-y-3">
                      <div className="w-8 h-8 rounded-full border-2 border-purple-500 border-t-transparent animate-spin" />
                      <p className="text-xs font-semibold text-slate-400">Carregando promotores do Supabase...</p>
                    </div>
                  </td>
                </tr>
              ) : filteredPromoters.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center">
                    <div className="flex flex-col items-center justify-center space-y-2">
                      <span className="material-symbols-outlined text-4xl text-slate-600">badge</span>
                      <p className="text-sm font-semibold text-slate-300">
                        {search || statusFilter !== 'all' || chipFilter !== 'all'
                          ? 'Nenhum promotor encontrado com os filtros aplicados.'
                          : 'Nenhum promotor cadastrado na base de dados.'}
                      </p>
                      <p className="text-xs text-slate-500 max-w-sm">
                        Utilize o botão "+ Novo promotor" acima ou faça a importação de planilhas para popular o cadastro.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredPromoters.map((p) => {
                  const hasNoSupervisor = !p.supervisor || p.supervisor === 'Nenhum';
                  const hasNoSquad = !p.squad || p.squad === 'Nenhum';
                  const isSelected = selectedIds.includes(p.id);
                  const isArchived = p.status === 'arquivado';

                  return (
                    <tr
                      key={p.id}
                      className={`hover:bg-[#1c2230] transition-colors group ${
                        (hasNoSupervisor || hasNoSquad) && !isArchived
                          ? 'bg-amber-500/[0.02]'
                          : ''
                      }`}
                    >
                      <td className="px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => {
                            setSelectedIds((prev) =>
                              e.target.checked ? [...prev, p.id] : prev.filter((id) => id !== p.id)
                            );
                          }}
                          className="rounded bg-[#131722] border-slate-600 text-purple-600 focus:ring-0 cursor-pointer"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${
                              isArchived
                                ? 'bg-slate-800 text-slate-500 border border-slate-700'
                                : 'bg-purple-600/30 text-purple-300 border border-purple-500/40'
                            }`}
                          >
                            {p.initials}
                          </div>
                          <div className="flex flex-col">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-white group-hover:text-purple-300 transition-colors">
                                {p.name}
                              </span>
                              <span className="px-1.5 py-0.2 rounded bg-[#131722] font-mono text-[9px] text-cyan-400 font-bold border border-cyan-500/20">
                                {isArchived ? 'INATIVO' : p.contractType}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 text-slate-400 font-mono text-[11px]">
                              <span>{p.matricula}</span>
                              {p.cpf && (
                                <>
                                  <span>•</span>
                                  <span>CPF: {p.cpf}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {p.phone ? (
                          <a
                            href={`https://wa.me/55${p.phone.replace(/\D/g, '')}`}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1.5 text-cyan-400 hover:underline font-mono"
                          >
                            <span className="material-symbols-outlined text-sm text-emerald-400">chat</span>
                            {p.phone}
                          </a>
                        ) : (
                          <span className="text-slate-500 text-[11px]">Não informado</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-300">
                        {p.city} {p.state ? `- ${p.state}` : ''}
                      </td>
                      <td className="px-4 py-3">
                        {hasNoSupervisor && !isArchived ? (
                          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded bg-amber-500/10 text-amber-300 border border-amber-500/30">
                            <span className="font-mono text-[10px] font-bold">⚠️ Sem Supervisor</span>
                            <button
                              onClick={() => openEditModal(p)}
                              className="text-xs bg-amber-500/20 px-1.5 py-0.5 rounded text-amber-200 hover:bg-amber-500/30 font-semibold cursor-pointer"
                            >
                              Atribuir
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 text-slate-200">
                            <div className="w-5 h-5 rounded-full bg-[#131722] border border-[#1e2433] flex items-center justify-center text-[10px] font-mono text-cyan-400 font-bold">
                              {p.supervisor ? p.supervisor.split(' ').map((n) => n[0]).join('') : '--'}
                            </div>
                            <span>{p.supervisor || 'Nenhum'}</span>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {hasNoSquad && !isArchived ? (
                          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded bg-amber-500/10 text-amber-300 border border-amber-500/30">
                            <span className="font-mono text-[10px] font-bold">⚠️ Sem Equipe</span>
                            <button
                              onClick={() => openEditModal(p)}
                              className="text-xs bg-amber-500/20 px-1.5 py-0.5 rounded text-amber-200 hover:bg-amber-500/30 font-semibold cursor-pointer"
                            >
                              Alocar Squad
                            </button>
                          </div>
                        ) : (
                          <span className="px-2.5 py-1 rounded bg-[#131722] text-slate-300 font-medium border border-[#1e2433]">
                            {p.squad || 'Nenhum'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-mono text-[10px] font-bold ${
                            p.status === 'ativo'
                              ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-400'
                              : p.status === 'ferias'
                              ? 'bg-cyan-500/15 border border-cyan-500/30 text-cyan-300'
                              : 'bg-slate-800 border border-slate-700 text-slate-400'
                          }`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${p.status === 'ativo' ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
                          {p.status === 'ferias' ? 'EM FÉRIAS' : (p.status === 'arquivado' ? 'INATIVO' : p.status.toUpperCase())}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openEditModal(p)}
                            className="p-1.5 rounded hover:bg-[#131722] text-slate-400 hover:text-purple-400 cursor-pointer"
                            title="Editar Promotor"
                          >
                            <span className="material-symbols-outlined text-base">edit</span>
                          </button>
                          <button
                            onClick={() => onShowToast({ title: `Histórico de ${p.name}`, message: `Matrícula ${p.matricula} cadastrada no Supabase.`, type: 'info' })}
                            className="p-1.5 rounded hover:bg-[#131722] text-slate-400 hover:text-white cursor-pointer"
                            title="Histórico Operacional"
                          >
                            <span className="material-symbols-outlined text-base">history</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="p-4 bg-[#10141f] border-t border-[#1e2433] flex flex-col md:flex-row items-center justify-between gap-3 font-mono text-xs text-slate-400">
          <div>
            Exibindo <strong className="text-white">{filteredPromoters.length}</strong> de <strong className="text-white">{promoters.length}</strong> promotores cadastrados no Supabase
          </div>
          <div className="flex items-center gap-1">
            <button disabled className="p-1.5 rounded bg-[#171b26] border border-[#1e2433] text-slate-600 cursor-not-allowed">
              <span className="material-symbols-outlined text-base">chevron_left</span>
            </button>
            <button className="w-8 h-8 rounded bg-purple-600 text-white font-bold neon-purple-glow">1</button>
            <button disabled className="p-1.5 rounded bg-[#171b26] border border-[#1e2433] text-slate-600 cursor-not-allowed">
              <span className="material-symbols-outlined text-base">chevron_right</span>
            </button>
          </div>
        </div>
      </section>

      {/* Operational Sync Callout */}
      <section className="p-4 rounded-xl bg-[#171b26] border border-[#1e2433] shadow-sm flex items-start gap-4">
        <div className="w-9 h-9 rounded-lg bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 flex items-center justify-center shrink-0">
          <span className="material-symbols-outlined text-xl">cloud_sync</span>
        </div>
        <div className="flex flex-col space-y-0.5">
          <span className="text-xs font-bold text-white">Integridade de Dados &amp; Presença Operacional</span>
          <p className="text-[11px] text-slate-400">
            Promotores ativos vinculados a supervisores e equipes têm suas rotas sincronizadas em tempo real com o aplicativo de campo. Alterações salvas refletem imediatamente no módulo de <strong className="text-cyan-400">Controle de Presença</strong> e no cálculo de diárias.
          </p>
        </div>
      </section>

      {/* Modal: Cadastrar / Editar Promotor */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-fadeIn">
          <div className="relative w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-xl bg-[#171b26] border border-[#1e2433] shadow-2xl p-6 space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-[#1e2433]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-purple-600/20 text-purple-400 border border-purple-500/30 flex items-center justify-center">
                  <span className="material-symbols-outlined text-2xl">badge</span>
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">
                    {editingPromoter ? 'Editar Promotor CLT' : 'Cadastrar Promotor CLT'}
                  </h2>
                  <p className="text-[11px] text-slate-400">Preencha os dados contratuais e aloque o promotor na malha regional MK9.</p>
                </div>
              </div>
              <button onClick={() => setModalOpen(false)} className="p-1 rounded text-slate-400 hover:text-white cursor-pointer">
                <span className="material-symbols-outlined text-xl">close</span>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
              {/* Seção 1: Informações Pessoais */}
              <div className="space-y-2">
                <span className="text-[10px] font-bold font-mono text-purple-400 uppercase tracking-wider">
                  1. Informações Pessoais
                </span>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="md:col-span-2 space-y-1">
                    <label className="font-bold text-slate-300">Nome Completo *</label>
                    <input
                      type="text"
                      required
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      placeholder="ex: Lucas Albuquerque"
                      className="w-full h-10 px-3 bg-[#10141f] border border-[#1e2433] rounded-lg text-white focus:outline-none focus:border-purple-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="font-bold text-slate-300">CPF</label>
                    <input
                      type="text"
                      value={formCpf}
                      onChange={(e) => setFormCpf(e.target.value)}
                      placeholder="000.000.000-00"
                      className="w-full h-10 px-3 bg-[#10141f] border border-[#1e2433] rounded-lg text-white font-mono focus:outline-none focus:border-purple-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="font-bold text-slate-300">Telefone / WhatsApp</label>
                    <input
                      type="tel"
                      value={formPhone}
                      onChange={(e) => setFormPhone(e.target.value)}
                      placeholder="(11) 98721-3344"
                      className="w-full h-10 px-3 bg-[#10141f] border border-[#1e2433] rounded-lg text-white font-mono focus:outline-none focus:border-purple-500"
                    />
                  </div>
                  <div className="md:col-span-2 space-y-1">
                    <label className="font-bold text-slate-300">E-mail Corporativo</label>
                    <input
                      type="email"
                      value={formEmail}
                      onChange={(e) => setFormEmail(e.target.value)}
                      placeholder="promotor@mk9trade.com.br"
                      className="w-full h-10 px-3 bg-[#10141f] border border-[#1e2433] rounded-lg text-white focus:outline-none focus:border-purple-500"
                    />
                  </div>
                </div>
              </div>

              {/* Seção 2: Dados Contratuais & Base Operacional */}
              <div className="space-y-2 pt-2 border-t border-[#1e2433]">
                <span className="text-[10px] font-bold font-mono text-purple-400 uppercase tracking-wider">
                  2. Dados Contratuais &amp; Base Operacional
                </span>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <label className="font-bold text-slate-300">Matrícula MK9 *</label>
                    <input
                      type="text"
                      required
                      value={formMatricula}
                      onChange={(e) => setFormMatricula(e.target.value)}
                      className="w-full h-10 px-3 bg-[#10141f] border border-[#1e2433] rounded-lg text-white font-mono focus:outline-none focus:border-purple-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="font-bold text-slate-300">Cargo</label>
                    <select className="w-full h-10 px-3 bg-[#10141f] border border-[#1e2433] rounded-lg text-white focus:outline-none focus:border-purple-500 cursor-pointer">
                      <option>Promotor Padrão CLT</option>
                      <option>Promotor Líder de Campo</option>
                      <option>Promotor Degustador</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="font-bold text-slate-300">Cidade / UF de Base *</label>
                    <input
                      type="text"
                      required
                      value={formCity}
                      onChange={(e) => setFormCity(e.target.value)}
                      placeholder="São Paulo - SP"
                      className="w-full h-10 px-3 bg-[#10141f] border border-[#1e2433] rounded-lg text-white focus:outline-none focus:border-purple-500"
                    />
                  </div>
                </div>
              </div>

              {/* Seção 3: Alocação de Campo & Supervisão */}
              <div className="space-y-2 pt-2 border-t border-[#1e2433]">
                <span className="text-[10px] font-bold font-mono text-purple-400 uppercase tracking-wider">
                  3. Alocação de Campo &amp; Supervisão
                </span>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="font-bold text-slate-300">Supervisor Responsável</label>
                    <input
                      type="text"
                      value={formSupervisor}
                      onChange={(e) => setFormSupervisor(e.target.value)}
                      placeholder="ex: Renata Vasconcelos"
                      className="w-full h-10 px-3 bg-[#10141f] border border-[#1e2433] rounded-lg text-white focus:outline-none focus:border-purple-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="font-bold text-slate-300">Equipe / Squad</label>
                    <input
                      type="text"
                      value={formSquad}
                      onChange={(e) => setFormSquad(e.target.value)}
                      placeholder="ex: SP Capital Norte"
                      className="w-full h-10 px-3 bg-[#10141f] border border-[#1e2433] rounded-lg text-white focus:outline-none focus:border-purple-500"
                    />
                  </div>
                </div>
              </div>

              {/* Seção 4: Status & Arquivamento */}
              <div className="space-y-2 pt-2 border-t border-[#1e2433]">
                <span className="text-[10px] font-bold font-mono text-purple-400 uppercase tracking-wider">
                  4. Status &amp; Ciclo de Vida
                </span>
                <div className="flex items-center gap-4 bg-[#10141f] p-3 rounded-lg border border-[#1e2433]">
                  <label className="flex items-center gap-2 cursor-pointer font-semibold text-slate-300">
                    <input
                      type="radio"
                      name="promoterStatus"
                      checked={formStatus === 'ativo'}
                      onChange={() => setFormStatus('ativo')}
                      className="text-purple-600 focus:ring-0"
                    />
                    <span>Ativo em Operação</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer font-semibold text-slate-300">
                    <input
                      type="radio"
                      name="promoterStatus"
                      checked={formStatus === 'ferias'}
                      onChange={() => setFormStatus('ferias')}
                      className="text-purple-600 focus:ring-0"
                    />
                    <span>Em Férias</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer font-semibold text-slate-300">
                    <input
                      type="radio"
                      name="promoterStatus"
                      checked={formStatus === 'afastado'}
                      onChange={() => setFormStatus('afastado')}
                      className="text-purple-600 focus:ring-0"
                    />
                    <span>Afastado / Licença</span>
                  </label>
                </div>

                {editingPromoter && (
                  <div className="p-3.5 rounded-lg bg-[#10141f] border border-[#1e2433] flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
                    <div>
                      <span className="font-bold text-slate-200 block">Inativação em Conformidade</span>
                      <p className="text-[11px] text-slate-400">
                        Ao inativar, o colaborador deixa a escala ativa sem apagar o histórico de auditorias.
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => handleArchive(editingPromoter.id, editingPromoter.name)}
                      className="px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-semibold shrink-0 cursor-pointer disabled:opacity-50"
                    >
                      Inativar Promotor
                    </button>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-[#1e2433]">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-[#131722] hover:bg-[#1f2433] text-slate-300 font-semibold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-2.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-bold neon-purple-glow cursor-pointer disabled:opacity-50"
                >
                  {saving ? 'Salvando...' : 'Salvar Promotor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
