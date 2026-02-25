#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPSTREAM_DIR="${PIKAFISH_UPSTREAM_DIR:-$ROOT/.deps/pikafish}"
EMSDK_DIR="${EMSDK_DIR:-$ROOT/.deps/emsdk}"
DIST_DIR="$ROOT/dist"
PATCH_FILE="$ROOT/patches/pikafish-wasm.patch"
WASM_PROFILE="${WASM_PROFILE:-release}"

mkdir -p "$ROOT/.deps" "$DIST_DIR"

if [ ! -d "$UPSTREAM_DIR/.git" ]; then
  git clone --depth=1 https://github.com/official-pikafish/Pikafish "$UPSTREAM_DIR"
fi

mkdir -p "$UPSTREAM_DIR/src/emscripten"
cp "$ROOT/templates/emscripten/wasm-makefile.mk" "$UPSTREAM_DIR/src/emscripten/wasm-makefile.mk"
cp "$ROOT/templates/emscripten/pre.js" "$UPSTREAM_DIR/src/emscripten/pre.js"

if ! rg -q 'extern "C" void command' "$UPSTREAM_DIR/src/main.cpp"; then
  git -C "$UPSTREAM_DIR" apply "$PATCH_FILE"
fi

if command -v emcc >/dev/null 2>&1; then
  :
elif [ -f "$EMSDK_DIR/emsdk_env.sh" ]; then
  # shellcheck disable=SC1090
  source "$EMSDK_DIR/emsdk_env.sh"
else
  echo "emcc not found. Install emsdk (see scripts/install-emsdk.sh) or set EMSDK_DIR." >&2
  exit 1
fi

JOBS="${JOBS:-$(getconf _NPROCESSORS_ONLN 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}"

build_flavor() {
  local flavor="$1"
  local -a args

  args=(
    -C "$UPSTREAM_DIR/src" -j"$JOBS"
    ARCH=wasm NO_SYZYGY=yes debug=no optimize=no WASM_PROFILE="$WASM_PROFILE"
  )

  if [ "$flavor" = "single" ]; then
    args+=(WASM_SINGLE_THREADED=yes)
  fi

  make -C "$UPSTREAM_DIR/src" ARCH=wasm NO_SYZYGY=yes objclean >/dev/null
  args+=(build)
  make "${args[@]}"
}

build_flavor threaded
cp "$UPSTREAM_DIR/src/pikafish-core.js" "$DIST_DIR/pikafish-core.js"
cp "$UPSTREAM_DIR/src/pikafish-core.wasm" "$DIST_DIR/pikafish-core.wasm"
if [ -f "$UPSTREAM_DIR/src/pikafish-core.worker.js" ]; then
  cp "$UPSTREAM_DIR/src/pikafish-core.worker.js" "$DIST_DIR/pikafish-core.worker.js"
fi

build_flavor single
cp "$UPSTREAM_DIR/src/pikafish-core-single.js" "$DIST_DIR/pikafish-core-single.js"
cp "$UPSTREAM_DIR/src/pikafish-core-single.wasm" "$DIST_DIR/pikafish-core-single.wasm"
if [ -f "$UPSTREAM_DIR/src/pikafish-core-single.worker.js" ]; then
  cp "$UPSTREAM_DIR/src/pikafish-core-single.worker.js" "$DIST_DIR/pikafish-core-single.worker.js"
fi

cp "$ROOT/templates/pikafish.js" "$DIST_DIR/pikafish.js"
cp "$ROOT/demo/index.html" "$DIST_DIR/index.html"
cp "$UPSTREAM_DIR/src/pikafish.nnue" "$DIST_DIR/pikafish.nnue"

echo "Built artifacts in $DIST_DIR"
