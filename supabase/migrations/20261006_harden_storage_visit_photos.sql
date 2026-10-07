-- ==============================================================================
-- MK9 COMMAND CENTER - MIGRAÇÃO DE REFORÇO DE SEGURANÇA NO STORAGE (visit-photos)
-- Arquivo: supabase/migrations/20261006_harden_storage_visit_photos.sql
-- Descrição: Restringe o RLS de storage.objects isolando por visita e matrícula do promotor.
-- ==============================================================================

-- 1. Remover políticas genéricas anteriores do bucket visit-photos
DROP POLICY IF EXISTS "Leitura de fotos do bucket por gestores e promotor" ON storage.objects;
DROP POLICY IF EXISTS "Upload de fotos no bucket por usuarios autenticados" ON storage.objects;
DROP POLICY IF EXISTS "Storage visit-photos select policy" ON storage.objects;
DROP POLICY IF EXISTS "Storage visit-photos insert policy" ON storage.objects;

-- 2. Política de SELECT no Storage Isolada por Visita / Promotor
-- Formato do path: 'visits/{visit_id}/{filename}'
CREATE POLICY "Storage visit-photos select policy"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'visit-photos'
    AND (
      -- Admin e Gestor podem visualizar qualquer foto do bucket
      public.is_admin_or_gestor()
      OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'operador'
      OR EXISTS (
        SELECT 1 FROM public.visits v
        WHERE v.id::text = (storage.foldername(name))[2]
        AND v.promotor_matricula = public.get_auth_promotor_matricula()
      )
    )
  );

-- 3. Política de INSERT no Storage Isolada por Visita / Promotor
CREATE POLICY "Storage visit-photos insert policy"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'visit-photos'
    AND (
      public.is_admin_or_gestor()
      OR EXISTS (
        SELECT 1 FROM public.visits v
        WHERE v.id::text = (storage.foldername(name))[2]
        AND v.promotor_matricula = public.get_auth_promotor_matricula()
      )
    )
  );

-- 4. Política de DELETE no Storage Exclusiva para Admin / Gestor
CREATE POLICY "Storage visit-photos delete policy"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'visit-photos'
    AND public.is_admin_or_gestor()
  );
