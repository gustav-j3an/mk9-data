import { supabase } from './supabase';
import type {
  Supervisor,
  SupervisorStatus,
  CreateSupervisorDTO,
  UpdateSupervisorDTO,
  ListSupervisoresFilters
} from '../types';

export interface ServiceResponse<T> {
  data: T | null;
  error: Error | null;
}

const normalizeOptionalCode = (value?: string | null): string | undefined => {
  if (value === undefined || value === null) return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.toUpperCase() : undefined;
};

export const supervisoresService = {
  /**
   * Consulta o próximo código sugerido no padrão SUP-XXX por meio da função get_next_supervisor_code().
   * AVISO IMPORTANTE: Não é uma reserva atômica de código; o código sugerido pode mudar
   * antes da persistência caso outra inserção ocorra concorrentemente.
   * Se o código for omitido na criação, o trigger de banco invocará generate_supervisor_code() de forma atômica.
   */
  async getNextCode(): Promise<ServiceResponse<string>> {
    if (!supabase) {
      return { data: null, error: new Error('Cliente Supabase não inicializado.') };
    }

    try {
      const { data, error } = await supabase.rpc('get_next_supervisor_code');

      if (error) {
        return { data: null, error: new Error(`Erro ao obter próximo código de supervisor: ${error.message}`) };
      }

      return { data: (data as string) || null, error: null };
    } catch (err: any) {
      return { data: null, error: new Error(err?.message || 'Falha ao consultar get_next_supervisor_code.') };
    }
  },

  /**
   * Lista supervisores cadastrados com filtros opcionais por status, busca textual e regional.
   */
  async listSupervisores(filters?: ListSupervisoresFilters): Promise<ServiceResponse<Supervisor[]>> {
    if (!supabase) {
      return { data: null, error: new Error('Cliente Supabase não inicializado.') };
    }

    try {
      let query = supabase
        .from('supervisores')
        .select('*')
        .order('nome', { ascending: true });

      if (filters?.status && filters.status !== 'all') {
        query = query.eq('status', filters.status);
      }

      if (filters?.regional) {
        query = query.eq('regional', filters.regional);
      }

      if (filters?.search) {
        const term = `%${filters.search.trim()}%`;
        query = query.or(`nome.ilike.${term},codigo.ilike.${term},regional.ilike.${term},email.ilike.${term}`);
      }

      const { data, error } = await query;

      if (error) {
        return { data: null, error: new Error(`Erro ao listar supervisores: ${error.message}`) };
      }

      return { data: (data as Supervisor[]) || [], error: null };
    } catch (err: any) {
      return { data: null, error: new Error(err?.message || 'Falha ao buscar supervisores.') };
    }
  },

  /**
   * Obtém um supervisor específico pelo ID.
   */
  async getSupervisorById(id: string): Promise<ServiceResponse<Supervisor>> {
    if (!supabase) {
      return { data: null, error: new Error('Cliente Supabase não inicializado.') };
    }

    try {
      const { data, error } = await supabase
        .from('supervisores')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error) {
        return { data: null, error: new Error(`Erro ao buscar supervisor: ${error.message}`) };
      }

      return { data: (data as Supervisor) || null, error: null };
    } catch (err: any) {
      return { data: null, error: new Error(err?.message || 'Falha ao obter supervisor.') };
    }
  },

  /**
   * Cria um novo supervisor. O código é gerado automaticamente pelo banco se omitido.
   */
  async createSupervisor(dto: CreateSupervisorDTO): Promise<ServiceResponse<Supervisor>> {
    if (!supabase) {
      return { data: null, error: new Error('Cliente Supabase não inicializado.') };
    }

    try {
      const payload: Record<string, any> = {
        nome: dto.nome.trim(),
        email: dto.email?.trim() || null,
        telefone: dto.telefone?.trim() || null,
        regional: dto.regional?.trim() || null,
        status: dto.status || 'ativo',
        user_id: dto.user_id || null
      };

      const normalizedCode = normalizeOptionalCode(dto.codigo);
      if (normalizedCode) {
        payload.codigo = normalizedCode;
      }

      const { data, error } = await supabase
        .from('supervisores')
        .insert(payload)
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          if (error.message.includes('codigo')) {
            return { data: null, error: new Error(`O código informado já está em uso por outro supervisor.`) };
          }
          if (error.message.includes('email')) {
            return { data: null, error: new Error(`Já existe um supervisor com este e-mail.`) };
          }
        }
        return { data: null, error: new Error(`Erro ao criar supervisor: ${error.message}`) };
      }

      return { data: (data as Supervisor) || null, error: null };
    } catch (err: any) {
      return { data: null, error: new Error(err?.message || 'Falha ao criar supervisor.') };
    }
  },

  /**
   * Atualiza os dados de um supervisor existente.
   */
  async updateSupervisor(id: string, dto: UpdateSupervisorDTO): Promise<ServiceResponse<Supervisor>> {
    if (!supabase) {
      return { data: null, error: new Error('Cliente Supabase não inicializado.') };
    }

    try {
      const payload: Record<string, any> = {};

      if (dto.nome !== undefined) payload.nome = dto.nome.trim();
      if (dto.email !== undefined) payload.email = dto.email?.trim() || null;
      if (dto.telefone !== undefined) payload.telefone = dto.telefone?.trim() || null;
      if (dto.regional !== undefined) payload.regional = dto.regional?.trim() || null;
      if (dto.status !== undefined) payload.status = dto.status;
      if (dto.user_id !== undefined) payload.user_id = dto.user_id || null;

      const normalizedCode = normalizeOptionalCode(dto.codigo);
      if (normalizedCode !== undefined) {
        payload.codigo = normalizedCode;
      }

      const { data, error } = await supabase
        .from('supervisores')
        .update(payload)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          if (error.message.includes('codigo')) {
            return { data: null, error: new Error(`O código informado já está em uso por outro supervisor.`) };
          }
          if (error.message.includes('email')) {
            return { data: null, error: new Error(`Já existe um supervisor com este e-mail.`) };
          }
        }
        return { data: null, error: new Error(`Erro ao atualizar supervisor: ${error.message}`) };
      }

      return { data: (data as Supervisor) || null, error: null };
    } catch (err: any) {
      return { data: null, error: new Error(err?.message || 'Falha ao atualizar supervisor.') };
    }
  },

  /**
   * Inativa um supervisor (exclusão lógica).
   */
  async inactivateSupervisor(id: string): Promise<ServiceResponse<Supervisor>> {
    return this.updateSupervisor(id, { status: 'inativo' });
  }
};

