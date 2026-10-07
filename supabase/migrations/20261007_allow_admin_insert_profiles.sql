-- Migration: Permitir administradores criarem perfis de usuários convidados
-- Tabela: public.profiles

DROP POLICY IF EXISTS "Permitir administradores criarem perfis" ON public.profiles;

CREATE POLICY "Permitir administradores criarem perfis"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());
