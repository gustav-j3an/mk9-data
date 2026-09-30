-- ==============================================================================
-- MK9 COMMAND CENTER - MIGRAÇÃO DE PERFIS E SEGURANÇA BLINDADA (RBAC + RLS)
-- Com Trigger prevent_role_change() Ajustado para SQL Editor & Backend
-- Executar este SQL no SQL Editor do Supabase Dashboard (Totalmente Idempotente)
-- ==============================================================================

-- 1. Criar tabela public.profiles vinculada a auth.users com papel padrão 'operador'
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'operador' CHECK (role IN ('admin', 'gestor', 'operador')),
  department TEXT DEFAULT 'Operações MK9',
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Habilitar Row Level Security (RLS) na tabela profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 3. Função Auxiliar Segura (Evita Recursão Infinita em RLS)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM public.profiles 
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- 4. Função Trigger para Impedir Alteração de Papel por Usuários Não-Admins
-- Permite alterações administrativas via SQL Editor / Service Role (onde auth.uid() é NULL)
CREATE OR REPLACE FUNCTION public.prevent_role_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    -- Se for uma chamada de um usuário autenticado (auth.uid() IS NOT NULL) e ele NÃO for admin, bloqueia
    IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
      RAISE EXCEPTION 'Acesso Negado: Apenas administradores podem alterar o papel de permissão (role).';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 5. Recriar Trigger de Proteção de Role
DROP TRIGGER IF EXISTS check_role_change ON public.profiles;
CREATE TRIGGER check_role_change
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_role_change();

-- 6. Limpeza Idempotente de Políticas Existentes
DROP POLICY IF EXISTS "Permitir leitura de perfis para autenticados" ON public.profiles;
DROP POLICY IF EXISTS "Permitir criação do próprio perfil" ON public.profiles;
DROP POLICY IF EXISTS "Permitir atualização do próprio perfil" ON public.profiles;
DROP POLICY IF EXISTS "Permitir administradores alterarem qualquer perfil" ON public.profiles;

-- 7. Criação das Políticas de Segurança (RLS)

-- 7.1 Leitura: Usuários autenticados podem visualizar os perfis da equipe
CREATE POLICY "Permitir leitura de perfis para autenticados"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (true);

-- 7.2 Inserção: Cada usuário só pode inserir seu próprio registro inicial
CREATE POLICY "Permitir criação do próprio perfil"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

-- 7.3 Atualização Própria: Usuários podem atualizar seus dados cadastrais
-- Alterações no campo 'role' são bloqueadas pela trigger prevent_role_change()
CREATE POLICY "Permitir atualização do próprio perfil"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- 7.4 Atualização Admin: Administradores alteram qualquer perfil e alteram papéis via is_admin()
CREATE POLICY "Permitir administradores alterarem qualquer perfil"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 8. Função de Cadastro Seguro (SECURITY DEFINER + search_path seguro)
-- SEMPRE força papel 'operador' no cadastro, ignorando metadata externa
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name, role, department)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', SPLIT_PART(NEW.email, '@', 1)),
    'operador', -- SEMPRE força 'operador'
    'Operações MK9'
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    updated_at = NOW();
  RETURN NEW;
END;
$$;

-- 9. Recriar Trigger de Novo Usuário de forma Idempotente
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ==============================================================================
-- PROMOÇÃO MANUAL DO PRIMEIRO ADMINISTRADOR
-- Execute no SQL Editor após rodar este script:
--
-- UPDATE public.profiles 
-- SET role = 'admin' 
-- WHERE email = 'gustavj3anmk9@gmail.com';
-- ==============================================================================
