# web-xiangqi

`pikafish.js` / `pikafish.wasm` style build pipeline for Xiangqi, based on upstream [Pikafish](https://github.com/official-pikafish/Pikafish) + Emscripten.

## Status

Working end-to-end in Node.js and ready for browser demo use (tested on macOS arm64):

- builds WASM from upstream `Pikafish`
- outputs both flavors:
  - threaded WASM (`pikafish-core.js/.wasm`) for cross-origin-isolated browser/Node use
  - single-thread fallback WASM (`pikafish-core-single.js/.wasm`) for non-isolated browsers
- loads `pikafish.nnue` into Emscripten FS
- speaks UCI through a JS `postMessage()`-style wrapper
- wrapper auto-selects threaded vs single-thread in browser (`variant: "auto"`)
- smoke tests pass for both flavors (`threaded` and `single`)

## What this repo contains

- `patches/pikafish-wasm.patch`: upstream patch set (Makefile + Emscripten UCI/runtime compatibility)
- `templates/emscripten/*`: Emscripten build overrides injected into upstream `Pikafish`
- `templates/pikafish.js`: JS wrapper with auto flavor selection + NNUE loading
- `scripts/build-pikafish.sh`: clone, patch, build, copy artifacts to `dist/`
- `scripts/test-smoke.js`: Node smoke tests for threaded/single flavors
- `scripts/serve-demo.js`: local static server with COOP/COEP headers
- `demo/index.html`: browser demo UI and thread/header checks

## Quick start

1. Install emsdk locally (once):

```bash
bash scripts/install-emsdk.sh
```

2. Build artifacts:

```bash
npm run build
```

3. Run smoke tests:

```bash
npm run test:smoke:all
```

4. Run the browser demo (with correct headers for threaded WASM):

```bash
npm run serve:demo
# open http://localhost:8080
```

Artifacts are written to `dist/`:

- `dist/pikafish.js` (wrapper)
- `dist/pikafish-core.js` / `dist/pikafish-core.wasm` (threaded)
- `dist/pikafish-core-single.js` / `dist/pikafish-core-single.wasm` (fallback)
- `dist/pikafish-core.worker.js` (pthread worker; if generated)
- `dist/pikafish.nnue`
- `dist/index.html` (browser demo)

## Notes

- Default build now uses a release-style Emscripten profile (`WASM_PROFILE=release`) while keeping Pikafish's host-specific `optimize` path disabled (`optimize=no`) to avoid upstream LTO/clang incompatibilities on current Emscripten.
- Browser threaded mode requires cross-origin isolation (`COOP`/`COEP`). `npm run serve:demo` sets these headers for local testing.
- Browser demo shows header/thread support status and lets you force `threaded`, `single`, or use `auto`.
- Wrapper usage supports `variant: "auto" | "threaded" | "single"`.

## Future improvements

- Add a dedicated worker-based browser API helper in `pikafish.js` (so single-thread fallback doesn't block the main thread)
- Add minified production bundle variants and optional WASM compression
- Add benchmark/regression CI for both flavors
