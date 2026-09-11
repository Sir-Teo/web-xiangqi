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
- React app includes legal move validation, a move tree, review annotations, WDL/eval views, saved games, and opening-book continuations
- React app auto-saves the game in progress, so a reload offers to pick it up where you left off
- Evaluation bar beside the board, on the same winning-chance curve the review scores with, so the two cannot disagree
- **Go Deep**: one bounded search on the position you are looking at, far past what live analysis has time for (depth 36 / 30s on a high tier)
- **Play From Here**: keep the position on screen and play it on against the engine, taking the side to move — the thing you want after a review finds your mistake
- **Open matching games**: expand Matching games in the position explorer to open a saved game at its first visit to the current position, keeping its full line, branches, and notes.
- **From your library**: an opening explorer over your own saved games, keyed on the position so a transposition is found, with what you played from it and how those games ended
- **PGN collections**: under Library → Import PGN collection, preview a file and select games before adding them. Coordinate moves, variations, move notes, tournament details, and results are checked and retained. Parsing runs in a worker; invalid records and failed writes leave the library untouched.
- Tournament details: import and edit Red/Black players, event, site, date, and round under **Game details** in the move panel. Details survive saving, autosave recovery, library backups, and PGN export; search the library by player or event.
- PGN carries the review both ways: NAGs and `{[%eval ...]}` on export, read back on import, in the shapes other tools already parse
- Engine hash and thread count are settable per device, held inside what the shipped core can take
- **Show Threat**: hand the opponent the move and let the engine answer what they are threatening — the question the best move does not answer, refused only when the side to move is in check, and kept visibly apart from the position's own evaluation
- Pieces can be dragged as well as clicked, and a move slides rather than teleporting, so what changed on the board is visible without re-reading it
- Command palette on `Ctrl`/`Cmd`+`K`: a searchable list of the actions that matter, with recently used first and unavailable commands shown with the reason rather than hidden
- **Infinite analysis**: the `∞` toggle beside Go Deep sends `go infinite`, so the depth climbs on this position until Stop or the next move; the engine hash defaults are sized so a deep search does not fill the table halfway through (256MB on a high-tier machine, 128MB mid)
- A deep or infinite search keeps running when the tab goes to the background. Live analysis and the AI opponent still stop the moment it does -- they run on their own and nobody is looking -- but a search started by hand is usually started *so* you can do something else, and on a browser that means another tab
- **Cloud book** (象棋云库, chessdb.cn): what is played from the position on the board, with the database's score, rank and win rate for each move, one click to play. Off until turned on, because it sends the position to chessdb.cn; nothing else ever leaves the machine
- **Cloud line**: with the cloud book on, the database's own line for the position -- its score, its depth (62 plies from the opening, against the twenty-odd a live search settles at) and the moves, each one clickable to play the line up to it. The same position under the same switch; nothing new leaves the machine
- **Repetition ruling from the cloud**: with the cloud book on, once a position repeats the moves that led to it are sent to chessdb.cn's `queryrule`, and the moves it rules forbidden (perpetual check *or chase*, which the local check cannot see) or drawn are named in the repetition notice before they are played
- **Hint** in a game against the engine: one move, drawn as an arrow and named in your notation, for the beginner who is stuck -- analysis stays off while playing
- Variations can be deleted (the cross at the end of each variation row) and a line cut where it stands (palette: *Delete this move and what follows*); either can be taken back from the Undo toast for ten seconds
- **Set up a position by hand**: a board editor with the fourteen pieces and an erase brush, checking the rules of the set as you place them (soldiers behind their rank, elephants off their points, facing generals, a check against the side not to move) so Done only loads a position a game could reach; from the New Game dialog or the palette
- **The review shows the line, not just the move**: a key moment said *Try C2+7* and stopped there, so it named the better move and never what it was for. The engine's whole continuation arrives with `bestmove` and starts with that move, so keeping it costs no extra search; it is stored with the review, travels with a saved game, and is written in the reader's own notation
- **A note on a move**: everything attached to a move here was the engine's -- an evaluation, a best move, a review note it overwrites on every re-run -- so a study built on this board carried the line and none of the reasoning for it. Write one under the move list; it shows beside the move, travels in the PGN and the share link, and survives a reload. A game holding a note is stored as a tree rather than a list of moves, because a list cannot carry one
- **A link that does not load says why**: five different failures used to produce "Shared link not loaded" and put the reason in the sender's console, where the person who opened the link cannot see it. Now the notice names which move stops being playable and what the rule is, or quotes the token that is not a move, in the reader's own words rather than the engine's
- **The engine download says how far it has got**: `pikafish.nnue` is 53MB and 97.6% of a first visit, and nothing in the app works without it, so the wait used to be a bare "Loading engine" -- a minute or more on a phone connection, indistinguishable from an engine that is never coming. The wrapper streams the weights and reports the count, so the status line reads `Loading engine · 21 of 53 MB` (a percentage on a phone, where the longer string would wrap the header and move the board)
- **The 60-move rule, reported rather than enforced**: past thirty capture-free moves the board says how many there have been and what the engine will do with it. Pikafish calls the game drawn at sixty and discounts its evaluation the whole way there, so a won ending reads flatter than it is; the app still refuses to end the game on a rule whose edition it cannot know
- **Letter pieces** as a setting: the characters are the game and stay the default, but a beginner cannot yet tell 仕 from 士, so the board can draw the WXF letters the move list already uses -- K, A, E, H, R, C, P -- on the pieces, in the editor as well, so the board teaches the notation
- **XQF import**: the file format of 象棋桥 and XQStudio, which is what most xiangqi records on disk are in and what every Chinese database exports. Open one from the New Game dialog and it loads straight onto the board, variations and notes included, every version from the 2001 original through the keyed ones; the reader was checked against real files from both programs, a study with twelve variations among them
- **DhtmlXQ import**: the record block every dpxq.com (东萍象棋) game page carries, and the format most often pasted on Chinese forums, is read by the import box -- the move list, a set-up position from `binit`, and the per-move comments as notes. It was the largest xiangqi archive online and pasted as nothing
- **Take back** in a game against the engine: your last move and the reply it earned, removed together so it is your move again from the position before, or only your move when the engine has not answered yet; the undo toast offers to put them back
- **Click into an engine line**: every move of a principal variation is a control that plays the line up to it, from the position on screen, with the Engine panel left where it is so the next line is the one for the new position. `Space` plays the engine's first choice, the lichess binding, and is in the palette beside it
- **Keep an engine line**: add a complete continuation to the study tree without moving the board. Use **Keep line** beside a PV or **Keep best engine line** in the command palette. Existing moves and notes are reused; saved games, recovery, and PGN export retain the variations. Illegal lines and additions beyond the 1,024-move study limit are rejected without changing the tree.
- **Full strength** as a sixth opponent rung: Master is held at depth 12, which is a strong club player and the right top of a ladder beginners climb; this one plays the engine as it is, up to four seconds a move with the depth ceiling well past what the time will reach, so it is the same wait on every machine and deeper on a faster one
- **Learn from mistakes**: the review's key moments asked as questions. Each puts the position before the mistake on the board with the engine's arrows hidden and asks for a better move; the engine's move is recognised at once, and anything else is graded on the review's own scale once the live analysis has evaluated it, so a move the review would have called good is called good here. Attempts stay in the tree as variations, and a finished review now survives them -- it used to be cleared by the first move played after it
- **Copy record**: the line as a numbered record in the chosen notation -- `1. 炮二平五 馬8進7` -- for pasting where a person will read it, beside Copy PGN for programs
- Command palette entry *Write a note on this move*, so the field is reachable without knowing where it lives
- Single-key shortcuts: `F` flip, `X` threat, `D` deep search, `H` hint, `E`/`T`/`R` the Engine, Tree and Review panels, arrows to step through the game; each is printed beside its command in the palette

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
npm run test:ui:audit              # focused regressions; starts its own server
npm run test:ui:soak               # seeded random walk, checks invariants
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

