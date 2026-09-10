# Tap targets on a phone — September 10, 2026

An earlier pass asked whether a reader can *reach* a control. This one asks a
narrower question with a number attached: **once they reach for it, how big is
the thing their thumb is aiming at?**

## The bug

`.mobile-action-btn` — the five buttons in the phone's board header: new game,
save, library, more, settings — is drawn 36x36 so that five of them read right
in a 40px bar, and carries an `::after` bleeding the hit area out to 44x44.
That bleed had never reached a thumb vertically. The measured target was
**44x36**.

Two ancestors were clipping it, and both had to be dealt with:

- `.mobile-board-actions` is `overflow-x: auto`. One axis cannot scroll while
  the other overflows visibly, so `overflow-y` computes to `auto` as well and
  the box clipped 4px off the top and bottom of every hit area.
- `.mobile-board-header` was `overflow: hidden`, and the buttons sit at its
  edge, so anything surviving the first clip died at the second.

Fixed in `025ac91`. Overflow is clipped at the *padding* box, so the row pads
by the bleed and hands the space straight back with a negative margin; the
header keeps its clip — a long opening name still must not spill onto the
board — as `overflow: clip` with `overflow-clip-margin` the width of the bleed.
Reverting either half turns the gate red.

Nothing moved: header 40px, board top 198, board 347x386, every button box
identical to 0.01px with and without the change. A pixel diff of four viewports
came back clean but for 16 antialiasing pixels on the icon strokes, each 4/255,
where the row's new padding box changed how it composites — two runs of the
same build diff to zero, so that number is real rather than noise.

## Two ways the instrument lied first

**A layout box is not a tap target.** The first sweep measured
`getBoundingClientRect`, clipped against overflow ancestors, and reported the
five header buttons as 36x36 — the painted chrome. It could not see the bleed,
so it could not see that the bleed was broken either: it read 36x36 both before
and after the fix. The second sweep walks outward from each control's centre
asking `document.elementFromPoint` who owns the pixel, which counts `::after`
bleed, padding and overlays — and that is the number a thumb answers to.

This is the rect-versus-painted-pixels trap from the other side. The usual
form of it is a rect *larger* than what a reader sees — a chip scrolled out of
an overflow container still reporting its full box. Here the rect was *smaller*
than what a reader can hit.

**Two controls answer to "Open settings".** The desktop header and the phone
header carry the same `aria-label`s, and the desktop copy is present but hidden
at 375px. `page.locator('[aria-label*="Open settings" i]').first()` picks the
hidden one, and `.click()` then waits 30s for it to become visible. Wrapped in
the `.catch(() => {})` the sweep used to stay robust, this failed silently:
four views — Moves, Analysis, Library, Settings — were never opened, and each
"recorded" the board view again. The tell was in the output the whole time,
four views reporting an identical control count of 7. Every navigation is now
scoped (`.mobile-action-btn[aria-label="..."]`) and asserts it landed.

**Then the corrected sweep did it again.** Navigating by palette, "game tree"
matched no command and left the palette open over the board, and "game review"
landed on the *engine* panel — the labels are "Move tree", "Review panel",
"Engine panel". Two views recorded the same screen under different names and
the Review panel was never opened at all. Guessing at a control's label is the
same mistake as guessing at its selector.

Each view is now fingerprinted — mobile view, selected tabs, open dialog,
control count — and the sweep **refuses to record a screen it has already
recorded**. That is what makes a coverage claim checkable rather than asserted;
it is also what turned 55 findings into 65, since two whole panels had been
missing from the first count.

## What the corrected sweep found

375x812, hit-testing every control across eight screens proven distinct — the
board, the Move tree, Review and Engine panels, the library, settings, the
board's More menu and the New Game dialog: **65 distinct controls under
44x44**, of which three are under 24 in a dimension.

All three are `.pv-move-btn` at 32x18 — the individual moves inside an engine
line, where each token of "R1=2 R9=8 P3+1" is a button that plays up to that
move. WCAG 2.5.8 exempts these twice over: the *Inline* exception covers a
target "in a sentence or [whose] size is otherwise constrained by the
line-height of non-target text", and the *Equivalent* exception is satisfied by
`.pv-action-btn` ("Play R1=2 from engine line 1"), which does the same job at
59x28.

So after `025ac91` every non-inline control on a phone clears WCAG 2.5.8 AA's
24x24, and the header actions clear the 44x44 that Apple's HIG and WCAG 2.5.5
AAA ask for.

The remaining 62 sit between 25 and 43px. That is a density decision, not a
defect: panel controls are 25-30px tall throughout, and the panels are the part
of this layout that previous passes had to fight for room in. Raising them is a
design change with a cost in board area, not a polish, so it is recorded here
rather than made.

Worth knowing where the line is, though. The tightest non-inline targets are
the move-tree chips and the breadcrumb chips — the primary way a reader jumps
around a game on a phone — whose boxes are **24px tall exactly**, clearing
2.5.8 by nothing at all. They live in a scrolling list, so growing them costs
no fixed layout, only density in a long game. That is the first thing to
revisit if this is ever reopened.

## Measured, and left alone

`.settings-close-btn` (32x32, in three dialogs) has room to bleed to 44x44 in
Settings — 40px clear above it, 64px below, nothing beside it — and in the New
Game menu. It does not in the board editor: 5px to the control above and 4px to
the one on the left, so a 6px bleed would take pixels from its neighbours. A
bleed applied to the class would be right in two places and wrong in the third,
and scoping it per dialog buys 12px on a control that already clears AA. Left
as it is; the crowding in the editor's header is the finding worth keeping.
