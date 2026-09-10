# Reachability and the honesty of the gates — September 10, 2026

Three questions had already been asked of this app: does the layout fit, how
fast does it answer a tap, and what happens when the reader wants bigger text.
This pass asks a fourth — **can a reader reach the thing at all** — and, once
that turned up controls the tests said were fine, a fifth: **are the gates
looking at what a reader sees?**

## Bugs fixed

| Commit | Finding and user impact | Change and evidence |
| --- | --- | --- |
| `b1fdb37` | Click the command palette's match count — ordinary text, not focusable — and focus blurs to `body`. From there the palette stayed open and went deaf three ways at once: **arrow keys stepped the game to the start position behind the dialog**, losing the reader's place in the analysis; Escape did nothing, because it is handled on the dialog and a key pressed on `body` never bubbles through it; and there was nothing to type into. | The condition holding move shortcuts while a dialog is up was written out twice, and the second copy was missing the palette *and* the auto-save recovery modal; there is now one `aDialogIsOpen` for both. The palette holds focus on `mousedown`, and answers Escape from the document. Both handlers also ignore keys aimed inside a `[role="dialog"]` — that guard is what hid the gap, since it only helps while focus *is* inside one. |
| `f2d7b11` | "Set up the board by hand" is reached from inside the New Game menu, and the menu stayed open behind the editor: **two `aria-modal="true"` dialogs at once**, a state a screen reader has no answer for, and one Tab out of the editor landed on the close button of a menu hidden behind the editor's own backdrop. | The menu was open for a reason: the mode a hand-built position starts in was read as `showNewGameMenu ? pendingGameMode : gameMode`, so a dialog's *visibility* carried the reader's choice of who plays which side. The choice is now captured when the editor opens. Gated on both halves — one modal, and the chosen mode surviving — because checking only the modal count would pass for a fix that lost the mode. |
| `fb39160` | `Board.tsx` declines to build touch drag and names the reason: it "needs `touch-action: none` on the squares, which would take the board out of the page's scrolling." `.board-wrap` had carried exactly that since `df1a233`, so the cost was already being paid for the feature that was declined over it — and **two fingers on the board did nothing**. The board is 30–53% of a phone viewport and the part worth magnifying, and the viewport meta deliberately permits zooming. | `touch-action: manipulation`: pinch-zoom and the panning that must follow it return, double-tap zoom stays suppressed. The scrolling the comment protected is not at stake — the mobile layout fits and the page does not scroll at 390x844, 360x640 or 900x500, nor at a 24px root font. |

## Gates that were passing for the wrong reason

