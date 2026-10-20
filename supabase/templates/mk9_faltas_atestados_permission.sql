-- Provisionamento individual, somente após aprovação e revisão dos UUIDs.
-- Não concede automaticamente acesso a todos os administradores.
\if :{?MK9_FALTAS_ATESTADOS_PERMISSION_APPROVED}
  \if :MK9_FALTAS_ATESTADOS_PERMISSION_APPROVED
  \else
    \echo 'STOP: confirme a aprovação explícita antes de conceder a permissão.'
    \quit 1
  \endif
\else
  \echo 'STOP: informe a aprovação explícita e confira os UUIDs.'
  \quit 1
\endif

BEGIN;
INSERT INTO mk9_rh_private.absence_prepare_permissions
  (usuario_id,ativo,concedido_por,concedido_em,referencia,revogado_por,revogado_em)
SELECT target.id,true,approver.id,statement_timestamp(),:'referencia'::text,NULL,NULL
FROM public.profiles target
JOIN public.profiles approver ON approver.id=:'concedido_por'::uuid
WHERE target.id=:'usuario_id'::uuid AND target.status='ativo'
  AND target.role IN ('admin','gestor')
  AND approver.role='admin' AND approver.status='ativo'
  AND length(btrim(:'referencia')) BETWEEN 3 AND 500
ON CONFLICT(usuario_id) DO UPDATE
SET ativo=true,concedido_por=EXCLUDED.concedido_por,
    concedido_em=statement_timestamp(),referencia=EXCLUDED.referencia,
    revogado_por=NULL,revogado_em=NULL;

COMMIT;

-- Revogação explícita, após confirmar usuário e aprovador:
-- UPDATE mk9_rh_private.absence_prepare_permissions
-- SET ativo=false,revogado_por=:'concedido_por'::uuid,revogado_em=statement_timestamp()
-- WHERE usuario_id=:'usuario_id'::uuid AND ativo;
