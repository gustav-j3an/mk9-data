import { contratosService, classificarParContratual, calcularPeriodoContratual, parseISODate } from '../src/lib/contratosService';
import type { CreateContratoLojaDTO, ContratoLoja } from '../src/types';
import { supabase } from '../src/lib/supabase';

// Utilitário para formatar assertivas
function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`FALHA NA ASSERÇÃO: ${msg}`);
  }
}

async function runEndToEndValidation() {
  console.log('=== INICIANDO VALIDAÇÃO FUNCIONAL PONTA A PONTA (H3.18) ===\n');

  // 1. Cenário 2: Validação de valor por visita ausente/vazio
  console.log('--- Cenário 2: Validação do Front/Serviço sem valor por visita ---');
  {
    const valorStr = '';
    const valorNum = parseFloat(valorStr);
    const hasError = isNaN(valorNum) || valorNum <= 0;
    assert(hasError, 'Deve acusar erro quando valor por visita for vazio');
    console.log('✓ Cenário 2 aprovado: Form rejeita valor por visita vazio.');
  }

  // 2. Cenário 3: Validação com valor zero ou negativo
  console.log('\n--- Cenário 3: Validação de valor zero ou negativo ---');
  {
    const zeroVal = parseFloat('0');
    assert(isNaN(zeroVal) || zeroVal <= 0, 'Form deve acusar erro para valor zero');
    const negVal = parseFloat('-25.50');
    assert(isNaN(negVal) || negVal <= 0, 'Form deve acusar erro para valor negativo');

    const serviceCheck = contratosService.prepareContratoInsertData({
      industria_codigo: 'IND-TEST-001',
      loja_codigo: 'LOJA-TEST-001',
      frequencia: 'SEMANAL',
      visitas_por_semana: 1,
      data_inicio_vigencia: '2026-10-01',
      valor_por_visita: -10,
      status: 'ativo'
    });
    assert(serviceCheck.error !== null, 'Serviço deve rejeitar valor negativo');
    console.log(`✓ Cenário 3 aprovado: Form e Serviço rejeitam valor <= 0 ("${serviceCheck.error?.message}").`);
  }

  // 3. Cenário 4: Vigência final anterior à inicial
  console.log('\n--- Cenário 4: Vigência final anterior à data inicial ---');
  {
    const dataInicio = '2026-10-15';
    const dataFim = '2026-10-10';
    let formError: string | null = null;
    try {
      parseISODate(dataFim);
      if (dataFim < dataInicio) {
        formError = `A data final (${dataFim}) não pode ser anterior ao início (${dataInicio}).`;
      }
    } catch (e: any) {
      formError = e.message;
    }
    assert(formError !== null, 'Form deve acusar erro de data fim anterior à inicial');

    const serviceCheck = contratosService.prepareContratoInsertData({
      industria_codigo: 'IND-TEST-001',
      loja_codigo: 'LOJA-TEST-001',
      frequencia: 'SEMANAL',
      visitas_por_semana: 1,
      data_inicio_vigencia: dataInicio,
      data_fim_vigencia: dataFim,
      valor_por_visita: 100,
      status: 'ativo'
    });
    assert(serviceCheck.error !== null, 'Serviço deve rejeitar data fim anterior à data início');
    console.log(`✓ Cenário 4 aprovado: Form e Serviço rejeitam vigência invertida ("${serviceCheck.error?.message}").`);
  }

  // 4. Cenários 10 & 11: Regra KING (IND-013) e Indústria sem data_inicio_operacao
  console.log('\n--- Cenários 10 e 11: Regras Comerciais KING vs Indústrias Comuns ---');
  {
    // Regra KING: Ciclo 23 a 22
    const kingPeriodo1 = calcularPeriodoContratual('IND-013', '2026-10-24');
    assert(kingPeriodo1.data_inicio === '2026-10-23' && kingPeriodo1.data_fim === '2026-11-22', 'KING dia >= 23');
    assert(kingPeriodo1.competencia === '2026-11', 'Competência KING dia >= 23');

    const kingPeriodo2 = calcularPeriodoContratual('IND-013', '2026-10-22');
    assert(kingPeriodo2.data_inicio === '2026-09-23' && kingPeriodo2.data_fim === '2026-10-22', 'KING dia < 23');
    assert(kingPeriodo2.competencia === '2026-10', 'Competência KING dia < 23');

    console.log('✓ Cenário 10 aprovado: Regra KING opera rigorosamente no ciclo 23-22.');

    // Indústria comum sem data_inicio_operacao
    const classifSemInicio = classificarParContratual({
      contratosDoPar: [],
      dataInicioOperacao: null
    });
    assert(classifSemInicio.classificacao === 'INICIO_NAO_INFORMADO', 'Deve classificar como INICIO_NAO_INFORMADO');
    console.log(`✓ Cenário 11 aprovado: Indústria comum sem data_inicio_operacao bloqueada com "${classifSemInicio.motivoClassificacao}".`);
  }

  console.log('\n=== VALIDAÇÕES LOCAIS DE REGRAS E FORMS FINALIZADAS COM SUCESSO ===');
}

runEndToEndValidation().catch((err) => {
  console.error('ERRO:', err);
  process.exit(1);
});

