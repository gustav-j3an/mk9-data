import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const OUT = 'docs/releases/RC1.25.52_production_package.sql';
const MANIFEST_OUT = 'docs/releases/RC1.25.52_package_manifest.json';
const BASELINE = [
  '20260930', '20261001', '20261006', '20261007', '20261008',
  '20261015100000', '20261016100000', '20261018220000', '20261018230000',
  '20261018232256', '20261018234153', '20261018235500', '20261019001109',
  '20261019001848', '20261019004947', '20261019011832', '20261019013007'
];

const ordinary = [
  ['20261009144200', 'add_visits_unique_constraint', 'supabase/migrations/20261009144200_add_visits_unique_constraint.sql'],
  ['20261010', 'create_system_settings_and_audit', 'supabase/migrations/20261010_create_system_settings_and_audit.sql'],
  ['20261011120000', 'create_promoter_authorizations', 'supabase/migrations/20261011120000_create_promoter_authorizations.sql'],
  ['20261011140000', 'auto_generate_industry_code', 'supabase/migrations/20261011140000_auto_generate_industry_code.sql'],
  ['20261017120000', 'create_contratos_lojas_table', 'supabase/migrations/20261017120000_create_contratos_lojas_table.sql'],
  ['20261017', 'create_avatars_storage_policies', 'supabase/migrations/20261017_create_avatars_storage_policies.sql'],
  ['20261018150000', 'add_data_inicio_operacao_to_industrias', 'supabase/migrations/20261018150000_add_data_inicio_operacao_to_industrias.sql'],
  ['20261019151754', 'mk9_rh_explicit_bindings', 'supabase/migrations/20261019151754_mk9_rh_explicit_bindings.sql'],
  ['20261019175853', 'mk9_rh_admin_binding_preparation', 'supabase/migrations/20261019175853_mk9_rh_admin_binding_preparation.sql'],
  ['20261020160000', 'add_whatsapp_group_link_to_industrias', 'supabase/migrations/20261020160000_add_whatsapp_group_link_to_industrias.sql'],
  ['20261020163000', 'mk9_faltas_atestados_prepare_permission', 'supabase/migrations/20261020163000_mk9_faltas_atestados_prepare_permission.sql'],
  ['20261020170000', 'mk9_absence_records_outbox', 'supabase/migrations/20261020170000_mk9_absence_records_outbox.sql'],
  ['20261021100000', 'mk9_rh_reconciliation', 'supabase/migrations/20261021100000_mk9_rh_reconciliation.sql'],
  ['20261021120000', 'mk9_absence_attachments', 'supabase/migrations/20261021120000_mk9_absence_attachments.sql'],
  ['20261023142837', 'promoter_scheduled_visit_actions', 'supabase/migrations/20261023142837_promoter_scheduled_visit_actions.sql'],
  ['20261030160000', 'minimal_visit_regularization', 'supabase/migrations/20261030160000_minimal_visit_regularization.sql'],
  ['20261105165500', 'm30_harden_industry_active_checkin', 'supabase/migrations/20261105165500_m30_harden_industry_active_checkin.sql'],
  ['20261106131614', 'm30_serialize_industry_checkin', 'supabase/migrations/20261106131614_m30_serialize_industry_checkin.sql'],
  ['20261106140000', 'm37_pending_visit_active_route_guard', 'supabase/migrations/20261106140000_m37_pending_visit_active_route_guard.sql'],
  ['20261106150000', 'm37_checkin_route_and_conflict_guard', 'supabase/migrations/20261106150000_m37_checkin_route_and_conflict_guard.sql'],
  ['20261107140000', 'm37_reconcile_materialized_pending_recovery', 'supabase/migrations/20261107140000_m37_reconcile_materialized_pending_recovery.sql'],
  ['20261108160835', 'm37_integral_weekly_recovery', 'supabase/migrations/20261108160835_m37_integral_weekly_recovery.sql'],
  ['20261110150000', 'm38_visit_cancellation_and_day_end_close', 'supabase/migrations/20261110150000_m38_visit_cancellation_and_day_end_close.sql'],
  ['20261110160000', 'm38_retry_attempt_history', 'supabase/migrations/20261110160000_m38_retry_attempt_history.sql'],
  ['20261110170000', 'm38_checkin_reuses_active_scheduled_attempt', 'supabase/migrations/20261110170000_m38_checkin_reuses_active_scheduled_attempt.sql']
];

