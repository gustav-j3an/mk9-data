-- RC1.25.43 — production preflight ONLY (read-only; intentionally no DDL)
-- Status: BLOCKED as a release migration. This file checks the known target and
-- prints drift/data counts. It does NOT install M30/M37/M38/RC1.25 or register
-- a migration. Do not treat a successful preflight as authorization to deploy.
-- Target must be confirmed manually in Supabase SQL Editor:
--   production xzmbesqhxcnuokjwrbnw (PG 17.11, ledger baseline 17 versions)
-- Staging is tafjceemuetqjyngresg and MUST NOT be substituted.

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
SET LOCAL transaction_read_only = on;

DO $preflight$
DECLARE
  v_pg integer := current_setting('server_version_num')::integer;
  v_cron text;
  v_versions text[];
BEGIN
  IF v_pg < 170000 OR v_pg >= 180000 THEN
    RAISE EXCEPTION 'RC1.25.43 requires PostgreSQL 17; detected %', current_setting('server_version');
  END IF;

  SELECT extversion INTO v_cron FROM pg_extension WHERE extname = 'pg_cron';
  IF v_cron IS DISTINCT FROM '1.6.4' THEN
    RAISE EXCEPTION 'RC1.25.43 requires pg_cron 1.6.4; detected %', coalesce(v_cron, '<missing>');
  END IF;

  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RAISE EXCEPTION 'Supabase migration ledger is missing';
  END IF;

  SELECT array_agg(version::text ORDER BY version::text)
    INTO v_versions
    FROM supabase_migrations.schema_migrations;

  IF v_versions IS DISTINCT FROM ARRAY[
    '20260930','20261001','20261006','20261007','20261008',
    '20261015100000','20261016100000','20261018220000',
    '20261018230000','20261018232256','20261018234153',
    '20261018235500','20261019001109','20261019001848',
    '20261019004947','20261019011832','20261019013007'
  ]::text[] THEN
    RAISE EXCEPTION 'Unexpected production migration ledger; expected exactly the 17 recorded historical versions';
  END IF;

  IF to_regclass('public.visits') IS NULL
     OR to_regclass('public.visit_checklist_items') IS NULL
     OR to_regclass('public.visit_photos') IS NULL
     OR to_regclass('public.visit_regularization_audit') IS NULL THEN
    RAISE EXCEPTION 'Known production baseline differs from the inspected snapshot';
  END IF;

  RAISE NOTICE 'Preflight gates matched. This is not a release migration and performs no DDL.';
END
$preflight$;

-- Snapshot counts for an operator to compare with the recorded baseline.
SELECT 'visits' AS object_name, count(*) AS rows FROM public.visits
UNION ALL SELECT 'visit_checklist_items', count(*) FROM public.visit_checklist_items
UNION ALL SELECT 'visit_photos', count(*) FROM public.visit_photos
UNION ALL SELECT 'visit_occurrences', count(*) FROM public.visit_occurrences
UNION ALL SELECT 'visit_product_validity', count(*) FROM public.visit_product_validity
UNION ALL SELECT 'visit_regularization_audit', count(*) FROM public.visit_regularization_audit
ORDER BY object_name;

-- Conflicts that would invalidate the exact RC1.25 unique upsert target.
SELECT count(*) AS duplicate_checklist_keys
FROM (
  SELECT visit_id, item_key
  FROM public.visit_checklist_items
  GROUP BY visit_id, item_key
  HAVING count(*) > 1
) d;

-- Existing legacy daily uniqueness constraint that M37/M38 must replace with
-- the partial indexes that preserve daily uniqueness while separating scheduled
-- attempts. Presence alone is not proof that its replacement is safe.
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.visits'::regclass
  AND conname = 'visits_promotor_loja_industria_data_unique';

-- Check only; expected missing on this recorded production snapshot.
SELECT
  to_regclass('public.visit_schedule_actions') IS NOT NULL AS has_visit_schedule_actions,
  to_regclass('public.visit_lifecycle_audit') IS NOT NULL AS has_visit_lifecycle_audit,
  to_regclass('public.industria_skus') IS NOT NULL AS has_industria_skus,
  to_regclass('public.visit_sku_stock_checks') IS NOT NULL AS has_visit_sku_stock_checks,
  to_regclass('public.visit_edits_audit_log') IS NOT NULL AS has_visit_edits_audit_log;

ROLLBACK;

