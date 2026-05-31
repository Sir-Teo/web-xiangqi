# web-xiangqi

`pikafish.js` / `pikafish.wasm` style build pipeline for Xiangqi, based on upstream [Pikafish](https://github.com/official-pikafish/Pikafish) + Emscripten.

## Status

Working end-to-end in Node.js and ready for browser analysis-app use (tested on macOS arm64):

- builds WASM from upstream `Pikafish`
- outputs both flavors:
  - threaded WASM (`pikafish-core.js/.wasm`) for cross-origin-isolated browser/Node use
  - single-thread fallback WASM (`pikafish-core-single.js/.wasm`) for non-isolated browsers
- loads `pikafish.nnue` into Emscripten FS
- speaks UCI through a JS `postMessage()`-style wrapper
- wrapper auto-selects threaded vs single-thread in browser (`variant: "auto"`)
- smoke tests pass for both flavors (`threaded` and `single`)
- React app includes legal move validation, a move tree, review annotations, WDL/eval views, saved games, historical games, and opening-book continuations

## What this repo contains

- `patches/pikafish-wasm.patch`: upstream patch set (Makefile + Emscripten UCI/runtime compatibility)
- `templates/emscripten/*`: Emscripten build overrides injected into upstream `Pikafish`
- `templates/pikafish.js`: JS wrapper with auto flavor selection, NNUE loading, and browser worker helper (`createWorkerEngine`)
- `scripts/build-pikafish.sh`: clone, patch, build, copy artifacts to `dist/`
- `scripts/test-smoke.cjs`: Node smoke tests for threaded/single flavors
- `scripts/serve-demo.cjs`: local static server with COOP/COEP headers
- `demo/index.html`: simple playable Xiangqi board UI + engine controls (worker-based)
- `src/`: production React analysis app with board, engine, review, library, and opening-study UI

## Quick start

1. Install emsdk locally (once):

```bash
bash scripts/install-emsdk.sh
```

2. Build artifacts:

```bash
npm run build
```

If you want a completely clean/reproducible rebuild (recommended after patch/build failures), remove the cached upstream checkout first:

```bash
rm -rf .deps/pikafish
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

Note: `npm run serve:demo` serves files already in `dist/` and does not rebuild automatically.

## React app QA

The Vite/React analysis app can be checked without rebuilding Pikafish:

```bash
npm install
npm run build:react
npm run test:library
npm run test:openings
npm run test:ui:install   # once per machine
npm run test:ui:layout
```

`npm run build:react` cleans only the React HTML/assets/favicon from `dist/` before building, preserving the checked-in Pikafish JS/WASM/NNUE artifacts.

Artifacts are written to `dist/`:

- `dist/pikafish.js` (wrapper)
- `dist/pikafish-core.js` / `dist/pikafish-core.wasm` (threaded)
- `dist/pikafish-core-single.js` / `dist/pikafish-core-single.wasm` (fallback)
- `dist/pikafish-core.worker.js` (pthread worker; if generated)
- `dist/pikafish.nnue`
- `dist/index.html` (browser demo)

## Notes

- `scripts/build-pikafish.sh` is now idempotent for the local upstream checkout:
  - it pins the upstream Pikafish checkout by default so CI and GitHub Pages builds do not break when upstream `master` changes
  - it publishes the checked-in `public/pikafish.nnue` by default so CI does not pair an older engine with a moving `master-net`
  - set `PIKAFISH_UPSTREAM_REF=<commit-or-ref>` to test a newer upstream revision after updating `patches/pikafish-wasm.patch` and `public/pikafish.nnue`
  - it falls back to `grep` if `rg` (ripgrep) is not installed
  - it skips patch application if the patch was already applied
- Default build now uses a release-style Emscripten profile (`WASM_PROFILE=release`) while keeping Pikafish's host-specific `optimize` path disabled (`optimize=no`) to avoid upstream LTO/clang incompatibilities on current Emscripten.
- The wasm core build enables Emscripten/LLVM LTO by default (`WASM_ENABLE_LTO=yes`) and strips RTTI (`WASM_DISABLE_RTTI=yes`) for a smaller/faster core. Both are opt-out build env vars.
- Threaded builds now prewarm a larger pthread worker pool by default (`WASM_PTHREAD_POOL_SIZE=8`) so higher thread counts don't pay runtime worker spawn costs as often.
- Browser threaded mode requires cross-origin isolation (`COOP`/`COEP`). `npm run serve:demo` sets these headers for local testing.
- Browser demo shows header/thread support status, lets you force `threaded`/`single`/`auto`, and provides a simple click-to-move Xiangqi board UI.
- Wrapper usage supports `variant: "auto" | "threaded" | "single"`.
- Browser wrapper helper supports `Pikafish.createWorkerEngine(...)` to keep UI responsive in both threaded and single-thread modes.
- The React app unregisters legacy demo service workers and clears `pikafish-demo-*` caches at startup so older cached demo shells do not keep serving stale engine/app assets.
- Current bundled Pikafish build requires the NNUE net (`pikafish.nnue`) to run; disabling NNUE causes engine termination.
- Local Node benchmark helper: `npm run bench:nps -- --variant threaded-simd --depth 8 --repeats 3 --out /tmp/pika-before.json` (and `--compare <file>` for before/after deltas).

## Demo defaults (performance-first)

- The demo now starts in an auto-tuned browser configuration that still preserves responsiveness:
  - bundled Pikafish worker
  - `auto` runtime variant by default (resolves to the strongest supported core)
  - `auto` preset (device-aware thread/hash sizing)
  - optional `max-strength` preset for stronger desktop analysis (higher threads/hash)
  - `MultiPV = 1`
  - `UCI_ShowWDL = false`
  - service worker disabled by default (and unregistered for the demo scope)
- If the page still feels sluggish, hard refresh once after updating the demo so any older cached assets/service worker are cleared.

## Future improvements

- Add minified production bundle variants and optional WASM compression
- Add benchmark/regression CI for threaded, SIMD, and single-thread engine flavors
- Add a larger curated master-game/opening corpus for deeper book coverage
