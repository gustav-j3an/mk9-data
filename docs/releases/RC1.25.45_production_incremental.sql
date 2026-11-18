-- RC1.25.45 — BLOQUEADO: arquivo de pré-validação somente leitura, NÃO é migration.
-- Não contém DDL/DML nem registro de ledger. Não aplicar como atualização.
-- Antes de qualquer uso, confirmar visualmente o project ref xzmbesqhxcnuokjwrbnw.
BEGIN;
SET LOCAL transaction_read_only = on;

DO $preflight$
DECLARE
  actual_versions text[];
  expected_versions text[] := ARRAY[
    '20260930','20261001','20261006','20261007','20261008',
    '20261015100000','20261016100000','20261018220000','20261018230000',
    '20261018232256','20261018234153','20261018235500','20261019001109',
    '20261019001848','20261019004947','20261019011832','20261019013007'
  ];
  visit_count bigint;
  bad_key_count bigint;
  duplicate_groups bigint;
BEGIN
  IF current_setting('transaction_read_only') <> 'on' THEN
    RAISE EXCEPTION 'FAIL-CLOSED: transaction is not read-only';
  END IF;
  IF split_part(current_setting('server_version'), '.', 1) <> '17' THEN
    RAISE EXCEPTION 'FAIL-CLOSED: expected PostgreSQL 17';
  END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RAISE EXCEPTION 'FAIL-CLOSED: migration ledger missing';
  END IF;

  SELECT array_agg(version::text ORDER BY version::text)
    INTO actual_versions
  FROM supabase_migrations.schema_migrations;
  IF actual_versions IS DISTINCT FROM expected_versions THEN
    RAISE EXCEPTION 'FAIL-CLOSED: ledger differs from exact 17-version production baseline';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron' AND extversion='1.6.4') THEN
    RAISE EXCEPTION 'FAIL-CLOSED: pg_cron 1.6.4 missing';
  END IF;
  IF to_regclass('public.visits') IS NULL THEN
    RAISE EXCEPTION 'FAIL-CLOSED: public.visits missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.visits'::regclass
      AND conname='visits_promotor_loja_industria_data_unique'
      AND contype='u'
  ) THEN
    RAISE EXCEPTION 'FAIL-CLOSED: expected legacy visits unique constraint missing or changed';
  END IF;

  SELECT count(*) INTO visit_count FROM public.visits;
  SELECT count(*) INTO bad_key_count FROM public.visits
  WHERE promotor_matricula IS NULL OR loja_codigo IS NULL
     OR industria_codigo IS NULL OR data_visita IS NULL;
  SELECT count(*) INTO duplicate_groups FROM (
    SELECT 1 FROM public.visits
    GROUP BY promotor_matricula,loja_codigo,industria_codigo,data_visita
    HAVING count(*) > 1
  ) d;
  IF visit_count <> 43 OR bad_key_count <> 0 OR duplicate_groups <> 0 THEN
    RAISE EXCEPTION 'FAIL-CLOSED: visits snapshot differs (expected 43 rows, zero null keys and duplicate groups)';
  END IF;
END;
$preflight$;

-- Expected missing/present M37/M38/RC1.25 relations and authorization stores.
SELECT x.object_name, to_regclass(x.object_name) IS NOT NULL AS present
FROM (VALUES
 ('public.industria_skus'),
 ('public.visit_sku_stock_checks'),
 ('public.visit_edits_audit_log'),
 ('public.visit_schedule_actions'),
 ('public.visit_lifecycle_audit'),
 ('attendance_private.visit_lifecycle_authorizations'),
 ('attendance_private.scheduled_recovery_authorizations'),
 ('attendance_private.scheduled_attempt_authorizations'),
 ('public.visit_occurrences'),
 ('public.visit_regularization_audit'),
 ('public.visit_photos'),
 ('public.visit_product_validity')
) x(object_name)
ORDER BY x.object_name;

-- Key missing/present columns.
SELECT x.table_name,x.column_name,
       EXISTS (SELECT 1 FROM information_schema.columns c
               WHERE c.table_schema='public' AND c.table_name=x.table_name
                 AND c.column_name=x.column_name) AS present
FROM (VALUES
 ('visits','scheduled_date'),('visits','attempt_number'),
 ('visits','occurrence_root_visit_id'),('visits','regularization_status'),
 ('visit_checklist_items','updated_at'),('visit_checklist_items','checked'),
 ('visit_checklist_items','valor_texto'),('visit_checklist_items','observacao')
) x(table_name,column_name)
ORDER BY x.table_name,x.column_name;

-- Function presence; definitions and grants require separate review before any future DDL.
SELECT n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' AS function_name,
       p.prosecdef AS security_definer,
       has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE (n.nspname='public' AND p.proname IN (
  'attendance_check_in','attendance_check_out','check_visit_promotor_update_integrity',
  'attendance_start_scheduled_occurrence','attendance_retry_closed_scheduled_occurrence',
  'attendance_cancel_visit','save_completed_visit_edit','guard_visit_sku_stock_check'
)) OR (n.nspname='attendance_private' AND p.proname IN (
  'attendance_start_scheduled_occurrence','attendance_retry_closed_scheduled_occurrence',
  'expire_old_open_visits','expire_before_new_open_visit','guard_scheduled_visit_attempt_insert',
  'guard_scheduled_visit_attempt_identity_update'
))
ORDER BY 1;

-- Current visits constraints/indexes and trigger/RLS inventory for risk review.
SELECT conname,pg_get_constraintdef(oid) AS definition
FROM pg_constraint WHERE conrelid='public.visits'::regclass ORDER BY conname;
SELECT indexname,indexdef FROM pg_indexes
WHERE schemaname='public' AND tablename='visits' ORDER BY indexname;
SELECT t.tgname,pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t WHERE t.tgrelid='public.visits'::regclass AND NOT t.tgisinternal
ORDER BY t.tgname;
SELECT n.nspname||'.'||c.relname AS relation,c.relrowsecurity AS rls_enabled,
       (SELECT count(*) FROM pg_policies p
        WHERE p.schemaname=n.nspname AND p.tablename=c.relname) AS policy_count
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r'
  AND c.relname IN ('visits','visit_checklist_items','visit_occurrences',
                    'visit_photos','visit_regularization_audit','visit_product_validity')
ORDER BY 1;

ROLLBACK;
