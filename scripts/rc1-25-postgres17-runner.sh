for name in SUPABASE_ACCESS_TOKEN SUPABASE_DB_PASSWORD SUPABASE_PROJECT_REF SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY SUPABASE_DB_URL SUPABASE_ANON_KEY SUPABASE_TEST_ANON_KEY SUPABASE_TEST_SERVICE_KEY ANON_KEY SERVICE_ROLE_KEY DATABASE_URL DB_URL PGHOST PGPORT PGDATABASE PGUSER PGSERVICE PGSERVICEFILE; do
  if [[ -n "${!name:-}" ]]; then
    echo "FALHA DE SEGURANÇA: remote database configuration detected ($name)." >&2
    exit 1
  fi
done
shopt -s nocasematch
for name in $(compgen -e); do
  value="${!name:-}"
  if [[ "$value" =~ supabase\.co|pooler\.supabase\.com|xzmbesqhxcnuokjwrbnw|tafjceemuetqjyngresg ]]; then
    echo "FALHA DE SEGURANÇA: external Supabase host/reference found in environment variable $name." >&2
    exit 1
  fi
done
shopt -u nocasematch

ROOT="$RUNNER_TEMP/rc1-25-test"
mkdir -m 700 -p "$ROOT"
NONCE="$(node -e 'import("node:crypto").then(c => console.log(c.randomBytes(14).toString("hex")))')"
PROJECT_ID="mk9_rc25_${NONCE}"
STACK="$ROOT/stack"
mkdir -m 700 -p "$STACK"

cleanup() {
  status=$?
  if [[ "${REHEARSAL_MODE:-false}" != "true" ]]; then
    sudo bash scripts/rc1-25-egress-guard.sh disable >/dev/null 2>&1 || true
  fi
  if [[ -f "$STACK/supabase/config.toml" ]]; then
    echo "Desligando stack efêmero do Supabase..."
    (cd "$STACK" && supabase stop --no-backup >/dev/null 2>&1) || true
  fi
  bash scripts/rc1-25-secure-remove.sh "$ROOT" >/dev/null 2>&1 || rm -rf -- "$ROOT"
  exit "$status"
}
trap cleanup EXIT

REHEARSAL_MODE="${MK9_USE_RESTORED_DB:-false}"
if [[ "$REHEARSAL_MODE" == "true" ]]; then
  # This mode is only for the manually approved real-backup rehearsal workflow.
  # It accepts no caller-provided URL: writes are pinned to loopback and one disposable DB.
  DB_URL='postgresql://postgres:postgres@127.0.0.1:54322/mk9_backup_restore?sslmode=disable'
  export PGPASSWORD=postgres
  test "$DB_URL" = 'postgresql://postgres:postgres@127.0.0.1:54322/mk9_backup_restore?sslmode=disable'
  echo "Using the loopback-only restored backup database (mk9_backup_restore)."
else
  # 2. Instalar Supabase CLI 3.0.0 fixada
  echo "Instalando Supabase CLI 3.0.0..."
  curl -fsSL https://github.com/supabase/cli/releases/download/v3.0.0/supabase_3.0.0_linux_amd64.tar.gz -o "$RUNNER_TEMP/supabase-cli.tar.gz"
  tar -xzf "$RUNNER_TEMP/supabase-cli.tar.gz" -C "$RUNNER_TEMP" supabase
  sudo install "$RUNNER_TEMP/supabase" /usr/local/bin/supabase
  rm -f "$RUNNER_TEMP/supabase-cli.tar.gz" "$RUNNER_TEMP/supabase"
  test "$(supabase --version)" = 3.0.0

  # 3. Inicializar e subir stack Supabase PostgreSQL 17 isolada
  echo "Iniciando PostgreSQL 17 efêmero e isolado..."
  (cd "$STACK" && supabase init --force >/dev/null)
  sed -i 's/^major_version = .*/major_version = 17/' "$STACK/supabase/config.toml"
  sed -i "s/^project_id = .*/project_id = \"${PROJECT_ID}\"/" "$STACK/supabase/config.toml"
  (cd "$STACK" && supabase start -x realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor >/dev/null)

  CONTAINER_NAME="supabase_db_${PROJECT_ID}"
  echo "Localizando container PostgreSQL 17: $CONTAINER_NAME"
  CONTAINER_ID="$(docker ps --filter "name=^/${CONTAINER_NAME}$" --format '{{.ID}}')"
  if [[ -z "$CONTAINER_ID" ]]; then
    echo "FALHA: Container '${CONTAINER_NAME}' não foi encontrado!" >&2
    docker ps --format 'table {{.ID}}\t{{.Names}}\t{{.Image}}' >&2
    exit 1
  fi
  sudo bash scripts/rc1-25-egress-guard.sh enable "$CONTAINER_ID"
  DB_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable'
  export PGPASSWORD=postgres
