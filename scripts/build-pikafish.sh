#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPSTREAM_DIR="${PIKAFISH_UPSTREAM_DIR:-$ROOT/.deps/pikafish}"
UPSTREAM_URL="${PIKAFISH_UPSTREAM_URL:-https://github.com/official-pikafish/Pikafish}"
# Keep CI/CD reproducible. Update this only after refreshing
# patches/pikafish-wasm.patch and public/pikafish.nnue together.
UPSTREAM_REF="${PIKAFISH_UPSTREAM_REF:-beeca5cc785ceb2026c5f9248f6e057573b12906}"
EMSDK_DIR="${EMSDK_DIR:-$ROOT/.deps/emsdk}"
DIST_DIR="$ROOT/dist"
PUBLIC_DIR="$ROOT/public"
PATCH_FILE="$ROOT/patches/pikafish-wasm.patch"
WASM_PROFILE="${WASM_PROFILE-release}"
WASM_ALLOW_MEMORY_GROWTH="${WASM_ALLOW_MEMORY_GROWTH-yes}"
WASM_INITIAL_MEMORY="${WASM_INITIAL_MEMORY:-134217728}"
WASM_MAXIMUM_MEMORY="${WASM_MAXIMUM_MEMORY:-2147483648}"
WASM_STACK_SIZE="${WASM_STACK_SIZE:-8388608}"
WASM_DEFAULT_PTHREAD_STACK_SIZE="${WASM_DEFAULT_PTHREAD_STACK_SIZE:-$WASM_STACK_SIZE}"
WASM_PTHREAD_POOL_SIZE="${WASM_PTHREAD_POOL_SIZE:-12}"
WASM_ENABLE_LTO="${WASM_ENABLE_LTO-yes}"
WASM_DISABLE_RTTI="${WASM_DISABLE_RTTI-yes}"
WASM_BUILD_SIMD="${WASM_BUILD_SIMD-yes}"
case "$WASM_BUILD_SIMD" in
  yes|no) ;;
  *) echo "WASM_BUILD_SIMD must be yes or no." >&2; exit 2 ;;
esac
case "$WASM_PROFILE" in
  release|debug) ;;
  *) echo "WASM_PROFILE must be release or debug." >&2; exit 2 ;;
esac
for build_flag in WASM_ALLOW_MEMORY_GROWTH WASM_ENABLE_LTO WASM_DISABLE_RTTI; do
  case "${!build_flag}" in
    yes|no|true|false|1|0) ;;
    *) echo "$build_flag must be yes/no, true/false, or 1/0." >&2; exit 2 ;;
  esac
done

mkdir -p "$ROOT/.deps" "$DIST_DIR" "$PUBLIC_DIR"

if [ ! -d "$UPSTREAM_DIR/.git" ]; then
  rm -rf "$UPSTREAM_DIR"
  git clone --no-checkout "$UPSTREAM_URL" "$UPSTREAM_DIR"
else
  git -C "$UPSTREAM_DIR" remote set-url origin "$UPSTREAM_URL"
fi

echo "Using Pikafish upstream ref $UPSTREAM_REF"
git -C "$UPSTREAM_DIR" fetch --depth=1 origin "$UPSTREAM_REF"
git -C "$UPSTREAM_DIR" checkout --force --detach FETCH_HEAD
git -C "$UPSTREAM_DIR" clean -fdx

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

# Compile and assemble the complete requested build before changing files
# served by Vite or dist/. A failed later flavor must not publish a mixed build.
STAGE_DIR="$(mktemp -d "$ROOT/.deps/pikafish-artifacts.XXXXXX")"
trap 'rm -rf "$STAGE_DIR"' EXIT
STAGED_DIST_DIR="$STAGE_DIR/dist"
STAGED_PUBLIC_DIR="$STAGE_DIR/public"
mkdir -p "$STAGED_DIST_DIR" "$STAGED_PUBLIC_DIR"

# Upstream config-sanity runs net.sh for every flavor. git clean removed its
# ignored network; reuse our pinned weights instead of downloading master-net
# only to discard that download when publishing the public copy below.
if [ -f "$PUBLIC_DIR/pikafish.nnue" ]; then
  cp "$PUBLIC_DIR/pikafish.nnue" "$UPSTREAM_DIR/src/pikafish.nnue"
fi

