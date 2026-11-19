import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const sourcePath = 'supabase/migrations/20261022152449_mk9_date_visit_regularization_and_checkin_scope.sql';
const outputPath = 'docs/releases/RC1.25.49_reconcile_20261022152449.sql';
let body = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');
const sourceHash = createHash('sha256').update(body).digest('hex').toUpperCase();
const requiredSourceHash = '02ED53B872D22DB731E2269F5B0673A810B566A8FDB0640400A4CF7E60F4311C';
if (sourceHash !== requiredSourceHash) throw new Error('Canonical migration hash changed; stop and review.');

const header = `-- RC1.25.49 controlled reconciliation package for the partial 20261022152449 state.
-- Source migration SHA-256: ${sourceHash}
-- This file is not a historical migration. Compose it only into one psql -1 transaction
-- with the pending migrations and their corresponding ledger INSERTs on a disposable local restore.
-- It never changes or deletes visit rows and refuses to run if catalog fingerprints differ.

DO $$
DECLARE
  v_count integer;
  v_hash text;
  v_args text;
  v_secdef boolean;
  v_volatility text;
  r record;
  h record;
BEGIN
  IF to_regclass('public.visit_regularization_audit') IS NULL THEN
    RAISE EXCEPTION 'RECONCILE_PRECONDITION: audit table absent; this package targets only the captured partial state';
  END IF;
  SELECT md5(string_agg(attname||':'||format_type(atttypid,atttypmod)||':'||attnotnull::text||':'||coalesce(pg_get_expr(adbin,adrelid),''),',' ORDER BY attnum))
    INTO v_hash
  FROM pg_attribute LEFT JOIN pg_attrdef ON adrelid=attrelid AND adnum=attnum
  WHERE attrelid='public.visit_regularization_audit'::regclass AND attnum>0 AND NOT attisdropped;
  IF v_hash IS DISTINCT FROM '6425adb73730a9c5a44fe00afd1ac571' THEN
    RAISE EXCEPTION 'RECONCILE_PRECONDITION: audit table columns/defaults differ';
  END IF;
  SELECT md5(string_agg(conname||':'||contype::text||':'||pg_get_constraintdef(oid),',' ORDER BY conname))
    INTO v_hash FROM pg_constraint WHERE conrelid='public.visit_regularization_audit'::regclass;
  IF v_hash IS DISTINCT FROM '39ebef1a6998fac6458716b42070f8da' THEN
    RAISE EXCEPTION 'RECONCILE_PRECONDITION: audit table constraints/FKs differ';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.visits'::regclass AND attname='regularization_status' AND atttypid='text'::regtype AND NOT attnotnull)
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.visits'::regclass AND conname='visits_regularization_status_check' AND md5(pg_get_constraintdef(oid))='ec2609d7819fa3ef6a5c0750e32ac04d') THEN
    RAISE EXCEPTION 'RECONCILE_PRECONDITION: visits.regularization_status column/check differs';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='visit_regularization_audit_promoter_time_idx' AND md5(indexdef)='b60c29fc024f756c680848b03747e173') THEN
    RAISE EXCEPTION 'RECONCILE_PRECONDITION: audit index definition differs';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='public.visit_regularization_audit'::regclass AND relrowsecurity)
     OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='public.visit_checklist_items'::regclass AND relrowsecurity)
     OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='public.visit_occurrences'::regclass AND relrowsecurity)
     OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='public.visit_product_validity'::regclass AND relrowsecurity) THEN
    RAISE EXCEPTION 'RECONCILE_PRECONDITION: RLS is not enabled on every target table';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND
      ((tgrelid='public.visit_regularization_audit'::regclass AND tgname='visit_regularization_audit_immutable') OR
       (tgrelid='public.visits'::regclass AND tgname='guard_visit_regularization_update'))) <> 2
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.visit_regularization_audit'::regclass AND tgname='visit_regularization_audit_immutable' AND md5(pg_get_triggerdef(oid))='50d07e2d33c87545327e596dc1036957')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.visits'::regclass AND tgname='guard_visit_regularization_update' AND md5(pg_get_triggerdef(oid))='c350e5ff2f3538b3063d1b49564a722e') THEN
    RAISE EXCEPTION 'RECONCILE_PRECONDITION: regularization trigger definitions differ';
  END IF;
  IF (SELECT count(*) FROM pg_policy WHERE polrelid='public.visit_regularization_audit'::regclass AND polname='visit_regularization_audit_read_scope') <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.visit_regularization_audit'::regclass AND polname='visit_regularization_audit_read_scope' AND polcmd='r' AND polpermissive AND polroles=ARRAY[(SELECT oid FROM pg_roles WHERE rolname='authenticated')]::oid[] AND md5(pg_get_expr(polqual,polrelid))='179d3eb0faf96c1351d231bf21158816') THEN
    RAISE EXCEPTION 'RECONCILE_PRECONDITION: existing audit policy differs from canonical definition';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polname IN (
    'visit_checklist_insert_current_visit','visit_checklist_update_current_visit','visit_checklist_delete_current_visit',
    'visit_occurrences_insert_current_visit','visit_occurrences_update_current_visit','visit_occurrences_delete_current_visit',
    'visit_validity_insert_current_visit','visit_validity_update_current_visit','visit_validity_delete_current_visit')) THEN
    RAISE EXCEPTION 'RECONCILE_PRECONDITION: one or more supposedly missing policies already exist';
  END IF;
  -- Authorization helpers referenced by the new RLS predicates and RPCs are
  -- pinned too; matching object names alone is not sufficient.
  FOR h IN SELECT * FROM (VALUES
    ('attendance_private','staff_can_access','matricula text','0c62babea2c61b3a06c50057a6057349',true,'s'),
    ('public','is_admin_or_gestor','','e46a9927b9aa984b968605e92e9ba72f',true,'s'),
    ('public','get_auth_promotor_matricula','','7c174e25df9e6403bd838dc40299adac',true,'s'),
    -- The pending authorization/reconciliation prefix has already replaced this helper.
    ('public','is_promotor_authorized','p_matricula text','f51a16b28f70a2c5a8d61a459113d0c4',true,'s'),
    ('auth','uid','','987669c5db67125372fe409ba45ecaed',false,'s')
  ) AS helpers(schema_name,function_name,identity_args,body_hash,security_definer,volatility)
  LOOP
    SELECT count(*), min(md5(regexp_replace(p.prosrc,'^\\s+|\\s+$','','g'))),
           min(pg_get_function_identity_arguments(p.oid)),
           bool_and(p.prosecdef), min(p.provolatile::text)
      INTO v_count,v_hash,v_args,v_secdef,v_volatility
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname=h.schema_name AND p.proname=h.function_name;
    IF v_count <> 1 OR v_hash IS DISTINCT FROM h.body_hash
       OR v_args IS DISTINCT FROM h.identity_args
       OR v_secdef IS DISTINCT FROM h.security_definer
       OR v_volatility IS DISTINCT FROM h.volatility THEN
      RAISE EXCEPTION 'RECONCILE_PRECONDITION: authorization helper %.% differs',h.schema_name,h.function_name;
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
    ('attendance_private','reject_visit_regularization_audit_mutation','','b265dc82af58a9b256b1d5e0c4cba80f'),
    ('attendance_private','is_visit_in_current_operational_day','p_visit_id uuid',NULL),
    ('attendance_private','is_visit_from_an_earlier_operational_day','p_visit_id uuid','ada1350aae69981978f7822c009d395b'),
    ('attendance_private','promoter_can_write_visit','p_visit_id uuid',NULL),
    -- The preceding 20261011120000 migration replaces this function before reconciliation.
    ('public','check_visit_promotor_update_integrity','','cfb1f75f5df6d8eb1c82a98da8a47698'),
    ('attendance_private','photo_upload_allowed','object_name text','9a0387016e748950a7ef1682c0c2b691'),
    ('attendance_private','guard_visit_regularization_update','','0a94adec0a1d0ef73aa79b69b9b40536'),
    ('attendance_private','regularize_old_open_visit','p_visit_id uuid, p_action text, p_reason text','67615da3fc2f0526ae06cdec14908648'),
    ('public','attendance_regularize_visit','p_visit_id uuid, p_action text, p_reason text','194db630b7a8fbe6c4820541711990cd'),
    ('public','attendance_check_in','p_store text, p_industry text, p_route uuid, p_lat numeric, p_lng numeric, p_accuracy numeric','0037583338f80a5b785960b2bef3f87d'),
    ('public','attendance_check_out','p_visit uuid, p_lat numeric, p_lng numeric, p_accuracy numeric, p_observation text','60178320b9b713dfc97012208bbc7fd3')
  ) AS expected(schema_name,function_name,identity_args,prior_hash)
  LOOP
    SELECT count(*), min(md5(regexp_replace(p.prosrc,'^\\s+|\\s+$','','g')))
      INTO v_count,v_hash FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname=r.schema_name AND p.proname=r.function_name;
    IF v_count=1 AND (SELECT pg_get_function_identity_arguments(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=r.schema_name AND p.proname=r.function_name LIMIT 1) IS DISTINCT FROM r.identity_args THEN
      RAISE EXCEPTION 'RECONCILE_PRECONDITION: function signature differs for %.%',r.schema_name,r.function_name;
    END IF;
    IF r.prior_hash IS NULL THEN
      IF v_count <> 0 THEN RAISE EXCEPTION 'RECONCILE_PRECONDITION: expected missing function %.%',r.schema_name,r.function_name; END IF;
    ELSIF v_count <> 1 OR v_hash IS DISTINCT FROM r.prior_hash THEN
      RAISE EXCEPTION 'RECONCILE_PRECONDITION: unexpected definition for %.%',r.schema_name,r.function_name;
    END IF;
  END LOOP;
END;
$$;

-- Reapply canonical DDL only after the exact captured baseline above was matched.
`;

