# Parity with the sibling apps

web-xiangqi is one of three apps built to the same shape — an engine in a worker, a
move tree, an eval graph, a review pass with accuracy, a saved-game library, a
GitHub Pages deploy — for a different game each:

- [web-katrain](https://github.com/Sir-Teo/web-katrain) — Go, KataGo in the browser
- [web-chess](https://github.com/Sir-Teo/web-chess) — chess, Stockfish in the browser
- [web-xiangqi](https://github.com/Sir-Teo/web-xiangqi) — xiangqi, Pikafish compiled to WASM

**Update the table below when a feature lands here.** That is the whole point of
the file. The three drift at the speed they are worked on, and nothing else in
these repos notices: the plan that proposed this file spent a night finding
things that were only visible by comparison — a deploy that ran no checks, a
search box none of the three bounded, a lesson learned in one file and left
unfixed in the file beside it. A table that is kept current turns those into
something a reader spots in a minute.

The deeper comparison, and what is worth moving next, lives in web-chess's
[`docs/cross-app-learning-plan.md`](https://github.com/Sir-Teo/web-chess/blob/main/docs/cross-app-learning-plan.md)
and [`docs/cross-app-second-pass.md`](https://github.com/Sir-Teo/web-chess/blob/main/docs/cross-app-second-pass.md).

## Where the three stand

Measured 2026-08-29.

| | web-katrain | web-chess | web-xiangqi |
| --- | --- | --- | --- |
| Domain | Go (KataGo) | Chess (Stockfish) | Xiangqi (Pikafish) |
| `src` files | 233 | 118 | 71 |
| Test cases | 1,417 | 410 | 338 |
| App state | Zustand store | `useState` in `App.tsx` | `useState` in `App.tsx` |
| Deploy runs the checks | yes | yes | yes |
| `npm run verify` | yes | yes | yes + engine smoke/parity |
| Hostile-input parser sweep | yes | yes | yes |
| Bounded search query | yes | yes | yes |
| Namespaced, versioned storage keys | yes | yes | yes |
| One device-tier sizing policy | threads only | capabilities + hash | full tier + live/review policy |
| Saved-game library | IndexedDB, folders, zip | IndexedDB, JSON backup | localStorage, flat |
| Auto-save + crash recovery | yes | yes | yes |
| Error boundary | component + lazy-modal | inline + lazy-dialog | component + lazy-panel |
| Command palette | yes | no | no |
| Board / UI themes | yes | no | no |
| Sound | yes | no | partial |
| Haptics | yes | no | no |
| Analysis queue with position cache | yes | no | no |
| Real service worker + install banner | yes | `coi-serviceworker` only | unregisters legacy SWs |
| Position / FEN editor | no | yes | no |
| Cloud eval, opening explorer, tablebase | no | yes | no |
| Browser (Playwright) tests | one viewport script | boot, review, layout at two sizes | layout + parity + review |
| Engine built from source | no | no | yes (emsdk) |

## What this repo is the reference for

**The engine toolchain.** Pikafish is built from source here — a pinned
upstream ref, an Emscripten patch set, threaded/single/SIMD flavors, an NNUE
loaded into the FS, and `THIRD_PARTY_NOTICES.md` tracing the licence. Neither
sibling builds its engine.

**Real-browser verification.** A Playwright layout harness, worker-parity and
review-parity checks, and a serve-demo test — including a fake-engine injection
that lets the whole UI be driven deterministically with no WASM. web-chess has
no browser test at all and needs exactly that technique.

**Device-tier budgeting.** `analysisProfile` resolves a device profile and then
an engine boot config, a live-analysis policy and a review policy from it. It
is the most portable module in the three repos: 260 lines, one of which
mentions a board.

## What this repo is still missing

A store (state is in a 5,110-line `App.tsx`), a command palette, themes,
haptics, a real service worker, the analysis queue, a position editor, and the
cloud-eval stack. Its library is a flat localStorage list where the siblings
use IndexedDB. Its two grading ladders — centipawn and win-percent — are still
independent constants that cross, so a 190–200cp loss at equality grades as an
inaccuracy on one and a mistake on the other.
