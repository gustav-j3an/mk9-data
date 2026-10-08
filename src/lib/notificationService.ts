import { supabase } from './supabase';
import type { AppNotification } from '../types';

export const notificationService = {
  /**
   * Buscar todas as notificações do usuário autenticado (RLS filtra por auth.uid())
   */
  async fetchNotifications(limit = 20): Promise<{ data: AppNotification[]; error: Error | null }> {
    if (!supabase) return { data: [], error: new Error('Supabase não inicializado') };

    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return { data: (data as AppNotification[]) || [], error: null };
    } catch (err: any) {
      console.error('Erro ao carregar notificações:', err);
      return { data: [], error: err };
    }
  },

  /**
   * Contar total de notificações não lidas do usuário autenticado
   */
  async getUnreadCount(): Promise<{ count: number; error: Error | null }> {
    if (!supabase) return { count: 0, error: new Error('Supabase não inicializado') };

    try {
      const { count, error } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('read', false);

      if (error) throw error;
      return { count: count || 0, error: null };
    } catch (err: any) {
      console.error('Erro ao contar notificações não lidas:', err);
      return { count: 0, error: err };
    }
  },

  /**
   * Marcar uma notificação específica como lida
   */
  async markAsRead(id: string): Promise<{ error: Error | null }> {
    if (!supabase) return { error: new Error('Supabase não inicializado') };

    try {
      const { error } = await supabase
        .from('notifications')
        .update({
          read: true,
          read_at: new Date().toISOString()
        })
        .eq('id', id);

      if (error) throw error;
      return { error: null };
    } catch (err: any) {
      console.error('Erro ao marcar notificação como lida:', err);
      return { error: err };
    }
  },

  /**
   * Marcar todas as notificações do usuário autenticado como lidas
   */
  async markAllAsRead(userId: string): Promise<{ error: Error | null }> {
    if (!supabase) return { error: new Error('Supabase não inicializado') };

    try {
      const { error } = await supabase
        .from('notifications')
        .update({
          read: true,
          read_at: new Date().toISOString()
        })
        .eq('user_id', userId)
        .eq('read', false);

      if (error) throw error;
      return { error: null };
    } catch (err: any) {
      console.error('Erro ao marcar todas as notificações como lidas:', err);
      return { error: err };
    }
  }
};
