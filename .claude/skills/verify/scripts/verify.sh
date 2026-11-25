#!/usr/bin/env bash
# Drive a private local melt-value Worker and keep the proof.
# Usage: verify.sh up | doctor | env | call <tool> '<json>' [label] | skills [2026] | scheduled | kv | cards | logs [n] | down
# Each `up` starts a run at <repo>/.verify/<run-id>/. Evidence goes to evidence/, scratch state to scratch/.
# `down` stops only the process groups this run started and deletes scratch/. It keeps evidence/.
# Set VERIFY_RUN=<run-id> to act on a run other than the latest.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
SERVER="$REPO/server"
ROOT="$REPO/.verify"

die() { echo "verify: $*" >&2; exit 1; }

free_port() { node -e "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})"; }

run_dir() {
  local id="${VERIFY_RUN:-}"
  [[ -z "$id" && -f "$ROOT/current" ]] && id="$(cat "$ROOT/current")"
  [[ -n "$id" && -d "$ROOT/$id" ]] || die "no run. Start one with: verify.sh up"
  echo "$ROOT/$id"
}

load() {
  RUN="$(run_dir)"
  EVIDENCE="$RUN/evidence"
  SCRATCH="$RUN/scratch"
  # shellcheck disable=SC1091
  source "$RUN/state"
  BASE="http://127.0.0.1:$PORT"
  URL="$BASE/mcp"
}

alive() { [[ -n "${1:-}" ]] && kill -0 "$1" 2>/dev/null; }

# The pid listening on a TCP port: lsof on macOS, ss on Linux cloud containers, which lack lsof.
listener_pid() {
  if command -v lsof >/dev/null; then
    lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | head -n 1
  elif command -v ss >/dev/null; then
    ss -ltnpH "sport = :$1" 2>/dev/null | grep -o 'pid=[0-9]*' | head -n 1 | cut -d= -f2
  else
    die "need lsof or ss to check who owns port $1"
  fi
}

next_file() {
  local label="$1" n
  n="$(find "$EVIDENCE" -maxdepth 1 -type f -name '[0-9][0-9]-*' | wc -l | tr -d ' ')"
  printf '%s/%02d-%s.json' "$EVIDENCE" "$((n + 1))" "$label"
}

cmd_up() {
  [[ -d "$SERVER/node_modules" ]] || die "run 'npm ci' in server/ first"
  local id port inspector run
  id="$(date +%Y%m%d-%H%M%S)-$$"
  run="$ROOT/$id"
  mkdir -p "$run/evidence" "$run/scratch/state"
  port="$(free_port)"
  inspector="$(free_port)"
  cd "$SERVER"
  set -m
  nohup npx wrangler dev --ip 127.0.0.1 --port "$port" --inspector-port "$inspector" \
    --persist-to "$run/scratch/state" --test-scheduled --show-interactive-dev-session=false \
    >"$run/evidence/worker.log" 2>&1 </dev/null &
  local pid=$!
  set +m
  printf 'PORT=%s\nINSPECTOR=%s\nWORKER_PGID=%s\nCARDS_PGID=\nCARDS_PORT=\n' "$port" "$inspector" "$pid" >"$run/state"
  echo "$id" >"$ROOT/current"
  for _ in $(seq 1 120); do
    grep -q "Ready on http://127.0.0.1:$port" "$run/evidence/worker.log" && break
    alive "$pid" || { tail -n 30 "$run/evidence/worker.log" >&2; die "wrangler exited before it was ready"; }
    sleep 0.5
  done
  grep -q "Ready on http://127.0.0.1:$port" "$run/evidence/worker.log" || die "not ready after 60 s; see $run/evidence/worker.log"
  VERIFY_RUN="$id" cmd_doctor
  echo "up   run $id at http://127.0.0.1:$port/mcp"
}

cmd_doctor() {
  load
  alive "$WORKER_PGID" || die "worker group $WORKER_PGID is not running. Start a new run with: verify.sh up"
  local listener pgid
  listener="$(listener_pid "$PORT")"
  [[ -n "$listener" ]] || die "nothing listens on port $PORT"
  pgid="$(ps -o pgid= -p "$listener" | tr -d ' ')"
  [[ "$pgid" == "$WORKER_PGID" ]] || die "port $PORT belongs to pid $listener (group $pgid), not this run's group $WORKER_PGID"
  (cd "$SERVER" && npx tsx scripts/verify-mcp.ts doctor "$URL") >"$EVIDENCE/doctor.json" || { cat "$EVIDENCE/doctor.json" >&2; die "doctor found problems"; }
  echo "ok   port $PORT owned by this run's group $WORKER_PGID; 4 tools with titles, readOnlyHint, and cards"
}