- [September 7 audit](docs/audit-2026-09-07.md): confirmed fixes, measured responsiveness, browser QA, and priorities for professional study and beginner learning.

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
- Browser threaded mode requires cross-origin isolation (`COOP`/`COEP`). `vite.config.ts` and `npm run serve:demo` both send these headers, so development is always isolated. **GitHub Pages sends neither and cannot be configured to**, so the deployed app registers `public/coi-sw.js`, a service worker that adds them, and reloads once to pick them up — 479k nodes/second without it against 3.9M with. It caches NNUE weights and revalidates them before reuse; failed revalidation surfaces a load error rather than serving a potentially incompatible network. Offline support is not implemented. Where the host already sends the headers, no worker is registered at all.
- Browser demo shows header/thread support status, lets you force `threaded`/`single`/`auto`, and provides a simple click-to-move Xiangqi board UI.
- Deployed builds expose `THIRD_PARTY_NOTICES.md` and `Pikafish-Copying.txt` under the `/web-xiangqi/` base path so users can trace the bundled engine source and license.
- Wrapper usage supports `variant: "auto" | "threaded" | "single"`.
- Browser wrapper helper supports `Pikafish.createWorkerEngine(...)` to keep UI responsive in both threaded and single-thread modes.
- The React app preloads the lightweight `pikafish.js` wrapper, then lazy-loads the selected core/NNUE through `useEngine` instead of parser-blocking the app shell before first paint.
- The React app unregisters legacy demo service workers and clears `pikafish-demo-*` caches at startup so older cached demo shells do not keep serving stale engine/app assets.
- Current bundled Pikafish build requires the NNUE net (`pikafish.nnue`) to run; disabling NNUE causes engine termination.
- Local Node benchmark helper: `npm run bench:nps -- --variant threaded-simd --depth 8 --repeats 3 --out /tmp/pika-before.json` (and `--compare <file>` for before/after deltas). Benchmark runs fail if they do not return a best move, usable NPS, or the requested depth; use `--min-median-nps`, `--max-median-wall-ms`, or `--max-cold-start-ms` for machine-specific performance gates.
- Study serialization benchmark: `node scripts/bench-study-serialization.mjs` compares the current traversal with the former algorithm on 128-, 512-, and 1,024-move chains. It verifies matching output and reports medians/p95 from interleaved samples; measurements exclude rendering, JSON encoding, storage, and engine search.

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
