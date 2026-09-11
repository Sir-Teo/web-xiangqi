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
| App startup cancellation on Restart and Play, then resume | Pass | Pass | Pass |
| Beginner guide, letter pieces, reload, and real AI reply | Pass | Pass | Fails error check during reload |
| Chinese/emoji shared variations, notes, save, and layout | Pass | Pass | Fails worker error check |
| Undo within a study and isolation across games | Pass | Pass | Pass |
| Keep/replay PV, branches, PGN, save/reload, capacity | Pass | Pass | Pass |
| Oversize autosave warning, PGN, prune, and recovery | Pass | Pass | Pass |

Widths range from 320 to 1440 pixels, with short and landscape sizes in the
beginner workflow. Touch-size assertions follow the actual `pointer: coarse`
media query. In this Firefox setup, navigation to the isolated app changes the
reported pointer back to fine despite `hasTouch: true`; its narrow viewport
checks must not be described as touch-device verification.

## Open WebKit investigation

WebKit emits `due to access control checks` errors for `pikafish.js` during rapid
reload and for the library's position-explorer worker during the sharing flow.
This also occurs against the production build, so it is not solely Vite's
development-module transformation. A steady initial load reaches Engine ready,
and the beginner flow reaches a real AI reply before its error assertion fails.
The error check remains enabled; neither error is treated as harmless yet.

Experiments so far:

- Separate/stable and fresh worker-wrapper URLs did not fix beginner reloads.
- Plain real-worker cancellation/reload with isolation headers did not reproduce
  the app's error; there is not enough evidence to blame cancellation alone.
- Disabling the browser HTTP cache in a diagnostic routing run let the Unicode
  sharing flow pass at 1440, 390, and 320 pixels.
- Serving only `pikafish.js` and the position-explorer worker with `no-store`
  also let sharing pass, while beginner reload still failed. This was an
  experimental server, not a shipped cache-policy change.
- A [similar upstream COEP cache issue](https://bugs.webkit.org/show_bug.cgi?id=245346)
  was fixed in 2022. Similar symptoms do not establish that this is the same bug.

Next: isolate the engine core/WASM cache and navigation interaction, examine
response headers on revalidation, and compare a Pages-style service-worker host.
Retain the 53 MB network's validated cache reuse while diagnosing the smaller
worker/core resources. The three-browser matrix is currently **not green** and
has not been added as a required CI gate.
