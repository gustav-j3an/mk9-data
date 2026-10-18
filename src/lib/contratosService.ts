import { supabase } from './supabase';
import type {
  ContratoLoja,
  CreateContratoLojaDTO,
  UpdateContratoLojaDTO,
  RouteItem,
  PeriodoContratual
} from '../types';

/**
 * Erro específico lançado quando a tabela public.contratos_lojas ainda não foi criada no banco remoto.
 */
export class MigrationPendingError extends Error {
  public readonly code = 'MIGRATION_PENDING';
  constructor(message = 'O módulo de contratos ainda não foi habilitado no banco de dados (tabela inexistente). Execute a migration correspondente.') {
    super(message);
    this.name = 'MigrationPendingError';
  }
}

/**
 * Normaliza e valida campos de código
 */
const normalizeCode = (val?: string | null): string => {
  return (val || '').trim().toUpperCase();
};

/**
 * Determina se uma vigência está ativa para uma data de referência (YYYY-MM-DD).
 */
export function isContratoVigente(
  contrato: Pick<ContratoLoja, 'status' | 'data_inicio_vigencia' | 'data_fim_vigencia'>,
  dataReferencia: string
): boolean {
  if (contrato.status !== 'ativo') return false;
  if (dataReferencia < contrato.data_inicio_vigencia) return false;
  if (contrato.data_fim_vigencia && dataReferencia > contrato.data_fim_vigencia) return false;
  return true;
}

/**
 * Valida se dois intervalos de vigência se sobrepõem.
 * Considera data_fim_vigencia null como infinito.
 * Períodos consecutivos (ex: A termina em 2026-10-31 e B começa em 2026-11-01) NÃO se sobrepõem.
 * Períodos onde A termina em D e B começa em D SE SOBREPÕEM (mesmo dia ativo para ambos).
 */
export function checkVigenciaOverlap(
  inicioA: string,
  fimA: string | null | undefined,
  inicioB: string,
  fimB: string | null | undefined
): boolean {
  const maxInicio = inicioA > inicioB ? inicioA : inicioB;
  const fimAEfetivo = fimA || '9999-12-31';
  const fimBEfetivo = fimB || '9999-12-31';
  const minFim = fimAEfetivo < fimBEfetivo ? fimAEfetivo : fimBEfetivo;

  return maxInicio <= minFim;
}

/**
 * Classificação comercial e elegibilidade de um par (indústria, loja) para autorização contratual.
 * Função pura e desacoplada de UI/React.
 */
export type ClassificacaoParContratual =
  | 'ERRO_CONSULTA'
  | 'JA_POSSUI_ATIVO'
  | 'JA_POSSUI_SUSPENSO'
  | 'INICIO_NAO_INFORMADO'
  | 'ELEGIVEL';

export function classificarParContratual(options: {
  contratosDoPar: ContratoLoja[];
  dataInicioOperacao?: string | null;
  contratosError?: string | null;
}): {
  classificacao: ClassificacaoParContratual;
  motivoClassificacao: string;
  contratoAtivo: ContratoLoja | null;
  contratoSuspenso: ContratoLoja | null;
  contratoEncerrado: ContratoLoja | null;
} {
  const { contratosDoPar, dataInicioOperacao, contratosError } = options;

  const contratoAtivo = contratosDoPar.find((c) => c.status === 'ativo') || null;
  const contratoSuspenso = contratosDoPar.find((c) => c.status === 'suspenso') || null;
  const contratoEncerrado = contratosDoPar.find((c) => c.status === 'encerrado') || null;
  const cadastroAusente = !dataInicioOperacao || !dataInicioOperacao.trim();

  let classificacao: ClassificacaoParContratual;
  let motivoClassificacao: string;

  if (contratosError) {
    classificacao = 'ERRO_CONSULTA';
    motivoClassificacao = 'Consulta de contratos indisponível. Elegibilidade bloqueada preventivamente.';
  } else if (contratoAtivo) {
    classificacao = 'JA_POSSUI_ATIVO';
    motivoClassificacao = `Já possui contrato ativo vigente desde ${contratoAtivo.data_inicio_vigencia}.`;
  } else if (contratoSuspenso) {
    classificacao = 'JA_POSSUI_SUSPENSO';
    motivoClassificacao = `Possui contrato suspenso desde ${contratoSuspenso.data_inicio_vigencia}. Requer revisão manual.`;
  } else if (cadastroAusente) {
    classificacao = 'INICIO_NAO_INFORMADO';
    motivoClassificacao = 'Data de início da operação não cadastrada na indústria. Regularize no cadastro.';
  } else {
    classificacao = 'ELEGIVEL';
    motivoClassificacao = 'Sem contrato ativo/suspenso. Apto para futura formalização.';
  }

  return {
    classificacao,
    motivoClassificacao,
    contratoAtivo,
    contratoSuspenso,
    contratoEncerrado
  };
}

