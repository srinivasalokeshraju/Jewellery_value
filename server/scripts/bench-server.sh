#!/bin/bash
# Usage: scripts/bench-server.sh [port]. Needs `npm run dev -- --port <port>` running, and no other /mcp calls
# in the last minute, because the 50 calls must fit under the limit of 60 requests per 60 seconds.
set -euo pipefail
PORT="${1:-8787}"
URL="http://localhost:${PORT}/mcp"
CALLS=50
BODY='{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"calc_melt_value","arguments":{"metal":"gold","weight":10,"unit":"g","purity":"22K","country":"US","currency":"USD","non_metal_weight":0}}}'

curl -sf "http://localhost:${PORT}/__scheduled?cron=*+*+*+*+*" > /dev/null

times=()
for _ in $(seq 1 "$CALLS"); do
  out=$(curl -s -w '\n%{http_code} %{time_total}' -X POST "$URL" \
    -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d "$BODY")
  read -r status seconds <<< "$(tail -n 1 <<< "$out")"
  if [ "$status" != "200" ] || ! grep -q '"pure_grams"' <<< "$out"; then
    echo "call failed with HTTP $status" >&2
    exit 1
  fi
  times+=("$seconds")
done

printf '%s\n' "${times[@]}" | sort -n | awk -v n="$CALLS" '
  { ms[NR] = $1 * 1000 }
  END { printf "calls %d, median %.1f ms, min %.1f ms, max %.1f ms\n", n, (ms[int((n + 1) / 2)] + ms[int(n / 2) + 1]) / 2, ms[1], ms[n] }'
