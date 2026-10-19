import { supabase } from './supabase';
import type { Equipe, EquipeWithMetrics, EquipeStatus, CreateEquipeDTO, UpdateEquipeDTO } from '../types';

const normalizeOptionalCode = (value?: string | null): string | undefined => {
  if (value === undefined || value === null) return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.toUpperCase() : undefined;
};

/**
 * Normaliza o valor textual da equipe do promotor.
 * Valores vazios, nulos, apenas com espaços ou iguais a 'Nenhum' (case-insensitive) retornam null.
 */
export const normalizeEquipeNome = (value?: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === 'nenhum') return null;
  return trimmed;
};

/**
 * Função pura que calcula as métricas de promotores e PDVs distintos para cada equipe.
 * 
 * Regras:
 * 1. Mapeia cada promotor para sua equipe normalizada. Promotores com equipe nula, vazia ou 'Nenhum' são ignorados para equipes cadastradas.
 * 2. Cada promotor é contado uma única vez por equipe (usando matrícula ou ID único).
 * 3. As rotas são cruzadas pela matrícula do promotor. Cada loja (loja_codigo válido) é contabilizada uma única vez por equipe via Set.
 * 4. Múltiplos promotores da mesma equipe atendendo ao mesmo PDV não duplicam a contagem de PDVs da equipe.
 * 5. Lojas de promotores sem equipe não são atribuídas a nenhuma equipe.
 * 6. Equipes sem promotores ou sem rotas retornam métricas zeradas (0 promotores, 0 PDVs).
 */