const reconcile = {
  version: '20261022152449',
  name: 'mk9_date_visit_regularization_and_checkin_scope',
  path: 'docs/releases/RC1.25.49_reconcile_20261022152449.sql',
  provenance: 'supabase/migrations/20261022152449_mk9_date_visit_regularization_and_checkin_scope.sql'
};
const entries = [
  ...ordinary.slice(0, 14).map(([version, name, file]) => ({ version, name, path: file })),
  reconcile,
  ...ordinary.slice(14).map(([version, name, file]) => ({ version, name, path: file })),
  {
    version: '20261115160000',
    name: '20261115_rc1_25_skus_and_stock_audits',
    path: 'supabase/migrations/propostas/20261115_rc1_25_skus_and_stock_audits.sql'
  },
  {
    version: '20261118172125',
    name: 'rc1_25_42_server_derived_completed_visit_edit_diff',
    path: 'supabase/migrations/20261118172125_rc1_25_42_server_derived_completed_visit_edit_diff.sql',
    localCronCompat: true
  },
  {
    version: '20261119162955',
    name: 'm18_active_session_policies_rc1251',
    path: 'supabase/migrations/20261119162955_m18_active_session_policies_rc1251.sql'
  }
];

const versions = [...BASELINE, ...entries.map(entry => entry.version)].sort();
if (ordinary.length !== 25 || entries.length !== 29) {
  throw new Error(`Manifest cardinality mismatch: ordinary=${ordinary.length}, added=${entries.length}`);
}
if (new Set(versions).size !== versions.length) throw new Error('Duplicate migration version in final package manifest');

function sha256(text) {
  return createHash('sha256').update(text.replace(/\r\n/g, '\n'), 'utf8').digest('hex').toUpperCase();
}

function stripOuterTransaction(sql, file) {
  const lines = sql.replace(/\r\n/g, '\n').trim().split('\n');
  const begin = lines.flatMap((line, i) => /^\s*BEGIN;\s*$/i.test(line) ? [i] : []);
  const commit = lines.flatMap((line, i) => /^\s*COMMIT;\s*$/i.test(line) ? [i] : []);
  if (begin.length === 0 && commit.length === 0) return lines.join('\n').trim();
  if (begin.length !== 1 || commit.length !== 1 || commit[0] <= begin[0]
      || lines.slice(0, begin[0]).some(line => !/^\s*(--.*)?$/.test(line))
      || lines.slice(commit[0] + 1).some(line => line.trim() !== '')) {
    throw new Error(`Invalid outer transaction boundaries: ${file}`);
  }
  const body = [...lines.slice(0, begin[0]), ...lines.slice(begin[0] + 1, commit[0])].join('\n').trim();
  if (/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im.test(body)) throw new Error(`Nested transaction control: ${file}`);
  return body;
}

function localCronGuard(sql) {
  const original = `IF v_cron IS DISTINCT FROM '1.6.4' THEN\n    RAISE EXCEPTION 'Expected pg_cron 1.6.4, found %', coalesce(v_cron,'missing');\n  END IF;`;
  const replacement = `IF v_cron IS DISTINCT FROM '1.6.4' THEN
    -- Only the named loopback-only WSL clone may use its packaged 1.6 extension.
    -- Managed Supabase/production remains pinned to exactly 1.6.4.
    IF NOT (v_cron = '1.6'
            AND current_database() = 'mk9_prod_restore_rc1251_final_v3'
            AND (inet_server_addr() IS NULL OR inet_server_addr() IN ('127.0.0.1'::inet, '::1'::inet))) THEN
      RAISE EXCEPTION 'Expected pg_cron 1.6.4, found %', coalesce(v_cron,'missing');
    END IF;
  END IF;`;
  if (sql.split(original).length !== 2) throw new Error('Expected strict pg_cron gate was not found exactly once in RC1.25.42 source');
  return sql.replace(original, replacement);
}

