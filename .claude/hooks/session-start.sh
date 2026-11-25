#!/bin/bash
# SessionStart hook: prepares a Claude Code cloud session for this repo.
#
# The cloud environment's setup script runs before the repo is cloned, so the per-repo work
# lives here: the root tooling deps (oxlint, prettier, playwright-core for the verify skill's
# card shots), the server deps (wrangler, vitest, tsx), and server/.dev.vars from its example.
# Chromium comes preinstalled in cloud containers (PLAYWRIGHT_BROWSERS_PATH), so nothing is
# downloaded for it. Does nothing outside cloud sessions. See docs/cloud-environment.md.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

# Put the Node from .node-version (installed by .claude/cloud-setup.sh) ahead of the image's Node 22,
# here and, through CLAUDE_ENV_FILE, in every later command of the session. Wrangler sends no metrics.
node_bin="/opt/node$(cat .node-version)/bin"
if [ -x "$node_bin/node" ]; then
  export PATH="$node_bin:$PATH"
  [ -n "${CLAUDE_ENV_FILE:-}" ] && echo "export PATH=\"$node_bin:\$PATH\"" >>"$CLAUDE_ENV_FILE"
fi
export WRANGLER_SEND_METRICS=false
[ -n "${CLAUDE_ENV_FILE:-}" ] && echo "export WRANGLER_SEND_METRICS=false" >>"$CLAUDE_ENV_FILE"

# Re-run npm ci in a folder only when its lockfile, its package.json, or this script changed.
install() {
  local dir="$1" hashes="$1/node_modules/.session-start.sha256"
  if ! sha256sum --check --status "$hashes" 2>/dev/null; then
    rm -f "$hashes"
    (cd "$dir" && npm ci --no-audit --no-fund)
    sha256sum .claude/hooks/session-start.sh "$dir/package.json" "$dir/package-lock.json" >"$hashes" || rm -f "$hashes"
  fi
}
install .
install server

# wrangler dev reads server/.dev.vars. The example holds only a placeholder, never a secret.
[ -f server/.dev.vars ] || cp server/.dev.vars.example server/.dev.vars

echo "session-start: node $(node --version); root and server deps ready; verify with .claude/skills/verify/scripts/verify.sh up" >&2
