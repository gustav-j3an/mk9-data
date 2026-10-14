import { describe, it } from 'node:test';
import assert from 'node:assert';
import type { PromoterOperationAuthorization, UserRole } from '../types';

/**
 * Testes Unitários de Autorização Individual de Promotores (Etapa 4.1)
 *
 * Cenários validados:
 * 1. Promotor não autorizado não consegue iniciar nova visita em modo IMPLANTACAO.
 * 2. Promotor autorizado consegue iniciar visita nas suas rotas.
 * 3. Promotor não possui permissão para liberar a si mesmo ou a outro promotor (RBAC).
 * 4. Revogação de autorização altera status para 'bloqueado' e impede novas visitas sem apagar histórico.
 * 5. Admin e Gestores mantêm permissões totais de liberação e execução.
 * 6. Operação global continua preservada em IMPLANTACAO.
 */

// Simulador da regra de autorização da interface e backend
function canPromotorStartVisit(params: {
  operationMode: 'IMPLANTACAO' | 'OPERACAO_OFICIAL';
  promotorMatricula: string;
  routeMatricula: string;
  authorization: PromoterOperationAuthorization | null;
}): { allowed: boolean; reason?: string } {
  const { operationMode, promotorMatricula, routeMatricula, authorization } = params;

  // 1. Integridade de posse da rota
  if (promotorMatricula !== routeMatricula) {
    return { allowed: false, reason: 'Promotor só pode atender rotas atribuídas à sua própria matrícula' };
  }

  // 2. Em Operação Oficial, todos os promotores operam normalmente
  if (operationMode === 'OPERACAO_OFICIAL') {
    return { allowed: true };
  }

  // 3. Em Implantação, requer autorização com status 'liberado'
  if (!authorization || authorization.status !== 'liberado') {
    return { allowed: false, reason: 'Promotor não liberado para a fase de testes' };
  }

  return { allowed: true };
}

// Simulador da regra de quem pode conceder/revogar autorização
function canManageAuthorization(role: UserRole): boolean {
  return role === 'admin' || role === 'gestor';
}