/**
 * Função pura para validar regras de negócio do contrato antes de submeter ao banco
 */
export function validateContratoPayload(
  payload: CreateContratoLojaDTO | UpdateContratoLojaDTO
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if ('industria_codigo' in payload && !payload.industria_codigo?.trim()) {
    errors.push('O código da indústria é obrigatório.');
  }

  if ('loja_codigo' in payload && !payload.loja_codigo?.trim()) {
    errors.push('O código da loja é obrigatório.');
  }

  if (payload.frequencia && !['SEMANAL', 'QUINZENAL', 'MENSAL'].includes(payload.frequencia)) {
    errors.push('Frequência inválida. Valores aceitos: SEMANAL, QUINZENAL, MENSAL.');
  }

  // Coerência entre frequência, visitas_por_semana e ciclo_quinzenal
  if (payload.frequencia === 'SEMANAL') {
    if (payload.visitas_por_semana !== undefined && payload.visitas_por_semana !== null) {
      if (payload.visitas_por_semana < 1 || payload.visitas_por_semana > 7) {
        errors.push('Para frequência SEMANAL, a quantidade de visitas por semana deve estar entre 1 e 7.');
      }
    }
    if (payload.ciclo_quinzenal) {
      errors.push('Para frequência SEMANAL, o ciclo quinzenal não deve ser preenchido.');
    }
  } else if (payload.frequencia === 'QUINZENAL') {
    if (payload.visitas_por_semana !== undefined && payload.visitas_por_semana !== null) {
      errors.push('Para frequência QUINZENAL, não deve ser informado visitas_por_semana (o cálculo deve respeitar o ciclo de atendimento).');
    }
    const ciclosValidos = ['PAR_IMPAR', 'SEMANA_1_3', 'SEMANA_2_4', 'QUINZENAL_LIVRE'];
    if (!payload.ciclo_quinzenal) {
      errors.push('Para frequência QUINZENAL, o ciclo quinzenal é obrigatório.');
    } else if (!ciclosValidos.includes(payload.ciclo_quinzenal)) {
      errors.push(`Ciclo quinzenal inválido. Valores aceitos: ${ciclosValidos.join(', ')}.`);
    }
  } else if (payload.frequencia === 'MENSAL') {
    if (payload.visitas_por_semana !== undefined && payload.visitas_por_semana !== null) {
      errors.push('Para frequência MENSAL, não deve ser informado visitas_por_semana (o cálculo deve respeitar o ciclo de atendimento).');
    }
    if (payload.ciclo_quinzenal) {
      errors.push('Para frequência MENSAL, o ciclo quinzenal não deve ser preenchido.');
    }
  }

  // Validação de Vigência e Cálculo de Período
  if ('calcular_periodo' in payload && payload.calcular_periodo) {
    if (!payload.data_referencia?.trim()) {
      errors.push('Para cálculo automático de período contratual, a data de referência (data_referencia) é obrigatória.');
    }
  } else if ('data_inicio_vigencia' in payload && !payload.data_inicio_vigencia?.trim()) {
    // Para criação sem calcular_periodo, data_inicio_vigencia é obrigatória
    errors.push('A data de início da vigência é obrigatória quando o cálculo automático não for solicitado.');
  }

  if (payload.data_inicio_vigencia && payload.data_fim_vigencia) {
    if (payload.data_fim_vigencia < payload.data_inicio_vigencia) {
      errors.push('A data de término da vigência não pode ser anterior à data de início.');
    }
  }

  if (payload.valor_por_visita !== undefined && payload.valor_por_visita !== null) {
    if (payload.valor_por_visita < 0) {
      errors.push('O valor por visita não pode ser negativo.');
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export interface AnalyzeRotasOptions {
  data_referencia?: string;
  data_cadastro_map?: Record<string, string>; // industria_codigo -> data_cadastro (YYYY-MM-DD)
}

/**
 * Agrupa rotas existentes por (industria_codigo, loja_codigo) para auditoria e pré-visualização de carga.
 * Detecta conflitos de frequência e conta dias de atendimento.
 * Opcionalmente enriquece com a projeção do período contratual quando options.data_referencia for informada.
 */
export function analyzeRotasForContracts(
  rotas: RouteItem[],
  options?: AnalyzeRotasOptions
): {
  elegiveis: Array<{
    industria_codigo: string;
    loja_codigo: string;
    frequencia: 'SEMANAL' | 'QUINZENAL' | 'MENSAL';
    visitas_por_semana: number | null;
    segunda: boolean;
    terca: boolean;
    quarta: boolean;
    quinta: boolean;
    sexta: boolean;
    sabado: boolean;
    domingo: boolean;
    totalRotasVinculadas: number;
    promotoresEnvolvidos: string[];
    projecao_periodo?: PeriodoContratual;
  }>;
  conflitos: Array<{
    industria_codigo: string;
    loja_codigo: string;
    motivo: string;
    frequenciasEncontradas: string[];
    totalRotas: number;
  }>;
} {
  const map = new Map<
    string,
    {
      industria_codigo: string;
      loja_codigo: string;
      frequencias: Set<string>;
      segunda: boolean;
      terca: boolean;
      quarta: boolean;
      quinta: boolean;
      sexta: boolean;
      sabado: boolean;
      domingo: boolean;
      rotasCount: number;
      promotores: Set<string>;
    }
  >();

  (rotas || []).forEach((r) => {
    const ind = normalizeCode(r.industria_codigo);
    const loj = normalizeCode(r.loja_codigo);
    if (!ind || !loj) return;

    const groupKey = `${ind}|${loj}`;
    let item = map.get(groupKey);
    if (!item) {
      item = {
        industria_codigo: ind,
        loja_codigo: loj,
        frequencias: new Set<string>(),
        segunda: false,
        terca: false,
        quarta: false,
        quinta: false,
        sexta: false,
        sabado: false,
        domingo: false,
        rotasCount: 0,
        promotores: new Set<string>()
      };
      map.set(groupKey, item);
    }

    item.frequencias.add(r.frequencia || 'SEMANAL');
    if (r.segunda) item.segunda = true;
    if (r.terca) item.terca = true;
    if (r.quarta) item.quarta = true;
    if (r.quinta) item.quinta = true;
    if (r.sexta) item.sexta = true;
    if (r.sabado) item.sabado = true;
    if (r.domingo) item.domingo = true;
    item.rotasCount += 1;
    if (r.promotor_matricula) item.promotores.add(r.promotor_matricula);
  });

  const elegiveis: ReturnType<typeof analyzeRotasForContracts>['elegiveis'] = [];
  const conflitos: ReturnType<typeof analyzeRotasForContracts>['conflitos'] = [];

  map.forEach((item) => {
    const freqsArr = Array.from(item.frequencias);
    if (freqsArr.length > 1) {
      conflitos.push({
        industria_codigo: item.industria_codigo,
        loja_codigo: item.loja_codigo,
        motivo: 'Múltiplas rotas cadastradas com frequências divergentes para a mesma loja e indústria.',
        frequenciasEncontradas: freqsArr,
        totalRotas: item.rotasCount
      });
      return;
    }

    const freq = (freqsArr[0] || 'SEMANAL') as 'SEMANAL' | 'QUINZENAL' | 'MENSAL';
    let diasCount = 0;
    if (item.segunda) diasCount++;
    if (item.terca) diasCount++;
    if (item.quarta) diasCount++;
    if (item.quinta) diasCount++;
    if (item.sexta) diasCount++;
    if (item.sabado) diasCount++;
    if (item.domingo) diasCount++;

    let projecao: PeriodoContratual | undefined;
    if (options?.data_referencia) {
      const cad = options.data_cadastro_map ? options.data_cadastro_map[item.industria_codigo] : undefined;
      projecao = calcularPeriodoContratual(item.industria_codigo, options.data_referencia, cad);
    }

    elegiveis.push({
      industria_codigo: item.industria_codigo,
      loja_codigo: item.loja_codigo,
      frequencia: freq,
      visitas_por_semana: freq === 'SEMANAL' ? Math.max(1, diasCount) : null,
      segunda: item.segunda,
      terca: item.terca,
      quarta: item.quarta,
      quinta: item.quinta,
      sexta: item.sexta,
      sabado: item.sabado,
      domingo: item.domingo,
      totalRotasVinculadas: item.rotasCount,
      promotoresEnvolvidos: Array.from(item.promotores),
      ...(projecao ? { projecao_periodo: projecao } : {})
    });
  });

  return { elegiveis, conflitos };
}

/**
 * Função utilitária que detecta se um erro do PostgREST decorre da inexistência da tabela contratos_lojas
 */
export function isTableNotFoundError(err: any): boolean {
  if (!err) return false;
  const msg = String(err.message || err.details || '').toLowerCase();
  const code = String(err.code || '');
  return code === '42P01' || msg.includes('does not exist') || msg.includes('relation "public.contratos_lojas"');
}

/**
 * Serviço de acesso a dados para public.contratos_lojas
 */
export const contratosService = {
  /**
   * Lista todos os contratos com suporte a joins de industria e loja
   */
  async listContratos(filters?: {
    industria_codigo?: string;
    loja_codigo?: string;
    status?: string;
    frequencia?: string;
  }): Promise<{ data: ContratoLoja[]; error: Error | null; isMigrationPending?: boolean }> {
    if (!supabase) {
      return { data: [], error: new Error('Cliente Supabase não inicializado.') };
    }

    try {
      let query = supabase
        .from('contratos_lojas')
        .select(`
          *,
          industria:industrias(codigo, nome, cnpj),
          loja:lojas(codigo, nome, cidade, uf, rede)
        `)
        .order('data_inicio_vigencia', { ascending: false });

      if (filters?.industria_codigo && filters.industria_codigo !== 'todas') {
        query = query.eq('industria_codigo', filters.industria_codigo);
      }

      if (filters?.loja_codigo && filters.loja_codigo !== 'todas') {
        query = query.eq('loja_codigo', filters.loja_codigo);
      }

      if (filters?.status && filters.status !== 'todos') {
        query = query.eq('status', filters.status);
      }

      if (filters?.frequencia && filters.frequencia !== 'TODAS') {
        query = query.eq('frequencia', filters.frequencia);
      }

      const { data, error } = await query;
      if (error) {
        if (isTableNotFoundError(error)) {
          return { data: [], error: new MigrationPendingError(), isMigrationPending: true };
        }
        throw error;
      }

      return { data: (data as unknown as ContratoLoja[]) || [], error: null };
    } catch (err: any) {
      if (isTableNotFoundError(err)) {
        return { data: [], error: new MigrationPendingError(), isMigrationPending: true };
      }
      return { data: [], error: err };
    }
  },

  /**
   * Prepara e valida o objeto de inserção para public.contratos_lojas,
   * calculando o período contratual quando expressamente solicitado (calcular_periodo = true).
   * Garante que campos auxiliares de cálculo (calcular_periodo, data_referencia, data_cadastro, competencia)
   * NUNCA sejam enviados no payload SQL do Supabase.
   */
  prepareContratoInsertData(payload: CreateContratoLojaDTO): {
    data: {
      industria_codigo: string;
      loja_codigo: string;
      frequencia: ContratoLoja['frequencia'];
      visitas_por_semana: number | null;
      segunda: boolean;
      terca: boolean;
      quarta: boolean;
      quinta: boolean;
      sexta: boolean;
      sabado: boolean;
      domingo: boolean;
      ciclo_quinzenal: ContratoLoja['ciclo_quinzenal'] | null;
      data_inicio_vigencia: string;
      data_fim_vigencia: string | null;
      status: ContratoLoja['status'];
      valor_por_visita: number | null;
      origem: string;
      observacao: string | null;
    } | null;
    error: Error | null;
  } {
    const val = validateContratoPayload(payload);
    if (!val.valid) {
      return { data: null, error: new Error(val.errors.join(' ')) };
    }

    const indCodigo = normalizeCode(payload.industria_codigo);
    const lojCodigo = normalizeCode(payload.loja_codigo);

    let inicioVigencia = payload.data_inicio_vigencia;
    let fimVigencia = payload.data_fim_vigencia ?? null;

    if (payload.calcular_periodo) {
      if (!payload.data_referencia) {
        return {
          data: null,
          error: new Error('Para cálculo automático de período contratual, data_referencia é obrigatória.')
        };
      }

      // Se não for KING (IND-013), data_cadastro é obrigatória quando for primeiro ciclo ou para validar se é primeiro mês
      if (indCodigo !== 'IND-013') {
        if (!payload.data_cadastro || !payload.data_cadastro.trim()) {
          return {
            data: null,
            error: new Error(
              `Cálculo de competência para a indústria "${indCodigo}" exige a data efetiva de início da operação (data_inicio_operacao). Não é permitido inferir ou substituir silenciosamente por data atual.`
            )
          };
        }
      }

      try {
        const periodo = calcularPeriodoContratual(
          indCodigo,
          payload.data_referencia,
          payload.data_cadastro
        );
        inicioVigencia = periodo.data_inicio;
        fimVigencia = periodo.data_fim;
      } catch (calcErr: any) {
        return { data: null, error: calcErr };
      }
    }

    if (!inicioVigencia) {
      return {
        data: null,
        error: new Error('A data de início da vigência é obrigatória para criar o contrato.')
      };
    }

    const visitasSemana = payload.frequencia === 'SEMANAL' ? (payload.visitas_por_semana || 1) : null;
    const cicloQuinzenal = payload.frequencia === 'QUINZENAL' ? (payload.ciclo_quinzenal || 'QUINZENAL_LIVRE') : null;

    return {
      data: {
        industria_codigo: indCodigo,
        loja_codigo: lojCodigo,
        frequencia: payload.frequencia,
        visitas_por_semana: visitasSemana,
        segunda: Boolean(payload.segunda),
        terca: Boolean(payload.terca),
        quarta: Boolean(payload.quarta),
        quinta: Boolean(payload.quinta),
        sexta: Boolean(payload.sexta),
        sabado: Boolean(payload.sabado),
        domingo: Boolean(payload.domingo),
        ciclo_quinzenal: cicloQuinzenal,
        data_inicio_vigencia: inicioVigencia,
        data_fim_vigencia: fimVigencia,
        status: payload.status || 'ativo',
        valor_por_visita: payload.valor_por_visita ?? null,
        origem: 'manual',
        observacao: payload.observacao ?? null
      },
      error: null
    };
  },

  /**
   * Cria um novo contrato com validação de payload e integração com cálculo de período contratual
   */
  async createContrato(
    payload: CreateContratoLojaDTO
  ): Promise<{ data: ContratoLoja | null; error: Error | null; isMigrationPending?: boolean }> {
    const prepared = contratosService.prepareContratoInsertData(payload);
    if (prepared.error || !prepared.data) {
      return { data: null, error: prepared.error };
    }

    if (!supabase) {
      return { data: null, error: new Error('Cliente Supabase não inicializado.') };
    }

    try {
      const { data, error } = await supabase
        .from('contratos_lojas')
        .insert(prepared.data)
        .select(`
          *,
          industria:industrias(codigo, nome, cnpj),
          loja:lojas(codigo, nome, cidade, uf, rede)
        `)
        .single();

      if (error) {
        if (isTableNotFoundError(error)) {
          return { data: null, error: new MigrationPendingError(), isMigrationPending: true };
        }
        throw error;
      }
      return { data: data as unknown as ContratoLoja, error: null };
    } catch (err: any) {
      if (isTableNotFoundError(err)) {
        return { data: null, error: new MigrationPendingError(), isMigrationPending: true };
      }
      return { data: null, error: err };
    }
  },

  /**
   * Atualiza um contrato existente
   */
  async updateContrato(
    id: string,
    payload: UpdateContratoLojaDTO
  ): Promise<{ data: ContratoLoja | null; error: Error | null; isMigrationPending?: boolean }> {
    const val = validateContratoPayload(payload);
    if (!val.valid) {
      return { data: null, error: new Error(val.errors.join(' ')) };
    }

    if (!supabase) {
      return { data: null, error: new Error('Cliente Supabase não inicializado.') };
    }

    try {
      const updateData: any = { ...payload };
      if (payload.frequencia && payload.frequencia !== 'SEMANAL') {
        updateData.visitas_por_semana = null;
      }
      if (payload.frequencia && payload.frequencia !== 'QUINZENAL') {
        updateData.ciclo_quinzenal = null;
      }

      const { data, error } = await supabase
        .from('contratos_lojas')
        .update(updateData)
        .eq('id', id)
        .select(`
          *,
          industria:industrias(codigo, nome, cnpj),
          loja:lojas(codigo, nome, cidade, uf, rede)
        `)
        .single();

      if (error) {
        if (isTableNotFoundError(error)) {
          return { data: null, error: new MigrationPendingError(), isMigrationPending: true };
        }
        throw error;
      }
      return { data: data as unknown as ContratoLoja, error: null };
    } catch (err: any) {
      if (isTableNotFoundError(err)) {
        return { data: null, error: new MigrationPendingError(), isMigrationPending: true };
      }
      return { data: null, error: err };
    }
  },

  /**
   * Executa a procedure segura de conciliação / carga inicial a partir das rotas
   */
  async runSyncFromRotas(): Promise<{
    result: { total_rotas_analisadas: number; contratos_criados: number; rotas_conflitantes_ignoradas: number } | null;
    error: Error | null;
    isMigrationPending?: boolean;
  }> {
    if (!supabase) {
      return { result: null, error: new Error('Cliente Supabase não inicializado.') };
    }

    try {
      const { data, error } = await supabase.rpc('sync_contratos_from_rotas');
      if (error) {
        if (isTableNotFoundError(error)) {
          return { result: null, error: new MigrationPendingError(), isMigrationPending: true };
        }
        throw error;
      }

      const firstRow = Array.isArray(data) ? data[0] : data;
      return { result: firstRow, error: null };
    } catch (err: any) {
      if (isTableNotFoundError(err)) {
        return { result: null, error: new MigrationPendingError(), isMigrationPending: true };
      }
      return { result: null, error: err };
    }
  }
};

/**
 * Utilitários puros de manipulação de data sem dependência de fuso horário.
 * Trabalham exclusivamente com aritmética de inteiros (ano, mês, dia).
 */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function getLastDayOfMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  if ([4, 6, 9, 11].includes(month)) {
    return 30;
  }
  return 31;
}

export function parseISODate(dateStr: string): { year: number; month: number; day: number } {
  if (typeof dateStr !== 'string') {
    throw new Error(`Data deve ser uma string no formato YYYY-MM-DD. Recebido: ${typeof dateStr}`);
  }
  const match = dateStr.trim().match(/^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
  if (!match) {
    throw new Error(`Formato de data inválido: "${dateStr}". Esperado formato estrito YYYY-MM-DD.`);
  }

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);

  const maxDays = getLastDayOfMonth(year, month);
  if (day > maxDays) {
    throw new Error(`Data calendário impossível: "${dateStr}". O mês ${month}/${year} possui no máximo ${maxDays} dias.`);
  }

  return { year, month, day };
}

export function formatISODate(year: number, month: number, day: number): string {
  const y = String(year).padStart(4, '0');
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Calcula o período contratual (início, fim e competência) com base no código da indústria e na data de referência.
 * 
 * Regras:
 * 1. KING (identificada EXCLUSIVAMENTE pelo código 'IND-013'):
 *    - Ciclo do dia 23 de um mês ao dia 22 do mês subsequente.
 *    - Se dia >= 23: vigência de 23/Mês até 22/(Mês+1). Competência é Mês+1.
 *    - Se dia < 23: vigência de 23/(Mês-1) até 22/Mês. Competência é Mês.
 * 
 * 2. Demais indústrias:
 *    - Primeiro ciclo: se fornecida dataCadastro e a referência estiver no mesmo mês de cadastro,
 *      a vigência começa na dataCadastro e vai até o último dia daquele mês (pro-rata).
 *    - Ciclos subsequentes ou padrão: vigência do dia 01 ao último dia do mês de referência.
 */
export function calcularPeriodoContratual(
  industriaCodigo: string,
  dataReferencia: string,
  dataCadastro?: string | null
): PeriodoContratual {
  const codigo = normalizeCode(industriaCodigo);
  if (!codigo) {
    throw new Error('Código da indústria é obrigatório.');
  }

  const ref = parseISODate(dataReferencia);

  // 1. Regra KING (IND-013)
  if (codigo === 'IND-013') {
    let inicioYear: number;
    let inicioMonth: number;
    let fimYear: number;
    let fimMonth: number;
    let competenciaYear: number;
    let competenciaMonth: number;

    if (ref.day >= 23) {
      // Começa dia 23 do mês atual, vai até dia 22 do próximo mês
      inicioYear = ref.year;
      inicioMonth = ref.month;

      if (ref.month === 12) {
        fimYear = ref.year + 1;
        fimMonth = 1;
      } else {
        fimYear = ref.year;
        fimMonth = ref.month + 1;
      }
      competenciaYear = fimYear;
      competenciaMonth = fimMonth;
    } else {
      // Começa dia 23 do mês anterior, vai até dia 22 do mês atual
      if (ref.month === 1) {
        inicioYear = ref.year - 1;
        inicioMonth = 12;
      } else {
        inicioYear = ref.year;
        inicioMonth = ref.month - 1;
      }
      fimYear = ref.year;
      fimMonth = ref.month;
      competenciaYear = ref.year;
      competenciaMonth = ref.month;
    }

    const data_inicio = formatISODate(inicioYear, inicioMonth, 23);
    const data_fim = formatISODate(fimYear, fimMonth, 22);
    const compStr = `${String(competenciaYear).padStart(4, '0')}-${String(competenciaMonth).padStart(2, '0')}`;

    return {
      data_inicio,
      data_fim,
      competencia: compStr,
      industria_codigo: codigo,
      tipo_ciclo: 'ESPECIAL_KING_23_22'
    };
  }

  // 2. Demais Indústrias (Mensal Padrão ou Primeiro Ciclo Pro-Rata)
  let dataInicioStr: string;
  let tipoCiclo: 'MENSAL_PADRAO' | 'PRIMEIRA_VIGENCIA_PRO_RATA' = 'MENSAL_PADRAO';

  if (dataCadastro && dataCadastro.trim() !== '') {
    const cad = parseISODate(dataCadastro);
    const refDateFormatted = formatISODate(ref.year, ref.month, ref.day);
    const cadDateFormatted = formatISODate(cad.year, cad.month, cad.day);

    if (refDateFormatted < cadDateFormatted) {
      throw new Error(
        `Data de referência (${refDateFormatted}) não pode ser anterior à data de cadastro (${cadDateFormatted}).`
      );
    }

    // Se a referência estiver no mesmo ano e mês do cadastro:
    if (ref.year === cad.year && ref.month === cad.month) {
      dataInicioStr = cadDateFormatted;
      if (cad.day > 1) {
        tipoCiclo = 'PRIMEIRA_VIGENCIA_PRO_RATA';
      }
    } else {
      // Meses subsequentes ao cadastro
      dataInicioStr = formatISODate(ref.year, ref.month, 1);
    }
  } else {
    // Sem data de cadastro informada: ciclo padrão mês cheio
    dataInicioStr = formatISODate(ref.year, ref.month, 1);
  }

  const lastDay = getLastDayOfMonth(ref.year, ref.month);
  const dataFimStr = formatISODate(ref.year, ref.month, lastDay);
  const compStr = `${String(ref.year).padStart(4, '0')}-${String(ref.month).padStart(2, '0')}`;

  return {
    data_inicio: dataInicioStr,
    data_fim: dataFimStr,
    competencia: compStr,
    industria_codigo: codigo,
    tipo_ciclo: tipoCiclo
  };
}
