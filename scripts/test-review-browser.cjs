const { spawn } = require("child_process");
const http = require("http");
const path = require("path");

async function waitForHttp(url, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const status = await new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
          res.resume();
          resolve(res.statusCode || 0);
        });
        req.on("error", reject);
      });
      if (status >= 200 && status < 500) return;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("Timed out waiting for " + url);
}

async function waitForEngineReady(page, timeoutMs) {
  await page.waitForFunction(() => {
    const body = document.body.textContent || "";
    return /(?:Engine|Pikafish) ready/i.test(body);
  }, null, { timeout: timeoutMs });
}

/**
 * A game with mistakes in it, for a test that needs key moments to exist.
 *
 * Legal and nothing more: reviewed, it produces blunders, which is the point.
 */
const REVIEW_FIXTURE_MOVES = [
  "h2e2", "h9g7", "b0c2", "b9c7", "a0b0", "a9b9", "g3g4", "g6g5", "h0g2", "h7i7",
  "b2b4", "g7h5", "b4b1", "h5i3", "e0e1", "b7b2", "e1e0", "i7h7", "g2f4", "h7f7",
];

async function main() {
  let playwright;
  try {
    playwright = require("playwright");
  } catch (e) {
    throw new Error(
      "Missing playwright dependency. Install it first (e.g. `npm install --no-save playwright`) before running this script."
    );
  }

  const port = Number(process.env.PORT || 4175);
  const host = "127.0.0.1";
  const basePath = "/web-xiangqi/";
  const root = path.resolve(__dirname, "..");
  const viteBin = path.join(root, "node_modules", "vite", "bin", "vite.js");
  const server = spawn(process.execPath, [viteBin, "--host", host, "--port", String(port)], {
    cwd: root,
    env: { ...process.env, BROWSER: "none" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let browser;
  let serverStdout = "";
  let serverStderr = "";
  server.stdout.on("data", (chunk) => {
    serverStdout += String(chunk);
    process.stdout.write(chunk);
  });
  server.stderr.on("data", (chunk) => {
    serverStderr += String(chunk);
    process.stderr.write(chunk);
  });

  try {
    await waitForHttp(`http://${host}:${port}${basePath}`, 30000);

    browser = await playwright.chromium.launch({
      headless: true,
      args: ["--no-sandbox"],
    });
    const page = await browser.newPage();
    // Its own line, loaded through the share-link parameter, rather than a
    // bundled Classic Game. This used to click `load-historical-hist-1`, which
    // coupled a review smoke test to whatever happens to be in that list -- and
    // when the list was emptied, the test failed for a reason that had nothing
    // to do with reviewing.
    //
    // The line is deliberately full of mistakes: the assertions below need key
    // moments to exist, and a well-played game has none.
    await page.goto(
      `http://${host}:${port}${basePath}?moves=${REVIEW_FIXTURE_MOVES.join("+")}`,
      { waitUntil: "domcontentloaded", timeout: 60000 }
    );
    await waitForEngineReady(page, 180000);
    await page.waitForFunction(
      (expected) => document.body.innerText.includes(`${expected} / ${expected}`),
      REVIEW_FIXTURE_MOVES.length,
      { timeout: 30000 }
    );

    await page.getByTestId("analysis-tab-review").click();
    await page.locator('.review-panel [data-testid="start-review-btn"]').click();

    await page.waitForFunction(
      () => document.querySelectorAll('.review-moment-card[data-testid^="review-moment-"]').length > 0,
      null,
      { timeout: 240000 }
    );

    const firstMoment = page.locator('.review-moment-card[data-testid^="review-moment-"]').first();
    const firstMomentLabel = await firstMoment.getAttribute("aria-label");
    if (!firstMomentLabel || !/review moment/i.test(firstMomentLabel) || !/played/i.test(firstMomentLabel)) {
      throw new Error(`Review moment did not expose an actionable label: ${firstMomentLabel}`);
    }
    await firstMoment.click();
    await page.waitForFunction(
      () => Boolean(document.querySelector('.review-moment-card[data-testid^="review-moment-"][aria-current="true"]')),
      null,
      { timeout: 5000 }
    );
    const selectedMomentCurrent = await firstMoment.getAttribute("aria-current");
    if (selectedMomentCurrent !== "true") {
      throw new Error(`Selected review moment did not expose aria-current: ${selectedMomentCurrent}`);
    }

    const graphPoint = await page.getByTestId("graph-current-point").textContent();
    if (!graphPoint || !/Ply/i.test(graphPoint)) {
      throw new Error(`Graph did not sync to selected review moment. Current label: ${graphPoint}`);
    }

    await page.getByTestId("analysis-tab-tree").click();
    await page.getByTestId("move-tree-active").waitFor({ timeout: 10000 });

    await page.getByTestId("save-game-btn").click();
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForEngineReady(page, 180000);

    // The reload finds an auto-save and offers to restore it. The check that
    // decides whether to offer runs on mount, before the URL's moves are
    // applied, so it always sees an empty board and always offers -- and the
    // dialog sits over the toolbar. Take the game from the library instead,
    // which is what the rest of this test is about.
    // The dismiss button is named for what dismissing does, so it reads
    // "Keep the link's game" whenever the address bar carried one in and
    // "Start fresh" when it did not. Match either.
    const recovery = page.getByRole("button", { name: /start fresh|keep the link/i });
    if (await recovery.count()) {
      await recovery.first().click();
      await page.waitForFunction(
        () => !document.querySelector('[role="dialog"]'),
        null,
        { timeout: 10000 }
      );
    }

    await page.getByRole("button", { name: /open game library/i }).click();
    await page.locator('[data-testid^="load-saved-"]').first().click();
    await page.getByTestId("analysis-tab-review").click();
    await page.waitForFunction(
      () => document.querySelectorAll('.review-moment-card[data-testid^="review-moment-"]').length > 0,
      null,
      { timeout: 20000 }
    );

    const reviewCount = await page.locator('.review-moment-card[data-testid^="review-moment-"]').count();
    const summaryText = await page.locator(".review-summary-card").first().textContent();

    console.log("Review browser smoke passed.");
    console.log(`Persisted key moments: ${reviewCount}`);
    console.log(`Summary card: ${String(summaryText || "").trim()}`);
  } catch (err) {
    let pageDump = "";
    try {
      if (browser) {
        const pages = browser.contexts().flatMap((context) => context.pages());
        const page = pages[0];
        if (page) {
          const body = await page.locator("body").textContent().catch(() => "");
          pageDump = `\nPage body tail:\n${String(body || "").slice(-4000)}\n`;
        }
      }
    } catch (_) {}
    throw new Error(
      (err && err.stack ? err.stack : String(err)) +
      pageDump +
      "\nServer stdout:\n" + serverStdout.slice(-4000) +
      "\nServer stderr:\n" + serverStderr.slice(-4000)
    );
  } finally {
    try {
      if (browser) await browser.close();
    } catch (_) {}
    if (!server.killed) {
      server.kill("SIGTERM");
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          try { server.kill("SIGKILL"); } catch (_) {}
          resolve();
        }, 2000);
        server.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
