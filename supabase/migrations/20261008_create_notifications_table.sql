-- ==============================================================================
-- MK9 COMMAND CENTER - ETAPA 7.1: INFRAESTRUTURA DE NOTIFICAÇÕES PERSISTENTES
-- Arquivo: supabase/migrations/20261008_create_notifications_table.sql
-- ==============================================================================

-- 1. Criar Tabela public.notifications
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  promotor_matricula TEXT NULL,
  titulo TEXT NOT NULL,
  mensagem TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (
    tipo IN (
      'ruptura',
      'produto_vencido',
      'produto_3_dias',
      'produto_4_7_dias',
      'produto_8_30_dias',
      'visita_2h',
      'visita_nao_realizada',
      'rota_sem_atendimento',
      'baixa_aderencia',
      'aderencia_media'
    )
  ),
  prioridade TEXT NOT NULL CHECK (
    prioridade IN ('critico', 'atencao', 'pendente', 'resolvido')
  ),
  alert_fingerprint TEXT NOT NULL,
  link_action TEXT NULL,
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ NULL,

  -- Restrição UNIQUE para evitar duplicidade de alerta por destinatário
  CONSTRAINT unique_user_notification_fingerprint UNIQUE (user_id, alert_fingerprint)
);

-- 2. Índices de Desempenho
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications (user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON public.notifications (user_id, read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_fingerprint ON public.notifications (alert_fingerprint);

-- 3. Habilitar RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- 4. Remover políticas pré-existentes se houver
DROP POLICY IF EXISTS "notifications_select_policy" ON public.notifications;
DROP POLICY IF EXISTS "notifications_update_policy" ON public.notifications;

-- 5. RLS Policies
-- SELECT: Usuários autenticados podem visualizar somente suas próprias notificações (ou admins)
CREATE POLICY "notifications_select_policy"
  ON public.notifications
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid() OR public.is_admin()
  );

-- UPDATE: Usuário pode atualizar somente suas próprias notificações (para marcar como lida)
CREATE POLICY "notifications_update_policy"
  ON public.notifications
  FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid() OR public.is_admin()
  )
  WITH CHECK (
    user_id = auth.uid() OR public.is_admin()
  );

-- 6. Adicionar tabela à publicação do Supabase Realtime se existir
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;
