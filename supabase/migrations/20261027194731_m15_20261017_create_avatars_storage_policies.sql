-- ==============================================================================
-- MK9 COMMAND CENTER - POLÍTICAS DE SEGURANÇA STORAGE AVATARS (PRIVADO)
-- Arquivo: supabase/migrations/20261017_create_avatars_storage_policies.sql
-- Descrição: Políticas RLS mínimas para isolar o bucket privado 'avatars' por auth.uid().
-- ==============================================================================

-- 1. Limpar políticas de avatars se já existirem (idempotente, sem alterar a tabela)
DROP POLICY IF EXISTS "Avatars user select policy" ON storage.objects;
DROP POLICY IF EXISTS "Avatars user insert policy" ON storage.objects;
DROP POLICY IF EXISTS "Avatars user update policy" ON storage.objects;
DROP POLICY IF EXISTS "Avatars user delete policy" ON storage.objects;

-- 2. SELECT: Usuário autenticado consulta apenas o arquivo da própria pasta ({auth.uid()}/*)
-- Administradores e gestores também possuem visualização operacional
CREATE POLICY "Avatars user select policy"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_admin_or_gestor()
    )
  );

-- 3. INSERT: Usuário autenticado envia arquivo exclusivamente para a sua própria pasta
CREATE POLICY "Avatars user insert policy"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 4. UPDATE: Usuário autenticado pode substituir (upsert) apenas o arquivo da sua própria pasta
CREATE POLICY "Avatars user update policy"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 5. DELETE: Usuário autenticado pode remover apenas o arquivo da sua própria pasta
CREATE POLICY "Avatars user delete policy"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
