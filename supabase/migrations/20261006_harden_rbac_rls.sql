-- ==============================================================================
-- MK9 COMMAND CENTER - MIGRAÇÃO DE REFORÇO DE SEGURANÇA (RBAC + RLS HARDEING)
-- Arquivo: supabase/migrations/20261006_harden_rbac_rls.sql
-- Descrição: Aplica controle rígido de segurança no nível do Supabase/PostgreSQL.
-- ==============================================================================

-- 1. FUNÇÕES AUXILIARES DE ROLE E VÍNCULO (SECURITY DEFINER + STABLE)

-- 1.1 Verificar se o usuário autenticado possui perfil 'admin' ou 'gestor'
CREATE OR REPLACE FUNCTION public.is_admin_or_gestor()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid() AND role IN ('admin', 'gestor')
  );
$$;

-- 1.2 Obter a matrícula do promotor vinculada ao perfil do usuário autenticado
CREATE OR REPLACE FUNCTION public.get_auth_promotor_matricula()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT promotor_matricula
  FROM public.profiles
  WHERE id = auth.uid();
$$;

-- ==============================================================================
-- 2. TABELA: public.industrias
-- ==============================================================================
ALTER TABLE public.industrias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir leitura de industrias para autenticados" ON public.industrias;
DROP POLICY IF EXISTS "Permitir escrita de industrias para autenticados" ON public.industrias;

-- SELECT: Todos autenticados podem visualizar indústrias
CREATE POLICY "industrias_select_policy"
  ON public.industrias
  FOR SELECT
  TO authenticated
  USING (true);

-- INSERT/UPDATE/DELETE: Apenas Admin e Gestor podem modificar
CREATE POLICY "industrias_write_policy"
  ON public.industrias
  FOR ALL
  TO authenticated
  USING (public.is_admin_or_gestor())
  WITH CHECK (public.is_admin_or_gestor());

-- ==============================================================================
-- 3. TABELA: public.lojas
-- ==============================================================================
ALTER TABLE public.lojas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir leitura de lojas para autenticados" ON public.lojas;
DROP POLICY IF EXISTS "Permitir escrita de lojas para autenticados" ON public.lojas;

-- SELECT: Todos autenticados podem visualizar lojas
CREATE POLICY "lojas_select_policy"
  ON public.lojas
  FOR SELECT
  TO authenticated
  USING (true);

-- INSERT/UPDATE/DELETE: Apenas Admin e Gestor podem modificar
CREATE POLICY "lojas_write_policy"
  ON public.lojas
  FOR ALL
  TO authenticated
  USING (public.is_admin_or_gestor())
  WITH CHECK (public.is_admin_or_gestor());

-- ==============================================================================
-- 4. TABELA: public.promotores
-- ==============================================================================
ALTER TABLE public.promotores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir leitura de promotores para autenticados" ON public.promotores;
DROP POLICY IF EXISTS "Permitir escrita de promotores para autenticados" ON public.promotores;

-- SELECT: Admin/Gestor/Operador leem todos; Promotor lê somente seu próprio cadastro de promotor
CREATE POLICY "promotores_select_policy"
  ON public.promotores
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin_or_gestor()
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'operador'
    OR matricula = public.get_auth_promotor_matricula()
  );

-- INSERT/UPDATE/DELETE: Apenas Admin e Gestor podem modificar promotores
CREATE POLICY "promotores_write_policy"
  ON public.promotores
  FOR ALL
  TO authenticated
  USING (public.is_admin_or_gestor())
  WITH CHECK (public.is_admin_or_gestor());

-- ==============================================================================
-- 5. TABELA: public.rotas (PRIORIDADE MÁXIMA - ISOLAMENTO DE PROMOTOR POR MATRÍCULA)
-- ==============================================================================
ALTER TABLE public.rotas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir leitura de rotas para autenticados" ON public.rotas;
DROP POLICY IF EXISTS "Permitir escrita de rotas para autenticados" ON public.rotas;

-- SELECT: Admin/Gestor/Operador leem todas; Promotor lê SOMENTE rotas da própria matrícula
CREATE POLICY "rotas_select_policy"
  ON public.rotas
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin_or_gestor()
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'operador'
    OR promotor_matricula = public.get_auth_promotor_matricula()
  );

-- INSERT/UPDATE/DELETE: Apenas Admin e Gestor podem modificar rotas
CREATE POLICY "rotas_write_policy"
  ON public.rotas
  FOR ALL
  TO authenticated
  USING (public.is_admin_or_gestor())
  WITH CHECK (public.is_admin_or_gestor());