describe('Controle de Autorização Individual de Promotores (Etapa 4.1)', () => {
  const matriculaTeste = 'PRM-068';
  const outraMatricula = 'PRM-001';

  it('1. Promotor não autorizado é bloqueado em modo IMPLANTACAO', () => {
    const res = canPromotorStartVisit({
      operationMode: 'IMPLANTACAO',
      promotorMatricula: matriculaTeste,
      routeMatricula: matriculaTeste,
      authorization: null
    });
    assert.strictEqual(res.allowed, false);
    assert.match(res.reason!, /não liberado/);
  });

  it('2. Promotor com autorização "bloqueado" é impedido de operar', () => {
    const authBloqueada: PromoterOperationAuthorization = {
      id: 'auth-1',
      promotor_matricula: matriculaTeste,
      status: 'bloqueado',
      authorized_at: '2026-10-09T10:00:00Z',
      justification: 'Bloqueado temporariamente',
      revoked_at: '2026-10-09T12:00:00Z',
      revocation_reason: 'Fim do teste piloto'
    };

    const res = canPromotorStartVisit({
      operationMode: 'IMPLANTACAO',
      promotorMatricula: matriculaTeste,
      routeMatricula: matriculaTeste,
      authorization: authBloqueada
    });
    assert.strictEqual(res.allowed, false);
    assert.match(res.reason!, /não liberado/);
  });

  it('3. Promotor autorizado com status "liberado" pode operar exclusivamente suas rotas', () => {
    const authLiberada: PromoterOperationAuthorization = {
      id: 'auth-2',
      promotor_matricula: matriculaTeste,
      status: 'liberado',
      authorized_at: '2026-10-09T10:00:00Z',
      authorized_by_name: 'Gestor Teste',
      justification: 'Autorizado para piloto regional'
    };

    // Própria rota
    const resPropria = canPromotorStartVisit({
      operationMode: 'IMPLANTACAO',
      promotorMatricula: matriculaTeste,
      routeMatricula: matriculaTeste,
      authorization: authLiberada
    });
    assert.strictEqual(resPropria.allowed, true);

    // Rota de outro promotor -> bloqueado mesmo estando autorizado
    const resOutra = canPromotorStartVisit({
      operationMode: 'IMPLANTACAO',
      promotorMatricula: matriculaTeste,
      routeMatricula: outraMatricula,
      authorization: authLiberada
    });
    assert.strictEqual(resOutra.allowed, false);
    assert.match(resOutra.reason!, /própria matrícula/);
  });

  it('4. Promotor ou operador NÃO podem liberar a si mesmos ou a outros', () => {
    assert.strictEqual(canManageAuthorization('promotor'), false);
    assert.strictEqual(canManageAuthorization('operador'), false);
    assert.strictEqual(canManageAuthorization('client_industry'), false);
  });

  it('5. Apenas Administrador e Gestor podem gerenciar autorizações', () => {
    assert.strictEqual(canManageAuthorization('admin'), true);
    assert.strictEqual(canManageAuthorization('gestor'), true);
  });

  it('6. Revogação mantém registro de auditoria sem apagar histórico', () => {
    const authOriginal: PromoterOperationAuthorization = {
      id: 'auth-3',
      promotor_matricula: matriculaTeste,
      status: 'liberado',
      authorized_at: '2026-10-09T08:00:00Z',
      authorized_by_name: 'Admin Master',
      justification: 'Início do teste'
    };

    // Simulando revogação
    const authRevogada: PromoterOperationAuthorization = {
      ...authOriginal,
      status: 'bloqueado',
      revoked_at: '2026-10-09T17:00:00Z',
      revoked_by_name: 'Admin Master',
      revocation_reason: 'Período de teste concluído com sucesso'
    };

    // O histórico anterior e a data inicial continuam presentes
    assert.strictEqual(authRevogada.status, 'bloqueado');
    assert.strictEqual(authRevogada.authorized_at, '2026-10-09T08:00:00Z');
    assert.strictEqual(authRevogada.revoked_at, '2026-10-09T17:00:00Z');
    assert.strictEqual(authRevogada.revocation_reason, 'Período de teste concluído com sucesso');

    // Agora está bloqueado
    const check = canPromotorStartVisit({
      operationMode: 'IMPLANTACAO',
      promotorMatricula: matriculaTeste,
      routeMatricula: matriculaTeste,
      authorization: authRevogada
    });
    assert.strictEqual(check.allowed, false);
  });

  it('7. Em OPERACAO_OFICIAL, todos os promotores operam independente do piloto', () => {
    const resOficial = canPromotorStartVisit({
      operationMode: 'OPERACAO_OFICIAL',
      promotorMatricula: matriculaTeste,
      routeMatricula: matriculaTeste,
      authorization: null
    });
    assert.strictEqual(resOficial.allowed, true);
  });

  // Hardening e Integridade de Visita (Etapa 4.1.8)
  describe('Hardening de Integridade de Visitas e Tabelas Filhas (Etapa 4.1.8)', () => {
    // Simulador da regra de validação de update na visita (Etapa 4.1.10)
    // OBSERVAÇÃO: Este teste valida as regras lógicas no runtime JavaScript/TypeScript.
    // Ele NÃO substitui nem comprova a execução da trigger PL/pgSQL real ou das políticas RLS no PostgreSQL.
    function validateVisitUpdate(params: {
      userRole: UserRole;
      userMatricula: string | null;
      oldVisit: { promotor_matricula: string; loja_codigo: string; industria_codigo?: string; rota_id?: string; data_visita: string; started_at?: string; status: string };
      newVisit: { promotor_matricula: string | null; loja_codigo: string | null; industria_codigo?: string | null; rota_id?: string | null; data_visita: string | null; started_at?: string | null; completed_at?: string | null; status: string };
    }): { allowed: boolean; error?: string } {
      const { userRole, userMatricula, oldVisit, newVisit } = params;

      if (userRole === 'admin' || userRole === 'gestor') {
        return { allowed: true };
      }

      if (!userMatricula) {
        return { allowed: false, error: 'Acesso negado: Usuário sem matrícula de promotor vinculada.' };
      }

      if (userMatricula !== oldVisit.promotor_matricula) {
        return { allowed: false, error: 'Acesso negado: Você só pode atualizar visitas associadas à sua própria matrícula.' };
      }

      // 1. Campos imutáveis com semântica IS DISTINCT FROM (evita bypass por NULL)
      if (newVisit.promotor_matricula !== oldVisit.promotor_matricula) {
        return { allowed: false, error: 'Violação de segurança: Não é permitido alterar a matrícula da visita.' };
      }
      if (newVisit.loja_codigo !== oldVisit.loja_codigo) {
        return { allowed: false, error: 'Violação de segurança: Não é permitido alterar a loja da visita.' };
      }
      if (newVisit.industria_codigo !== undefined && newVisit.industria_codigo !== oldVisit.industria_codigo) {
        return { allowed: false, error: 'Violação de segurança: Não é permitido alterar a indústria da visita.' };
      }
      if (newVisit.rota_id !== undefined && newVisit.rota_id !== oldVisit.rota_id) {
        return { allowed: false, error: 'Violação de segurança: Não é permitido alterar o vínculo de rota da visita.' };
      }
      if (newVisit.data_visita !== oldVisit.data_visita) {
        return { allowed: false, error: 'Violação de segurança: Não é permitido alterar a data da visita.' };
      }
      if (newVisit.started_at !== undefined && newVisit.started_at !== oldVisit.started_at) {
        return { allowed: false, error: 'Violação de segurança: Não é permitido alterar o horário de início da visita.' };
      }

      // 2. Visita concluída não pode ser reaberta nem alterada
      if (oldVisit.status === 'concluida') {
        return { allowed: false, error: 'Operação negada: Visita já concluída não pode ser alterada pelo promotor.' };
      }

      // 3. Visita não realizada não pode ser alterada
      if (oldVisit.status === 'nao_realizada') {
        return { allowed: false, error: 'Operação negada: Visita justificada como não realizada não pode ser alterada pelo promotor.' };
      }

      // 4. Transições de status válidas para o promotor: apenas 'em_andamento' -> 'concluida'
      if (newVisit.status !== oldVisit.status) {
        if (!(oldVisit.status === 'em_andamento' && newVisit.status === 'concluida')) {
          return { allowed: false, error: `Violação de segurança: Transição de status inválida para o promotor (de ${oldVisit.status} para ${newVisit.status}).` };
        }
      }

      // 5. Validação de completed_at no checkout
      if (newVisit.status === 'concluida') {
        if (!newVisit.completed_at) {
          return { allowed: false, error: 'Operação negada: Horário de conclusão (completed_at) é obrigatório ao concluir a visita.' };
        }
        if (oldVisit.started_at && newVisit.completed_at < oldVisit.started_at) {
          return { allowed: false, error: 'Violação de integridade: Horário de conclusão não pode ser anterior ao início da visita.' };
        }
      }

      return { allowed: true };
    }

    // Simulador da regra de inserção em tabelas filhas (fotos, checklist, ocorrências)
    function validateChildTableWrite(params: {
      userRole: UserRole;
      userMatricula: string;
      visit: { promotor_matricula: string; status: string };
    }): { allowed: boolean; error?: string } {
      const { userRole, userMatricula, visit } = params;

      if (userRole === 'admin' || userRole === 'gestor') {
        return { allowed: true };
      }

      if (userMatricula !== visit.promotor_matricula) {
        return { allowed: false, error: 'Acesso negado: Visita pertence a outro promotor' };
      }

      if (visit.status !== 'em_andamento') {
        return { allowed: false, error: 'Acesso negado: Registros só podem ser adicionados a visitas em andamento' };
      }

      return { allowed: true };
    }

    it('8. Promotor é impedido de alterar a loja ou a data de uma visita própria', () => {
      const oldVisit = { promotor_matricula: matriculaTeste, loja_codigo: 'LJ-001', data_visita: '2026-10-09', status: 'em_andamento' };
      
      // Tentativa de alterar loja
      const checkLoja = validateVisitUpdate({
        userRole: 'promotor',
        userMatricula: matriculaTeste,
        oldVisit,
        newVisit: { ...oldVisit, loja_codigo: 'LJ-999' }
      });
      assert.strictEqual(checkLoja.allowed, false);
      assert.match(checkLoja.error!, /loja da visita/);

      // Tentativa de enviar NULL na loja (bypass com IS DISTINCT FROM)
      const checkLojaNull = validateVisitUpdate({
        userRole: 'promotor',
        userMatricula: matriculaTeste,
        oldVisit,
        newVisit: { ...oldVisit, loja_codigo: null }
      });
      assert.strictEqual(checkLojaNull.allowed, false);
      assert.match(checkLojaNull.error!, /loja da visita/);

      // Tentativa de alterar data
      const checkData = validateVisitUpdate({
        userRole: 'promotor',
        userMatricula: matriculaTeste,
        oldVisit,
        newVisit: { ...oldVisit, data_visita: '2026-10-10' }
      });
      assert.strictEqual(checkData.allowed, false);
      assert.match(checkData.error!, /data da visita/);
    });

    it('9. Promotor é impedido de alterar visita pertencente a outra matrícula', () => {
      const visitTerceiro = { promotor_matricula: outraMatricula, loja_codigo: 'LJ-001', data_visita: '2026-10-09', status: 'em_andamento' };
      const res = validateVisitUpdate({
        userRole: 'promotor',
        userMatricula: matriculaTeste,
        oldVisit: visitTerceiro,
        newVisit: { ...visitTerceiro, status: 'concluida', completed_at: '2026-10-09T17:00:00Z' }
      });
      assert.strictEqual(res.allowed, false);
      assert.match(res.error!, /própria matrícula/);
    });

    it('10. Promotor consegue legitimamente concluir sua própria visita em andamento com checkout válido', () => {
      const oldVisit = {
        promotor_matricula: matriculaTeste,
        loja_codigo: 'LJ-001',
        data_visita: '2026-10-09',
        started_at: '2026-10-09T08:00:00Z',
        status: 'em_andamento'
      };
      const res = validateVisitUpdate({
        userRole: 'promotor',
        userMatricula: matriculaTeste,
        oldVisit,
        newVisit: {
          ...oldVisit,
          status: 'concluida',
          completed_at: '2026-10-09T09:30:00Z'
        }
      });
      assert.strictEqual(res.allowed, true);
    });

    it('11. Transições arbitrárias de status ou completed_at inválido são bloqueadas', () => {
      const oldVisit = {
        promotor_matricula: matriculaTeste,
        loja_codigo: 'LJ-001',
        data_visita: '2026-10-09',
        started_at: '2026-10-09T08:00:00Z',
        status: 'em_andamento'
      };

      // 1. Tentativa de transição arbitrária de 'em_andamento' para 'pendente'
      const checkArbitrario = validateVisitUpdate({
        userRole: 'promotor',
        userMatricula: matriculaTeste,
        oldVisit,
        newVisit: { ...oldVisit, status: 'pendente' }
      });
      assert.strictEqual(checkArbitrario.allowed, false);
      assert.match(checkArbitrario.error!, /Transição de status inválida/);

      // 2. Conclusão sem completed_at
      const checkSemCompleted = validateVisitUpdate({
        userRole: 'promotor',
        userMatricula: matriculaTeste,
        oldVisit,
        newVisit: { ...oldVisit, status: 'concluida', completed_at: null }
      });
      assert.strictEqual(checkSemCompleted.allowed, false);
      assert.match(checkSemCompleted.error!, /Horário de conclusão/);

      // 3. Conclusão com completed_at retroativo ao started_at
      const checkRetroativo = validateVisitUpdate({
        userRole: 'promotor',
        userMatricula: matriculaTeste,
        oldVisit,
        newVisit: { ...oldVisit, status: 'concluida', completed_at: '2026-10-09T07:00:00Z' }
      });
      assert.strictEqual(checkRetroativo.allowed, false);
      assert.match(checkRetroativo.error!, /não pode ser anterior ao início/);
    });

    it('12. Promotor é impedido de alterar visita que já foi concluída ou não realizada', () => {
      const visitConcluida = { promotor_matricula: matriculaTeste, loja_codigo: 'LJ-001', data_visita: '2026-10-09', status: 'concluida' };
      const res = validateVisitUpdate({
        userRole: 'promotor',
        userMatricula: matriculaTeste,
        oldVisit: visitConcluida,
        newVisit: { ...visitConcluida, status: 'em_andamento' }
      });
      assert.strictEqual(res.allowed, false);
      assert.match(res.error!, /já concluída/);

      const visitNaoRealizada = { promotor_matricula: matriculaTeste, loja_codigo: 'LJ-001', data_visita: '2026-10-09', status: 'nao_realizada' };
      const resNaoRealizada = validateVisitUpdate({
        userRole: 'promotor',
        userMatricula: matriculaTeste,
        oldVisit: visitNaoRealizada,
        newVisit: { ...visitNaoRealizada, status: 'em_andamento' }
      });
      assert.strictEqual(resNaoRealizada.allowed, false);
      assert.match(resNaoRealizada.error!, /não realizada não pode ser alterada/);
    });

    it('13. Inserção em tabelas filhas é bloqueada após conclusão da visita e permitida em andamento', () => {
      const visitConcluida = { promotor_matricula: matriculaTeste, status: 'concluida' };
      const resConcluida = validateChildTableWrite({
        userRole: 'promotor',
        userMatricula: matriculaTeste,
        visit: visitConcluida
      });
      assert.strictEqual(resConcluida.allowed, false);
      assert.match(resConcluida.error!, /visitas em andamento/);

      const visitEmAndamento = { promotor_matricula: matriculaTeste, status: 'em_andamento' };
      const resEmAndamento = validateChildTableWrite({
        userRole: 'promotor',
        userMatricula: matriculaTeste,
        visit: visitEmAndamento
      });
      assert.strictEqual(resEmAndamento.allowed, true);
    });
  });
});
