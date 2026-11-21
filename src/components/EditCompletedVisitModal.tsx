import React, { useEffect, useMemo, useState } from 'react';
import type { Visit, VisitOccurrence, VisitPhoto, VisitProductValidity } from '../types';
import { supabase } from '../lib/supabase';
import { validatePromoterEditPermission } from '../utils/completedVisitEdit';

interface SkuEditRow {
  id?: string;
  codigo_sku: string;
  quantidade_venda: number;
  quantidade_deposito: number;
  quantidade_reposicao: number;
  quantidade_anterior_venda?: number;
  quantidade_anterior_deposito?: number;
  status_conferencia: 'conferido' | 'justificado' | 'pendente';
  justificativa?: string | null;
  observacao?: string | null;
}

interface EditPayload {
  observacao_geral: string;
  checklist_items: NonNullable<Visit['checklist_items']>;
  validity_items: Array<Pick<VisitProductValidity, 'id' | 'produto_nome' | 'quantidade' | 'data_vencimento' | 'lote' | 'observacao'>>;
  sku_stock_checks: SkuEditRow[];
  occurrences: Array<Pick<VisitOccurrence, 'id' | 'tipo' | 'descricao' | 'resolvido'>>;
  photos: Array<Pick<VisitPhoto, 'id' | 'tipo_foto' | 'storage_path' | 'file_url' | 'legenda'>>;
}

interface Props {
  visit: Visit;
  currentPromoterMatricula?: string;
  userRole?: string;
  isOpen: boolean;
  onClose: () => void;
  onSaveEdit: (args: { visitId: string; editToken: string; payload: EditPayload; reason: string }) => Promise<void>;
  onShowToast: (toast: { title: string; message: string; type: 'success' | 'warning' | 'error' | 'info' }) => void;
}

const sectionClass = 'rounded-xl border border-[#CFCDC5] bg-[#F7F6F2]';
const inputClass = 'min-h-10 w-full rounded-lg border border-[#CFCDC5] bg-white px-3 text-sm text-[#171717]';

