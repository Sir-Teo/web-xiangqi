# Using the app — September 10, 2026

The three passes before this one read the app: its layout, its timings, its
stylesheets. This one *used* it. Every defect below was found by opening a
surface and looking at what it said — playing a game against the engine, running
a review, opening the mistake drill, constructing a checkmate — and none of them
would have been found by reading the code, because in every case each part was
correct on its own.

## Bugs fixed

| Commit | Finding and user impact | Change and evidence |
| --- | --- | --- |
| `24ef1ee` | The game over modal showed **the loser's general to the winner**: "Red Wins", "Checkmate", and a red disc carrying 將, which is Black's. Black Wins showed 帥, Red's. Both were the wrong way round, on the one screen whose entire job is saying who won. | The two glyphs are a stroke apart to anyone not reading Chinese, which is how it survives review, so they are named rather than repeated — `RED_GENERAL_GLYPH` and `BLACK_GENERAL_GLYPH` from `pieceStyle`'s traditional set, beside the pieces the board draws from. Reached by building a mate: a bare Black general at d10, Red chariots holding rank 9 and swinging to rank 10, the flying-general rule closing the last escape. Read back as `帥Red WinsCheckmateNew GameReview`. |
| `9415a2b` | The review's study focus card painted **"Chance −43%" — the cost of a blunder — in `var(--accent)`**, the same green as the "Try P7+1" suggestion two lines below it. Measured `rgb(16, 185, 129)` for both, against `rgb(237, 237, 237)` for the eval transition beside it. The figure is a loss by construction: `formatWinPercentLoss` returns "0%" or a leading minus, and the label says "dropped by N percentage points". | Takes the neutral colour its own rule already gives the eval transition. Severity is carried by the quality badge, which is colour-coded properly. Gated against the sibling rather than a literal colour, so a theme change moves both together. |
| `47fc7ea` | Play mode, one screen: the top bar reads "Engine ready · threaded-simd", the engine has just answered C2=5 with H8+7, and the graph's State card reads **"Engine off"**. | What is off is the live evaluation, which is what the state has always meant — the input is `engineEnabled` but its own comment says "Play mode runs without the engine", and the hint already said "Switch to Analysis". The label now reads "Analysis off" and the key is `analysis-off`. |
| `8c72152` | The mistake drill: "Ply 8, where the review found **a** inaccuracy." | `formatReviewQualityWithArticle`, beside `formatReviewQuality`. A letter test, not a sound test — wrong for English generally, right for a closed set of five words. All five are in the test, not just the broken one. |
| `e9a0e4f` | `formatCompactCount` picks its unit from the raw value and *then* rounds, so every nps between 999,500 and 999,999 printed as **"1000k"** — four figures where the scale shows three, in a unit the value had just left. | Promotes to "1M", with the boundary either side tested so the promotion cannot be over-eager, and a separate assertion that the scale never writes four figures before a unit. |

## Refactors, each carrying tests it did not have inside `App.tsx`

`13cbc8c` the Red-POV crossing (35 tests), `e9a0e4f` the engine telemetry
strings (36), `0b4db27` the share link's rules (15), `5615319` the engine tags
(38). `App.tsx` went from 7,858 lines to 7,611 across the session and the unit
suite from 1,091 tests to 1,252.

The tests are about properties where a property exists: the centipawn crossing
is its own inverse, a win/loss swap keeps the total, mate round-trips through
text, no tag can be read as another kind (a full 5x5 matrix — a threat searches
the same board with the *other* side to move, so an analysis parser accepting
one would put the opponent's evaluation on the eval bar as this position's own).

## Sweeps that found nothing

- **Cross-element agreement on engine state.** The three surfaces the
  `analysisActivity` module names — State card, Search card, bottom line — plus
  the top bar, read at one instant in four modes. They agree everywhere; Play
  mode says "Engine ready", "Analysis off" and "Play mode" in three places and
  none of them contradict.
- **Cross-element agreement on side.** Dock turn, dock hint, both generals on
  the board and the eval POV, in four positions including a flipped board. No
  disagreement. (The mobile turn dot and the FEN readout were not reached by the
  probe's selectors — three of five indicators, not five.)
- **Copy.** 787 distinct strings — visible text, `aria-label`, `title`,
  `placeholder` — from board, engine tab, move tree, settings, new game, palette,
  library, review and three drill states, checked for an article before a vowel,
  a singular count with a plural noun, double spaces, space before punctuation
  and repeated words. Zero. The instrument was verified by reintroducing the
  known "a inaccuracy" and confirming it reports exactly that string.
- **Colour against meaning.** Anything in the accent green whose own words say a
  cost, and the reverse, across a reviewed game. Three hits, all false: a call to
  action, and two engine best-lines where Xiangqi's retreat notation (`H7-8`)
  reads as a negative number.
- **DOM churn during live analysis.** 40 mutation records in five seconds, all in
  the eval graph, the eval bar and the current move's chip. The engine panel is
  not rendered when its tab is closed.

## Three things that were not what they looked like

- **A CSS declaration you can read is not one that applies.**
  `.graph-tooltip-chance { color: var(--accent) }` looked like a second instance
  of the review-panel bug and never applied: `.graph-tooltip em` above it is
  (0,1,1) against its (0,1,0). Measured `rgb(161, 161, 170)` with the
  declaration and without. A commit message calling it "the same defect, second
  instance" was written before the check and had to be rewritten (`07b88b2`).
- **The library card's red eval is not the board's red.** `+0.27` in
  `rgb(204, 51, 51)` looked like it contradicted a green board chip. The desktop
  readout is neutral, and the green/red pair belongs to `.mobile-eval-chip`,
  which is never on screen beside the library. Side colouring, coherent, no
  change.
- **`git stash push -- <path>` with nothing to stash creates no stash**, and the
  paired `pop` then takes an unrelated one — here a `WIP on ui-polish-pass` from
  another branch, which conflicted. Nothing was lost (a conflicting pop keeps the
  stash) but the red/green routine for an already-committed fix must edit the
  file and copy an original back, never stash.

Each of the three announced itself the same way: **a red/green check coming back
green on code that was supposed to be broken.** That is the signal to measure the
property directly rather than to distrust the gate.

## Verification and limits

`npm run verify` — typecheck, lint, 1,252 unit tests across 99 files, opening
regressions, library and PGN checks, the engine contract check, the threaded
smoke test, parity, and the production build — and the full `test:ui:layout`
after every commit, read from the `EXIT=` line written into the log rather than
from the task notification, which reports the shell's exit code and said 0 for a
run that failed. Chromium only, headless, one machine.
