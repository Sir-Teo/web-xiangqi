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
 * Run after `build:react`, which is why `verify` calls it last.
 */

const path = require("node:path");
const { spawn } = require("node:child_process");
const fs = require("node:fs");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PROD_SMOKE_PORT || 8193);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const URL = `${ORIGIN}/web-xiangqi/`;
const READY_TIMEOUT_MS = Number(process.env.PROD_SMOKE_READY_TIMEOUT_MS || 120000);

function fail(message) {
  console.error(`Production smoke failed: ${message}`);
  process.exit(1);
}

async function waitForServer(stdoutRef, stderrRef, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (/Local:\s+http/.test(stdoutRef.value)) return;
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

async function main() {
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
  const server = spawn(
    process.execPath,
    [viteBin, "preview", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"],
    { cwd: ROOT, env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"], detached: true }
  );

  const stdout = { value: "" };
  const stderr = { value: "" };
  server.stdout.on("data", (chunk) => { stdout.value += String(chunk); });
  server.stderr.on("data", (chunk) => { stderr.value += String(chunk); });

  let browser;
  try {
    await waitForServer(stdout, stderr, 30000);

    browser = await playwright.chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

    const problems = [];
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(`console: ${message.text().slice(0, 200)}`);
    });
    page.on("pageerror", (error) => problems.push(`pageerror: ${String(error.message).slice(0, 200)}`));
    page.on("requestfailed", (request) => {
      // Favicons and the like are not worth failing a deploy over; engine and
      // bundle assets are exactly what this exists to catch.
      if (/\.(js|css|wasm|nnue)(\?|$)/.test(request.url())) {
        problems.push(`request failed: ${request.url()} (${request.failure()?.errorText})`);
      }
    });

    // A visible page: the app pauses analysis while the tab is hidden, and a
    // headless page can report itself hidden.
    await page.addInitScript(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    });

    const startedAt = Date.now();
    const response = await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    if (!response || !response.ok()) fail(`GET ${URL} returned ${response ? response.status() : "no response"}`);

    await page.waitForSelector(".xiangqi-board", { timeout: 30000 });
    const boardMs = Date.now() - startedAt;

    const fresh = page.getByRole("button", { name: /start fresh/i });
    if (await fresh.count()) await fresh.first().click().catch(() => {});

    await page.waitForFunction(
      () => /Engine ready/.test(document.body.innerText),
      null,
      { timeout: READY_TIMEOUT_MS }
    );
    const readyMs = Date.now() - startedAt;

    // The board is only useful if it drew all ninety points.
    const squares = await page.evaluate(() => document.querySelectorAll("[data-file][data-rank]").length);
    if (squares < 90) fail(`board rendered ${squares} squares, expected at least 90`);

    if (problems.length) fail(`the built app reported:\n  - ${problems.join("\n  - ")}`);

    console.log(
      `Production smoke passed (board ${boardMs}ms, engine ready ${readyMs}ms, ${squares} squares, no console errors).`
    );
  } catch (error) {
    console.error(String(error && error.stack ? error.stack : error));
    if (stdout.value.trim()) console.error(`Server stdout:\n${stdout.value}`);
    if (stderr.value.trim()) console.error(`Server stderr:\n${stderr.value}`);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    await stopServer(server);
  }
}

main();
