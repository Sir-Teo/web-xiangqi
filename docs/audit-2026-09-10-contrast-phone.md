# Contrast on a phone — September 10, 2026

A desktop contrast pass had already sampled 46 text elements at 1440x900 and
found nothing under the WCAG AA floor, and recorded that **the dialogs and
every non-desktop viewport were not sampled**. This closes that gap.

## Result

375x812, nine screens proven distinct — board, move tree, review with a review
actually run, engine panel, library, settings, new game, board editor, command
palette — **243 text elements, zero under the AA floor** (4.5:1, or 3:1 for
text at 24px or 18.66px at weight 700+). Contrast is measured from painted
pixels: screenshot, decode through a canvas, histogram each element's box for
its real background, and compare against the computed `color`. Walking
ancestors for `background-color` does not work on this app — the board glyphs
and the board itself paint their colour as a `background-image` gradient over a
transparent `background-color`, which is how an earlier audit produced 18
phantom failures.

Between this and the desktop pass, that is the whole surface.

## Two things the phone needed that the desktop did not

**Text under a modal backdrop is painted near-black**, and reads as 1.07:1
while nobody is trying to read it. Eighteen such "failures" appeared the first
time, every one a board piece behind an open Settings dialog. The sweep now
asks `document.elementFromPoint` who owns the box before measuring it, at five
points rather than one, because a glyph's centre can fall between strokes.

**How many samples came from inside the open dialog** is worth printing on
every line. It is a coverage check that costs nothing, and it is what exposed
the next section: a dialog that is open and contributes zero elements means
something upstream is wrong.

## The reading that was worthless, and how it announced itself

The sweep dimmed one element with `page.addStyleTag` to prove it could see a
failure — a negative control, since a contrast audit that cannot fail is not an
audit. It then cleaned up after itself:

```js
for (const s of document.querySelectorAll("style"))
  if (s.textContent.includes("mobile-turn-label")) s.remove();
```

Vite serves this app's CSS as injected `<style>` tags, and `App.css` contains
`.mobile-turn-label`. That loop deleted the whole stylesheet. Every screen
after it was measured on unstyled HTML — default serif on black, no layout —
and reported a confident **zero failures**, which is exactly what it reported
when the CSS was present. The negative control had passed, because an inline
`<style>` still applies when the app's does not.

Nothing in the numbers said so. What said so was the dialog column reading
`0 in a dialog` while a dialog was open, and then a screenshot.

The sweep now removes the tag through the handle `addStyleTag` returns, and
asserts at **every** screen that the app still has its ~850 CSS rules live,
refusing to report a reading taken from an unstyled page.

## Measured, and deliberately not changed

The review's five quality chips — BEST / GOOD / INACCURACY / MISTAKE /
BLUNDER — flex-wrap 3+2 at 320px and on the desktop panel, and 4+1 at 375 and
414, leaving one chip alone on its own row. A uniform grid would tidy that up.
It would also be a regression: at a 200% root font the longest chip is 196px
against a 327px container, so three equal columns would clip `INACCURACY`.
The ragged wrap is what keeps the labels whole. Measured at 100%, 150% and
200%: no clipping and no panel overflow at any of them.
