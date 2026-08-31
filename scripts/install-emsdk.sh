#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EMSDK_DIR="${EMSDK_DIR:-$ROOT/.deps/emsdk}"
# Pinned, because this repo ships the compiled engine and CI rebuilds it.
#
# `latest` meant every deploy compiled the engine with whatever emsdk was
# current that day. Emscripten 6.0.2 dropped `mainScriptUrlOrBlob` from
# INCOMING_MODULE_JS_API, and templates/pikafish.js needs it: the module is
# constructed inside a worker, where `document.currentScript` does not exist,
# so Emscripten's own `_scriptName` is undefined and every pthread worker it
# spawns becomes `new Worker(undefined)` -- a 404 for the literal path
# "undefined", a pool that never finishes loading, and a threaded core that
# answers `uci` and then never answers `readyok`.
#
# Nothing catches it. The changelog promises an error in *debug* builds, and
# this build sets ASSERTIONS=0; the Node smoke and parity suites pass, because
# Node does not take that code path; and the browser suite that would see it
# runs in ci.yml, which the Pages deploy does not wait for.
#
# 6.0.1 is the last release that still honours the key. Raising this pin means
# giving the worker the core's URL some other way -- building the core with
# -sEXPORT_ES6 and importing it, so `_scriptName` comes from `import.meta.url`,
# is the supported replacement -- and then checking `readyok` in a browser, not
# only in Node.
EMSDK_VERSION="${EMSDK_VERSION:-6.0.1}"

mkdir -p "$ROOT/.deps"

if [ ! -d "$EMSDK_DIR/.git" ]; then
  git clone https://github.com/emscripten-core/emsdk.git "$EMSDK_DIR"
fi

cd "$EMSDK_DIR"
./emsdk install "$EMSDK_VERSION"
./emsdk activate "$EMSDK_VERSION"

echo "Installed emsdk at $EMSDK_DIR"
echo "Use: source \"$EMSDK_DIR/emsdk_env.sh\""