cmd_env() {
  load
  printf 'RUN=%s\nEVIDENCE=%s\nPERSIST=%s\nBASE=%s\nURL=%s\n' "$RUN" "$EVIDENCE" "$SCRATCH/state" "$BASE" "$URL"
}

cmd_call() {
  load
  local tool="${1:?usage: verify.sh call <tool> '<json>' [label]}" json="${2:-"{}"}" label="${3:-$1}" out
  out="$(next_file "$label")"
  (cd "$SERVER" && npx tsx scripts/verify-mcp.ts call "$URL" "$tool" "$json") >"$out"
  cat "$out"
  echo "saved $out" >&2
}

cmd_skills() {
  load
  local pin="${1:-}" out
  [[ -z "$pin" || "$pin" == "2026" ]] || die "usage: verify.sh skills [2026]"
  out="$(next_file "skills${pin:+-$pin}")"
  (cd "$SERVER" && npx tsx scripts/verify-mcp.ts skills "$URL" $pin) >"$out" || { cat "$out" >&2; die "skills found problems; see $out"; }
  cat "$out"
  echo "saved $out" >&2
}

cmd_scheduled() {
  load
  local out
  out="$(next_file scheduled)"
  curl -sS "$BASE/__scheduled?cron=*+*+*+*+*" >/dev/null
  sleep 2
  grep '"event":"cache_warm"' "$EVIDENCE/worker.log" | tail -n 1 >"$out" || die "no cache_warm line in the log yet; wait and run 'verify.sh logs'"
  cat "$out"
  echo "saved $out" >&2
}

cmd_kv() {
  load
  local out
  out="$(next_file kv)"
  (cd "$SERVER" && npx wrangler kv key list --binding RATES --local --persist-to "$SCRATCH/state") >"$out"
  cat "$out"
  echo "saved $out" >&2
}

cmd_cards() {
  load
  if ! alive "$CARDS_PGID"; then
    (cd "$SERVER" && npm run --silent ui:preview) >"$EVIDENCE/cards-build.log"
    mkdir -p "$EVIDENCE/cards"
    cp "$SERVER/.preview/index.html" "$EVIDENCE/cards/index.html"
    CARDS_PORT="$(free_port)"
    set -m
    nohup python3 -m http.server "$CARDS_PORT" --bind 127.0.0.1 --directory "$EVIDENCE/cards" >"$SCRATCH/cards.log" 2>&1 </dev/null &
    CARDS_PGID=$!
    set +m
    sed -i.bak -e "s/^CARDS_PGID=.*/CARDS_PGID=$CARDS_PGID/" -e "s/^CARDS_PORT=.*/CARDS_PORT=$CARDS_PORT/" "$RUN/state" && rm -f "$RUN/state.bak"
    for _ in $(seq 1 20); do curl -sf "http://127.0.0.1:$CARDS_PORT/index.html" >/dev/null && break; sleep 0.25; done
  fi
  echo "cards http://127.0.0.1:$CARDS_PORT/index.html"
  node "$REPO/.claude/skills/verify/scripts/shoot-cards.mjs" "http://127.0.0.1:$CARDS_PORT/index.html" "$EVIDENCE/cards"
}

cmd_logs() {
  load
  tail -n "${1:-40}" "$EVIDENCE/worker.log"
}

stop_group() {
  local pgid="$1"
  alive "$pgid" || return 0
  kill -TERM -- "-$pgid" 2>/dev/null || true
  for _ in $(seq 1 20); do alive "$pgid" || return 0; sleep 0.25; done
  kill -KILL -- "-$pgid" 2>/dev/null || true
}

cmd_down() {
  load
  stop_group "$WORKER_PGID"
  stop_group "$CARDS_PGID"
  rm -rf "$SCRATCH"
  echo "down run $(basename "$RUN"); evidence kept at $EVIDENCE"
}

case "${1:-}" in
  up) cmd_up ;;
  doctor) cmd_doctor ;;
  env) cmd_env ;;
  call) shift; cmd_call "$@" ;;
  skills) shift; cmd_skills "$@" ;;
  scheduled) cmd_scheduled ;;
  kv) cmd_kv ;;
  cards) cmd_cards ;;
  logs) shift; cmd_logs "$@" ;;
  down) cmd_down ;;
  *) sed -n '2,6p' "$0" | sed 's/^# //'; exit 2 ;;
esac
