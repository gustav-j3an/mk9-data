import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { assignSupervision } from '../lib/attendanceAdministration';
import type { Promoter } from '../utils/attendanceEngine';

export function AttendanceSupervisorPanel({promoters,onSaved}:{promoters:Promoter[];onSaved:()=>void}) {
  const [teams,setTeams]=useState<Array<{codigo:string;nome:string;supervisor_id:string|null}>>([]);
  const [supervisors,setSupervisors]=useState<Array<{id:string;nome:string}>>([]);
  const [selected,setSelected]=useState<string[]>([]);
  const [team,setTeam]=useState('');
  const [supervisor,setSupervisor]=useState('');
  const [reason,setReason]=useState('');
  const [confirmed,setConfirmed]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const input='border border-[#CFCDC5] bg-white text-[#171717] rounded-lg px-3 py-2 w-full';
  useEffect(()=>{let active=true;void(async()=>{
    if(!supabase) return;
    try{
      const [t,s]=await Promise.all([supabase.from('equipes').select('codigo,nome,supervisor_id').eq('status','ativa').order('nome'),supabase.from('supervisores').select('id,nome').eq('status','ativo').order('nome')]);
      if(t.error) throw t.error; if(s.error) throw s.error;
      if(active){setTeams(t.data || []);setSupervisors(s.data || []);}
    }catch(error:unknown){if(active)setMessage(error instanceof Error?error.message:'Não foi possível consultar equipes e supervisores.');}
  })();return()=>{active=false;};},[]);
  return <details className="border border-[#CFCDC5] rounded-lg p-3 mb-4 text-xs"><summary className="font-bold cursor-pointer">Atribuir equipe e supervisor — individual ou lote</summary>
    <p className="my-2">O responsável é definido pela equipe. Uma equipe pendente receberá o supervisor escolhido para todos os seus membros. Para trocar um responsável já definido, use Gerenciar equipes.</p>
    <form className="grid md:grid-cols-3 gap-3" onSubmit={async event=>{
      event.preventDefault();if(busy || !confirmed) return;setBusy(true);setMessage('');
      try{await assignSupervision(selected,team,supervisor,reason);setMessage('Vínculo confirmado e registrado no histórico.');onSaved();}
      catch(error:unknown){setMessage(error && typeof error==='object' && 'message' in error?String(error.message):'Falha ao salvar vínculo.');}
      finally{setBusy(false);}
    }}>
      <label>Promotores (um ou vários)<select multiple required className={input} value={selected} onChange={e=>setSelected(Array.from(e.target.selectedOptions,o=>o.value))}>{promoters.map(p=><option key={p.id} value={p.matricula}>{p.nome} — {p.matricula}</option>)}</select></label>
      <label>Equipe<select required className={input} value={team} onChange={e=>{setTeam(e.target.value);setSupervisor(teams.find(t=>t.codigo===e.target.value)?.supervisor_id || '');setConfirmed(false);}}><option value="">Selecione explicitamente</option>{teams.map(t=><option key={t.codigo} value={t.codigo}>{t.nome}</option>)}</select></label>
      <label>Supervisor<select required className={input} value={supervisor} onChange={e=>{setSupervisor(e.target.value);setConfirmed(false);}}><option value="">Selecione explicitamente</option>{supervisors.map(s=><option key={s.id} value={s.id}>{s.nome}</option>)}</select></label>
      <label className="md:col-span-3">Justificativa<textarea required minLength={5} className={input} value={reason} onChange={e=>setReason(e.target.value)} /></label>
      <label className="md:col-span-3 flex gap-2"><input type="checkbox" required checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} />Confirmo os promotores, a equipe e o responsável selecionados.</label>
      <button disabled={busy || !confirmed} className="bg-[#222222] text-white rounded-lg p-2">{busy?'Salvando…':'Confirmar vínculos'}</button>
      {message && <p role="status" className="md:col-span-3">{message}</p>}
    </form>
  </details>;
}
