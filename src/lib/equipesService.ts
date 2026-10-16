import { supabase } from './supabase';
import type { Equipe, EquipeStatus, CreateEquipeDTO, UpdateEquipeDTO } from '../types';

const normalizeOptionalCode = (value?: string | null): string | undefined => {
  if (value === undefined || value === null) return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.toUpperCase() : undefined;
};

/**
 * Filtros opcionais para listagem de equipes
 */
export interface ListEquipesFilters {
  status?: EquipeStatus | 'all';
  search?: string;
  regional?: string;
}

/**
 * Resposta padronizada para operações do serviço de equipes
 */
export interface ServiceResponse<T> {
  data: T | null;
  error: Error | null;
}

export const equipesService = {
  /**
   * Consulta o próximo código sugerido no padrão EQP-XXX por meio da função get_next_team_code().
   * AVISO IMPORTANTE: Não é uma reserva atômica de código; o código sugerido pode mudar
   * antes da persistência caso outra inserção ocorra concorrentemente.
   * Se o código for omitido na criação, o trigger de banco invocará generate_team_code() de forma atômica.
   */
  async getNextCode(): Promise<ServiceResponse<string>> {
    if (!supabase) {
      return { data: null, error: new Error('Cliente Supabase não inicializado.') };
    }

    try {
      const { data, error } = await supabase.rpc('get_next_team_code');

      if (error) {
        return { data: null, error: new Error(`Erro ao obter próximo código: ${error.message}`) };
      }

      return { data: (data as string) || null, error: null };
    } catch (err: any) {
      return { data: null, error: new Error(err?.message || 'Falha ao consultar get_next_team_code.') };
    }
  },

  /**
   * Lista as equipes cadastradas na tabela public.equipes com suporte a filtros opcionais.
   */
  async listEquipes(filters?: ListEquipesFilters): Promise<ServiceResponse<Equipe[]>> {
    if (!supabase) {
      return { data: null, error: new Error('Cliente Supabase não inicializado.') };
    }

    try {
      let query = supabase
        .from('equipes')
        .select('*')
        .order('nome', { ascending: true });

      if (filters?.status && filters.status !== 'all') {
        query = query.eq('status', filters.status);
      }

      if (filters?.regional && filters.regional !== 'all') {
        query = query.eq('regional', filters.regional);
      }

      if (filters?.search && filters.search.trim()) {
        const term = filters.search.trim();
        query = query.or(`nome.ilike.%${term}%,codigo.ilike.%${term}%,regional.ilike.%${term}%,supervisor_nome.ilike.%${term}%`);
      }

      const { data, error } = await query;

      if (error) {
        return { data: null, error: new Error(`Erro ao listar equipes: ${error.message}`) };
      }

      return { data: (data as Equipe[]) || [], error: null };
    } catch (err: any) {
      return { data: null, error: new Error(err?.message || 'Falha inesperada ao listar equipes.') };
    }
  },

  /**
   * Busca uma equipe individualmente pelo seu UUID id.
   */
  async getEquipeById(id: string): Promise<ServiceResponse<Equipe>> {
    if (!supabase) {
      return { data: null, error: new Error('Cliente Supabase não inicializado.') };
    }

    if (!id || !id.trim()) {
      return { data: null, error: new Error('ID da equipe é obrigatório.') };
    }

    try {
      const { data, error } = await supabase
        .from('equipes')
        .select('*')
        .eq('id', id.trim())
        .maybeSingle();

      if (error) {
        return { data: null, error: new Error(`Erro ao buscar equipe: ${error.message}`) };
      }

      if (!data) {
        return { data: null, error: new Error(`Equipe com ID ${id} não encontrada.`) };
      }

      return { data: data as Equipe, error: null };
    } catch (err: any) {
      return { data: null, error: new Error(err?.message || 'Falha inesperada ao buscar equipe por ID.') };
    }
  },

  /**
   * Cria uma nova equipe na tabela public.equipes.
   * Se o código manual for fornecido, ele é preservado (o trigger de banco aplica UPPER/TRIM).
   * Se for omitido ou vazio, o trigger set_equipe_codigo_trigger gera o código sequencial EQP-XXX automaticamente.
   */
  async createEquipe(dto: CreateEquipeDTO): Promise<ServiceResponse<Equipe>> {
    if (!supabase) {
      return { data: null, error: new Error('Cliente Supabase não inicializado.') };
    }

    if (!dto.nome || !dto.nome.trim()) {
      return { data: null, error: new Error('O nome da equipe é obrigatório.') };
    }

    try {
      const payload: Record<string, any> = {
        nome: dto.nome.trim(),
        regional: dto.regional ? dto.regional.trim() : null,
        supervisor_nome: dto.supervisor_nome ? dto.supervisor_nome.trim() : null,
        status: dto.status || 'ativa'
      };

      const normalizedCode = normalizeOptionalCode(dto.codigo);
      if (normalizedCode) {
        payload.codigo = normalizedCode;
      }

      const { data, error } = await supabase
        .from('equipes')
        .insert([payload])
        .select()
        .single();

      if (error) {
        return { data: null, error: new Error(`Erro ao cadastrar equipe: ${error.message}`) };
      }

      return { data: data as Equipe, error: null };
    } catch (err: any) {
      return { data: null, error: new Error(err?.message || 'Falha inesperada ao criar equipe.') };
    }
  },

  /**
   * Atualiza dados de uma equipe existente pelo id.
   */
  async updateEquipe(id: string, dto: UpdateEquipeDTO): Promise<ServiceResponse<Equipe>> {
    if (!supabase) {
      return { data: null, error: new Error('Cliente Supabase não inicializado.') };
    }

    if (!id || !id.trim()) {
      return { data: null, error: new Error('ID da equipe é obrigatório.') };
    }

    try {
      const payload: Record<string, any> = {};

      if (dto.nome !== undefined) {
        if (!dto.nome.trim()) {
          return { data: null, error: new Error('O nome da equipe não pode ser vazio.') };
        }
        payload.nome = dto.nome.trim();
      }

      if (dto.codigo !== undefined) {
        const normalizedCode = normalizeOptionalCode(dto.codigo);
        if (!normalizedCode) {
          return { data: null, error: new Error('O código da equipe não pode ser vazio se informado.') };
        }
        payload.codigo = normalizedCode;
      }

      if (dto.regional !== undefined) {
        payload.regional = dto.regional ? dto.regional.trim() : null;
      }

      if (dto.supervisor_nome !== undefined) {
        payload.supervisor_nome = dto.supervisor_nome ? dto.supervisor_nome.trim() : null;
      }

      if (dto.status !== undefined) {
        payload.status = dto.status;
      }

      if (Object.keys(payload).length === 0) {
        return { data: null, error: new Error('Nenhum dado informado para atualização.') };
      }

      const { data, error } = await supabase
        .from('equipes')
        .update(payload)
        .eq('id', id.trim())
        .select()
        .single();

      if (error) {
        return { data: null, error: new Error(`Erro ao atualizar equipe: ${error.message}`) };
      }

      return { data: data as Equipe, error: null };
    } catch (err: any) {
      return { data: null, error: new Error(err?.message || 'Falha inesperada ao atualizar equipe.') };
    }
  },

  /**
   * Arquiva uma equipe, respeitando o modelo de status ('arquivada').
   */
  async archiveEquipe(id: string): Promise<ServiceResponse<Equipe>> {
    return this.updateEquipe(id, { status: 'arquivada' });
  },

  /**
   * Lista os promotores reais vinculados a uma determinada equipe pelo nome (public.promotores.equipe).
   */
  async listPromotoresByEquipe(equipeNome: string): Promise<ServiceResponse<{ id: string; matricula: string; nome: string; cidade: string; uf: string; supervisor: string | null; status: string }[]>> {
    if (!supabase) {
      return { data: null, error: new Error('Cliente Supabase não inicializado.') };
    }

    if (!equipeNome || !equipeNome.trim()) {
      return { data: [], error: null };
    }

    try {
      const { data, error } = await supabase
        .from('promotores')
        .select('id, matricula, nome, cidade, uf, supervisor, status')
        .eq('equipe', equipeNome.trim())
        .order('nome', { ascending: true });

      if (error) {
        return { data: null, error: new Error(`Erro ao listar promotores da equipe: ${error.message}`) };
      }

      return { data: data || [], error: null };
    } catch (err: any) {
      return { data: null, error: new Error(err?.message || 'Falha inesperada ao consultar promotores da equipe.') };
    }
  },

  /**
   * Atualiza a equipe dos promotores selecionados em lote na tabela public.promotores.
   * Utiliza os IDs (UUIDs primários) dos promotores para garantir exatidão e sem ambiguidade.
   * Atualiza public.promotores.equipe para o nome exato da equipe de destino e atualiza updated_at.
   */
  async transferPromotoresToEquipe(
    promoterIds: string[],
    targetEquipeNome: string
  ): Promise<ServiceResponse<{ updatedCount: number }>> {
    if (!supabase) {
      return { data: null, error: new Error('Cliente Supabase não inicializado.') };
    }

    if (!promoterIds || promoterIds.length === 0) {
      return { data: null, error: new Error('Nenhum promotor selecionado para transferência.') };
    }

    if (!targetEquipeNome || !targetEquipeNome.trim()) {
      return { data: null, error: new Error('Equipe de destino é obrigatória.') };
    }

    try {
      const cleanTarget = targetEquipeNome.trim();
      const cleanIds = promoterIds.map((id) => id.trim()).filter(Boolean);

      if (cleanIds.length === 0) {
        return { data: null, error: new Error('Lista de IDs de promotores inválida.') };
      }

      const { data, error } = await supabase
        .from('promotores')
        .update({
          equipe: cleanTarget,
          updated_at: new Date().toISOString()
        })
        .in('id', cleanIds)
        .select('id');

      if (error) {
        return { data: null, error: new Error(`Erro ao transferir promotores: ${error.message}`) };
      }

      const updatedCount = data ? data.length : 0;
      if (updatedCount === 0 && cleanIds.length > 0) {
        return {
          data: null,
          error: new Error('Nenhum promotor pôde ser atualizado. Verifique se seu usuário tem permissão de escrita (Admin/Gestor) ou se os promotores existem.')
        };
      }

      return { data: { updatedCount }, error: null };
    } catch (err: any) {
      return { data: null, error: new Error(err?.message || 'Falha inesperada ao transferir promotores.') };
    }
  }
};
