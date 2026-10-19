-- MODEL ONLY. No real values and no automatic load. Requires a separate explicit approval.
-- Run by a database administrator ONLY in the separately approved environment.
-- Use psql -v ON_ERROR_STOP=1, passing each value as a quoted psql variable.
\if :{?MK9_RH_APPROVAL_CONFIRMED}
  \if :MK9_RH_APPROVAL_CONFIRMED
  \else
    \echo 'STOP: administrative approval has not been confirmed.'
    \quit 1
  \endif
\else
  \echo 'STOP: this is a review template. Real data registration is not authorized yet.'
  \quit 1
\endif

BEGIN;
-- First confirm these existing IDs manually. Names, email and UF are not identity proofs.
SELECT id,matricula,nome FROM public.promotores WHERE id=:'promotor_id'::uuid;
SELECT id,name,status FROM public.profiles WHERE id=:'usuario_proprio_id'::uuid;
SELECT id,name,status FROM public.profiles WHERE id=:'aprovador_id'::uuid;

-- For a new person mapping only. For a second project, reuse the reviewed identity;
-- do not execute this INSERT again and do not use ON CONFLICT to overwrite an identity.
INSERT INTO public.mk9_identidades(promotor_id,usuario_id,estado,referencia)
VALUES(:'promotor_id'::uuid,nullif(:'usuario_proprio_id','')::uuid,'pendente',:'referencia');

INSERT INTO public.mk9_alocacoes(promotor_id,projeto_externo_id,matricula_externa,
  ocorrencias_desde,ocorrencias_ate,valido_desde,valido_ate,estado,referencia)
VALUES(:'promotor_id'::uuid,:'projeto_externo_id'::uuid,:'matricula_externa',
  :'ocorrencias_desde'::date,nullif(:'ocorrencias_ate','')::date,
  :'valido_desde'::timestamptz,nullif(:'valido_ate','')::timestamptz,'pendente',:'referencia')
RETURNING id AS nova_alocacao_id \gset

-- Optional explicit supervisor/manager reader, independently of operational role.
\if :{?leitor_usuario_id}
INSERT INTO public.mk9_acessos(usuario_id,alocacao_id,tipo,estado,valido_desde,valido_ate,referencia)
VALUES(:'leitor_usuario_id'::uuid,:'nova_alocacao_id'::uuid,:'tipo_acesso','pendente',
  :'acesso_desde'::timestamptz,nullif(:'acesso_ate','')::timestamptz,:'referencia');
\endif
COMMIT;

-- Deliberately NOT activated by this template: pending rows authorize no queries.
-- After a separate review, an administrator may approve EXACT reviewed IDs:
-- BEGIN;
-- UPDATE public.mk9_identidades SET estado='aprovado',aprovado_por=:'aprovador_id'::uuid,
--   aprovado_em=statement_timestamp(),referencia=:'referencia'
-- WHERE promotor_id=:'promotor_id'::uuid AND estado='pendente';
-- UPDATE public.mk9_alocacoes SET estado='aprovado',aprovado_por=:'aprovador_id'::uuid,
--   aprovado_em=statement_timestamp(),referencia=:'referencia'
-- WHERE id=:'alocacao_id_aprovada'::uuid AND estado='pendente';
-- UPDATE public.mk9_acessos SET estado='aprovado',aprovado_por=:'aprovador_id'::uuid,
--   aprovado_em=statement_timestamp(),referencia=:'referencia'
-- WHERE id=:'acesso_id_aprovado'::uuid AND estado='pendente';
-- COMMIT;
-- Revocation: UPDATE the exact RH row's estado='revogado', with a reviewed reference.
-- Never update operational profiles/promotores/equipes/supervisores/rotas for RH access.