export const EditCompletedVisitModal: React.FC<Props> = ({
  visit, currentPromoterMatricula, userRole, isOpen, onClose, onSaveEdit, onShowToast
}) => {
  const [observation, setObservation] = useState(visit.observacao_geral || '');
  const [checklist, setChecklist] = useState<NonNullable<Visit['checklist_items']>>(() => structuredClone(visit.checklist_items || []));
  const [validity, setValidity] = useState<NonNullable<Visit['validity_items']>>(() => structuredClone(visit.validity_items || []));
  const [occurrences, setOccurrences] = useState<NonNullable<Visit['occurrences']>>(() => structuredClone(visit.occurrences || []));
  const [photos, setPhotos] = useState<VisitPhoto[]>(() => structuredClone(visit.photos || []));
  const [skuRows, setSkuRows] = useState<SkuEditRow[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadingSku, setLoadingSku] = useState(false);
  const [skuLoadError, setSkuLoadError] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ checklist: true });
  const permission = useMemo(() => validatePromoterEditPermission(visit, currentPromoterMatricula, userRole), [visit, currentPromoterMatricula, userRole]);

  useEffect(() => {
    if (!isOpen || !supabase) return;
    let cancelled = false;
    setLoadingSku(true);
    setSkuLoadError(false);
    void (async () => {
      try {
        const { data, error } = await supabase.from('visit_sku_stock_checks').select('*').eq('visit_id', visit.id).order('codigo_sku');
        if (cancelled) return;
        if (error) throw error;
        setSkuRows((data || []) as SkuEditRow[]);
      } catch (error) {
        if (!cancelled) {
          setSkuLoadError(true);
          onShowToast({ title: 'Conferências indisponíveis', message: error instanceof Error ? error.message : 'Não foi possível carregar os SKUs deste atendimento.', type: 'error' });
        }
      } finally {
        if (!cancelled) setLoadingSku(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, visit.id, onShowToast]);

  if (!isOpen) return null;

  const updateRow = <T,>(rows: T[], setRows: React.Dispatch<React.SetStateAction<T[]>>, index: number, key: keyof T, value: T[keyof T]) => {
    setRows(rows.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row));
  };
  const toggle = (key: string) => setExpanded((previous) => ({ ...previous, [key]: !previous[key] }));
  const section = (key: string, title: string, count?: number, content?: React.ReactNode) => (
    <section className={sectionClass} key={key}>
      <button type="button" aria-expanded={Boolean(expanded[key])} onClick={() => toggle(key)} className="flex min-h-12 w-full items-center justify-between gap-3 px-4 text-left font-bold text-[#292929]">
        <span>{title}{count === undefined ? '' : ` (${count})`}</span>
        <span className="material-symbols-outlined" aria-hidden="true">{expanded[key] ? 'expand_less' : 'expand_more'}</span>
      </button>
      {expanded[key] && <div className="space-y-3 border-t border-[#CFCDC5] p-4">{content}</div>}
    </section>
  );

  const uploadNewPhotos = async (token: string) => {
    if (!supabase) throw new Error('Conexão com o Supabase indisponível.');
    const uploaded: string[] = [];
    const additions: EditPayload['photos'] = [];
    try {
      for (const file of selectedFiles) {
        if (!file.type.startsWith('image/') || file.size > 5 * 1024 * 1024) throw new Error('Use imagens de até 5 MB para anexar evidências.');
        const extension = file.name.split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'jpg';
        const path = `visits/${visit.id}/edits/${token}/${crypto.randomUUID()}.${extension}`;
        const { error } = await supabase.storage.from('visit-photos').upload(path, file, { contentType: file.type, upsert: false });
        if (error) throw error;
        uploaded.push(path);
        additions.push({ tipo_foto: 'outros', storage_path: path, file_url: path, legenda: file.name });
      }
      return { additions };
    } catch (error) {
      if (uploaded.length) await supabase.storage.from('visit-photos').remove(uploaded);
      throw error;
    }
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!permission.canEdit) return;
    if (!supabase) {
      onShowToast({ title: 'Conexão indisponível', message: 'Não foi possível conectar ao backend para salvar a revisão.', type: 'error' });
      return;
    }
    if (reason.trim().length < 5) {
      onShowToast({ title: 'Justificativa obrigatória', message: 'Informe pelo menos 5 caracteres para registrar a alteração na auditoria.', type: 'warning' });
      return;
    }
    setSaving(true);
    try {
      const { data: authData, error: authError } = await supabase.rpc('begin_completed_visit_edit', { p_visit_id: visit.id });
      if (authError) throw authError;
      const token = (authData as { edit_token?: string } | null)?.edit_token;
      if (!token) throw new Error('O banco não emitiu uma autorização válida para a revisão.');
      const uploadResult = await uploadNewPhotos(token);
      const payload: EditPayload = {
        observacao_geral: observation,
        checklist_items: checklist,
        validity_items: validity.map(({ id, produto_nome, quantidade, data_vencimento, lote, observacao: note }) => ({ id, produto_nome, quantidade, data_vencimento, lote, observacao: note })),
        sku_stock_checks: skuRows,
        occurrences: occurrences.map(({ id, tipo, descricao, resolvido }) => ({ id, tipo, descricao, resolvido })),
        photos: [...photos.map(({ id, tipo_foto, storage_path, file_url, legenda }) => ({ id, tipo_foto, storage_path, file_url, legenda })), ...uploadResult.additions]
      };
      await onSaveEdit({ visitId: visit.id, editToken: token, payload, reason: reason.trim() });
      onShowToast({ title: 'Atendimento atualizado', message: 'A revisão foi salva com justificativa e valores anteriores/posteriores na auditoria. As fotos originais foram preservadas.', type: 'success' });
      onClose();
    } catch (error) {
      onShowToast({ title: 'Falha na edição', message: error instanceof Error ? error.message : 'Não foi possível salvar a revisão.', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  if (!permission.canEdit) return <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"><div className="w-full max-w-md rounded-2xl border border-[#CFCDC5] bg-[#F7F6F2] p-6"><h2 className="font-bold">Edição não permitida</h2><p className="my-4 text-sm">{permission.reason}</p><button type="button" onClick={onClose} className="rounded-lg bg-[#EAE8E2] px-4 py-2">Fechar</button></div></div>;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 sm:p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="completed-edit-title" className="max-h-[96dvh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-[#CFCDC5] bg-[#F7F6F2] p-4 text-sm shadow-2xl sm:p-6">
        <header className="mb-4 flex items-start justify-between gap-3 border-b border-[#CFCDC5] pb-3">
          <div><h2 id="completed-edit-title" className="font-bold text-base text-[#171717]">Revisão completa do atendimento</h2><p className="mt-1 text-xs text-[#5F5F5F]">{visit.loja?.nome || visit.loja_codigo} · {visit.industria?.nome || visit.industria_codigo}</p></div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Fechar edição" className="rounded-lg p-2 hover:bg-[#EAE8E2]"><span className="material-symbols-outlined">close</span></button>
        </header>
        <div className="mb-4 rounded-xl border border-[#CFCDC5] bg-[#EAE8E2] p-3 text-xs">
          <strong className="block uppercase text-[#5F5F5F]">Dados operacionais protegidos</strong>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4"><span>Data: <b>{visit.data_visita.split('-').reverse().join('/')}</b></span><span>Promotor: <b>{visit.promotor_matricula}</b></span><span>Check-in: <b>{visit.started_at ? new Date(visit.started_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'}</b></span><span>Checkout: <b>{visit.completed_at ? new Date(visit.completed_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'}</b></span></div>
          <p className="mt-2">Loja, indústria, rota e status concluído também não podem ser alterados.</p>
        </div>

        <form onSubmit={handleSave} className="space-y-3">
          {section('checklist', 'Checklist e quantidades', checklist.length, checklist.length ? checklist.map((item, index) => <div key={item.item_key} className="grid gap-2 rounded-lg border border-[#CFCDC5] p-3 sm:grid-cols-[1fr_9rem_1fr]"><strong>{item.item_label}</strong><input aria-label={`Quantidade: ${item.item_label}`} className={inputClass} value={item.valor_texto || ''} onChange={(e) => updateRow(checklist, setChecklist, index, 'valor_texto', e.target.value)} placeholder="Quantidade / valor"/><input aria-label={`Observação: ${item.item_label}`} className={inputClass} value={item.observacao || ''} onChange={(e) => updateRow(checklist, setChecklist, index, 'observacao', e.target.value)} placeholder="Observação"/><label className="flex items-center gap-2 sm:col-span-3"><input type="checkbox" checked={Boolean(item.checked)} onChange={(e) => updateRow(checklist, setChecklist, index, 'checked', e.target.checked)}/>Atividade realizada</label></div>) : <p className="text-xs text-[#5F5F5F]">Nenhum item de checklist registrado.</p>)}

          {section('skus', 'Estoque e conferência por SKU', skuRows.length, loadingSku ? <p>Carregando conferências…</p> : skuRows.length ? skuRows.map((sku, index) => <div key={sku.codigo_sku} className="grid gap-2 rounded-lg border border-[#CFCDC5] p-3 sm:grid-cols-[1fr_repeat(3,7rem)]"><strong className="self-center">SKU {sku.codigo_sku}</strong>{(['quantidade_venda','quantidade_deposito','quantidade_reposicao'] as const).map((key) => <label key={key} className="text-xs">{key === 'quantidade_venda' ? 'Área de vendas' : key === 'quantidade_deposito' ? 'Depósito' : 'Reposição'}<input type="number" min="0" className={inputClass} value={sku[key]} onChange={(e) => updateRow(skuRows, setSkuRows, index, key, Number(e.target.value))}/></label>)}<select aria-label={`Status SKU ${sku.codigo_sku}`} className={inputClass} value={sku.status_conferencia} onChange={(e) => updateRow(skuRows, setSkuRows, index, 'status_conferencia', e.target.value as SkuEditRow['status_conferencia'])}><option value="conferido">Conferido</option><option value="justificado">Justificado</option><option value="pendente">Pendente</option></select><input className={inputClass} value={sku.justificativa || ''} onChange={(e) => updateRow(skuRows, setSkuRows, index, 'justificativa', e.target.value)} placeholder="Justificativa"/><input className={inputClass} value={sku.observacao || ''} onChange={(e) => updateRow(skuRows, setSkuRows, index, 'observacao', e.target.value)} placeholder="Observação"/></div>) : <p className="text-xs text-[#5F5F5F]">Nenhuma conferência por SKU registrada.</p>)}

          {section('validity', 'Validades e campos complementares', validity.length, <><p className="text-xs text-[#5F5F5F]">Revise os produtos registrados. Novos campos podem ser incluídos; registros originais só são removidos do conjunto da visita após o diff auditável.</p>{validity.map((item, index) => <div key={item.id || index} className="grid gap-2 rounded-lg border border-[#CFCDC5] p-3 sm:grid-cols-2"><input className={inputClass} aria-label="Produto" value={item.produto_nome} onChange={(e) => updateRow(validity, setValidity, index, 'produto_nome', e.target.value)}/><input className={inputClass} aria-label="Quantidade" type="number" min="0" value={item.quantidade} onChange={(e) => updateRow(validity, setValidity, index, 'quantidade', Number(e.target.value))}/><input className={inputClass} aria-label="Data de validade" type="date" value={item.data_vencimento} onChange={(e) => updateRow(validity, setValidity, index, 'data_vencimento', e.target.value)}/><input className={inputClass} aria-label="Lote" value={item.lote || ''} onChange={(e) => updateRow(validity, setValidity, index, 'lote', e.target.value)}/><input className={inputClass} aria-label="Observação da validade" value={item.observacao || ''} onChange={(e) => updateRow(validity, setValidity, index, 'observacao', e.target.value)}/></div>)}<button type="button" onClick={() => setValidity((rows) => [...rows, { produto_nome: '', quantidade: 0, data_vencimento: '', lote: '', observacao: '' }])} className="rounded-lg border border-[#CFCDC5] px-3 py-2 font-semibold">Adicionar produto / validade</button></>)}

          {section('occurrences', 'Ocorrências e informações complementares', occurrences.length, <>{occurrences.map((item, index) => <div key={item.id || index} className="grid gap-2 rounded-lg border border-[#CFCDC5] p-3 sm:grid-cols-[11rem_1fr_auto]"><select className={inputClass} value={item.tipo} onChange={(e) => updateRow(occurrences, setOccurrences, index, 'tipo', e.target.value as VisitOccurrence['tipo'])}><option value="ruptura">Ruptura</option><option value="preco_divergente">Preço divergente</option><option value="falta_espaco">Falta de espaço</option><option value="outro">Outro</option></select><input className={inputClass} value={item.descricao} onChange={(e) => updateRow(occurrences, setOccurrences, index, 'descricao', e.target.value)}/><label className="flex items-center gap-2"><input type="checkbox" checked={Boolean(item.resolvido)} onChange={(e) => updateRow(occurrences, setOccurrences, index, 'resolvido', e.target.checked)}/>Resolvido</label></div>)}<button type="button" onClick={() => setOccurrences((rows) => [...rows, { tipo: 'outro', descricao: '', resolvido: false }])} className="rounded-lg border border-[#CFCDC5] px-3 py-2 font-semibold">Adicionar ocorrência</button><label className="block space-y-1"><span className="font-semibold">Observações gerais</span><textarea className={`${inputClass} min-h-24 py-2`} value={observation} onChange={(e) => setObservation(e.target.value)} placeholder="Observações do atendimento"/></label></>)}

          {section('photos', 'Fotografias e evidências', photos.length + selectedFiles.length, <><p className="text-xs text-[#5F5F5F]">Fotos originais permanecem armazenadas e auditadas; novas evidências são anexadas sem sobrescrever objetos antigos.</p>{photos.map((photo) => <div key={photo.id || photo.storage_path} className="grid items-center gap-3 rounded-lg border border-[#CFCDC5] p-3 sm:grid-cols-[5rem_1fr]"><img src={photo.signed_url || photo.file_url} alt={photo.legenda || 'Evidência do atendimento'} className="h-16 w-20 rounded object-cover"/><div className="grid gap-2 sm:grid-cols-2"><select aria-label="Tipo de evidência" className={inputClass} value={photo.tipo_foto} onChange={(e) => setPhotos((rows) => rows.map((row) => row.id === photo.id ? { ...row, tipo_foto: e.target.value as VisitPhoto['tipo_foto'] } : row))}><option value="fachada">Fachada</option><option value="gondola">Gôndola</option><option value="preco">Preço</option><option value="ponto_extra">Ponto extra</option><option value="ruptura">Ruptura</option><option value="outros">Outros</option></select><input aria-label="Legenda da evidência" className={inputClass} value={photo.legenda || ''} onChange={(e) => setPhotos((rows) => rows.map((row) => row.id === photo.id ? { ...row, legenda: e.target.value } : row))}/></div></div>)}<label className="block space-y-1"><span className="font-semibold">Adicionar fotografias (até 5 MB cada)</span><input type="file" accept="image/*" multiple className="block w-full text-sm" onChange={(e) => setSelectedFiles(Array.from(e.target.files || []))}/></label>{selectedFiles.length > 0 && <p>{selectedFiles.map((file) => file.name).join(', ')}</p>}</>)}

          <section className="rounded-xl border border-amber-300 bg-amber-50 p-4"><label className="block space-y-2"><span className="font-bold text-amber-950">Justificativa obrigatória</span><textarea required minLength={5} maxLength={1000} className={`${inputClass} min-h-20 border-amber-300`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Explique por que os dados do atendimento estão sendo corrigidos."/></label></section>
          <footer className="flex flex-col-reverse justify-end gap-2 border-t border-[#CFCDC5] pt-3 sm:flex-row"><button type="button" onClick={onClose} disabled={saving} className="rounded-xl bg-[#EAE8E2] px-4 py-2 font-bold">Cancelar</button><button type="submit" disabled={saving || loadingSku || skuLoadError} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-purple-700 px-5 py-2 font-bold text-white disabled:opacity-50"><span className="material-symbols-outlined">{saving ? 'sync' : 'save'}</span>{saving ? 'Salvando revisão…' : 'Salvar alterações'}</button></footer>
        </form>
      </div>
    </div>
  );
};
