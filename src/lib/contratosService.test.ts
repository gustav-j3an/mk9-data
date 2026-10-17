import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  isContratoVigente,
  checkVigenciaOverlap,
  validateContratoPayload,
  analyzeRotasForContracts,
  isTableNotFoundError,
  MigrationPendingError
} from './contratosService';
import type { RouteItem, ContratoLoja } from '../types';

describe('ContratosService — Testes Unitários de Regras Contratuais e Integridade', () => {
  describe('1. Validação de Vigência (isContratoVigente)', () => {
    const contratoAtivo: Pick<ContratoLoja, 'status' | 'data_inicio_vigencia' | 'data_fim_vigencia'> = {
      status: 'ativo',
      data_inicio_vigencia: '2026-10-01',
      data_fim_vigencia: '2026-12-31'
    };

    it('deve retornar true para data dentro do intervalo de vigência', () => {
      assert.strictEqual(isContratoVigente(contratoAtivo, '2026-10-15'), true);
      assert.strictEqual(isContratoVigente(contratoAtivo, '2026-10-01'), true);
      assert.strictEqual(isContratoVigente(contratoAtivo, '2026-12-31'), true);
    });

    it('deve retornar false para data anterior ao início ou posterior ao término', () => {
      assert.strictEqual(isContratoVigente(contratoAtivo, '2026-09-30'), false);
      assert.strictEqual(isContratoVigente(contratoAtivo, '2027-01-01'), false);
    });

    it('deve respeitar contrato sem data de término definida (vigência indeterminada)', () => {
      const contratoIndeterminado = {
        status: 'ativo' as const,
        data_inicio_vigencia: '2026-10-01',
        data_fim_vigencia: null
      };
      assert.strictEqual(isContratoVigente(contratoIndeterminado, '2027-05-20'), true);
    });

    it('deve retornar false se o contrato estiver inativo ou suspenso mesmo na data', () => {
      const contratoInativo = {
        status: 'inativo' as const,
        data_inicio_vigencia: '2026-10-01',
        data_fim_vigencia: null
      };
      assert.strictEqual(isContratoVigente(contratoInativo, '2026-10-15'), false);
    });
  });

  describe('2. Detecção de Sobreposição Temporal de Vigências (checkVigenciaOverlap)', () => {
    it('deve detectar sobreposição quando dois intervalos se cruzam parcialmente', () => {
      // A: [01/10/2026 a 31/12/2026], B: [15/11/2026 a 28/02/2027]
      const overlap = checkVigenciaOverlap('2026-10-01', '2026-12-31', '2026-11-15', '2027-02-28');
      assert.strictEqual(overlap, true);
    });

    it('deve permitir contratos sucessivos estritos (A termina dia 31/10 e B começa dia 01/11)', () => {
      const overlap = checkVigenciaOverlap('2026-10-01', '2026-10-31', '2026-11-01', '2026-12-31');
      assert.strictEqual(overlap, false);
    });

    it('deve acusar sobreposição se o término de A coincidir no mesmo dia do início de B', () => {
      // A termina dia 31/10 e B começa dia 31/10 (ambos ativos nesse mesmo dia)
      const overlap = checkVigenciaOverlap('2026-10-01', '2026-10-31', '2026-10-31', '2026-12-31');
      assert.strictEqual(overlap, true);
    });

    it('deve detectar sobreposição quando o contrato A não tem data de término (vigência aberta)', () => {
      // A: [01/10/2026 a infinito], B: [01/01/2027 a 30/06/2027]
      const overlap = checkVigenciaOverlap('2026-10-01', null, '2027-01-01', '2027-06-30');
      assert.strictEqual(overlap, true);
    });

    it('deve permitir contrato B anterior à vigência aberta de A sem sobreposição', () => {
      // B: [01/01/2026 a 30/09/2026], A: [01/10/2026 a infinito]
      const overlap = checkVigenciaOverlap('2026-10-01', null, '2026-01-01', '2026-09-30');
      assert.strictEqual(overlap, false);
    });
  });

  describe('3. Validação de Payload e Coerência de Frequência (validateContratoPayload)', () => {
    it('deve validar com sucesso um payload semanal correto', () => {
      const val = validateContratoPayload({
        industria_codigo: 'IND-01',
        loja_codigo: 'LOJ-100',
        frequencia: 'SEMANAL',
        visitas_por_semana: 2,
        data_inicio_vigencia: '2026-10-01',
        data_fim_vigencia: '2026-12-31',
        valor_por_visita: 85.50
      });
      assert.strictEqual(val.valid, true);
      assert.strictEqual(val.errors.length, 0);
    });

    it('deve validar com sucesso um payload quinzenal com ciclo válido', () => {
      const val = validateContratoPayload({
        industria_codigo: 'IND-01',
        loja_codigo: 'LOJ-100',
        frequencia: 'QUINZENAL',
        ciclo_quinzenal: 'PAR_IMPAR',
        data_inicio_vigencia: '2026-10-01'
      });
      assert.strictEqual(val.valid, true);
      assert.strictEqual(val.errors.length, 0);
    });

    it('deve reprovar contrato quinzenal sem ciclo definido', () => {
      const val = validateContratoPayload({
        industria_codigo: 'IND-01',
        loja_codigo: 'LOJ-100',
        frequencia: 'QUINZENAL',
        data_inicio_vigencia: '2026-10-01'
      });
      assert.strictEqual(val.valid, false);
      assert.strictEqual(val.errors.some((e) => e.includes('ciclo quinzenal é obrigatório')), true);
    });

    it('deve validar contrato semanal com ciclo nulo', () => {
      const val = validateContratoPayload({
        industria_codigo: 'IND-01',
        loja_codigo: 'LOJ-100',
        frequencia: 'SEMANAL',
        visitas_por_semana: 3,
        ciclo_quinzenal: undefined,
        data_inicio_vigencia: '2026-10-01'
      });
      assert.strictEqual(val.valid, true);
    });

    it('deve reprovar contrato semanal com ciclo quinzenal preenchido', () => {
      const val = validateContratoPayload({
        industria_codigo: 'IND-01',
        loja_codigo: 'LOJ-100',
        frequencia: 'SEMANAL',
        visitas_por_semana: 3,
        ciclo_quinzenal: 'PAR_IMPAR',
        data_inicio_vigencia: '2026-10-01'
      });
      assert.strictEqual(val.valid, false);
      assert.strictEqual(val.errors.some((e) => e.includes('o ciclo quinzenal não deve ser preenchido')), true);
    });

    it('deve validar contrato mensal com ciclo nulo e sem visitas_por_semana', () => {
      const val = validateContratoPayload({
        industria_codigo: 'IND-01',
        loja_codigo: 'LOJ-100',
        frequencia: 'MENSAL',
        data_inicio_vigencia: '2026-10-01'
      });
      assert.strictEqual(val.valid, true);
    });

    it('deve reprovar contrato mensal com ciclo quinzenal preenchido', () => {
      const val = validateContratoPayload({
        industria_codigo: 'IND-01',
        loja_codigo: 'LOJ-100',
        frequencia: 'MENSAL',
        ciclo_quinzenal: 'QUINZENAL_LIVRE',
        data_inicio_vigencia: '2026-10-01'
      });
      assert.strictEqual(val.valid, false);
      assert.strictEqual(val.errors.some((e) => e.includes('o ciclo quinzenal não deve ser preenchido')), true);
    });

    it('deve reprovar frequência com valor inválido', () => {
      const val = validateContratoPayload({
        industria_codigo: 'IND-01',
        loja_codigo: 'LOJ-100',
        frequencia: 'ANUAL' as any,
        data_inicio_vigencia: '2026-10-01'
      });
      assert.strictEqual(val.valid, false);
      assert.strictEqual(val.errors.some((e) => e.includes('Frequência inválida')), true);
    });

    it('deve rejeitar se enviar visitas_por_semana para frequência QUINZENAL ou MENSAL', () => {
      const valQuinzenalInvalido = validateContratoPayload({
        industria_codigo: 'IND-01',
        loja_codigo: 'LOJ-100',
        frequencia: 'QUINZENAL',
        ciclo_quinzenal: 'PAR_IMPAR',
        visitas_por_semana: 2, // Contraditório para quinzenal
        data_inicio_vigencia: '2026-10-01'
      });
      assert.strictEqual(valQuinzenalInvalido.valid, false);
      assert.strictEqual(valQuinzenalInvalido.errors.some((e) => e.includes('não deve ser informado visitas_por_semana')), true);

      const valMensalInvalido = validateContratoPayload({
        industria_codigo: 'IND-01',
        loja_codigo: 'LOJ-100',
        frequencia: 'MENSAL',
        visitas_por_semana: 1, // Contraditório para mensal
        data_inicio_vigencia: '2026-10-01'
      });
      assert.strictEqual(valMensalInvalido.valid, false);
    });

    it('deve reprovar payload sem industria_codigo ou sem loja_codigo', () => {
      const val = validateContratoPayload({
        industria_codigo: '',
        loja_codigo: '   ',
        data_inicio_vigencia: '2026-10-01'
      });
      assert.strictEqual(val.valid, false);
      assert.strictEqual(val.errors.some((e) => e.includes('indústria')), true);
      assert.strictEqual(val.errors.some((e) => e.includes('loja')), true);
    });

    it('deve reprovar término anterior ao início de vigência', () => {
      const val = validateContratoPayload({
        industria_codigo: 'IND-01',
        loja_codigo: 'LOJ-100',
        frequencia: 'SEMANAL',
        data_inicio_vigencia: '2026-10-20',
        data_fim_vigencia: '2026-10-10'
      });
      assert.strictEqual(val.valid, false);
      assert.strictEqual(val.errors.some((e) => e.includes('término')), true);
    });
  });

  describe('4. Auditoria de Rotas para Carga Inicial (analyzeRotasForContracts)', () => {
    const mockRotas: RouteItem[] = [
      // Loja 1 com Indústria A: 1 promotor, seg e qua (2x/semana)
      {
        id: 'r1',
        codigo_rota: 'R01',
        industria_codigo: 'IND-A',
        loja_codigo: 'LOJ-01',
        promotor_matricula: 'PRM-001',
        uf: 'SP',
        frequencia: 'SEMANAL',
        segunda: true,
        terca: false,
        quarta: true,
        quinta: false,
        sexta: false,
        sabado: false,
        domingo: false
      },
      // Mesma Loja 1 com Indústria B (QUINZENAL)
      {
        id: 'r2',
        codigo_rota: 'R02',
        industria_codigo: 'IND-B',
        loja_codigo: 'LOJ-01',
        promotor_matricula: 'PRM-002',
        uf: 'SP',
        frequencia: 'QUINZENAL',
        segunda: false,
        terca: true,
        quarta: false,
        quinta: false,
        sexta: false,
        sabado: false,
        domingo: false
      },
      // Loja 3 com Indústria C: CONFLITO - duas rotas com frequências divergentes
      {
        id: 'r3',
        codigo_rota: 'R03',
        industria_codigo: 'IND-C',
        loja_codigo: 'LOJ-03',
        promotor_matricula: 'PRM-001',
        uf: 'SP',
        frequencia: 'SEMANAL',
        segunda: true,
        terca: false,
        quarta: false,
        quinta: false,
        sexta: false,
        sabado: false,
        domingo: false
      },
      {
        id: 'r4',
        codigo_rota: 'R04',
        industria_codigo: 'IND-C',
        loja_codigo: 'LOJ-03',
        promotor_matricula: 'PRM-002',
        uf: 'SP',
        frequencia: 'QUINZENAL',
        segunda: false,
        terca: true,
        quarta: false,
        quinta: false,
        sexta: false,
        sabado: false,
        domingo: false
      }
    ];

    it('deve definir visitas_por_semana apenas para SEMANAL e null para QUINZENAL', () => {
      const { elegiveis, conflitos } = analyzeRotasForContracts(mockRotas);

      assert.strictEqual(elegiveis.length, 2);
      assert.strictEqual(conflitos.length, 1);

      const semanal = elegiveis.find((e) => e.industria_codigo === 'IND-A');
      assert.strictEqual(semanal?.frequencia, 'SEMANAL');
      assert.strictEqual(semanal?.visitas_por_semana, 2);

      const quinzenal = elegiveis.find((e) => e.industria_codigo === 'IND-B');
      assert.strictEqual(quinzenal?.frequencia, 'QUINZENAL');
      assert.strictEqual(quinzenal?.visitas_por_semana, null);
    });
  });

  describe('5. Tratamento de Erros Pré-Migration (isTableNotFoundError e MigrationPendingError)', () => {
    it('deve identificar erro de tabela inexistente 42P01', () => {
      const pgError = {
        code: '42P01',
        message: 'relation "public.contratos_lojas" does not exist'
      };
      assert.strictEqual(isTableNotFoundError(pgError), true);
    });

    it('deve instanciar MigrationPendingError com código e mensagem explicativa', () => {
      const err = new MigrationPendingError();
      assert.strictEqual(err.code, 'MIGRATION_PENDING');
      assert.strictEqual(err.name, 'MigrationPendingError');
      assert.strictEqual(err.message.includes('Execute a migration'), true);
    });

    it('não deve classificar erros de autenticação, permissão ou rede como tabela inexistente', () => {
      const rlsError = {
        code: '42501',
        message: 'permission denied for table contratos_lojas'
      };
      const networkError = {
        code: 'ECONNREFUSED',
        message: 'Failed to fetch'
      };
      assert.strictEqual(isTableNotFoundError(rlsError), false);
      assert.strictEqual(isTableNotFoundError(networkError), false);
    });
  });
});
