# Deployment

Every push to `main` builds the app and publishes it to GitHub Pages
(`.github/workflows/deploy-pages.yml`). Use the workflow's **Run workflow**
action on `main` to redeploy manually. There is no CI test gate: nothing runs
before publication except the build itself, so run the checks below locally
before pushing.

## Build

The build job compiles all four Pikafish variants only when the exact engine
cache key is absent. The key includes the runner platform, pinned emsdk version,
engine-build action, build/install scripts, templates, patches and NNUE weights.
There are no partial-key restores. The React build then runs once, and the
resulting `dist` is uploaded as the Pages artifact and deployed.

The first run of a new engine cache key is a cold build (about 4–5 minutes);
exact-cache hits skip compilation entirely.

## Checking before you push

```sh
npm run verify                              # typecheck, lint, unit tests, engine, build
npm run build:react                         # browser suites load the built dist/
npm run test:ui:audit                       # focused browser regressions
npm run test:ui:audit -- --shard=3/8        # or one shard of them
npm run test:ui:layout                      # layout checks
npm run test:ui:cross-browser -- --smoke    # core workflows in Chromium, WebKit, Firefox
npm run test:prod:smoke                     # loads the built dist/ in a browser
```

The focused audit scripts are registered in `scripts/ui-audit-suites.cjs` and
split into disjoint shards; `node --test scripts/test-ui-audit-shards.cjs`
proves every script lands in exactly one shard. Scripts within a shard run
serially for CPU and port isolation. Per-script timings and results are
written to `.cache/ui-audit-*.json` (and `.cache/ui-layout-*.json` for the
layout checks).