fi

# Função inteligente de execução de SQL:
# Se o psql estiver disponível no host runner, usa-o diretamente.
# Caso contrário, executa via docker exec diretamente no container oficial postgresql-17.
run_sql_cmd() {
  local cmd="$1"
  if command -v psql >/dev/null 2>&1; then
    psql "$DB_URL" -v ON_ERROR_STOP=1 -Atc "$cmd"
  else
    docker exec -i "$CONTAINER_ID" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -Atc "$cmd"
  fi
}

run_sql_file() {
  local file="$1"
  local tx_opt=""
  if ! grep -qiE '^\s*BEGIN\s*;' "$file"; then
    tx_opt="--single-transaction"
  fi
  if command -v psql >/dev/null 2>&1; then
    psql "$DB_URL" -v ON_ERROR_STOP=1 $tx_opt -f "$file"
  else
    docker exec -i "$CONTAINER_ID" psql -U postgres -d postgres -v ON_ERROR_STOP=1 $tx_opt < "$file"
  fi
}

# 4. Verificar versão real do PostgreSQL no servidor
PG_VERSION="$(run_sql_cmd "SHOW server_version;")"
echo "Versão real do servidor PostgreSQL em execução: $PG_VERSION"
if [[ ! "$PG_VERSION" =~ ^17\. ]]; then
  echo "FALHA: A versão do servidor PostgreSQL não é 17.x!" >&2
  exit 1
fi

# 5. Use the synthetic fixture only in synthetic CI mode. Real-backup rehearsal retains restored rows.
if [[ "$REHEARSAL_MODE" == "true" ]]; then
  LEDGER_COUNT="$(run_sql_cmd "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version ~ '^[0-9]{8,14}$';")"
  if [[ "$LEDGER_COUNT" != "17" ]]; then
    echo "FALHA: restored historical ledger precondition expected 17 versions; found $LEDGER_COUNT." >&2
    exit 1
  fi
  CRON_VERSION="$(run_sql_cmd "SELECT extversion FROM pg_extension WHERE extname = 'pg_cron';")"
  if [[ "$CRON_VERSION" != "1.6.4" ]]; then
    echo "FALHA: restored pg_cron version does not match the approved 1.6.4 precondition." >&2
    exit 1
  fi
  echo "Restored ledger and pg_cron preconditions verified."
else
  echo "Applying synthetic fixture and base structures..."
  run_sql_file "scripts/rc1-25-test-fixture.sql" >/dev/null
  echo "Enabling pg_cron when available for synthetic M38 validation..."
  run_sql_cmd "DO \$\$ BEGIN CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog; EXCEPTION WHEN OTHERS THEN NULL; END \$\$;" || true
fi

# 6. Executar o ensaio de todas as 26 migrações pendentes em ordem cronológica estrita
echo "================================================================================"
echo "INICIANDO ENSAIO SEQUENCIAL DAS 26 MIGRATIONS PENDENTES NO POSTGRESQL 17"
echo "================================================================================"

PENDING_MIGRATIONS=(
  "supabase/migrations/20261009144200_add_visits_unique_constraint.sql"
  "supabase/migrations/20261010_create_system_settings_and_audit.sql"
  "supabase/migrations/20261011120000_create_promoter_authorizations.sql"
  "supabase/migrations/20261011140000_auto_generate_industry_code.sql"
  "supabase/migrations/20261017120000_create_contratos_lojas_table.sql"
  "supabase/migrations/20261017_create_avatars_storage_policies.sql"
  "supabase/migrations/20261018150000_add_data_inicio_operacao_to_industrias.sql"
  "supabase/migrations/20261019151754_mk9_rh_explicit_bindings.sql"
  "supabase/migrations/20261019175853_mk9_rh_admin_binding_preparation.sql"
  "supabase/migrations/20261020160000_add_whatsapp_group_link_to_industrias.sql"
  "supabase/migrations/20261020163000_mk9_faltas_atestados_prepare_permission.sql"
  "supabase/migrations/20261020170000_mk9_absence_records_outbox.sql"
  "supabase/migrations/20261021100000_mk9_rh_reconciliation.sql"
  "supabase/migrations/20261021120000_mk9_absence_attachments.sql"
  "supabase/migrations/20261022152449_mk9_date_visit_regularization_and_checkin_scope.sql"
  "supabase/migrations/20261023142837_promoter_scheduled_visit_actions.sql"
  "supabase/migrations/20261030160000_minimal_visit_regularization.sql"
  "supabase/migrations/20261105165500_m30_harden_industry_active_checkin.sql"
  "supabase/migrations/20261106131614_m30_serialize_industry_checkin.sql"
  "supabase/migrations/20261106140000_m37_pending_visit_active_route_guard.sql"
  "supabase/migrations/20261106150000_m37_checkin_route_and_conflict_guard.sql"
  "supabase/migrations/20261107140000_m37_reconcile_materialized_pending_recovery.sql"
  "supabase/migrations/20261108160835_m37_integral_weekly_recovery.sql"
  "supabase/migrations/20261110150000_m38_visit_cancellation_and_day_end_close.sql"
  "supabase/migrations/20261110160000_m38_retry_attempt_history.sql"
  "supabase/migrations/20261110170000_m38_checkin_reuses_active_scheduled_attempt.sql"
)

