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

async function assertAiPlayModeShowsEngineStatus(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });

  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.getByRole("button", { name: "Start new game" }).click();
  await page.getByRole("button", { name: /You play Red/i }).click();
  await page.getByRole("button", { name: "Start Fresh Board", exact: true }).click();
  await page.locator(".new-game-menu").waitFor({ state: "detached", timeout: 5000 });

  const state = await page.evaluate(() => ({
    workspace: document.querySelector(".top-mode-pills .gc-pill-active")?.textContent?.trim() || "",
    engineText: document.querySelector(".top-engine-state")?.textContent?.trim() || "",
    overflowX: document.body.scrollWidth - document.body.clientWidth,
  }));
  if (state.workspace !== "Play") {
    throw new Error(`AI engine status setup did not switch to Play workspace: ${state.workspace}`);
  }
  if (!state.engineText) {
    throw new Error("AI Play mode hid the engine status.");
  }
  if (state.overflowX > 2) {
    throw new Error(`AI Play mode introduced horizontal overflow: ${state.overflowX}`);
  }
}

async function assertBottomNewGameMenuResetsDraft(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });

  await page.getByRole("button", { name: "Start new game" }).click();
  await page.getByRole("button", { name: /You play Black/i }).click();
  await page.getByLabel("FEN string").fill("stale draft fen");
  await page.locator(".new-game-menu").getByRole("button", { name: "Close" }).click();
  await page.locator(".new-game-menu").waitFor({ state: "detached", timeout: 5000 });

  await page.locator(".game-controls").getByRole("button", { name: "New Game" }).click();
  await page.locator(".new-game-menu").waitFor({ timeout: 5000 });

  const selectedMode = await page.locator(".new-game-selection strong").textContent();
  if (String(selectedMode || "").trim() !== "Local board") {
    throw new Error(`Bottom New Game reopened with stale selected mode: ${String(selectedMode || "").trim()}`);
  }

  const fenDraft = await page.getByLabel("FEN string").inputValue();
  if (fenDraft !== "") {
    throw new Error(`Bottom New Game reopened with stale FEN draft: ${fenDraft}`);
  }
}

async function assertInvalidFenToastTimerResets(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });

  await page.getByRole("button", { name: "Start new game" }).click();
  await page.getByLabel("FEN string").fill("not a legal fen");
  const loadButton = page.locator(".new-game-fen-form button");
  await loadButton.click();
  await page.waitForFunction(
    () => document.querySelector(".new-game-fen-form button")?.textContent?.trim() === "Invalid FEN",
    null,
    { timeout: 5000 }
  );

  await page.waitForTimeout(1200);
  await loadButton.click();
  await page.waitForTimeout(1200);

  const stillInvalid = String(await loadButton.textContent() || "").trim();
  if (stillInvalid !== "Invalid FEN") {
    throw new Error(`Invalid FEN feedback did not reset its timer after a repeated submit: ${stillInvalid}`);
  }

  await page.waitForTimeout(1000);
  const cleared = String(await loadButton.textContent() || "").trim();
  if (cleared !== "Load") {
    throw new Error(`Invalid FEN feedback did not clear after the reset timer: ${cleared}`);
  }
}

async function assertNewGameDialogFocusTrap(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });

  await page.getByRole("button", { name: "Start new game" }).click();
  await page.waitForFunction(() => {
    const dialog = document.querySelector(".new-game-menu");
    return Boolean(dialog && dialog.contains(document.activeElement));
  }, null, { timeout: 5000 });

  for (let i = 0; i < 30; i += 1) {
    await page.keyboard.press("Tab");
    const focusedInside = await page.evaluate(() => {
      const dialog = document.querySelector(".new-game-menu");
      return Boolean(dialog && dialog.contains(document.activeElement));
    });
    if (!focusedInside) {
      throw new Error(`Focus escaped the New Game dialog after ${i + 1} Tab presses.`);
    }
  }

  await page.keyboard.press("Shift+Tab");
  const focusedInsideAfterReverseTab = await page.evaluate(() => {
    const dialog = document.querySelector(".new-game-menu");
    return Boolean(dialog && dialog.contains(document.activeElement));
  });
  if (!focusedInsideAfterReverseTab) {
    throw new Error("Focus escaped the New Game dialog after Shift+Tab.");
  }

  await page.keyboard.press("Escape");
  await page.locator(".new-game-menu").waitFor({ state: "detached", timeout: 5000 });
  const activeLabel = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") || "");
  if (activeLabel !== "Start new game") {
    throw new Error(`Focus was not restored to the opener after closing New Game: ${activeLabel}`);
  }
}

