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

## Remaining WebKit reload investigation

Beginner reloads still emit `due to access control checks` for `pikafish.js`.
A steady initial load reaches Engine ready, and the beginner flow reaches a
real AI reply before its error assertion fails. The error check remains enabled.

A diagnostic trace shows the initial weights request being cancelled, followed
by engine recovery starting another worker shortly before `pagehide`; that
replacement receives a load error. This distinguishes the remaining navigation
case from the fixed library-worker revalidation failure, but does not yet prove
where the navigation error should be handled.

Separate/fresh wrapper URLs, disabling caching for only the small wrapper and
library worker, and the 304 header fix did not resolve beginner reloads. No
cache-disabling workaround or error suppression was shipped. Next: isolate the
navigation/recovery timing and compare a Pages-style service-worker host.
Retain the 53 MB network's validated cache reuse. The three-browser matrix is
currently **not green** and has not been added as a required CI gate.
