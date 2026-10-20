import React, { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { useRhAccess, type RhView } from '../lib/rhAccess';
import type { Absence, AbsencesResult } from '../../shared/mk9';

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const formatDate = (value: string | null) => value ? value.split('-').reverse().join('/') : 'Não informado';
const panel = 'rounded-xl border border-[#CFCDC5] bg-[#F7F6F2] p-4';
const field = 'w-full min-w-0 rounded-lg border border-[#CFCDC5] bg-white p-2 text-sm';
export function RhAbsencesView() {
  const { session } = useAuth();
  const access = useRhAccess();
  const [selectedView, setSelectedView] = useState<RhView>('mine');
  const available = (['mine', 'team', 'management'] as RhView[]).filter(v => access[v]);
  const view = available.includes(selectedView) ? selectedView : available[0] || 'mine';
  const mine = view === 'mine';
  const [start, setStart] = useState(() => today().slice(0, 7) + '-01');
  const [end, setEnd] = useState(today);
  const [result, setResult] = useState<AbsencesResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [project, setProject] = useState('');
  const [supervisor, setSupervisor] = useState('');
  const [promoter, setPromoter] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 35_000);
    setLoading(true); setError(''); setResult(null);
    setProject(''); setSupervisor(''); setPromoter('');
    const endpoint = mine ? 'minhas-ausencias' : view === 'management' ? 'gestao/ausencias' : 'equipe/ausencias';
    let disposed = false;
    (async () => {
      try {
        if (!session?.access_token) throw new Error();
        const response = await fetch(`/api/rh/${endpoint}?${new URLSearchParams({ data_inicio: start, data_fim: end })}`, {
          headers: { Authorization: `Bearer ${session.access_token}` }, signal: controller.signal, cache: 'no-store'
        });
        const body = await response.json();
        if (!response.ok) {
          // Display only the application's known human-facing errors, never arbitrary HTML/upstream text.
          if (response.status === 400) throw new Error('Selecione um período válido de até um ano.');
          if (response.status === 401) throw new Error('Entre novamente para consultar suas informações.');
          if (response.status === 403) throw new Error('Seu perfil não possui acesso a esta consulta. Verifique o vínculo da equipe com o administrador.');
          if (body.message === 'Há muitas ocorrências neste período. Selecione um intervalo menor.') throw new Error(body.message);
          throw new Error();
        }
        if (!Array.isArray(body.data) || !Array.isArray(body.projects)) throw new Error();
        if (!controller.signal.aborted) setResult(body);
      } catch (e) {
        if (!disposed) setError(e instanceof Error && /^(Selecione um período|Entre novamente|Seu perfil não possui|Há muitas ocorrências)/.test(e.message) ? e.message : 'Informações de faltas e atestados temporariamente indisponíveis. Tente novamente em alguns instantes.');
      } finally { if (!disposed) setLoading(false); clearTimeout(timer); }
    })();
    return () => { disposed = true; clearTimeout(timer); controller.abort(); };
  }, [session?.access_token, view, mine, start, end, retry]);
  const all = result?.data || [];
  const filtered = all.filter(r => (!project || r.projeto === project) && (!supervisor || r.supervisor === supervisor) && (!promoter || r.matricula === promoter) && (!type || r.tipo === type) && (!status || r.status === status));
  const unique = (key: keyof Absence) => [...new Set(all.filter(r => (!project || r.projeto === project) && (!supervisor || r.supervisor === supervisor)).map(r => String(r[key] || '')))].filter(Boolean).sort();
  const select = (label: string, value: string, change: (v: string) => void, options: string[]) => <label className="min-w-0 text-xs text-[#525252]">{label}<select className={field + ' mt-1'} value={value} onChange={e => change(e.target.value)}><option value="">Todos</option>{options.map(o => <option key={o} value={o}>{o}</option>)}</select></label>;
  return <section className="w-full min-w-0 p-4 sm:p-6 space-y-5 text-[#171717]">
    <nav aria-label="Vis?es autorizadas de RH" className="flex flex-wrap gap-2">{available.map(v => <button key={v} aria-pressed={view === v} onClick={() => setSelectedView(v)} className="rounded-lg border border-[#CFCDC5] px-3 py-2 text-sm">{v === 'mine' ? 'Minhas aus?ncias' : v === 'team' ? 'Supervis?o RH' : 'Gest?o RH'}</button>)}</nav>
    <header><p className="text-xs font-bold uppercase text-[#737373]">{mine ? 'Meu RH' : view === 'management' ? 'Gestão' : 'Minha equipe'}</p><h1 className="text-2xl font-bold">{mine ? 'Minhas Ausências' : 'Faltas e Atestados'}</h1><p className="text-sm text-[#525252] mt-1">Consulta aos registros oficiais do MK9. As informações são somente para acompanhamento.</p></header>
    <div className={panel + ' grid grid-cols-1 sm:grid-cols-2 gap-3'}>
      <label className="min-w-0 text-xs">Início do período<input className={field + ' mt-1'} type="date" value={start} onChange={e => setStart(e.target.value)} /></label>
      <label className="min-w-0 text-xs">Fim do período<input className={field + ' mt-1'} type="date" value={end} onChange={e => setEnd(e.target.value)} /></label>
    </div>
    {loading ? <div role="status" aria-label="Carregando ocorrências" className="grid grid-cols-1 sm:grid-cols-3 gap-3">{[1,2,3].map(n => <div key={n} className={panel + ' h-28 animate-pulse'}><div className="h-4 w-2/3 rounded bg-[#E4E2DB]" /></div>)}</div> : error ? <div role="alert" className={panel}><p>{error}</p><button className="mt-3 rounded-lg bg-[#286FF5] px-4 py-2 text-white" onClick={() => setRetry(n => n + 1)}>Tentar novamente</button></div> : result && <>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">{[
        ...(!mine ? [['Promotores ativos', result.activePromoters]] : []),
        ['Ocorrências no período', all.length], ['Faltas', all.filter(r => r.tipo === 'Falta').length], ['Atestados', all.filter(r => r.tipo === 'Atestado').length], ['Em análise', all.filter(r => r.status === 'Em análise').length], ['Processadas', all.filter(r => r.status === 'Processado').length]
      ].map(([label, value]) => <div className={panel} key={label}><p className="text-xs text-[#737373]">{label}</p><p className="text-2xl font-bold mt-2">{value}</p></div>)}</div>
      <p className="text-xs text-[#737373]">Última atualização: {new Date(result.updatedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</p>
      {!mine && <>
        {view === 'management' && <div className="grid grid-cols-1 md:grid-cols-3 gap-3">{result.projects.map((p, i) => <button key={i} className={panel + ' text-left hover:border-[#286FF5]'} onClick={() => { setProject(p.nome); setSupervisor(''); setPromoter(''); }}><strong className="break-words">{p.nome}</strong><p className="text-sm mt-1">{p.activePromoters} promotores ativos · {all.filter(r => r.projeto === p.nome).length} ocorrências</p></button>)}</div>}
        <div className={panel + ' grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3'}>
          {select('Projeto', project, v => { setProject(v); setSupervisor(''); setPromoter(''); }, [...new Set(result.projects.map(p => p.nome))])}
          {view === 'management' && select('Supervisor', supervisor, v => { setSupervisor(v); setPromoter(''); }, unique('supervisor'))}
          <label className="text-xs min-w-0">Promotor<select className={field + ' mt-1'} value={promoter} onChange={e => setPromoter(e.target.value)}><option value="">Todos</option>{unique('matricula').map(m => <option key={m} value={m}>{all.find(r => r.matricula === m)?.nome} · {m}</option>)}</select></label>
          {select('Ocorrência', type, setType, ['Falta', 'Atestado', 'Ausência'])}
          {select('Status', status, setStatus, ['Em análise', 'Processado', 'Necessita atenção', 'Cancelado', 'Em processamento'])}
        </div>
        {view === 'management' && <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{unique('supervisor').map(s => { const rows = all.filter(r => (!project || r.projeto === project) && r.supervisor === s); return <button key={s} className={panel + ' text-left'} onClick={() => { setSupervisor(s); setPromoter(''); }}><strong>{s}</strong><p className="text-xs mt-1">{new Set(rows.map(r => r.matricula)).size} promotores com ocorrências · {rows.filter(r => r.tipo === 'Falta').length} faltas · {rows.filter(r => r.tipo === 'Atestado').length} atestados · {rows.filter(r => r.status === 'Em análise').length} em análise</p></button>; })}</div>}
      </>}
      {promoter && <h2 className="font-bold break-words">Histórico: {all.find(r => r.matricula === promoter)?.nome} · Matrícula {promoter}</h2>}
      {!filtered.length ? <div className={panel + ' text-center py-10'}><h2 className="font-bold">Nenhuma ocorrência encontrada</h2><p className="text-sm mt-2 text-[#737373]">Não há registros para o período e os filtros selecionados.</p></div> : <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">{filtered.map((r, i) => <article key={i} className={panel + ' min-w-0 space-y-3'}>
        {!mine && <button onClick={() => setPromoter(r.matricula)} className="text-left max-w-full text-[#286FF5] font-bold break-words">{r.nome || 'Promotor'} · {r.matricula}</button>}
        {!mine && <p className="text-xs break-words">{r.projeto} · {r.supervisor}</p>}
        <div className="flex flex-wrap justify-between gap-2"><h2 className="font-bold">{r.tipo}</h2><span className={'rounded-full px-3 py-1 text-xs font-medium ' + (r.status === 'Processado' ? 'bg-[#E8F5EE] text-[#16845B]' : r.status === 'Necessita atenção' ? 'bg-red-50 text-red-700' : 'bg-[#EBF2FE] text-[#286FF5]')}>{r.status}</span></div>
        <p className="text-sm">{formatDate(r.inicio)}{r.fim && r.fim !== r.inicio ? ` a ${formatDate(r.fim)}` : ''}</p>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm"><div><dt className="text-[#737373] text-xs">Duração</dt><dd>{r.dias === null ? 'Não informada' : `${r.dias} ${r.dias === 1 ? 'dia' : 'dias'}`}</dd></div><div><dt className="text-[#737373] text-xs">Retorno</dt><dd>{formatDate(r.retorno)}</dd></div></dl>
        <p className="text-xs text-[#737373] break-all">Protocolo: {r.protocolo || 'Não informado'}</p>
      </article>)}</div>}
    </>}
  </section>;
}
