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
- React app auto-saves the game in progress, so a reload offers to pick it up where you left off
- Evaluation bar beside the board, on the same winning-chance curve the review scores with, so the two cannot disagree
- **Go Deep**: one bounded search on the position you are looking at, far past what live analysis has time for (depth 36 / 30s on a high tier)
- **Play From Here**: keep the position on screen and play it on against the engine, taking the side to move — the thing you want after a review finds your mistake
- **From your library**: an opening explorer over your own saved games, keyed on the position so a transposition is found, with what you played from it and how those games ended
- PGN carries the review both ways: NAGs and `{[%eval ...]}` on export, read back on import, in the shapes other tools already parse
- Engine hash and thread count are settable per device, held inside what the shipped core can take
- Command palette on `Ctrl`/`Cmd`+`K`: a searchable list of the actions that matter, with recently used first and unavailable commands shown with the reason rather than hidden

## What this repo contains

- `patches/pikafish-wasm.patch`: upstream patch set (Makefile + Emscripten UCI/runtime compatibility)
- `templates/emscripten/*`: Emscripten build overrides injected into upstream `Pikafish`
- `templates/pikafish.js`: JS wrapper with auto flavor selection, NNUE loading, and browser worker helper (`createWorkerEngine`)
- `scripts/build-pikafish.sh`: clone, patch, build, copy artifacts to `dist/`
- `scripts/test-smoke.cjs`: Node smoke tests for threaded/single flavors
- `scripts/serve-demo.cjs`: local static server with COOP/COEP headers
- `demo/index.html`: simple playable Xiangqi board UI + engine controls (worker-based)
- `src/`: production React analysis app with board, engine, review, library, and opening-study UI
- `public/THIRD_PARTY_NOTICES.md`: shipped engine license/source notice for bundled Pikafish artifacts

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
# open http://localhost:8080/web-xiangqi/
```

Note: `npm run serve:demo` serves files already in `dist/` and does not rebuild automatically. It also maps the Vite `/web-xiangqi/` base path locally and uses conditional caching so large engine artifacts can revalidate without downloading again on every visit.

## React app QA

The app can be checked without rebuilding Pikafish — the shipped `.wasm` lives
in `public/`, so even the engine scripts run:

```bash
npm install
npm run verify            # typecheck, lint, tests, openings, library, engine
                          # artifact contract, engine smoke + parity, React build
