import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { omitWhatsAppGroupLink, writeWithOptionalWhatsAppGroupLink } from '../utils/industryWhatsAppCompatibility';

describe('cadastro de indústrias com coluna de WhatsApp opcional', () => {
  it('preserva o campo para schema atualizado e o omite apenas no fallback legado', () => {
    const payload = { codigo: 'IND-1', nome: 'Indústria', whatsapp_group_link: 'https://chat.whatsapp.com/example' };
    assert.equal('whatsapp_group_link' in omitWhatsAppGroupLink(payload), false);
    assert.equal(payload.whatsapp_group_link, 'https://chat.whatsapp.com/example');
  });

  it('repete criação e edição sem a coluna quando o PostgREST informa schema desatualizado', async () => {
    for (const operation of ['criação', 'edição']) {
      let attempts = 0;
      const result = await writeWithOptionalWhatsAppGroupLink(
        async () => { attempts += 1; return { error: { code: 'PGRST204', message: "Could not find 'whatsapp_group_link' in schema cache" } }; },
        async () => { attempts += 1; return { error: null }; }
      );
      assert.equal(result.error, null, operation);
      assert.equal(result.usedWhatsAppFallback, true, operation);
      assert.equal(attempts, 2, operation);
    }
  });

  it('não repete a escrita para erros que não sejam ausência da coluna opcional', async () => {
    let fallbackCalls = 0;
    const expectedError = { code: '42501', message: 'permission denied' };
    const result = await writeWithOptionalWhatsAppGroupLink(
      async () => ({ error: expectedError }),
      async () => { fallbackCalls += 1; return { error: null }; }
    );
    assert.equal(result.error, expectedError);
    assert.equal(result.usedWhatsAppFallback, false);
    assert.equal(fallbackCalls, 0);
  });
});
