import { supabase } from './supabase';
import type { OperationMode, SystemSettingsState, SystemSettingsAuditRecord } from '../types';

/**
 * Busca as configurações operacionais ativas do sistema MK9.
 * Se houver qualquer falha ou cliente não configurado, retorna explicitamente
 * o estado 'DESCONHECIDO' com status 'error', SEM assumir silenciosamente qualquer modo.
 */
export async function fetchSystemSettings(): Promise<SystemSettingsState> {
  if (!supabase) {
    return {
      mode: 'DESCONHECIDO',
      officialStartDate: null,
      status: 'error',
      error: 'Cliente Supabase não inicializado.'
    };
  }

  try {
    const { data, error } = await supabase
      .from('system_settings')
      .select('key, value, updated_at, updated_by');

    if (error) {
      return {
        mode: 'DESCONHECIDO',
        officialStartDate: null,
        status: 'error',
        error: `Erro ao consultar system_settings: ${error.message}`
      };
    }

    if (!data || data.length === 0) {
      return {
        mode: 'DESCONHECIDO',
        officialStartDate: null,
        status: 'error',
        error: 'Tabela system_settings vazia ou sem registros de configuração.'
      };
    }

    const modeRow = data.find((row) => row.key === 'operation_mode');
    const dateRow = data.find((row) => row.key === 'official_start_date');

    if (!modeRow) {
      return {
        mode: 'DESCONHECIDO',
        officialStartDate: null,
        status: 'error',
        error: 'Chave operation_mode não encontrada nas configurações.'
      };
    }

    // Extrair modo
    let rawMode: string = typeof modeRow.value === 'string' ? modeRow.value : String(modeRow.value);
    // Remover aspas extras se foi armazenado como JSON string formatada
    if (rawMode.startsWith('"') && rawMode.endsWith('"')) {
      rawMode = rawMode.slice(1, -1);
    }

    if (rawMode !== 'IMPLANTACAO' && rawMode !== 'OPERACAO_OFICIAL') {
      return {
        mode: 'DESCONHECIDO',
        officialStartDate: null,
        status: 'error',
        error: `Valor inválido para operation_mode no banco: "${rawMode}".`
      };
    }

    const mode: OperationMode = rawMode;

    // Extrair data oficial
    let officialStartDate: string | null = null;
    if (dateRow && dateRow.value !== null && dateRow.value !== undefined && dateRow.value !== 'null') {
      let rawDate: string = typeof dateRow.value === 'string' ? dateRow.value : String(dateRow.value);
      if (rawDate.startsWith('"') && rawDate.endsWith('"')) {
        rawDate = rawDate.slice(1, -1);
      }
      if (rawDate && rawDate !== 'null') {
        officialStartDate = rawDate;
      }
    }

    return {
      mode,
      officialStartDate,
      status: 'loaded',
      error: null,
      updatedAt: modeRow.updated_at,
      updatedBy: modeRow.updated_by
    };
  } catch (err: any) {
    return {
      mode: 'DESCONHECIDO',
      officialStartDate: null,
      status: 'error',
      error: err?.message || 'Exceção inesperada ao buscar system_settings.'
    };
  }
}

/**
 * Atualiza o modo operacional e a data oficial atomicamente via RPC segura do PostgreSQL.
 * Apenas usuários autenticados com papel ADMIN no banco conseguem executar.
 */
export async function updateOperationMode({
  newMode,
  officialStartDate = null,
  justification
}: {
  newMode: OperationMode;
  officialStartDate?: string | null;
  justification: string;
}): Promise<{ success: boolean; data?: any; error: Error | null }> {
  if (!supabase) {
    return { success: false, error: new Error('Cliente Supabase não inicializado.') };
  }

  // Validação preliminar client-side (redundante à validação obrigatória do banco)
  if (!justification || justification.trim().length < 5) {
    return {
      success: false,
      error: new Error('Justificativa obrigatória (mínimo de 5 caracteres).')
    };
  }

  if (newMode === 'OPERACAO_OFICIAL' && !officialStartDate) {
    return {
      success: false,
      error: new Error('Data de início oficial é obrigatória para ativar OPERAÇÃO OFICIAL.')
    };
  }

  try {
    const { data, error } = await supabase.rpc('set_operation_mode', {
      p_new_mode: newMode,
      p_official_start_date: officialStartDate || null,
      p_justification: justification.trim()
    });

    if (error) {
      return { success: false, error: new Error(error.message) };
    }

    return { success: true, data, error: null };
  } catch (err: any) {
    return { success: false, error: new Error(err?.message || 'Falha na chamada RPC set_operation_mode.') };
  }
}

/**
 * Consulta o log de auditoria permanente de alterações do sistema.
 * Permitido apenas para perfis ADMIN e GESTOR.
 */
export async function fetchSystemSettingsAuditLog(
  limit = 50
): Promise<{ data: SystemSettingsAuditRecord[]; error: Error | null }> {
  if (!supabase) {
    return { data: [], error: new Error('Cliente Supabase não inicializado.') };
  }

  try {
    const { data, error } = await supabase
      .from('system_settings_audit_log')
      .select('*')
      .order('changed_at', { ascending: false })
      .limit(limit);

    if (error) {
      return { data: [], error: new Error(error.message) };
    }

    return { data: (data as SystemSettingsAuditRecord[]) || [], error: null };
  } catch (err: any) {
    return { data: [], error: new Error(err?.message || 'Falha ao buscar histórico de auditoria.') };
  }
}
