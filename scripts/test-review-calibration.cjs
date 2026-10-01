#!/usr/bin/env node
"use strict";

/**
 * Does Game Review give strong play a strong score?
 *
 * `test-review-fixtures-browser.cjs` checks the scoring *functions* against
 * synthetic inputs -- classifyMoveQuality of a 91cp drop, move accuracy for a
 * given winning-chance loss. Nothing checked the whole pipeline: real moves
 * through real engine searches through the aggregation, coming out as a number
 * a player reads.
 *
 * That gap is not hypothetical. The repo shipped ten "Classic Games" attributed
 * to real grandmasters, and the review scored them at 20-28% accuracy with
 * seven to ten blunders each. The natural reading is that the review is broken;
 * the actual answer was that the games were not those games. Telling those two
 * apart took an afternoon, and this is the check that does it in thirty seconds:
 * if strong play still scores strongly, the review is fine and the data is not.
 *
 * ## The fixtures
 *
 * `STRONG` is Pikafish against itself at depth 18, generated from the shipped
 * artifacts. Reviewing it at the app's own depth-16 budget should score it
 * highly -- not perfectly, because the reviewer searches shallower than the
 * player did, so a couple of moves it cannot see the point of read as
 * inaccuracies. That is expected and the bounds allow it.
 *
 * `WEAK` is legal but arbitrary. It is here so the test fails if the review
 * ever starts scoring *everything* highly, which a broken aggregation would.
 *
 * ## Why the bounds are wide
 *
 * The review budget is `movetime`-based, so the depth reached varies with the
 * machine and so does the score. These bounds are set to survive that and still
 * catch the failure that matters: the two populations swapping places, or
 * either collapsing toward the other.
 */

const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.REVIEW_CALIBRATION_PORT || 8194);
const BASE = `http://127.0.0.1:${PORT}/web-xiangqi/`;

/** Pikafish vs Pikafish, depth 18, from the shipped artifacts. */
const STRONG = [
  "c3c4", "b7c7", "h2e2", "c9e7", "h0g2", "c6c5", "c0a2", "c5c4", "a2c4", "i9i8",
  "e2e6", "d9e8", "i0h0", "b9d8", "e6e4", "i8f8", "h0h5", "f8f3", "g3g4", "g6g5",
  "b0c2", "g5g4", "c4e2", "f3g3", "e4a4", "a9b9", "a4b4", "b9d9", "c2d4", "h9g7",
];

/** Legal, and nothing more than legal. */
const WEAK = [
  "h2e2", "h9g7", "b0c2", "b9c7", "a0b0", "a9b9", "g3g4", "g6g5", "h0g2", "h7i7",
  "b2b4", "g7h5", "b4b1", "h5i3", "e0e1", "b7b2", "e1e0", "i7h7", "g2f4", "h7f7",
];

const EXPECTED = [
  { name: "engine self-play at depth 18", moves: STRONG, minAccuracy: 70, maxAvgLoss: 80, maxBlunders: 0, maxMistakes: 1 },
  { name: "arbitrary legal moves", moves: WEAK, maxAccuracy: 30, minAvgLoss: 250, minBlunders: 5 },
];

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

function fail(message) {
  console.error(`Review calibration failed: ${message}`);
  process.exitCode = 1;
}

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

