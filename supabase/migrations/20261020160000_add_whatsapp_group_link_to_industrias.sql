-- ==============================================================================
-- MK9 COMMAND CENTER - LINK DO GRUPO DO WHATSAPP POR INDÚSTRIA
-- Arquivo: supabase/migrations/20261020160000_add_whatsapp_group_link_to_industrias.sql
-- Descrição: Adiciona coluna opcional whatsapp_group_link na tabela industrias
--            para permitir abertura direta do grupo da indústria no WhatsApp.
-- ==============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'industrias' 
      AND column_name = 'whatsapp_group_link'
  ) THEN
    ALTER TABLE public.industrias 
    ADD COLUMN whatsapp_group_link TEXT DEFAULT NULL;
  END IF;
END $$;