build_flavor() {
  local flavor="$1"
  local simd="$2"
  local single_threaded="no"
  local -a args

  if [ "$flavor" = "single" ]; then
    single_threaded="yes"
  fi

  args=(
    -C "$UPSTREAM_DIR/src" -j"$JOBS"
    ARCH=wasm NO_SYZYGY=yes debug=no optimize=no WASM_PROFILE="$WASM_PROFILE"
    WASM_SINGLE_THREADED="$single_threaded" WASM_SIMD="$simd"
    WASM_ALLOW_MEMORY_GROWTH="$WASM_ALLOW_MEMORY_GROWTH"
    WASM_INITIAL_MEMORY="$WASM_INITIAL_MEMORY"
    WASM_MAXIMUM_MEMORY="$WASM_MAXIMUM_MEMORY"
    WASM_STACK_SIZE="$WASM_STACK_SIZE"
    WASM_DEFAULT_PTHREAD_STACK_SIZE="$WASM_DEFAULT_PTHREAD_STACK_SIZE"
    WASM_PTHREAD_POOL_SIZE="$WASM_PTHREAD_POOL_SIZE"
    WASM_ENABLE_LTO="$WASM_ENABLE_LTO"
    WASM_DISABLE_RTTI="$WASM_DISABLE_RTTI"
  )

  # Both modes must be explicit, including "no": inherited per-flavor settings
  # otherwise change the output name and can leave the requested core missing.
  make "${args[@]}" objclean >/dev/null
  args+=(build)
  make "${args[@]}"
}

copy_flavor_artifacts() {
  local base="$1"
  local target_dir

  for target_dir in "$STAGED_DIST_DIR" "$STAGED_PUBLIC_DIR"; do
    cp "$UPSTREAM_DIR/src/${base}.js" "$target_dir/${base}.js"
    cp "$UPSTREAM_DIR/src/${base}.wasm" "$target_dir/${base}.wasm"
  done
  if [ -f "$UPSTREAM_DIR/src/${base}.worker.js" ]; then
    cp "$UPSTREAM_DIR/src/${base}.worker.js" "$STAGED_DIST_DIR/${base}.worker.js"
    cp "$UPSTREAM_DIR/src/${base}.worker.js" "$STAGED_PUBLIC_DIR/${base}.worker.js"
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

if ! has_text 'const BUILD_HAS_SIMD = true;' "$ROOT/templates/pikafish.js"; then
  echo "Wrapper template is missing its BUILD_HAS_SIMD configuration marker." >&2
  exit 1
fi
if [ "$WASM_BUILD_SIMD" = "no" ]; then
  sed 's/const BUILD_HAS_SIMD = true;/const BUILD_HAS_SIMD = false;/' "$ROOT/templates/pikafish.js" > "$STAGED_DIST_DIR/pikafish.js"
else
  cp "$ROOT/templates/pikafish.js" "$STAGED_DIST_DIR/pikafish.js"
fi
cp "$STAGED_DIST_DIR/pikafish.js" "$STAGED_PUBLIC_DIR/pikafish.js"
for notice_file in THIRD_PARTY_NOTICES.md Pikafish-Copying.txt; do
  if [ -f "$PUBLIC_DIR/$notice_file" ]; then
    cp "$PUBLIC_DIR/$notice_file" "$STAGED_DIST_DIR/$notice_file"
  fi
done
cp "$ROOT/demo/"*.html "$STAGED_DIST_DIR/"
if [ -f "$ROOT/demo/sw.js" ]; then
  cp "$ROOT/demo/sw.js" "$STAGED_DIST_DIR/sw.js"
fi
NNUE_SOURCE="$UPSTREAM_DIR/src/pikafish.nnue"
if [ -f "$PUBLIC_DIR/pikafish.nnue" ]; then
  NNUE_SOURCE="$PUBLIC_DIR/pikafish.nnue"
fi
cp "$NNUE_SOURCE" "$STAGED_DIST_DIR/pikafish.nnue"
if [ "$NNUE_SOURCE" != "$PUBLIC_DIR/pikafish.nnue" ]; then
  cp "$NNUE_SOURCE" "$STAGED_PUBLIC_DIR/pikafish.nnue"
fi
node "$ROOT/scripts/write-engine-manifest.cjs" "$STAGED_DIST_DIR"
cp "$STAGED_DIST_DIR/engine-assets.json" "$STAGED_PUBLIC_DIR/engine-assets.json"

# Mark dist/ as CJS so Node.js doesn't treat pikafish.js as ES module
# (root package.json has "type":"module" but pikafish.js uses module.exports)
echo '{"type":"commonjs"}' > "$STAGED_DIST_DIR/package.json"

cp "$STAGED_DIST_DIR/"* "$DIST_DIR/"
cp "$STAGED_PUBLIC_DIR/"* "$PUBLIC_DIR/"

# Remove skipped outputs only after successful compilation/staging/publication.
# The published scalar wrapper will not request them even on SIMD-capable hosts.
if [ "$WASM_BUILD_SIMD" = "no" ]; then
  for target_dir in "$DIST_DIR" "$PUBLIC_DIR"; do
    for base in pikafish-core-simd pikafish-core-single-simd; do
      rm -f "$target_dir/$base.js" "$target_dir/$base.wasm" "$target_dir/$base.worker.js"
    done
  done
fi

echo "Built artifacts in $DIST_DIR"
