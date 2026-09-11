# Cross-browser audit — September 11, 2026

This extends the Chromium audit to Playwright's Firefox and WebKit builds on
macOS. It does not certify Safari releases, iOS hardware, or Firefox for Android.
Installed versions: Chromium 148.0.7778.96, Firefox 150.0.2, WebKit 26.4.

## Confirmed fix

Commit `84fccc0` fixes worker ownership during startup. The wrapper used to reject
a failed initialization without terminating its worker. The browser regression
observed zero termination calls after a controlled initialization failure.
Callers also had no way to cancel startup while waiting for the engine handle.

`createWorkerEngine` now accepts an optional AbortSignal, rejects cancellation
with AbortError, and terminates failed/cancelled/timed-out workers. Successful
startup detaches the abort listener; the returned engine retains its normal
termination API. The app aborts pending startup when restarting, disabling
analysis, or cleaning up the hook. Real-worker lifecycle tests and controlled
app restart/disable tests pass in all three browsers. Existing late-startup
watchdog, engine contract, smoke/parity, and Chromium audit tests also pass.

## Reproducible matrix

```sh
npx playwright install chromium firefox webkit
npm run build:react
npm run test:ui:cross-browser
```

To reproduce one browser, set `XIANGQI_QA_BROWSER=firefox` (or `chromium` / `webkit`).
The command serves the built app on its own local port, runs every selected
workflow, collects failures, and returns a nonzero exit status when any fail.
Do not rebuild or edit application assets during a run. Screenshots include the
browser name. The existing `test:ui:audit` continues to default to Chromium.

| Workflow | Chromium | Firefox | WebKit |
| --- | --- | --- | --- |
| Worker startup failure/cancel/timeout/success cleanup | Pass | Pass | Pass |
| Worker progress bounds, reload reset, and byte integrity | Pass | Pass | Pass |
| App startup cancellation on Restart and Play, then resume | Pass | Pass | Pass |
| Recovery across navigation, manual restart, disable, and crash budget | Pass | Pass | Pass |
| Beginner guide, letter pieces, reload, and real AI reply | Pass | Pass | Pass |
| Chinese/emoji shared variations, notes, save, and layout | Pass | Pass | Pass |
| Undo within a study and isolation across games | Pass | Pass | Pass |
| Keep/replay PV, branches, PGN, save/reload, capacity | Pass | Pass | Pass |
| Oversize autosave warning, PGN, prune, and recovery | Pass | Pass | Pass |

Widths range from 320 to 1440 pixels, with short and landscape sizes in the
beginner workflow. Touch-size assertions follow the actual `pointer: coarse`
media query. In this Firefox setup, navigation to the isolated app changes the
reported pointer back to fine despite `hasTouch: true`; its narrow viewport
checks must not be described as touch-device verification.

## Cached-worker isolation fix

The original sharing failure affected newly created, active library workers,
not only workers being terminated. Saving a game rebuilds the explorer worker;
WebKit rejected the cached script load and left the explorer in its error state.

The installed Vite static and transformation handlers return 304 before applying
`server.headers` / `preview.headers`. A real HTTP regression observed the missing
isolation headers on the 304 response, despite their presence on the initial
200 response. Browser response inspection alone was misleading because it
reported the merged cached response headers.

The Vite configuration now installs the headers in middleware before those
handlers. [Vite documents this middleware ordering](https://vite.dev/guide/api-plugin#configureserver).
The fix retains 304 responses, cached bodies, and the existing isolation policy.
It applies to development and Vite preview; the Pages service worker already
adds isolation headers separately.

`npm run test:server:headers` checks actual 200/304 responses for the public
Pikafish wrapper and the library module worker in both server modes. It fails
on the old configuration and passes with the middleware. It is included in
`npm run verify` after the build. The Unicode sharing workflow now passes in
WebKit at 1440, 390, and 320 pixels with ordinary browser caching enabled.

## Recovery during navigation

The remaining beginner reload failure was caused by immediate engine recovery
in a departing document. WebKit cancelled the weights fetch before `pagehide`;
the app started another worker, which failed access-control checks before the
old document left. A diagnostic trace reproduced that ordering. With deferred
recovery, the old worker terminates and no replacement starts before pagehide.
The existing beginner workflow now completes real AI replies and reloads at all
four sizes without filtering page errors or disabling browser caching.

Recovery now waits at least 250 ms to let navigation settle. `pagehide` cancels
the timer; a pending failure can recover on `pageshow` if the document returns.
Disabling the engine, changing its configuration, restarting manually, or
unmounting discards recovery owned by the previous session.

The previous one-second throttle discarded rapid failures outright, potentially
leaving the app stuck on “Recovering engine.” The scheduler now retains them
until the cooldown expires. The existing budget still permits three automatic
restarts in 15 seconds, followed by “Engine paused after crashes.” Manual Restart
resets the crash budget. No engine strength, search budget, or cache policy changes
are part of this fix.

`test-engine-recovery-navigation-browser.cjs` checks the grace period, simulated
pagehide/pageshow, manual restart and disable ownership, resumed PV output, and
bounded repeated failures in all three browsers at 1440, 390, and 320 pixels.
The lifecycle simulation is not certification of hardware back/forward-cache
behavior. Existing startup cancellation and late-constructor watchdog regressions
remain covered. The expanded matrix runs nine workflows per browser and remains
an optional local audit; required CI retains its existing Chromium coverage.

## Engine-tab recovery feedback

The mobile Engine tab hid the Board view's crash notice and continued displaying
“Booting” after automatic recovery had stopped. A visible status message now
explains recovery or the crash pause alongside the existing Restart control.
Search diagnostics carry the same status and action, and the beginner depth
card shows no depth while the engine is unavailable. The notice clears after a
successful restart. Browser coverage keeps the Engine tab open, checks the
message and diagnostics, measures coarse-pointer Restart targets, verifies
horizontal fit, and restarts successfully at 1440, 390, and 320 pixels.


## Starting-position notes

`test-root-notes-browser.cjs` covers the root note editor on desktop and touch
widths of 1440, 390, and 320 pixels. It checks a study with no moves, independent
move/variation comments, PGN and share-link round trips, library search/loading,
unfinished-draft recovery, XQF game/diagram file imports, DhtmlXQ diagrams,
clearing the sole note, and PGN collection download. It also checks horizontal
fit and page errors. The script runs in the Chromium/WebKit/Firefox matrix.


## Unicode limits

`test-unicode-limits-browser.cjs` covers long Chinese/emoji notes, player names,
move previews, downloaded PGN bytes, root-note and variation sharing, and
recovery at 1440/390/320px. Characters crossing a storage or preview limit are
omitted intact; characters that fit keep both UTF-16 units. The matrix checks
source and recipient page errors and responsive horizontal fit.


## Move-quality evidence and accessibility

`test-move-quality-browser.cjs` uses fixed PGN scores and a controlled engine to
keep imported evidence stable. It checks unknown first-move scores for Red and
Black starts, missing scores in a line, genuine zero, quality-mark precedence,
variation-only legends, and matching estimated-quality text in titles and
accessible names. Coverage runs at 1440/390/320px in the three-browser matrix.


## Large-study navigation rendering

`test-move-render-browser.cjs` loads 1,024 plies at 1440/390/320px. A React commit
probe verifies that navigation renders only the affected move/breadcrumb entries.
Native interactions then check roving keyboard focus, new studies with reused
node IDs, WXF/Chinese labels and current-line copying, note edits, changes to a
child's inferred quality after its parent score changes, and branch selection.
The performance benchmark runs separately from these work-count assertions so
CPU scheduling is not a correctness threshold.
