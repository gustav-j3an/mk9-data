-- ============================================================================
-- Migration: Add data_inicio_operacao to public.industrias
-- Arquivo: supabase/migrations/20261018150000_add_data_inicio_operacao_to_industrias.sql
-- Finalidade:
--   Adiciona o campo comercial data_inicio_operacao (DATE NULL) na tabela
--   public.industrias para definir formalmente a data de início da operação
--   de uma indústria atendida pela MK9, separando a data de negócio da data
--   técnica de criação de registro (created_at).
--
-- Regras de Negócio e Integridade:
--   - O campo é opcional (NULL), garantindo compatibilidade imediata com registros existentes.
--   - Não executa backfill fictício ou substituição automática por created_at / CURRENT_DATE.
--   - Indústria KING (IND-013) continua operando sob ciclo comercial contínuo 23-22
--     sem dependência estrita dessa data para sua regra de ciclo.
--   - Para as demais indústrias, quando informada, serve de base para o cálculo
--     pro-rata da primeira vigência da apuração.
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'industrias'
          AND column_name = 'data_inicio_operacao'
    ) THEN
        ALTER TABLE public.industrias
        ADD COLUMN data_inicio_operacao DATE NULL;

        COMMENT ON COLUMN public.industrias.data_inicio_operacao IS
            'Data comercial de início da operação da indústria junto à MK9. Utilizada para apuração do primeiro ciclo contratual (pro-rata).';
    END IF;
END $$;