const expectedLedger = versions.map(version => `'${version}'`).join(',\n    ');
const sql = [];
sql.push(`-- RC1.25.52 consolidated production release package (review required before use).
-- Generated by scripts/generate-rc1-25-final-package.mjs; do not hand-edit this output.
-- Apply as ONE transaction only. Production pg_cron must be exactly 1.6.4.
-- The local exception is limited to database mk9_prod_restore_rc1251_final_v3 on loopback.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

DO $release_preflight$
DECLARE
  v_versions text[];
  v_cron text;
BEGIN
  IF current_setting('server_version_num')::integer < 170000
     OR current_setting('server_version_num')::integer >= 180000 THEN
    RAISE EXCEPTION 'RC1.25.52 requires PostgreSQL 17';
  END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RAISE EXCEPTION 'Supabase migration ledger is missing';
  END IF;
  SELECT array_agg(version::text ORDER BY version::text)
    INTO v_versions FROM supabase_migrations.schema_migrations;
  IF v_versions IS DISTINCT FROM ARRAY[
    ${BASELINE.map(version => `'${version}'`).join(',\n    ')}
  ]::text[] THEN
    RAISE EXCEPTION 'RC1.25.52 baseline ledger differs from the approved 17-entry production snapshot';
  END IF;
  IF to_regclass('public.visits') IS NULL OR (SELECT count(*) FROM public.visits) <> 43 THEN
    RAISE EXCEPTION 'RC1.25.52 baseline must contain exactly 43 visits';
  END IF;
  IF EXISTS (
    SELECT 1 FROM (SELECT promotor_matricula, loja_codigo, industria_codigo, data_visita
                   FROM public.visits GROUP BY 1,2,3,4 HAVING count(*) > 1) d
  ) THEN
    RAISE EXCEPTION 'RC1.25.52 baseline has duplicate historical visit keys';
  END IF;
  SELECT extversion INTO v_cron FROM pg_catalog.pg_extension WHERE extname = 'pg_cron';
  IF v_cron IS DISTINCT FROM '1.6.4'
     AND NOT (v_cron = '1.6'
              AND current_database() = 'mk9_prod_restore_rc1251_final_v3'
              AND (inet_server_addr() IS NULL OR inet_server_addr() IN ('127.0.0.1'::inet, '::1'::inet))) THEN
    RAISE EXCEPTION 'RC1.25.52 requires pg_cron 1.6.4; local exception only for the named loopback clone (detected %)', coalesce(v_cron, '<missing>');
  END IF;
END
$release_preflight$;`);

const manifest = [];
for (const entry of entries) {
  const input = readFileSync(entry.path, 'utf8').replace(/\r\n/g, '\n');
  let body = input;
  const originalHash = sha256(input);
  const sourceHashes = [{ path: entry.path, sha256: originalHash }];
  if (entry.provenance) {
    const provenance = readFileSync(entry.provenance, 'utf8').replace(/\r\n/g, '\n');
    sourceHashes.push({ path: entry.provenance, sha256: sha256(provenance) });
  }
  if (entry.localCronCompat) body = localCronGuard(body);
  body = stripOuterTransaction(body, entry.path);
  // Remove inherited trailing spaces from historical source text; this is a
  // whitespace-only canonicalization and does not rewrite migration sources.
  body = body.replace(/[ \t]+$/gm, '');
  const serviceRoleRpcGrant = entry.version === '20261118172125'
    ? "\n-- Supabase runtime contract: permit service_role to invoke the SECURITY DEFINER RPC.\nGRANT EXECUTE ON FUNCTION public.save_completed_visit_edit(uuid,text,jsonb,text,jsonb) TO service_role;\n"
    : '';
  sql.push(`\n-- BEGIN ${entry.version} ${entry.name}; source(s): ${sourceHashes.map(s => `${s.path} sha256=${s.sha256}`).join('; ')}\n${body}${serviceRoleRpcGrant}\nINSERT INTO supabase_migrations.schema_migrations (version) VALUES ('${entry.version}');\n-- END ${entry.version}`);
  manifest.push({ version: entry.version, name: entry.name, sourceHashes, localCronCompat: Boolean(entry.localCronCompat) });
}

