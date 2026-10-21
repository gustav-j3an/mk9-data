import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidWhatsAppGroupLink,
  formatDateBR,
  formatTimeBR,
  buildWhatsAppReportText,
  buildWhatsAppWebUrl
} from './whatsappShare';
import type { Visit } from '../types';

describe('Utilitário de Compartilhamento WhatsApp — MK9 Date', () => {
  describe('isValidWhatsAppGroupLink', () => {
    it('valida links legítimos de convite do WhatsApp', () => {
      assert.equal(isValidWhatsAppGroupLink('https://chat.whatsapp.com/ABC123xyz456'), true);
      assert.equal(isValidWhatsAppGroupLink('http://chat.whatsapp.com/ABC123xyz456'), true);
      assert.equal(isValidWhatsAppGroupLink('chat.whatsapp.com/ABC123xyz456'), true);
      assert.equal(isValidWhatsAppGroupLink('  https://chat.whatsapp.com/XYZ987  '), true);
    });

    it('rejeita links inválidos ou de domínios maliciosos', () => {
      assert.equal(isValidWhatsAppGroupLink(''), false);
      assert.equal(isValidWhatsAppGroupLink(null), false);
      assert.equal(isValidWhatsAppGroupLink(undefined), false);
      assert.equal(isValidWhatsAppGroupLink('https://google.com'), false);
      assert.equal(isValidWhatsAppGroupLink('https://chat.whatsapp.com.attacker.com/xyz'), false);
      assert.equal(isValidWhatsAppGroupLink('https://api.whatsapp.com/send'), false);
      assert.equal(isValidWhatsAppGroupLink('https://chat.whatsapp.com/'), false);
      assert.equal(isValidWhatsAppGroupLink('javascript:alert(1)'), false);
    });
  });

  describe('formatDateBR & formatTimeBR', () => {
    it('formata datas ISO para padrão brasileiro DD/MM/YYYY', () => {
      assert.equal(formatDateBR('2026-10-21'), '21/10/2026');
      assert.equal(formatDateBR('2026-10-21T14:30:00Z'), '21/10/2026');
      assert.equal(formatDateBR(null), '—');
      assert.equal(formatDateBR(''), '—');
    });

    it('formata horários ISO para HH:mm', () => {
      const iso = '2026-10-21T13:45:00.000Z';
      const timeStr = formatTimeBR(iso);
      assert.ok(timeStr !== '—');
      assert.equal(formatTimeBR(null), '—');
    });
  });

  describe('buildWhatsAppReportText', () => {
    const mockVisit: Visit = {
      id: 'visita-001',
      promotor_matricula: 'MAT-101',
      loja_codigo: 'LJ-01',
      industria_codigo: 'IND-99',
      data_visita: '2026-10-21',
      started_at: '2026-10-21T11:00:00.000Z',
      completed_at: '2026-10-21T12:30:00.000Z',
      status: 'concluida',
      observacao_geral: 'Loja organizada, reposição concluída.',
      industria: { codigo: 'IND-99', nome: 'Nestlé' },
      loja: { codigo: 'LJ-01', nome: 'Supermercado Central' },
      promotor: { matricula: 'MAT-101', nome: 'Carlos Silva' },
      checklist_items: [
        {
          item_key: 'qtd_produtos_venda',
          item_label: 'Quantidade na área de vendas',
          checked: true,
          valor_texto: '45'
        },
        {
          item_key: 'qtd_produtos_deposito',
          item_label: 'Quantidade disponível no depósito',
          checked: true,
          valor_texto: '120'
        }
      ],
      occurrences: [
        {
          tipo: 'ruptura',
          descricao: 'Falta de Nescau 400g na gôndola',
          resolvido: false
        }
      ],
      validity_items: [
        {
          produto_nome: 'Leite Ninho 400g',
          quantidade: 12,
          data_vencimento: '2026-10-30',
          lote: 'L9921'
        }
      ],
      photos: [
        {
          tipo_foto: 'gondola',
          storage_path: 'visits/visita-001/foto1.jpg',
          file_url: 'https://example.com/foto1.jpg'
        }
      ]
    };

    it('gera relatório completo e estruturado para visita concluída', () => {
      const text = buildWhatsAppReportText(mockVisit);

      assert.ok(text.includes('RELATÓRIO DE VISITA — MK9 DATE'));
      assert.ok(text.includes('Nestlé'));
      assert.ok(text.includes('Supermercado Central'));
      assert.ok(text.includes('Carlos Silva'));
      assert.ok(text.includes('21/10/2026'));
      assert.ok(text.includes('✅ Concluída'));
      assert.ok(text.includes('Quantidade na área de vendas: 45 un.'));
      assert.ok(text.includes('Quantidade disponível no depósito: 120 un.'));
      assert.ok(text.includes('[RUPTURA] Falta de Nescau 400g na gôndola (Pendente)'));
      assert.ok(text.includes('Leite Ninho 400g: 12 un. — Vence: 30/10/2026'));
      assert.ok(text.includes('1 foto(s) anexada(s)'));
      assert.ok(text.includes('Loja organizada, reposição concluída.'));
      // Garante que NENHUMA URL de storage ou URL assinada vaze no texto
      assert.ok(!text.includes('https://example.com'));
      assert.ok(!text.includes('storage_path'));
    });

    it('lida com visita sem checklist, sem ocorrências e sem fotos sem inventar dados', () => {
      const emptyVisit: Visit = {
        id: 'visita-002',
        promotor_matricula: 'MAT-102',
        loja_codigo: 'LJ-02',
        industria_codigo: 'IND-01',
        data_visita: '2026-10-21',
        status: 'pendente'
      };

      const text = buildWhatsAppReportText(emptyVisit);

      assert.ok(text.includes('IND-01'));
      assert.ok(text.includes('LJ-02'));
      assert.ok(text.includes('MAT-102'));
      assert.ok(text.includes('⚪ Pendente'));
      assert.ok(!text.includes('Checklist Operacional'));
      assert.ok(!text.includes('Ocorrências'));
      assert.ok(!text.includes('Evidências Fotográficas'));
    });

    it('exibe motivo para visita não realizada', () => {
      const notDoneVisit: Visit = {
        id: 'visita-003',
        promotor_matricula: 'MAT-103',
        loja_codigo: 'LJ-03',
        industria_codigo: 'IND-02',
        data_visita: '2026-10-21',
        status: 'nao_realizada',
        motivo_nao_realizada: 'Loja fechada para inventário'
      };

      const text = buildWhatsAppReportText(notDoneVisit);
      assert.ok(text.includes('❌ Não realizada'));
      assert.ok(text.includes('Loja fechada para inventário'));
    });
  });

  describe('buildWhatsAppWebUrl', () => {
    it('gera link wa.me com texto codificado', () => {
      const url = buildWhatsAppWebUrl('Relatório Teste');
      assert.equal(url, 'https://wa.me/?text=Relat%C3%B3rio%20Teste');
    });

    it('insere telefone de destino sanitizado quando informado', () => {
      const url = buildWhatsAppWebUrl('Olá', '(11) 98765-4321');
      assert.equal(url, 'https://wa.me/11987654321?text=Ol%C3%A1');
    });
  });

  describe('shareViaWebShare & Fallbacks', () => {
    it('retorna "unsupported" quando navigator.share não está disponível no ambiente', async () => {
      // No ambiente Node.js, navigator.share não existe
      const { shareViaWebShare } = await import('./whatsappShare');
      const res = await shareViaWebShare({ title: 'Teste', text: 'Mensagem' });
      assert.equal(res, 'unsupported');
    });

    it('retorna "canceled" quando o usuário cancela com AbortError simulado', async () => {
      const { shareViaWebShare } = await import('./whatsappShare');
      
      const originalShare = globalThis.navigator?.share;
      const originalCanShare = globalThis.navigator?.canShare;

      Object.defineProperty(globalThis.navigator, 'share', {
        value: async () => {
          const err = new Error('Share canceled by user');
          err.name = 'AbortError';
          throw err;
        },
        configurable: true,
        writable: true
      });

      Object.defineProperty(globalThis.navigator, 'canShare', {
        value: () => true,
        configurable: true,
        writable: true
      });

      try {
        const res = await shareViaWebShare({ title: 'Teste', text: 'Mensagem' });
        assert.equal(res, 'canceled');
      } finally {
        if (originalShare) {
          Object.defineProperty(globalThis.navigator, 'share', { value: originalShare, configurable: true });
        } else {
          delete (globalThis.navigator as any).share;
        }
        if (originalCanShare) {
          Object.defineProperty(globalThis.navigator, 'canShare', { value: originalCanShare, configurable: true });
        } else {
          delete (globalThis.navigator as any).canShare;
        }
      }
    });

    it('retorna "shared" quando navigator.share completa com sucesso', async () => {
      const { shareViaWebShare } = await import('./whatsappShare');

      const originalShare = globalThis.navigator?.share;
      const originalCanShare = globalThis.navigator?.canShare;

      Object.defineProperty(globalThis.navigator, 'share', {
        value: async () => {},
        configurable: true,
        writable: true
      });

      Object.defineProperty(globalThis.navigator, 'canShare', {
        value: () => true,
        configurable: true,
        writable: true
      });

      try {
        const res = await shareViaWebShare({ title: 'Teste', text: 'Mensagem' });
        assert.equal(res, 'shared');
      } finally {
        if (originalShare) {
          Object.defineProperty(globalThis.navigator, 'share', { value: originalShare, configurable: true });
        } else {
          delete (globalThis.navigator as any).share;
        }
        if (originalCanShare) {
          Object.defineProperty(globalThis.navigator, 'canShare', { value: originalCanShare, configurable: true });
        } else {
          delete (globalThis.navigator as any).canShare;
        }
      }
    });
  });
});
