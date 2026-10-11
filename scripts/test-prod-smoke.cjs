#!/usr/bin/env node
"use strict";

/**
 * The built app, in a browser, once.
 *
 * Every browser suite in this repo drives `vite` — the *dev* server.
 * `test-ui-layout.cjs` spawns `vite.js` with no subcommand, and so does
 * everything that follows it. So the bundle that is uploaded to Pages is the
 * one thing no check has ever loaded.
 *
 * That is the same shape as the emsdk failure recorded in
 * `docs/architecture.md`: what ships is not what is tested. Dev and production
 * differ in minification, tree-shaking, asset URLs under `base`, and every
 * `import.meta.env.DEV` branch — this app has several, including the engine's
 * diagnostic logging.
 *
 * Deliberately shallow. It is not a second UI suite; it asks the three
 * questions that separate a working deploy from a broken one:
 *
 *   1. does the shell paint,
 *   2. does the engine — loaded from `base`-relative URLs — reach `readyok`,
 *   3. did anything throw or log an error on the way.
 *
 * It asks them twice, because there are two production configurations and only
 * one of them was ever being tested.
 *
 * `vite preview` sends COOP and COEP, so the page it serves is cross-origin
 * isolated and the engine loads its threaded core. **GitHub Pages sends
 * neither**, and serves static files with fixed headers, so it cannot be made
 * to. The deployed app therefore always runs the single-threaded core — and
 * every browser check in this repo, this one included, ran on the other side of
 * that branch.
 *
 * What got through was not subtle once seen: the engine dashboard reported
 * `single-simd` and `8T` at the same time, and offered a thread picker whose
 * every rung was 1. So the second pass serves `dist` the way Pages does, from a
 * plain static server with no isolation headers, and checks that the app both
 * works there and says so honestly.
 *
 * Needs `build:react` to have run, because it loads what that produced.
 *
 * Not part of `verify`, deliberately: that command is browser-free so it works
 * offline, and the README lists this one under "Not in `verify`" for exactly
 * that reason. No workflow runs it either: the Pages deploy builds and
 * publishes without tests, so run it before pushing a change to the build.
 *
 * So a green local `verify` has *not* opened the bundle. That is the gap this
 * file exists to describe, and saying otherwise here would have been the same
 * mistake one level up.
 */

const path = require("node:path");
const { spawn } = require("node:child_process");
const fs = require("node:fs");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PROD_SMOKE_PORT || 8193);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const URL = `${ORIGIN}/web-xiangqi/`;
const PLAIN_PORT = Number(process.env.PROD_SMOKE_PLAIN_PORT || PORT + 1);
const PLAIN_URL = `http://127.0.0.1:${PLAIN_PORT}/web-xiangqi/`;
const READY_TIMEOUT_MS = Number(process.env.PROD_SMOKE_READY_TIMEOUT_MS || 120000);

/**
 * Throws rather than exiting, so the teardown in `main` actually runs.
 *
 * It used to call `process.exit(1)`, which skips `finally` -- so any failed
 * assertion left the preview server holding the port, and the *next* run died
 * with "port 8193 is already in use". That is the failure the spawn below is
 * commented against, arriving by the other door: a suite that stays red for a
 * reason that has nothing to do with the code.
 */
function fail(message) {
  throw new Error(message);
}

/**
 * vite colours its startup banner when it believes it is writing to a terminal,
 * and a CI runner makes it believe that. The banner then reads
 * `\x1b[1mLocal\x1b[22m:   \x1b[36mhttp://...`, so a pattern looking for
 * `Local:` followed by `http` never matches and the server is declared dead
 * thirty seconds after it started fine. Locally vite sees a pipe, drops the
 * colour, and the same pattern matches every time -- which is why this passed
 * here for weeks and failed the first time it ran on a runner.
 */
