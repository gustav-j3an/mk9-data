-- Template only. Grant the dedicated reconciliation capability only after
-- validating both active admin UUIDs and recording a ticket/approval reference.
\if :{?MK9_RH_RECONCILIATION_PERMISSION_APPROVED}
  \if :MK9_RH_RECONCILIATION_PERMISSION_APPROVED
  \else
    \echo 'STOP: explicit permission approval was not confirmed.'
    \quit 1
  \endif
\else
  \echo 'STOP: explicit permission approval and reviewed UUIDs are required.'
  \quit 1
\endif

BEGIN;
SELECT id,name,role,status FROM public.profiles
WHERE id IN (:'usuario_admin_id'::uuid, :'concedido_por'::uuid);

INSERT INTO mk9_rh_private.reconciliation_permissions(usuario_id,ativo,concedido_por,referencia)
SELECT target.id,true,approver.id,:'referencia'::text
FROM public.profiles target
JOIN public.profiles approver ON approver.id=:'concedido_por'::uuid
WHERE target.id=:'usuario_admin_id'::uuid
  AND target.role='admin' AND target.status='ativo'
  AND approver.role='admin' AND approver.status='ativo'
  AND length(btrim(:'referencia')) BETWEEN 3 AND 500
ON CONFLICT(usuario_id) DO UPDATE SET ativo=true,concedido_por=EXCLUDED.concedido_por,
  concedido_em=statement_timestamp(),referencia=EXCLUDED.referencia,revogado_por=NULL,revogado_em=NULL;

COMMIT;

-- Revocation requires a separately reviewed operation:
-- UPDATE mk9_rh_private.reconciliation_permissions
-- SET ativo=false,revogado_por=:'concedido_por'::uuid,revogado_em=statement_timestamp()
-- WHERE usuario_id=:'usuario_admin_id'::uuid AND ativo;
