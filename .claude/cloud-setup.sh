#!/bin/bash
# Setup script for the Claude Code cloud environment. The environment's "Setup script" field runs
# `bash .claude/cloud-setup.sh` as root on Ubuntu 24.04, after the clone and before Claude Code
# starts, and the result is cached. It installs what the image lacks and the repo needs:
#   - Node 24, the version in .node-version and CI. The image puts Node 22 on PATH.
#   - lsof and iproute2 (ss), which the verify skill uses to check who owns a port.
# Per-session work (npm ci, .dev.vars) is in .claude/hooks/session-start.sh. See docs/cloud-environment.md.
set -euo pipefail

NODE_MAJOR="$(cat "$(dirname "$0")/../.node-version")"

if ! node --version 2>/dev/null | grep -q "^v${NODE_MAJOR}\."; then
  index="$(curl -fsSL https://nodejs.org/dist/index.json)"
  version="$(printf '%s' "$index" | jq -r --arg m "v${NODE_MAJOR}." '[.[] | select(.version | startswith($m))][0].version')"
  curl -fsSL "https://nodejs.org/dist/${version}/node-${version}-linux-x64.tar.xz" | tar -xJ -C /opt
  ln -sfn "/opt/node-${version}-linux-x64" "/opt/node${NODE_MAJOR}"
  for bin in node npm npx corepack; do ln -sf "/opt/node${NODE_MAJOR}/bin/${bin}" "/usr/local/bin/${bin}"; done
fi

if ! command -v lsof >/dev/null || ! command -v ss >/dev/null; then
  apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq lsof iproute2 >/dev/null
fi

echo "cloud-setup: node $(node --version) at $(command -v node); lsof $(command -v lsof || echo missing); ss $(command -v ss || echo missing)"
