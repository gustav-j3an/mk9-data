import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRhAccess, type RhView } from '../lib/rhAccess';
import { useAuth } from '../auth/AuthProvider';
import { useFaltasAtestadosAccess } from '../lib/faltasAtestadosAccess';
import { supabase } from '../lib/supabase';
import {
  absenceTypes, buildAbsenceSaveArgs, externalWriteEnabled, inclusiveDays, isBindingSelectable,
  resolveBinding, reviewNotSent, validateAbsenceDraft, type AbsenceDraft, type CrmBinding, type LocalAbsenceRecord
} from '../lib/faltasAtestados';
import { filterAbsenceHistory, parseAbsenceHistory, type ParsedAbsenceHistory } from '../lib/faltasAtestadosReceived';

type Area = 'overview' | 'new' | 'history' | 'people' | 'projects' | 'settings';
const areas: { id: Area; label: string; icon: string }[] = [
  { id: 'overview', label: 'Visão geral', icon: 'dashboard' },
  { id: 'new', label: 'Nova ausência', icon: 'note_add' },
  { id: 'history', label: 'Histórico de lançamentos', icon: 'history' },
  { id: 'people', label: 'Colaboradores e matrículas', icon: 'badge' },
  { id: 'projects', label: 'Projetos CRM', icon: 'workspaces' },
  { id: 'settings', label: 'Configurações', icon: 'settings' }
];
const panel = 'rounded-xl border border-[#CFCDC5] bg-[#F7F6F2] p-4 sm:p-5';
const field = 'mt-1 w-full rounded-lg border border-[#CFCDC5] bg-white px-3 py-2.5 text-sm text-[#171717] focus:border-[#286FF5] focus:outline-none focus:ring-2 focus:ring-[#286FF5]/20';
const button = 'rounded-lg border border-[#CFCDC5] px-3 py-2 text-sm font-medium text-[#383832] hover:border-[#286FF5]';
const primary = 'rounded-lg bg-[#222222] px-4 py-2.5 text-sm font-semibold text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-40';
const formatDate = (value: string | null) => value ? new Date(value.length === 10 ? `${value}T12:00:00` : value).toLocaleDateString('pt-BR') : 'Sem data final';
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const formatStatus = (value: string) => ({ aprovado: 'Aprovado', pendente: 'Pendente', revogado: 'Revogado' }[value] || 'Sem vínculo');
const emptyDraft = (): AbsenceDraft => ({ alocacaoId: '', tipo: '', inicio: '', fim: '', retorno: '', justificativa: '' });

