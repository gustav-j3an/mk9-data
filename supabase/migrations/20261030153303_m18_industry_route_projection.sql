BEGIN;
-- Deliberate scoped definer projection: clients cannot read raw sensitive tables.
-- Append closure metadata so the portal preserves logical route closure filtering.
CREATE OR REPLACE VIEW public.industry_routes WITH(security_barrier=true) AS
SELECT r.id,r.codigo_rota,(to_jsonb(r)->>'data')::date AS data,
 (to_jsonb(r)->>'sequencia')::integer AS sequencia,
 r.promotor_matricula,r.loja_codigo,r.industria_codigo,r.frequencia,r.uf,
 r.segunda,r.terca,r.quarta,r.quinta,r.sexta,r.sabado,r.domingo,
 r.observacao,r.created_at,r.updated_at,
 jsonb_build_object('matricula',pr.matricula,'nome',pr.nome) AS promotor,
 jsonb_build_object('codigo',l.codigo,'nome',l.nome,'cidade',l.cidade,'uf',l.uf) AS loja,
 jsonb_build_object('codigo',i.codigo,'nome',i.nome) AS industria,
 r.encerrada_em
FROM public.rotas r JOIN public.promotores pr ON pr.matricula=r.promotor_matricula
JOIN public.lojas l ON l.codigo=r.loja_codigo JOIN public.industrias i ON i.codigo=r.industria_codigo
WHERE attendance_private.staff_can_access(r.promotor_matricula) OR EXISTS(
 SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.status='ativo' AND
 ((p.role='client_industry' AND p.industria_codigo=r.industria_codigo)
 OR (p.role='promotor' AND p.promotor_matricula=r.promotor_matricula)));
REVOKE ALL ON public.industry_routes FROM PUBLIC,anon;
GRANT SELECT ON public.industry_routes TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;;