function stripAnsi(text) {
  return String(text).replace(/\u001B\[[0-9;]*m/g, "");
}

async function waitForServer(stdoutRef, stderrRef, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (/Local:\s+http/.test(stripAnsi(stdoutRef.value))) return;
    if (/Port \d+ is already in use/.test(stderrRef.value)) {
      throw new Error(
        `port ${PORT} is already in use — a previous preview server is still running. ` +
        `Set PROD_SMOKE_PORT to use another.`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`preview server did not start in ${timeoutMs}ms:\n${stdoutRef.value}`);
}

/** Take the whole process group down, and wait for it to actually be gone. */
async function stopServer(server) {
  if (server.exitCode !== null || server.signalCode !== null) return;
  const exited = new Promise((resolve) => server.once("exit", resolve));
  try { process.kill(-server.pid, "SIGTERM"); } catch { server.kill("SIGTERM"); }
  const timer = setTimeout(() => {
    try { process.kill(-server.pid, "SIGKILL"); } catch { server.kill("SIGKILL"); }
  }, 4000);
  await exited;
  clearTimeout(timer);
}

/** The old demo's caching worker, as a returning visitor would still have it. */
const LEGACY_WORKER = `
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open('pikafish-demo-legacy').then((c) => c.put('/web-xiangqi/stale', new Response('stale'))));
});
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
`;

/**
 * `dist` over HTTP with no COOP/COEP — GitHub Pages, as far as the browser is
 * concerned. In-process on purpose: a child would be another thing to leak.
 */
function startPlainServer(port) {
  const http = require("node:http");
  const TYPES = {
    ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
    ".wasm": "application/wasm", ".json": "application/json", ".svg": "image/svg+xml",
  };
  const root = path.join(ROOT, "dist");
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(String(req.url).split("?")[0]).replace(/^\/web-xiangqi\/?/, "") || "index.html";

    // Two fixtures the build does not contain, for the returning-visitor pass:
    // the old demo's caching worker at the filename `serviceWorkerCleanup`
    // recognises, and a bare page to install it from that will not boot the app.
    if (rel === "sw.js") {
      res.writeHead(200, { "Content-Type": "text/javascript" });
      res.end(LEGACY_WORKER);
      return;
    }
    if (rel === "legacy-setup.html") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<!doctype html><title>legacy</title>legacy");
      return;
    }
    if (rel.endsWith("/")) rel += "index.html";
    let file = path.join(root, rel);
    // SPA fallback, and a guard against escaping dist.
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(root, "index.html");
    }

    // Validators, because Pages sends them and the whole point of the weights
    // cache is that it revalidates against one.
    const stat = fs.statSync(file);
    const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    const name = path.basename(file);
    if (req.headers["if-none-match"] === etag) {
      server.transferred.push({ name, status: 304, bytes: 0 });
      res.writeHead(304, { ETag: etag, "Cache-Control": "max-age=600" });
      res.end();
      return;
    }
    server.transferred.push({ name, status: 200, bytes: stat.size });
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "max-age=600",
      ETag: etag,
      "Last-Modified": stat.mtime.toUTCString(),
      "Content-Length": stat.size,
    });
    fs.createReadStream(file).pipe(res);
  });
  // What the server actually put on the wire, which is the only way to tell a
  // cache that works from one that does not.
  server.transferred = [];
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

/**
 * The engine's weights, fetched once rather than on every visit.
 *
 * `pikafish.nnue` is over 53MB and a browser HTTP cache will not store an entry
 * that large -- so before `coi-sw.js` kept it in Cache Storage, every visit paid
 * the whole 53MB again. That is around forty seconds on a ten-megabit phone
 * connection, each time the board is opened.
 *
 * Two things have to hold, and they pull in opposite directions. The second
 * visit must not re-transfer the body, or the cache is doing nothing. And it
 * must still *ask* -- a conditional request, answered 304 -- because a copy
 * served on its own authority is exactly the stale engine artifact this repo's
 * `serviceWorkerCleanup` exists to clean up after.
 */
async function checkWeightsAreCachedAcrossVisits(browser, server) {
  // One context for both visits: Cache Storage lives with the context, which is
  // what makes the second load a returning visitor rather than a new one.
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const page = await context.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    });

    const visit = async () => {
      const before = server.transferred.length;
      await page.goto(PLAIN_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForSelector(".xiangqi-board", { timeout: 30000 });
      await page.getByTestId("start-engine-analysis").click();
      await page.waitForFunction(
        () => /Engine ready/.test(document.body.innerText),
        null,
        { timeout: READY_TIMEOUT_MS }
      );
      await page.waitForTimeout(800);
      return server.transferred.slice(before).filter((entry) => entry.name === "pikafish.nnue");
    };

    const first = await visit();
    const second = await visit();

    const bytes = (entries) => entries.reduce((total, entry) => total + entry.bytes, 0);
    if (!first.length || bytes(first) === 0) {
      throw new Error(`weights: the first visit never fetched them (${JSON.stringify(first)})`);
    }
    if (!second.length) {
      throw new Error(
        "weights: the second visit did not ask for them at all. A cached engine net has to be " +
        "revalidated on every load, or a redeployed one is never picked up."
      );
    }
    if (bytes(second) !== 0 || second.some((entry) => entry.status !== 304)) {
      throw new Error(
        `weights: the second visit transferred ${bytes(second)} bytes (${JSON.stringify(second)}). ` +
        "Over 53MB is being re-sent on every visit -- see the weights cache in public/coi-sw.js."
      );
    }
  } finally {
    await context.close().catch(() => {});
  }
}

