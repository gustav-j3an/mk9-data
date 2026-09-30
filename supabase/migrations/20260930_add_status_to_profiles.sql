-- ==============================================================================
-- MK9 COMMAND CENTER - MIGRAÇÃO PARA ADICIONAR STATUS E EXPANDIR GESTÃO DE PERFIS
-- ==============================================================================

-- 1. Adicionar coluna status na tabela public.profiles se não existir
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'inativo'));

-- 2. Atualizar Trigger prevent_role_change para permitir admins alterarem papéis e bloqueios
CREATE OR REPLACE FUNCTION public.prevent_role_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
      RAISE EXCEPTION 'Acesso Negado: Apenas administradores podem alterar o papel de permissão (role).';
    END IF;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
      RAISE EXCEPTION 'Acesso Negado: Apenas administradores podem alterar o status de acesso.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 3. Atualizar função handle_new_user para incluir status
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name, role, department, status)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', SPLIT_PART(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'operador'),
    COALESCE(NEW.raw_user_meta_data->>'department', 'Operações MK9'),
    'ativo'
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    name = COALESCE(EXCLUDED.name, public.profiles.name),
    updated_at = NOW();
  RETURN NEW;
END;
$$;
