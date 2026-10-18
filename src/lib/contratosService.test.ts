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
  isLeapYear,
  classificarParContratual,
  contratosService
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

  describe('7. Integração Passo 2 — Preparação de Payload e Cálculo de Período Contratual', () => {
    describe('7.1. Criação de Contrato com Período Explícito (Retrocompatibilidade)', () => {
      it('deve preservar período explícito informado sem recalcular datas', () => {
        const prep = contratosService.prepareContratoInsertData({
          industria_codigo: 'IND-001',
          loja_codigo: 'LOJ-10',
          frequencia: 'SEMANAL',
          visitas_por_semana: 3,
          data_inicio_vigencia: '2026-05-10',
          data_fim_vigencia: '2026-12-31'
        });

        assert.strictEqual(prep.error, null);
        assert.strictEqual(prep.data?.data_inicio_vigencia, '2026-05-10');
        assert.strictEqual(prep.data?.data_fim_vigencia, '2026-12-31');
        assert.strictEqual(prep.data?.frequencia, 'SEMANAL');
        assert.strictEqual(prep.data?.visitas_por_semana, 3);
      });

      it('deve preservar vigência aberta (data_fim_vigencia = null) sem inventar término', () => {
        const prep = contratosService.prepareContratoInsertData({
          industria_codigo: 'IND-001',
          loja_codigo: 'LOJ-10',
          frequencia: 'SEMANAL',
          visitas_por_semana: 2,
          data_inicio_vigencia: '2026-05-10',
          data_fim_vigencia: null
        });

        assert.strictEqual(prep.error, null);
        assert.strictEqual(prep.data?.data_inicio_vigencia, '2026-05-10');
        assert.strictEqual(prep.data?.data_fim_vigencia, null);
      });
    });

    describe('7.2. Criação de Contrato da KING (IND-013) com Cálculo Solicitado', () => {
      it('deve calcular período da KING antes do dia 23 (ref: 2026-10-17) -> 2026-09-23 a 2026-10-22', () => {
        const prep = contratosService.prepareContratoInsertData({
          industria_codigo: 'IND-013',
          loja_codigo: 'LOJ-10',
          frequencia: 'SEMANAL',
          visitas_por_semana: 2,
          calcular_periodo: true,
          data_referencia: '2026-10-17'
        });

        assert.strictEqual(prep.error, null);
        assert.strictEqual(prep.data?.data_inicio_vigencia, '2026-09-23');
        assert.strictEqual(prep.data?.data_fim_vigencia, '2026-10-22');
      });

      it('deve calcular período da KING a partir do dia 23 (ref: 2026-10-23) -> 2026-10-23 a 2026-11-22', () => {
        const prep = contratosService.prepareContratoInsertData({
          industria_codigo: 'IND-013',
          loja_codigo: 'LOJ-10',
          frequencia: 'QUINZENAL',
          ciclo_quinzenal: 'PAR_IMPAR',
          calcular_periodo: true,
          data_referencia: '2026-10-23'
        });

        assert.strictEqual(prep.error, null);
        assert.strictEqual(prep.data?.data_inicio_vigencia, '2026-10-23');
        assert.strictEqual(prep.data?.data_fim_vigencia, '2026-11-22');
        assert.strictEqual(prep.data?.frequencia, 'QUINZENAL');
        assert.strictEqual(prep.data?.ciclo_quinzenal, 'PAR_IMPAR');
        assert.strictEqual(prep.data?.visitas_por_semana, null);
      });
    });

    describe('7.3. Criação de Contrato de Outra Indústria com Data Real de Cadastro', () => {
      it('primeiro mês (pro-rata): cadastro 2026-10-17, ref 2026-10-20 -> início 2026-10-17, fim 2026-10-31', () => {
        const prep = contratosService.prepareContratoInsertData({
          industria_codigo: 'IND-050',
          loja_codigo: 'LOJ-10',
          frequencia: 'SEMANAL',
          visitas_por_semana: 1,
          calcular_periodo: true,
          data_referencia: '2026-10-20',
          data_cadastro: '2026-10-17'
        });

        assert.strictEqual(prep.error, null);
        assert.strictEqual(prep.data?.data_inicio_vigencia, '2026-10-17');
        assert.strictEqual(prep.data?.data_fim_vigencia, '2026-10-31');
      });

      it('competência subsequente: cadastro 2026-10-17, ref 2026-11-10 -> início 2026-11-01, fim 2026-11-30', () => {
        const prep = contratosService.prepareContratoInsertData({
          industria_codigo: 'IND-050',
          loja_codigo: 'LOJ-10',
          frequencia: 'MENSAL',
          calcular_periodo: true,
          data_referencia: '2026-11-10',
          data_cadastro: '2026-10-17'
        });

        assert.strictEqual(prep.error, null);
        assert.strictEqual(prep.data?.data_inicio_vigencia, '2026-11-01');
        assert.strictEqual(prep.data?.data_fim_vigencia, '2026-11-30');
        assert.strictEqual(prep.data?.frequencia, 'MENSAL');
        assert.strictEqual(prep.data?.visitas_por_semana, null);
        assert.strictEqual(prep.data?.ciclo_quinzenal, null);
      });

      it('deve recusar cálculo para indústria comum se data_cadastro não for informada (não substitui silenciosamente por CURRENT_DATE)', () => {
        const prep = contratosService.prepareContratoInsertData({
          industria_codigo: 'IND-050',
          loja_codigo: 'LOJ-10',
          frequencia: 'SEMANAL',
          visitas_por_semana: 1,
          calcular_periodo: true,
          data_referencia: '2026-10-20'
          // data_cadastro omitida intencionalmente
        });

        assert.strictEqual(prep.data, null);
        assert.notStrictEqual(prep.error, null);
        assert.match(prep.error!.message, /exige a data efetiva de início da operação/);
      });
    });

    describe('7.4. Isolamento do Payload Enviado ao Supabase (Sem Colunas Inexistentes)', () => {
      it('o payload retornado por prepareContratoInsertData não deve conter calcular_periodo, data_referencia, data_cadastro ou competencia', () => {
        const prep = contratosService.prepareContratoInsertData({
          industria_codigo: 'IND-013',
          loja_codigo: 'LOJ-10',
          frequencia: 'SEMANAL',
          visitas_por_semana: 2,
          calcular_periodo: true,
          data_referencia: '2026-10-17',
          data_cadastro: '2026-09-01'
        });

        assert.strictEqual(prep.error, null);
        const dataKeys = Object.keys(prep.data || {});
        assert.strictEqual(dataKeys.includes('calcular_periodo'), false);
        assert.strictEqual(dataKeys.includes('data_referencia'), false);
        assert.strictEqual(dataKeys.includes('data_cadastro'), false);
        assert.strictEqual(dataKeys.includes('competencia'), false);
      });
    });

    describe('7.5. Análise de Rotas com Projeção Opcional de Período', () => {
      const rotasExemplo: RouteItem[] = [
        {
          id: 'r_king',
          codigo_rota: 'RK1',
          industria_codigo: 'IND-013',
          loja_codigo: 'LOJ-99',
          promotor_matricula: 'P1',
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
          id: 'r_outra',
          codigo_rota: 'RO1',
          industria_codigo: 'IND-020',
          loja_codigo: 'LOJ-99',
          promotor_matricula: 'P2',
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

      it('deve manter análise sem projeção quando options não forem fornecidas', () => {
        const res = analyzeRotasForContracts(rotasExemplo);
        assert.strictEqual(res.elegiveis.length, 2);
        assert.strictEqual(res.elegiveis[0].projecao_periodo, undefined);
        assert.strictEqual(res.elegiveis[1].projecao_periodo, undefined);
      });

      it('deve calcular projeção de período quando data_referencia for informada', () => {
        const res = analyzeRotasForContracts(rotasExemplo, {
          data_referencia: '2026-10-25',
          data_cadastro_map: {
            'IND-020': '2026-10-10'
          }
        });

        const king = res.elegiveis.find((e) => e.industria_codigo === 'IND-013');
        assert.strictEqual(king?.projecao_periodo?.data_inicio, '2026-10-23');
        assert.strictEqual(king?.projecao_periodo?.data_fim, '2026-11-22');
        assert.strictEqual(king?.projecao_periodo?.competencia, '2026-11');

        const outra = res.elegiveis.find((e) => e.industria_codigo === 'IND-020');
        assert.strictEqual(outra?.projecao_periodo?.data_inicio, '2026-10-10');
        assert.strictEqual(outra?.projecao_periodo?.data_fim, '2026-10-31');
        assert.strictEqual(outra?.projecao_periodo?.tipo_ciclo, 'PRIMEIRA_VIGENCIA_PRO_RATA');
      });

      it('deve usar primeiro dia do mês como fallback quando data_inicio_operacao for omitida para indústria não KING', () => {
        const res = analyzeRotasForContracts(rotasExemplo, {
          data_referencia: '2026-10-25'
          // sem data_cadastro_map
        });

        const outra = res.elegiveis.find((e) => e.industria_codigo === 'IND-020');
        assert.strictEqual(outra?.projecao_periodo?.data_inicio, '2026-10-01');
        assert.strictEqual(outra?.projecao_periodo?.data_fim, '2026-10-31');
        assert.strictEqual(outra?.projecao_periodo?.tipo_ciclo, 'MENSAL_PADRAO');
      });

      it('KING não deve depender de data_inicio_operacao e manter ciclo contínuo 23-22', () => {
        const res = analyzeRotasForContracts(rotasExemplo, {
          data_referencia: '2026-10-15',
          data_cadastro_map: {}
        });

        const king = res.elegiveis.find((e) => e.industria_codigo === 'IND-013');
        assert.strictEqual(king?.projecao_periodo?.data_inicio, '2026-09-23');
        assert.strictEqual(king?.projecao_periodo?.data_fim, '2026-10-22');
        assert.strictEqual(king?.projecao_periodo?.competencia, '2026-10');
        assert.strictEqual(king?.projecao_periodo?.tipo_ciclo, 'ESPECIAL_KING_23_22');
      });
    });

    describe('7.6. Validação Completa das Regras Comerciais da Etapa H2', () => {
      // 1. KING no dia 22 e no dia 23
      it('1. KING: no dia 22 fecha ciclo corrente; no dia 23 inicia novo ciclo', () => {
        const cicloDia22 = calcularPeriodoContratual('IND-013', '2026-10-22');
        assert.strictEqual(cicloDia22.data_inicio, '2026-09-23');
        assert.strictEqual(cicloDia22.data_fim, '2026-10-22');
        assert.strictEqual(cicloDia22.competencia, '2026-10');

        const cicloDia23 = calcularPeriodoContratual('IND-013', '2026-10-23');
        assert.strictEqual(cicloDia23.data_inicio, '2026-10-23');
        assert.strictEqual(cicloDia23.data_fim, '2026-11-22');
        assert.strictEqual(cicloDia23.competencia, '2026-11');
      });

      // 2. KING na virada do ano
      it('2. KING: virada do ano cruza dezembro e janeiro com competência 01 do ano subsequente', () => {
        const viradaDez = calcularPeriodoContratual('IND-013', '2026-12-25');
        assert.strictEqual(viradaDez.data_inicio, '2026-12-23');
        assert.strictEqual(viradaDez.data_fim, '2027-01-22');
        assert.strictEqual(viradaDez.competencia, '2027-01');

        const viradaJan = calcularPeriodoContratual('IND-013', '2027-01-15');
        assert.strictEqual(viradaJan.data_inicio, '2026-12-23');
        assert.strictEqual(viradaJan.data_fim, '2027-01-22');
        assert.strictEqual(viradaJan.competencia, '2027-01');
      });

      // 3. Primeiro período de uma indústria iniciado no meio do mês
      it('3. Demais indústrias: primeiro período iniciado no meio do mês (pro-rata)', () => {
        const res = calcularPeriodoContratual('IND-025', '2026-10-20', '2026-10-14');
        assert.strictEqual(res.data_inicio, '2026-10-14');
        assert.strictEqual(res.data_fim, '2026-10-31');
        assert.strictEqual(res.competencia, '2026-10');
        assert.strictEqual(res.tipo_ciclo, 'PRIMEIRA_VIGENCIA_PRO_RATA');
      });

      // 4. Primeiro período iniciado no último dia do mês
      it('4. Demais indústrias: primeiro período iniciado no último dia do mês (vigência de 1 dia)', () => {
        const res = calcularPeriodoContratual('IND-025', '2026-08-31', '2026-08-31');
        assert.strictEqual(res.data_inicio, '2026-08-31');
        assert.strictEqual(res.data_fim, '2026-08-31');
        assert.strictEqual(res.competencia, '2026-08');
        assert.strictEqual(res.tipo_ciclo, 'PRIMEIRA_VIGENCIA_PRO_RATA');
      });

      // 5. Competência seguinte em mês normal
      it('5. Demais indústrias: competência seguinte opera mês cheio (01 ao fim do mês)', () => {
        const res = calcularPeriodoContratual('IND-025', '2026-11-10', '2026-10-14');
        assert.strictEqual(res.data_inicio, '2026-11-01');
        assert.strictEqual(res.data_fim, '2026-11-30');
        assert.strictEqual(res.competencia, '2026-11');
        assert.strictEqual(res.tipo_ciclo, 'MENSAL_PADRAO');
      });

      // 6. Fevereiro em ano bissexto
      it('6. Calendário: fevereiro em ano bissexto (2028 = 29 dias) e não bissexto (2026 = 28 dias)', () => {
        const bissexto = calcularPeriodoContratual('IND-030', '2028-02-10', '2028-01-01');
        assert.strictEqual(bissexto.data_inicio, '2028-02-01');
        assert.strictEqual(bissexto.data_fim, '2028-02-29');

        const normal = calcularPeriodoContratual('IND-030', '2026-02-10', '2026-01-01');
        assert.strictEqual(normal.data_inicio, '2026-02-01');
        assert.strictEqual(normal.data_fim, '2026-02-28');
      });

      // 7. Data de referência anterior ao início da operação
      it('7. Integridade: lança erro se data de referência for anterior ao início da operação', () => {
        assert.throws(
          () => calcularPeriodoContratual('IND-040', '2026-09-30', '2026-10-01'),
          /não pode ser anterior à data de cadastro/
        );
      });

      // 8. Data de início ausente
      it('8. Ausência de data de início: prepareContratoInsertData recusa cálculo para indústrias não KING', () => {
        const prep = contratosService.prepareContratoInsertData({
          industria_codigo: 'IND-040',
          loja_codigo: 'LOJ-01',
          frequencia: 'SEMANAL',
          visitas_por_semana: 2,
          calcular_periodo: true,
          data_referencia: '2026-10-20'
          // sem data_cadastro / data_inicio_operacao
        });

        assert.strictEqual(prep.data, null);
        assert.notStrictEqual(prep.error, null);
        assert.match(prep.error!.message, /exige a data efetiva de início da operação/);
      });

      // 9. Data inválida
      it('9. Validação estrita: rejeita data em formato inválido ou inexistente no calendário', () => {
        assert.throws(
          () => calcularPeriodoContratual('IND-050', '2026-02-30', '2026-01-01'),
          /Data calendário impossível/
        );
        assert.throws(
          () => calcularPeriodoContratual('IND-050', '20-10-2026', '2026-01-01'),
          /Formato de data inválido/
        );
      });

      // 10. Contrato com vigência explicitamente informada
      it('10. Retrocompatibilidade: vigência informada explicitamente é preservada e não sobrescrita', () => {
        const prep = contratosService.prepareContratoInsertData({
          industria_codigo: 'IND-013',
          loja_codigo: 'LOJ-05',
          frequencia: 'SEMANAL',
          visitas_por_semana: 3,
          data_inicio_vigencia: '2026-01-01',
          data_fim_vigencia: null // contrato contínuo indeterminado
        });

        assert.strictEqual(prep.error, null);
        assert.strictEqual(prep.data?.data_inicio_vigencia, '2026-01-01');
        assert.strictEqual(prep.data?.data_fim_vigencia, null);
      });

      // 11. Frequência semanal e quinzenal sem interferência no cálculo
      it('11. Independência: frequências SEMANAL e QUINZENAL não interferem nas datas do período calculado', () => {
        const rotasSemanal: RouteItem[] = [{
          id: 'r_sem',
          codigo_rota: 'R_SEM',
          industria_codigo: 'IND-070',
          loja_codigo: 'LOJ-70',
          promotor_matricula: 'P1',
          uf: 'SP',
          frequencia: 'SEMANAL',
          segunda: true,
          terca: false,
          quarta: false,
          quinta: false,
          sexta: false,
          sabado: false,
          domingo: false
        }];

        const rotasQuinzenal: RouteItem[] = [{
          id: 'r_quin',
          codigo_rota: 'R_QUIN',
          industria_codigo: 'IND-070',
          loja_codigo: 'LOJ-70',
          promotor_matricula: 'P1',
          uf: 'SP',
          frequencia: 'QUINZENAL',
          segunda: true,
          terca: false,
          quarta: false,
          quinta: false,
          sexta: false,
          sabado: false,
          domingo: false
        }];

        const resSem = analyzeRotasForContracts(rotasSemanal, {
          data_referencia: '2026-10-25',
          data_cadastro_map: { 'IND-070': '2026-10-10' }
        });

        const resQuin = analyzeRotasForContracts(rotasQuinzenal, {
          data_referencia: '2026-10-25',
          data_cadastro_map: { 'IND-070': '2026-10-10' }
        });

        assert.strictEqual(resSem.elegiveis[0].projecao_periodo?.data_inicio, '2026-10-10');
        assert.strictEqual(resSem.elegiveis[0].projecao_periodo?.data_fim, '2026-10-31');
        assert.strictEqual(resQuin.elegiveis[0].projecao_periodo?.data_inicio, '2026-10-10');
        assert.strictEqual(resQuin.elegiveis[0].projecao_periodo?.data_fim, '2026-10-31');
      });

      // 12. Prévia sem data de início exibindo indisponibilidade
      it('12. Prévia: quando data_inicio_operacao não existe para indústria não KING, a projeção não é assumida como válida', () => {
        const rotasSemData: RouteItem[] = [{
          id: 'r_sem_data',
          codigo_rota: 'R_SD',
          industria_codigo: 'IND-SEM-DATA',
          loja_codigo: 'LOJ-80',
          promotor_matricula: 'P1',
          uf: 'SP',
          frequencia: 'SEMANAL',
          segunda: true,
          terca: false,
          quarta: false,
          quinta: false,
          sexta: false,
          sabado: false,
          domingo: false
        }];

        // Em analyzeRotasForContracts com map vazio
        const analise = analyzeRotasForContracts(rotasSemData, {
          data_referencia: '2026-10-25',
          data_cadastro_map: {}
        });

        assert.strictEqual(analise.elegiveis.length, 1);
        const item = analise.elegiveis[0];
        // Sem data informada na chamada estrita de criação, rejeita
        const prep = contratosService.prepareContratoInsertData({
          industria_codigo: item.industria_codigo,
          loja_codigo: item.loja_codigo,
          frequencia: item.frequencia,
          calcular_periodo: true,
          data_referencia: '2026-10-25'
        });

        assert.strictEqual(prep.data, null);
        assert.match(prep.error!.message, /exige a data efetiva de início da operação/);
      });
    });
  });

  // -------------------------------------------------------------
  // 8. TESTES DE REGRESSÃO DA AUTORIZAÇÃO INDIVIDUAL DE CONTRATOS (ETAPA H3.7)
  // -------------------------------------------------------------
  describe('8. Testes de Regressão da Autorização Individual e Preparação de Contratos', () => {
    describe('8.1. Validação de Valor por Visita', () => {
      it('deve aceitar valor por visita positivo e decimal (R$ 150.50)', () => {
        const prep = contratosService.prepareContratoInsertData({
          industria_codigo: 'IND-001',
          loja_codigo: 'LOJ-001',
          frequencia: 'SEMANAL',
          visitas_por_semana: 2,
          data_inicio_vigencia: '2026-10-01',
          data_fim_vigencia: null,
          valor_por_visita: 150.5,
          status: 'ativo'
        });

        assert.strictEqual(prep.error, null);
        assert.ok(prep.data);
        assert.strictEqual(prep.data.valor_por_visita, 150.5);
      });

      it('deve rejeitar valor por visita negativo (-10)', () => {
        const val = validateContratoPayload({
          industria_codigo: 'IND-001',
          loja_codigo: 'LOJ-001',
          frequencia: 'SEMANAL',
          data_inicio_vigencia: '2026-10-01',
          valor_por_visita: -10
        });

        assert.strictEqual(val.valid, false);
        assert.ok(val.errors.some((e) => e.includes('não pode ser negativo')));
      });

      it('deve aceitar null ou undefined em prepareContratoInsertData preservando compatibilidade do schema', () => {
        const prep = contratosService.prepareContratoInsertData({
          industria_codigo: 'IND-001',
          loja_codigo: 'LOJ-001',
          frequencia: 'SEMANAL',
          visitas_por_semana: 1,
          data_inicio_vigencia: '2026-10-01',
          data_fim_vigencia: null,
          status: 'ativo'
        });

        assert.strictEqual(prep.error, null);
        assert.ok(prep.data);
        assert.strictEqual(prep.data.valor_por_visita, null);
      });
    });

    describe('8.2. Vigência Comercial Contínua vs Determinada', () => {
      it('deve permitir vigência contínua com data_fim_vigencia = null', () => {
        const prep = contratosService.prepareContratoInsertData({
          industria_codigo: 'IND-013', // KING
          loja_codigo: 'LOJ-002',
          frequencia: 'SEMANAL',
          visitas_por_semana: 3,
          data_inicio_vigencia: '2026-10-23',
          data_fim_vigencia: null,
          valor_por_visita: 85.0,
          status: 'ativo'
        });

        assert.strictEqual(prep.error, null);
        assert.ok(prep.data);
        assert.strictEqual(prep.data.data_inicio_vigencia, '2026-10-23');
        assert.strictEqual(prep.data.data_fim_vigencia, null);
      });

      it('deve permitir vigência determinada com datas válidas e coerentes', () => {
        const prep = contratosService.prepareContratoInsertData({
          industria_codigo: 'IND-002',
          loja_codigo: 'LOJ-003',
          frequencia: 'SEMANAL',
          visitas_por_semana: 1,
          data_inicio_vigencia: '2026-10-01',
          data_fim_vigencia: '2026-12-31',
          valor_por_visita: 120.0,
          status: 'ativo'
        });

        assert.strictEqual(prep.error, null);
        assert.ok(prep.data);
        assert.strictEqual(prep.data.data_inicio_vigencia, '2026-10-01');
        assert.strictEqual(prep.data.data_fim_vigencia, '2026-12-31');
      });

      it('deve rejeitar vigência onde data_fim_vigencia é anterior à data_inicio_vigencia', () => {
        const prep = contratosService.prepareContratoInsertData({
          industria_codigo: 'IND-002',
          loja_codigo: 'LOJ-003',
          frequencia: 'SEMANAL',
          data_inicio_vigencia: '2026-11-01',
          data_fim_vigencia: '2026-10-15',
          valor_por_visita: 100.0,
          status: 'ativo'
        });

        assert.strictEqual(prep.data, null);
        assert.ok(prep.error);
        assert.match(prep.error.message, /data de término da vigência não pode ser anterior à data de início/);
      });

      it('deve rejeitar datas com formato ISO inválido ou dias inexistentes no calendário', () => {
        assert.throws(() => parseISODate('2026-02-30'), /Data calendário impossível/);
        assert.throws(() => parseISODate('2026/10/20'), /Formato de data inválido/);
        assert.throws(() => parseISODate('data-invalida'), /Formato de data inválido/);
      });
    });

    describe('8.3. Preservação de Identificadores e Integridade de Payload', () => {
      it('deve normalizar e preservar códigos de indústria e loja em caixa alta sem espaços', () => {
        const prep = contratosService.prepareContratoInsertData({
          industria_codigo: '  ind-099  ',
          loja_codigo: '  loj-888  ',
          frequencia: 'SEMANAL',
          visitas_por_semana: 1,
          data_inicio_vigencia: '2026-10-01',
          data_fim_vigencia: null,
          status: 'ativo'
        });

        assert.strictEqual(prep.error, null);
        assert.ok(prep.data);
        assert.strictEqual(prep.data.industria_codigo, 'IND-099');
        assert.strictEqual(prep.data.loja_codigo, 'LOJ-888');
      });

      it('deve garantir que o payload sanitizado contenha APENAS colunas aceitas pelo schema SQL de contratos_lojas', () => {
        const prep = contratosService.prepareContratoInsertData({
          industria_codigo: 'IND-013',
          loja_codigo: 'LOJ-001',
          frequencia: 'SEMANAL',
          visitas_por_semana: 2,
          data_inicio_vigencia: '2026-10-23',
          data_fim_vigencia: null,
          valor_por_visita: 95.0,
          status: 'ativo',
          observacao: 'Contrato comercial revisado.',
          // Propriedades auxiliares proibidas no SQL:
          calcular_periodo: false,
          data_referencia: '2026-10-25',
          data_cadastro: '2026-10-23'
        });

        assert.strictEqual(prep.error, null);
        assert.ok(prep.data);

        const keys = Object.keys(prep.data);
        const prohibitedKeys = ['calcular_periodo', 'data_referencia', 'data_cadastro', 'competencia', '_meta', 'metadata'];
        prohibitedKeys.forEach((key) => {
          assert.strictEqual(keys.includes(key), false, `A chave "${key}" não pode estar no payload sanitizado SQL.`);
        });

        const expectedAllowedKeys = [
          'industria_codigo',
          'loja_codigo',
          'frequencia',
          'visitas_por_semana',
          'segunda',
          'terca',
          'quarta',
          'quinta',
          'sexta',
          'sabado',
          'domingo',
          'ciclo_quinzenal',
          'data_inicio_vigencia',
          'data_fim_vigencia',
          'status',
          'valor_por_visita',
          'origem',
          'observacao'
        ];

        assert.deepStrictEqual(keys.sort(), expectedAllowedKeys.sort());
      });

      it('deve garantir visitas_por_semana = null quando frequencia for QUINZENAL ou MENSAL', () => {
        const prepQuin = contratosService.prepareContratoInsertData({
          industria_codigo: 'IND-001',
          loja_codigo: 'LOJ-001',
          frequencia: 'QUINZENAL',
          ciclo_quinzenal: 'PAR_IMPAR',
          data_inicio_vigencia: '2026-10-01',
          status: 'ativo'
        });

        assert.strictEqual(prepQuin.error, null);
        assert.ok(prepQuin.data);
        assert.strictEqual(prepQuin.data.visitas_por_semana, null);
        assert.strictEqual(prepQuin.data.ciclo_quinzenal, 'PAR_IMPAR');
      });
    });

    describe('8.4. Isolamento Pura da Classificação Comercial e Elegibilidade (classificarParContratual)', () => {
      it('deve classificar como ERRO_CONSULTA quando contratosError for informado', () => {
        const res = classificarParContratual({
          contratosDoPar: [],
          dataInicioOperacao: '2026-10-01',
          contratosError: 'Falha de conexão com o banco'
        });

        assert.strictEqual(res.classificacao, 'ERRO_CONSULTA');
        assert.match(res.motivoClassificacao, /indisponível/);
      });

      it('deve classificar como JA_POSSUI_ATIVO quando existir contrato com status ativo', () => {
        const contratos: ContratoLoja[] = [
          {
            id: 'c1',
            industria_codigo: 'IND-001',
            loja_codigo: 'LOJ-001',
            frequencia: 'SEMANAL',
            segunda: true,
            terca: false,
            quarta: false,
            quinta: false,
            sexta: false,
            sabado: false,
            domingo: false,
            data_inicio_vigencia: '2026-05-01',
            data_fim_vigencia: null,
            status: 'ativo'
          }
        ];

        const res = classificarParContratual({
          contratosDoPar: contratos,
          dataInicioOperacao: '2026-05-01'
        });

        assert.strictEqual(res.classificacao, 'JA_POSSUI_ATIVO');
        assert.strictEqual(res.contratoAtivo?.id, 'c1');
        assert.match(res.motivoClassificacao, /desde 2026-05-01/);
      });

      it('deve classificar como JA_POSSUI_SUSPENSO quando não houver ativo mas houver suspenso', () => {
        const contratos: ContratoLoja[] = [
          {
            id: 'c2',
            industria_codigo: 'IND-001',
            loja_codigo: 'LOJ-001',
            frequencia: 'SEMANAL',
            segunda: true,
            terca: false,
            quarta: false,
            quinta: false,
            sexta: false,
            sabado: false,
            domingo: false,
            data_inicio_vigencia: '2026-06-01',
            data_fim_vigencia: null,
            status: 'suspenso'
          }
        ];

        const res = classificarParContratual({
          contratosDoPar: contratos,
          dataInicioOperacao: '2026-06-01'
        });

        assert.strictEqual(res.classificacao, 'JA_POSSUI_SUSPENSO');
        assert.strictEqual(res.contratoSuspenso?.id, 'c2');
        assert.match(res.motivoClassificacao, /Requer revisão manual/);
      });

      it('deve classificar como INICIO_NAO_INFORMADO quando indústria não possuir data_inicio_operacao e não tiver contrato ativo/suspenso', () => {
        const res = classificarParContratual({
          contratosDoPar: [],
          dataInicioOperacao: null
        });

        assert.strictEqual(res.classificacao, 'INICIO_NAO_INFORMADO');
        assert.match(res.motivoClassificacao, /Data de início da operação não cadastrada/);
      });

      it('deve classificar como ELEGIVEL quando houver apenas contrato histórico encerrado e início de operação informado', () => {
        const contratos: ContratoLoja[] = [
          {
            id: 'c_enc',
            industria_codigo: 'IND-001',
            loja_codigo: 'LOJ-001',
            frequencia: 'SEMANAL',
            segunda: true,
            terca: false,
            quarta: false,
            quinta: false,
            sexta: false,
            sabado: false,
            domingo: false,
            data_inicio_vigencia: '2026-01-01',
            data_fim_vigencia: '2026-06-30',
            status: 'encerrado'
          }
        ];

        const res = classificarParContratual({
          contratosDoPar: contratos,
          dataInicioOperacao: '2026-07-01'
        });

        assert.strictEqual(res.classificacao, 'ELEGIVEL');
        assert.strictEqual(res.contratoAtivo, null);
        assert.strictEqual(res.contratoSuspenso, null);
        assert.strictEqual(res.contratoEncerrado?.id, 'c_enc');
        assert.match(res.motivoClassificacao, /Apto para futura formalização/);
      });
    });
  });
});


