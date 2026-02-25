#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EMSDK_DIR="${EMSDK_DIR:-$ROOT/.deps/emsdk}"
EMSDK_VERSION="${EMSDK_VERSION:-latest}"

mkdir -p "$ROOT/.deps"

if [ ! -d "$EMSDK_DIR/.git" ]; then
  git clone https://github.com/emscripten-core/emsdk.git "$EMSDK_DIR"
fi

cd "$EMSDK_DIR"
./emsdk install "$EMSDK_VERSION"
./emsdk activate "$EMSDK_VERSION"

echo "Installed emsdk at $EMSDK_DIR"
echo "Use: source \"$EMSDK_DIR/emsdk_env.sh\""