function stripOuterTransaction(sql) {
  const lines = sql.split('\n');
  const begin = lines.findIndex((line, i) => /^\s*BEGIN;\s*$/i.test(line) && lines.slice(0, i).every(x => /^\s*(--.*)?$/.test(x)));
  const commit = lines.findLastIndex(line => /^\s*COMMIT;\s*$/i.test(line));
  if (begin < 0 || commit <= begin || lines.slice(commit + 1).some(x => x.trim())) throw new Error('Outer transaction boundaries did not match expected structure.');
  lines.splice(commit, 1);
  lines.splice(begin, 1);
  return lines.join('\n');
}

body = stripOuterTransaction(body);
body = body.replace(/ALTER TABLE public\.visits\s+ADD COLUMN IF NOT EXISTS regularization_status text\s+CHECK\s*\([\s\S]*?\);\s*/i, '-- Existing visits column and check were fingerprinted above; no DDL is needed here.\n');
body = body.replace(/CREATE TABLE public\.visit_regularization_audit\s*\([\s\S]*?\n\);\s*CREATE INDEX visit_regularization_audit_promoter_time_idx\s+ON public\.visit_regularization_audit\(promotor_matricula, acted_at DESC\);\s*/i, '-- Existing audit table, constraints and index were fingerprinted above; no DDL is needed here.\n');
body = body.replace(/\bCREATE FUNCTION\b/ig, 'CREATE OR REPLACE FUNCTION');
body = body.replace(/CREATE POLICY (\w+) ON (public\.[\w]+)/ig, (_, name, table) => `DROP POLICY IF EXISTS ${name} ON ${table};\nCREATE POLICY ${name} ON ${table}`);
body = body.replace(/CREATE TRIGGER (\w+)([\s\S]*?\bON\s+(public\.[\w]+))/ig, (_, name, rest, table) => `DROP TRIGGER IF EXISTS ${name} ON ${table};\nCREATE TRIGGER ${name}${rest}`);

