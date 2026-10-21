import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useRhMatriculasAccess } from '../lib/rhMatriculasAccess';
import { parseRhRosterWorkbook, rosterDivergences, type RhInternalPerson } from '../lib/rhMatriculasReconciliation';

interface ReconciliationRow {
  id: string; matricula_rh: string; nome_rh: string; cargo_rh: string; empresa: string; cidade_rh: string; uf_rh: string; situacao_rh: string;
  referencia_fonte: string; promotor_id: string | null; supervisor_id: string | null; codigo_interno: string | null; nome_mk9: string | null;
  tipo_mk9: string | null; cidade_mk9: string | null; uf_mk9: string | null; situacao_mk9: string | null; estado: string;
  observacao_decisao: string | null; criado_em: string; aprovado_por: string | null; aprovador_nome: string | null; aprovado_em: string | null; aplicado_em: string | null;
}
interface AuditRow { id: number; autor_nome: string; acao: string; referencia: string; antes: unknown; depois: unknown; ocorrido_em: string }
interface Preview { aprovadas: number; aplicadas: number; pendentes: number; conflitos: number }

const panel = 'rounded-xl border border-[#CFCDC5] bg-[#F7F6F2] p-4 sm:p-5';
const field = 'w-full rounded-lg border border-[#CFCDC5] bg-white px-3 py-2 text-sm text-[#171717]';
const button = 'rounded-lg border border-[#CFCDC5] px-3 py-2 text-xs font-semibold text-[#383832] hover:border-[#286FF5] disabled:opacity-40';
const primary = 'rounded-lg bg-[#222222] px-3 py-2 text-xs font-semibold text-white hover:bg-black disabled:opacity-40';
const labelState: Record<string, string> = { pendente: 'Pendente', aprovada: 'Aprovada', rejeitada: 'Rejeitada', revisao: 'Em revisão', aplicada: 'Aplicada', revertida: 'Revertida' };
const errMessage = (error: unknown) => error instanceof Error ? error.message : 'Não foi possível concluir a operação.';

