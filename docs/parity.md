# Gates and parity

What has to pass before a change lands here, where each check runs, and how
that compares with the two sibling repos. Written because the checks drifted
apart three times without anyone noticing -- a deploy that ran none of them, a
CI job on a different Node major than the thing it shipped, and a browser suite
wired into no workflow at all.

## Running everything locally

```bash
npm run verify          # typecheck, lint, test, openings, library, engine contract,
                        # smoke, parity, build:react -- and no browser, on purpose
npm run audit           # dependency audit; not part of verify, runs in CI
npm run test:ui:layout        # Playwright, desktop and mobile, fake Pikafish injected
npm run test:prod:smoke       # loads the built dist/ in a browser; needs build:react first
```

**Run it on Node 20.** CI and the deploy both pin 20, and a developer machine
is often several majors ahead; a green run on 26 is not evidence about 20. With
nvm: `export PATH="$HOME/.nvm/versions/node/v20.19.5/bin:$PATH"`.

**Check the exit code, not the output.** `npm run verify | grep -q ...` keys off
grep's status, not the gate's; that mistake put a commit over a failing
typecheck during this work. Run the gate, then read `$?`.

The engine is built from source with emsdk. `npm run build` needs
`bash scripts/install-emsdk.sh` first, and CI caches both.

## Where each check runs

| check | `verify` | `ci.yml` (pull requests **and pushes to `main`**) | deploy (push to `main`) |
| --- | --- | --- | --- |
| typecheck / lint / unit tests | yes | via `verify` | yes |
| `audit` | no | yes | yes |
| engine artifact contract | yes | yes | via `verify` |
| browser suite (`test:ui:layout`) | no | **yes** | no |
| production bundle smoke | no | yes | **yes** |

The browser-suite row used to read "no" for the deploy *and* for `ci.yml`,
because `ci.yml` was pull-request-only -- so nothing browser-level ever ran
against `main`. `ci.yml` now also runs on pushes to `main`, which closes that.

The big browser suite still does not run **in the deploy**, and that is still
deliberate: `ci.yml` publishes nothing, so if a browser test goes flaky it turns
CI red without stopping the site from shipping.

**One browser check is now an exception**, and the trade is worth stating rather
than hiding. `test:prod:smoke` runs in the deploy, which means a flake there
*can* block a publish. It is there because the alternative turned out to be
worse: `ci.yml` is not upstream of the deploy, so a red suite does not stop a
publish, and the bundle in `dist` was the one thing no check had ever loaded --
every other browser suite drives the dev server. The emsdk failure is the
existence proof: Node passed, release builds were silent, and the browser suite
that would have caught it was not upstream of anything.

Its flake surface is kept small on purpose. It asks three questions -- does the
shell paint, does the engine reach ready, did anything throw -- and asserts
nothing about layout, timing or content. If it does prove flaky, the answer is
to narrow it further, not to move it back downstream of the publish.

## How the three compare

The sibling repos are `web-chess`, `web-katrain` and `web-xiangqi`. They are
independent apps with the same shape, so most divergence is fine and some is
not. This section lists what actually differs, measured rather than remembered,
and says which side of that line each item falls on.

| | web-chess | web-katrain | web-xiangqi |
| --- | --- | --- | --- |
| `verify` steps | typecheck, lint, test, build | typecheck, test:typecheck, lint, test, build | typecheck, lint, test, openings, library, smoke, parity, build:react |
| Browser suite | `test:ui:browser` (Playwright) | `test:viewport` (raw CDP, no dependency) | `test:ui:layout` (Playwright) |
| Where the browser suite runs | `ci.yml` (PRs + main) | `ci.yml` (PRs + main) | `ci.yml` (PRs + main) |
| Node in CI / deploy | 20 / 20 | 24 / 24 | 20 / 20 |
| Deploy gates | audit, lint, test, build | audit, lint, test:typecheck, test, build | audit, build (WASM), verify, prod smoke (2 host configs) |
| Hostile-input sweep | `src/__fuzz.test.ts` | `src/__fuzz.test.ts` | `src/__fuzz.test.ts` |
| Undefined CSS token guard | none | none | `src/__cssTokens.test.ts` |
| Where the ceilings sit | search query; library PGN 512KB; backup 8MB; auto-save 2MB | search query; auto-save 5MB; model upload 128MB; verdict scan 4000 nodes | search query; **import text 200KB, UCI moves 1024, tree nodes 1024** |

**Deliberate, leave alone.** The `verify` lists differ because the apps differ:
only web-xiangqi has a WASM engine to smoke-test and an opening book to check.
web-katrain drives Chrome over raw CDP instead of Playwright, which is why it
carries no browser dependency at all. Node 24 in web-katrain against 20 in the
other two is a per-repo pin, not drift -- what matters is that CI and deploy
agree *within* a repo, and all three now do.

**Not deliberate, and worth fixing.**

1. ~~**A push to `main` runs no browser suite anywhere.**~~ **Fixed.** `ci.yml`
   was pull-request-only in all three and no deploy runs a browser test, so
   green CI on `main` meant less than it appeared to. All three now also run
   `ci.yml` on pushes to `main`. It was originally made PR-only because an
   *unrestricted* `push` trigger double-fired alongside `pull_request` on the
   same branch; scoping the trigger to `main` gives the coverage without the
   duplication.
2. **Only one repo caps input *before* it parses it.** All three have ceilings,
   but they sit in different places: web-chess and web-katrain bound what they
   *write* (auto-save, backups, uploads), while web-xiangqi also bounds what it
   *reads* -- import text at 200KB, UCI moves and tree nodes at 1024 -- so
   hostile input is rejected by a length check instead of being walked. The
   hostile-input sweeps put numbers on it: the same class of input clears
   web-xiangqi in 7ms and web-katrain in 30ms. Neither is a bug today; 30ms is
   nowhere near a stutter. The read-side ceiling is the cheaper design and is
   the thing to port.
3. **Only this repo checks that its CSS tokens exist.** A `var(--token)` with
   no fallback and no definition is invalid at computed-value time, so the whole
   declaration is dropped and nothing is drawn -- silently, with no warning from
   the build, the linter or the browser. `src/__cssTokens.test.ts` reads every
   stylesheet under `src/` and fails on one. It was written after four rules in
   one sitting all reached for a `--border` that has never existed, found by
   reading a computed style rather than the stylesheet. All three repos are
   hand-written CSS with token palettes, so all three can have this defect and
   only this one would notice.

**Divergent because only this repo has the problem.** All three size the search
from `hardwareConcurrency`, but only this one also caps it on a *build*
constant: the shipped core is prewarmed with a fixed pthread pool -- twelve, of
which the app may ask for at most eight -- and asking for more than the pool
holds hangs the engine outright, with no error. web-chess and web-katrain have
nothing equivalent because neither builds the engine it ships. Not a gap to
close, but it is the one number here that cannot be changed from `src/` alone
-- see "The thread ceiling is the build" in `docs/architecture.md`.

Only this repo also has to *earn* its threads at runtime. The other two are not
built with a threaded WASM core, so cross-origin isolation costs them nothing;
here it is the difference between 479k and 3.9M nodes per second, and GitHub
Pages does not send the headers that grant it. `public/coi-sw.js` adds them --
isolation only, no caching -- which is the one service worker this repo has
ever deliberately kept. Offline support is still missing, and web-chess's
`public/sw.js` remains the pattern for it.

**The rule this file exists to enforce:** any check that a sibling has and this
repo does not should be either adopted or explained here. The gaps found this
way so far were a deploy that ran no checks at all, a CI/deploy Node split
inside one repo, and a browser suite that ran in no workflow.
