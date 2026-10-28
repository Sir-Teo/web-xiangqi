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
- **Saved analysis snapshots**: keeping an engine line also saves its source position and history, Red-perspective score, depth, search scope, and reported engine/runtime settings. Inspect it in Tree and use Update analysis to replace it explicitly. Snapshots travel in library saves, backups, share links within their size limit, and a custom PGN comment; other PGN tools may ignore that comment. Engine/network artifact hashes are not captured.
- **Compare candidate moves**: choose one to five legal moves in Engine → Compare. Compare only those continuations, extend them with Go Deep or infinite analysis, and keep, copy, or follow a line. Restricted scores are labeled separately and never replace the position evaluation.
- **Go Deep**: one bounded search on the position you are looking at, far past what live analysis has time for (depth 36 / 30s on a high tier)
- **Play From Here**: keep the position on screen and play it on against the engine, taking the side to move — the thing you want after a review finds your mistake
- **Open matching games**: expand Matching games in the position explorer to open a saved game at its first visit to the current position, keeping its full line, branches, and notes.
- **Find matching positions**: after searching your library, expand a saved study's matching positions to open the exact note or saved analysis. Matching notes are shown in full with search words highlighted. Starting-position notes are included, even in studies with no moves; opening one preserves its continuations and leaves the library unchanged. Repeated moves in sibling variations keep the chosen occurrence through saving, recovery, backups and shared links, with their notes, results and pinned main line preserved. Undo also keeps their separate notes.
- **Practice saved studies**: recall stored continuations for either side from Library → Practice. Identical move lines share one exercise, with their distinct study notes available after completion. Progress survives updates to game details, recorded results and the saved cursor. Changes to moves, study notes or the starting position start fresh practice; each side keeps independent progress.
- **From your library**: an opening explorer over your own saved games, keyed on the position so a transposition is found, with what you played from it and how those games ended
- **PGN collections**: under Library → Import PGN collection, preview files up to 8,000,000 characters, including dense saved-analysis backups. Search the preview by player, event, date, site, recorded time control, or annotator; matched words are highlighted, and matching credits or other details are revealed. Open a checked game directly on the board or select matching games to add to the library. Previews show 20 games at a time, with more on request, and search reaches every game. Coordinate moves, variations, notes, tournament details, results, and saved analysis are retained. Studies support 8,192 moves across variations, with up to 1,024 moves per line. Parsing runs in a worker. Opening a game does not write to the library; storage byte limits still apply when saving.
- **Export matching games**: filter or search the saved library, choose a sort order, and download all matching games as one PGN collection, including games on other pages. Preparation runs in a cancellable worker and preserves variations, notes, game details, and supported analysis annotations. An inconsistent study stops the export with a recovery message. Use a library backup for complete review reports and browser-specific data.
- Tournament details: import and edit Red/Black players, ratings, event, site, date, round, recorded time control, and annotation credits under **Game details** in the move panel. Details survive saving, autosave recovery, library backups, and PGN export. Library searches highlight names and matching details, showing matching detail lines in full. Reverting metadata edits restores the saved indicator.
- Normal PGN import retains move evaluations (including the distinction between large numeric scores and mates), supplied search depths, and the supported inaccuracy/mistake/blunder glyphs on the main line and variations. These annotations survive save, recovery, sharing within link limits, and re-export without claiming a completed engine review. Fresh analysis can update their scores; an old depth is cleared when the replacement lacks one. Written notes also survive nested variations and consecutive brace/semicolon comments. Comments may precede or separate header tags; starting positions and tournament details are read from the actual headers.
- Engine hash and thread count are settable per device, held inside what the shipped core can take
- **Show Threat**: hand the opponent the move and let the engine answer what they are threatening — the question the best move does not answer, refused only when the side to move is in check, and kept visibly apart from the position's own evaluation
- Pieces can be dragged as well as clicked, and a move slides rather than teleporting, so what changed on the board is visible without re-reading it
- Command palette on `Ctrl`/`Cmd`+`K`: a searchable list of the actions that matter, with recently used first and unavailable commands shown with the reason rather than hidden. **Search library** opens the library and selects its query for replacement.
- **Save study** on `Ctrl`/`Cmd`+`S`: save a new study or update the one you opened, including note text still being edited. Focus stays in the editor. The shortcut is paused while a dialog is open.
- **Record a result** under Game details: mark a resignation or agreed draw at the selected position, including a starting diagram or variation. Choose Not recorded to remove it. Results stay with saves, recovery, share links, and PGN exports. Checkmate and stalemate results are automatic.
- In library, PGN collection, and study-note searches, `Esc` clears the query while keeping filters, game selection, and keyboard focus.
- **Infinite analysis**: the `∞` toggle beside Go Deep sends `go infinite`, so the depth climbs on this position until Stop or the next move; the engine hash defaults are sized so a deep search does not fill the table halfway through (256MB on a high-tier machine, 128MB mid)
- A deep or infinite search keeps running when the tab goes to the background. Live analysis and the AI opponent still stop the moment it does -- they run on their own and nobody is looking -- but a search started by hand is usually started *so* you can do something else, and on a browser that means another tab
- **Cloud book** (象棋云库, chessdb.cn): what is played from the position on the board, with the database's score, rank and win rate for each move, one click to play. Off until turned on, because it sends the position to chessdb.cn; nothing else ever leaves the machine
- **Cloud line**: with the cloud book on, the database's own line for the position -- its score, its depth (62 plies from the opening, against the twenty-odd a live search settles at) and the moves, each one clickable to play the line up to it. The same position under the same switch; nothing new leaves the machine
- **Repetition ruling from the cloud**: with the cloud book on, once a position repeats the moves that led to it are sent to chessdb.cn's `queryrule`, and the moves it rules forbidden (perpetual check *or chase*, which the local check cannot see) or drawn are named in the repetition notice before they are played. If the lookup fails, **Retry cloud ruling** asks again from the same position.
- **Hint** in a game against the engine: one move, drawn as an arrow and named in your notation, for the beginner who is stuck -- analysis stays off while playing
- Variations can be deleted (the cross at the end of each variation row) and a line cut where it stands (palette: *Delete this move and what follows*); either can be taken back from the Undo toast for ten seconds. Undo countdowns pause while an action has keyboard focus or the pointer is over it, then resume with their remaining time. This also applies to deleted saved games and discarded unfinished games.
- Deleting a saved game offers Undo. An accepted restore stays available while waiting for storage; if storage refuses it, **Retry restore** keeps the original game, variations, and notes available for another attempt.
- If a deleted or discarded game cannot be restored, **Download data** keeps its retained record as a single-game library backup, including variations, notes, and metadata, for repair or later import.
- **Set up a position by hand**: a board editor with the fourteen pieces and an erase brush, checking the rules of the set as you place them (soldiers behind their rank, elephants off their points, facing generals, a check against the side not to move) so Done only loads a position a game could reach; from the New Game dialog or the palette
- **The review shows the line, not just the move**: a key moment said *Try C2+7* and stopped there, so it named the better move and never what it was for. The engine's whole continuation arrives with `bestmove` and starts with that move, so keeping it costs no extra search; it is stored with the review, travels with a saved game, and is written in the reader's own notation
- **A note on a move**: everything attached to a move here was the engine's -- an evaluation, a best move, a review note it overwrites on every re-run -- so a study built on this board carried the line and none of the reasoning for it. Write one under the move list; it shows beside the move, travels in the PGN and the share link, and survives a reload. A game holding a note is stored as a tree rather than a list of moves, because a list cannot carry one
- **A link that does not load says why**: five different failures used to produce "Shared link not loaded" and put the reason in the sender's console, where the person who opened the link cannot see it. Now the notice names which move stops being playable and what the rule is, or quotes the token that is not a move, in the reader's own words rather than the engine's
- **The engine download says how far it has got**: `pikafish.nnue` is 53MB and 97.6% of a first visit, and nothing in the app works without it, so the wait used to be a bare "Loading engine" -- a minute or more on a phone connection, indistinguishable from an engine that is never coming. The wrapper streams the weights and reports the count, so the status line reads `Loading engine · 21 of 53 MB` (a percentage on a phone, where the longer string would wrap the header and move the board)
- **The 60-move rule, reported rather than enforced**: past thirty capture-free moves the board says how many there have been and what the engine will do with it. Pikafish calls the game drawn at sixty and discounts its evaluation the whole way there, so a won ending reads flatter than it is; the app still refuses to end the game on a rule whose edition it cannot know
- **Letter pieces** as a setting: the characters are the game and stay the default, but a beginner cannot yet tell 仕 from 士, so the board can draw the WXF letters the move list already uses -- K, A, E, H, R, C, P -- on the pieces, in the editor as well, so the board teaches the notation
- **XQF import**: the file format of 象棋桥 and XQStudio, which is what most xiangqi records on disk are in and what every Chinese database exports. Open one from the New Game dialog or drop it into the move box, and it loads straight onto the board, variations and notes included, every version from the 2001 original through the keyed ones; the reader was checked against real files from both programs, a study with twelve variations among them
- **Drop a game file**: drop one PGN, XQF or text file into the New Game move box. PGN and text fill the box for review before Import, with Undo file load (Ctrl/Cmd+Z) to restore its previous contents; XQF opens directly. The file picker remains available too.
- **DhtmlXQ import**: the record block every dpxq.com (东萍象棋) game page carries, and the format most often pasted on Chinese forums, is read by the import box -- the move list, a set-up position from `binit`, and the per-move comments as notes. It was the largest xiangqi archive online and pasted as nothing
- **Take back** in a game against the engine: your last move and the reply it earned, removed together so it is your move again from the position before, or only your move when the engine has not answered yet; the undo toast offers to put them back
- **Click into an engine line**: every move of a principal variation is a control that plays the line up to it, from the position on screen, with the Engine panel left where it is so the next line is the one for the new position. `Space` plays the engine's first choice, the lichess binding, and is in the palette beside it
- **Keep an engine line**: add a complete continuation to the study tree without moving the board. Use **Keep line** beside a PV or **Keep best engine line** in the command palette. Existing moves and notes are reused; saved games, recovery, and PGN export retain the variations. Illegal lines and additions beyond the 1,024-move study limit are rejected without changing the tree.
- **Full strength** as a sixth opponent rung: Master is held at depth 12, which is a strong club player and the right top of a ladder beginners climb; this one plays the engine as it is, up to four seconds a move with the depth ceiling well past what the time will reach, so it is the same wait on every machine and deeper on a faster one
- **Learn from mistakes**: the review's key moments asked as questions. Each puts the position before the mistake on the board with the engine's arrows hidden and asks for a better move; the engine's move is recognised at once, and anything else is graded on the review's own scale once the live analysis has evaluated it, so a move the review would have called good is called good here. Attempts stay in the tree as variations, and a finished review now survives them -- it used to be cleared by the first move played after it
- **Copy record**: the line as a numbered record in the chosen notation -- `1. 炮二平五 馬8進7` -- for pasting where a person will read it, beside Copy PGN for programs
- Command palette entry *Write a note on this move*, so the field is reachable without knowing where it lives
- **Find study notes**: expand Study notes below the move tree, or use the command palette, to search note text across the starting position and every variation. Select a result to visit its position. Search results show the complete matching note with search words highlighted. Use Up/Down to browse results, Home/End to reach either end, and Enter to open a position; the list takes one Tab stop. Results follow tree order, with 20 shown initially and more available on demand. The finder keeps your search and revealed results while you switch analysis panels in the current study.
- **Study annotation symbols**: coordinate PGN import retains `!`, `?`, `!!`, `??`, `!?`, `?!`, position annotations, and numeric codes from `$0` through `$255` on every variation. Expand **Move annotations** to read meanings, apply a named judgement, add a numeric code, or remove a study symbol. Choosing a judgement replaces its move/position group and keeps unfamiliar codes. Symbols survive library storage, recovery, sharing within link limits, and export. Review grades remain separate; PGN can use the review grade when no study move judgement is set.
- Single-key shortcuts: `F` flip, `X` threat, `D` deep search, `H` hint, `E`/`T`/`R` the Engine, Tree and Review panels, arrows to step through the game; each is printed beside its command in the palette
- **Board keyboard navigation**: while a board square has focus, arrow keys move focus between squares, and `Home`/`End` reach the left/right edge of the current row, following the board orientation. `Enter` or `Space` selects a piece or plays its move; `Shift+Enter` or `Shift+Space` toggles a square highlight. On the main board, `Escape` cancels the selected piece or active drag and keeps focus on the current square.
- **Move-list keyboard navigation**: use Left/Right to browse moves, Up/Down to follow visible rows including wrapped variations, and Home/End to reach either end. Enter opens the focused position; browsing leaves the board unchanged. The list uses one Tab stop.
- **Clear board drawings**: use **Clear drawn arrows and highlights** in the command palette to remove your markings, including hidden ones. Engine suggestions and the last-move arrow stay available.

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

