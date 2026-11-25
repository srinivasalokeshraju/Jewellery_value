#!/bin/bash
# Setup script for the Claude Code cloud environment. The environment's "Setup script" field runs
# this file as root on Ubuntu 24.04, after the clone and before Claude Code starts, and the result
# is cached. It installs what the image lacks and the repo needs:
#   - Node from .node-version at /opt/node<major>, where the session hook puts it first on PATH.
#     The image may already ship it there; then nothing is downloaded.
#   - lsof and iproute2 (ss), which the verify skill uses to check who owns a port.
# Per-session work (PATH, npm ci, .dev.vars) is in .claude/hooks/session-start.sh. See docs/cloud-environment.md.
set -euo pipefail

NODE_MAJOR="$(cat "$(dirname "$0")/../.node-version")"
NODE_DIR="/opt/node${NODE_MAJOR}"

# Check the Node at NODE_DIR itself, not the first node on PATH, which is the image's Node 22.
if ! "$NODE_DIR/bin/node" --version 2>/dev/null | grep -q "^v${NODE_MAJOR}\."; then
  index="$(curl -fsSL https://nodejs.org/dist/index.json)"
  version="$(printf '%s' "$index" | jq -r --arg m "v${NODE_MAJOR}." '[.[] | select(.version | startswith($m))][0].version')"
  curl -fsSL "https://nodejs.org/dist/${version}/node-${version}-linux-x64.tar.xz" | tar -xJ -C /opt
  # ln -sfn cannot replace a real directory: it would nest the link inside it. Move one aside first.
  if [ -d "$NODE_DIR" ] && [ ! -L "$NODE_DIR" ]; then mv "$NODE_DIR" "$NODE_DIR.replaced"; fi
  ln -sfn "/opt/node-${version}-linux-x64" "$NODE_DIR"
fi

if ! command -v lsof >/dev/null || ! command -v ss >/dev/null; then
  apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq lsof iproute2 >/dev/null
fi

echo "cloud-setup: node $("$NODE_DIR/bin/node" --version) at $NODE_DIR/bin/node; lsof $(command -v lsof || echo missing); ss $(command -v ss || echo missing)"
