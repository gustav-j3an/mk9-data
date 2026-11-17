-- Private, local-only snapshot of every restored table's original columns and rows.
-- Run only inside the disposable rehearsal database. It stores hashes and column names,
-- never row values; the private schema is excluded from its own snapshot.
SELECT set_config('mk9.rehearsal_mode', :'mode', false);

CREATE SCHEMA IF NOT EXISTS mk9_rehearsal_private;
CREATE TABLE IF NOT EXISTS mk9_rehearsal_private.historical_table_fingerprints (
  schema_name text NOT NULL,
  table_name text NOT NULL,
  columns_at_baseline text[] NOT NULL,
  row_count bigint NOT NULL,
  data_sha256 text NOT NULL,
  PRIMARY KEY (schema_name, table_name)
);

DO $$
DECLARE
  mode text := current_setting('mk9.rehearsal_mode');
  r record;
  baseline record;
  col_names text[];
  row_total bigint;
  row_digest text;
  current_cols text[];
BEGIN
  IF mode = 'capture' THEN
    TRUNCATE mk9_rehearsal_private.historical_table_fingerprints;
    FOR r IN
      SELECT n.nspname AS schema_name, c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p')
        AND n.nspname !~ '^pg_'
        AND n.nspname NOT IN ('information_schema', 'mk9_rehearsal_private')
        AND NOT (n.nspname = 'supabase_migrations' AND c.relname = 'schema_migrations')
        AND NOT (n.nspname = 'auth' AND c.relname = 'schema_migrations')
      ORDER BY n.nspname, c.relname
    LOOP
      SELECT coalesce(array_agg(column_name ORDER BY ordinal_position), ARRAY[]::text[])
      INTO col_names
      FROM information_schema.columns
      WHERE table_schema = r.schema_name AND table_name = r.table_name;

      EXECUTE format(
        'SELECT count(*), encode(sha256(convert_to(coalesce(string_agg(row_hash, '''' ORDER BY row_hash COLLATE "C"), ''''), ''UTF8'')), ''hex'')
           FROM (
             SELECT encode(sha256(convert_to(to_jsonb(t)::text, ''UTF8'')), ''hex'') AS row_hash
             FROM %I.%I AS t
           ) AS row_hashes',
        r.schema_name, r.table_name
      ) INTO row_total, row_digest;

      INSERT INTO mk9_rehearsal_private.historical_table_fingerprints
        (schema_name, table_name, columns_at_baseline, row_count, data_sha256)
      VALUES (r.schema_name, r.table_name, col_names, row_total, row_digest);
    END LOOP;
    RAISE NOTICE 'Captured private fingerprints for % restored tables.',
      (SELECT count(*) FROM mk9_rehearsal_private.historical_table_fingerprints);
  ELSIF mode = 'verify' THEN
    IF NOT EXISTS (SELECT 1 FROM mk9_rehearsal_private.historical_table_fingerprints) THEN
      RAISE EXCEPTION 'Historical table fingerprint baseline is missing';
    END IF;

    FOR baseline IN
      SELECT * FROM mk9_rehearsal_private.historical_table_fingerprints
      ORDER BY schema_name, table_name
    LOOP
      IF to_regclass(format('%I.%I', baseline.schema_name, baseline.table_name)) IS NULL THEN
        RAISE EXCEPTION 'Historical table missing after migrations: %.%',
          baseline.schema_name, baseline.table_name;
      END IF;

      SELECT coalesce(array_agg(column_name ORDER BY ordinal_position), ARRAY[]::text[])
      INTO current_cols
      FROM information_schema.columns
      WHERE table_schema = baseline.schema_name AND table_name = baseline.table_name;

      IF NOT (baseline.columns_at_baseline <@ current_cols) THEN
        RAISE EXCEPTION 'Historical columns missing after migrations: %.%',
          baseline.schema_name, baseline.table_name;
      END IF;

      EXECUTE format(
        'SELECT count(*), encode(sha256(convert_to(coalesce(string_agg(row_hash, '''' ORDER BY row_hash COLLATE "C"), ''''), ''UTF8'')), ''hex'')
           FROM (
             SELECT encode(sha256(convert_to((to_jsonb(t) - ARRAY(
               SELECT key FROM jsonb_object_keys(to_jsonb(t)) AS keys(key)
               WHERE key <> ALL($1)
             ))::text, ''UTF8'')), ''hex'') AS row_hash
             FROM %I.%I AS t
           ) AS row_hashes',
        baseline.schema_name, baseline.table_name
      ) INTO row_total, row_digest USING baseline.columns_at_baseline;

      IF row_total <> baseline.row_count OR row_digest <> baseline.data_sha256 THEN
        RAISE EXCEPTION 'Historical rows changed after migrations in %.%',
          baseline.schema_name, baseline.table_name;
      END IF;
    END LOOP;
    RAISE NOTICE 'Verified unchanged historical row counts and original-column fingerprints for % restored tables.',
      (SELECT count(*) FROM mk9_rehearsal_private.historical_table_fingerprints);
  ELSE
    RAISE EXCEPTION 'Unsupported rehearsal snapshot mode';
  END IF;
END;
$$;