async function reviewGame(page, moves) {
  await page.goto(`${BASE}?moves=${moves.join("+")}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.getByTestId("start-engine-analysis").click();
  await page.waitForTimeout(1500);
  for (const name of [/restore/i, /start fresh/i]) {
    const button = page.getByRole("button", { name });
    if (await button.count()) { await button.first().click().catch(() => {}); break; }
  }
  await page.waitForFunction(() => /Engine ready/.test(document.body.innerText), null, { timeout: 120000 });
  await page.waitForTimeout(1500);

  const loaded = await page.evaluate(() => document.body.innerText.match(/(\d+) \/ (\d+)/g)?.slice(-1)[0] ?? null);
  if (loaded !== `${moves.length} / ${moves.length}`) {
    throw new Error(`fixture did not load whole: expected ${moves.length} plies, board shows ${loaded}`);
  }

  await page.locator("button:visible", { hasText: /^Review Game$/ }).first().click();
  await page.waitForFunction(() => /ACCURACY/i.test(document.body.innerText), null, { timeout: 180000 });
  await page.waitForTimeout(1200);

  return page.evaluate(() => {
    const text = document.body.innerText;
    const num = (re) => { const m = text.match(re); return m ? Number(m[1]) : null; };
    return {
      accuracy: num(/ACCURACY\s*\n?\s*(\d+)%/),
      avgLoss: num(/AVG LOSS\s*\n?\s*(\d+)cp/),
      blunders: num(/BLUNDER\s*\n?\s*(\d+)/),
      mistakes: num(/MISTAKE\s*\n?\s*(\d+)/),
      best: num(/BEST\s*\n?\s*(\d+)/),
      good: num(/GOOD\s*\n?\s*(\d+)/),
      inaccuracies: num(/INACCURA\w*\s*\n?\s*(\d+)/),
    };
  });
}

async function main() {
  const playwright = require("playwright");
  const viteBin = path.join(ROOT, "node_modules", "vite", "bin", "vite.js");
  const server = spawn(
    process.execPath,
    [viteBin, "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"],
    { cwd: ROOT, env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"], detached: true }
  );
  let stdout = "";
  let stderr = "";
  server.stdout.on("data", (chunk) => { stdout += String(chunk); });
  server.stderr.on("data", (chunk) => { stderr += String(chunk); });

  let browser;
  try {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline && !/Local:\s+http/.test(stripAnsi(stdout))) {
      if (/Port \d+ is already in use/.test(stderr)) throw new Error(`port ${PORT} is already in use`);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    if (!/Local:\s+http/.test(stripAnsi(stdout))) throw new Error(`server did not start:\n${stdout}\n${stderr}`);

    browser = await playwright.chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    // The app pauses analysis while the tab is hidden, and a headless page can
    // report itself hidden -- with analysis paused there is nothing to review.
    await page.addInitScript(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
      try { localStorage.clear(); } catch { /* private mode */ }
    });

    const reported = [];
    for (const fixture of EXPECTED) {
      const result = await reviewGame(page, fixture.moves);
      reported.push({ name: fixture.name, ...result });
      const say = (what) => fail(`${fixture.name}: ${what} — got ${JSON.stringify(result)}`);

      if (result.accuracy === null) { say("no accuracy reported"); continue; }

      // Every move lands in exactly one bucket, so the buckets have to add up
      // to the game. This is the check that says the review *looked at the
      // whole game* rather than a prefix of it -- a distinction the accuracy
      // number alone hides completely, because a review that quietly skipped
      // half the moves still reports a perfectly plausible percentage. On a
      // threaded engine a review is fast enough (a 120-ply game in under a
      // second, because consecutive positions share almost all of their search
      // tree) that "it finished quickly" is not evidence either way.
      const classified = ["best", "good", "inaccuracies", "mistakes", "blunders"]
        .reduce((total, key) => total + (result[key] ?? 0), 0);
      if (classified !== fixture.moves.length) {
        say(`classified ${classified} moves but the game is ${fixture.moves.length} plies`);
      }
      if (fixture.minAccuracy !== undefined && result.accuracy < fixture.minAccuracy) say(`accuracy ${result.accuracy}% is below ${fixture.minAccuracy}%`);
      if (fixture.maxAccuracy !== undefined && result.accuracy > fixture.maxAccuracy) say(`accuracy ${result.accuracy}% is above ${fixture.maxAccuracy}%`);
      if (fixture.maxAvgLoss !== undefined && result.avgLoss > fixture.maxAvgLoss) say(`average loss ${result.avgLoss}cp is above ${fixture.maxAvgLoss}cp`);
      if (fixture.minAvgLoss !== undefined && result.avgLoss < fixture.minAvgLoss) say(`average loss ${result.avgLoss}cp is below ${fixture.minAvgLoss}cp`);
      if (fixture.maxBlunders !== undefined && result.blunders > fixture.maxBlunders) say(`${result.blunders} blunders, expected at most ${fixture.maxBlunders}`);
      if (fixture.minBlunders !== undefined && result.blunders < fixture.minBlunders) say(`${result.blunders} blunders, expected at least ${fixture.minBlunders}`);
      if (fixture.maxMistakes !== undefined && result.mistakes > fixture.maxMistakes) say(`${result.mistakes} mistakes, expected at most ${fixture.maxMistakes}`);
    }

    // The bands could both be satisfied by a review that ignores its input, so
    // check the two populations are actually apart.
    const [strong, weak] = reported;
    if (strong.accuracy - weak.accuracy < 40) {
      fail(`strong and weak play scored ${strong.accuracy}% and ${weak.accuracy}% — the review is not separating them`);
    }

    for (const r of reported) {
      console.log(`  ${r.name}: ${r.accuracy}% accuracy, ${r.avgLoss}cp average loss, ${r.blunders} blunders, ${r.mistakes} mistakes`);
    }
    if (!process.exitCode) console.log("Review calibration passed.");
  } catch (error) {
    console.error(String(error && error.stack ? error.stack : error));
    if (stderr.trim()) console.error(`Server stderr:\n${stderr}`);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    await stopServer(server);
  }
}

main();
