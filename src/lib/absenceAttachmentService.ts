import { absenceAttachmentBucket } from './absenceAttachments';

export const absenceAttachmentsPersistenceEnabled = false;

export interface AbsenceAttachmentRecord {
  id: string;
  original_name: string;
  mime_type: 'application/pdf' | 'image/jpeg' | 'image/png';
  size_bytes: number;
  criado_em: string;
}

export interface AbsenceAttachmentGateway {
  invoke(body: FormData | Record<string, string>): Promise<{ data: unknown; error: unknown }>;
  rpc(name: string, args: Record<string, string>): Promise<{ data: unknown; error: unknown }>;
  download(path: string): Promise<{ data: Blob | null; error: unknown }>;
}

export function createAbsenceAttachmentService(gateway: AbsenceAttachmentGateway) {
  return {
    async upload(recordId: string, file: File): Promise<AbsenceAttachmentRecord> {
      const form = new FormData();
      form.set('action', 'upload');
      form.set('recordId', recordId);
      form.set('file', file, file.name);
      const { data, error } = await gateway.invoke(form);
      if (error || !isAttachment(data)) throw new Error('Não foi possível confirmar o upload do anexo.');
      return data;
    },
    async list(recordId: string): Promise<AbsenceAttachmentRecord[]> {
      const { data, error } = await gateway.rpc('mk9_faltas_atestados_list_attachments', { p_record_id: recordId });
      if (error || !Array.isArray(data) || !data.every(isAttachment)) throw new Error('Não foi possível consultar os anexos autorizados.');
      return data;
    },
    async download(id: string): Promise<Blob> {
      const { data: path, error: pathError } = await gateway.rpc('mk9_faltas_atestados_attachment_path', { p_attachment_id: id });
      if (pathError || typeof path !== 'string') throw new Error('Acesso ao anexo negado ou indisponível.');
      const { data, error } = await gateway.download(path);
      if (error || !data) throw new Error('Não foi possível baixar o anexo autorizado.');
      return data;
    },
    async remove(id: string): Promise<void> {
      const { data, error } = await gateway.invoke({ action: 'delete', attachmentId: id });
      if (error || !isObject(data) || data.deleted !== true) throw new Error('Não foi possível excluir o anexo autorizado.');
    }
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isAttachment(value: unknown): value is AbsenceAttachmentRecord {
  return isObject(value) && typeof value.id === 'string' && typeof value.original_name === 'string' &&
    ['application/pdf','image/jpeg','image/png'].includes(String(value.mime_type)) &&
    typeof value.size_bytes === 'number' && Number.isFinite(value.size_bytes) && typeof value.criado_em === 'string';
}

export function createSupabaseAbsenceAttachmentService(client: typeof import('./supabase').supabase) {
  if (!client) return null;
  return createAbsenceAttachmentService({
    invoke: async body => {
      const { data, error } = await client.functions.invoke('absence-attachments', { body });
      return { data, error };
    },
    rpc: async (name, args) => {
      const { data, error } = await client.rpc(name, args);
      return { data, error };
    },
    download: async path => {
      const { data, error } = await client.storage.from(absenceAttachmentBucket).download(path);
      return { data, error };
    }
  });
}
