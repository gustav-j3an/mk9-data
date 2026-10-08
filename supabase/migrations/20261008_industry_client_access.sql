-- ==============================================================================
-- MK9 COMMAND CENTER - IDENTIDADE E ISOLAMENTO RLS DO PORTAL DA INDÚSTRIA
-- Arquivo: supabase/migrations/20261008_industry_client_access.sql
-- Descrição: Adiciona coluna industria_codigo em public.profiles, nova role 'client_industry',
--            funções auxiliares de isolamento e políticas RLS de leitura restrita por indústria.
-- ==============================================================================

-- 1. ADICIONAR COLUNA industria_codigo EM public.profiles (SE NÃO EXISTIR)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'industria_codigo'
  ) THEN
    ALTER TABLE public.profiles 
    ADD COLUMN industria_codigo TEXT REFERENCES public.industrias(codigo) ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- 2. ATUALIZAR CONSTRAINT DE ROLE EM public.profiles PARA INCLUIR 'client_industry'
DO $$
BEGIN
  ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
  ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check 
    CHECK (role IN ('admin', 'gestor', 'operador', 'promotor', 'client_industry'));
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;

-- 3. FUNÇÃO AUXILIAR: OBTER A INDÚSTRIA DO USUÁRIO AUTENTICADO
CREATE OR REPLACE FUNCTION public.get_auth_industria_codigo()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT industria_codigo
  FROM public.profiles
  WHERE id = auth.uid();
$$;

-- 4. FUNÇÃO AUXILIAR: VERIFICAR SE É CLIENTE DE INDÚSTRIA
CREATE OR REPLACE FUNCTION public.is_client_industry()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid() AND role = 'client_industry'
  );
$$;

-- Garantir permissões de execução para os papeis autenticados
GRANT EXECUTE ON FUNCTION public.get_auth_industria_codigo() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_client_industry() TO authenticated;

-- ==============================================================================
-- 5. REFORÇO DE POLÍTICAS RLS PARA ROLE 'client_industry'
-- ==============================================================================

-- 5.1 TABELA public.industrias
DROP POLICY IF EXISTS "industrias_select_policy" ON public.industrias;
CREATE POLICY "industrias_select_policy"
  ON public.industrias
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin_or_gestor()
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'operador'
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'promotor'
    OR codigo = public.get_auth_industria_codigo()
  );

-- 5.2 TABELA public.lojas
DROP POLICY IF EXISTS "lojas_select_policy" ON public.lojas;
CREATE POLICY "lojas_select_policy"
  ON public.lojas
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin_or_gestor()
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'operador'
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'promotor'
    OR EXISTS (
      SELECT 1 FROM public.rotas r
      WHERE r.loja_codigo = lojas.codigo
        AND r.industria_codigo = public.get_auth_industria_codigo()
    )
  );

-- 5.3 TABELA public.promotores
DROP POLICY IF EXISTS "promotores_select_policy" ON public.promotores;
CREATE POLICY "promotores_select_policy"
  ON public.promotores
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin_or_gestor()
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'operador'
    OR matricula = public.get_auth_promotor_matricula()
    OR EXISTS (
      SELECT 1 FROM public.rotas r
      WHERE r.promotor_matricula = promotores.matricula
        AND r.industria_codigo = public.get_auth_industria_codigo()
    )
  );

-- 5.4 TABELA public.rotas
DROP POLICY IF EXISTS "rotas_select_policy" ON public.rotas;
CREATE POLICY "rotas_select_policy"
  ON public.rotas
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin_or_gestor()
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'operador'
    OR promotor_matricula = public.get_auth_promotor_matricula()
    OR industria_codigo = public.get_auth_industria_codigo()
  );

-- 5.5 TABELA public.visits
DROP POLICY IF EXISTS "visits_select_policy" ON public.visits;
CREATE POLICY "visits_select_policy"
  ON public.visits
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin_or_gestor()
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'operador'
    OR promotor_matricula = public.get_auth_promotor_matricula()
    OR industria_codigo = public.get_auth_industria_codigo()
  );

-- 5.6 TABELA public.visit_checklist_items
DROP POLICY IF EXISTS "visit_checklist_items_select_policy" ON public.visit_checklist_items;
CREATE POLICY "visit_checklist_items_select_policy"
  ON public.visit_checklist_items
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.visits v
      WHERE v.id = visit_checklist_items.visit_id
      AND (
        public.is_admin_or_gestor()
        OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'operador'
        OR v.promotor_matricula = public.get_auth_promotor_matricula()
        OR v.industria_codigo = public.get_auth_industria_codigo()
      )
    )
  );

-- 5.7 TABELA public.visit_photos
DROP POLICY IF EXISTS "visit_photos_select_policy" ON public.visit_photos;
CREATE POLICY "visit_photos_select_policy"
  ON public.visit_photos
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.visits v
      WHERE v.id = visit_photos.visit_id
      AND (
        public.is_admin_or_gestor()
        OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'operador'
        OR v.promotor_matricula = public.get_auth_promotor_matricula()
        OR v.industria_codigo = public.get_auth_industria_codigo()
      )
    )
  );

-- 5.8 TABELA public.visit_occurrences
DROP POLICY IF EXISTS "visit_occurrences_select_policy" ON public.visit_occurrences;
CREATE POLICY "visit_occurrences_select_policy"
  ON public.visit_occurrences
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.visits v
      WHERE v.id = visit_occurrences.visit_id
      AND (
        public.is_admin_or_gestor()
        OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'operador'
        OR v.promotor_matricula = public.get_auth_promotor_matricula()
        OR v.industria_codigo = public.get_auth_industria_codigo()
      )
    )
  );

-- 5.9 TABELA public.visit_product_validity
DROP POLICY IF EXISTS "visit_product_validity_select_policy" ON public.visit_product_validity;
CREATE POLICY "visit_product_validity_select_policy"
  ON public.visit_product_validity
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.visits v
      WHERE v.id = visit_product_validity.visit_id
      AND (
        public.is_admin_or_gestor()
        OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'operador'
        OR v.promotor_matricula = public.get_auth_promotor_matricula()
        OR v.industria_codigo = public.get_auth_industria_codigo()
      )
    )
  );
