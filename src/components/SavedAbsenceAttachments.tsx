import React, { useCallback, useEffect, useState } from 'react';
import type { AbsenceAttachmentRecord } from '../lib/absenceAttachmentService';

interface Service {
  list(recordId: string): Promise<AbsenceAttachmentRecord[]>;
  download(id: string): Promise<Blob>;
  remove(id: string): Promise<void>;
}

export function SavedAbsenceAttachments({ recordId, canDelete, service }: { recordId: string; canDelete: boolean; service: Service | null }) {
  const [items, setItems] = useState<AbsenceAttachmentRecord[]>([]);
  const [preview, setPreview] = useState<{ id: string; url: string } | null>(null);
  const [busyId, setBusyId] = useState('');
  const [message, setMessage] = useState('');
  const [opened, setOpened] = useState(false);
  const load = useCallback(async () => {
    if (!service) { setMessage('Consulta dos anexos será liberada após homologação do Storage privado.'); return; }
    try { setItems(await service.list(recordId)); setMessage(''); }
    catch { setItems([]); setMessage('Não foi possível consultar anexos autorizados.'); }
  }, [recordId, service]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  const open = async (item: AbsenceAttachmentRecord) => {
    if (!service) return;
    setBusyId(item.id); setMessage('');
    try {
      const blob = await service.download(item.id);
      if (item.mime_type.startsWith('image/')) {
        if (preview) URL.revokeObjectURL(preview.url);
        setPreview({ id: item.id, url: URL.createObjectURL(blob) });
      } else {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = item.original_name; anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch { setMessage('Download negado ou indisponível para este anexo.'); }
    finally { setBusyId(''); }
  };

  const remove = async (item: AbsenceAttachmentRecord) => {
    if (!service || !canDelete) return;
    setBusyId(item.id); setMessage('');
    try { await service.remove(item.id); if (preview?.id === item.id) setPreview(null); await load(); }
    catch { setMessage('Não foi possível excluir o anexo autorizado.'); }
    finally { setBusyId(''); }
  };

  return <section className="mt-3 border-t border-[#E2E0D9] pt-3" aria-label="Anexos do registro">
    <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-semibold">Anexos</h4><button type="button" className="text-xs underline" disabled={!service} onClick={() => { setOpened(true); void load(); }}>{service ? 'Consultar anexos privados' : 'Disponível após homologação'}</button></div>
    {message && <p role="status" className="mt-1 text-xs text-[#737373]">{message}</p>}
    {opened && items.length === 0 && !message && <p className="mt-1 text-xs text-[#737373]">Nenhum anexo registrado.</p>}
    {opened && items.length > 0 && <ul className="mt-2 space-y-2">{items.map(item => <li key={item.id} className="flex flex-wrap items-center gap-2 text-xs">
      <span className="min-w-0 flex-1 break-all">{item.original_name} · {(item.size_bytes / 1024 / 1024).toFixed(2)} MiB</span>
      <button type="button" className="underline" disabled={!!busyId} onClick={() => void open(item)}>{busyId === item.id ? 'Processando…' : item.mime_type.startsWith('image/') ? 'Visualizar' : 'Baixar PDF'}</button>
      {canDelete && <button type="button" className="text-red-800 underline" disabled={!!busyId} onClick={() => void remove(item)}>Excluir</button>}
    </li>)}</ul>}
    {preview && <figure className="mt-3"><img src={preview.url} alt="Pré-visualização autorizada do anexo" className="max-h-96 max-w-full rounded border border-[#D8D6CF]" /><button type="button" className="mt-1 text-xs underline" onClick={() => setPreview(null)}>Fechar pré-visualização</button></figure>}
  </section>;
}
