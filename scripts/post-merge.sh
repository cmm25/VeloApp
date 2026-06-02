#!/bin/bash
set -e

# Post-merge setup for the Velo monorepo. Re-installs Node dependencies for
# each separate npm project so newly merged dependencies are available.
# Idempotent and non-interactive (stdin is closed during merge setup).

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

install_node() {
  dir="$1"
  if [ -f "$ROOT/$dir/package.json" ]; then
    echo "==> npm install in $dir"
    (cd "$ROOT/$dir" && npm install --no-audit --no-fund)
  fi
}

install_node "."
install_node "Velo"
install_node "lib/velo-agents"

echo "==> post-merge setup complete"