/** The shell, the engine, and a clean console. Returns what the page reported. */
async function checkApp(target, url, label) {
  const page = await target.newPage({ viewport: { width: 1280, height: 900 } });
  const problems = [];
  const failedAssets = [];
  const requestNavigation = new WeakMap();
  let navigation = 0;
  page.on("framenavigated", frame => { if (frame === page.mainFrame()) navigation += 1; });
  page.on("request", request => requestNavigation.set(request, navigation));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text().slice(0, 200)}`);
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${String(error.message).slice(0, 200)}`));
  page.on("requestfailed", (request) => {
    // Favicons and the like are not worth failing a deploy over; engine and
    // bundle assets are exactly what this exists to catch.
    if (/\.(js|css|wasm|nnue)(\?|$)/.test(request.url())) {
      failedAssets.push({ url: request.url(), error: request.failure()?.errorText, navigation: requestNavigation.get(request) });
    }
  });

  // A visible page: the app pauses analysis while the tab is hidden, and a
  // headless page can report itself hidden.
  await page.addInitScript(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  });

  const startedAt = Date.now();
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  if (!response || !response.ok()) fail(`${label}: GET ${url} returned ${response ? response.status() : "no response"}`);

  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });
  const boardMs = Date.now() - startedAt;

  // On a host without isolation headers, coi-sw.js installs and the page
  // reloads once. Let that settle so the assertions below read the document
  // that came back through the worker rather than the one that preceded it.
  await page.waitForTimeout(1500);
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });

  const fresh = page.getByRole("button", { name: /start fresh/i });
  if (await fresh.count()) await fresh.first().click().catch(() => {});

  await page.getByTestId("start-engine-analysis").click();
  await page.waitForFunction(
    () => /Engine ready/.test(document.body.innerText),
    null,
    { timeout: READY_TIMEOUT_MS }
  );
  const readyMs = Date.now() - startedAt;

  // The board is only useful if it drew all ninety points.
  const squares = await page.evaluate(() => document.querySelectorAll("[data-file][data-rank]").length);
  if (squares < 90) fail(`${label}: board rendered ${squares} squares, expected at least 90`);

  // The engine dashboard lives behind the Engine tab, and the thread count is
  // the whole point of the second pass.
  await page.locator("button:visible", { hasText: /^Engine$/ }).first().click().catch(() => {});
  await page.waitForSelector(".engine-dashboard", { timeout: 15000 }).catch(() => {});

  const reported = await page.evaluate(() => {
    const dashboard = document.querySelector(".engine-dashboard");
    const text = dashboard ? dashboard.textContent : "";
    const core = text.match(/threaded-simd|single-simd|threaded|single/);
    const threads = text.match(/(\d+)T/);
    return {
      isolated: crossOriginIsolated,
      sawDashboard: Boolean(dashboard),
      variant: core ? core[0] : null,
      threads: threads ? Number(threads[1]) : null,
    };
  });
  if (!reported.sawDashboard) fail(`${label}: the engine dashboard never rendered, so nothing about the engine was checked`);

  for (const asset of failedAssets) {
    // Installing the isolation worker reloads the page and cancels requests
    // belonging to the previous document. Failures in the final document still
    // fail the smoke check, including aborted bundle and engine requests.
    if (asset.error === "net::ERR_ABORTED" && asset.navigation < navigation) continue;
    problems.push(`request failed: ${asset.url} (${asset.error})`);
  }
  if (problems.length) fail(`${label}: the built app reported:\n  - ${problems.join("\n  - ")}`);
  await page.close();
  return { boardMs, readyMs, squares, ...reported };
}

