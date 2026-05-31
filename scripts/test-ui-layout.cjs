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

async function assertLibraryDeleteConfirmation(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.evaluate(() => {
    localStorage.setItem("xiangqi-game-library", JSON.stringify([{
      id: "qa-delete-game",
      savedAt: 1710000000000,
      gameMode: "PvP",
      moves: ["b2e2"],
      result: "ongoing",
      label: "Delete confirmation QA",
    }]));
  });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });

  await page.locator('button[aria-label="Open game library"]').click();
  await page.getByText("Delete confirmation QA").waitFor({ timeout: 10000 });

  await page.getByTestId("delete-saved-qa-delete-game").click();
  await page.getByTestId("confirm-delete-saved-qa-delete-game").waitFor({ timeout: 5000 });
  if (await page.getByText("Delete confirmation QA").count() !== 1) {
    throw new Error("Saved game disappeared before delete confirmation.");
  }

  await page.getByRole("button", { name: "Cancel delete saved game" }).click();
  if (await page.getByTestId("confirm-delete-saved-qa-delete-game").count() !== 0) {
    throw new Error("Delete confirmation remained visible after cancel.");
  }
  if (await page.getByText("Delete confirmation QA").count() !== 1) {
    throw new Error("Saved game disappeared after canceling delete.");
  }

  await page.getByTestId("delete-saved-qa-delete-game").click();
  await page.getByTestId("confirm-delete-saved-qa-delete-game").click();
  await page.getByText("No saved games yet. Use the Save button to save the current game.").waitFor({ timeout: 5000 });
  const remaining = await page.evaluate(() => {
    const raw = localStorage.getItem("xiangqi-game-library");
    return raw ? JSON.parse(raw).length : 0;
  });
  if (remaining !== 0) {
    throw new Error(`Saved game remained in localStorage after confirmed delete: ${remaining}`);
  }
}

async function assertMobileSaveLibraryActions(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.evaluate(() => {
    localStorage.removeItem("xiangqi-game-library");
  });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });
  await page.waitForTimeout(500);

  const saveButton = page.getByTestId("mobile-save-game-btn");
  const libraryButton = page.getByTestId("mobile-open-library-btn");
  await saveButton.waitFor({ timeout: 10000 });
  await libraryButton.waitFor({ timeout: 10000 });

  if (!(await saveButton.isDisabled())) {
    throw new Error("Mobile save action should be disabled before any move or custom position.");
  }

  await page.locator('.hitbox[data-file="1"][data-rank="2"]').click();
  await page.locator('.hitbox[data-file="4"][data-rank="2"]').click();
  if (await saveButton.isDisabled()) {
    throw new Error("Mobile save action stayed disabled after a legal move.");
  }

  await saveButton.click();
  const savedGameId = await page.waitForFunction(() => {
    const raw = localStorage.getItem("xiangqi-game-library");
    if (!raw) return null;
    const games = JSON.parse(raw);
    return games.length === 1 ? games[0].id : null;
  }, null, { timeout: 5000 }).then((handle) => handle.jsonValue());

  if (!savedGameId) {
    throw new Error("Mobile save did not create a saved game.");
  }

  await libraryButton.click();
  await page.getByText("My Games").waitFor({ timeout: 5000 });
  await page.getByTestId(`load-saved-${savedGameId}`).waitFor({ timeout: 5000 });
  const activeMobileTab = await page.locator(".mobile-tab-btn.active").textContent();
  if (!String(activeMobileTab || "").includes("Library")) {
    throw new Error(`Mobile library opened under the wrong analysis tab: ${String(activeMobileTab || "").trim()}`);
  }
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
    await assertMobileSaveLibraryActions(page);
    await assertLibraryDeleteConfirmation(page);

    if (pageConsole.length > 0) {
      throw new Error("Unexpected browser console errors:\n" + pageConsole.join("\n"));
    }

    console.log("Mobile board layout, save/library actions, and library delete checks passed.");
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