async function assertBlackToMoveTreeNumbering(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });

  await page.getByRole("button", { name: "Start new game" }).click();
  await page.getByLabel("FEN string").fill("rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR b - - 0 17");
  await page.getByRole("button", { name: "Load" }).click();

  await page.locator('.hitbox[data-file="0"][data-rank="6"]').click();
  await page.locator('.hitbox[data-file="0"][data-rank="5"]').click();
  await page.getByTestId("move-tree-row-label-0").waitFor({ timeout: 5000 });
  await page.getByTestId("graph-current-point").waitFor({ timeout: 5000 });
  const blackGraphPoint = await page.getByTestId("graph-current-point").textContent();
  if (!String(blackGraphPoint || "").includes("Black A6")) {
    throw new Error(`Custom black-to-move graph label used the wrong side: ${String(blackGraphPoint || "").trim()}`);
  }

  await page.locator('.hitbox[data-file="0"][data-rank="3"]').click();
  await page.locator('.hitbox[data-file="0"][data-rank="4"]').click();
  await page.getByTestId("move-tree-row-label-1").waitFor({ timeout: 5000 });
  const redGraphPoint = await page.getByTestId("graph-current-point").textContent();
  if (!String(redGraphPoint || "").includes("Red A3")) {
    throw new Error(`Custom black-to-move reply graph label used the wrong side: ${String(redGraphPoint || "").trim()}`);
  }

  const labels = await page.locator(".mtree-num").allTextContents();
  const normalizedLabels = labels.map((label) => String(label || "").trim()).slice(0, 2);
  if (normalizedLabels[0] !== "17..." || normalizedLabels[1] !== "18.") {
    throw new Error(`Custom black-to-move tree labels were wrong: ${normalizedLabels.join(" | ")}`);
  }

  const firstRowText = await page.locator(".mtree-row").first().textContent();
  if (!String(firstRowText || "").includes("a6a5")) {
    throw new Error(`Custom black-to-move first move was not rendered in the first tree row: ${String(firstRowText || "").trim()}`);
  }
}

async function assertMoveLineImport(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });

  await page.getByRole("button", { name: "Start new game" }).click();
  await page.getByTestId("uci-line-input").fill('[Variant "Xiangqi"]\n1. B2E2 h9g7 2. b0c2');
  await page.getByTestId("import-uci-line-btn").click();
  await page.getByTestId("move-tree-row-label-1").waitFor({ timeout: 5000 });

  const activePoint = await page.getByTestId("graph-current-point").textContent();
  if (!String(activePoint || "").includes("Red B0") || !String(activePoint || "").includes("C2")) {
    throw new Error(`Imported line did not land on the final move: ${String(activePoint || "").trim()}`);
  }

  const labels = await page.locator(".mtree-num").allTextContents();
  const normalizedLabels = labels.map((label) => String(label || "").trim()).slice(0, 2);
  if (normalizedLabels[0] !== "1." || normalizedLabels[1] !== "2.") {
    throw new Error(`Imported line tree labels were wrong: ${normalizedLabels.join(" | ")}`);
  }

  const fen = await page.locator(".bottombar-fen").getAttribute("title");
  if (!fen || !fen.includes(" b ")) {
    throw new Error(`Imported line did not preserve side-to-move after three plies: ${fen}`);
  }
}

async function assertFenTaggedMoveLineImport(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });

  await page.getByRole("button", { name: "Start new game" }).click();
  await page.getByTestId("uci-line-input").fill([
    '[Variant "Xiangqi"]',
    '[FEN "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR b - - 0 17"]',
    "",
    "17... h9g7 *",
  ].join("\n"));
  await page.getByTestId("import-uci-line-btn").click();
  await page.getByTestId("move-tree-row-label-0").waitFor({ timeout: 5000 });

  const labels = await page.locator(".mtree-num").allTextContents();
  const firstLabel = String(labels[0] || "").trim();
  if (firstLabel !== "17...") {
    throw new Error(`FEN-tagged import did not use black-to-move numbering: ${firstLabel}`);
  }

  const fen = await page.locator(".bottombar-fen").getAttribute("title");
  if (!fen || !fen.includes(" w - - 0 18")) {
    throw new Error(`FEN-tagged import did not advance from the tagged root FEN: ${fen}`);
  }
}

