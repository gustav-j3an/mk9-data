import test from 'node:test';
import assert from 'node:assert/strict';
import { createWhatsAppGroupLinkQueryCompatibility, isMissingWhatsAppGroupLinkColumn } from './promoterPortalQueryCompatibility';

test('recognizes only missing WhatsApp group link schema errors', () => {
  assert.equal(isMissingWhatsAppGroupLinkColumn({ code: '42703', message: 'column whatsapp_group_link does not exist' }), true);
  assert.equal(isMissingWhatsAppGroupLinkColumn({ code: 'PGRST204', details: "Could not find 'whatsapp_group_link' in schema cache" }), true);
  assert.equal(isMissingWhatsAppGroupLinkColumn({ code: '42501', message: 'permission denied for whatsapp_group_link' }), false);
  assert.equal(isMissingWhatsAppGroupLinkColumn({ code: '42703', message: 'column promotor_matricula does not exist' }), false);
});

test('retries without the optional field only when that field is missing', async () => {
  let fallbackCalls = 0;
  const fetchWithOptionalWhatsAppGroupLink = createWhatsAppGroupLinkQueryCompatibility();
  const result = await fetchWithOptionalWhatsAppGroupLink(
    async () => ({ data: [], error: { code: '42703', message: 'column whatsapp_group_link does not exist' } }),
    async () => { fallbackCalls += 1; return { data: [{ id: 'visit-1' }], error: null }; }
  );
  assert.deepEqual(result.data, [{ id: 'visit-1' }]);
  assert.equal(result.error, null);
  assert.equal(fallbackCalls, 1);
  assert.equal(result.usedWhatsAppFallback, true);
});

test('does not hide unrelated query errors', async () => {
  let fallbackCalls = 0;
  const error = { code: '42501', message: 'permission denied' };
  const fetchWithOptionalWhatsAppGroupLink = createWhatsAppGroupLinkQueryCompatibility();
  const result = await fetchWithOptionalWhatsAppGroupLink(
    async () => ({ data: [], error }),
    async () => { fallbackCalls += 1; return { data: [], error: null }; }
  );
  assert.equal(result.error, error);
  assert.equal(fallbackCalls, 0);
});

test('remembers a confirmed missing column and coalesces concurrent schema probes', async () => {
  const fetchWithOptionalWhatsAppGroupLink = createWhatsAppGroupLinkQueryCompatibility();
  let primaryCalls = 0;
  let fallbackCalls = 0;
  let releaseProbe!: (value: { data: Array<{ id: string }>; error: unknown }) => void;
  const primary = () => {
    primaryCalls += 1;
    return new Promise<{ data: Array<{ id: string }>; error: unknown }>((resolve) => { releaseProbe = resolve; });
  };
  const fallback = async () => { fallbackCalls += 1; return { data: [{ id: 'legacy' }], error: null }; };

  const first = fetchWithOptionalWhatsAppGroupLink(primary, fallback);
  const second = fetchWithOptionalWhatsAppGroupLink(primary, fallback);
  releaseProbe({ data: [], error: { code: '42703', message: 'column whatsapp_group_link does not exist' } });
  const results = await Promise.all([first, second]);
  const third = await fetchWithOptionalWhatsAppGroupLink(primary, fallback);

  assert.equal(primaryCalls, 1);
  assert.equal(fallbackCalls, 3);
  assert.equal(results.every((result) => result.usedWhatsAppFallback), true);
  assert.equal(third.usedWhatsAppFallback, true);
});
