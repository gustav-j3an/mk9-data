-- ==============================================================================
-- MK9 COMMAND CENTER - PREVENÇÃO DE DUPLICIDADE CONCORRENTE EM VISITAS
-- Arquivo: supabase/migrations/20261006_add_visits_unique_constraint.sql
-- Descrição: Adiciona constraint UNIQUE em public.visits para a quadrupla:
--            (promotor_matricula, loja_codigo, industria_codigo, data_visita)
-- ==============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'visits_promotor_loja_industria_data_unique'
  ) THEN
    ALTER TABLE public.visits
    ADD CONSTRAINT visits_promotor_loja_industria_data_unique 
    UNIQUE (promotor_matricula, loja_codigo, industria_codigo, data_visita);
  END IF;
END $$;
