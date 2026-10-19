import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Promoter } from '../utils/attendanceEngine';
import { applyJourneys, attendanceDays } from '../lib/attendanceAdministration';
import { AttendanceSupervisorPanel } from './AttendanceSupervisorPanel';

interface JourneyTemplate { id:string; nome:string; hora_inicio:string; hora_fim:string; interval_minutes:number|null; tolerance_minutes:number|null; timezone:string; modalidade:string|null; work_uf:string|null; work_city:string|null; days?:string[] }
const errorMessage = (error: unknown) => error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Erro inesperado.';
const days = ['domingo','segunda','terca','quarta','quinta','sexta','sabado'];
const nullableNumber = (value: string) => value === '' ? null : Number(value);
const inputClass = 'border border-[#CFCDC5] bg-white text-[#171717] rounded-lg px-3 py-2 w-full';
export function AttendanceJourneyPanel({ promoters, onSaved }: { promoters: Promoter[]; onSaved: () => void }) {
  const [section, setSection] = useState<'journey' | 'absence' | 'holiday' | 'rules'>('journey');
  const [close,setClose]=useState('');
  const [matricula, setMatricula] = useState('');
  const [day, setDay] = useState('');
  const [workDays,setWorkDays]=useState<string[]>([]);
  const [bulk,setBulk]=useState(false);
  const [selectedPromoters,setSelectedPromoters]=useState<string[]>([]);
  const [rulesApproved,setRulesApproved]=useState(false);
  const [history,setHistory]=useState<Array<{id:string;changed_at:string;changed_by:string|null;justification:string;previous_value:unknown;new_value:unknown}>>([]);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [from, setFrom] = useState('');
  const [until, setUntil] = useState('');
  const [interval, setIntervalValue] = useState('');
  const [tolerance, setTolerance] = useState('');
  const [timezone, setTimezone] = useState('America/Sao_Paulo');
  const [modalidade, setModalidade] = useState('');
  const [reason, setReason] = useState('');
  const [exception, setException] = useState(false);
  const [name, setName] = useState('');
  const [workUf,setWorkUf]=useState('');
  const [workCity,setWorkCity]=useState('');
  const [uf, setUf] = useState('');
  const [city, setCity] = useState('');
  const [behavior, setBehavior] = useState('');
  const [absenceType, setAbsenceType] = useState('');
  const [approved, setApproved] = useState(false);
  const [templates, setTemplates] = useState<JourneyTemplate[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const load = async () => {
    if (!supabase) return;
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;
    const result = await supabase.from('profiles').select('role,status').eq('id',auth.user.id).single();
    setIsAdmin(result.data?.role === 'admin' && result.data.status === 'ativo');
    const { data, error } = await supabase.from('promoter_work_schedule_templates').select('*').order('nome');
    if (error) setMessage(error.message); else setTemplates(data || []);
  };
  useEffect(() => { void load().catch((error:unknown)=>setMessage(errorMessage(error))); }, []);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!supabase || busy) return;
    setBusy(true); setMessage('');
    try {
      if (reason.trim().length < 5) throw new Error('Informe uma justificativa com pelo menos 5 caracteres.');
      let result;
      if (section === 'journey') {
        await applyJourneys({matriculas:bulk?selectedPromoters:[matricula],days:workDays,start,end,from,until,interval,tolerance,timezone,modalidade,reason,exception,workUf,workCity});
        result={error:null};
      } else if (section === 'absence') {
        if (!matricula || !absenceType || !from || !until) throw new Error('Informe promotor, tipo e período.');
        const { data: auth } = await supabase.auth.getUser();
        result = await supabase.from('promoter_absences').insert({ promotor_matricula: matricula, tipo: absenceType, data_inicio: from, data_fim: until, justificativa: reason.trim(), data_aprovacao: approved ? new Date().toISOString().slice(0,10) : null, aprovado_por: approved ? auth.user?.id : null, created_by: auth.user?.id });
      } else if(section==='holiday') {
        if (!name || !from || !behavior) throw new Error('Informe nome, data e comportamento do feriado.');
        result = await supabase.from('attendance_holidays').insert({ data: from, nome: name, uf: uf.trim().toUpperCase() || null, cidade: city.trim() || null, behavior, justification: reason.trim() });
      } else {
        result=await supabase.rpc('set_attendance_rules',{p_timezone:timezone,p_close:close || null,p_tolerance:nullableNumber(tolerance),p_reason:reason.trim()});
        if(result.error) throw result.error;
        result=await supabase.rpc('approve_attendance_closure',{p_approved:rulesApproved,p_reason:reason.trim()});
      }
      if (result.error) throw result.error;
      setMessage('Configuração salva com histórico de auditoria.');
      onSaved();
    } catch (error: unknown) { setMessage(errorMessage(error) || 'Não foi possível salvar.'); }
    finally { setBusy(false); }
  };
  const saveTemplate = async () => {
    if (!supabase || !isAdmin || busy) return;
    if (!name.trim() || !start || !end || !workDays.length || reason.trim().length < 5) { setMessage('Informe nome do modelo, dias, horários e justificativa.'); return; }
    setBusy(true);
    try {
    const result = await supabase.from('promoter_work_schedule_templates').insert({ nome: name.trim(), hora_inicio: start, hora_fim: end, interval_minutes: nullableNumber(interval), tolerance_minutes: nullableNumber(tolerance), timezone, modalidade: modalidade || null, justification: reason.trim(), work_uf:workUf.trim().toUpperCase() || null, work_city:workCity.trim() || null,days:workDays });
    if(result.error) throw result.error;
    setMessage('Modelo reutilizável salvo. Selecione os promotores, dias e vigência para aplicá-lo.');
    await load();
    } catch(error:unknown){setMessage(errorMessage(error));}
    finally{setBusy(false);}
  };
  return <details data-attendance-journey className="border border-[#CFCDC5] bg-[#F7F6F2] rounded-xl p-4">
    <summary className="cursor-pointer font-bold text-[#171717]">Jornadas, modelos e calendário</summary>
    <p className="text-xs text-[#5F5F5F] my-3">Cadastre somente configurações aprovadas. Visitas não criam jornada. Selecione dias, promotores e vigência; o histórico é preservado. Exceções se aplicam a uma única data.</p>
    <div className="flex flex-wrap gap-2 mb-3">{(['journey','absence','holiday','rules'] as const).filter(s => !['holiday','rules'].includes(s) || isAdmin).map(s => <button key={s} onClick={() => { setSection(s); setMessage(''); setUntil(''); setHistory([]); }} className={`px-3 py-2 rounded-lg text-xs ${section===s?'bg-[#222222] text-white':'border border-[#CFCDC5] text-[#171717]'}`}>{s==='journey'?'Jornada / modelo':s==='absence'?'Folgas e afastamentos':s==='rules'?'Fechamento e tolerância':'Feriados por localidade'}</button>)}</div>
    {isAdmin && <AttendanceSupervisorPanel promoters={promoters} onSaved={onSaved} />}
    <form onSubmit={save} className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
      {section==='journey' && isAdmin && <label className="md:col-span-3 flex gap-2"><input type="checkbox" checked={bulk} onChange={e=>setBulk(e.target.checked)} />Aplicar a vários promotores em uma única operação</label>}
      {section==='journey' && bulk && <label className="md:col-span-3">Promotores selecionados ({selectedPromoters.length})<select multiple required className={inputClass} value={selectedPromoters} onChange={e=>setSelectedPromoters(Array.from(e.target.selectedOptions,o=>o.value))}>{promoters.map(p=><option key={p.id} value={p.matricula}>{p.nome} — {p.matricula}</option>)}</select><span>Selecione os destinatários explicitamente. O lote inteiro é revertido se houver conflito.</span></label>}
      {section==='journey' && <fieldset className="md:col-span-3"><legend>Dias trabalhados</legend><div className="flex flex-wrap gap-3">{attendanceDays.map(d=><label key={d} className="flex gap-1"><input type="checkbox" checked={workDays.includes(d)} onChange={e=>setWorkDays(e.target.checked?[...workDays,d]:workDays.filter(v=>v!==d))} />{d}</label>)}</div></fieldset>}
      {section==='journey' && !exception && <label>Vigência final (vazio = sem término definido)<input type="date" className={inputClass} value={until} onChange={e=>setUntil(e.target.value)} /></label>}
      {section==='rules' && <label className="md:col-span-3 flex gap-2"><input type="checkbox" checked={rulesApproved} onChange={e=>setRulesApproved(e.target.checked)} />Aprovo expressamente as regras de fechamento. Alterações posteriores exigem nova aprovação; operação oficial e início válido continuam obrigatórios.</label>}
      {['journey','absence'].includes(section) && !(section==='journey' && bulk) && <label>Promotor<select required value={matricula} onChange={e=>setMatricula(e.target.value)} className={inputClass}><option value="">Selecione</option>{promoters.map(p=><option key={p.id} value={p.matricula}>{p.nome} — {p.matricula}</option>)}</select></label>}
      {section === 'journey' && <>
        <label>Modelo reutilizável<select className={inputClass} defaultValue="" onChange={e=>{ const t=templates.find(t=>t.id===e.target.value); if(t){setStart(t.hora_inicio);setEnd(t.hora_fim);setIntervalValue(t.interval_minutes==null?'':String(t.interval_minutes));setTolerance(t.tolerance_minutes==null?'':String(t.tolerance_minutes));setTimezone(t.timezone);setModalidade(t.modalidade || '');setWorkUf(t.work_uf || '');setWorkCity(t.work_city || '');setWorkDays(t.days || []);setDay(t.days?.[0] || '');} }}><option value="">Configuração individual</option>{templates.map(t=><option key={t.id} value={t.id}>{t.nome}</option>)}</select></label>
        <label>Entrada<input required type="time" className={inputClass} value={start} onInput={e=>setStart(e.currentTarget.value)} onChange={e=>setStart(e.target.value)} /></label>
        <label>Saída<input required type="time" className={inputClass} value={end} onInput={e=>setEnd(e.currentTarget.value)} onChange={e=>setEnd(e.target.value)} /></label>
        <label>Intervalo (minutos; vazio = não informado)<input min="0" type="number" className={inputClass} value={interval} onChange={e=>setIntervalValue(e.target.value)} /></label>
        <label>Tolerância (minutos; vazio = regra administrativa)<input min="0" type="number" className={inputClass} value={tolerance} onChange={e=>setTolerance(e.target.value)} /></label>
        <label>Modalidade<input list="attendance-modalities" className={inputClass} value={modalidade} onChange={e=>setModalidade(e.target.value)} /><datalist id="attendance-modalities"><option>CLT integral</option><option>CLT parcial (part-time)</option><option>Freelancer</option></datalist></label>
        <label>Fuso horário<input required className={inputClass} value={timezone} onChange={e=>setTimezone(e.target.value)} /></label>
        <label>UF de trabalho<input maxLength={2} className={inputClass} value={workUf} onChange={e=>setWorkUf(e.target.value.toUpperCase())} /></label>
        <label>Município de trabalho<input className={inputClass} value={workCity} onChange={e=>setWorkCity(e.target.value)} /></label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={exception} onChange={e=>{setException(e.target.checked);setUntil('');}} />Exceção somente nesta data</label>
      </>}
      {section === 'absence' && <><label>Tipo<select required className={inputClass} value={absenceType} onChange={e=>setAbsenceType(e.target.value)}><option value="">Selecione</option>{['folga','ferias','afastamento','licenca_medica','licenca_paternidade','outro'].map(t=><option key={t}>{t}</option>)}</select></label><label>Fim do período<input required type="date" className={inputClass} value={until} onInput={e=>setUntil(e.currentTarget.value)} onChange={e=>setUntil(e.target.value)} /></label><label className="flex gap-2 items-center"><input type="checkbox" checked={approved} onChange={e=>setApproved(e.target.checked)} />Aprovado por usuário autorizado</label></>}
      {section!=='rules' && <label>{section==='holiday'?'Data do feriado':section==='journey'?'Vigência inicial / data da exceção':'Início do período'}<input required type="date" className={inputClass} value={from} onInput={e=>setFrom(e.currentTarget.value)} onChange={e=>setFrom(e.target.value)} /></label>}
      {section==='rules' && <><label>Fechamento (vazio desabilita falta automática)<input type="time" className={inputClass} value={close} onInput={e=>setClose(e.currentTarget.value)} onChange={e=>setClose(e.target.value)} /></label><label>Tolerância global (minutos; vazio desabilita atraso sem regra individual)<input type="number" min="0" className={inputClass} value={tolerance} onChange={e=>setTolerance(e.target.value)} /></label><label>Fuso horário<input required className={inputClass} value={timezone} onChange={e=>setTimezone(e.target.value)} /></label></>}
      {(isAdmin && section==='journey' || section==='holiday') && <label>{section==='holiday'?'Nome do feriado':'Nome para salvar como modelo'}<input className={inputClass} value={name} onChange={e=>setName(e.target.value)} /></label>}
      {section==='holiday' && <><label>UF (vazio = nacional)<input maxLength={2} className={inputClass} value={uf} onChange={e=>setUf(e.target.value)} /></label><label>Município (vazio = estadual)<input className={inputClass} value={city} onChange={e=>setCity(e.target.value)} /></label><label>Comportamento<select required className={inputClass} value={behavior} onChange={e=>setBehavior(e.target.value)}><option value="">Selecione explicitamente</option><option value="follow_schedule">Seguir a jornada</option><option value="off">Sem expediente neste feriado</option><option value="work">Trabalhar conforme jornada cadastrada</option></select></label></>}
      <label className="md:col-span-3">Justificativa obrigatória<textarea required minLength={5} className={inputClass} value={reason} onChange={e=>setReason(e.target.value)} /></label>
      <div className="md:col-span-3 flex flex-wrap gap-3"><button disabled={busy} className="px-4 py-2 bg-[#222222] text-white rounded-lg">{busy?'Salvando…':'Salvar configuração'}</button>{section==='journey' && isAdmin && <button disabled={busy} type="button" onClick={saveTemplate} className="px-4 py-2 border border-[#CFCDC5] rounded-lg">Salvar como modelo reutilizável</button>}</div>
      {message && <p role="status" className="md:col-span-3 text-[#171717]">{message}</p>}
    </form>
    {matricula && !bulk && <details className="mt-4 text-xs"><summary>Histórico de jornadas e vínculos do promotor</summary><button type="button" className="border rounded p-2 my-2" onClick={async()=>{
      if(!supabase) return;
      try {
        const {data,error}=await supabase.from('promoter_journey_audit').select('id,changed_at,changed_by,justification,previous_value,new_value').eq('promotor_matricula',matricula).order('changed_at',{ascending:false}).limit(25);
        if(error) throw error;
        setHistory(data || []); setMessage(data?.length?'Histórico carregado.':'Nenhuma alteração registrada para esta matrícula.');
      } catch(error:unknown){setMessage(errorMessage(error));}
    }}>Carregar últimas 25 alterações</button>{history.map(row=><article key={row.id} className="border-t py-2"><p>{new Date(row.changed_at).toLocaleString('pt-BR',{timeZone:timezone})} — Responsável: {row.changed_by || 'Sistema'}</p><p>{row.justification}</p><pre className="whitespace-pre-wrap break-words">{JSON.stringify({anterior:row.previous_value,novo:row.new_value},null,2)}</pre></article>)}</details>}
  </details>;
}
