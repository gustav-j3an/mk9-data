import { supabase } from './supabase';
import type {
  ContratoLoja,
  CreateContratoLojaDTO,
  UpdateContratoLojaDTO,
  RouteItem
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

  // Validação de Vigência
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

/**
 * Agrupa rotas existentes por (industria_codigo, loja_codigo) para auditoria e pré-visualização de carga.
 * Detecta conflitos de frequência e conta dias de atendimento.
 */
export function analyzeRotasForContracts(rotas: RouteItem[]): {
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
      promotoresEnvolvidos: Array.from(item.promotores)
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
   * Cria um novo contrato com validação de payload
   */
  async createContrato(
    payload: CreateContratoLojaDTO
  ): Promise<{ data: ContratoLoja | null; error: Error | null; isMigrationPending?: boolean }> {
    const val = validateContratoPayload(payload);
    if (!val.valid) {
      return { data: null, error: new Error(val.errors.join(' ')) };
    }

    if (!supabase) {
      return { data: null, error: new Error('Cliente Supabase não inicializado.') };
    }

    try {
      const visitasSemana = payload.frequencia === 'SEMANAL' ? (payload.visitas_por_semana || 1) : null;
      const cicloQuinzenal = payload.frequencia === 'QUINZENAL' ? (payload.ciclo_quinzenal || 'QUINZENAL_LIVRE') : null;

      const { data, error } = await supabase
        .from('contratos_lojas')
        .insert({
          industria_codigo: normalizeCode(payload.industria_codigo),
          loja_codigo: normalizeCode(payload.loja_codigo),
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
          data_inicio_vigencia: payload.data_inicio_vigencia,
          data_fim_vigencia: payload.data_fim_vigencia || null,
          status: payload.status || 'ativo',
          valor_por_visita: payload.valor_por_visita || null,
          origem: 'manual',
          observacao: payload.observacao || null
        })
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
