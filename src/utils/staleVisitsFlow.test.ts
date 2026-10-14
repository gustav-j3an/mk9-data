import { describe, it } from 'node:test';
import assert from 'node:assert';
import type { Visit } from '../types';

/**
 * Suíte de Testes Unitários: Fluxo de Pendências de Visitas Antigas (MK9 Control)
 *
 * Cobre as 4 frentes requeridas:
 * 1. Justificativa obrigatória (rejeita vazia / espaços, aceita válida com trim)
 * 2. Proteção de visitas concluídas (impede interrupção de visitas com status 'concluida')
 * 3. Transição de estado e liberação de formulário ativo (activeVisit)
 * 4. Separação rigorosa das listas (em andamento antigas vs não realizadas antigas vs hoje vs concluídas)
 */

// ============================================================================
// Funções puras que reproduzem exatamente a lógica de PromoterPortalView.tsx
// ============================================================================

/**
 * Validação de justificativa obrigatória para interrupção de atendimento
 */
function validateInterruptReason(reason: string): { valid: boolean; trimmedReason: string } {
  const trimmedReason = reason.trim();
  return {
    valid: trimmedReason.length > 0,
    trimmedReason
  };
}

/**
 * Verificação de permissão para interrupção da visita
 */
function canInterruptVisit(visit: { status: string }): { allowed: boolean; reason?: string } {
  if (visit.status === 'concluida') {
    return {
      allowed: false,
      reason: 'Visitas já concluídas não podem ser alteradas ou interrompidas.'
    };
  }
  return { allowed: true };
}

/**
 * Simulação de transição de estado ao interromper uma visita
 */
function simulateInterruptTransition(params: {
  targetVisit: Visit;
  reason: string;
  activeVisit: Visit | null;
}): {
  success: boolean;
  updatedVisit: Visit;
  nextActiveVisit: Visit | null;
  occurrenceAudit: { visit_id: string; tipo: string; descricao: string };
} {
  const { targetVisit, reason, activeVisit } = params;
  const validation = validateInterruptReason(reason);
  if (!validation.valid) {
    throw new Error('Justificativa obrigatória não fornecida');
  }

  const permission = canInterruptVisit(targetVisit);
  if (!permission.allowed) {
    throw new Error(permission.reason);
  }

  // 1. Atualizar registro da visita para 'nao_realizada'
  const updatedVisit: Visit = {
    ...targetVisit,
    status: 'nao_realizada',
    motivo_nao_realizada: `[Interrupção de Atendimento]: ${validation.trimmedReason}`,
    updated_at: new Date().toISOString()
  };

  // 2. Registro de auditoria
  const occurrenceAudit = {
    visit_id: targetVisit.id,
    tipo: 'outro',
    descricao: `Atendimento interrompido pelo promotor. Justificativa: ${validation.trimmedReason}`
  };

  // 3. Desocupar formulário ativo apenas se correspondente
  const nextActiveVisit = activeVisit?.id === targetVisit.id ? null : activeVisit;

  return {
    success: true,
    updatedVisit,
    nextActiveVisit,
    occurrenceAudit
  };
}

/**
 * Separação das listas conforme implementado em PromoterPortalView.tsx:
 * - staleInProgressVisits: v.status === 'em_andamento' && v.data_visita < todayStr
 * - staleNotDoneVisits: v.status === 'nao_realizada' && v.data_visita < todayStr
 * - todayVisits: v.data_visita === todayStr
 */
function categorizeVisits(visits: Visit[], todayStr: string) {
  const staleInProgressVisits = visits.filter(
    (v) => v.status === 'em_andamento' && v.data_visita < todayStr
  );

  const staleNotDoneVisits = visits.filter(
    (v) => v.status === 'nao_realizada' && v.data_visita < todayStr
  );

  const todayVisits = visits.filter(
    (v) => v.data_visita === todayStr
  );

  return {
    staleInProgressVisits,
    staleNotDoneVisits,
    todayVisits
  };
}

// ============================================================================
// SUÍTE DE TESTES UNITÁRIOS
// ============================================================================

