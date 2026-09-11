# The dev server is 2.7x slower than the thing we ship — September 10, 2026

A step through a 240-move game takes **44ms** on a 4x-throttled CPU. It also
takes **17ms**. The difference is which build was measured, and the gap is
large enough to change what looks worth fixing.

## The numbers

390x844, CPU throttled 4x, time from the ArrowLeft keydown to the move list
showing the new current move, median of 14 steps. Two rounds, dev and prod
interleaved within each round so run-to-run drift cannot be read as a build
difference:

| game length | dev server | production `dist` | ratio |
| --- | ---: | ---: | ---: |
| 4 plies | 18.9ms / 19.6ms | 10.2ms / 9.9ms | 1.84x / 1.98x |
| 240 plies | 47.5ms / 44.6ms | 18.0ms / 16.6ms | 2.64x / 2.69x |

The ratio grows with the length of the move list, which is the part that
matters. **Growth from 4 plies to 240 is +26ms in dev and +7ms in production.**
Most of what looks like a list that scales badly is not the list.

A CPU profile of twenty steps says where dev's extra time goes. The four
largest entries after `(program)` are `jsxDEV`, `validateProperty`,
`warnUnknownProperties` and `jsxWithValidation` — 23% of all samples, and all
of it React's development-only element validation, which runs once per element
created and therefore scales with the 240 chips. None of it is in the bundle.

## What this changes

**A production step is one frame.** 16.6–18.0ms at 4x with a 240-move game,
against a 16.7ms frame, and 10ms with a short one. There is nothing here to
fix, and this pass deliberately fixed nothing.

The two app-side entries in the profile were checked before that conclusion.
`boardBeforeRecord` is O(1) — it clones the 10x9 board a record already carries
and undoes one move — so a long game costs 240 clones per render, not a replay
per chip. Giving each chip its own memoised component would skip roughly 238
notation computations per step; on the production numbers that is a few
milliseconds inside a frame that is already being met, against a real cost in
re-render semantics. Not made.

**Before/after comparisons on one build are unaffected.** The tooltip work in
`audit-2026-09-10.md` measured 36ms → 32ms of forced layout across ten steps,
both sides on the same server; a common factor divides out of a ratio. What is
affected is any *absolute* claim — "a step costs 44ms" is a statement about
`vite dev`, not about the app.

## How to measure the right one

`npm run build:react`, then serve `dist` over plain HTTP with the
`/web-xiangqi/` prefix stripped and an SPA fallback — the same shape
`test-prod-smoke.cjs` already builds for its Pages-style pass. Then interleave:
measure dev, measure prod, repeat, and report the ratio per round rather than
two numbers from two runs.

The measurement itself has a floor worth knowing. Waiting on
`requestAnimationFrame` cannot resolve better than one frame, so every
production number above is at or under the floor and the real work may be
smaller still. Timing the keydown handler synchronously does not help: it
returns in 0.1ms because React commits the update in a later task, so the
clock that looks more precise measures nothing at all.