const footer = `
DO $$
DECLARE bad_count integer;
BEGIN
  SELECT count(*) INTO bad_count FROM (VALUES
    ('attendance_private','reject_visit_regularization_audit_mutation','','b265dc82af58a9b256b1d5e0c4cba80f'),
    ('attendance_private','is_visit_in_current_operational_day','p_visit_id uuid','9357f83ec3a07fe6ce1a9278eb1a2108'),
    ('attendance_private','is_visit_from_an_earlier_operational_day','p_visit_id uuid','ada1350aae69981978f7822c009d395b'),
    ('attendance_private','promoter_can_write_visit','p_visit_id uuid','c80ec867f7209fe2c765e8b9d5a80517'),
    ('public','check_visit_promotor_update_integrity','','e6fcf0da6ef5aa00a1fa4dcd52139983'),
    ('attendance_private','photo_upload_allowed','object_name text','deb763b7c6ddfdf37d0c091ad88ca773'),
    ('attendance_private','guard_visit_regularization_update','','0a94adec0a1d0ef73aa79b69b9b40536'),
    ('attendance_private','regularize_old_open_visit','p_visit_id uuid, p_action text, p_reason text','0ac6337ccbb51d9533e9e750eb4d1211'),
    ('public','attendance_regularize_visit','p_visit_id uuid, p_action text, p_reason text','194db630b7a8fbe6c4820541711990cd'),
    ('public','attendance_check_in','p_store text, p_industry text, p_route uuid, p_lat numeric, p_lng numeric, p_accuracy numeric','626c89c4b063550c21a48c712d777cd3'),
    ('public','attendance_check_out','p_visit uuid, p_lat numeric, p_lng numeric, p_accuracy numeric, p_observation text','b4c1d6729111119622d6fda48a2fa1e9')
  ) expected(schema_name,function_name,identity_args,body_hash)
  WHERE (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname=expected.schema_name AND p.proname=expected.function_name) <> 1
    OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname=expected.schema_name AND p.proname=expected.function_name
        AND pg_get_function_identity_arguments(p.oid)=expected.identity_args
        AND md5(regexp_replace(p.prosrc,'^\\s+|\\s+$','','g'))=expected.body_hash);
  IF bad_count <> 0 THEN RAISE EXCEPTION 'RECONCILE_POSTCONDITION: canonical function fingerprints mismatch'; END IF;
  SELECT count(*) INTO bad_count FROM (VALUES
    ('visit_regularization_audit_read_scope','visit_regularization_audit','r',true,'179d3eb0faf96c1351d231bf21158816',NULL),
    ('visit_checklist_insert_current_visit','visit_checklist_items','a',false,NULL,'ce26ef960f5d045febf53e8369ae2e37'),
    ('visit_checklist_update_current_visit','visit_checklist_items','w',false,'ce26ef960f5d045febf53e8369ae2e37','ce26ef960f5d045febf53e8369ae2e37'),
    ('visit_checklist_delete_current_visit','visit_checklist_items','d',false,'ce26ef960f5d045febf53e8369ae2e37',NULL),
    ('visit_occurrences_insert_current_visit','visit_occurrences','a',false,NULL,'0dad74fb07fa1f677d4f19d2a9e9247a'),
    ('visit_occurrences_update_current_visit','visit_occurrences','w',false,'0dad74fb07fa1f677d4f19d2a9e9247a','0dad74fb07fa1f677d4f19d2a9e9247a'),
    ('visit_occurrences_delete_current_visit','visit_occurrences','d',false,'0dad74fb07fa1f677d4f19d2a9e9247a',NULL),
    ('visit_validity_insert_current_visit','visit_product_validity','a',false,NULL,'d8d8999ed373b999da131795136bdd70'),
    ('visit_validity_update_current_visit','visit_product_validity','w',false,'d8d8999ed373b999da131795136bdd70','d8d8999ed373b999da131795136bdd70'),
    ('visit_validity_delete_current_visit','visit_product_validity','d',false,'d8d8999ed373b999da131795136bdd70',NULL)
  ) expected(policy_name,table_name,command,permissive,qual_hash,check_hash)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
    WHERE p.polname=expected.policy_name AND c.relnamespace='public'::regnamespace
      AND c.relname=expected.table_name AND p.polcmd=expected.command
      AND p.polpermissive=expected.permissive
      AND p.polroles=ARRAY[(SELECT oid FROM pg_roles WHERE rolname='authenticated')]::oid[]
      AND coalesce(md5(pg_get_expr(p.polqual,p.polrelid)),'-')=coalesce(expected.qual_hash,'-')
      AND coalesce(md5(pg_get_expr(p.polwithcheck,p.polrelid)),'-')=coalesce(expected.check_hash,'-')
  );
  IF bad_count <> 0 THEN
    RAISE EXCEPTION 'RECONCILE_POSTCONDITION: one or more policy definitions/roles differ';
  END IF;
  IF NOT has_table_privilege('authenticated','public.visit_regularization_audit','SELECT')
     OR has_table_privilege('anon','public.visit_regularization_audit','SELECT') THEN
    RAISE EXCEPTION 'RECONCILE_POSTCONDITION: audit table grants are not least-privilege';
  END IF;
END;
$$;
`;

writeFileSync(outputPath, header + body + footer, 'utf8');
console.log(`Generated ${outputPath}; canonical source SHA-256 ${sourceHash}; output bytes ${Buffer.byteLength(header + body + footer)}.`);
