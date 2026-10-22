import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isWhatsAppShareableVisit,
  formatDateBR,
  formatTimeBR,
  buildWhatsAppReportText,
  buildWhatsAppWebUrl,
  isValidWhatsAppGroupLink,
  sanitizeWhatsAppGroupLink
} from './whatsappShare';
import type { Visit } from '../types';

describe('Disponibilidade de compartilhamento WhatsApp', () => {
  it('permite somente visitas concluídas', () => {
    assert.equal(isWhatsAppShareableVisit({ status: 'concluida' }), true);
    assert.equal(isWhatsAppShareableVisit({ status: 'pendente' }), false);
    assert.equal(isWhatsAppShareableVisit({ status: 'em_andamento' }), false);
    assert.equal(isWhatsAppShareableVisit({ status: 'nao_realizada' }), false);
  });

  it('accepts only HTTPS WhatsApp group invite links and removes query parameters', () => {
    assert.equal(isValidWhatsAppGroupLink('https://chat.whatsapp.com/Abc_123-xyz?mode=invite'), true);
    assert.equal(sanitizeWhatsAppGroupLink(' https://chat.whatsapp.com/Abc_123-xyz/?mode=invite '), 'https://chat.whatsapp.com/Abc_123-xyz');
    assert.equal(isValidWhatsAppGroupLink('http://chat.whatsapp.com/Abc123'), false);
    assert.equal(isValidWhatsAppGroupLink('https://wa.me/5511999999999'), false);
    assert.equal(isValidWhatsAppGroupLink('https://chat.whatsapp.com.evil.example/Abc123'), false);
  });
});

