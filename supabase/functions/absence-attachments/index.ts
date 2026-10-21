import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { detectAbsenceAttachmentType, maxAbsenceAttachmentBytes } from '../../../shared/absenceAttachmentValidation.ts';

const bucket = 'absence-documents';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const allowedOrigins = new Set(['https://mk9-date.vercel.app', 'http://localhost:3000', 'http://127.0.0.1:3000']);

function response(body: unknown, status: number, origin: string | null, extraHeaders: HeadersInit = {}) {
  const headers = new Headers(extraHeaders);
  headers.set('Cache-Control', 'private, no-store');
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Vary', 'Origin');
  if (origin && allowedOrigins.has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Headers', 'authorization, apikey, x-client-info, content-type');
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  }
  return new Response(JSON.stringify(body), { status, headers });
}

Deno.serve(async request => {
  const origin = request.headers.get('Origin');
  if (origin && !allowedOrigins.has(origin)) return response({ error: 'Origem não autorizada.' }, 403, null);
  if (request.method === 'OPTIONS') return response({ ok: true }, 200, origin);
  if (request.method !== 'POST') return response({ error: 'Método não permitido.' }, 405, origin, { Allow: 'POST, OPTIONS' });

  const authorization = request.headers.get('Authorization');
  const url = Deno.env.get('SUPABASE_URL');
  const publicKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!authorization?.startsWith('Bearer ') || !url || !publicKey) return response({ error: 'Sessão ou configuração indisponível.' }, 401, origin);

  const client = createClient(url, publicKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await client.auth.getUser(authorization.slice(7));
  if (authError || !authData.user) return response({ error: 'Sessão inválida ou expirada.' }, 401, origin);

  try {
    const contentLength = Number(request.headers.get('Content-Length') || 0);
    if (contentLength > maxAbsenceAttachmentBytes + 128 * 1024) return response({ error: 'Requisição acima do limite permitido.' }, 413, origin);
    const form: FormData | Record<string, unknown> = request.headers.get('Content-Type')?.toLowerCase().startsWith('multipart/form-data')
      ? await request.formData()
      : await request.json() as Record<string, unknown>;
    const getField = (name: string): FormDataEntryValue | string | undefined => form instanceof FormData
      ? form.get(name) ?? undefined
      : typeof form[name] === 'string' ? form[name] as string : undefined;
    const action = getField('action');

    if (action === 'upload') {
      const recordId = getField('recordId');
      const file = getField('file');
      if (typeof recordId !== 'string' || !uuidPattern.test(recordId) || !(file instanceof File)) return response({ error: 'Dados de anexo inválidos.' }, 400, origin);
      if (file.size < 1 || file.size > maxAbsenceAttachmentBytes) return response({ error: 'O arquivo deve ter até 10 MiB.' }, 413, origin);
      const extension = file.name.split('.').at(-1)?.toLowerCase();
      const expectedType = extension === 'pdf' ? 'application/pdf' : ['jpg','jpeg'].includes(extension || '') ? 'image/jpeg' : extension === 'png' ? 'image/png' : null;
      if (!expectedType || file.type !== expectedType) return response({ error: 'Formato ou tipo de arquivo inválido.' }, 415, origin);
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (detectAbsenceAttachmentType(bytes) !== expectedType) return response({ error: 'A assinatura binária não corresponde ao tipo declarado.' }, 415, origin);

      const extensionForPath = expectedType === 'application/pdf' ? 'pdf' : expectedType === 'image/png' ? 'png' : 'jpg';
      const objectPath = `${recordId}/${crypto.randomUUID()}.${extensionForPath}`;
      const { error: uploadError } = await client.storage.from(bucket).upload(objectPath, new Blob([bytes], { type: expectedType }), { contentType: expectedType, upsert: false });
      if (uploadError) return response({ error: uploadError.message.includes('row-level security') ? 'Acesso ao registro negado.' : 'Não foi possível enviar o arquivo.' }, uploadError.message.includes('row-level security') ? 403 : 502, origin);

      const safeName = file.name.replace(/[\/\\\u0000-\u001f\u007f]/g, '').trim().slice(0, 180);
      const { data: attachmentId, error: metadataError } = await client.rpc('mk9_faltas_atestados_register_attachment', {
        p_record_id: recordId, p_object_path: objectPath, p_original_name: safeName || `atestado.${extensionForPath}`,
        p_mime_type: expectedType, p_size_bytes: bytes.byteLength
      });
      if (metadataError || typeof attachmentId !== 'string') {
        const { error: cleanupError } = await client.storage.from(bucket).remove([objectPath]);
        return response({ error: 'Não foi possível confirmar os metadados do anexo.', cleanupPending: !!cleanupError }, metadataError?.code === '42501' ? 403 : 502, origin);
      }
      return response({ id: attachmentId, original_name: safeName || `atestado.${extensionForPath}`, mime_type: expectedType, size_bytes: bytes.byteLength, criado_em: new Date().toISOString() }, 201, origin);
    }

    if (action === 'delete') {
      const attachmentId = getField('attachmentId');
      if (typeof attachmentId !== 'string' || !uuidPattern.test(attachmentId)) return response({ error: 'Identificador de anexo inválido.' }, 400, origin);
      const { data: path, error: pathError } = await client.rpc('mk9_faltas_atestados_attachment_path', { p_attachment_id: attachmentId });
      if (pathError || typeof path !== 'string') return response({ error: 'Acesso ao anexo negado.' }, 403, origin);
      const { error: removeError } = await client.storage.from(bucket).remove([path]);
      if (removeError) return response({ error: 'Não foi possível remover o arquivo privado.' }, removeError.message.includes('row-level security') ? 403 : 502, origin);
      const { error: metadataError } = await client.rpc('mk9_faltas_atestados_delete_attachment', { p_attachment_id: attachmentId });
      if (metadataError) return response({ error: 'Arquivo removido; a limpeza do metadado precisa ser repetida.' }, 502, origin);
      return response({ deleted: true }, 200, origin);
    }

    return response({ error: 'Ação de anexo inválida.' }, 400, origin);
  } catch {
    return response({ error: 'Não foi possível processar a solicitação de anexo.' }, 400, origin);
  }
});
