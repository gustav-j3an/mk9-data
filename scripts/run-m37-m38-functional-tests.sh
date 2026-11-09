#!/usr/bin/env bash
set -euo pipefail

if [ "${GITHUB_ACTIONS:-}" != "true" ]; then
  echo "This controlled clock wrapper is restricted to the ephemeral GitHub-hosted runner." >&2
  exit 1
fi
if ! command -v sudo >/dev/null 2>&1; then
  echo "sudo is required to control the ephemeral runner clock." >&2
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

if [ "$original_sp_day" = "1" ]; then
  target_epoch=$((original_epoch + 86400))
  sudo date --utc --set="@$target_epoch" >/dev/null
  clock_changed=1
  if [ "$(TZ=America/Sao_Paulo date +%u)" != "2" ]; then
    echo "Controlled clock did not move Monday to Tuesday in America/Sao_Paulo." >&2
    exit 1
  fi
  echo "Monday detected; test clock advanced by 24 hours on the disposable runner."
fi

export MK9_TEST_CLOCK_SOURCE=runner-host
test_day="$(TZ=America/Sao_Paulo date +%u)"
if [ "$test_day" = "1" ]; then
  echo "M37/M38 test clock is still Monday; refusing to skip or weaken scenarios." >&2
  exit 1
fi
echo "M37/M38 test date (America/Sao_Paulo): $(TZ=America/Sao_Paulo date +%F)"

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