-- ==============================================================================
-- 6. TABELA: public.import_history
-- ==============================================================================
ALTER TABLE public.import_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir leitura do historico para autenticados" ON public.import_history;
DROP POLICY IF EXISTS "Permitir insercao no historico para autenticados" ON public.import_history;

CREATE POLICY "import_history_select_policy"
  ON public.import_history
  FOR SELECT
  TO authenticated
  USING (public.is_admin_or_gestor());

CREATE POLICY "import_history_insert_policy"
  ON public.import_history
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin_or_gestor());

-- ==============================================================================
-- 7. TABELAS DE OPERAÇÃO DE CAMPO: visits, visit_checklist_items, visit_photos, visit_occurrences
-- ==============================================================================

-- 7.1 VISITS
ALTER TABLE public.visits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Visitas acessiveis por admin e gestor" ON public.visits;
DROP POLICY IF EXISTS "Promotor acessa apenas suas visitas" ON public.visits;

CREATE POLICY "visits_select_policy"
  ON public.visits
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin_or_gestor()
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'operador'
    OR promotor_matricula = public.get_auth_promotor_matricula()
  );

CREATE POLICY "visits_insert_policy"
  ON public.visits
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_admin_or_gestor()
    OR promotor_matricula = public.get_auth_promotor_matricula()
  );

CREATE POLICY "visits_update_policy"
  ON public.visits
  FOR UPDATE
  TO authenticated
  USING (
    public.is_admin_or_gestor()
    OR promotor_matricula = public.get_auth_promotor_matricula()
  )
  WITH CHECK (
    public.is_admin_or_gestor()
    OR promotor_matricula = public.get_auth_promotor_matricula()
  );

CREATE POLICY "visits_delete_policy"
  ON public.visits
  FOR DELETE
  TO authenticated
  USING (public.is_admin_or_gestor());

-- 7.2 VISIT_CHECKLIST_ITEMS
ALTER TABLE public.visit_checklist_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Checklist acessivel por gestores e promotor dono" ON public.visit_checklist_items;

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
      )
    )
  );

CREATE POLICY "visit_checklist_items_write_policy"
  ON public.visit_checklist_items
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.visits v
      WHERE v.id = visit_checklist_items.visit_id
      AND (
        public.is_admin_or_gestor()
        OR v.promotor_matricula = public.get_auth_promotor_matricula()
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.visits v
      WHERE v.id = visit_checklist_items.visit_id
      AND (
        public.is_admin_or_gestor()
        OR v.promotor_matricula = public.get_auth_promotor_matricula()
      )
    )
  );

-- 7.3 VISIT_PHOTOS
ALTER TABLE public.visit_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Fotos acessiveis por gestores e promotor dono" ON public.visit_photos;

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
      )
    )
  );

CREATE POLICY "visit_photos_write_policy"
  ON public.visit_photos
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.visits v
      WHERE v.id = visit_photos.visit_id
      AND (
        public.is_admin_or_gestor()
        OR v.promotor_matricula = public.get_auth_promotor_matricula()
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.visits v
      WHERE v.id = visit_photos.visit_id
      AND (
        public.is_admin_or_gestor()
        OR v.promotor_matricula = public.get_auth_promotor_matricula()
      )
    )
  );

-- 7.4 VISIT_OCCURRENCES
ALTER TABLE public.visit_occurrences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Ocorrencias acessiveis por gestores e promotor dono" ON public.visit_occurrences;

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
      )
    )
  );

CREATE POLICY "visit_occurrences_write_policy"
  ON public.visit_occurrences
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.visits v
      WHERE v.id = visit_occurrences.visit_id
      AND (
        public.is_admin_or_gestor()
        OR v.promotor_matricula = public.get_auth_promotor_matricula()
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.visits v
      WHERE v.id = visit_occurrences.visit_id
      AND (
        public.is_admin_or_gestor()
        OR v.promotor_matricula = public.get_auth_promotor_matricula()
      )
    )
  );

-- ==============================================================================
-- 8. STORAGE: BUCKET visit-photos
-- ==============================================================================
DROP POLICY IF EXISTS "Leitura de fotos do bucket por gestores e promotor" ON storage.objects;
DROP POLICY IF EXISTS "Upload de fotos no bucket por usuarios autenticados" ON storage.objects;
DROP POLICY IF EXISTS "Storage visit-photos select policy" ON storage.objects;
DROP POLICY IF EXISTS "Storage visit-photos insert policy" ON storage.objects;

CREATE POLICY "Storage visit-photos select policy"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'visit-photos');

CREATE POLICY "Storage visit-photos insert policy"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'visit-photos');