describe('Fluxo de Pendências de Visitas Antigas - MK9 Control', () => {
  const todayStr = '2026-10-10';

  const mockVisit = (overrides: Partial<Visit>): Visit => ({
    id: 'visit-1',
    promotor_matricula: 'PRM-068',
    loja_codigo: 'LOJ-100',
    industria_codigo: 'IND-COPRA',
    data_visita: '2026-10-07',
    status: 'em_andamento',
    created_at: '2026-10-07T08:00:00Z',
    ...overrides
  });

  // --------------------------------------------------------------------------
  // 1. Justificativa obrigatória
  // --------------------------------------------------------------------------
  describe('1. Justificativa obrigatória', () => {
    it('deve rejeitar justificativa vazia', () => {
      const res = validateInterruptReason('');
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.trimmedReason, '');
    });

    it('deve rejeitar justificativa composta apenas por espaços em branco e tabulações', () => {
      const res1 = validateInterruptReason('   ');
      const res2 = validateInterruptReason('\t  \n  ');
      assert.strictEqual(res1.valid, false);
      assert.strictEqual(res2.valid, false);
    });

    it('deve aceitar justificativa válida e aplicar trim nas extremidades', () => {
      const input = '   Cliente solicitou retorno na próxima semana devido a inventário.   ';
      const res = validateInterruptReason(input);
      assert.strictEqual(res.valid, true);
      assert.strictEqual(
        res.trimmedReason,
        'Cliente solicitou retorno na próxima semana devido a inventário.'
      );
    });
  });

  // --------------------------------------------------------------------------
  // 2. Proteção de visitas concluídas
  // --------------------------------------------------------------------------
  describe('2. Proteção de visitas concluídas', () => {
    it('deve impedir a interrupção de uma visita com status "concluida"', () => {
      const visitConcluida = mockVisit({ id: 'visit-c1', status: 'concluida' });
      const check = canInterruptVisit(visitConcluida);

      assert.strictEqual(check.allowed, false);
      assert.strictEqual(
        check.reason,
        'Visitas já concluídas não podem ser alteradas ou interrompidas.'
      );

      assert.throws(() => {
        simulateInterruptTransition({
          targetVisit: visitConcluida,
          reason: 'Tentativa indevida de interrupção',
          activeVisit: null
        });
      }, /Visitas já concluídas não podem ser alteradas ou interrompidas/);
    });

    it('deve permitir a interrupção de uma visita antiga com status "em_andamento"', () => {
      const visitEmAndamento = mockVisit({ id: 'visit-p1', status: 'em_andamento' });
      const check = canInterruptVisit(visitEmAndamento);
      assert.strictEqual(check.allowed, true);
    });
  });

  // --------------------------------------------------------------------------
  // 3. Transição de estado e liberação de activeVisit
  // --------------------------------------------------------------------------
  describe('3. Transição de estado e liberação de activeVisit', () => {
    it('deve transicionar status para "nao_realizada" com prefixo de auditoria no motivo', () => {
      const visitEmAndamento = mockVisit({ id: 'visit-yure-1', status: 'em_andamento' });
      const resultado = simulateInterruptTransition({
        targetVisit: visitEmAndamento,
        reason: 'Loja fechada antes do término do atendimento',
        activeVisit: null
      });

      assert.strictEqual(resultado.success, true);
      assert.strictEqual(resultado.updatedVisit.status, 'nao_realizada');
      assert.strictEqual(
        resultado.updatedVisit.motivo_nao_realizada,
        '[Interrupção de Atendimento]: Loja fechada antes do término do atendimento'
      );
      assert.strictEqual(resultado.occurrenceAudit.tipo, 'outro');
      assert.match(resultado.occurrenceAudit.descricao, /Atendimento interrompido pelo promotor/);
    });

    it('deve liberar activeVisit (definir como null) quando a visita ativa corresponde à visita interrompida', () => {
      const visitEmAndamento = mockVisit({ id: 'visit-active-1', status: 'em_andamento' });
      const activeVisit = visitEmAndamento;

      const resultado = simulateInterruptTransition({
        targetVisit: visitEmAndamento,
        reason: 'Atendimento cancelado para deslocamento urgente',
        activeVisit: activeVisit
      });

      assert.strictEqual(resultado.nextActiveVisit, null);
    });

    it('NÃO deve limpar activeVisit se a visita ativa for diferente da visita interrompida', () => {
      const visitInterrompida = mockVisit({ id: 'visit-antiga-1', status: 'em_andamento' });
      const outraVisitaAtiva = mockVisit({ id: 'visit-hoje-2', data_visita: todayStr, status: 'em_andamento' });

      const resultado = simulateInterruptTransition({
        targetVisit: visitInterrompida,
        reason: 'Cancelando visita esquecida de outro dia',
        activeVisit: outraVisitaAtiva
      });

      assert.notStrictEqual(resultado.nextActiveVisit, null);
      assert.strictEqual(resultado.nextActiveVisit?.id, 'visit-hoje-2');
    });
  });

  // --------------------------------------------------------------------------
  // 4. Separação rigorosa das listas
  // --------------------------------------------------------------------------
  describe('4. Separação das listas (segregação por data e status)', () => {
    it('deve distribuir visitas de forma precisa sem duplicidades ou misturas', () => {
      const visits: Visit[] = [
        // 1. Visita antiga em andamento (07/10) -> staleInProgressVisits
        mockVisit({
          id: 'v-stale-prog',
          data_visita: '2026-10-07',
          status: 'em_andamento',
          loja: { codigo: 'L1', nome: 'Super Adega' }
        }),
        // 2. Visita antiga não realizada (07/10 - caso Yure PRM-068 COPRA) -> staleNotDoneVisits
        mockVisit({
          id: 'v-stale-notdone',
          data_visita: '2026-10-07',
          status: 'nao_realizada',
          motivo_nao_realizada: 'fora do dia',
          loja: { codigo: 'L2', nome: 'Super Adega Taguatinga' }
        }),
        // 3. Visita antiga já concluída (06/10) -> NÃO deve entrar nas pendências
        mockVisit({
          id: 'v-stale-done',
          data_visita: '2026-10-06',
          status: 'concluida',
          loja: { codigo: 'L3', nome: 'Atacadão' }
        }),
        // 4. Visita de hoje em andamento (10/10) -> todayVisits (NÃO pendência antiga)
        mockVisit({
          id: 'v-today-prog',
          data_visita: todayStr,
          status: 'em_andamento',
          loja: { codigo: 'L4', nome: 'Assaí' }
        }),
        // 5. Visita de hoje não realizada (10/10) -> todayVisits (NÃO pendência antiga)
        mockVisit({
          id: 'v-today-notdone',
          data_visita: todayStr,
          status: 'nao_realizada',
          motivo_nao_realizada: 'loja fechada',
          loja: { codigo: 'L5', nome: 'Carrefour' }
        }),
        // 6. Visita de hoje concluída (10/10) -> todayVisits (NÃO pendência antiga)
        mockVisit({
          id: 'v-today-done',
          data_visita: todayStr,
          status: 'concluida',
          loja: { codigo: 'L6', nome: 'Sams Club' }
        })
      ];

      const categorized = categorizeVisits(visits, todayStr);

      // Asserção do Grupo 1: staleInProgressVisits
      assert.strictEqual(categorized.staleInProgressVisits.length, 1);
      assert.strictEqual(categorized.staleInProgressVisits[0].id, 'v-stale-prog');
      assert.strictEqual(categorized.staleInProgressVisits[0].status, 'em_andamento');

      // Asserção do Grupo 2: staleNotDoneVisits (inclui o caso de Yure PRM-068)
      assert.strictEqual(categorized.staleNotDoneVisits.length, 1);
      assert.strictEqual(categorized.staleNotDoneVisits[0].id, 'v-stale-notdone');
      assert.strictEqual(categorized.staleNotDoneVisits[0].status, 'nao_realizada');
      assert.strictEqual(categorized.staleNotDoneVisits[0].motivo_nao_realizada, 'fora do dia');

      // Nenhuma visita concluída deve figurar nas pendências antigas
      const concludedInStaleProg = categorized.staleInProgressVisits.filter((v) => v.status === 'concluida');
      const concludedInStaleNotDone = categorized.staleNotDoneVisits.filter((v) => v.status === 'concluida');
      assert.strictEqual(concludedInStaleProg.length, 0);
      assert.strictEqual(concludedInStaleNotDone.length, 0);

      // Nenhuma visita de hoje deve aparecer nas pendências antigas
      const todayInStaleProg = categorized.staleInProgressVisits.filter((v) => v.data_visita === todayStr);
      const todayInStaleNotDone = categorized.staleNotDoneVisits.filter((v) => v.data_visita === todayStr);
      assert.strictEqual(todayInStaleProg.length, 0);
      assert.strictEqual(todayInStaleNotDone.length, 0);

      // As visitas de hoje devem estar estritamente na lista do dia
      assert.strictEqual(categorized.todayVisits.length, 3);
      assert.ok(categorized.todayVisits.every((v) => v.data_visita === todayStr));
    });
  });

  // --------------------------------------------------------------------------
  // 5. Recuperação de visitas pendentes (Condições e Integridade)
  // --------------------------------------------------------------------------
  describe('5. Recuperação de visitas pendentes', () => {
    /**
     * Função pura que simula a validação e execução da recuperação de pendência
     */
    function simulateRecoveryTransition(params: {
      targetVisit: Visit;
      currentPromotorMatricula: string;
      activeVisit: Visit | null;
      todayStr: string;
      serverCurrentStatus?: string;
    }): {
      success: boolean;
      recoveredVisit: Visit;
      auditOccurrence: { visit_id: string; tipo: string; descricao: string };
    } {
      const { targetVisit, currentPromotorMatricula, activeVisit, todayStr, serverCurrentStatus } = params;

      // 1. Conflito com visita em andamento
      if (activeVisit) {
        throw new Error('Já existe uma visita em andamento.');
      }

      // 2. Validação de matrícula
      if (targetVisit.promotor_matricula !== currentPromotorMatricula) {
        throw new Error('Matrícula do promotor não confere com a visita.');
      }

      // 3. Validação de status atual no servidor (proteção de corrida/duplicidade)
      const effectiveStatus = serverCurrentStatus || targetVisit.status;
      if (effectiveStatus === 'concluida') {
        throw new Error('Visitas concluídas não podem ser recuperadas.');
      }
      if (effectiveStatus === 'em_andamento') {
        throw new Error('Esta visita já foi reaberta e está em andamento em outra sessão.');
      }
      if (effectiveStatus !== 'nao_realizada') {
        throw new Error(`Apenas visitas com status 'nao_realizada' podem ser recuperadas.`);
      }

      // 4. Validação de elegibilidade temporal (janela operacional de 30 dias e não futura)
      if (targetVisit.data_visita > todayStr) {
        throw new Error('Visitas com datas futuras não são elegíveis para recuperação.');
      }
      const vDate = new Date(targetVisit.data_visita).getTime();
      const tDate = new Date(todayStr).getTime();
      const diffDays = Math.floor((tDate - vDate) / (1000 * 60 * 60 * 24));
      if (diffDays > 30) {
        throw new Error('Visita fora do período operacional permitido para recuperação (máximo de 30 dias).');
      }

      // 5. Preservar started_at se já existia, ou gerar novo
      const nowIso = new Date().toISOString();
      const preservedStartedAt = targetVisit.started_at || nowIso;

      // 6. Atualizar visita mantendo data_visita original e motivo_nao_realizada original
      const recoveredVisit: Visit = {
        ...targetVisit,
        status: 'em_andamento',
        started_at: preservedStartedAt,
        completed_at: null,
        // motivo_nao_realizada é estritamente PRESERVADO (não sobrescrito)
        motivo_nao_realizada: targetVisit.motivo_nao_realizada,
        updated_at: nowIso
      };

      // 7. Registro de ocorrência de auditoria
      const auditOccurrence = {
        visit_id: targetVisit.id,
        tipo: 'outro',
        descricao: `Visita recuperada e reiniciada em ${todayStr} (Data planejada original: ${targetVisit.data_visita}). Motivo anterior preservado: "${targetVisit.motivo_nao_realizada || 'Não informado'}". Executada com atraso.`
      };

      return {
        success: true,
        recoveredVisit,
        auditOccurrence
      };
    }

    it('deve realizar recuperação válida preservando data_visita, motivo e evidências', () => {
      const originalVisit = mockVisit({
        id: 'visit-copra-1',
        promotor_matricula: 'PRM-068',
        data_visita: '2026-10-07',
        status: 'nao_realizada',
        motivo_nao_realizada: 'fora do dia',
        started_at: '2026-10-07T09:15:00Z',
        checklist_items: [
          { id: 'chk-1', visit_id: 'visit-copra-1', item_key: 'fachada', item_label: 'Fachada', checked: true, observacao: 'OK', valor_texto: null }
        ],
        photos: [
          { id: 'ph-1', visit_id: 'visit-copra-1', tipo_foto: 'fachada', storage_path: 'fotos/f1.jpg', file_url: 'https://storage/fotos/f1.jpg' }
        ]
      });

      const res = simulateRecoveryTransition({
        targetVisit: originalVisit,
        currentPromotorMatricula: 'PRM-068',
        activeVisit: null,
        todayStr
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.recoveredVisit.status, 'em_andamento');
      // Preservação da data planejada original
      assert.strictEqual(res.recoveredVisit.data_visita, '2026-10-07');
      // Preservação integral do motivo original
      assert.strictEqual(res.recoveredVisit.motivo_nao_realizada, 'fora do dia');
      // Preservação do started_at original (sem reiniciar do zero)
      assert.strictEqual(res.recoveredVisit.started_at, '2026-10-07T09:15:00Z');
      // Preservação de evidências
      assert.strictEqual(res.recoveredVisit.checklist_items?.length, 1);
      assert.strictEqual(res.recoveredVisit.photos?.length, 1);
      // Auditoria com marcação de atraso
      assert.match(res.auditOccurrence.descricao, /Visita recuperada e reiniciada/);
      assert.match(res.auditOccurrence.descricao, /Executada com atraso/);
      assert.match(res.auditOccurrence.descricao, /fora do dia/);
    });

    it('deve impedir recuperação de visita com status concluída', () => {
      const visitDone = mockVisit({
        id: 'visit-done',
        promotor_matricula: 'PRM-068',
        data_visita: '2026-10-07',
        status: 'concluida'
      });

      assert.throws(() => {
        simulateRecoveryTransition({
          targetVisit: visitDone,
          currentPromotorMatricula: 'PRM-068',
          activeVisit: null,
          todayStr
        });
      }, /Visitas concluídas não podem ser recuperadas/);
    });

    it('deve impedir recuperação quando status no banco foi alterado por outra sessão (duplicidade/corrida)', () => {
      const visitStale = mockVisit({
        id: 'visit-race',
        promotor_matricula: 'PRM-068',
        data_visita: '2026-10-07',
        status: 'nao_realizada'
      });

      // No cliente estava nao_realizada, mas consulta recente no servidor detectou que outra sessão colocou em_andamento
      assert.throws(() => {
        simulateRecoveryTransition({
          targetVisit: visitStale,
          currentPromotorMatricula: 'PRM-068',
          activeVisit: null,
          todayStr,
          serverCurrentStatus: 'em_andamento'
        });
      }, /Esta visita já foi reaberta e está em andamento em outra sessão/);
    });

    it('deve impedir recuperação quando a matrícula do promotor for diferente', () => {
      const visitOutro = mockVisit({
        id: 'visit-other-prom',
        promotor_matricula: 'PRM-999',
        data_visita: '2026-10-07',
        status: 'nao_realizada'
      });

      assert.throws(() => {
        simulateRecoveryTransition({
          targetVisit: visitOutro,
          currentPromotorMatricula: 'PRM-068',
          activeVisit: null,
          todayStr
        });
      }, /Matrícula do promotor não confere com a visita/);
    });

    it('deve impedir recuperação se já houver outra visita em andamento (conflito)', () => {
      const visitActive = mockVisit({
        id: 'visit-active-now',
        promotor_matricula: 'PRM-068',
        data_visita: todayStr,
        status: 'em_andamento'
      });

      const visitToRecover = mockVisit({
        id: 'visit-pending',
        promotor_matricula: 'PRM-068',
        data_visita: '2026-10-07',
        status: 'nao_realizada'
      });

      assert.throws(() => {
        simulateRecoveryTransition({
          targetVisit: visitToRecover,
          currentPromotorMatricula: 'PRM-068',
          activeVisit: visitActive,
          todayStr
        });
      }, /Já existe uma visita em andamento/);
    });

    it('deve rejeitar recuperação de visitas fora do período operacional permitido (> 30 dias)', () => {
      const visitMuitoAntiga = mockVisit({
        id: 'visit-antiquissima',
        promotor_matricula: 'PRM-068',
        data_visita: '2026-08-01', // > 60 dias atrás
        status: 'nao_realizada'
      });

      assert.throws(() => {
        simulateRecoveryTransition({
          targetVisit: visitMuitoAntiga,
          currentPromotorMatricula: 'PRM-068',
          activeVisit: null,
          todayStr: '2026-10-10'
        });
      }, /Visita fora do período operacional permitido para recuperação/);
    });

    it('deve rejeitar recuperação de visitas com datas futuras', () => {
      const visitFutura = mockVisit({
        id: 'visit-futura',
        promotor_matricula: 'PRM-068',
        data_visita: '2026-10-15',
        status: 'nao_realizada'
      });

      assert.throws(() => {
        simulateRecoveryTransition({
          targetVisit: visitFutura,
          currentPromotorMatricula: 'PRM-068',
          activeVisit: null,
          todayStr: '2026-10-10'
        });
      }, /Visitas com datas futuras não são elegíveis para recuperação/);
    });
  });
});
