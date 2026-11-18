-- RC1.25.44 — preflight only; NOT a migration.
-- Confirm the SQL Editor visibly targets xzmbesqhxcnuokjwrbnw before use.
BEGIN;
SET LOCAL transaction_read_only = on;
DO $preflight$
DECLARE
 actual_versions text[];
 expected_versions text[] := ARRAY['20260930','20261001','20261006','20261007','20261008','20261015100000','20261016100000','20261018220000','20261018230000','20261018232256','20261018234153','20261018235500','20261019001109','20261019001848','20261019004947','20261019011832','20261019013007'];
BEGIN
 IF current_setting('transaction_read_only') <> 'on' THEN RAISE EXCEPTION 'FAIL-CLOSED: transaction is not read-only'; END IF;
 IF current_setting('server_version_num')::integer / 10000 <> 17 THEN RAISE EXCEPTION 'FAIL-CLOSED: expected PostgreSQL 17'; END IF;
 IF to_regclass('supabase_migrations.schema_migrations') IS NULL OR to_regclass('public.visits') IS NULL THEN RAISE EXCEPTION 'FAIL-CLOSED: required ledger or visits missing'; END IF;
 SELECT array_agg(version::text ORDER BY version::text) INTO actual_versions FROM supabase_migrations.schema_migrations;
 IF actual_versions IS DISTINCT FROM expected_versions THEN RAISE EXCEPTION 'FAIL-CLOSED: ledger does not equal expected 17-version baseline'; END IF;
 IF to_regclass('public.visit_occurrences') IS NULL OR to_regclass('public.visit_product_validity') IS NULL THEN RAISE EXCEPTION 'FAIL-CLOSED: expected baseline visit relations missing'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron' AND extversion='1.6.4') THEN RAISE EXCEPTION 'FAIL-CLOSED: pg_cron 1.6.4 not installed'; END IF;
END
$preflight$;
SELECT promotor_matricula, loja_codigo, industria_codigo, data_visita, count(*) AS row_count
FROM public.visits GROUP BY promotor_matricula, loja_codigo, industria_codigo, data_visita HAVING count(*)>1;
SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='visits' AND indexname='visits_promotor_loja_industria_data_unique';
SELECT count(*) AS visits_rows FROM public.visits;
ROLLBACK;