async function assertDialogsBlockMoveShortcuts(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });

  await page.getByRole("button", { name: "Start new game" }).click();
  await page.getByTestId("uci-line-input").fill('[Variant "Xiangqi"]\n1. B2E2 h9g7 2. b0c2');
  await page.getByTestId("import-uci-line-btn").click();
  await page.getByTestId("move-tree-row-label-1").waitFor({ timeout: 5000 });
  const beforePoint = String(await page.getByTestId("graph-current-point").textContent() || "").trim();
  if (!beforePoint.includes("Ply 3")) {
    throw new Error(`Shortcut guard setup did not land on ply 3: ${beforePoint}`);
  }

  await page.getByRole("button", { name: "Start new game" }).click();
  await page.waitForFunction(() => {
    const dialog = document.querySelector(".new-game-menu");
    return Boolean(dialog && dialog.contains(document.activeElement));
  }, null, { timeout: 5000 });
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Escape");
  await page.locator(".new-game-menu").waitFor({ state: "detached", timeout: 5000 });

  const afterPoint = String(await page.getByTestId("graph-current-point").textContent() || "").trim();
  if (afterPoint !== beforePoint) {
    throw new Error(`Move navigation shortcut changed the game behind a dialog. Before: ${beforePoint}; after: ${afterPoint}`);
  }
}

async function assertBoardMarkersSurviveSelection(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });

  await page.locator('.hitbox[data-file="4"][data-rank="4"]').click({ button: "right" });
  await page.waitForFunction(() => document.querySelectorAll(".marker-highlight").length === 1, null, { timeout: 5000 });

  await page.locator('.hitbox[data-file="1"][data-rank="0"]').click();
  const markerCountAfterSelect = await page.locator(".marker-highlight").count();
  if (markerCountAfterSelect !== 1) {
    throw new Error(`Board marker cleared during piece selection: ${markerCountAfterSelect}`);
  }

  await page.locator('.hitbox[data-file="2"][data-rank="2"]').click();
  await page.waitForFunction(() => document.querySelectorAll(".marker-highlight").length === 0, null, { timeout: 5000 });
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
  const dialogState = await page.evaluate(() => {
    const modal = document.querySelector(".game-over-modal");
    return {
      role: modal?.getAttribute("role") || "",
      ariaModal: modal?.getAttribute("aria-modal") || "",
      activeText: document.activeElement?.textContent?.trim() || "",
    };
  });
  if (dialogState.role !== "dialog" || dialogState.ariaModal !== "true") {
    throw new Error(`Game-over modal was not exposed as a modal dialog: ${JSON.stringify(dialogState)}`);
  }
  if (dialogState.activeText !== "New Game") {
    throw new Error(`Game-over modal did not focus the primary action: ${JSON.stringify(dialogState)}`);
  }

  await page.mouse.click(12, 12);
  if (await page.locator(".game-over-modal").count() !== 1) {
    throw new Error("Game-over modal closed after a backdrop click.");
  }

  await page.keyboard.press("Escape");
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
    await assertAiPlayModeShowsEngineStatus(page);
    await assertBottomNewGameMenuResetsDraft(page);
    await assertInvalidFenToastTimerResets(page);
    await assertNewGameDialogFocusTrap(page);
    await assertBlackToMoveTreeNumbering(page);
    await assertMoveLineImport(page);
    await assertFenTaggedMoveLineImport(page);
    await assertDialogsBlockMoveShortcuts(page);
    await assertBoardMarkersSurviveSelection(page);
    await assertMobileBoardLayout(page, { width: 596, height: 668 });
    await assertMobileBoardLayout(page, { width: 390, height: 844 });
    await assertMobileSaveLibraryActions(page);
    await assertLibraryPgnCopy(page);
    await assertLibraryDeleteConfirmation(page);
    await assertGameOverReviewPreservesResult(page);

    if (pageConsole.length > 0) {
      throw new Error("Unexpected browser console errors:\n" + pageConsole.join("\n"));
    }

    console.log("Desktop/mobile board layout, AI-turn lock, AI Play engine status, dialog focus trap, dialog shortcut guard, resize feedback, new-game reset, invalid-FEN feedback timing, custom-FEN move numbering/graph labels, UCI/FEN-tag import, board marker persistence, save/library PGN actions, game-over review state, and library delete checks passed.");
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
