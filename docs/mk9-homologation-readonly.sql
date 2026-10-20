-- Execute somente no banco DESTE aplicativo, nunca no banco do MK9.
-- Arquivo preparado para inspeção manual; não executado pelo Codex.
BEGIN TRANSACTION READ ONLY;

-- 1. Perfis ativos sem matrícula cadastrada (resultado esperado: nenhuma linha).
SELECT p.id AS profile_id, p.promotor_matricula
FROM public.profiles p
LEFT JOIN public.promotores pr ON pr.matricula = p.promotor_matricula
WHERE p.role = 'promotor' AND p.status = 'ativo' AND pr.id IS NULL;

-- 2. Contas ativas compartilhando a mesma matrícula (revisar todas as linhas).
SELECT promotor_matricula, count(*) AS active_profiles, array_agg(id) AS profile_ids
FROM public.profiles
WHERE role = 'promotor' AND status = 'ativo' AND promotor_matricula IS NOT NULL
GROUP BY promotor_matricula HAVING count(*) > 1;

-- 3. Matrículas que podem divergir por espaços ou zeros iniciais.
-- Não normalizar/alterar automaticamente: confirmar a identidade com o MK9.
SELECT matricula FROM public.promotores
WHERE matricula <> btrim(matricula) OR matricula = '' OR matricula ~ '^0';

-- 4. Promotores cuja equipe não resolve exatamente uma equipe local.
SELECT pr.matricula, pr.equipe, count(e.id) AS matching_teams
FROM public.promotores pr
LEFT JOIN public.equipes e
  ON e.codigo = pr.equipe OR lower(btrim(e.nome)) = lower(btrim(pr.equipe))
GROUP BY pr.id, pr.matricula, pr.equipe HAVING count(e.id) <> 1;

-- 5. Matriz real para preencher o mapeamento. Projeto MK9 não é inferido aqui.
SELECT e.codigo AS equipe_codigo, e.nome AS equipe_nome, e.status AS equipe_status,
       s.id AS supervisor_id, s.user_id AS supervisor_auth_user_id,
       s.status AS supervisor_status, p.role AS supervisor_profile_role,
       p.status AS supervisor_profile_status
FROM public.equipes e
LEFT JOIN public.supervisores s ON s.id = e.supervisor_id
LEFT JOIN public.profiles p ON p.id = s.user_id
ORDER BY e.codigo;

-- 6. Relação matrícula/equipe; comparar com o cadastro operacional MK9.
SELECT pr.matricula, pr.equipe, pr.status FROM public.promotores pr ORDER BY pr.matricula;

-- Não há INSERT, UPDATE, DELETE, DDL nem correção automática neste arquivo.
ROLLBACK;
