# Text scaling — September 10, 2026

The September 9 passes asked whether the layout fits, and the earlier September
10 pass asked how fast it answers a tap. This one asks a third question of the
same app: what happens when the reader has already told their browser they want
bigger text.

That is a setting, not a viewport. Scaling the root font grows every `rem` in
the app while the window, the panels and the board stay the size they were, so
it stresses a different axis than any resize does — and it is common. The
instrument is a stylesheet appended after load (`html { font-size: Npx }`),
which is what the browser's own default-size setting does, at 16px (the
default), 20px (125%), 24px (150%) and, for the tab strip, 28 and 32.

## The bug

| Commit | Finding and user impact | Change and evidence |
| --- | --- | --- |
| `c1ca8f1` | The right panel's three analysis tabs cut their own labels. At a 24px root on a 1024px window they had **47px of box for 56px of word**: "Review" and "Engine" were painted hard against the border with the last letter gone, and the icons beside them had already been squeezed from 16px to 7px trying to make room. The same a few pixels smaller at 20px/1024 and 24px/1440. WCAG 1.4.4 asks that text survive a 200% resize; this did not. | A second container step at 15rem of panel per root em: the icons go, the side padding tightens, and an ellipsis takes over past the point where even that is not enough. 15rem sits between every combination that fits (16rem of panel per root em and wider) and every one that does not (13.3rem and narrower). The default size is **byte-identical** to before — same SHA-256 on a 4x screenshot of the strip. |

**Where the block goes matters.** A container query adds no specificity. The
first draft sat beside the heading's `@container` rule near the top of
`App.css`, above `.analysis-tab-btn` — so the icon rule worked, the padding
override silently lost to the base rule it was meant to replace, and the fix
looked half-applied for reasons that had nothing to do with the query. It now
sits after the base rules.

## Nothing in the DOM tells the truth about clipped text

Worth writing down, because three separate oracles were tried and all three
lied:

- **`scrollWidth > clientWidth`**, the standard truncation check, reported
  overflow on labels painted whole with padding to spare, *and* missed a real
  6px cut at a smaller overflow.
- **`Range.getBoundingClientRect()`** over the button's contents comes back
  clipped to the content box, so it reports "fits exactly" for anything cut.
- **The same Range with `overflow: visible` set first** re-lays the text out at
  its natural width, wider than what renders, so it reported a 4.5px spill on a
  label that is painted whole.

A `deviceScaleFactor: 8` screenshot of the single button settled it in one look,
both for the defect and for the fix. The regression in
`scripts/test-ui-layout.cjs` therefore gates the *mechanism* — icons kept at
16px, given up at 24px, one row, tighter padding — and says in its own comment
that the visual claim was settled by screenshot rather than pretending to
measure ink.

A related trap from the same session: `min-width: max-content` on the tab
buttons overshot badly and wrapped the strip at the default size, because the
icon is compressible. `max-content` assumes a full-size icon; the real layout
squeezes it. An intrinsic-size number is not what the element will get.

## Sweeps that found nothing

Recorded so the next pass does not repeat them.

- **Every viewport from 320x568 to 2560x1440** with an 80-ply game loaded: no
  horizontal overflow at any width, no clipped text beyond the intentionally
  hidden nodes, no undersized targets. The one suspicious result, a 70x13 chip,
  was a button scrolled half out of its own scroll container.
- **Every dialog and panel at 16px and 24px roots** — board, new game, board
  editor, settings, command palette, library — on desktop at 1280x800 and on
  the mobile layout at 390x844, 360x640 and 900x500. Clean in all 36
  combinations: no horizontal document overflow, no control outside the viewport
  with nothing to scroll it into view, no vertically or horizontally clipped
  text. The analysis tab strip was the only place text scaling broke anything.

## Two gaps found along the way, both now closed

- `cb533ea` — the arrows toggle reached the palette, so it can be found by name
  at any width rather than by knowing which of two places carries it. **The
  claim originally made for this commit was wrong** and is corrected in
  `8f72099`: the top bar button really is dropped at `MOBILE_LAYOUT_QUERY`'s
  900px, but the board's More menu has carried "Hide arrows" on touch all
  along. The probe that "proved" the gap searched for the toolbar button's
  `aria-label`, and the menu item deliberately has none — its visible text
  carries the state instead. Enumerate what is present before believing a null.
  The command is a convenience, not a missing control, and the gate now covers
  both routes, which is a real gain: the More menu had no coverage at all.
- `30230fd` — the command palette's combobox claimed `aria-expanded="true"`
  with `aria-controls` naming a listbox that is not rendered when nothing
  matches, while the live region beside it said "No commands match". Both
  attributes now follow the list.

## Verification and limits

Typecheck, lint (silent — the one long-standing `LibraryPanel` warning is gone
as of `4ac4253`), 1,117 unit tests across 95 files, and the browser gates named
above. Chromium only, headless, on one machine. Every measurement is a lab
measurement: no real reader's browser settings were sampled, and the 15rem
threshold is fitted to the three labels the strip carries today — a fourth tab,
or a longer word, would want it re-measured.