`test:prod:smoke` loads the built app under isolation headers, a Pages-style
service-worker host, and legacy-worker recovery. It runs before the Pages
deploy. The audit and cross-browser runners also serve the existing `dist/`;
run `npm run build:react` after editing the app, or use `npm run verify`, which
includes that build. The cross-browser runner checks Chromium, Firefox, and
WebKit. The layout suite starts a Vite development server.

Not in `verify`:

```bash
npm audit --audit-level=moderate   # left out so verify works offline
npm run test:serve-demo
npm run test:ui:install            # once per machine
npx playwright install --with-deps chromium firefox webkit # for cross-browser QA
npm run test:ui:layout             # drives a real browser
npm run test:ui:audit              # focused regressions; starts its own server
npm run test:ui:soak               # seeded random walk, checks invariants
npm run test:prod:smoke            # loads the built dist/ in a browser
npm run build                      # rebuilds the WASM; needs emsdk
```

Every push to `main` builds the app (caching the compiled engine) and publishes
it to GitHub Pages, with no test gate in between, so run the checks above
before pushing. See [Deployment](docs/ci.md).


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
  - it also copies those pinned weights into the clean upstream checkout before compiling, avoiding an unnecessary `master-net` download during upstream configuration
  - set `PIKAFISH_UPSTREAM_REF=<commit-or-ref>` to test a newer upstream revision after updating `patches/pikafish-wasm.patch` and `public/pikafish.nnue`
  - it falls back to `grep` if `rg` (ripgrep) is not installed
  - it skips patch application if the patch was already applied
  - it stages requested variants and supporting files before publication, so compilation or staging failures leave the served engine files unchanged; `npm run test:build:publication` checks this with isolated compiler/git stubs
  - `WASM_BUILD_SIMD=no` builds only the scalar cores, records that availability in the generated wrapper and removes obsolete SIMD JS/WASM/worker files after successful publication. Runtime selection then stays scalar even on SIMD-capable browsers; threading still depends on browser support. The default is `yes`; other values fail. Use `--variant single` or `--variant threaded` for scalar-only Node benchmarks.
  - the wrapper explicitly selects threading and SIMD for each flavor during cleaning and compilation; inherited `WASM_SINGLE_THREADED` or `WASM_SIMD` settings cannot change the requested artifacts. Use `WASM_BUILD_SIMD` to control whether the wrapper includes SIMD variants.