sql.push(`\nDO $release_postflight$
DECLARE
  v_versions text[];
  v_bad_fk integer;
  v_invalid_idx integer;
BEGIN
  SELECT array_agg(version::text ORDER BY version::text)
    INTO v_versions FROM supabase_migrations.schema_migrations;
  IF v_versions IS DISTINCT FROM ARRAY[
    ${expectedLedger}
  ]::text[] THEN
    RAISE EXCEPTION 'RC1.25.52 postflight ledger mismatch';
  END IF;
  IF (SELECT count(*) FROM public.visits) <> 43 THEN
    RAISE EXCEPTION 'RC1.25.52 postflight visit count mismatch';
  END IF;
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_schema='public' AND table_name='visit_edits_audit_log'
        AND column_name='changes_summary') IS DISTINCT FROM 'jsonb'
     OR NOT EXISTS (SELECT 1 FROM pg_constraint
       WHERE conrelid='public.visit_edits_audit_log'::regclass
         AND conname='visit_edits_audit_changes_summary_array'
         AND pg_get_constraintdef(oid)='CHECK ((jsonb_typeof(changes_summary) = ''array''::text))') THEN
    RAISE EXCEPTION 'RC1.25.52 postflight changes_summary column/constraint mismatch';
  END IF;
  IF position('GROUP BY trim(e.value->>''item_key'')' in
      pg_get_functiondef('public.save_completed_visit_edit(uuid,text,jsonb,text,jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'RC1.25.52 postflight RPC does not normalize item_key';
  END IF;
  IF has_function_privilege('anon','public.save_completed_visit_edit(uuid,text,jsonb,text,jsonb)'::regprocedure,'EXECUTE')
     OR NOT has_function_privilege('authenticated','public.save_completed_visit_edit(uuid,text,jsonb,text,jsonb)'::regprocedure,'EXECUTE')
     OR NOT has_function_privilege('service_role','public.save_completed_visit_edit(uuid,text,jsonb,text,jsonb)'::regprocedure,'EXECUTE') THEN
    RAISE EXCEPTION 'RC1.25.52 postflight RPC grants mismatch';
  END IF;
  IF (SELECT count(*) FROM pg_policy
      WHERE polname='m18_active_session'
        AND polrelid IN ('public.visits'::regclass,'public.visit_checklist_items'::regclass,
                         'public.visit_occurrences'::regclass,'public.visit_regularization_audit'::regclass,
                         'public.visit_product_validity'::regclass)) <> 5 THEN
    RAISE EXCEPTION 'RC1.25.52 postflight M18 policy count mismatch';
  END IF;
  SELECT count(*) INTO v_bad_fk FROM pg_constraint
   WHERE contype='f' AND NOT convalidated;
  IF v_bad_fk <> 0 THEN RAISE EXCEPTION 'RC1.25.52 postflight has unvalidated foreign keys: %', v_bad_fk; END IF;
  SELECT count(*) INTO v_invalid_idx FROM pg_index WHERE NOT indisvalid OR NOT indisready;
  IF v_invalid_idx <> 0 THEN RAISE EXCEPTION 'RC1.25.52 postflight has invalid indexes: %', v_invalid_idx; END IF;
END
$release_postflight$;`);

const output = `${sql.join('\n')}\n`;
writeFileSync(OUT, output, 'utf8');
const packageHash = sha256(output);
const manifestDoc = {
  package: OUT,
  packageSha256: packageHash,
  postgresMajor: 17,
  productionCronVersion: '1.6.4',
  localCronException: { version: '1.6', database: 'mk9_prod_restore_rc1251_final_v3', connection: 'Unix socket or loopback only', serverAddress: ['127.0.0.1', '::1'] },
  baselineLedger: BASELINE,
  appliedEntryCount: entries.length,
  expectedFinalLedgerCount: versions.length,
  entries: manifest
};
writeFileSync(MANIFEST_OUT, `${JSON.stringify(manifestDoc, null, 2)}\n`, 'utf8');
console.log(`Generated ${OUT} (${Buffer.byteLength(output)} bytes, SHA-256 ${packageHash}); ${entries.length} migration ledger entries, expected ledger ${versions.length}.`);
