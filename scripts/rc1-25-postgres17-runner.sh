#!/usr/bin/env bash
# ==============================================================================
# SCRIPT DE VALIDAÇÃO REAL EM POSTGRESQL 17 ISOLADO (GITHUB ACTIONS)
# Arquivo: scripts/rc1-25-postgres17-runner.sh
# ==============================================================================
set -Eeuo pipefail

# 1. Checagem rigorosa de ausência de variáveis ou credenciais de produção/homologação
for name in SUPABASE_ACCESS_TOKEN SUPABASE_DB_PASSWORD SUPABASE_PROJECT_REF SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY SUPABASE_DB_URL SUPABASE_ANON_KEY SUPABASE_TEST_ANON_KEY SUPABASE_TEST_SERVICE_KEY ANON_KEY SERVICE_ROLE_KEY; do
  if [[ -n "${!name:-}" ]]; then
    echo "FALHA DE SEGURANÇA: Configuração ou credencial remota detectada ($name)!" >&2
    exit 1
  fi
done

ROOT="$RUNNER_TEMP/rc1-25-test"
mkdir -m 700 -p "$ROOT"
NONCE="$(node -e 'import("node:crypto").then(c => console.log(c.randomBytes(14).toString("hex")))')"
PROJECT_ID="mk9_rc25_${NONCE}"
STACK="$ROOT/stack"
mkdir -m 700 -p "$STACK"

cleanup() {
  status=$?
  if [[ -f "$STACK/supabase/config.toml" ]]; then
    echo "Desligando stack efêmero do Supabase..."
    (cd "$STACK" && supabase stop --no-backup >/dev/null 2>&1) || true
  fi
  rm -rf "$ROOT"
  exit "$status"
}
trap cleanup EXIT

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

DB_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable'
export PGPASSWORD=postgres

# 4. Verificar versão do PostgreSQL no container
PG_VERSION="$(psql "$DB_URL" -v ON_ERROR_STOP=1 -Atc "SHOW server_version;")"
echo "Versão real do PostgreSQL em execução: $PG_VERSION"
if [[ ! "$PG_VERSION" =~ ^17\. ]]; then
  echo "FALHA: A versão do PostgreSQL não é 17.x!" >&2
  exit 1
fi

# 5. Aplicar fixture sintética e migrations base pré-requisito
echo "Aplicando estrutura base e migrations existentes..."
psql "$DB_URL" -v ON_ERROR_STOP=1 -f scripts/m58-4-synthetic-fixture.sql >/dev/null

# Aplicar a migration de escopo operacional que define attendance_private e as funções base de visitas
psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261022152449_mk9_date_visit_regularization_and_checkin_scope.sql >/dev/null

# 6. Aplicar a migration proposta da RC1.25
echo "Aplicando migration proposta RC1.25 (supabase/migrations/propostas/20261115_rc1_25_skus_and_stock_audits.sql)..."
psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/propostas/20261115_rc1_25_skus_and_stock_audits.sql

echo "Migration RC1.25 aplicada com sucesso no PostgreSQL 17."

# 7. Executar a suíte de testes funcionais reais
echo "Executando suíte de testes funcionais reais (scripts/rc1-25-postgres17-validation.sql)..."
psql "$DB_URL" -v ON_ERROR_STOP=1 -f scripts/rc1-25-postgres17-validation.sql

echo "================================================================================"
echo "SUCESSO: Todos os testes funcionais da RC1.25 passaram no PostgreSQL 17 isolado!"
echo "================================================================================"
