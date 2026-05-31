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

function rectWithinDesktopLayout(rects) {
  const { boardSurface, positionDock, topPanel, bottomPanel } = rects;
  if (!boardSurface || !positionDock || !topPanel || !bottomPanel) {
    throw new Error("Missing desktop board layout elements.");
  }

  if (boardSurface.top < topPanel.bottom - 1) {
    throw new Error(
      `Board overlaps desktop top bar: board top ${boardSurface.top}, top bar bottom ${topPanel.bottom}`
    );
  }
  if (positionDock.top < boardSurface.bottom - 1) {
    throw new Error(
      `Position dock overlaps desktop board: dock top ${positionDock.top}, board bottom ${boardSurface.bottom}`
    );
  }
  if (positionDock.bottom > bottomPanel.top + 1) {
    throw new Error(
      `Position dock overlaps desktop bottom bar: dock bottom ${positionDock.bottom}, bottom bar top ${bottomPanel.top}`
    );
  }
}

async function assertDesktopBoardLayout(page, viewport) {
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
      positionDock: toRect(".position-dock"),
      topPanel: toRect(".panel.top"),
      bottomPanel: toRect(".panel.bottom"),
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
  rectWithinDesktopLayout(layout);
}

async function assertDesktopResizeFeedback(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });

  const handle = page.locator(".panel.left .resize-handle-right");
  const box = await handle.boundingBox();
  if (!box) {
    throw new Error("Desktop resize handle is not visible.");
  }

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  try {
    const feedback = await page.evaluate(() => ({
      bodyResizing: document.body.classList.contains("resizing"),
      bodyCursor: getComputedStyle(document.body).cursor,
      bodyUserSelect: getComputedStyle(document.body).userSelect,
    }));

    if (!feedback.bodyResizing) {
      throw new Error("Body did not enter resizing state after dragging a panel handle.");
    }
    if (feedback.bodyCursor !== "col-resize") {
      throw new Error(`Body resize cursor was not applied: ${feedback.bodyCursor}`);
    }
    if (feedback.bodyUserSelect !== "none") {
      throw new Error(`Body text selection was not disabled during resize: ${feedback.bodyUserSelect}`);
    }
  } finally {
    await page.mouse.up();
  }

  await page.waitForFunction(() => !document.body.classList.contains("resizing"), null, { timeout: 5000 });
}

async function assertPausedAiTurnBlocksManualMove(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });

  await page.getByRole("button", { name: "Start new game" }).click();
  await page.getByRole("button", { name: /You play Red/i }).click();
  await page.getByLabel("FEN string").fill("rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR b - - 0 1");
  await page.getByRole("button", { name: "Load" }).click();
  await page.getByRole("button", { name: "Pause AI game" }).click();

  const beforeFen = await page.locator(".bottombar-fen").getAttribute("title");
  if (!beforeFen || !beforeFen.includes(" b ")) {
    throw new Error(`AI-turn FEN was not loaded as black-to-move: ${beforeFen}`);
  }

  await page.locator('.hitbox[data-file="0"][data-rank="6"]').click();
  await page.locator('.hitbox[data-file="0"][data-rank="5"]').click();
  await page.waitForTimeout(300);

  const afterFen = await page.locator(".bottombar-fen").getAttribute("title");
  if (afterFen !== beforeFen) {
    throw new Error(`Paused AI turn accepted a manual move. Before: ${beforeFen}; after: ${afterFen}`);
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

async function assertLibraryPgnCopy(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  const blackToMoveFen = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR b - - 0 17";
  await page.evaluate((fen) => {
    localStorage.setItem("xiangqi-game-library", JSON.stringify([{
      id: "qa-copy-pgn-game",
      savedAt: 1710000000000,
      gameMode: "PvAI-Black",
      moves: ["a6a5", "a3a4"],
      startFen: fen,
      result: "ongoing",
      label: "PGN copy QA",
      opening: "Custom study",
    }]));
  }, blackToMoveFen);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate(() => {
    window.__libraryPgnWrites = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.__libraryPgnWrites.push(String(text));
        },
      },
    });
  });

  await page.locator('button[aria-label="Open game library"]').click();
  await page.getByText("PGN copy QA").waitFor({ timeout: 10000 });
  await page.getByTestId("copy-pgn-saved-qa-copy-pgn-game").click();
  await page.getByRole("button", { name: "Saved game PGN copied" }).waitFor({ timeout: 5000 });

  const copiedPgn = await page.evaluate(() => window.__libraryPgnWrites?.[0] ?? "");
  if (!copiedPgn.includes('[SetUp "1"]')) {
    throw new Error("Copied saved-game PGN omitted SetUp.");
  }
  if (!copiedPgn.includes(`[FEN "${blackToMoveFen}"]`)) {
    throw new Error(`Copied saved-game PGN omitted the root FEN:\n${copiedPgn}`);
  }
  if (!copiedPgn.includes("17... a6a5 18. a3a4 *")) {
    throw new Error(`Copied saved-game PGN used the wrong move numbering:\n${copiedPgn}`);
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

async function assertGameOverReviewPreservesResult(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.evaluate(() => {
    localStorage.removeItem("xiangqi-game-library");
  });

  const terminalFen = "4k4/3RRR3/9/9/9/9/9/9/9/4K4 b - - 0 1";
  await page.getByRole("button", { name: "Start new game" }).click();
  await page.getByLabel("FEN string").fill(terminalFen);
  await page.getByRole("button", { name: "Load" }).click();

  await page.getByText("Red Wins").waitFor({ timeout: 5000 });
  await page.locator(".game-over-modal").getByRole("button", { name: "Review" }).click();
  await page.locator(".game-over-modal").waitFor({ state: "detached", timeout: 5000 });
  await page.getByText("Game Review").waitFor({ timeout: 5000 });

  await page.getByTestId("save-game-btn").click();
  const savedResult = await page.waitForFunction(() => {
    const raw = localStorage.getItem("xiangqi-game-library");
    if (!raw) return null;
    const games = JSON.parse(raw);
    return games.length === 1 ? games[0].result : null;
  }, null, { timeout: 5000 }).then((handle) => handle.jsonValue());

  if (savedResult !== "red") {
    throw new Error(`Game-over Review action lost the finished result before save: ${savedResult}`);
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

    await assertDesktopBoardLayout(page, { width: 1024, height: 720 });
    await assertDesktopResizeFeedback(page);
    await assertPausedAiTurnBlocksManualMove(page);
    await assertMobileBoardLayout(page, { width: 596, height: 668 });
    await assertMobileBoardLayout(page, { width: 390, height: 844 });
    await assertMobileSaveLibraryActions(page);
    await assertLibraryPgnCopy(page);
    await assertLibraryDeleteConfirmation(page);
    await assertGameOverReviewPreservesResult(page);

    if (pageConsole.length > 0) {
      throw new Error("Unexpected browser console errors:\n" + pageConsole.join("\n"));
    }

    console.log("Desktop/mobile board layout, AI-turn lock, resize feedback, save/library PGN actions, game-over review state, and library delete checks passed.");
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