export function RhMatriculasReconciliationView() {
  const access = useRhMatriculasAccess();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ReconciliationRow[]>([]);
  const [people, setPeople] = useState<RhInternalPerson[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [personSearch, setPersonSearch] = useState('');
  const [filter, setFilter] = useState('todos');
  const [selectedPeople, setSelectedPeople] = useState<Record<string, string>>({});
  const [decisionReferences, setDecisionReferences] = useState<Record<string, string>>({});
  const [sourceReference, setSourceReference] = useState('Compartilhado.xlsx — Benefícios Geral');
  const [previewRows, setPreviewRows] = useState<ReturnType<typeof parseRhRosterWorkbook> | null>(null);
  const [audit, setAudit] = useState<{ name: string; rows: AuditRow[] } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  const load = useCallback(async () => {
    if (!supabase || !access.allowed) return;
    setLoading(true); setError('');
    try {
      const [records, catalog] = await Promise.all([
        supabase.rpc('mk9_rh_reconciliation_list').abortSignal(AbortSignal.timeout(15000)),
        supabase.rpc('mk9_rh_reconciliation_people').abortSignal(AbortSignal.timeout(15000))
      ]);
      if (records.error) throw records.error;
      if (catalog.error) throw catalog.error;
      setRows((records.data || []) as ReconciliationRow[]);
      setPeople((catalog.data || []) as RhInternalPerson[]);
    } catch { setError('Não foi possível carregar a conciliação. Verifique se a migration foi aplicada e se esta conta tem a permissão específica.'); }
    finally { setLoading(false); }
  }, [access.allowed]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => rows.filter(row => {
    const selectedCode = selectedPeople[row.id] || row.codigo_interno || '';
    const person = people.find(item => item.codigo_interno === selectedCode) || null;
    const hasConflict = rosterDivergences(row, person).length > 0;
    const matchesFilter = filter === 'todos' || row.estado === filter || (filter === 'conflitos' && hasConflict);
    const term = search.trim().toLocaleLowerCase('pt-BR');
    const matchesSearch = !term || [row.nome_rh,row.matricula_rh,row.nome_mk9,row.codigo_interno,row.empresa].some(value => value?.toLocaleLowerCase('pt-BR').includes(term));
    return matchesFilter && matchesSearch;
  }), [rows, people, filter, search, selectedPeople]);

  const importFile = async (file?: File) => {
    if (!file) return;
    setError(''); setMessage(''); setPreviewRows(null);
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('O arquivo excede o limite de 10 MiB.');
      const parsed = parseRhRosterWorkbook(await file.arrayBuffer());
      setPreviewRows(parsed);
      setMessage(`${parsed.length} linha(s) válidas. Serão enviados apenas nome, matrícula RH, cargo, empresa, cidade, UF e situação.`);
    } catch (err) { setError(errMessage(err)); }
    finally { if (fileRef.current) fileRef.current.value = ''; }
  };

  const submitImport = async () => {
    if (!supabase || !previewRows?.length || saving) return;
    if (sourceReference.trim().length < 3) { setError('Informe uma referência para a fonte.'); return; }
    setSaving(true); setError(''); setMessage('');
    try {
      const { data, error: rpcError } = await supabase.rpc('mk9_rh_reconciliation_import', { p_rows: previewRows, p_referencia: sourceReference.trim() });
      if (rpcError) throw rpcError;
      const result = Array.isArray(data) ? data[0] : data;
      setMessage(`Importação preparada: ${result?.inseridos ?? 0} nova(s), ${result?.atualizados ?? 0} atualizada(s). Nenhuma correspondência foi aprovada.`);
      setPreviewRows(null);
      await load();
    } catch (err) { setError(errMessage(err)); }
    finally { setSaving(false); }
  };

  const decide = async (row: ReconciliationRow, action: 'aprovar'|'rejeitar'|'revisar') => {
    if (!supabase || saving) return;
    const reference = (decisionReferences[row.id] || '').trim();
    const code = selectedPeople[row.id] || row.codigo_interno || '';
    if (reference.length < 3) { setError('Registre uma referência ou justificativa de ao menos 3 caracteres para a decisão.'); return; }
    if (action === 'aprovar' && !code) { setError('Selecione o código interno do cadastro que foi conferido.'); return; }
    setSaving(true); setError(''); setMessage('');
    try {
      const { error: rpcError } = await supabase.rpc('mk9_rh_reconciliation_decide', { p_id: row.id, p_action: action, p_internal_code: action === 'aprovar' ? code : null, p_referencia: reference });
      if (rpcError) throw rpcError;
      setMessage(action === 'aprovar' ? 'Correspondência aprovada e auditada.' : action === 'rejeitar' ? 'Candidata rejeitada e auditada.' : 'Registro encaminhado para revisão.');
      await load();
    } catch (err) { setError(errMessage(err)); }
    finally { setSaving(false); }
  };

  const showAudit = async (row: ReconciliationRow) => {
    if (!supabase) return;
    setError('');
    const { data, error: rpcError } = await supabase.rpc('mk9_rh_reconciliation_audit', { p_id: row.id });
    if (rpcError) { setError('Não foi possível consultar o histórico.'); return; }
    setAudit({ name: row.nome_rh, rows: (data || []) as AuditRow[] });
  };

  const reverseApplied = async (row: ReconciliationRow) => {
    if (!supabase || saving) return;
    const reference = window.prompt(`Informe a justificativa administrativa para reverter ${row.codigo_interno} / RH ${row.matricula_rh}:`);
    if (!reference || reference.trim().length < 3) return;
    if (!window.confirm('Reverter somente o vínculo do catálogo RH? A matrícula RH deixará de ser fornecida ao módulo Faltas e Atestados.')) return;
    setSaving(true); setError('');
    try {
      const { error: rpcError } = await supabase.rpc('mk9_rh_reconciliation_reverse', { p_id: row.id, p_referencia: reference.trim() });
      if (rpcError) throw rpcError;
      setMessage('Vínculo RH revertido e auditado. Cadastros operacionais preservados.');
      await load();
    } catch (err) { setError(errMessage(err)); }
    finally { setSaving(false); }
  };

  const applyApproved = async () => {
    if (!supabase || saving) return;
    const current = await supabase.rpc('mk9_rh_reconciliation_preview');
    if (current.error) { setError('Não foi possível validar a prévia.'); return; }
    const info = (Array.isArray(current.data) ? current.data[0] : current.data) as Preview;
    setPreview(info);
    if (info.conflitos > 0 || info.aprovadas === 0) { setError('A prévia não está liberada: resolva conflitos e tenha ao menos uma aprovação.'); return; }
    const reference = window.prompt(`A prévia encontrou ${info.aprovadas} vínculo(s) aprovado(s). Digite a referência administrativa para aplicar no catálogo RH local:`);
    if (!reference || reference.trim().length < 3) return;
    if (!window.confirm('Aplicar somente os vínculos aprovados ao catálogo privado de matrículas RH? Nenhuma rota, visita ou código PRM será alterado.')) return;
    setSaving(true); setError('');
    try {
      const { data, error: rpcError } = await supabase.rpc('mk9_rh_reconciliation_apply', { p_referencia: reference.trim() });
      if (rpcError) throw rpcError;
      setMessage(`${Number(data) || 0} vínculo(s) aplicado(s) ao catálogo privado. Cadastros operacionais preservados.`);
      await load();
    } catch (err) { setError(errMessage(err)); }
    finally { setSaving(false); }
  };

  if (access.loading) return <section className="p-6 text-sm text-[#5F5F5F]" role="status">Verificando permissão administrativa…</section>;
  if (!access.allowed) return <section className="m-4 rounded-xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900" role="alert">Esta conta não tem a permissão específica de administração da conciliação de matrículas RH.</section>;

  return <main className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6">
    <header className={panel}>
      <p className="text-xs font-semibold uppercase tracking-wide text-[#286FF5]">Cadastros · Administração restrita</p>
      <h1 className="mt-1 text-xl font-bold text-[#171717]">Conciliação de matrículas RH</h1>
      <p className="mt-2 text-sm text-[#5F5F5F]">Importe somente os campos de conciliação. A planilha não é armazenada. Nenhum nome semelhante é associado automaticamente; a matrícula só se torna utilizável depois de revisão e aplicação explícitas.</p>
    </header>
    {error && <p role="alert" className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    {message && <p role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">{message}</p>}
    <section className={`${panel} grid gap-3 md:grid-cols-[1fr_auto] md:items-end`}>
      <div className="space-y-2">
        <h2 className="font-semibold text-[#171717]">Preparar lote RH</h2>
        <label className="block text-xs text-[#5F5F5F]">Referência da fonte
          <input className={`${field} mt-1`} value={sourceReference} maxLength={300} onChange={event => setSourceReference(event.target.value)} />
        </label>
        <p className="text-xs text-[#77766F]">Campos importados: nome, matrícula RH, cargo, empresa, cidade, UF e situação. CPF, salários, benefícios, RG e PIS são ignorados.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <input ref={fileRef} className="hidden" type="file" accept=".xlsx,.xls" onChange={event => void importFile(event.target.files?.[0])} />
        <button className={button} onClick={() => fileRef.current?.click()} disabled={saving}>Selecionar planilha</button>
        {previewRows && <button className={primary} onClick={() => void submitImport()} disabled={saving}>{saving ? 'Preparando…' : `Importar ${previewRows.length} candidatos`}</button>}
      </div>
      {previewRows && <div className="md:col-span-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">Prévia validada: {previewRows.length} colaboradores. A importação cria candidatos pendentes, sem associar pessoa MK9, aprovar matrícula ou alterar cadastro existente.</div>}
    </section>
    <section className="grid grid-cols-2 gap-2 md:grid-cols-5">
      {[['Na fila',rows.filter(row=>['pendente','revisao'].includes(row.estado)).length],['Aprovadas',rows.filter(row=>row.estado==='aprovada').length],['Aplicadas',rows.filter(row=>row.estado==='aplicada').length],['Conflitos',rows.filter(row=>rosterDivergences(row,people.find(person=>person.codigo_interno===row.codigo_interno)||null).length>0).length],['Histórico',rows.length]].map(([title,value])=><div key={String(title)} className="rounded-lg border border-[#CFCDC5] bg-white p-3"><div className="text-[11px] text-[#77766F]">{title}</div><div className="text-xl font-bold text-[#171717]">{value}</div></div>)}
    </section>
    <section className={panel}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="font-semibold text-[#171717]">Revisão individual</h2><p className="mt-1 text-xs text-[#77766F]">PRM/UUID permanecem inalterados. A matrícula RH fica em um catálogo separado.</p></div>
        <div className="flex flex-wrap gap-2">
          <button className={button} onClick={() => void load()} disabled={loading}>{loading?'Atualizando…':'Atualizar'}</button>
          <button className={button} onClick={async()=>{ const {data,error:err}=await supabase!.rpc('mk9_rh_reconciliation_preview'); if(err){setError('Prévia indisponível.');return;} setPreview((Array.isArray(data)?data[0]:data) as Preview); }} disabled={loading}>Prévia de aplicação</button>
          <button className={primary} onClick={() => void applyApproved()} disabled={saving || loading}>Aplicar aprovadas</button>
        </div>
      </div>
      {preview && <p className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">Prévia: {preview.aprovadas} aprovadas para aplicação, {preview.aplicadas} já aplicadas, {preview.pendentes} pendentes/revisão e {preview.conflitos} conflitos de identidade/código.</p>}
      <div className="mt-4 grid gap-2 md:grid-cols-[1fr_220px_1fr]">
        <input className={field} value={search} onChange={event=>setSearch(event.target.value)} placeholder="Pesquisar nome, matrícula RH ou código" />
        <select className={field} value={filter} onChange={event=>setFilter(event.target.value)}><option value="todos">Todos os estados</option><option value="pendente">Pendente</option><option value="aprovada">Aprovada</option><option value="rejeitada">Rejeitada</option><option value="revisao">Em revisão</option><option value="aplicada">Aplicada</option><option value="revertida">Revertida</option><option value="conflitos">Com divergências</option></select>
        <input className={field} value={personSearch} onChange={event=>setPersonSearch(event.target.value)} placeholder="Filtrar cadastros MK9" />
      </div>
      {loading ? <p className="py-8 text-center text-sm text-[#77766F]">Carregando registros…</p> : filtered.length===0 ? <p className="py-8 text-center text-sm text-[#77766F]">Nenhum candidato encontrado.</p> : <div className="mt-3 space-y-3">
        {filtered.map(row=>{
          const chosenCode=selectedPeople[row.id] || row.codigo_interno || '';
          const person=people.find(item=>item.codigo_interno===chosenCode)||null;
          const flags=rosterDivergences(row,person);
          const candidates=people.filter(item=>!personSearch || `${item.nome} ${item.codigo_interno}`.toLocaleLowerCase('pt-BR').includes(personSearch.toLocaleLowerCase('pt-BR')));
          const reviewable=['pendente','revisao','rejeitada','aprovada'].includes(row.estado);
          return <article key={row.id} className="rounded-lg border border-[#CFCDC5] bg-white p-3 sm:p-4">
            <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-semibold text-[#171717]">{row.nome_rh}</h3><p className="font-mono text-xs text-[#5F5F5F]">Matrícula RH {row.matricula_rh} · {row.empresa}</p></div><span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${flags.length?'bg-amber-100 text-amber-900':'bg-slate-100 text-slate-700'}`}>{flags.length?`Divergência: ${flags.join(', ')}`:labelState[row.estado]||row.estado}{!person?' · sem associação MK9':''}</span></div>
            <div className="mt-3 grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
              <div><span className="text-[#77766F]">Cargo / situação RH</span><div>{row.cargo_rh} · {row.situacao_rh}</div></div><div><span className="text-[#77766F]">Local RH</span><div>{row.cidade_rh}/{row.uf_rh}</div></div>
              <div><span className="text-[#77766F]">Nome no MK9 Date</span><div>{person?.nome||row.nome_mk9||'Não associado'}</div></div><div><span className="text-[#77766F]">Código interno</span><div className="font-mono">{person?.codigo_interno||row.codigo_interno||'—'}</div></div>
              <div><span className="text-[#77766F]">Cadastro MK9 local/situação</span><div>{person?`${person.cidade||'—'}/${person.uf||'—'} · ${person.situacao}`:row.cidade_mk9?`${row.cidade_mk9}/${row.uf_mk9||'—'} · ${row.situacao_mk9||'—'}`:'—'}</div></div>
              <div><span className="text-[#77766F]">Estado da conferência</span><div>{labelState[row.estado]||row.estado}{row.aprovador_nome?` · ${row.aprovador_nome}`:''}{row.aprovado_em?` · ${new Date(row.aprovado_em).toLocaleString('pt-BR')}`:''}</div></div>
            </div>
            {reviewable&&<div className="mt-3 grid gap-2 lg:grid-cols-[1fr_1fr_auto]">
              <select className={field} value={chosenCode} onChange={event=>setSelectedPeople(prev=>({...prev,[row.id]:event.target.value}))}><option value="">Associar após conferência…</option>{candidates.map(item=><option key={`${item.tipo}:${item.codigo_interno}`} value={item.codigo_interno}>{item.nome} · {item.codigo_interno} · {item.tipo}</option>)}</select>
              <input className={field} value={decisionReferences[row.id]||''} onChange={event=>setDecisionReferences(prev=>({...prev,[row.id]:event.target.value}))} placeholder="Referência/justificativa da decisão" maxLength={500} />
              <div className="flex flex-wrap gap-1"><button className={primary} disabled={saving||!chosenCode} onClick={()=>void decide(row,'aprovar')}>Aprovar</button><button className={button} disabled={saving} onClick={()=>void decide(row,'revisar')}>Revisar</button><button className={button} disabled={saving} onClick={()=>void decide(row,'rejeitar')}>Rejeitar</button></div>
            </div>}
            <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-[#77766F]"><span>Fonte: {row.referencia_fonte}</span><button className="underline" onClick={()=>void showAudit(row)}>Consultar histórico</button>{row.estado==='aplicada'&&<button className="font-semibold text-rose-700 underline" disabled={saving} onClick={()=>void reverseApplied(row)}>Reverter aplicação</button>}</div>
          </article>;
        })}
      </div>}
    </section>
    {audit&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Histórico de decisões"><section className="max-h-[80vh] w-full max-w-2xl overflow-auto rounded-xl bg-[#F7F6F2] p-5"><div className="flex justify-between gap-3"><div><h2 className="font-bold">Histórico da matrícula RH</h2><p className="text-sm text-[#5F5F5F]">{audit.name}</p></div><button className={button} onClick={()=>setAudit(null)}>Fechar</button></div>{audit.rows.length===0?<p className="py-5 text-sm">Sem decisões registradas.</p>:<div className="mt-4 space-y-2">{audit.rows.map(item=><article key={item.id} className="rounded-lg border border-[#CFCDC5] bg-white p-3 text-xs"><strong>{labelState[item.acao]||item.acao}</strong><div>{item.autor_nome} · {new Date(item.ocorrido_em).toLocaleString('pt-BR')}</div><p className="mt-1">{item.referencia}</p></article>)}</div>}</section></div>}
  </main>;
}