- Default build now uses a release-style Emscripten profile (`WASM_PROFILE=release`) while keeping Pikafish's host-specific `optimize` path disabled (`optimize=no`) to avoid upstream LTO/clang incompatibilities on current Emscripten.
- The wasm core build enables Emscripten/LLVM LTO by default (`WASM_ENABLE_LTO=yes`) and strips RTTI (`WASM_DISABLE_RTTI=yes`) for a smaller/faster core. Both are opt-out build env vars.
- `WASM_PROFILE` accepts `release` (default) or `debug` (debug information and Emscripten assertions). `WASM_ENABLE_LTO`, `WASM_DISABLE_RTTI`, and `WASM_ALLOW_MEMORY_GROWTH` accept `yes/no`, `true/false`, or `1/0`. Explicitly empty or unknown values fail before checkout or publication; direct Makefile builds validate these settings too.
- Threaded builds prewarm a pthread worker pool (`WASM_PTHREAD_POOL_SIZE=12`), and the app never asks for more than `MAX_ENGINE_THREADS` (8) of it. The pool is a hard ceiling rather than a preference: asking past it blocks the engine in `pthread_create` and it never answers `readyok`. Measured in the browser at depth 18, 18-core machine: 435k nps at 1 thread, 1.92M at 4, 3.74M at 8. Raising it means raising the build *and* rebuilding the artifacts together — `scripts/test-engine-contract.cjs` fails if they drift apart.
- Settings explains the CPU/memory tradeoffs of engine threads and hash without requiring hover. **Use device defaults** clears both manual overrides while preserving other preferences; a changed configuration restarts the engine once. The choices remain within the device's existing limits.
- `EMSDK_VERSION` is pinned. Emscripten 6.0.2 dropped `mainScriptUrlOrBlob`, which `templates/pikafish.js` needs to spawn pthread workers from the core rather than from an undefined script URL; without it the threaded core loads, answers `uci`, and never becomes ready. Node tests do not take that path and release builds say nothing, so the pin is the guard.
- Browser threaded mode requires cross-origin isolation (`COOP`/`COEP`). `vite.config.ts` and `npm run serve:demo` both send these headers, so development is always isolated. **GitHub Pages sends neither and cannot be configured to**, so the deployed app registers `public/coi-sw.js`, a service worker that adds them, and reloads once to pick them up — 479k nodes/second without it against 3.9M with. It caches NNUE weights and revalidates them before reuse; failed revalidation surfaces a load error rather than serving a potentially incompatible network. Offline support is not implemented. Where the host already sends the headers, no worker is registered at all.
- Browser demo shows header/thread support status, lets you force `threaded`/`single`/`auto`, and provides a simple click-to-move Xiangqi board UI.
- Deployed builds expose `THIRD_PARTY_NOTICES.md` and `Pikafish-Copying.txt` under the `/web-xiangqi/` base path so users can trace the bundled engine source and license.
- Wrapper usage supports `variant: "auto" | "threaded" | "single"`.
- Browser wrapper helper supports `Pikafish.createWorkerEngine(...)` to keep UI responsive in both threaded and single-thread modes.
- `createWorkerEngine` supports `extendInitTimeoutOnProgress: true` to renew `initTimeoutMs` only when downloaded bytes increase. Its default remains a hard deadline. The app opts in so a slow, advancing first download can finish; stalled downloads and the later UCI-ready handshake still time out.
- Pass an optional `signal: controller.signal` to cancel a pending `createWorkerEngine` call. Cancellation rejects with `AbortError` and releases the worker; failed initialization and timeouts release it too. After startup succeeds, use the returned engine's `terminate()` method. The app cancels pending startup when restarting or disabling analysis.
- Worker `onAssetProgress` callbacks are coalesced at roughly one-MiB steps, plus initial, completion, reset, and changed-total notifications. Download bytes and completion counts are unchanged; callers must not depend on a callback for every network chunk.
- The React app preloads the lightweight `pikafish.js` wrapper, then lazy-loads the selected core/NNUE through `useEngine` instead of parser-blocking the app shell before first paint.
- The React app unregisters legacy demo service workers and clears `pikafish-demo-*` caches at startup so older cached demo shells do not keep serving stale engine/app assets.
- Current bundled Pikafish build requires the NNUE net (`pikafish.nnue`) to run; disabling NNUE causes engine termination.
- Local Node benchmark helper: `npm run bench:nps -- --variant threaded-simd --depth 8 --repeats 3 --out /tmp/pika-before.json` (and `--compare <file>` for before/after deltas). Benchmark runs fail if they do not return a best move, usable NPS, or the requested depth; use `--min-median-nps`, `--max-median-wall-ms`, or `--max-cold-start-ms` for machine-specific performance gates.
- The benchmark reads the loaded core's UCI Threads limits. Its default uses one fewer CPU, capped by those limits (and 64); single-thread cores use one thread. Explicit unsupported or malformed `--threads` values and unknown variants fail without producing a new snapshot. Run `npm run test:bench:config` to verify configuration against all four built cores. Node thread counts do not establish browser thread capacity.
- Benchmark variant names select the exact core: `single` and `threaded` disable automatic SIMD selection so the reported variant matches the loaded artifact.
- Benchmark JSON includes the FEN, reported engine name, and file sizes/SHA-256 fingerprints for the wrapper, selected core JS/WASM, and evaluation network. Fingerprinting streams files after timed work; file-stat changes during the run reject the snapshot. Runs use separate temporary modules and clean them on completion or failure. Failed performance gates do not write a new snapshot. Compare the recorded inputs before attributing an NPS change to an implementation change.
- `--compare` takes a snapshot saved with `--out`. Text and JSON comparisons identify differing or missing FEN/depth and withhold search deltas in those cases; legacy snapshots without a FEN remain readable. Changed or missing runtime settings and artifact hashes are listed separately, so intentional thread, SIMD and engine comparisons remain possible. Startup deltas are independent of search workload. Matching recorded inputs do not establish equal hardware, system load or cache state; these deltas describe individual runs.
- Study serialization benchmark: `node scripts/bench-study-serialization.mjs` compares the current traversal with the former algorithm on 128-, 512-, and 1,024-move chains. It verifies matching output and reports medians/p95 from interleaved samples; measurements exclude rendering, JSON encoding, storage, and engine search.
- Move import benchmark: `node scripts/bench-move-import.mjs 5fbf7b9` checks 2,000 generated trees against that baseline, then compares parsing costs on long plain/annotated records and a large malformed comment. Measurements exclude move validation, board reconstruction, rendering, storage, and engine search.
- Worker progress benchmark: `node scripts/bench-progress-browser.cjs [baseline-wrapper-path]` runs five real-engine startup samples per implementation, interleaved in fresh browser contexts. Set `XIANGQI_QA_BROWSER` to select a browser. It reports progress-message counts and startup time, not application-rendering or search-speed measurements.
- Cross-browser audit: after `npx playwright install chromium firefox webkit` and `npm run build:react`, run `npm run test:ui:cross-browser`. Use `XIANGQI_QA_BROWSER=firefox` to select one browser. The built-app matrix covers engine recovery, beginner play, and study workflows; see [the findings and scope](docs/cross-browser-audit-2026-09-11.md).

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
