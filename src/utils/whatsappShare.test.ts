import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidWhatsAppGroupLink,
  sanitizeWhatsAppGroupLink,
  formatVisitReportText,
  shareVisitReport,
  openIndustryWhatsAppGroup,
  type VisitShareData,
} from './whatsappShare.ts';

describe('MK9 Date - Validação de Links de Grupos WhatsApp', () => {
  test('deve aceitar links válidos de convite de grupos do WhatsApp', () => {
    assert.strictEqual(
      isValidWhatsAppGroupLink('https://chat.whatsapp.com/KJH8923hjasd89123'),
      true
    );
    assert.strictEqual(
      isValidWhatsAppGroupLink('https://chat.whatsapp.com/ABCdef12345_XYZ-99'),
      true
    );
  });

  test('deve rejeitar links inválidos, wa.me, whatsapp:// e URLs malformadas', () => {
    // wa.me
    assert.strictEqual(isValidWhatsAppGroupLink('https://wa.me/5511999999999'), false);
    assert.strictEqual(isValidWhatsAppGroupLink('http://wa.me/group123'), false);

    // whatsapp://
    assert.strictEqual(isValidWhatsAppGroupLink('whatsapp://send?text=ola'), false);
    assert.strictEqual(isValidWhatsAppGroupLink('whatsapp://chat?code=123'), false);

    // Domínios externos maliciosos
    assert.strictEqual(isValidWhatsAppGroupLink('https://malicious-site.com/chat.whatsapp.com/123'), false);
    assert.strictEqual(isValidWhatsAppGroupLink('https://chat.whatsapp.com.attacker.com/123'), false);

    // HTTP simples em vez de HTTPS
    assert.strictEqual(isValidWhatsAppGroupLink('http://chat.whatsapp.com/KJH8923hjasd89123'), false);

    // Strings vazias e nulas
    assert.strictEqual(isValidWhatsAppGroupLink(''), false);
    assert.strictEqual(isValidWhatsAppGroupLink(null), false);
    assert.strictEqual(isValidWhatsAppGroupLink(undefined), false);
    assert.strictEqual(isValidWhatsAppGroupLink('   '), false);
  });

  test('sanitizeWhatsAppGroupLink deve limpar e retornar o link ou null', () => {
    const valid = '   https://chat.whatsapp.com/ValidCode123   ';
    assert.strictEqual(sanitizeWhatsAppGroupLink(valid), 'https://chat.whatsapp.com/ValidCode123');

    const invalid = 'https://wa.me/123456';
    assert.strictEqual(sanitizeWhatsAppGroupLink(invalid), null);
    assert.strictEqual(sanitizeWhatsAppGroupLink(null), null);
  });
});

describe('MK9 Date - Formatação do Relatório de Visita', () => {
  test('deve formatar texto com todos os campos da visita e manter isolamento', () => {
    const sampleVisit: VisitShareData = {
      visitId: 'v-101',
      promotorNome: 'João Silva',
      promotorMatricula: 'PROM001',
      industriaNome: 'Indústria Aurora Alimentos',
      industriaCodigo: 'IND_AURORA',
      lojaNome: 'Supermercado Central',
      lojaCodigo: 'LJ05',
      dataVisita: '2026-10-20',
      horaInicio: '08:30:00',
      horaFim: '10:15:00',
      status: 'concluida',
      resumoAtendimento: 'Reposição completa e limpeza de gôndola.',
      observacoes: 'Ruptura pontual de item X no estoque.',
      fotos: [
        { url: 'https://storage.supabase.co/v1/bucket/aurora/foto1.jpg', descricao: 'Gôndola montada' },
        { url: 'https://storage.supabase.co/v1/bucket/aurora/foto2.jpg', descricao: 'Ponto extra' },
      ],
      whatsappGroupLink: 'https://chat.whatsapp.com/AuroraAlimentosGroup',
    };

    const text = formatVisitReportText(sampleVisit);

    assert.ok(text.includes('RELATÓRIO DE VISITA'));
    assert.ok(text.includes('Indústria Aurora Alimentos (IND_AURORA)'));
    assert.ok(text.includes('Supermercado Central (LJ05)'));
    assert.ok(text.includes('João Silva [PROM001]'));
    assert.ok(text.includes('20/10/2026'));
    assert.ok(text.includes('08:30 às 10:15'));
    assert.ok(text.includes('CONCLUIDA'));
    assert.ok(text.includes('Reposição completa e limpeza de gôndola.'));
    assert.ok(text.includes('Ruptura pontual de item X no estoque.'));
    assert.ok(text.includes('2 foto(s) anexada(s)'));

    // Não deve vazar dados de outras indústrias
    assert.strictEqual(text.includes('IND_OUTRA'), false);
  });

  test('deve lidar graciosamente com campos opcionais ausentes', () => {
    const minimalVisit: VisitShareData = {
      visitId: 'v-102',
      dataVisita: '2026-10-20',
      status: 'concluida',
    };

    const text = formatVisitReportText(minimalVisit);
    assert.ok(text.includes('RELATÓRIO DE VISITA'));
    assert.ok(text.includes('20/10/2026'));
    assert.ok(text.includes('CONCLUÍDA') || text.includes('CONCLUIDA'));
  });
});

