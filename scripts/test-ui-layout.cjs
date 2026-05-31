const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");

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
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for " + url);
}

function rectWithinLayout(rects) {
  const { boardSurface, mobileHeader, mobileNav, bottomTab } = rects;
  if (!boardSurface || !mobileHeader || !mobileNav || !bottomTab) {
    throw new Error("Missing mobile board layout elements.");
  }

  if (boardSurface.top < mobileHeader.bottom - 1) {
    throw new Error(
      `Board overlaps mobile header: board top ${boardSurface.top}, header bottom ${mobileHeader.bottom}`
    );
  }
  if (boardSurface.bottom > mobileNav.top + 1) {
    throw new Error(
      `Board overlaps mobile nav: board bottom ${boardSurface.bottom}, nav top ${mobileNav.top}`
    );
  }
  if (mobileNav.bottom > bottomTab.top + 1) {
    throw new Error(
      `Move nav overlaps bottom tab: nav bottom ${mobileNav.bottom}, tab top ${bottomTab.top}`
    );
  }
}

async function assertMobileBoardLayout(page, viewport) {
  await page.setViewportSize(viewport);
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });
  await page.waitForTimeout(500);

  const layout = await page.evaluate(() => {
    const toRect = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return {
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      };
    };

    return {
      body: {
        scrollWidth: document.body.scrollWidth,
        clientWidth: document.body.clientWidth,
      },
      boardSurface: toRect(".xiangqi-board"),
      mobileHeader: toRect(".mobile-board-header"),
      mobileNav: toRect(".mobile-board-nav"),
      bottomTab: toRect(".mobile-tab-bar"),
      hitboxCount: document.querySelectorAll(".hitbox").length,
    };
  });

  if (layout.body.scrollWidth > layout.body.clientWidth + 2) {
    throw new Error(
      `Horizontal overflow at ${viewport.width}x${viewport.height}: ${layout.body.scrollWidth} > ${layout.body.clientWidth}`
    );
  }
  if (layout.hitboxCount !== 90) {
    throw new Error(`Expected 90 board hitboxes, found ${layout.hitboxCount}.`);
  }
  rectWithinLayout(layout);
}

async function main() {
  let playwright;
  try {
    playwright = require("playwright");
  } catch (_) {
    throw new Error(
      "Missing playwright dependency. Install it first (e.g. `npm install --no-save playwright`) before running this script."
    );
  }

  const root = path.resolve(__dirname, "..");
  const viteBin = path.join(root, "node_modules", "vite", "bin", "vite.js");
  const server = spawn(process.execPath, [viteBin, "--host", "127.0.0.1", "--port", "8192"], {
    cwd: root,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let serverStdout = "";
  let serverStderr = "";
  server.stdout.on("data", (chunk) => { serverStdout += String(chunk); });
  server.stderr.on("data", (chunk) => { serverStderr += String(chunk); });

  let browser;
  try {
    await waitForHttp("http://127.0.0.1:8192/web-xiangqi/", 30000);
    browser = await playwright.chromium.launch({
      headless: true,
      args: ["--no-sandbox"],
    });
    const page = await browser.newPage();
    const pageConsole = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") pageConsole.push(msg.text());
    });
    page.on("pageerror", (err) => pageConsole.push(err && err.stack ? err.stack : String(err)));

    await assertMobileBoardLayout(page, { width: 596, height: 668 });
    await assertMobileBoardLayout(page, { width: 390, height: 844 });

    if (pageConsole.length > 0) {
      throw new Error("Unexpected browser console errors:\n" + pageConsole.join("\n"));
    }

    console.log("Mobile board layout checks passed.");
  } catch (e) {
    throw new Error(
      (e && e.stack ? e.stack : String(e)) +
      "\nServer stdout:\n" + serverStdout.slice(-4000) +
      "\nServer stderr:\n" + serverStderr.slice(-4000)
    );
  } finally {
    try { if (browser) await browser.close(); } catch (_) {}
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
  console.error(err);
  process.exit(1);
});
