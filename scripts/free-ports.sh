#!/usr/bin/env bash
# Kill whatever is holding the dev ports.
#
# A stale `node src/index.js` on 3001 keeps serving old code and silently
# ignores your edits, which is a confusing way to lose half an hour.
#
# macOS/Linux only — depends on lsof.
set -uo pipefail

freed=0
for port in 3001 57935; do
  pids=$(lsof -ti:"$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "  killing $(echo "$pids" | tr '\n' ' ')on :$port"
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    freed=1
  fi
done

if [ "$freed" -eq 0 ]; then
  echo "  ports 3001 and 57935 are already free"
fi