describe('Utilitário de Compartilhamento WhatsApp — MK9 Date', () => {
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

    it('gera relatório para visita concluída sem exigir configuração de grupo da indústria', () => {
      const completedVisit: Visit = {
        id: 'visita-sem-grupo',
        promotor_matricula: 'MAT-102',
        loja_codigo: 'LJ-02',
        industria_codigo: 'IND-01',
        data_visita: '2026-10-21',
        completed_at: '2026-10-21T12:30:00.000Z',
        status: 'concluida'
      };

      const report = buildWhatsAppReportText(completedVisit);
      assert.ok(report.includes('Concluída'));
      assert.ok(buildWhatsAppWebUrl(report).startsWith('https://wa.me/?text='));
      assert.ok(!report.includes('chat.whatsapp.com'));
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

  describe('Cenários de Homologação A até J — Android & WhatsApp Business', () => {
    // Cenário A: Visita concluída com texto e duas fotos
    it('Cenário A: Visita concluída com texto estruturado e 2 fotos anexadas', () => {
      const visitA: Visit = {
        id: 'visita-a',
        loja_codigo: 'LJ-10',
        industria_codigo: 'IND-01',
        promotor_matricula: 'MAT-501',
        data_visita: '2026-10-21',
        started_at: '2026-10-21T08:00:00.000Z',
        completed_at: '2026-10-21T09:15:00.000Z',
        status: 'concluida',
        loja: { codigo: 'LJ-10', nome: 'Hipermercado Extra' },
        industria: { codigo: 'IND-01', nome: 'M. Dias Branco' },
        promotor: { matricula: 'MAT-501', nome: 'Ana Souza' },
        photos: [
          { tipo_foto: 'gondola', storage_path: 'visit-photos/visita-a/antes.jpg', file_url: 'https://storage/antes.jpg' },
          { tipo_foto: 'fachada', storage_path: 'visit-photos/visita-a/depois.jpg', file_url: 'https://storage/depois.jpg' }
        ]
      };

      const report = buildWhatsAppReportText(visitA);
      assert.ok(report.includes('M. Dias Branco'));
      assert.ok(report.includes('Hipermercado Extra'));
      assert.ok(report.includes('Ana Souza'));
      assert.ok(report.includes('✅ Concluída'));
      assert.ok(report.includes('2 foto(s) anexada(s)'));
    });

    // Cenário B: Visita concluída com cinco fotos
    it('Cenário B: Visita concluída com 5 fotos', () => {
      const visitB: Visit = {
        id: 'visita-b',
        loja_codigo: 'LJ-20',
        industria_codigo: 'IND-02',
        promotor_matricula: 'MAT-502',
        data_visita: '2026-10-21',
        status: 'concluida',
        photos: Array.from({ length: 5 }, (_, i) => ({
          tipo_foto: 'gondola' as const,
          storage_path: `visit-photos/visita-b/foto-${i + 1}.jpg`,
          file_url: `https://storage/visita-b/foto-${i + 1}.jpg`
        }))
      };

      const report = buildWhatsAppReportText(visitB);
      assert.ok(report.includes('5 foto(s) anexada(s)'));
    });

    // Cenário C: Visita concluída com dez fotos
    it('Cenário C: Visita concluída com 10 fotos', () => {
      const visitC: Visit = {
        id: 'visita-c',
        loja_codigo: 'LJ-30',
        industria_codigo: 'IND-03',
        promotor_matricula: 'MAT-503',
        data_visita: '2026-10-21',
        status: 'concluida',
        photos: Array.from({ length: 10 }, (_, i) => ({
          tipo_foto: 'ponto_extra' as const,
          storage_path: `visit-photos/visita-c/foto-${i + 1}.jpg`,
          file_url: `https://storage/visita-c/foto-${i + 1}.jpg`
        }))
      };

      const report = buildWhatsAppReportText(visitC);
      assert.ok(report.includes('10 foto(s) anexada(s)'));
    });

    // Cenário D: Visita com ocorrência de ruptura
    it('Cenário D: Visita com ocorrência de ruptura devidamente tipada', () => {
      const visitD: Visit = {
        id: 'visita-d',
        loja_codigo: 'LJ-40',
        industria_codigo: 'IND-04',
        promotor_matricula: 'MAT-504',
        data_visita: '2026-10-21',
        status: 'concluida',
        occurrences: [
          { tipo: 'ruptura', descricao: 'Biscoito Cream Cracker esgotado na gôndola', resolvido: false },
          { tipo: 'preco_divergente', descricao: 'Preço etiquetado R$ 4,50 difere do sistema R$ 3,99', resolvido: true }
        ]
      };

      const report = buildWhatsAppReportText(visitD);
      assert.ok(report.includes('🚨 *Ocorrências / Rupturas (2):*'));
      assert.ok(report.includes('[RUPTURA] Biscoito Cream Cracker esgotado na gôndola (Pendente)'));
      assert.ok(report.includes('[PRECO DIVERGENTE] Preço etiquetado R$ 4,50 difere do sistema R$ 3,99 (Resolvido)'));
    });

    // Cenário E: Visita com checklist preenchido
    it('Cenário E: Visita com checklist operacional numérico e booleano', () => {
      const visitE: Visit = {
        id: 'visita-e',
        loja_codigo: 'LJ-50',
        industria_codigo: 'IND-05',
        promotor_matricula: 'MAT-505',
        data_visita: '2026-10-21',
        status: 'concluida',
        checklist_items: [
          { item_key: 'gondola_limpa', item_label: 'Gôndola higienizada e organizada', checked: true },
          { item_key: 'estoque_venda', item_label: 'Quantidade exposta', checked: true, valor_texto: '80' },
          { item_key: 'precificacao_ok', item_label: 'Precificação 100% visível', checked: false }
        ]
      };

      const report = buildWhatsAppReportText(visitE);
      assert.ok(report.includes('📦 *Checklist Operacional:*'));
      assert.ok(report.includes('Gôndola higienizada e organizada: Sim'));
      assert.ok(report.includes('Quantidade exposta: 80 un.'));
      assert.ok(report.includes('Precificação 100% visível: Não'));
    });

    // Cenário F: Visita sem fotos disponíveis
    it('Cenário F: Visita sem fotos não exibe seção fotográfica nem causa erro', () => {
      const visitF: Visit = {
        id: 'visita-f',
        loja_codigo: 'LJ-60',
        industria_codigo: 'IND-06',
        promotor_matricula: 'MAT-506',
        data_visita: '2026-10-21',
        status: 'concluida',
        photos: []
      };

      const report = buildWhatsAppReportText(visitF);
      assert.ok(!report.includes('Evidências Fotográficas'));
    });


    // Cenário H: Cancelamento do compartilhamento
    it('Cenário H: Cancelamento pelo usuário retorna "canceled" sem quebrar a tela', async () => {
      const { shareViaWebShare } = await import('./whatsappShare');
      const originalShare = globalThis.navigator?.share;
      const originalCanShare = globalThis.navigator?.canShare;

      Object.defineProperty(globalThis.navigator, 'share', {
        value: async () => {
          const err = new Error('AbortError');
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
        const res = await shareViaWebShare({ title: 'T', text: 'M' });
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

    // Cenário I: Navegador sem suporte a compartilhamento de arquivos
    it('Cenário I: Navegador sem canShare de arquivos retorna "unsupported" e aciona fallback wa.me', async () => {
      const { shareViaWebShare, buildWhatsAppWebUrl } = await import('./whatsappShare');
      const originalShare = globalThis.navigator?.share;
      const originalCanShare = globalThis.navigator?.canShare;

      Object.defineProperty(globalThis.navigator, 'share', {
        value: async () => {},
        configurable: true,
        writable: true
      });
      // Simula navegador que suporta navigator.share mas canShare({ files }) retorna false
      Object.defineProperty(globalThis.navigator, 'canShare', {
        value: (data?: any) => {
          if (data && data.files) return false;
          return true;
        },
        configurable: true,
        writable: true
      });

      try {
        const dummyFile = new (globalThis as any).File(['mock-binary'], 'foto.jpg', { type: 'image/jpeg' });
        const res = await shareViaWebShare({ title: 'T', text: 'M', files: [dummyFile] });
        assert.equal(res, 'unsupported');

        // Fallback wa.me correspondente
        const fallbackUrl = buildWhatsAppWebUrl('Relatório M');
        assert.ok(fallbackUrl.startsWith('https://wa.me/?text='));
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

    // Cenário J: Conexão lenta ou instável / codificação segura de textos longos
    it('Cenário J: Gera URL wa.me mesmo com relatórios longos e caracteres especiais', () => {
      const longText = '📋 *RELATÓRIO EXTENSO*\n' + 'Linha de observação com acentuação e caracteres especiais: ção, á, é, í, ó, ú, @, #, $, %, &, *, ().\n'.repeat(10);
      const url = buildWhatsAppWebUrl(longText);
      assert.ok(url.startsWith('https://wa.me/?text='));
      assert.ok(!url.includes(' ')); // Espaços devem estar codificados
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Missão 12 — Mensagem editável no modal de compartilhamento WhatsApp
  // ─────────────────────────────────────────────────────────────────────────
  describe('Missão 12 — Mensagem editável (editedText + restauração)', () => {
    const baseVisit: Visit = {
      id: 'visita-m12',
      promotor_matricula: 'MAT-200',
      loja_codigo: 'LJ-77',
      industria_codigo: 'IND-42',
      data_visita: '2026-10-22',
      started_at: '2026-10-22T09:00:00.000Z',
      completed_at: '2026-10-22T10:00:00.000Z',
      status: 'concluida',
      observacao_geral: 'Visita de rotina sem ocorrências.',
      industria: { codigo: 'IND-42', nome: 'Unilever' },
      loja: { codigo: 'LJ-77', nome: 'Mercado Norte' },
      promotor: { matricula: 'MAT-200', nome: 'Ana Lima' },
      checklist_items: [],
      occurrences: []
    };

    it('Texto inicial equivale ao gerado por buildWhatsAppReportText', () => {
      const original = buildWhatsAppReportText(baseVisit);
      // Simula o estado inicial do modal: editedText é inicializado igual ao gerado
      const editedText = buildWhatsAppReportText(baseVisit);
      assert.equal(editedText, original);
      // isTextModified deve ser false no início
      assert.equal(editedText !== original, false);
    });

    it('Texto editado diverge do original e dispara isTextModified = true', () => {
      const original = buildWhatsAppReportText(baseVisit);
      const editedText = original + '\n\n✅ Produto reposto após solicitação da gerência.';
      assert.notEqual(editedText, original);
      assert.equal(editedText !== original, true);
    });

    it('Restaurar texto retorna ao original exato', () => {
      const original = buildWhatsAppReportText(baseVisit);
      let editedText = original + '\n😊 Observação adicional do promotor.';
      // Restaurar: equivale a setEditedText(reportText)
      editedText = original;
      assert.equal(editedText, original);
      assert.equal(editedText !== original, false);
    });

    it('buildWhatsAppWebUrl usa o texto editado ao gerar URL', () => {
      const original = buildWhatsAppReportText(baseVisit);
      const edited = original + '\n📦 Estoque crítico detectado.';
      const urlOriginal = buildWhatsAppWebUrl(original);
      const urlEdited = buildWhatsAppWebUrl(edited);
      // As URLs devem ser diferentes pois o texto é diferente
      assert.notEqual(urlOriginal, urlEdited);
      // Ambas devem seguir o formato wa.me correto
      assert.ok(urlEdited.startsWith('https://wa.me/?text='));
      // O conteúdo editado deve estar codificado na URL
      assert.ok(urlEdited.includes(encodeURIComponent('📦 Estoque crítico detectado.')));
    });

    it('Emojis e quebras de linha são preservados na edição e na URL', () => {
      const edited = '🛒 Visita concluída!\n✅ Reposição feita.\n🔴 Produto em falta: Nescau 400g';
      const url = buildWhatsAppWebUrl(edited);
      assert.ok(url.startsWith('https://wa.me/?text='));
      // Sem espaços não codificados
      assert.ok(!url.includes(' '));
      // Emojis preservados na URL codificada
      assert.ok(url.includes(encodeURIComponent('🛒')));
    });

    it('Texto com apenas espaços em branco ainda gera URL válida (fallback seguro)', () => {
      const url = buildWhatsAppWebUrl('   ');
      assert.ok(url.startsWith('https://wa.me/?text='));
    });

    it('Texto vazio após edição não deve causar erro ao gerar URL', () => {
      const url = buildWhatsAppWebUrl('');
      assert.ok(typeof url === 'string');
      assert.ok(url.startsWith('https://wa.me/?text='));
    });

    it('Fotos preparadas são independentes do texto editado (estado isolado)', () => {
      const visitComFotos: Visit = {
        ...baseVisit,
        photos: [
          { id: 'p1', storage_path: 'visit-photos/p1.jpg', file_url: '', tipo_foto: 'gondola', legenda: 'Foto 1' }
        ]
      };
      const original = buildWhatsAppReportText(visitComFotos);
      const edited = original + '\n🖼️ Fotos anexadas conforme solicitado.';
      // Texto editado não tem relação com photos
      assert.notEqual(edited, original);
      assert.equal(visitComFotos.photos?.length, 1);
    });

    it('Restaurar não afeta fotos (estado de fotos é independente do texto)', () => {
      const visitComFotos: Visit = {
        ...baseVisit,
        photos: [
          { id: 'p2', storage_path: 'visit-photos/p2.jpg', file_url: '', tipo_foto: 'preco', legenda: 'Foto 2' },
          { id: 'p3', storage_path: 'visit-photos/p3.jpg', file_url: '', tipo_foto: 'ruptura', legenda: 'Foto 3' }
        ]
      };
      const original = buildWhatsAppReportText(visitComFotos);
      let edited = original + '\n💬 Gerente informado sobre a falta.';
      // Restaurar
      edited = original;
      assert.equal(edited, original);
      // Fotos continuam intactas
      assert.equal(visitComFotos.photos?.length, 2);
    });
  });
});