export function calculateTeamsMetrics(
  equipes: Equipe[],
  promotores: Array<{ id?: string; matricula?: string | null; equipe?: string | null }>,
  rotas: Array<{ promotor_matricula?: string | null; loja_codigo?: string | null }>
): EquipeWithMetrics[] {
  if (!Array.isArray(equipes)) return [];

  // 1. Mapear promotores por equipe
  // Chave: equipeNome (em maiúsculas/normalizado para correspondência segura)
  // Valor: Set de matrículas únicas
  const teamPromoterMatriculas = new Map<string, Set<string>>();
  // Mapear também matrícula do promotor para sua equipe normalizada
  const promoterToTeamMap = new Map<string, string>();

  (promotores || []).forEach((p) => {
    const rawEquipe = normalizeEquipeNome(p.equipe);
    const matricula = (p.matricula || p.id || '').trim();
    if (!rawEquipe || !matricula) return;

    const normalizedEquipeKey = rawEquipe.toUpperCase();

    let set = teamPromoterMatriculas.get(normalizedEquipeKey);
    if (!set) {
      set = new Set<string>();
      teamPromoterMatriculas.set(normalizedEquipeKey, set);
    }
    set.add(matricula);
    promoterToTeamMap.set(matricula, normalizedEquipeKey);
  });

  // 2. Mapear PDVs distintos por equipe a partir de rotas
  // Chave: normalizedEquipeKey -> Set de loja_codigo únicos
  const teamPdvs = new Map<string, Set<string>>();

  (rotas || []).forEach((r) => {
    const matricula = (r.promotor_matricula || '').trim();
    const lojaCodigo = (r.loja_codigo || '').trim();
    if (!matricula || !lojaCodigo) return;

    const teamKey = promoterToTeamMap.get(matricula);
    if (!teamKey) return; // Rota de promotor sem equipe ou equipe desconhecida

    let set = teamPdvs.get(teamKey);
    if (!set) {
      set = new Set<string>();
      teamPdvs.set(teamKey, set);
    }
    set.add(lojaCodigo);
  });

  // 3. Montar lista de EquipeWithMetrics
  return equipes.map((eq) => {
    const key = (eq.nome || '').trim().toUpperCase();
    const promotoresCount = teamPromoterMatriculas.get(key)?.size || 0;
    const pdvsCount = teamPdvs.get(key)?.size || 0;

    return {
      ...eq,
      promotoresCount,
      pdvsCount
    };
  });
}

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
   * Busca equipes com métricas reais de promotores vinculados e PDVs distintos calculadas.
   * Executa a busca de promotores e rotas com paginação segura (tratando o limite de 1000 registros do PostgREST).
   */
  async fetchTeamsWithMetrics(filters?: ListEquipesFilters): Promise<ServiceResponse<EquipeWithMetrics[]>> {
    if (!supabase) {
      return { data: null, error: new Error('Cliente Supabase não inicializado.') };
    }

    try {
      // 1. Buscar equipes aplicando os filtros existentes
      const equipesRes = await this.listEquipes(filters);
      if (equipesRes.error || !equipesRes.data) {
        return { data: null, error: equipesRes.error };
      }
      const equipes = equipesRes.data;

      // 2. Buscar promotores com paginação defensiva
      const allPromotores: Array<{ id: string; matricula: string; equipe: string | null }> = [];
      const PAGE_SIZE = 1000;
      let pPage = 0;
      let hasMorePromotores = true;

      while (hasMorePromotores) {
        const from = pPage * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;

        const { data: pBatch, error: pErr } = await supabase
          .from('promotores')
          .select('id, matricula, equipe')
          .range(from, to);

        if (pErr) {
          return { data: null, error: new Error(`Erro ao consultar promotores para métricas: ${pErr.message}`) };
        }

        if (pBatch && pBatch.length > 0) {
          allPromotores.push(...pBatch);
          if (pBatch.length < PAGE_SIZE) {
            hasMorePromotores = false;
          } else {
            pPage++;
          }
        } else {
          hasMorePromotores = false;
        }
      }

      // 3. Buscar rotas com paginação defensiva
      const allRotas: Array<{ promotor_matricula: string; loja_codigo: string }> = [];
      let rPage = 0;
      let hasMoreRotas = true;

      while (hasMoreRotas) {
        const from = rPage * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;

        const { data: rBatch, error: rErr } = await supabase
          .from('rotas')
          .select('*')
          .range(from, to);

        if (rErr) {
          return { data: null, error: new Error(`Erro ao consultar rotas para métricas: ${rErr.message}`) };
        }

        if (rBatch && rBatch.length > 0) {
          const activeBatch = rBatch.filter((r: any) => !r.encerrada_em);
          allRotas.push(...activeBatch);
          if (rBatch.length < PAGE_SIZE) {
            hasMoreRotas = false;
          } else {
            rPage++;
          }
        } else {
          hasMoreRotas = false;
        }
      }

      // 4. Executar agregação pura em memória
      const teamsWithMetrics = calculateTeamsMetrics(equipes, allPromotores, allRotas);

      return { data: teamsWithMetrics, error: null };
    } catch (err: any) {
      return { data: null, error: new Error(err?.message || 'Falha inesperada ao calcular métricas de equipes.') };
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
  },

  /**
   * Lista promotores que não possuem equipe associada (disponíveis para alocação):
   * - equipe IS NULL
   * - equipe vazia ou contendo apenas espaços
   * - equipe igual ao valor legado 'Nenhum' (case-insensitive)
   */
  async listPromotoresDisponiveis(): Promise<ServiceResponse<{ id: string; matricula: string; nome: string; cidade: string; uf: string; supervisor: string | null; status: string }[]>> {
    if (!supabase) {
      return { data: null, error: new Error('Cliente Supabase não inicializado.') };
    }

    try {
      // Buscar promotores com equipe nula ou vazia. Como o PostgREST suporta filtro com .or():
      // 'equipe.is.null,equipe.eq.,equipe.ilike.nenhum'
      const { data, error } = await supabase
        .from('promotores')
        .select('id, matricula, nome, cidade, uf, supervisor, status, equipe')
        .or('equipe.is.null,equipe.eq.,equipe.ilike.nenhum')
        .order('nome', { ascending: true });

      if (error) {
        return { data: null, error: new Error(`Erro ao listar promotores disponíveis: ${error.message}`) };
      }

      // Filtragem defensiva adicional em memória para cobrir variações de espaços ('   ')
      const filtered = (data || []).filter((p) => {
        if (!p.equipe) return true;
        const clean = p.equipe.trim().toLowerCase();
        return clean === '' || clean === 'nenhum';
      }).map(({ equipe, ...rest }) => rest);

      return { data: filtered, error: null };
    } catch (err: any) {
      return { data: null, error: new Error(err?.message || 'Falha inesperada ao consultar promotores disponíveis.') };
    }
  },

  /**
   * Vincula promotores disponíveis (sem equipe) a uma equipe alvo.
   * Aplica verificação condicional contra race condition:
   * Garante que os promotores só sejam vinculados se ainda estiverem sem equipe (ou com equipe nula/vazia/'Nenhum'),
   * impedindo que uma atribuição simultânea feita por outro usuário seja sobrescrita inadvertidamente.
   */
  async vincularPromotoresAEquipe(
    promoterIds: string[],
    targetEquipeNome: string
  ): Promise<ServiceResponse<{ updatedCount: number; skippedCount: number }>> {
    if (!supabase) {
      return { data: null, error: new Error('Cliente Supabase não inicializado.') };
    }

    if (!promoterIds || promoterIds.length === 0) {
      return { data: null, error: new Error('Nenhum promotor selecionado para vinculação.') };
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

      // 1. Verificar o estado atual dos promotores selecionados para evitar condição de corrida
      const { data: currentRows, error: checkErr } = await supabase
        .from('promotores')
        .select('id, nome, equipe')
        .in('id', cleanIds);

      if (checkErr) {
        return { data: null, error: new Error(`Erro ao checar promotores antes de vincular: ${checkErr.message}`) };
      }

      // Separar os elegíveis (que continuam sem equipe) dos que já foram alocados
      const eligibleIds: string[] = [];
      let skippedCount = 0;

      (currentRows || []).forEach((row) => {
        const eq = row.equipe ? row.equipe.trim().toLowerCase() : '';
        if (!eq || eq === 'nenhum') {
          eligibleIds.push(row.id);
        } else {
          skippedCount++;
        }
      });

      if (eligibleIds.length === 0) {
        return {
          data: null,
          error: new Error('Nenhum dos promotores selecionados está mais disponível. Eles já foram alocados em outra equipe por outro usuário.')
        };
      }

      // 2. Atualizar somente os promotores elegíveis, sem alterar supervisor
      const { data: updatedData, error: updateErr } = await supabase
        .from('promotores')
        .update({
          equipe: cleanTarget,
          updated_at: new Date().toISOString()
        })
        .in('id', eligibleIds)
        .or('equipe.is.null,equipe.eq.,equipe.ilike.nenhum') // verificação atômica no UPDATE
        .select('id');

      if (updateErr) {
        return { data: null, error: new Error(`Erro ao vincular promotores à equipe: ${updateErr.message}`) };
      }

      const updatedCount = updatedData ? updatedData.length : 0;
      return { data: { updatedCount, skippedCount }, error: null };
    } catch (err: any) {
      return { data: null, error: new Error(err?.message || 'Falha inesperada ao vincular promotores.') };
    }
  }
};
