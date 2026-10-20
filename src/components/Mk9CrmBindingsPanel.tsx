import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

interface PromoterIdentity { id: string; matricula: string; name: string }
interface BindingRow {
  promotor_id: string; matricula_local: string; nome_local: string;
  usuario_id: string | null; usuario_nome: string | null; identidade_estado: string | null;
  identidade_aprovador: string | null; identidade_aprovador_nome: string | null; identidade_aprovado_em: string | null;
  alocacao_id: string | null; projeto_externo_id: string | null; matricula_externa: string | null;
  ocorrencias_desde: string | null; ocorrencias_ate: string | null; valido_desde: string | null; valido_ate: string | null;
  alocacao_estado: string | null; alocacao_aprovador: string | null; alocacao_aprovador_nome: string | null;
  alocacao_aprovado_em: string | null; referencia: string | null;
}

const statusLabel = (state: string | null) => ({
  pendente: 'Pendente de aprovação',
  aprovado: 'Aprovado',
  revogado: 'Revogado'
}[state || ''] || 'Sem vínculo');

export function Mk9CrmBindingsPanel({ promoter }: { promoter: PromoterIdentity }) {
  const [permitted, setPermitted] = useState<boolean | null>(null);
  const [rows, setRows] = useState<BindingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [projectId, setProjectId] = useState('');
  const [externalMatricula, setExternalMatricula] = useState('');
  const [occurrencesFrom, setOccurrencesFrom] = useState('');
  const [occurrencesTo, setOccurrencesTo] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validTo, setValidTo] = useState('');
  const [reference, setReference] = useState('');

  const load = useCallback(async () => {
    if (!supabase) { setError('Cliente Supabase não configurado.'); setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const permission = await supabase.rpc('mk9_rh_admin_can_manage');
      if (permission.error) throw permission.error;
      const allowed = permission.data === true;
      setPermitted(allowed);
      if (!allowed) { setRows([]); return; }
      const result = await supabase.rpc('mk9_rh_admin_bindings', { p_promotor_id: promoter.id });
      if (result.error) throw result.error;
      setRows((result.data || []) as BindingRow[]);
    } catch {
      setError('Não foi possível carregar os vínculos CRM MK9. Verifique a migration local e a permissão específica de integração.');
    } finally { setLoading(false); }
  }, [promoter.id]);

  useEffect(() => { void load(); }, [load]);

  const createPending = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!supabase || saving) return;
    if (!projectId.trim() || !externalMatricula.trim() || !occurrencesFrom || !validFrom || reference.trim().length < 3) {
      setError('Informe projeto, matrícula externa, início da janela de ocorrências, início de vigência e referência administrativa.');
      return;
    }
    if (occurrencesTo && occurrencesTo < occurrencesFrom) {
      setError('O fim da janela de ocorrências não pode anteceder o início.');
      return;
    }
    if (validTo && new Date(validTo).getTime() <= new Date(validFrom).getTime()) {
      setError('O fim da vigência deve ser posterior ao início.');
      return;
    }
    setSaving(true); setError('');
    try {
      const { error: saveError } = await supabase.rpc('mk9_rh_admin_prepare_allocation', {
        p_promotor_id: promoter.id,
        p_projeto_externo_id: projectId.trim(),
        p_matricula_externa: externalMatricula.trim(),
        p_ocorrencias_desde: occurrencesFrom,
        p_ocorrencias_ate: occurrencesTo || null,
        p_valido_desde: new Date(validFrom).toISOString(),
        p_valido_ate: validTo ? new Date(validTo).toISOString() : null,
        p_referencia: reference.trim()
      });
      if (saveError) throw saveError;
      setProjectId(''); setExternalMatricula(''); setOccurrencesFrom(''); setOccurrencesTo('');
      setValidFrom(''); setValidTo(''); setReference('');
      await load();
    } catch {
      setError('Vínculo não preparado. Confirme o UUID do projeto, a matrícula externa e se não existe vínculo duplicado ou identidade ambígua.');
    } finally { setSaving(false); }
  };

  return (
    <section className="space-y-4 border-t border-[#CFCDC5] pt-5" aria-label="Integração CRM MK9">
      <div>
        <h3 className="text-sm font-bold text-[#171717]">Integração CRM MK9</h3>
        <p className="mt-1 text-[11px] text-[#77766F]">Preparação de identidade e alocações externas. Nenhum registro é enviado ao CRM nesta etapa.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-lg border border-[#CFCDC5] bg-[#EAE8E2] p-3 text-xs">
        <div><span className="text-[#77766F]">Promotor</span><div className="font-semibold text-[#171717]">{promoter.name}</div></div>
        <div><span className="text-[#77766F]">Matrícula interna MK9 Date</span><div className="font-mono font-semibold text-[#171717]">{promoter.matricula}</div></div>
      </div>
      {loading && <p className="text-xs text-[#77766F]">Carregando vínculos…</p>}
      {permitted === false && !loading && <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800">Esta conta não possui a permissão específica de administração da integração CRM. O papel admin, sozinho, não libera esta seção.</p>}
      {error && <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-700">{error}</p>}
      {permitted && !loading && rows.map((row, index) => (
        <article key={row.alocacao_id || row.promotor_id + '-' + index} className="rounded-lg border border-[#CFCDC5] bg-[#F7F6F2] p-3 text-xs space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="text-[#171717]">Identidade: {statusLabel(row.identidade_estado)}</strong>
            {row.usuario_nome && <span className="text-[#5F5F5F]">Conta: {row.usuario_nome}</span>}
            {!row.usuario_id && <span className="text-amber-700">Conta autenticada não vinculada</span>}
            {row.identidade_aprovado_em && <span className="text-[#5F5F5F]">Aprovada {new Date(row.identidade_aprovado_em).toLocaleString()}</span>}
            {row.identidade_aprovador_nome && <span className="text-[#5F5F5F]">por {row.identidade_aprovador_nome}</span>}
          </div>
          {row.alocacao_id ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 border-t border-[#CFCDC5] pt-2 text-[#5F5F5F]">
              <div><span>Projeto externo (UUID):</span><div className="break-all font-mono text-[#171717]">{row.projeto_externo_id}</div></div>
              <div><span>Matrícula externa:</span><div className="font-mono text-[#171717]">{row.matricula_externa}</div></div>
              <div><span>Ocorrências permitidas:</span><div>{row.ocorrencias_desde} até {row.ocorrencias_ate || 'sem fim definido'}</div></div>
              <div><span>Vigência:</span><div>{row.valido_desde && new Date(row.valido_desde).toLocaleString()} até {row.valido_ate ? new Date(row.valido_ate).toLocaleString() : 'sem fim definido'}</div></div>
              <div><span>Status:</span><div className="font-semibold text-[#171717]">{statusLabel(row.alocacao_estado)}</div></div>
              {row.alocacao_aprovado_em && <div><span>Aprovada:</span><div>{new Date(row.alocacao_aprovado_em).toLocaleString()}{row.alocacao_aprovador_nome ? ' por ' + row.alocacao_aprovador_nome : ''}</div></div>}
              {row.referencia && <div className="sm:col-span-2"><span>Referência administrativa:</span><div className="break-words">{row.referencia}</div></div>}
            </div>
          ) : <p className="text-[#77766F]">Ainda não há alocação externa registrada.</p>}
        </article>
      ))}
      {permitted && !loading && (
        <form onSubmit={createPending} className="space-y-3 rounded-lg border border-cyan-700/30 bg-cyan-50/40 p-3">
          <h4 className="text-xs font-bold text-[#171717]">Preparar nova alocação pendente</h4>
          <p className="text-[11px] text-[#5F5F5F]">Use dados externos confirmados pelo responsável do CRM. Projeto e matrícula são informados por vínculo; não são inferidos pela equipe, UF ou nome. A gravação não aprova nem ativa o acesso.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="space-y-1 text-[11px] text-[#5F5F5F]">UUID do projeto externo
              <input required value={projectId} onChange={e => setProjectId(e.target.value)} placeholder="UUID confirmado pelo CRM" className="w-full rounded border border-[#CFCDC5] bg-white px-2 py-2 font-mono text-xs text-[#171717]" />
            </label>
            <label className="space-y-1 text-[11px] text-[#5F5F5F]">Matrícula real externa
              <input required value={externalMatricula} onChange={e => setExternalMatricula(e.target.value)} className="w-full rounded border border-[#CFCDC5] bg-white px-2 py-2 font-mono text-xs text-[#171717]" />
            </label>
            <label className="space-y-1 text-[11px] text-[#5F5F5F]">Ocorrências desde
              <input required type="date" value={occurrencesFrom} onChange={e => setOccurrencesFrom(e.target.value)} className="w-full rounded border border-[#CFCDC5] bg-white px-2 py-2 text-xs text-[#171717]" />
            </label>
            <label className="space-y-1 text-[11px] text-[#5F5F5F]">Ocorrências até (opcional)
              <input type="date" value={occurrencesTo} onChange={e => setOccurrencesTo(e.target.value)} className="w-full rounded border border-[#CFCDC5] bg-white px-2 py-2 text-xs text-[#171717]" />
            </label>
            <label className="space-y-1 text-[11px] text-[#5F5F5F]">Vínculo válido desde
              <input required type="datetime-local" value={validFrom} onChange={e => setValidFrom(e.target.value)} className="w-full rounded border border-[#CFCDC5] bg-white px-2 py-2 text-xs text-[#171717]" />
            </label>
            <label className="space-y-1 text-[11px] text-[#5F5F5F]">Válido até (opcional)
              <input type="datetime-local" value={validTo} onChange={e => setValidTo(e.target.value)} className="w-full rounded border border-[#CFCDC5] bg-white px-2 py-2 text-xs text-[#171717]" />
            </label>
            <label className="space-y-1 text-[11px] text-[#5F5F5F] sm:col-span-2">Referência administrativa da conferência
              <input required minLength={3} maxLength={500} value={reference} onChange={e => setReference(e.target.value)} placeholder="Documento ou referência de aprovação" className="w-full rounded border border-[#CFCDC5] bg-white px-2 py-2 text-xs text-[#171717]" />
            </label>
          </div>
          <button disabled={saving} className="rounded-lg bg-[#222222] px-4 py-2 text-xs font-bold text-white disabled:opacity-50">{saving ? 'Preparando…' : 'Salvar como pendente'}</button>
        </form>
      )}
    </section>
  );
}