```

`verify` is deliberately **browser-free**, which is what lets it work offline.

`verify` chains everything so the first failure stops it. Run it rather than the
parts: chaining by hand is how a real failure gets reported as success, and
`npm test` typechecks nothing on its own — Vitest transpiles without checking.

`test:prod:smoke` is the one that loads what actually ships. Every other browser
suite here drives the *dev* server, so the bundle in `dist/` was the one thing
nothing had ever opened; it runs in the Pages deploy, which is the only job
upstream of a publish.

Not in `verify`:

```bash
npm audit --audit-level=moderate   # left out so verify works offline
npm run test:serve-demo
npm run test:ui:install            # once per machine
npm run test:ui:layout             # drives a real browser
npm run test:prod:smoke            # loads the built dist/ in a browser
npm run build                      # rebuilds the WASM; needs emsdk
```

`npm run build:react` cleans only the React HTML/assets/favicon and any legacy demo `sw.js` from `dist/` before building, preserving the checked-in Pikafish JS/WASM/NNUE artifacts.

Artifacts are written to `dist/`:

- `dist/pikafish.js` (wrapper)
- `dist/pikafish-core.js` / `dist/pikafish-core.wasm` (threaded)
- `dist/pikafish-core-single.js` / `dist/pikafish-core-single.wasm` (fallback)
- `dist/pikafish-core.worker.js` (pthread worker; if generated)
- `dist/pikafish.nnue`
- `dist/index.html` (React analysis app after `npm run build:react`; browser demo after `npm run build`)

## Docs

- [Architecture](docs/architecture.md): how the React app is put together, the
  board conventions that are easy to get backwards, and where new logic belongs.

Two sibling apps share this one's shape — an engine in a worker, a move tree, a
review pass, a saved-game library — for Go and chess:

- [web-katrain](https://github.com/Sir-Teo/web-katrain) — Go, KataGo in the browser
- [web-chess](https://github.com/Sir-Teo/web-chess) — chess, Stockfish in the browser

[`docs/parity.md`](docs/parity.md) is the feature matrix for the three, kept
current as things land here.

[web-chess's cross-app learning plan](https://github.com/Sir-Teo/web-chess/blob/main/docs/cross-app-learning-plan.md)
compares the three and tracks what is worth moving between them.

## Notes

- `scripts/build-pikafish.sh` is now idempotent for the local upstream checkout:
  - it pins the upstream Pikafish checkout by default so CI and GitHub Pages builds do not break when upstream `master` changes
  - it publishes the checked-in `public/pikafish.nnue` by default so CI does not pair an older engine with a moving `master-net`
  - set `PIKAFISH_UPSTREAM_REF=<commit-or-ref>` to test a newer upstream revision after updating `patches/pikafish-wasm.patch` and `public/pikafish.nnue`
  - it falls back to `grep` if `rg` (ripgrep) is not installed
  - it skips patch application if the patch was already applied
- Default build now uses a release-style Emscripten profile (`WASM_PROFILE=release`) while keeping Pikafish's host-specific `optimize` path disabled (`optimize=no`) to avoid upstream LTO/clang incompatibilities on current Emscripten.
- The wasm core build enables Emscripten/LLVM LTO by default (`WASM_ENABLE_LTO=yes`) and strips RTTI (`WASM_DISABLE_RTTI=yes`) for a smaller/faster core. Both are opt-out build env vars.
- Threaded builds prewarm a pthread worker pool (`WASM_PTHREAD_POOL_SIZE=12`), and the app never asks for more than `MAX_ENGINE_THREADS` (8) of it. The pool is a hard ceiling rather than a preference: asking past it blocks the engine in `pthread_create` and it never answers `readyok`. Measured in the browser at depth 18, 18-core machine: 435k nps at 1 thread, 1.92M at 4, 3.74M at 8. Raising it means raising the build *and* rebuilding the artifacts together — `scripts/test-engine-contract.cjs` fails if they drift apart.
- `EMSDK_VERSION` is pinned. Emscripten 6.0.2 dropped `mainScriptUrlOrBlob`, which `templates/pikafish.js` needs to spawn pthread workers from the core rather than from an undefined script URL; without it the threaded core loads, answers `uci`, and never becomes ready. Node tests do not take that path and release builds say nothing, so the pin is the guard.
- Browser threaded mode requires cross-origin isolation (`COOP`/`COEP`). `npm run serve:demo` sets these headers for local testing.
- Browser demo shows header/thread support status, lets you force `threaded`/`single`/`auto`, and provides a simple click-to-move Xiangqi board UI.
- Deployed builds expose `THIRD_PARTY_NOTICES.md` and `Pikafish-Copying.txt` under the `/web-xiangqi/` base path so users can trace the bundled engine source and license.
- Wrapper usage supports `variant: "auto" | "threaded" | "single"`.
- Browser wrapper helper supports `Pikafish.createWorkerEngine(...)` to keep UI responsive in both threaded and single-thread modes.
- The React app preloads the lightweight `pikafish.js` wrapper, then lazy-loads the selected core/NNUE through `useEngine` instead of parser-blocking the app shell before first paint.
- The React app unregisters legacy demo service workers and clears `pikafish-demo-*` caches at startup so older cached demo shells do not keep serving stale engine/app assets.
- Current bundled Pikafish build requires the NNUE net (`pikafish.nnue`) to run; disabling NNUE causes engine termination.
- Local Node benchmark helper: `npm run bench:nps -- --variant threaded-simd --depth 8 --repeats 3 --out /tmp/pika-before.json` (and `--compare <file>` for before/after deltas). Benchmark runs fail if they do not return a best move, usable NPS, or the requested depth; use `--min-median-nps`, `--max-median-wall-ms`, or `--max-cold-start-ms` for machine-specific performance gates.

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
- Add historical benchmark baselines and threshold alerts for threaded, SIMD, and single-thread engine flavors
- Add a larger curated master-game/opening corpus for deeper book coverage
