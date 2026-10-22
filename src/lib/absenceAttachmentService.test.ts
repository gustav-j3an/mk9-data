import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAbsenceAttachmentService, type AbsenceAttachmentGateway } from './absenceAttachmentService';

const attachment = { id: 'attachment-1', original_name: 'atestado.pdf', mime_type: 'application/pdf' as const, size_bytes: 12, criado_em: '2026-10-21T10:00:00.000Z' };

function gateway(overrides: Partial<AbsenceAttachmentGateway> = {}) {
  const calls: Array<{ operation: string; value: unknown }> = [];
  const base: AbsenceAttachmentGateway = {
    async invoke(body) { calls.push({ operation: 'invoke', value: body }); return { data: attachment, error: null }; },
    async rpc(name, args) { calls.push({ operation: name, value: args }); return { data: name.endsWith('list_attachments') ? [attachment] : 'record/path.pdf', error: null }; },
    async download(path) { calls.push({ operation: 'download', value: path }); return { data: new Blob(['synthetic']), error: null }; }
  };
  return { api: createAbsenceAttachmentService({ ...base, ...overrides }), calls };
}

test('uploads through the authenticated Edge Function and returns only confirmed metadata', async () => {
  const { api, calls } = gateway();
  const result = await api.upload('record-1', new File(['synthetic'], 'atestado.pdf', { type: 'application/pdf' }));
  assert.equal(result.id, attachment.id);
  assert.equal(calls[0].operation, 'invoke');
  assert.ok(calls[0].value instanceof FormData);
  assert.equal((calls[0].value as FormData).get('recordId'), 'record-1');
});

test('upload and metadata failures are reported without claiming persistence', async () => {
  const { api: uploadFailure } = gateway({ async invoke() { return { data: null, error: new Error('network') }; } });
  await assert.rejects(uploadFailure.upload('record-1', new File(['x'], 'x.pdf', { type: 'application/pdf' })), /confirmar o upload/);
  const { api: metadataFailure } = gateway({ async invoke() { return { data: { id: 4 }, error: null }; } });
  await assert.rejects(metadataFailure.upload('record-1', new File(['x'], 'x.pdf', { type: 'application/pdf' })), /confirmar o upload/);
});

test('lists and downloads only through an authorized RPC path', async () => {
  const { api, calls } = gateway();
  assert.deepEqual(await api.list('record-1'), [attachment]);
  const blob = await api.download(attachment.id);
  assert.equal(await blob.text(), 'synthetic');
  assert.equal(calls[1].operation, 'mk9_faltas_atestados_attachment_path');
  assert.equal(calls[2].operation, 'download');
  assert.equal(calls[2].value, 'record/path.pdf');
});

test('denies downloads and deletes on authorization failures; confirms deletion only after Edge Function success', async () => {
  const { api: deniedDownload } = gateway({ async rpc(name) { return { data: null, error: name.endsWith('attachment_path') ? new Error('forbidden') : null }; } });
  await assert.rejects(deniedDownload.download(attachment.id), /Acesso ao anexo negado/);
  const { api: deniedDelete } = gateway({ async invoke() { return { data: null, error: new Error('forbidden') }; } });
  await assert.rejects(deniedDelete.remove(attachment.id), /excluir o anexo autorizado/);
  const { api: successfulDelete } = gateway({ async invoke() { return { data: { deleted: true }, error: null }; } });
  await assert.doesNotReject(successfulDelete.remove(attachment.id));
});

test('rejects unexpected response shapes and never leaks backend error details', async () => {
  const { api: invalidList } = gateway({ async rpc() { return { data: [{ ...attachment, original_name: null }], error: null }; } });
  await assert.rejects(invalidList.list('record-1'), /anexos autorizados/);
  const { api: failedDownload } = gateway({ async download() { return { data: null, error: new Error('private path') }; } });
  await assert.rejects(failedDownload.download(attachment.id), error => error instanceof Error && !error.message.includes('private path'));
});
