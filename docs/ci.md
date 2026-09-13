# CI and deployment

The `CI` workflow checks pull requests and pushes to `main`. Use its **Run
workflow** action on `main` to retry the complete pipeline manually. Pages is a
reusable workflow called only after every CI check passes; it publishes the
same application artifact that the tests used.

## Build once

App checks run alongside one build job. That job compiles all four Pikafish
variants only when the exact engine cache key is absent. The key includes the
runner platform, pinned emsdk version, engine-build action, build/install scripts,
templates, patches and NNUE weights. There are no partial-key restores. Engine
contract checks run before saving the cache, so an unrelated browser failure
does not discard a successful engine compilation. Unrelated workflow edits do
not invalidate that cache.

The React build runs once per commit. An uncompressed workflow artifact carries
`dist` to the engine checks, browser jobs and deployment. Browser jobs also copy
its engine files to `public` for tests that own a Vite development server;
they do not test older checked-in binaries. Focused audit shards use Vite
preview against `dist`, avoiding repeated development transforms and React
StrictMode's extra rendering work in production performance measurements. The neural-network weights are already compressed, so applying zip compression
to the shared artifact wastes work.

## Browser checks

The 105 focused audit scripts are assigned to eight disjoint shards using
`scripts/ui-audit-suites.cjs`. Tests prove that the workflow's actual shard
arguments cover every registered script exactly once. Scripts within a shard
remain serial; parallelism comes from separate runners, preserving CPU and
port isolation. The 158 layout checks run in four disjoint shards, with the
same coverage guarantee. Review fixtures, review, calibration, worker parity,
production smoke and server tests have their own jobs. The matrix uses 18
browser runners; checks remain serial within each runner.

A failing script does not cancel other shards or later scripts in its shard.
Each script retains a three-minute process limit. The runner prints script
boundaries and writes per-script timings/results to `.cache/ui-audit-*.json`
and the Actions job summary. Layout shards record the same diagnostics in
`.cache/ui-layout-*.json`. Failed jobs upload these results and screenshots.
The stable `verify` job rejects failed, cancelled or skipped checks before
Pages can run.

Build the app first (`npm run build:react`) when reproducing locally.

```sh
npm run test:ui:audit -- --shard=3/8       # reproduce one CI shard
npm run test:ui:audit -- --shard=3/8 --list
npm run test:ui:layout -- --shard=2/4     # or omit --shard to run all checks
node --test scripts/test-ui-audit-shards.cjs
```

## Measured baseline and timeout repair

For commit `2b6ed1b`, [CI run 34729171229](https://github.com/Sir-Teo/web-xiangqi/actions/runs/34729171229)
failed after 8m16s. This was a 30-second locator timeout in the third audit
script, not the 90-minute job limit. The test waited for a transient review
announcement even though the persistent review error was already present.
It now waits for that persistent error. Tests that immediately send keyboard
shortcuts after navigation now wait for the app board to mount first; otherwise
Vite can finish document navigation before React installs its shortcut handler.
Tests inspecting mobile move controls open their panel before querying it.

The old CI engine build took 4m40s. The independent [successful Pages run](https://github.com/Sir-Teo/web-xiangqi/actions/runs/34729171254)
compiled the same engine again in 4m15s. Sharing one build removes that duplicate
work; subsequent exact-cache hits skip compilation entirely. Actual end-to-end
latency also depends on runner queues and the slowest browser shard. The first
run of a new engine cache key is a cold build.

The workflow follows GitHub's distinction between [dependency/build caches](https://docs.github.com/en/actions/concepts/workflows-and-actions/dependency-caching)
for reuse across runs and [workflow artifacts](https://docs.github.com/en/actions/concepts/workflows-and-actions/workflow-artifacts)
for passing this run's tested build between jobs.
