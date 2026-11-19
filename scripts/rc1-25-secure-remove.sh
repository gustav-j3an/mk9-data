#!/usr/bin/env bash
# Best-effort overwrite of temporary regular files before removal.
set -Eeuo pipefail
for target in "$@"; do
  [[ -e "$target" || -L "$target" ]] || continue
  if [[ -d "$target" && ! -L "$target" ]]; then
    find "$target" -type f -exec shred -n 1 -z -u -- {} + 2>/dev/null || true
    rm -rf -- "$target"
  elif [[ -f "$target" ]]; then
    shred -n 1 -z -u -- "$target" 2>/dev/null || rm -f -- "$target"
  else
    rm -f -- "$target"
  fi
done
