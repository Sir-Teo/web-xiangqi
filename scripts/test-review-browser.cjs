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
    await page.goto(`http://${host}:${port}${basePath}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForEngineReady(page, 180000);

    await page.getByRole("button", { name: /open game library/i }).click();
    await page.locator('[data-testid="load-historical-hist-1"]').click();
    await page.waitForSelector('[data-testid="graph-load-sweep"]', { timeout: 5000 });

    await page.getByTestId("analysis-tab-review").click();
    await page.locator('.review-panel [data-testid="start-review-btn"]').click();

    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid^="review-moment-"]').length > 0,
      null,
      { timeout: 240000 }
    );

    const firstMoment = page.locator('[data-testid^="review-moment-"]').first();
    await firstMoment.click();

    const graphPoint = await page.getByTestId("graph-current-point").textContent();
    if (!graphPoint || !/Ply/i.test(graphPoint)) {
      throw new Error(`Graph did not sync to selected review moment. Current label: ${graphPoint}`);
    }

    await page.getByTestId("analysis-tab-tree").click();
    await page.getByTestId("move-tree-active").waitFor({ timeout: 10000 });

    await page.getByTestId("save-game-btn").click();
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForEngineReady(page, 180000);

    await page.getByRole("button", { name: /open game library/i }).click();
    await page.locator('[data-testid^="load-saved-"]').first().click();
    await page.getByTestId("analysis-tab-review").click();
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid^="review-moment-"]').length > 0,
      null,
      { timeout: 20000 }
    );

    const reviewCount = await page.locator('[data-testid^="review-moment-"]').count();
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
