-- Migration: 20261020160000_add_whatsapp_group_link_to_industrias.sql
-- Descrição: Adiciona coluna nullable whatsapp_group_link à tabela public.industrias
-- Validação: Aceita apenas links oficiais no formato https://chat.whatsapp.com/[A-Za-z0-9_-]+ ou NULL.
-- Rejeita: wa.me, whatsapp://, outros domínios e strings malformadas.
-- Idempotente: pode ser executada com segurança sem erros caso já exista a coluna ou constraint.

DO $$
BEGIN
    -- 1. Adiciona a coluna whatsapp_group_link caso ainda não exista
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'industrias' 
          AND column_name = 'whatsapp_group_link'
    ) THEN
        ALTER TABLE public.industrias 
        ADD COLUMN whatsapp_group_link TEXT NULL;
    END IF;

    -- 2. Adiciona a constraint de validação de URL do grupo do WhatsApp
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.table_constraints 
        WHERE table_schema = 'public' 
          AND table_name = 'industrias' 
          AND constraint_name = 'chk_industrias_whatsapp_group_link'
    ) THEN
        ALTER TABLE public.industrias
        ADD CONSTRAINT chk_industrias_whatsapp_group_link
        CHECK (
            whatsapp_group_link IS NULL 
            OR whatsapp_group_link ~ '^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9_-]+$'
        );
    END IF;
END $$;
