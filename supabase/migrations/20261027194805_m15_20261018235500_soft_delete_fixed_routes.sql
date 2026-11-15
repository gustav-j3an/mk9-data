-- Preserve operational history by closing fixed routes instead of deleting rows.
ALTER TABLE public.rotas
  ADD COLUMN IF NOT EXISTS encerrada_em TIMESTAMPTZ;

-- Permit the same assignment to be created again after its previous scale is closed.
ALTER TABLE public.rotas
  DROP CONSTRAINT IF EXISTS unique_rota_fixa_item;

ALTER TABLE public.rotas
  ADD COLUMN IF NOT EXISTS rota_ativa_chave TEXT
  GENERATED ALWAYS AS (
    CASE
      WHEN encerrada_em IS NULL
        THEN length(promotor_matricula)::TEXT || ':' || promotor_matricula
          || length(loja_codigo)::TEXT || ':' || loja_codigo
          || length(industria_codigo)::TEXT || ':' || industria_codigo
      ELSE NULL
    END
  ) STORED;

ALTER TABLE public.rotas
  DROP CONSTRAINT IF EXISTS unique_active_rota_assignment;
ALTER TABLE public.rotas
  ADD CONSTRAINT unique_active_rota_assignment UNIQUE (rota_ativa_chave);

-- Route changes remain restricted to administrators and managers. There is intentionally
-- no DELETE policy: the application closes a route and retains the original row.
DROP POLICY IF EXISTS "Permitir escrita de rotas para autenticados" ON public.rotas;
DROP POLICY IF EXISTS "rotas_write_policy" ON public.rotas;
DROP POLICY IF EXISTS "rotas_insert_policy" ON public.rotas;
DROP POLICY IF EXISTS "rotas_update_policy" ON public.rotas;

CREATE POLICY "rotas_insert_policy"
  ON public.rotas
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin_or_gestor());

CREATE POLICY "rotas_update_policy"
  ON public.rotas
  FOR UPDATE
  TO authenticated
  USING (public.is_admin_or_gestor() AND encerrada_em IS NULL)
  WITH CHECK (public.is_admin_or_gestor());