async function main() {
  const stdout = { value: "" };
  const stderr = { value: "" };
  let server;
  let browser;
  let plain;
  try {
    for (const required of ["dist/index.html", "dist/pikafish.js", "dist/pikafish.nnue"]) {
      if (!fs.existsSync(path.join(ROOT, required))) {
        fail(`${required} is missing. Run \`npm run build:react\` (and \`npm run build\`) first.`);
      }
    }

    const playwright = require("playwright");
    const viteBin = path.join(ROOT, "node_modules", "vite", "bin", "vite.js");
    // Its own process group, so the teardown below can take the whole tree.
    // Killing the wrapper alone left a listener on the port, and the *next* run
    // then failed to start -- a leaked server turns one bad run into a suite that
    // stays red until someone notices a stray process.
    server = spawn(
      process.execPath,
      [viteBin, "preview", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"],
      { cwd: ROOT, env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"], detached: true }
    );
    server.stdout.on("data", (chunk) => { stdout.value += String(chunk); });
    server.stderr.on("data", (chunk) => { stderr.value += String(chunk); });

    await waitForServer(stdout, stderr, 30000);

    browser = await playwright.chromium.launch({ headless: true, args: ["--no-sandbox"] });

    // 1. Isolated, as `vite preview` serves it: the threaded core.
    const isolated = await checkApp(browser, URL, "isolated");
    if (!isolated.isolated) {
      fail("the preview server did not send COOP/COEP, so the isolated pass tested nothing");
    }

    // 2. Served the way GitHub Pages serves it -- no isolation headers on the
    //    response -- where `public/coi-sw.js` has to put them back.
    plain = await startPlainServer(PLAIN_PORT);
    const pages = await checkApp(browser, PLAIN_URL, "pages");

    if (!pages.isolated) {
      fail(
        "pages: the page never became cross-origin isolated, so coi-sw.js did not take effect. " +
        "Without it the deployed app runs the single-threaded core at about an eighth of the " +
        "nodes per second — see public/coi-sw.js and the registration in index.html."
      );
    }
    // Parity with an isolated host, rather than a named core. Which core the app
    // picks is a property of the *machine* -- `detectDeviceTier` grades on cores,
    // memory and viewport, and a two-core CI runner can land on a single-threaded
    // core perfectly legitimately even when isolated. What the worker promises is
    // that a host sending no headers ends up where a host sending them does, and
    // that is the same claim on any machine.
    if (pages.variant !== isolated.variant || pages.threads !== isolated.threads) {
      fail(
        `pages: with coi-sw.js the app got "${pages.variant}" / ${pages.threads}T, but an ` +
        `isolated host gives "${isolated.variant}" / ${isolated.threads}T. The worker is ` +
        `supposed to make those identical.`
      );
    }

    // The honesty invariant, which is what actually shipped wrong: whatever the
    // page managed to become, the dashboard has to agree with it. It read
    // `single-simd` and `8T` at the same time for as long as the app resolved
    // threads without asking whether it could have any.
    for (const [label, result] of [["isolated", isolated], ["pages", pages]]) {
      if (/^threaded/.test(String(result.variant)) !== result.threads > 1) {
        fail(
          `${label}: the dashboard reports "${result.variant}" and ${result.threads} threads, ` +
          `which cannot both be true — see detectThreadSupport in analysisProfile.ts`
        );
      }
    }

    // 3. The returning visitor: still carrying the old demo worker, which is an
    //    active registration at the same scope. This is what shipped broken --
    //    reloading on `navigator.serviceWorker.ready` resolved against *that*
    //    worker, so the reload happened before coi-sw.js controlled anything and
    //    the one-shot guard then blocked the reload that would have worked. The
    //    symptom was a site that stayed single-threaded forever, silently.
    const returning = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    let upgraded;
    try {
      const setup = await returning.newPage();
      await setup.goto(`${PLAIN_URL}legacy-setup.html`, { waitUntil: "domcontentloaded", timeout: 30000 });
      const before = await setup.evaluate(async () => {
        const registration = await navigator.serviceWorker.register("/web-xiangqi/sw.js");
        await navigator.serviceWorker.ready;
        return registration.active ? registration.active.scriptURL : null;
      });
      if (!before || !/\/sw\.js$/.test(before)) fail(`returning: could not install the legacy worker (got ${before})`);
      await setup.close();

      upgraded = await checkApp(returning, PLAIN_URL, "returning");
      if (!upgraded.isolated) {
        fail(
          "returning: a visitor who still has the old demo service worker never became " +
          "cross-origin isolated, so the deployed app stays single-threaded for everyone who " +
          "used the site before — see the controllerchange handler in index.html."
        );
      }
      if (upgraded.variant !== isolated.variant || upgraded.threads !== isolated.threads) {
        fail(
          `returning: got "${upgraded.variant}" / ${upgraded.threads}T where an isolated host ` +
          `gives "${isolated.variant}" / ${isolated.threads}T`
        );
      }
    } finally {
      await returning.close().catch(() => {});
    }

    await checkWeightsAreCachedAcrossVisits(browser, plain);

    console.log(
      `Production smoke passed:\n` +
      `  isolated: ${isolated.variant}, ${isolated.threads}T, board ${isolated.boardMs}ms, ready ${isolated.readyMs}ms\n` +
      `  pages (no COOP/COEP, isolated by coi-sw.js): ${pages.variant}, ${pages.threads}T, board ${pages.boardMs}ms, ready ${pages.readyMs}ms\n` +
      `  returning visitor (legacy sw.js installed): ${upgraded.variant}, ${upgraded.threads}T, ready ${upgraded.readyMs}ms`
    );
  } catch (error) {
    console.error(`Production smoke failed: ${error && error.message ? error.message : error}`);
    if (error && error.stack && !/^Production smoke/.test(String(error.message))) console.error(error.stack);
    if (stdout.value.trim()) console.error(`Server stdout:\n${stdout.value}`);
    if (stderr.value.trim()) console.error(`Server stderr:\n${stderr.value}`);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (plain) await new Promise((resolve) => plain.close(resolve));
    if (server) await stopServer(server);
  }
}

main();