`.board-stage-header` — a kicker, the mode as a heading, a description, and
five chips — has been `display: none` at every width since `8f8f897` ("Polish
xiangqi board UX"), which hid it and left the markup behind. Three separate
assertions were reading it:

- the review-practice gate waited for `.board-stage-kicker` to say "Play board"
  and read the mode from `.board-stage-copy h1`;
- a board-editor gate added *one commit earlier in this same session* read the
  same hidden heading;
- **both engine-evaluation gates** read `.board-stage-chip-eval` — the two
  assertions whose entire purpose is "the engine's evaluation reaches the
  reader" were checking text in a container that has never been painted. They
  would have passed with the evaluation missing from the screen entirely.

All now read visible elements: the workspace pill's `aria-pressed`, the bottom
bar's `.game-mode-badge`, and the eval bar's label, whose exact values were
measured rather than guessed (`Engine evaluation, Red POV +0.4, red winning
chances 54%`). Nothing was weakened — the mate gate's `eval-positive` class
check became `red winning chances 100%`, the same claim pinned to a value rather
than a sign, and both eval gates now also assert the bar is painted, which is
the check that was missing. Confirmed by mutation: deleting the
`setWorkspaceMode('play')` the practice route performs makes the rewritten gate
time out.

With nothing depending on it, the markup went too (`7b718e3`): 157 lines out,
8 in. Everything it said is still on screen elsewhere.

## Sweeps that found nothing

- **All four dialogs**, on focus-on-open, Tab trapping, and Escape with focus
  dropped to `body`. Settings, New game and the palette were already correct on
  all three; only the board editor leaked, and that was the stacked-modal bug.
- **Dead markup**, 30 configurations (6 widths x 5 states), scoring each element
  by how often it was in the DOM against how often it was painted.
  `.board-stage-header` and its subtree were the only real finding; the other
  candidates were empty-in-this-state elements and one tab bar the sweep never
  opened.
- **Every class selector in the stylesheets** — 527 of them — against every
  `.tsx`, `.ts` and `.html`. Twenty-seven had no plain-text reference, and
  twenty-five are built by template literal (each construction site found).
  `.btn-primary` and `.btn-icon-only` were genuinely dead and are gone
  (`430b1f5`).
- **Contrast from painted pixels**, 46 visible text elements at 1440x900: none
  under the AA floor.
- **Desktop against phone, control by control**: 247 named controls against 199,
  with every panel and dialog opened on each. Every difference is explicable —
  bars a phone does not have, per-move dynamic labels, and engine tier (16/24/48MB
  hash and a 10s deep search on mobile against 64–512MB and 30s on desktop).

## Four instruments that lied

Every one of these produced a confident, plausible, wrong reading. They are
recorded because the cost is always a wasted iteration, and once it was a wrong
claim in a commit message.

1. **`Input.synthesizePinchGesture` ignores `touch-action`.** It zoomed to 2.5x
   identically with `none` and with `manipulation` — a clean pass on a board
   that could not be pinched. `Input.dispatchTouchEvent` with two touch points
   goes through hit testing and honours the property: 1 → 5 against 1 → 1.
2. **Screenshot diffing is noise at this granularity.** Comparing before and
   after said two viewports of four had changed; shooting the *same* build twice
   said a *different* viewport had. Live engine text leaks through any freeze.
   Geometry is stable: board, stage, wrap, four panels, dock, eval bar and both
   document scroll extents, identical to the byte.
3. **Searching by one control's label.** A probe looked for the top bar's
   `aria-label="Toggle board arrows and markers"`, found it absent at 390px, and
   a commit message, a code comment and an audit entry all went out saying a
   phone had no way to clear the board arrows. The board's More menu has carried
   "Hide arrows" all along and deliberately carries no aria-label. Corrected in
   `8f72099`. What found it was the control-surface diff above.
4. **The task-completion notification's exit code.** Running the gate as
   `npm run test:ui:layout > log 2>&1; echo "EXIT=$?" >> log` makes the compound
   command succeed whatever the suite did. The notification said "exit code 0"
   for a run whose own `EXIT=` line said 1.

## A defect class only the full suite can catch

That failing run was a new assertion leaving a **persisted** preference changed:
the notation gate left the style on UCI, and the shared page carried it into
`assertMobileSaveLibraryActions`, which failed reading a move list as
`1.炮 B2→E2`. In isolation the new gate passed every time, because in isolation
there is nothing downstream to poison. An assertion that changes stored state
has to put it back, and the restore should itself be asserted (`eb6dd9e`).

## Features added along the way

All four are palette commands, and all four exist because a control was reachable
only from one place: `2aeff01` import a game record (the palette could take a
record out five ways and bring one back by none), `cb533ea` show/hide arrows,
`557bc08` mute, and `ec63ee1` the three move notations. That last one changed
shape because of its gate: the settings pills read "UCI" and "中文" under a
"Move Notation" heading, but a palette row has no such context, and typing
"chinese" ranked "Write moves in 中文" *fourth* behind two commands that merely
mention Chinese in passing. The labels are spelled out.

## Verification and limits

Typecheck, lint (silent), 1,117 unit tests across 95 files, and the full
`test:ui:layout`, whose `EXIT=` line was checked rather than its notification.
Chromium only, headless, one machine. The contrast sweep covered one viewport
and no dialogs. `assertEngineTelemetryDashboard` fails when run alone in a
scratchpad subset runner, at an unrelated Clear Hash wait, on pristine `HEAD` as
well as on changed source — it is load-sensitive in isolation, not broken, and
the full suite is the signal.
