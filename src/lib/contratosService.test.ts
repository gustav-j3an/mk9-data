import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  isContratoVigente,
  checkVigenciaOverlap,
  validateContratoPayload,
  analyzeRotasForContracts,
  isTableNotFoundError,
  MigrationPendingError,
  calcularPeriodoContratual,
  parseISODate,
  getLastDayOfMonth,
  isLeapYear
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

  describe('6. Cálculo de Período Contratual e Competências (calcularPeriodoContratual)', () => {
    describe('6.1. Utilitários Puros de Data (Sem Fuso Horário)', () => {
      it('deve identificar anos bissextos corretamente', () => {
        assert.strictEqual(isLeapYear(2024), true); // divisível por 4
        assert.strictEqual(isLeapYear(2026), false); // não bissexto
        assert.strictEqual(isLeapYear(1900), false); // divisível por 100 mas não 400
        assert.strictEqual(isLeapYear(2000), true); // divisível por 400
      });

      it('deve retornar último dia do mês com precisão incluindo anos bissextos', () => {
        assert.strictEqual(getLastDayOfMonth(2026, 1), 31);
        assert.strictEqual(getLastDayOfMonth(2026, 2), 28);
        assert.strictEqual(getLastDayOfMonth(2024, 2), 29);
        assert.strictEqual(getLastDayOfMonth(2026, 4), 30);
        assert.strictEqual(getLastDayOfMonth(2026, 12), 31);
      });

      it('deve fazer parse estrito de YYYY-MM-DD e rejeitar datas malformadas ou impossíveis', () => {
        assert.deepStrictEqual(parseISODate('2026-10-17'), { year: 2026, month: 10, day: 17 });
        assert.throws(() => parseISODate('2026-02-30'), /impossível/);
        assert.throws(() => parseISODate('2026-04-31'), /impossível/);
        assert.throws(() => parseISODate('2026-13-01'), /inválido/);
        assert.throws(() => parseISODate('invalid-date'), /inválido/);
      });
    });

    describe('6.2. Regras Especiais da Indústria KING (IND-013) — Ciclo 23 a 22', () => {
      it('caso 1: referência 2026-10-17 (< 23) -> início 2026-09-23, fim 2026-10-22, competência 2026-10', () => {
        const res = calcularPeriodoContratual('IND-013', '2026-10-17');
        assert.strictEqual(res.data_inicio, '2026-09-23');
        assert.strictEqual(res.data_fim, '2026-10-22');
        assert.strictEqual(res.competencia, '2026-10');
        assert.strictEqual(res.tipo_ciclo, 'ESPECIAL_KING_23_22');
        assert.strictEqual(res.industria_codigo, 'IND-013');
      });

      it('caso 2: referência 2026-10-23 (>= 23) -> início 2026-10-23, fim 2026-11-22, competência 2026-11', () => {
        const res = calcularPeriodoContratual('IND-013', '2026-10-23');
        assert.strictEqual(res.data_inicio, '2026-10-23');
        assert.strictEqual(res.data_fim, '2026-11-22');
        assert.strictEqual(res.competencia, '2026-11');
        assert.strictEqual(res.tipo_ciclo, 'ESPECIAL_KING_23_22');
      });

      it('caso 3: referência 2026-11-22 (limite fim ciclo) -> início 2026-10-23, fim 2026-11-22, competência 2026-11', () => {
        const res = calcularPeriodoContratual('IND-013', '2026-11-22');
        assert.strictEqual(res.data_inicio, '2026-10-23');
        assert.strictEqual(res.data_fim, '2026-11-22');
        assert.strictEqual(res.competencia, '2026-11');
      });

      it('caso 4: referência 2026-11-23 (novo ciclo) -> início 2026-11-23, fim 2026-12-22, competência 2026-12', () => {
        const res = calcularPeriodoContratual('IND-013', '2026-11-23');
        assert.strictEqual(res.data_inicio, '2026-11-23');
        assert.strictEqual(res.data_fim, '2026-12-22');
        assert.strictEqual(res.competencia, '2026-12');
      });

      it('caso 5: virada de ano dezembro para janeiro (ref 2026-12-25)', () => {
        const res = calcularPeriodoContratual('IND-013', '2026-12-25');
        assert.strictEqual(res.data_inicio, '2026-12-23');
        assert.strictEqual(res.data_fim, '2027-01-22');
        assert.strictEqual(res.competencia, '2027-01');
      });

      it('caso 6: virada de ano início de janeiro (ref 2027-01-05)', () => {
        const res = calcularPeriodoContratual('IND-013', '2027-01-05');
        assert.strictEqual(res.data_inicio, '2026-12-23');
        assert.strictEqual(res.data_fim, '2027-01-22');
        assert.strictEqual(res.competencia, '2027-01');
      });

      it('caso 7: fevereiro e março (ref 2026-02-20 e ref 2026-02-25)', () => {
        const resFev1 = calcularPeriodoContratual('IND-013', '2026-02-20');
        assert.strictEqual(resFev1.data_inicio, '2026-01-23');
        assert.strictEqual(resFev1.data_fim, '2026-02-22');
        assert.strictEqual(resFev1.competencia, '2026-02');

        const resFev2 = calcularPeriodoContratual('IND-013', '2026-02-25');
        assert.strictEqual(resFev2.data_inicio, '2026-02-23');
        assert.strictEqual(resFev2.data_fim, '2026-03-22');
        assert.strictEqual(resFev2.competencia, '2026-03');
      });

      it('deve reconhecer IND-013 independentemente de maiúsculas/espaços', () => {
        const res = calcularPeriodoContratual(' ind-013 ', '2026-10-17');
        assert.strictEqual(res.industria_codigo, 'IND-013');
        assert.strictEqual(res.tipo_ciclo, 'ESPECIAL_KING_23_22');
      });
    });

    describe('6.3. Demais Indústrias — Ciclo Mensal Padrão e Primeiro Ciclo Pro-Rata', () => {
      it('deve aplicar pro-rata no mês de cadastro (ex: cadastro 2026-10-17, ref 2026-10-20 -> 2026-10-17 a 2026-10-31)', () => {
        const res = calcularPeriodoContratual('IND-001', '2026-10-20', '2026-10-17');
        assert.strictEqual(res.data_inicio, '2026-10-17');
        assert.strictEqual(res.data_fim, '2026-10-31');
        assert.strictEqual(res.competencia, '2026-10');
        assert.strictEqual(res.tipo_ciclo, 'PRIMEIRA_VIGENCIA_PRO_RATA');
      });

      it('deve aplicar mês cheio nos meses subsequentes ao cadastro (ex: cadastro 2026-10-17, ref 2026-11-15 -> 2026-11-01 a 2026-11-30)', () => {
        const res = calcularPeriodoContratual('IND-001', '2026-11-15', '2026-10-17');
        assert.strictEqual(res.data_inicio, '2026-11-01');
        assert.strictEqual(res.data_fim, '2026-11-30');
        assert.strictEqual(res.competencia, '2026-11');
        assert.strictEqual(res.tipo_ciclo, 'MENSAL_PADRAO');
      });

      it('se cadastro for no dia 01, tipo de ciclo deve ser MENSAL_PADRAO mesmo no mês de cadastro', () => {
        const res = calcularPeriodoContratual('IND-002', '2026-10-15', '2026-10-01');
        assert.strictEqual(res.data_inicio, '2026-10-01');
        assert.strictEqual(res.data_fim, '2026-10-31');
        assert.strictEqual(res.competencia, '2026-10');
        assert.strictEqual(res.tipo_ciclo, 'MENSAL_PADRAO');
      });

      it('se cadastro for no último dia do mês (ex: 2026-10-31), vigência pro-rata de 1 único dia', () => {
        const res = calcularPeriodoContratual('IND-003', '2026-10-31', '2026-10-31');
        assert.strictEqual(res.data_inicio, '2026-10-31');
        assert.strictEqual(res.data_fim, '2026-10-31');
        assert.strictEqual(res.competencia, '2026-10');
        assert.strictEqual(res.tipo_ciclo, 'PRIMEIRA_VIGENCIA_PRO_RATA');
      });

      it('sem data de cadastro informada: ciclo padrão do dia 01 ao fim do mês de referência', () => {
        const res = calcularPeriodoContratual('IND-999', '2026-02-14');
        assert.strictEqual(res.data_inicio, '2026-02-01');
        assert.strictEqual(res.data_fim, '2026-02-28');
        assert.strictEqual(res.competencia, '2026-02');
        assert.strictEqual(res.tipo_ciclo, 'MENSAL_PADRAO');
      });

      it('deve lançar erro se dataReferencia for anterior à dataCadastro', () => {
        assert.throws(
          () => calcularPeriodoContratual('IND-001', '2026-10-10', '2026-10-17'),
          /não pode ser anterior à data de cadastro/
        );
      });

      it('deve lançar erro se código da indústria estiver em branco', () => {
        assert.throws(
          () => calcularPeriodoContratual('   ', '2026-10-10'),
          /Código da indústria é obrigatório/
        );
      });
    });
  });
});

