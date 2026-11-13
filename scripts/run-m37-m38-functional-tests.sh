#!/usr/bin/env bash
set -euo pipefail

if [ "${GITHUB_ACTIONS:-}" != "true" ]; then
  echo "This controlled clock wrapper is restricted to the ephemeral GitHub-hosted runner." >&2
  exit 1
fi
if ! command -v sudo >/dev/null 2>&1 || ! command -v psql >/dev/null 2>&1; then
  echo "sudo and psql are required to validate the disposable runner and PostgreSQL clocks." >&2
  exit 1
fi

original_epoch="$(date +%s)"
original_sp_day="$(TZ=America/Sao_Paulo date +%u)"
clock_changed=0
restore_clock() {
  if [ "$clock_changed" -eq 1 ]; then
    sudo date --utc --set="@$original_epoch" >/dev/null
    echo "Ephemeral runner clock restored."
  fi
}
trap restore_clock EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

host_now_ms() { date +%s%3N; }
database_now_ms() {
  psql -X -v ON_ERROR_STOP=1 -Atqc "SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint"
}
database_sp_day() {
  psql -X -v ON_ERROR_STOP=1 -Atqc "SELECT to_char(clock_timestamp() AT TIME ZONE 'America/Sao_Paulo', 'ID')"
}
assert_close() {
  local host_ms="$1" database_ms="$2" difference
  difference=$((host_ms - database_ms))
  [ "$difference" -ge 0 ] || difference=$((-difference))
  if [ "$difference" -gt 120000 ]; then
    echo "Runner and disposable PostgreSQL clocks differ by more than two minutes." >&2
    exit 1
  fi
}

before_host_ms="$(host_now_ms)"
before_database_ms="$(database_now_ms)"
assert_close "$before_host_ms" "$before_database_ms"

if [ "$original_sp_day" = "1" ]; then
  clock_changed=1
  target_epoch=$((original_epoch + 86400))
  sudo date --utc --set="@$target_epoch" >/dev/null

  if [ "$(TZ=America/Sao_Paulo date +%u)" != "2" ]; then
    echo "Controlled clock did not move Monday to Tuesday in America/Sao_Paulo." >&2
    exit 1
  fi

  after_host_ms="$(host_now_ms)"
  after_database_ms="$(database_now_ms)"
  host_delta=$((after_host_ms - before_host_ms))
  database_delta=$((after_database_ms - before_database_ms))
  delta_difference=$((host_delta - database_delta))
  [ "$delta_difference" -ge 0 ] || delta_difference=$((-delta_difference))
  if [ "$delta_difference" -gt 120000 ]; then
    echo "PostgreSQL container did not follow the runner clock advance; refusing to run date-sensitive suites." >&2
    exit 1
  fi
  echo "Monday clock advance verified in both runner and PostgreSQL (24-hour delta)."
fi

export MK9_TEST_CLOCK_SOURCE=runner-host
host_test_day="$(TZ=America/Sao_Paulo date +%u)"
database_test_day="$(database_sp_day)"
if [ "$host_test_day" = "1" ] || [ "$database_test_day" != "$host_test_day" ]; then
  echo "Runner and PostgreSQL do not share a valid M37/M38 test date; refusing to skip scenarios." >&2
  exit 1
fi
assert_close "$(host_now_ms)" "$(database_now_ms)"
echo "M37/M38 test date verified in JavaScript and PostgreSQL (America/Sao_Paulo): $(TZ=America/Sao_Paulo date +%F)"

set +e
node scripts/m37-functional-tests.mjs
m37_status=$?
node scripts/m38-functional-tests.mjs
m38_status=$?
set -e

if [ "$m37_status" -ne 0 ] || [ "$m38_status" -ne 0 ]; then
  echo "Functional suite failure: M37 exit=$m37_status; M38 exit=$m38_status" >&2
  exit 1
fi
