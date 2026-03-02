#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPSTREAM_DIR="${PIKAFISH_UPSTREAM_DIR:-$ROOT/.deps/pikafish}"
EMSDK_DIR="${EMSDK_DIR:-$ROOT/.deps/emsdk}"
DIST_DIR="$ROOT/dist"
PATCH_FILE="$ROOT/patches/pikafish-wasm.patch"
WASM_PROFILE="${WASM_PROFILE:-release}"
WASM_ALLOW_MEMORY_GROWTH="${WASM_ALLOW_MEMORY_GROWTH:-yes}"
WASM_INITIAL_MEMORY="${WASM_INITIAL_MEMORY:-134217728}"
WASM_MAXIMUM_MEMORY="${WASM_MAXIMUM_MEMORY:-2147483648}"
WASM_STACK_SIZE="${WASM_STACK_SIZE:-8388608}"
WASM_DEFAULT_PTHREAD_STACK_SIZE="${WASM_DEFAULT_PTHREAD_STACK_SIZE:-$WASM_STACK_SIZE}"
WASM_PTHREAD_POOL_SIZE="${WASM_PTHREAD_POOL_SIZE:-8}"
WASM_ENABLE_LTO="${WASM_ENABLE_LTO:-yes}"
WASM_DISABLE_RTTI="${WASM_DISABLE_RTTI:-yes}"

mkdir -p "$ROOT/.deps" "$DIST_DIR"

if [ ! -d "$UPSTREAM_DIR/.git" ]; then
  git clone --depth=1 https://github.com/official-pikafish/Pikafish "$UPSTREAM_DIR"
fi

mkdir -p "$UPSTREAM_DIR/src/emscripten"
cp "$ROOT/templates/emscripten/wasm-makefile.mk" "$UPSTREAM_DIR/src/emscripten/wasm-makefile.mk"
cp "$ROOT/templates/emscripten/pre.js" "$UPSTREAM_DIR/src/emscripten/pre.js"

has_text() {
  local needle="$1"
  local file="$2"
  if command -v rg >/dev/null 2>&1; then
    rg -q --fixed-strings "$needle" "$file"
  else
    grep -Fq -- "$needle" "$file"
  fi
}

if ! has_text 'extern "C" void command' "$UPSTREAM_DIR/src/main.cpp"; then
  if git -C "$UPSTREAM_DIR" apply --check "$PATCH_FILE" >/dev/null 2>&1; then
    git -C "$UPSTREAM_DIR" apply "$PATCH_FILE"
  elif git -C "$UPSTREAM_DIR" apply --reverse --check "$PATCH_FILE" >/dev/null 2>&1; then
    echo "Pikafish patch already applied; continuing."
  else
    echo "Failed to apply $PATCH_FILE to $UPSTREAM_DIR (upstream source may have changed)." >&2
    echo "Try removing $UPSTREAM_DIR and rerunning, or update patches/pikafish-wasm.patch." >&2
    exit 1
  fi
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
WASM_BUILD_SIMD="${WASM_BUILD_SIMD:-yes}"

build_flavor() {
  local flavor="$1"
  local simd="$2"
  local -a args

  args=(
    -C "$UPSTREAM_DIR/src" -j"$JOBS"
    ARCH=wasm NO_SYZYGY=yes debug=no optimize=no WASM_PROFILE="$WASM_PROFILE"
    WASM_ALLOW_MEMORY_GROWTH="$WASM_ALLOW_MEMORY_GROWTH"
    WASM_INITIAL_MEMORY="$WASM_INITIAL_MEMORY"
    WASM_MAXIMUM_MEMORY="$WASM_MAXIMUM_MEMORY"
    WASM_STACK_SIZE="$WASM_STACK_SIZE"
    WASM_DEFAULT_PTHREAD_STACK_SIZE="$WASM_DEFAULT_PTHREAD_STACK_SIZE"
    WASM_PTHREAD_POOL_SIZE="$WASM_PTHREAD_POOL_SIZE"
    WASM_ENABLE_LTO="$WASM_ENABLE_LTO"
    WASM_DISABLE_RTTI="$WASM_DISABLE_RTTI"
  )

  if [ "$flavor" = "single" ]; then
    args+=(WASM_SINGLE_THREADED=yes)
  fi
  if [ "$simd" = "yes" ]; then
    args+=(WASM_SIMD=yes)
  fi

  make -C "$UPSTREAM_DIR/src" ARCH=wasm NO_SYZYGY=yes objclean >/dev/null
  args+=(build)
  make "${args[@]}"
}

copy_flavor_artifacts() {
  local base="$1"
  cp "$UPSTREAM_DIR/src/${base}.js" "$DIST_DIR/${base}.js"
  cp "$UPSTREAM_DIR/src/${base}.wasm" "$DIST_DIR/${base}.wasm"
  if [ -f "$UPSTREAM_DIR/src/${base}.worker.js" ]; then
    cp "$UPSTREAM_DIR/src/${base}.worker.js" "$DIST_DIR/${base}.worker.js"
  fi
}

build_flavor threaded no
copy_flavor_artifacts pikafish-core

if [ "$WASM_BUILD_SIMD" = "yes" ]; then
  build_flavor threaded yes
  copy_flavor_artifacts pikafish-core-simd
fi

build_flavor single no
copy_flavor_artifacts pikafish-core-single

if [ "$WASM_BUILD_SIMD" = "yes" ]; then
  build_flavor single yes
  copy_flavor_artifacts pikafish-core-single-simd
fi

cp "$ROOT/templates/pikafish.js" "$DIST_DIR/pikafish.js"
cp "$ROOT/demo/"*.html "$DIST_DIR/"
if [ -f "$ROOT/demo/sw.js" ]; then
  cp "$ROOT/demo/sw.js" "$DIST_DIR/sw.js"
fi
cp "$UPSTREAM_DIR/src/pikafish.nnue" "$DIST_DIR/pikafish.nnue"

echo "Built artifacts in $DIST_DIR"