TOTAL_PENDING=${#PENDING_MIGRATIONS[@]}
COUNT=0

for mig in "${PENDING_MIGRATIONS[@]}"; do
  COUNT=$((COUNT + 1))
  BASE_NAME="$(basename "$mig")"
  VERSION="$(echo "$BASE_NAME" | grep -oE '^[0-9]+')"
  echo "[$COUNT/$TOTAL_PENDING] Aplicando: $BASE_NAME (versão $VERSION) com ledger em bloco atômico único ..."
  START_TS="$(date +%s%N)"
  TEMP_COMPOSED="$ROOT/composed_${VERSION}.sql"
  {
    echo "BEGIN;"
    echo "SET LOCAL lock_timeout = '3s';"
    echo "SET LOCAL statement_timeout = '60s';"
    # Remove BEGIN/COMMIT internos se existirem para encapsulamento perfeito
    sed -e 's/^[[:space:]]*BEGIN[[:space:]]*;[[:space:]]*$//I' \
        -e 's/^[[:space:]]*COMMIT[[:space:]]*;[[:space:]]*$//I' "$mig"
    echo ""
    echo "INSERT INTO supabase_migrations.schema_migrations (version) VALUES ('$VERSION') ON CONFLICT (version) DO NOTHING;"
    echo "COMMIT;"
  } > "$TEMP_COMPOSED"
  
  if command -v psql >/dev/null 2>&1; then
    psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$TEMP_COMPOSED"
  else
    docker exec -i "$CONTAINER_ID" psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$TEMP_COMPOSED"
  fi
  rm -f "$TEMP_COMPOSED"
  END_TS="$(date +%s%N)"
  DURATION_MS=$(( (END_TS - START_TS) / 1000000 ))
  echo "  ✓ Sucesso ($DURATION_MS ms - migration + ledger comitados atomicamente)"
done

echo "================================================================================"
echo "SUCESSO: Todas as 26 migrations pendentes aplicadas sem erros no PostgreSQL 17!"
echo "================================================================================"

# 7. Aplicar a migration proposta da RC1.25 com registro atômico no ledger
echo "Aplicando migration proposta RC1.25 (supabase/migrations/propostas/20261115_rc1_25_skus_and_stock_audits.sql)..."
START_RC25="$(date +%s%N)"
TEMP_RC25="$ROOT/composed_rc25.sql"
{
  echo "BEGIN;"
  echo "SET LOCAL lock_timeout = '3s';"
  echo "SET LOCAL statement_timeout = '60s';"
  sed -e 's/^[[:space:]]*BEGIN[[:space:]]*;[[:space:]]*$//I' \
      -e 's/^[[:space:]]*COMMIT[[:space:]]*;[[:space:]]*$//I' "supabase/migrations/propostas/20261115_rc1_25_skus_and_stock_audits.sql"
  echo ""
  echo "INSERT INTO supabase_migrations.schema_migrations (version) VALUES ('20261115160000') ON CONFLICT (version) DO NOTHING;"
  echo "COMMIT;"
} > "$TEMP_RC25"

if command -v psql >/dev/null 2>&1; then
  psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$TEMP_RC25"
else
  docker exec -i "$CONTAINER_ID" psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$TEMP_RC25"
fi
rm -f "$TEMP_RC25"
END_RC25="$(date +%s%N)"
DURATION_RC25_MS=$(( (END_RC25 - START_RC25) / 1000000 ))
echo "✓ Migration RC1.25 aplicada com sucesso ($DURATION_RC25_MS ms - comitada atomicamente com ledger)."

# 8. Executar a suíte de testes funcionais reais
echo "Executando suíte de testes funcionais reais (scripts/rc1-25-postgres17-validation.sql)..."
run_sql_file "scripts/rc1-25-postgres17-validation.sql"

echo "================================================================================"
echo "SUCESSO: Todos os testes funcionais da RC1.25 passaram no PostgreSQL 17 isolado!"
echo "================================================================================"
