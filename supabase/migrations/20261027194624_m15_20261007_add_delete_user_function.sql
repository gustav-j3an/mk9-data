-- Migration: Função segura de exclusão de usuários para Administradores
-- Schema: public

CREATE OR REPLACE FUNCTION public.delete_user_by_admin(target_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  -- 1. Validar se o chamador é um administrador ativo
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso Negado: Apenas administradores podem excluir usuários.';
  END IF;

  -- 2. Impedir que o administrador exclua a própria conta em uso
  IF target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Não é possível excluir o próprio usuário logado.';
  END IF;

  -- 3. Desvincular de histórico de importações para preservar registros sem violar a FK
  UPDATE public.import_history
  SET imported_by_id = NULL
  WHERE imported_by_id = target_user_id;

  -- 4. Excluir perfil de public.profiles
  DELETE FROM public.profiles WHERE id = target_user_id;

  -- 5. Excluir conta de auth.users
  DELETE FROM auth.users WHERE id = target_user_id;
END;
$$;

-- Garantir permissão de execução para usuários autenticados (a validação interna checa is_admin)
GRANT EXECUTE ON FUNCTION public.delete_user_by_admin(UUID) TO authenticated;
