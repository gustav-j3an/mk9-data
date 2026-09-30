import React, { useState } from 'react';
import { ScreenId, ToastMessage, Freelancer } from '../types';
import { INITIAL_FREELANCERS } from '../data/mockData';

interface FreelancersViewProps {
  onNavigate: (screen: ScreenId) => void;
  onShowToast: (toast: Omit<ToastMessage, 'id'>) => void;
}

export const FreelancersView: React.FC<FreelancersViewProps> = ({
  onNavigate,
  onShowToast
}) => {
  const [freelancers, setFreelancers] = useState<Freelancer[]>(INITIAL_FREELANCERS);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [cityFilter, setCityFilter] = useState('all');
  const [priceFilter, setPriceFilter] = useState('all');
  const [chipFilter, setChipFilter] = useState<'all' | 'active' | 'inactive' | 'today'>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingFreelancer, setEditingFreelancer] = useState<Freelancer | null>(null);

  // Form states
  const [formName, setFormName] = useState('');
  const [formCpf, setFormCpf] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formCity, setFormCity] = useState('');
  const [formUf, setFormUf] = useState('SP');
  const [formPixType, setFormPixType] = useState<'cpf' | 'celular' | 'email' | 'aleatoria'>('celular');
  const [formPixKey, setFormPixKey] = useState('');
  const [formFee, setFormFee] = useState('190,00');
  const [formStatus, setFormStatus] = useState<'ativo' | 'inativo'>('ativo');
  const [formNotes, setFormNotes] = useState('');

  const openNewModal = () => {
    setEditingFreelancer(null);
    setFormName('');
    setFormCpf('');
    setFormPhone('');
    setFormCity('São Paulo');
    setFormUf('SP');
    setFormPixType('celular');
    setFormPixKey('');
    setFormFee('190,00');
    setFormStatus('ativo');
    setFormNotes('');
    setModalOpen(true);
  };

  const openEditModal = (f: Freelancer) => {
    setEditingFreelancer(f);
    setFormName(f.name);
    setFormCpf(f.cpf);
    setFormPhone(f.phone);
    setFormCity(f.city);
    setFormUf(f.state);
    setFormPixType(f.pixType);
    setFormPixKey(f.pixKey);
    setFormFee(f.defaultFee.toFixed(2).replace('.', ','));
    setFormStatus(f.status);
    setFormNotes(f.notes || '');
    setModalOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) return;

    const parsedFee = parseFloat(formFee.replace(',', '.')) || 190;
    const initials = formName
      .split(' ')
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();

    if (editingFreelancer) {
      setFreelancers((prev) =>
        prev.map((item) =>
          item.id === editingFreelancer.id
            ? {
                ...item,
                name: formName,
                initials,
                cpf: formCpf || item.cpf,
                phone: formPhone || item.phone,
                city: formCity,
                state: formUf,
                pixType: formPixType,
                pixKey: formPixKey,
                defaultFee: parsedFee,
                status: formStatus,
                notes: formNotes
              }
            : item
        )
      );
      onShowToast({
        title: 'Freelancer Atualizado',
        message: `Dados contratuais de ${formName} salvos com sucesso.`,
        type: 'success'
      });
    } else {
      const newF: Freelancer = {
        id: `free-${Date.now()}`,
        name: formName,
        initials,
        cpf: formCpf.includes('*') ? formCpf : `***.${formCpf.slice(-6, -2) || '492.118'}-**`,
        phone: formPhone,
        city: formCity,
        state: formUf,
        pixType: formPixType,
        pixKey: formPixKey,
        defaultFee: parsedFee,
        status: formStatus,
        lastActivity: 'Cadastrado agora',
        lastStore: 'Aguardando escala de rota',
        activeToday: formStatus === 'ativo',
        notes: formNotes
      };
      setFreelancers((prev) => [newF, ...prev]);
      onShowToast({
        title: 'Novo Freelancer Cadastrado',
        message: `${formName} adicionado ao banco operacional de prestadores.`,
        type: 'success'
      });
    }

    setModalOpen(false);
  };

  const handleToggleStatus = (id: string) => {
    setFreelancers((prev) =>
      prev.map((f) =>
        f.id === id ? { ...f, status: f.status === 'ativo' ? 'inativo' : 'ativo' } : f
      )
    );
    onShowToast({
      title: 'Status Alterado',
      message: 'Status operacional do prestador atualizado.',
      type: 'info'
    });
  };

  const handleDelete = (id: string, name: string) => {
    setFreelancers((prev) => prev.filter((f) => f.id !== id));
    onShowToast({
      title: 'Prestador Removido',
      message: `${name} foi desvinculado da base.`,
      type: 'warning'
    });
  };

  const filteredFreelancers = freelancers.filter((f) => {
    const matchesSearch =
      f.name.toLowerCase().includes(search.toLowerCase()) ||
      f.cpf.toLowerCase().includes(search.toLowerCase()) ||
      f.phone.toLowerCase().includes(search.toLowerCase()) ||
      f.pixKey.toLowerCase().includes(search.toLowerCase());

    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' && f.status === 'ativo') ||
      (statusFilter === 'inactive' && f.status === 'inativo');

    const matchesCity =
      cityFilter === 'all' || `${f.city} - ${f.state}` === cityFilter;

    let matchesPrice = true;
    if (priceFilter === '150-180') matchesPrice = f.defaultFee <= 180;
    if (priceFilter === '181-200') matchesPrice = f.defaultFee >= 181 && f.defaultFee <= 200;
    if (priceFilter === '201-250') matchesPrice = f.defaultFee > 200;

    let matchesChip = true;
    if (chipFilter === 'active') matchesChip = f.status === 'ativo';
    if (chipFilter === 'inactive') matchesChip = f.status === 'inativo';
    if (chipFilter === 'today') matchesChip = !!f.activeToday;

    return matchesSearch && matchesStatus && matchesCity && matchesPrice && matchesChip;
  });

  return (
    <div className="w-full px-4 lg:px-8 py-6 max-w-[1720px] mx-auto space-y-6">
      {/* Top Command Header */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight flex items-center gap-2">
              Gestão de Freelancers
            </h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#171b26] border border-cyan-500/30 text-cyan-400 font-mono text-[11px] font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
              BANCO DE PRESTADORES DE CAMPO
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-400">
            Cadastre freelancers e acompanhe seus dados operacionais, valores de diárias e conciliação de rotas.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => onShowToast({ title: 'Exportação Iniciada', message: 'Gerando arquivo CSV com todos os freelancers.', type: 'info' })}
            className="px-4 py-2 rounded-lg bg-[#171b26] hover:bg-[#1f2433] text-slate-200 border border-[#1e2433] text-xs font-semibold transition-all flex items-center gap-2 shadow-sm"
          >
            <span className="material-symbols-outlined text-[18px] text-cyan-400">download</span>
            <span>Exportar Base</span>
          </button>
          <button
            onClick={openNewModal}
            className="px-5 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold neon-purple-glow transition-all flex items-center gap-2 active:scale-95 shadow-md cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">person_add</span>
            <span>+ Novo freelancer</span>
          </button>
        </div>
      </div>

      {/* KPI HUD Cards (4 Columns) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* Card 1 */}
        <div className="bg-[#171b26] border border-[#1e2433] hover:border-emerald-500/40 p-4 rounded-xl shadow-lg relative overflow-hidden transition-all group">
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-emerald-500" />
          <div className="flex items-start justify-between">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider font-mono">
              FREELANCERS ATIVOS
            </span>
            <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <span className="material-symbols-outlined text-[18px]">engineering</span>
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-white font-mono tracking-tight">248</span>
            <span className="inline-flex items-center text-emerald-400 font-mono text-[11px] font-bold bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded">
              +14 este mês
            </span>
          </div>
          <div className="mt-2 pt-2 border-t border-[#1e2433] flex items-center justify-between text-xs text-slate-400">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              42 em campo hoje
            </span>
            <span className="font-mono text-[11px] text-cyan-400 font-semibold">79.5% ocupação</span>
          </div>
        </div>

        {/* Card 2 */}
        <div className="bg-[#171b26] border border-[#1e2433] hover:border-slate-600 p-4 rounded-xl shadow-lg relative overflow-hidden transition-all group">
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-slate-600" />
          <div className="flex items-start justify-between">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider font-mono">
              FREELANCERS INATIVOS
            </span>
            <div className="p-1.5 rounded-lg bg-slate-800/80 text-slate-400 border border-slate-700/40">
              <span className="material-symbols-outlined text-[18px]">person_off</span>
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-slate-300 font-mono tracking-tight">64</span>
            <span className="inline-flex items-center text-slate-400 font-mono text-[11px] bg-slate-800/60 border border-slate-700/50 px-2 py-0.5 rounded">
              20.5% da base
            </span>
          </div>
          <div className="mt-2 pt-2 border-t border-[#1e2433] flex items-center justify-between text-xs text-slate-400">
            <span>Disponíveis para reativação</span>
            <span className="font-mono text-[11px] text-amber-400">12 em pausa &gt; 60d</span>
          </div>
        </div>

        {/* Card 3 */}
        <div className="bg-[#171b26] border border-[#1e2433] hover:border-cyan-500/40 p-4 rounded-xl shadow-lg relative overflow-hidden transition-all group">
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-cyan-400" />
          <div className="flex items-start justify-between">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider font-mono">
              VALOR MÉDIO DA DIÁRIA
            </span>
            <div className="p-1.5 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              <span className="material-symbols-outlined text-[18px]">payments</span>
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-white font-mono tracking-tight">R$ 185,40</span>
            <span className="inline-flex items-center text-cyan-400 font-mono text-[11px] font-bold bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 rounded">
              +2.1% trim
            </span>
          </div>
          <div className="mt-2 pt-2 border-t border-[#1e2433] flex items-center justify-between text-xs text-slate-400">
            <span>Faixa operacional R$ 160 - R$ 220</span>
            <span className="font-mono text-[11px] text-emerald-400 font-semibold">Dentro do Budget</span>
          </div>
        </div>

        {/* Card 4 */}
        <div className="bg-[#171b26] border border-[#1e2433] hover:border-purple-500/40 p-4 rounded-xl shadow-lg relative overflow-hidden transition-all group">
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-purple-600" />
          <div className="flex items-start justify-between">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider font-mono">
              DIÁRIAS NO PERÍODO
            </span>
            <div className="p-1.5 rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20">
              <span className="material-symbols-outlined text-[18px]">calendar_view_week</span>
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-white font-mono tracking-tight">1.284</span>
            <span className="inline-flex items-center text-cyan-300 font-mono text-[11px] font-bold bg-cyan-500/15 border border-cyan-500/30 px-2 py-0.5 rounded">
              R$ 238.053,60
            </span>
          </div>
          <div className="mt-2 pt-2 border-t border-[#1e2433] flex items-center justify-between text-xs text-slate-400">
            <span className="flex items-center gap-1 text-slate-300">
              <span className="material-symbols-outlined text-[14px] text-emerald-400">sync</span>
              Sincronizado com Diárias
            </span>
            <span className="font-mono text-[11px] text-emerald-400">100% auditado</span>
          </div>
        </div>
      </div>

      {/* Filter & Operational Controls Bar */}
      <div className="bg-[#171b26] border border-[#1e2433] p-4 rounded-xl shadow-md space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          {/* Search Input */}
          <div className="md:col-span-5 relative">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[18px]">
              search
            </span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar freelancer por nome, CPF, telefone ou chave PIX..."
              className="w-full h-10 pl-9 pr-14 bg-[#131722] border border-[#1e2433] rounded-lg text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-purple-500"
            />
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2 hidden sm:flex items-center px-1.5 py-0.5 rounded bg-[#1f2433] border border-[#334155]/40 text-[10px] text-slate-400 font-mono">
              Ctrl+K
            </div>
          </div>

          {/* Status Dropdown */}
          <div className="md:col-span-2">
            <div className="relative">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full h-10 px-3 bg-[#131722] border border-[#1e2433] text-slate-200 text-xs rounded-lg appearance-none cursor-pointer focus:outline-none focus:border-purple-500 pr-8"
              >
                <option value="all">Todos os Status</option>
                <option value="active">Apenas Ativos</option>
                <option value="inactive">Apenas Inativos</option>
              </select>
              <span className="material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none text-[18px]">
                expand_more
              </span>
            </div>
          </div>

          {/* Cidades Dropdown */}
          <div className="md:col-span-3">
            <div className="relative">
              <select
                value={cityFilter}
                onChange={(e) => setCityFilter(e.target.value)}
                className="w-full h-10 px-3 bg-[#131722] border border-[#1e2433] text-slate-200 text-xs rounded-lg appearance-none cursor-pointer focus:outline-none focus:border-purple-500 pr-8"
              >
                <option value="all">Todas as Cidades / UF</option>
                <option value="São Paulo - SP">São Paulo - SP</option>
                <option value="Campinas - SP">Campinas - SP</option>
                <option value="Barueri - SP">Barueri - SP</option>
                <option value="Rio de Janeiro - RJ">Rio de Janeiro - RJ</option>
                <option value="Belo Horizonte - MG">Belo Horizonte - MG</option>
              </select>
              <span className="material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none text-[18px]">
                location_on
              </span>
            </div>
          </div>

          {/* Faixa de Diária */}
          <div className="md:col-span-2">
            <div className="relative">
              <select
                value={priceFilter}
                onChange={(e) => setPriceFilter(e.target.value)}
                className="w-full h-10 px-3 bg-[#131722] border border-[#1e2433] text-slate-200 text-xs rounded-lg appearance-none cursor-pointer focus:outline-none focus:border-purple-500 pr-8"
              >
                <option value="all">Faixa de Diária</option>
                <option value="150-180">Até R$ 180,00</option>
                <option value="181-200">R$ 185 a R$ 200</option>
                <option value="201-250">Acima de R$ 200,00</option>
              </select>
              <span className="material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none text-[18px]">
                attach_money
              </span>
            </div>
          </div>
        </div>

        {/* Quick Filter Chips & Sorter */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#1e2433]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider font-mono mr-1">
              Filtros Rápidos:
            </span>
            <button
              onClick={() => setChipFilter('all')}
              className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                chipFilter === 'all'
                  ? 'bg-purple-600 text-white font-bold neon-purple-glow'
                  : 'bg-[#131722] border border-[#1e2433] text-slate-300 hover:text-white'
              }`}
            >
              Todos ({freelancers.length})
            </button>
            <button
              onClick={() => setChipFilter('active')}
              className={`px-3 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all ${
                chipFilter === 'active'
                  ? 'bg-emerald-600 text-white font-bold'
                  : 'bg-[#131722] border border-[#1e2433] text-slate-300 hover:text-white'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              Ativos ({freelancers.filter((f) => f.status === 'ativo').length})
            </button>
            <button
              onClick={() => setChipFilter('inactive')}
              className={`px-3 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all ${
                chipFilter === 'inactive'
                  ? 'bg-slate-700 text-white font-bold'
                  : 'bg-[#131722] border border-[#1e2433] text-slate-300 hover:text-white'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
              Inativos ({freelancers.filter((f) => f.status === 'inativo').length})
            </button>
            <button
              onClick={() => setChipFilter('today')}
              className={`px-3 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all ${
                chipFilter === 'today'
                  ? 'bg-cyan-600 text-white font-bold'
                  : 'bg-[#131722] border border-[#1e2433] text-cyan-300 hover:text-white'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
              Com Diária Hoje ({freelancers.filter((f) => f.activeToday).length})
            </button>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
            <span className="material-symbols-outlined text-[16px] text-slate-500">tune</span>
            <span>Ordenação: <strong className="text-slate-200 font-semibold">Última Atividade</strong></span>
          </div>
        </div>
      </div>

      {/* Main Operational Table Section */}
      <div className="bg-[#171b26] border border-[#1e2433] rounded-xl shadow-xl overflow-hidden flex flex-col">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[1020px] text-xs">
            <thead>
              <tr className="bg-[#10141f] border-b border-[#1e2433] text-slate-400 font-mono text-[10px] uppercase tracking-wider h-11 select-none">
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    className="rounded bg-[#131722] border-[#334155] text-purple-600 focus:ring-0 cursor-pointer w-4 h-4"
                  />
                </th>
                <th className="px-4 py-3">FREELANCER / CPF</th>
                <th className="px-4 py-3">TELEFONE / CONTATO</th>
                <th className="px-4 py-3">CIDADE / UF</th>
                <th className="px-4 py-3">VALOR PADRÃO</th>
                <th className="px-4 py-3">CHAVE PIX</th>
                <th className="px-4 py-3 text-center">STATUS</th>
                <th className="px-4 py-3">ÚLTIMA ATIVIDADE</th>
                <th className="px-4 py-3 text-right">AÇÕES</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1e2433] text-slate-200">
              {filteredFreelancers.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-slate-400 font-sans">
                    <div className="flex flex-col items-center justify-center space-y-2">
                      <span className="material-symbols-outlined text-4xl text-slate-600">person_off</span>
                      <p className="text-sm font-semibold text-slate-300">Não há dados cadastrados ainda.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredFreelancers.map((f) => (
                  <tr key={f.id} className="hover:bg-[#1c2230] transition-colors group">
                    <td className="px-4 py-3.5">
                      <input
                        type="checkbox"
                        className="rounded bg-[#131722] border-[#334155] text-purple-600 focus:ring-0 cursor-pointer w-4 h-4"
                      />
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${
                            f.status === 'ativo'
                              ? 'bg-purple-600/30 text-purple-300 border border-purple-500/40'
                              : 'bg-slate-800 text-slate-400 border border-slate-700'
                          }`}
                        >
                          {f.initials}
                        </div>
                        <div className="flex flex-col">
                          <span className="font-bold text-slate-100 group-hover:text-purple-300 transition-colors">
                            {f.name}
                          </span>
                          <span className="font-mono text-[11px] text-slate-400">CPF: {f.cpf}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-1.5 font-mono text-xs text-slate-300">
                        <a
                          href={`https://wa.me/55${f.phone.replace(/\D/g, '')}`}
                          target="_blank"
                          rel="noreferrer"
                          className="p-1 rounded bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/25 transition-colors"
                          title="Conversar no WhatsApp"
                        >
                          <span className="material-symbols-outlined text-[15px]">chat</span>
                        </a>
                        <span>{f.phone}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-1.5 text-slate-300">
                        <span className="material-symbols-outlined text-[15px] text-slate-500">location_on</span>
                        <span>{f.city} - {f.state}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="font-mono text-xs font-bold text-slate-100">
                        R$ {f.defaultFee.toFixed(2).replace('.', ',')}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-1 font-mono text-[11px] text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20 w-max">
                        <span className="material-symbols-outlined text-[13px]">pin</span>
                        <span>{f.pixKey}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-center">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-mono text-[10px] font-bold ${
                          f.status === 'ativo'
                            ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-400'
                            : 'bg-slate-800 border border-slate-700 text-slate-400'
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${f.status === 'ativo' ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
                        {f.status.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex flex-col">
                        <span className="font-semibold text-emerald-400 text-xs flex items-center gap-1">
                          <span className="material-symbols-outlined text-[14px]">storefront</span>
                          {f.lastActivity}
                        </span>
                        <span className="text-[11px] text-slate-400">{f.lastStore}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => onShowToast({ title: `Histórico de ${f.name}`, message: `28 diárias realizadas nos últimos 90 dias.`, type: 'info' })}
                          className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-[#131722] transition-colors"
                          title="Ver Histórico"
                        >
                          <span className="material-symbols-outlined text-[17px]">visibility</span>
                        </button>
                        <button
                          onClick={() => openEditModal(f)}
                          className="p-1 rounded-md text-slate-400 hover:text-purple-400 hover:bg-[#131722] transition-colors"
                          title="Editar"
                        >
                          <span className="material-symbols-outlined text-[17px]">edit</span>
                        </button>
                        <button
                          onClick={() => handleToggleStatus(f.id)}
                          className={`p-1 rounded-md transition-colors ${
                            f.status === 'ativo'
                              ? 'text-slate-400 hover:text-rose-400'
                              : 'text-slate-400 hover:text-emerald-400'
                          }`}
                          title={f.status === 'ativo' ? 'Desativar' : 'Reativar'}
                        >
                          <span className="material-symbols-outlined text-[17px]">
                            {f.status === 'ativo' ? 'pause_circle' : 'power_settings_new'}
                          </span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Table Footer */}
        <div className="px-4 py-3 bg-[#10141f] border-t border-[#1e2433] flex flex-wrap items-center justify-between gap-3 text-xs">
          <span className="text-slate-400 font-mono">
            Exibindo <strong className="text-slate-200">{filteredFreelancers.length}</strong> de{' '}
            <strong className="text-slate-200">{freelancers.length}</strong> freelancers cadastrados
          </span>
          <div className="flex items-center gap-1.5 font-mono">
            <button disabled className="w-7 h-7 rounded flex items-center justify-center bg-[#171b26] border border-[#1e2433] text-slate-600 cursor-not-allowed">
              <span className="material-symbols-outlined text-[16px]">chevron_left</span>
            </button>
            <button className="w-7 h-7 rounded flex items-center justify-center bg-purple-600 text-white font-bold neon-purple-glow">
              1
            </button>
            <button className="w-7 h-7 rounded flex items-center justify-center bg-[#171b26] border border-[#1e2433] text-slate-300 hover:bg-[#1f2433]">
              2
            </button>
            <button className="w-7 h-7 rounded flex items-center justify-center bg-[#171b26] border border-[#1e2433] text-slate-300 hover:bg-[#1f2433]">
              3
            </button>
            <span className="px-1 text-slate-500">...</span>
            <button className="w-7 h-7 rounded flex items-center justify-center bg-[#171b26] border border-[#1e2433] text-slate-300 hover:bg-[#1f2433]">
              45
            </button>
            <button className="w-7 h-7 rounded flex items-center justify-center bg-[#171b26] border border-[#1e2433] text-slate-300 hover:bg-[#1f2433]">
              <span className="material-symbols-outlined text-[16px]">chevron_right</span>
            </button>
          </div>
        </div>
      </div>

      {/* Card Inferior: Integridade & Auditoria Operacional */}
      <div className="bg-[#171b26] border border-[#1e2433] rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-[22px]">verified</span>
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-200">
                Integridade de Pagamentos &amp; Compliance Operacional
              </span>
              <span className="px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 font-mono text-[10px] font-bold">
                100% OK
              </span>
            </div>
            <span className="text-[11px] text-slate-400">
              Todos os prestadores possuem validação cadastral ativa para alocação direta em diárias e rotas semanais.
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => onShowToast({ title: 'Auditoria PIX Concluída', message: 'Nenhuma chave com pendência bancária detectada.', type: 'success' })}
            className="px-3 py-1.5 rounded-lg bg-[#131722] hover:bg-[#1f2433] border border-[#1e2433] text-slate-300 hover:text-white text-xs font-medium transition-colors"
          >
            Auditar Chaves PIX
          </button>
          <button
            onClick={() => onShowToast({ title: 'Sincronizar Lote', message: 'Validação de CPFs na Receita Federal atualizada.', type: 'info' })}
            className="px-3 py-1.5 rounded-lg bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/30 text-purple-300 text-xs font-semibold transition-colors flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[15px]">sync</span>
            Sincronizar Lote
          </button>
        </div>
      </div>

      {/* Modal de Cadastro de Novo Freelancer */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn">
          <div className="relative w-full max-w-2xl bg-[#171b26] border border-[#1e2433] rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
            {/* Top Gradient */}
            <div className="h-1 bg-gradient-to-r from-purple-600 via-indigo-500 to-cyan-400" />

            {/* Header */}
            <div className="p-5 border-b border-[#1e2433] flex items-center justify-between bg-[#131722]/80">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-purple-600/20 border border-purple-500/40 text-purple-400 flex items-center justify-center">
                  <span className="material-symbols-outlined text-[20px]">
                    {editingFreelancer ? 'edit' : 'person_add'}
                  </span>
                </div>
                <div className="flex flex-col">
                  <h2 className="text-base font-bold text-white">
                    {editingFreelancer ? 'Editar Freelancer' : 'Cadastrar Novo Freelancer'}
                  </h2>
                  <p className="text-[11px] text-slate-400">
                    Preencha as informações contratuais e financeiras do prestador.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-[#1f2433] transition-colors"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-4 text-xs">
              <div className="flex flex-col gap-1.5">
                <label className="font-bold text-slate-300">
                  Nome Completo <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="ex: Carlos Eduardo Silva"
                  className="h-10 px-3 bg-[#10141f] border border-[#1e2433] focus:border-purple-500 text-slate-100 placeholder:text-slate-500 rounded-lg focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="font-bold text-slate-300">
                    CPF <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formCpf}
                    onChange={(e) => setFormCpf(e.target.value)}
                    placeholder="000.000.000-00"
                    className="h-10 px-3 bg-[#10141f] border border-[#1e2433] focus:border-purple-500 text-slate-100 placeholder:text-slate-500 rounded-lg font-mono focus:outline-none"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="font-bold text-slate-300">
                    Telefone / WhatsApp <span className="text-rose-400">*</span>
                  </label>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-[16px]">
                      call
                    </span>
                    <input
                      type="tel"
                      required
                      value={formPhone}
                      onChange={(e) => setFormPhone(e.target.value)}
                      placeholder="(11) 98765-4321"
                      className="w-full h-10 pl-9 pr-3 bg-[#10141f] border border-[#1e2433] focus:border-purple-500 text-slate-100 placeholder:text-slate-500 rounded-lg font-mono focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 flex flex-col gap-1.5">
                  <label className="font-bold text-slate-300">
                    Cidade <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formCity}
                    onChange={(e) => setFormCity(e.target.value)}
                    placeholder="São Paulo"
                    className="h-10 px-3 bg-[#10141f] border border-[#1e2433] focus:border-purple-500 text-slate-100 rounded-lg focus:outline-none"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="font-bold text-slate-300">
                    UF <span className="text-rose-400">*</span>
                  </label>
                  <select
                    value={formUf}
                    onChange={(e) => setFormUf(e.target.value)}
                    className="h-10 px-2 bg-[#10141f] border border-[#1e2433] focus:border-purple-500 text-slate-100 font-bold font-mono rounded-lg focus:outline-none text-center cursor-pointer"
                  >
                    <option value="SP">SP</option>
                    <option value="RJ">RJ</option>
                    <option value="MG">MG</option>
                    <option value="PR">PR</option>
                    <option value="SC">SC</option>
                    <option value="RS">RS</option>
                    <option value="BA">BA</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="font-bold text-slate-300">
                    Tipo Chave PIX <span className="text-rose-400">*</span>
                  </label>
                  <select
                    value={formPixType}
                    onChange={(e) => setFormPixType(e.target.value as any)}
                    className="h-10 px-3 bg-[#10141f] border border-[#1e2433] focus:border-purple-500 text-slate-100 rounded-lg focus:outline-none cursor-pointer"
                  >
                    <option value="celular">Celular</option>
                    <option value="cpf">CPF</option>
                    <option value="email">E-mail</option>
                    <option value="aleatoria">Chave Aleatória</option>
                  </select>
                </div>
                <div className="sm:col-span-2 flex flex-col gap-1.5">
                  <label className="font-bold text-slate-300">
                    Chave PIX <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formPixKey}
                    onChange={(e) => setFormPixKey(e.target.value)}
                    placeholder="Insira a chave para repasse da diária"
                    className="h-10 px-3 bg-[#10141f] border border-[#1e2433] focus:border-purple-500 text-slate-100 placeholder:text-slate-500 font-mono rounded-lg focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <label className="font-bold text-slate-300">
                      Valor Padrão da Diária <span className="text-rose-400">*</span>
                    </label>
                    <span className="text-[10px] text-cyan-400 font-mono">Base 8h</span>
                  </div>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-mono font-bold">
                      R$
                    </span>
                    <input
                      type="text"
                      required
                      value={formFee}
                      onChange={(e) => setFormFee(e.target.value)}
                      className="w-full h-10 pl-9 pr-3 bg-[#10141f] border border-[#1e2433] focus:border-purple-500 text-slate-100 font-mono font-bold rounded-lg focus:outline-none"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="font-bold text-slate-300">Status Inicial</label>
                  <div className="grid grid-cols-2 gap-2 h-10">
                    <button
                      type="button"
                      onClick={() => setFormStatus('ativo')}
                      className={`flex items-center justify-center gap-2 rounded-lg border font-bold transition-all ${
                        formStatus === 'ativo'
                          ? 'bg-emerald-500/15 border-emerald-500 text-emerald-400'
                          : 'bg-[#10141f] border-[#1e2433] text-slate-400'
                      }`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      ATIVO
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormStatus('inativo')}
                      className={`flex items-center justify-center gap-2 rounded-lg border font-bold transition-all ${
                        formStatus === 'inativo'
                          ? 'bg-slate-700 border-slate-500 text-white'
                          : 'bg-[#10141f] border-[#1e2433] text-slate-400'
                      }`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                      INATIVO
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="font-bold text-slate-300 flex items-center justify-between">
                  <span>Observação Operacional / Perfil de PDV</span>
                  <span className="text-[10px] text-slate-500 font-normal">Opcional</span>
                </label>
                <textarea
                  rows={2}
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="ex: Experiência em reposição de pesados, atacarejo, auditores de geladeira..."
                  className="p-3 bg-[#10141f] border border-[#1e2433] focus:border-purple-500 text-slate-100 placeholder:text-slate-500 rounded-lg resize-none focus:outline-none"
                />
              </div>

              <div className="pt-3 border-t border-[#1e2433] flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-[#131722] hover:bg-[#1f2433] border border-[#1e2433] text-slate-300 font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-bold neon-purple-glow shadow-md flex items-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-[17px]">check</span>
                  <span>Salvar Freelancer</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