describe('MK9 Date - Compartilhamento e Fallbacks', () => {
  test('openIndustryWhatsAppGroup deve recusar URLs inválidas e retornar false', () => {
    const resInvalid = openIndustryWhatsAppGroup('invalid-url');
    assert.strictEqual(resInvalid, false);

    const resNull = openIndustryWhatsAppGroup(null);
    assert.strictEqual(resNull, false);
  });

  test('fallback quando navigator.share não está disponível (Node environment)', async () => {
    const sampleVisit: VisitShareData = {
      visitId: 'v-103',
      dataVisita: '2026-10-20',
      status: 'concluida',
    };

    // No ambiente Node sem window.open, shareVisitReport lida com erro de window sem quebrar a execução
    const result = await shareVisitReport(sampleVisit);
    assert.ok(result.action === 'whatsapp_link' || result.action === 'error');
  });

  test('compartilhamento nativo com fotos quando navigator.share e canShare suportam arquivos', async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    let shareCalledWith: any = null;

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        canShare: (data: any) => Boolean(data && data.files && data.files.length > 0),
        share: async (data: any) => {
          shareCalledWith = data;
          return Promise.resolve();
        },
      },
      configurable: true,
      writable: true,
    });

    const dummyFile = new File(['content'], 'test.jpg', { type: 'image/jpeg' });
    const visitData: VisitShareData = {
      visitId: 'v-photo-1',
      dataVisita: '2026-10-20',
      status: 'concluida',
      lojaNome: 'Loja Teste',
    };

    const result = await shareVisitReport(visitData, { photoFiles: [dummyFile] });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.action, 'native_share');
    assert.strictEqual(shareCalledWith.files.length, 1);

    if (originalDescriptor) {
      Object.defineProperty(globalThis, 'navigator', originalDescriptor);
    }
  });

  test('fallback gracioso quando usuário cancela o compartilhamento nativo (AbortError)', async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        share: async () => {
          const abortErr = new Error('Share canceled');
          abortErr.name = 'AbortError';
          throw abortErr;
        },
      },
      configurable: true,
      writable: true,
    });

    const visitData: VisitShareData = {
      visitId: 'v-cancel',
      dataVisita: '2026-10-20',
      status: 'concluida',
    };

    const result = await shareVisitReport(visitData);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.action, 'canceled');
    assert.strictEqual(result.message, 'Compartilhamento cancelado pelo usuário.');

    if (originalDescriptor) {
      Object.defineProperty(globalThis, 'navigator', originalDescriptor);
    }
  });

  test('ausência de grupo cadastrado é tratada com segurança sem erros', () => {
    const visitWithoutGroup: VisitShareData = {
      visitId: 'v-no-group',
      dataVisita: '2026-10-20',
      status: 'concluida',
      whatsappGroupLink: null,
    };

    assert.strictEqual(isValidWhatsAppGroupLink(visitWithoutGroup.whatsappGroupLink), false);
    assert.strictEqual(openIndustryWhatsAppGroup(visitWithoutGroup.whatsappGroupLink), false);
    const text = formatVisitReportText(visitWithoutGroup);
    assert.ok(text.includes('RELATÓRIO DE VISITA'));
  });

  test('isolamento estrito: relatório não vaza tokens, segredos ou dados de outras indústrias', () => {
    const visitIndA: VisitShareData = {
      visitId: 'v-sec-1',
      industriaNome: 'Industria Alfa',
      industriaCodigo: 'IND_ALFA',
      lojaNome: 'Supermercado Alfa 1',
      dataVisita: '2026-10-20',
      status: 'concluida',
      whatsappGroupLink: 'https://chat.whatsapp.com/AlfaGroupLink123',
    };

    const text = formatVisitReportText(visitIndA);
    assert.ok(text.includes('Industria Alfa'));
    assert.strictEqual(text.includes('Beta'), false);
    assert.strictEqual(text.includes('IND_BETA'), false);
    assert.strictEqual(text.includes('token'), false);
    assert.strictEqual(text.includes('apikey'), false);
  });
});