export function FaltasAtestadosModule() {
  const { session } = useAuth();
  const rh = useRhAccess();
  const permission = useFaltasAtestadosAccess();
  const [area, setArea] = useState<Area>('overview');
  const [bindings, setBindings] = useState<CrmBinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<AbsenceDraft>(emptyDraft);
  const [formError, setFormError] = useState('');
  const [localRecords, setLocalRecords] = useState<LocalAbsenceRecord[]>([]);
  const [localLoading, setLocalLoading] = useState(false);
  const [localError, setLocalError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState('');
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [history, setHistory] = useState<ParsedAbsenceHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [historyView, setHistoryView] = useState<RhView>('mine');
  const [historyStart, setHistoryStart] = useState(() => `${today().slice(0, 7)}-01`);
  const [historyEnd, setHistoryEnd] = useState(today);
  const [historyProject, setHistoryProject] = useState('');
  const [historyType, setHistoryType] = useState('');
  const [historyMatricula, setHistoryMatricula] = useState('');
  const [historyRefresh, setHistoryRefresh] = useState(0);

  const availableRhViews = (['mine', 'team', 'management'] as RhView[]).filter(view => rh[view]);
  const selectedHistoryView = availableRhViews.includes(historyView) ? historyView : availableRhViews[0];

  const loadBindings = useCallback(async () => {
    if (!supabase || !permission.allowed) { setBindings([]); setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const { data, error: rpcError } = await supabase.rpc('mk9_faltas_atestados_bindings').abortSignal(AbortSignal.timeout(10000));
      if (rpcError) throw rpcError;
      if (!Array.isArray(data)) throw new Error('invalid response');
      setBindings(data as CrmBinding[]);
    } catch {
      setError('Não foi possível consultar os vínculos CRM autorizados. Tente novamente.');
    } finally { setLoading(false); }
  }, [permission.allowed]);

  useEffect(() => { void loadBindings(); }, [loadBindings]);

  const loadLocalRecords = useCallback(async () => {
    if (!supabase || !permission.allowed) { setLocalRecords([]); return; }
    setLocalLoading(true); setLocalError('');
    try {
      const { data, error: rpcError } = await supabase.rpc('mk9_faltas_atestados_local_records').abortSignal(AbortSignal.timeout(10000));
      if (rpcError || !Array.isArray(data)) throw rpcError || new Error('invalid response');
      setLocalRecords(data as LocalAbsenceRecord[]);
    } catch { setLocalError('Não foi possível consultar os lançamentos locais salvos.'); }
    finally { setLocalLoading(false); }
  }, [permission.allowed]);

  useEffect(() => { void loadLocalRecords(); }, [loadLocalRecords]);

  useEffect(() => {
    if (loading) { setHistoryLoading(false); return; }
    if (error) { setHistory(null); setHistoryLoading(false); setHistoryError(error); return; }
    if (!permission.allowed || !session?.access_token || !selectedHistoryView) {
      setHistory(null);
      setHistoryError('');
      setHistoryLoading(false);
      return;
    }
    const controller = new AbortController();
    let disposed = false;
    const timer = setTimeout(() => controller.abort(), 35_000);
    setHistoryLoading(true);
    setHistoryError('');
    const params = new URLSearchParams({ view: selectedHistoryView, data_inicio: historyStart, data_fim: historyEnd });
    void (async () => {
      try {
        const response = await fetch(`/api/faltas-atestados/ausencias?${params}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: 'no-store',
          signal: controller.signal
        });
        const body: unknown = await response.json();
        if (!response.ok) {
          if (response.status === 400) throw new Error('Selecione um período válido de até um ano.');
          if (response.status === 401) throw new Error('Entre novamente para consultar estes registros.');
          if (response.status === 403) throw new Error('Sua conta não possui a permissão do módulo ou o escopo RH para esta consulta.');
          if (isObject(body) && body.message === 'Há muitas ocorrências neste período. Selecione um intervalo menor.') throw new Error('Há muitas ocorrências neste período. Selecione um intervalo menor.');
          throw new Error('A consulta ao CRM está temporariamente indisponível. Tente novamente.');
        }
        const parsed = parseAbsenceHistory(body, bindings);
        if (!disposed) setHistory(parsed);
      } catch (error) {
        if (!disposed) {
          setHistory(null);
          setHistoryError(controller.signal.aborted ? 'A consulta excedeu o tempo limite. Tente novamente.' : error instanceof Error ? error.message : 'A consulta ao CRM está temporariamente indisponível. Tente novamente.');
        }
      } finally {
        clearTimeout(timer);
        if (!disposed) setHistoryLoading(false);
      }
    })();
    return () => { disposed = true; clearTimeout(timer); controller.abort(); };
  }, [permission.allowed, session?.access_token, selectedHistoryView, historyStart, historyEnd, historyRefresh, bindings, loading, error]);

  const selectedBinding = resolveBinding(bindings, draft.alocacaoId);
  const selectable = useMemo(() => bindings.filter(row => isBindingSelectable(row)), [bindings]);
  const activeGet = rh.mine || rh.team || rh.management;
  const distinctPeople = new Set(bindings.map(row => row.promotor_id)).size;
  const approved = bindings.filter(row => row.identidade_status === 'aprovado' && row.alocacao_status === 'aprovado' && isBindingSelectable(row)).length;
  const pending = bindings.filter(row => row.identidade_status === 'pendente' || row.alocacao_status === 'pendente').length;
  const projectRows = useMemo(() => {
    const projects = new Map<string, CrmBinding[]>();
    for (const row of bindings) projects.set(row.projeto_crm, [...(projects.get(row.projeto_crm) || []), row]);
    return [...projects.entries()].map(([id, rows]) => ({ id, rows }));
  }, [bindings]);
  const searched = bindings.filter(row => `${row.colaborador} ${row.matricula_interna} ${row.matricula_externa} ${row.projeto_crm} ${row.supervisor}`.toLowerCase().includes(query.trim().toLowerCase()));
  const set = (key: keyof AbsenceDraft, value: string) => setDraft(current => ({ ...current, [key]: value }));
  const resetForm = () => { setDraft(emptyDraft()); setStep(0); setFormError(''); setEditingRecordId(null); setSavedMessage(''); };

  const saveDraft = async () => {
    const issues = validateAbsenceDraft(draft, selectedBinding);
    if (issues.length) { setFormError(issues[0]); return; }
    if (!supabase || !selectedBinding) { setFormError('A persistência não está disponível no momento.'); return; }
    setSaving(true); setFormError(''); setSavedMessage('');
    try {
      const { data, error: saveError } = await supabase.rpc('mk9_faltas_atestados_save_draft',
        buildAbsenceSaveArgs(draft, selectedBinding, editingRecordId)).abortSignal(AbortSignal.timeout(12000));
      if (saveError || !data) throw saveError || new Error('empty response');
      setSavedMessage('Rascunho salvo no banco de dados. Nenhum dado foi enviado ao CRM.');
      setEditingRecordId(null);
      await loadLocalRecords();
    } catch {
      setFormError('Não foi possível salvar. Confirme sua autorização, a vigência do vínculo e os dados informados.');
    } finally { setSaving(false); }
  };

  const validateStep = (current: number): boolean => {
    setFormError('');
    const issues: string[] = [];
    if (current === 0 && !selectedBinding) issues.push('Selecione um colaborador com vínculo CRM aprovado e vigente.');
    if (current === 1) {
      issues.push(...validateAbsenceDraft({ ...draft, justificativa: 'ok' }, selectedBinding));
    }
    if (current === 2 && !draft.justificativa.trim()) issues.push('Informe uma justificativa.');
    if (issues.length) { setFormError(issues[0]); return false; }
    return true;
  };

  const nextStep = () => { if (validateStep(step)) setStep(value => Math.min(3, value + 1)); };
  const previousStep = () => { setFormError(''); setStep(value => Math.max(0, value - 1)); };

  if (permission.loading) return <section className="p-6 text-sm text-[#5F5F5F]" role="status">Verificando permissão específica…</section>;
  if (!permission.allowed) return <section className="m-4 rounded-xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900" role="alert">Sua conta não possui a permissão específica <code>faltas_atestados_prepare</code>. O papel de administrador, por si só, não libera este módulo.</section>;

  return <section className="w-full min-w-0 space-y-5 p-4 text-[#171717] sm:p-6">
    <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div><p className="text-xs font-bold uppercase tracking-wider text-[#737373]">Integração CRM MK9</p><h1 className="mt-1 text-2xl font-bold sm:text-3xl">Faltas e Atestados</h1><p className="mt-1 max-w-3xl text-sm text-[#5F5F5F]">Preparação de lançamentos para revisão. O envio externo aguarda contrato e homologação.</p></div>
      {area !== 'new' && <span className="w-fit rounded-full border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900">{reviewNotSent}</span>}
    </header>

    <nav aria-label="Áreas Faltas e Atestados" className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
      {areas.map(item => <button key={item.id} type="button" aria-current={area === item.id ? 'page' : undefined} onClick={() => { setArea(item.id); setFormError(''); }} className={`flex min-h-12 items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs font-semibold sm:text-sm ${area === item.id ? 'border-[#222] bg-[#222] text-white' : 'border-[#CFCDC5] bg-white text-[#383832] hover:border-[#286FF5]'}`}><span className="material-symbols-outlined text-lg">{item.icon}</span><span>{item.label}</span></button>)}
    </nav>

    {loading ? <div className={panel} role="status">Carregando vínculos CRM…</div> : error ? <div className={panel} role="alert"><p>{error}</p><button className={`${button} mt-3`} onClick={() => void loadBindings()}>Tentar novamente</button></div> : <>
      {area === 'overview' && <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{[
          ['Colaboradores vinculados', distinctPeople], ['Vínculos aprovados e vigentes', approved], ['Vínculos pendentes', pending], ['Projetos CRM associados', projectRows.length], ['Consulta GET', activeGet ? 'Acesso disponível' : 'Sem acesso confirmado']
        ].map(([label, value]) => <article className={panel} key={String(label)}><p className="text-xs text-[#737373]">{label}</p><p className="mt-2 text-lg font-bold sm:text-xl">{value}</p></article>)}</div>
        {history && <div className={`${panel} grid grid-cols-2 gap-3 sm:grid-cols-4`}>
          {[
            ['Faltas', history.records.filter(row => row.type === 'Falta').length],
            ['Atestados', history.records.filter(row => row.type === 'Atestado').length],
            ['Em análise', history.records.filter(row => row.status === 'Em análise').length],
            ['Processados', history.records.filter(row => row.status === 'Processado').length]
          ].map(([label, value]) => <div key={String(label)}><p className="text-xs text-[#737373]">{label}</p><p className="mt-1 text-xl font-bold">{value}</p></div>)}
          <p className="col-span-2 text-xs text-[#737373] sm:col-span-4">Indicadores calculados dos registros CRM entre {historyStart} e {historyEnd}. <button className="underline" onClick={() => setArea('history')}>Abrir histórico</button></p>
        </div>}
        {historyError && <p role="status" className="text-xs text-[#737373]">Indicadores externos indisponíveis: {historyError}</p>}
        <div className={`${panel} flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between`}><div><h2 className="font-bold">Lançamentos locais</h2><p className="mt-1 text-sm text-[#5F5F5F]">{localRecords.length} lançamento(s) salvo(s) localmente. Eles não foram recebidos pelo CRM.</p></div><button className={primary} onClick={() => { resetForm(); setArea('new'); }}>Novo lançamento</button></div>
      </div>}

      {area === 'new' && <div className="mx-auto max-w-4xl space-y-4">
        <div className={panel}>
          <ol aria-label="Etapas do formulário" className="grid grid-cols-4 gap-2">{['Colaborador', 'Ocorrência', 'Complementos', 'Revisão'].map((label, index) => <li key={label} aria-current={step === index ? 'step' : undefined} className={`border-b-2 pb-2 text-center text-[11px] font-semibold sm:text-sm ${index <= step ? 'border-[#286FF5] text-[#171717]' : 'border-[#D8D6CF] text-[#77766F]'}`}><span className="mr-1 hidden sm:inline">{index + 1}.</span>{label}</li>)}</ol>
        </div>
        {formError && <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">{formError}</p>}
        {step === 0 && <div className={`${panel} grid grid-cols-1 gap-4 sm:grid-cols-2`}>
          <label className="text-sm font-medium sm:col-span-2">Colaborador / projeto CRM<select className={field} value={draft.alocacaoId} onChange={event => { setDraft(current => ({ ...current, alocacaoId: event.target.value })); setFormError(''); }}><option value="">Selecione um vínculo aprovado</option>{selectable.map(row => <option key={row.alocacao_id} value={row.alocacao_id}>{row.colaborador} · {row.matricula_interna} · {row.matricula_externa} · {row.projeto_crm}</option>)}</select></label>
          {selectedBinding ? <><ReadOnly label="Matrícula interna" value={selectedBinding.matricula_interna} /><ReadOnly label="Matrícula real CRM" value={selectedBinding.matricula_externa} /><ReadOnly label="Projeto CRM (UUID confirmado)" value={selectedBinding.projeto_crm} /><ReadOnly label="Vigência do vínculo" value={`${formatDate(selectedBinding.valido_desde)} – ${formatDate(selectedBinding.valido_ate)}`} /></> : <p className="text-xs text-[#737373] sm:col-span-2">Matrícula externa e projeto são resolvidos exclusivamente pelo vínculo aprovado; não podem ser digitados neste formulário.</p>}
        </div>}
        {step === 1 && <div className={`${panel} grid grid-cols-1 gap-4 sm:grid-cols-2`}>
          <label className="text-sm font-medium">Tipo<select className={field} value={draft.tipo} onChange={event => set('tipo', event.target.value)}><option value="">Selecione</option>{absenceTypes.map(type => <option key={type}>{type}</option>)}</select></label>
          <ReadOnly label="Unidade de lançamento" value="Período informado para revisão (sem regra de envio confirmada)" />
          <label className="text-sm font-medium">Data inicial<input className={field} type="date" value={draft.inicio} onChange={event => set('inicio', event.target.value)} /></label>
          <label className="text-sm font-medium">Data final<input className={field} type="date" min={draft.inicio || undefined} value={draft.fim} onChange={event => set('fim', event.target.value)} /></label>
          <ReadOnly label="Quantidade de dias corridos (informativa)" value={draft.inicio && draft.fim ? String(inclusiveDays(draft.inicio, draft.fim) ?? 'Período inválido') : '—'} />
          <label className="text-sm font-medium">Previsão de retorno<input className={field} type="date" min={draft.fim || draft.inicio || undefined} value={draft.retorno} onChange={event => set('retorno', event.target.value)} /></label>
          <p className="text-xs text-[#737373] sm:col-span-2">A contagem é apenas informativa; dias úteis, inclusão das datas e unidade de ocorrência aguardam definição do CRM.</p>
        </div>}
        {step === 2 && <div className={`${panel} grid grid-cols-1 gap-4`}>
          <label className="text-sm font-medium">Justificativa<textarea className={field} maxLength={500} rows={5} value={draft.justificativa} onChange={event => set('justificativa', event.target.value)} placeholder="Não inclua diagnóstico ou dados médicos detalhados." /></label>
          <p className="text-xs text-[#737373]">Evite incluir informações médicas além do necessário para justificar o lançamento.</p>
        </div>}
        {step === 3 && <div className={`${panel} space-y-4`}>
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-semibold text-amber-950">{reviewNotSent}</div>
          <h2 className="text-lg font-bold">Revisão do formulário</h2>
          {selectedBinding ? <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">{[
            ['Colaborador', selectedBinding.colaborador], ['Matrícula interna', selectedBinding.matricula_interna], ['Matrícula real CRM', selectedBinding.matricula_externa], ['Projeto CRM', selectedBinding.projeto_crm], ['Tipo', draft.tipo], ['Período', `${formatDate(draft.inicio)} – ${formatDate(draft.fim)}`], ['Dias corridos (informativo)', String(inclusiveDays(draft.inicio, draft.fim) ?? '—')], ['Retorno previsto', formatDate(draft.retorno)], ['Justificativa', draft.justificativa]
          ].map(([label, value]) => <div key={label} className="min-w-0 border-b border-[#E2E0D9] pb-2"><dt className="text-xs text-[#737373]">{label}</dt><dd className="mt-1 break-words text-sm font-medium">{value}</dd></div>)}</dl> : <p role="alert">O vínculo selecionado não está disponível. Volte e selecione outro.</p>}
          <p className="text-xs text-[#737373]">Salvar cria um rascunho local no banco. Isso não confirma recebimento pelo CRM.</p>
          <div className="flex flex-wrap gap-2"><button type="button" className={primary} disabled={saving} onClick={() => void saveDraft()}>{saving ? 'Salvando…' : editingRecordId ? 'Atualizar rascunho' : 'Salvar rascunho'}</button><button type="button" className={button} disabled={!externalWriteEnabled}>Enviar ao CRM (aguardando homologação)</button></div>
        </div>}
        <div className="flex flex-wrap justify-between gap-2"><div>{savedMessage && <p role="status" className="mb-2 text-sm text-emerald-800">{savedMessage}</p>}<button type="button" className={button} onClick={() => { resetForm(); setArea('overview'); }}>Cancelar revisão</button></div><div className="flex gap-2">{step > 0 && <button type="button" className={button} onClick={previousStep}>Voltar</button>}{step < 3 && <button type="button" className={primary} onClick={nextStep}>{step === 2 ? 'Revisar' : 'Continuar'}</button>}</div></div>
      </div>}

      {area === 'history' && <div className="space-y-4">
        <section className={`${panel} space-y-3`} aria-labelledby="local-records-title">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 id="local-records-title" className="font-bold">Lançamentos locais</h2><p className="text-xs text-[#737373]">Registros salvos neste módulo; não são confirmações nem dados recebidos pelo CRM.</p></div><button type="button" className={button} onClick={() => void loadLocalRecords()} disabled={localLoading}>{localLoading ? 'Atualizando…' : 'Atualizar locais'}</button></div>
          {localError && <p role="alert" className="text-sm text-red-800">{localError}</p>}
          {!localLoading && !localError && localRecords.length === 0 && <p className="text-sm text-[#737373]">Nenhum lançamento local salvo.</p>}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{localRecords.map(record => <article className="rounded-lg border border-[#D8D6CF] bg-white p-4" key={record.id}>
            <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-semibold">{record.colaborador_nome} · {record.tipo}</h3><p className="text-xs text-[#5F5F5F]">Matrícula interna {record.matricula_interna} · matrícula CRM {record.matricula_externa} · Projeto {record.projeto_crm}</p></div><span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900">Status local: {record.status === 'rascunho' ? 'rascunho' : 'preparado; não enviado'}</span></div>
            <p className="mt-2 text-sm">{formatDate(record.data_inicio)} – {formatDate(record.data_fim)} · Retorno {formatDate(record.previsao_retorno)}</p>
            <p className="mt-2 whitespace-pre-wrap text-sm">{record.justificativa}</p>
            <p className="mt-2 text-xs text-[#737373]">Salvo em {new Date(record.criado_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</p>
            {record.status === 'rascunho' && <button type="button" className={`${button} mt-3`} onClick={() => { setDraft({ alocacaoId: record.alocacao_id, tipo: record.tipo, inicio: record.data_inicio, fim: record.data_fim, retorno: record.previsao_retorno, justificativa: record.justificativa }); setEditingRecordId(record.id); setSavedMessage(''); setFormError(''); setStep(0); setArea('new'); }}>Editar rascunho</button>}
          </article>)}</div>
        </section>
        <h2 className="pt-2 text-lg font-bold">Registros recebidos do CRM</h2>
        <p className="text-xs text-[#737373]">Esta seção mantém a consulta GET somente leitura já existente.</p>
        <div className={`${panel} grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6`}>
          {availableRhViews.length > 1 && <label className="text-xs">Escopo<select className={field} value={selectedHistoryView || ''} onChange={event => setHistoryView(event.target.value as RhView)}>{availableRhViews.map(view => <option key={view} value={view}>{view === 'mine' ? 'Pessoal' : view === 'team' ? 'Equipe autorizada' : 'Gestão autorizada'}</option>)}</select></label>}
          <label className="text-xs">Data inicial<input className={field} type="date" value={historyStart} max={historyEnd} onChange={event => setHistoryStart(event.target.value)} /></label>
          <label className="text-xs">Data final<input className={field} type="date" value={historyEnd} min={historyStart} onChange={event => setHistoryEnd(event.target.value)} /></label>
          <label className="text-xs">Projeto CRM<select className={field} value={historyProject} onChange={event => setHistoryProject(event.target.value)}><option value="">Todos</option>{[...new Map((history?.records || []).map(record => [record.projectId, record.projectName])).entries()].map(([id, name]) => <option key={id} value={id}>{name} · {id}</option>)}</select></label>
          <label className="text-xs">Tipo de ausência<select className={field} value={historyType} onChange={event => setHistoryType(event.target.value)}><option value="">Todos</option><option>Falta</option><option>Atestado</option><option>Ausência</option></select></label>
          <label className="text-xs">Matrícula<input className={field} value={historyMatricula} onChange={event => setHistoryMatricula(event.target.value)} placeholder="Interna ou CRM" /></label>
          <button className={`${button} self-end`} onClick={() => setHistoryRefresh(value => value + 1)} disabled={historyLoading}>{historyLoading ? 'Atualizando…' : 'Atualizar agora'}</button>
        </div>
        {availableRhViews.length === 0 && <div className={panel}>Sua conta não possui um escopo RH aprovado para consultar estes registros.</div>}
        {historyLoading && <div className={panel} role="status">Consultando registros externos autorizados…</div>}
        {historyError && <div className={panel} role="alert"><p>{historyError}</p><button className={`${button} mt-3`} onClick={() => setHistoryRefresh(value => value + 1)}>Tentar novamente</button></div>}
        {!historyLoading && !historyError && history && <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['Registros', history.records.length],
              ['Faltas', history.records.filter(record => record.type === 'Falta').length],
              ['Atestados', history.records.filter(record => record.type === 'Atestado').length],
              ['Em análise', history.records.filter(record => record.status === 'Em análise').length]
            ].map(([label, value]) => <article className={panel} key={String(label)}><p className="text-xs text-[#737373]">{label}</p><p className="mt-1 text-xl font-bold">{value}</p></article>)}
          </div>
          <p className="text-xs text-[#737373]">Última consulta: {new Date(history.updatedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}. Dados de CID, diagnóstico e documentos médicos não são recebidos nem exibidos.</p>
          {history.unmatchedCount > 0 && <p role="status" className="text-xs text-amber-900">{history.unmatchedCount} registro(s) foram omitidos porque não correspondem a vínculo aprovado, projeto e matrícula externos exatos.</p>}
          {(() => {
            const rows = filterAbsenceHistory(history.records, { start: historyStart, end: historyEnd, projectId: historyProject, type: historyType, matricula: historyMatricula });
            return rows.length ? <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{rows.map(record => { const displayKey = JSON.stringify([record.projectId, record.externalMatricula, record.externalRecordId || record.externalProtocol]); const display = history.display.find(item => item.key === displayKey); return <article className={`${panel} space-y-3`} key={displayKey}>
              <div className="flex flex-wrap items-start justify-between gap-2"><div><h2 className="font-bold">{display?.collaborator || record.collaboratorName}</h2><p className="text-xs text-[#5F5F5F]">Matrícula interna {record.internalMatricula} · matrícula CRM {record.externalMatricula}</p></div><span className="rounded-full bg-[#EBF2FE] px-3 py-1 text-xs font-semibold text-[#286FF5]">{display?.status || record.status}</span></div>
              <p className="text-sm">{display?.type || record.type} · {display?.period || formatDate(record.startDate)}</p>
              <p className="text-xs text-[#5F5F5F]">Projeto CRM: {display?.project || record.projectName} · {display?.projectId || record.projectId}</p>
              <details className="border-t border-[#E2E0D9] pt-2 text-sm"><summary className="cursor-pointer font-medium">Detalhes do registro</summary><dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2"><div><dt className="text-xs text-[#737373]">Duração informada pelo CRM</dt><dd>{record.days === null ? 'Não informada' : `${record.days} ${record.days === 1 ? 'dia' : 'dias'}`}</dd></div><div><dt className="text-xs text-[#737373]">Retorno</dt><dd>{formatDate(record.returnDate)}</dd></div><div><dt className="text-xs text-[#737373]">Protocolo externo</dt><dd className="break-all">{display?.protocol || record.externalProtocol || 'Não informado'}</dd></div><div><dt className="text-xs text-[#737373]">ID externo</dt><dd className="break-all">{record.externalRecordId || 'Não fornecido'}</dd></div></dl></details>
            </article>; })}</div> : <div className={`${panel} py-10 text-center`}><h2 className="font-bold">Nenhum registro encontrado</h2><p className="mt-2 text-sm text-[#737373]">Não há registros externos para o período e os filtros escolhidos.</p></div>;
          })()}
        </>}
      </div>}
      {area === 'people' && <div className="space-y-3"><div className={`${panel} flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`}><div><h2 className="font-bold">Colaboradores e matrículas</h2><p className="text-xs text-[#737373]">Somente vínculos retornados pelo backend autorizado.</p></div><label className="text-xs">Pesquisar<input className={field} value={query} onChange={event => setQuery(event.target.value)} placeholder="Nome, matrícula ou projeto" /></label></div><div className="overflow-x-auto rounded-xl border border-[#CFCDC5] bg-white"><table className="w-full min-w-[850px] text-left text-sm"><thead className="bg-[#EAE8E2] text-xs uppercase text-[#5F5F5F]"><tr>{['Colaborador', 'Matrícula interna', 'Matrícula externa', 'Projeto CRM', 'Vigência', 'Vínculo'].map(label => <th key={label} className="px-3 py-3">{label}</th>)}</tr></thead><tbody>{searched.map(row => <tr key={row.alocacao_id} className="border-t border-[#EAE8E2]"><td className="px-3 py-3 font-semibold">{row.colaborador}</td><td className="px-3 py-3 font-mono text-xs">{row.matricula_interna}</td><td className="px-3 py-3 font-mono text-xs">{row.matricula_externa}</td><td className="max-w-[220px] break-all px-3 py-3 font-mono text-xs">{row.projeto_crm}</td><td className="px-3 py-3 text-xs">{formatDate(row.valido_desde)} – {formatDate(row.valido_ate)}</td><td className="px-3 py-3"><Status identity={row.identidade_status} allocation={row.alocacao_status} /></td></tr>)}</tbody></table>{!searched.length && <p className="p-6 text-center text-sm text-[#737373]">Nenhum vínculo corresponde à pesquisa.</p>}</div></div>}

      {area === 'projects' && <div className="space-y-3"><h2 className="font-bold">Projetos vinculados</h2><p className="text-sm text-[#5F5F5F]">Os projetos abaixo vêm dos UUIDs registrados nas alocações. Não há catálogo de nomes; nenhum projeto é inferido ou criado.</p><div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{projectRows.map(project => <article className={panel} key={project.id}><p className="text-xs text-[#737373]">UUID do projeto CRM</p><p className="mt-1 break-all font-mono text-sm font-semibold">{project.id}</p><p className="mt-3 text-xs text-[#5F5F5F]">{project.rows.length} alocações · {project.rows.filter(row => row.alocacao_status === 'aprovado' && isBindingSelectable(row)).length} aprovadas e vigentes · {project.rows.filter(row => row.alocacao_status === 'pendente').length} pendentes</p></article>)}</div>{!projectRows.length && <div className={panel}>Nenhum projeto CRM está vinculado.</div>}</div>}

      {area === 'settings' && <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <article className={panel}><h2 className="font-bold">Integração GET</h2><p className="mt-2 text-sm">{activeGet ? 'Há escopo de consulta RH disponível para esta conta.' : 'Nenhum escopo GET foi confirmado para esta conta.'}</p><p className="mt-1 text-xs text-[#737373]">O GET consulta ocorrências externas e não habilita escrita.</p></article>
        <article className={panel}><h2 className="font-bold">API de escrita</h2><p className="mt-2 text-sm">Não disponível. Aguarda contrato oficial, ambiente de homologação e aprovação.</p><p className="mt-1 text-xs text-[#737373]">Este módulo não realiza chamadas POST e não expõe credenciais.</p></article>
        <article className={panel}><h2 className="font-bold">Permissão</h2><p className="mt-2 text-sm">Capacidade específica verificada por RPC no backend: <code>faltas_atestados_prepare</code>.</p><p className="mt-1 text-xs text-[#737373]">A concessão é individual; a função administrativa, por si só, não concede acesso.</p></article>
        <article className={panel}><h2 className="font-bold">Pendências de homologação</h2><ul className="mt-2 list-inside list-disc space-y-1 text-sm text-[#5F5F5F]"><li>Endpoint, campos e autenticação de escrita.</li><li>Semântica de períodos, dias e retorno.</li><li>Regras de idempotência, confirmação e atualização.</li><li>Projeto e matrícula sintéticos no ambiente de homologação.</li></ul></article>
      </div>}
    </>}
  </section>;
}

function ReadOnly({ label, value }: { label: string; value: string }) { return <div className="min-w-0 text-sm"><p className="font-medium">{label}</p><p className="mt-1 min-h-10 break-all rounded-lg border border-[#E1DFD8] bg-[#ECEAE4] px-3 py-2.5 font-mono text-xs">{value || '—'}</p></div>; }
function Status({ identity, allocation }: { identity: string; allocation: string }) { return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${identity === 'aprovado' && allocation === 'aprovado' ? 'bg-emerald-100 text-emerald-800' : identity === 'revogado' || allocation === 'revogado' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-900'}`}>{formatStatus(identity)} / {formatStatus(allocation)}</span>; }
