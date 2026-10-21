import React, { useRef, useState } from 'react';
import { prepareAbsenceAttachment } from '../lib/absenceAttachments';

export interface SelectedAbsenceAttachment {
  file: File;
  previewUrl: string | null;
}

const inputClass = 'sr-only';

export function AbsenceAttachments({ attachments, onChange, uploadStatus = '' }: { attachments: SelectedAbsenceAttachment[]; onChange: (files: SelectedAbsenceAttachment[]) => void; uploadStatus?: string }) {
  const picker = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setProcessing(true); setError('');
    const next: SelectedAbsenceAttachment[] = [];
    try {
      for (const file of Array.from(files)) next.push(await prepareAbsenceAttachment(file));
      if (attachments.length + next.length > 5) throw new Error('Anexe no máximo 5 arquivos.');
      onChange([...attachments, ...next]);
    } catch (cause) {
      next.forEach(item => { if (item.previewUrl) URL.revokeObjectURL(item.previewUrl); });
      setError(cause instanceof Error ? cause.message : 'Não foi possível processar o arquivo.');
    } finally {
      setProcessing(false);
      if (picker.current) picker.current.value = '';
      if (camera.current) camera.current.value = '';
    }
  };

  const remove = (index: number) => {
    const item = attachments[index];
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    onChange(attachments.filter((_, current) => current !== index));
  };

  return <section className="space-y-3" aria-labelledby="absence-attachments-title">
    <div><h3 id="absence-attachments-title" className="text-sm font-semibold">Atestado ou documento (opcional)</h3><p className="mt-1 text-xs text-[#737373]">PDF, JPG, JPEG ou PNG · até 10 MiB por arquivo · máximo 5. Arquivos selecionados permanecem apenas neste navegador até a homologação do armazenamento privado.</p></div>
    <input ref={picker} className={inputClass} type="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" multiple onChange={event => void addFiles(event.target.files)} />
    <input ref={camera} className={inputClass} type="file" accept="image/*" capture="environment" onChange={event => void addFiles(event.target.files)} />
    <div className="flex flex-wrap gap-2"><button type="button" className="rounded-lg border border-[#CFCDC5] px-3 py-2 text-sm" disabled={processing || !!uploadStatus || attachments.length >= 5} onClick={() => picker.current?.click()}>Selecionar arquivo</button><button type="button" className="rounded-lg border border-[#CFCDC5] px-3 py-2 text-sm" disabled={processing || !!uploadStatus || attachments.length >= 5} onClick={() => camera.current?.click()}>Tirar foto</button>{processing && <span role="status" className="self-center text-xs">Validando e processando…</span>}{uploadStatus && <span role="status" className="self-center text-xs">{uploadStatus}</span>}</div>
    {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
    {attachments.length > 0 && <ul className="grid gap-3 sm:grid-cols-2">{attachments.map((item, index) => <li key={`${item.file.name}-${item.file.lastModified}-${index}`} className="flex gap-3 rounded-lg border border-[#D8D6CF] bg-white p-3">
      {item.previewUrl ? <img src={item.previewUrl} alt={`Pré-visualização de ${item.file.name}`} className="h-20 w-20 rounded object-cover" /> : <div aria-hidden="true" className="grid h-20 w-20 place-items-center rounded bg-[#ECEAE4] text-sm font-bold">PDF</div>}
      <div className="min-w-0 flex-1"><p className="break-all text-sm font-medium">{item.file.name}</p><p className="text-xs text-[#737373]">{(item.file.size / 1024 / 1024).toFixed(2)} MiB · {item.file.type === 'application/pdf' ? 'PDF' : 'Imagem'} · somente no navegador</p><button type="button" className="mt-2 text-xs font-semibold text-red-800 underline" onClick={() => remove(index)}>Remover</button></div>
    </li>)}</ul>}
  </section>;
}
