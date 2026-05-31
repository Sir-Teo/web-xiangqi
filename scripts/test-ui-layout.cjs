const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

function encodeShareTreeParam(tree) {
  return Buffer.from(JSON.stringify(tree), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

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

async function assertEnginePvLineControl(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });

  await page.getByTestId("analysis-tab-engine").click();
  await page.getByTestId("engine-pv-lines-3").waitFor({ timeout: 5000 });

  const initial = await page.evaluate(() => ({
    detail: [...document.querySelectorAll(".engine-stat")]
      .map((el) => el.textContent || "")
      .find((text) => text.includes("Detail")) || "",
    active: document.querySelector('[data-testid="engine-pv-lines-3"]')?.getAttribute("aria-pressed") || "",
  }));
  if (!initial.detail.includes("MultiPV 3") || !initial.detail.includes("WDL on") || initial.active !== "true") {
    throw new Error(`Engine PV selector did not start on 3 lines: ${JSON.stringify(initial)}`);
  }

  await page.getByTestId("engine-pv-lines-5").click();
  const updated = await page.evaluate(() => ({
    detail: [...document.querySelectorAll(".engine-stat")]
      .map((el) => el.textContent || "")
      .find((text) => text.includes("Detail")) || "",
    active: document.querySelector('[data-testid="engine-pv-lines-5"]')?.getAttribute("aria-pressed") || "",
    labels: [...document.querySelectorAll(".engine-pv-btn")].map((el) => el.textContent?.trim() || ""),
    overflowX: document.body.scrollWidth - document.body.clientWidth,
  }));
  if (!updated.detail.includes("MultiPV 5") || !updated.detail.includes("WDL on") || updated.active !== "true") {
    throw new Error(`Engine PV selector did not switch to 5 lines: ${JSON.stringify(updated)}`);
  }
  if (updated.labels.join(",") !== "1,3,5") {
    throw new Error(`Engine PV selector labels changed unexpectedly: ${updated.labels.join(",")}`);
  }
  if (updated.overflowX > 2) {
    throw new Error(`Engine PV selector introduced horizontal overflow: ${updated.overflowX}`);
  }

  await page.getByTestId("clear-engine-hash-btn").waitFor({ timeout: 5000 });
  await page.waitForFunction(() => {
    const button = document.querySelector('[data-testid="clear-engine-hash-btn"]');
    return button && !button.disabled;
  }, null, { timeout: 15000 });
  await page.getByTestId("clear-engine-hash-btn").click();
  const cacheState = await page.evaluate(() => {
    const button = document.querySelector('[data-testid="clear-engine-hash-btn"]');
    return {
      text: button?.textContent?.trim() || "",
      disabled: button?.disabled ?? null,
      overflowX: document.body.scrollWidth - document.body.clientWidth,
    };
  });
  if (cacheState.text !== "Cleared" || cacheState.disabled) {
    throw new Error(`Clear Hash control did not show successful feedback: ${JSON.stringify(cacheState)}`);
  }
  if (cacheState.overflowX > 2) {
    throw new Error(`Clear Hash control introduced horizontal overflow: ${cacheState.overflowX}`);
  }
}

async function assertPreferencePersistence(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });

  try {
    await page.evaluate(() => localStorage.removeItem("xiangqi-app-preferences"));
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector(".xiangqi-board", { timeout: 30000 });

    await page.getByRole("button", { name: "Open settings" }).click();
    const settings = page.locator(".settings-body");
    await settings.getByRole("button", { name: "Pro", exact: true }).click();
    await settings.getByRole("button", { name: "Stable", exact: true }).click();
    await settings.getByRole("button", { name: "Off", exact: true }).click();
    await settings.getByRole("button", { name: "Close settings" }).click();
    await page.locator(".settings-body").waitFor({ state: "detached", timeout: 5000 });

    await page.getByTestId("analysis-tab-engine").click();
    await page.getByTestId("engine-pv-lines-5").click();

    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("xiangqi-app-preferences") || "{}"));
    if (
      stored.assistMode !== "pro" ||
      stored.analysisEngineMode !== "stable" ||
      stored.soundEnabled !== false ||
      stored.enginePvLineCount !== 5
    ) {
      throw new Error(`Preferences were not written correctly: ${JSON.stringify(stored)}`);
    }

    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector(".xiangqi-board", { timeout: 30000 });

    const restoredAssist = await page.evaluate(() => document.querySelector(".app-shell")?.getAttribute("data-assist-mode") || "");
    if (restoredAssist !== "pro") {
      throw new Error(`Assist mode was not restored from preferences: ${restoredAssist}`);
    }

    await page.getByTestId("analysis-tab-engine").click();
    const restored = await page.evaluate(() => ({
      pv5Active: document.querySelector('[data-testid="engine-pv-lines-5"]')?.getAttribute("aria-pressed") || "",
      detail: [...document.querySelectorAll(".engine-stat")]
        .map((el) => el.textContent || "")
        .find((text) => text.includes("Detail")) || "",
      profile: [...document.querySelectorAll(".engine-stat")]
        .map((el) => el.textContent || "")
        .find((text) => text.includes("Profile")) || "",
      overflowX: document.body.scrollWidth - document.body.clientWidth,
    }));

    if (restored.pv5Active !== "true" || !restored.detail.includes("MultiPV 5") || !restored.profile.includes("stable")) {
      throw new Error(`Preferences were not restored into the UI: ${JSON.stringify(restored)}`);
    }
    if (restored.overflowX > 2) {
      throw new Error(`Restored preferences introduced horizontal overflow: ${restored.overflowX}`);
    }

    await page.getByRole("button", { name: "Open settings" }).click();
    await page.getByTestId("reset-preferences-btn").click();
    const resetState = await page.evaluate(() => ({
      assistMode: document.querySelector(".app-shell")?.getAttribute("data-assist-mode") || "",
      stored: JSON.parse(localStorage.getItem("xiangqi-app-preferences") || "{}"),
      buttons: [...document.querySelectorAll(".settings-body .pill-btn-active")].map((el) => el.textContent?.trim() || ""),
    }));

    if (resetState.assistMode !== "coach") {
      throw new Error(`Reset preferences did not restore coach mode: ${JSON.stringify(resetState)}`);
    }
    if (
      resetState.stored.assistMode !== "coach" ||
      resetState.stored.analysisEngineMode !== "optimized" ||
      resetState.stored.soundEnabled !== true ||
      resetState.stored.enginePvLineCount !== 3
    ) {
      throw new Error(`Reset preferences did not rewrite defaults: ${JSON.stringify(resetState.stored)}`);
    }
    if (!resetState.buttons.includes("Coach") || !resetState.buttons.includes("Optimized") || !resetState.buttons.includes("On")) {
      throw new Error(`Reset preferences did not update settings controls: ${resetState.buttons.join(",")}`);
    }
  } finally {
    await page.evaluate(() => localStorage.removeItem("xiangqi-app-preferences")).catch(() => {});
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
  const fenError = page.locator("#new-game-fen-error");
  await fenError.waitFor({ timeout: 5000 });
  const initialErrorState = await page.evaluate(() => ({
    text: document.querySelector("#new-game-fen-error")?.textContent?.trim() || "",
    role: document.querySelector("#new-game-fen-error")?.getAttribute("role") || "",
    invalid: document.querySelector('[aria-label="FEN string"]')?.getAttribute("aria-invalid") || "",
    describedBy: document.querySelector('[aria-label="FEN string"]')?.getAttribute("aria-describedby") || "",
  }));
  if (
    !initialErrorState.text.includes("legal Xiangqi position") ||
    initialErrorState.role !== "alert" ||
    initialErrorState.invalid !== "true" ||
    initialErrorState.describedBy !== "new-game-fen-error"
  ) {
    throw new Error(`Invalid FEN feedback was not accessible: ${JSON.stringify(initialErrorState)}`);
  }

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
  const clearedErrorState = await page.evaluate(() => ({
    errorVisible: Boolean(document.querySelector("#new-game-fen-error")),
    invalid: document.querySelector('[aria-label="FEN string"]')?.getAttribute("aria-invalid") || "",
    describedBy: document.querySelector('[aria-label="FEN string"]')?.getAttribute("aria-describedby") || "",
  }));
  if (clearedErrorState.errorVisible || clearedErrorState.invalid || clearedErrorState.describedBy) {
    throw new Error(`Invalid FEN accessibility state did not clear: ${JSON.stringify(clearedErrorState)}`);
  }
}

async function assertDisabledControlsLookInactive(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });

  const bottomExportStyle = await page.evaluate(() => {
    const button = document.querySelector('[data-testid="download-pgn-btn"]');
    if (!button) return null;
    const style = getComputedStyle(button);
    return {
      disabled: button.disabled,
      opacity: Number(style.opacity),
      cursor: style.cursor,
    };
  });
  if (!bottomExportStyle?.disabled || bottomExportStyle.opacity > 0.65 || bottomExportStyle.cursor !== "not-allowed") {
    throw new Error(`Disabled bottom export control did not look inactive: ${JSON.stringify(bottomExportStyle)}`);
  }

  await page.getByRole("button", { name: "Start new game" }).click();
  const dialogDisabledStyles = await page.evaluate(() => {
    const fenLoad = document.querySelector(".new-game-fen-form button[type='submit']");
    const importButton = document.querySelector('[data-testid="import-uci-line-btn"]');
    const read = (button) => {
      if (!button) return null;
      const style = getComputedStyle(button);
      return {
        disabled: button.disabled,
        opacity: Number(style.opacity),
        cursor: style.cursor,
      };
    };
    return {
      fenLoad: read(fenLoad),
      importButton: read(importButton),
    };
  });

  for (const [label, style] of Object.entries(dialogDisabledStyles)) {
    if (!style?.disabled || style.opacity > 0.65 || style.cursor !== "not-allowed") {
      throw new Error(`Disabled ${label} control did not look inactive: ${JSON.stringify(style)}`);
    }
  }
}

async function assertPanelTabAccessibility(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });

  const desktopInitial = await page.evaluate(() => ({
    leftTablist: document.querySelector(".panel.left .analysis-tab-strip")?.getAttribute("role") || "",
    leftGraphRole: document.querySelector('[data-testid="left-panel-tab-graph"]')?.getAttribute("role") || "",
    leftGraphSelected: document.querySelector('[data-testid="left-panel-tab-graph"]')?.getAttribute("aria-selected") || "",
    leftLibrarySelected: document.querySelector('[data-testid="left-panel-tab-library"]')?.getAttribute("aria-selected") || "",
    leftPanelRole: document.querySelector("#left-panel-content")?.getAttribute("role") || "",
    leftPanelLabel: document.querySelector("#left-panel-content")?.getAttribute("aria-labelledby") || "",
    rightTablist: document.querySelector(".panel.right .analysis-tab-strip")?.getAttribute("role") || "",
    treeSelected: document.querySelector('[data-testid="analysis-tab-tree"]')?.getAttribute("aria-selected") || "",
    reviewSelected: document.querySelector('[data-testid="analysis-tab-review"]')?.getAttribute("aria-selected") || "",
    rightPanelRole: document.querySelector("#right-analysis-content")?.getAttribute("role") || "",
    rightPanelLabel: document.querySelector("#right-analysis-content")?.getAttribute("aria-labelledby") || "",
    duplicateLeftPanels: document.querySelectorAll("#left-panel-content").length,
    duplicateRightPanels: document.querySelectorAll("#right-analysis-content").length,
  }));
  if (
    desktopInitial.leftTablist !== "tablist" ||
    desktopInitial.leftGraphRole !== "tab" ||
    desktopInitial.leftGraphSelected !== "true" ||
    desktopInitial.leftLibrarySelected !== "false" ||
    desktopInitial.leftPanelRole !== "tabpanel" ||
    desktopInitial.leftPanelLabel !== "left-panel-tab-graph" ||
    desktopInitial.rightTablist !== "tablist" ||
    desktopInitial.treeSelected !== "true" ||
    desktopInitial.reviewSelected !== "false" ||
    desktopInitial.rightPanelRole !== "tabpanel" ||
    desktopInitial.rightPanelLabel !== "analysis-tab-tree-tab" ||
    desktopInitial.duplicateLeftPanels !== 1 ||
    desktopInitial.duplicateRightPanels !== 1
  ) {
    throw new Error(`Desktop panel tabs are not exposed accessibly: ${JSON.stringify(desktopInitial)}`);
  }

  await page.getByTestId("left-panel-tab-library").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="left-panel-tab-library"]')?.getAttribute("aria-selected") === "true", null, { timeout: 5000 });
  await page.getByTestId("analysis-tab-review").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="analysis-tab-review"]')?.getAttribute("aria-selected") === "true", null, { timeout: 5000 });

  const desktopUpdated = await page.evaluate(() => ({
    leftGraphSelected: document.querySelector('[data-testid="left-panel-tab-graph"]')?.getAttribute("aria-selected") || "",
    leftLibrarySelected: document.querySelector('[data-testid="left-panel-tab-library"]')?.getAttribute("aria-selected") || "",
    leftPanelLabel: document.querySelector("#left-panel-content")?.getAttribute("aria-labelledby") || "",
    treeSelected: document.querySelector('[data-testid="analysis-tab-tree"]')?.getAttribute("aria-selected") || "",
    reviewSelected: document.querySelector('[data-testid="analysis-tab-review"]')?.getAttribute("aria-selected") || "",
    rightPanelLabel: document.querySelector("#right-analysis-content")?.getAttribute("aria-labelledby") || "",
  }));
  if (
    desktopUpdated.leftGraphSelected !== "false" ||
    desktopUpdated.leftLibrarySelected !== "true" ||
    desktopUpdated.leftPanelLabel !== "left-panel-tab-library" ||
    desktopUpdated.treeSelected !== "false" ||
    desktopUpdated.reviewSelected !== "true" ||
    desktopUpdated.rightPanelLabel !== "analysis-tab-review-tab"
  ) {
    throw new Error(`Desktop tab aria-selected state did not update: ${JSON.stringify(desktopUpdated)}`);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });
  const mobileInitial = await page.evaluate(() => ({
    boardCurrent: document.querySelector('[data-testid="mobile-view-board"]')?.getAttribute("aria-current") || "",
    analysisCurrent: document.querySelector('[data-testid="mobile-view-analysis"]')?.getAttribute("aria-current") || "",
  }));
  if (mobileInitial.boardCurrent !== "page" || mobileInitial.analysisCurrent !== "") {
    throw new Error(`Mobile view nav did not expose the active view: ${JSON.stringify(mobileInitial)}`);
  }

  await page.getByTestId("mobile-view-analysis").click();
  await page.getByTestId("mobile-analysis-tab-moves").waitFor({ timeout: 5000 });
  await page.getByTestId("mobile-analysis-tab-library").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="mobile-analysis-tab-library"]')?.getAttribute("aria-selected") === "true", null, { timeout: 5000 });

  const mobileUpdated = await page.evaluate(() => ({
    boardCurrent: document.querySelector('[data-testid="mobile-view-board"]')?.getAttribute("aria-current") || "",
    analysisCurrent: document.querySelector('[data-testid="mobile-view-analysis"]')?.getAttribute("aria-current") || "",
    tablist: document.querySelector(".mobile-analysis-tabs")?.getAttribute("role") || "",
    movesSelected: document.querySelector('[data-testid="mobile-analysis-tab-moves"]')?.getAttribute("aria-selected") || "",
    librarySelected: document.querySelector('[data-testid="mobile-analysis-tab-library"]')?.getAttribute("aria-selected") || "",
    libraryControls: document.querySelector('[data-testid="mobile-analysis-tab-library"]')?.getAttribute("aria-controls") || "",
    overflowX: document.body.scrollWidth - document.body.clientWidth,
  }));
  if (
    mobileUpdated.boardCurrent !== "" ||
    mobileUpdated.analysisCurrent !== "page" ||
    mobileUpdated.tablist !== "tablist" ||
    mobileUpdated.movesSelected !== "false" ||
    mobileUpdated.librarySelected !== "true" ||
    mobileUpdated.libraryControls !== "left-panel-content" ||
    mobileUpdated.overflowX > 2
  ) {
    throw new Error(`Mobile panel tabs are not exposed accessibly: ${JSON.stringify(mobileUpdated)}`);
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
  await page.getByTestId("uci-line-input").fill('[Variant "Xiangqi"]\n1. B2-E2 h9→g7 2. b0->c2');
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

async function assertMoveLineImportIgnoresVariations(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });

  await page.getByRole("button", { name: "Start new game" }).click();
  await page.getByTestId("uci-line-input").fill('[Variant "Xiangqi"]\n1. b2e2 (1. b0c2 {side line}) h9g7');
  await page.getByTestId("import-uci-line-btn").click();
  await page.getByTestId("move-tree-row-label-0").waitFor({ timeout: 5000 });

  const rows = await page.locator(".mtree-row").allTextContents();
  const rowText = rows.join(" ");
  if (!rowText.includes("b2e2") || !rowText.includes("h9g7") || rowText.includes("b0c2")) {
    throw new Error(`PGN variation moves leaked into the imported mainline: ${rowText}`);
  }

  const activePoint = await page.getByTestId("graph-current-point").textContent();
  if (!String(activePoint || "").includes("Black H9") || !String(activePoint || "").includes("G7")) {
    throw new Error(`Variation import did not land on the mainline final move: ${String(activePoint || "").trim()}`);
  }
}

async function assertMoveLineImportErrorAccessibility(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });

  await page.getByRole("button", { name: "Start new game" }).click();
  const input = page.getByTestId("uci-line-input");
  await input.fill("this is not a move");
  await page.getByTestId("import-uci-line-btn").click();

  const error = page.locator("#new-game-line-error");
  await error.waitFor({ timeout: 5000 });
  const errorText = await error.textContent();
  if (!String(errorText || "").includes("No UCI moves found")) {
    throw new Error(`Invalid import did not show a helpful error: ${String(errorText || "").trim()}`);
  }

  const role = await error.getAttribute("role");
  const invalid = await input.getAttribute("aria-invalid");
  const describedBy = await input.getAttribute("aria-describedby");
  if (role !== "alert" || invalid !== "true" || describedBy !== "new-game-line-error") {
    throw new Error(`Invalid import was not announced accessibly: role=${role} invalid=${invalid} describedBy=${describedBy}`);
  }
}

async function assertRootMoveVariationsVisible(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });

  await page.locator('.hitbox[data-file="1"][data-rank="2"]').click();
  await page.locator('.hitbox[data-file="4"][data-rank="2"]').click();
  await page.getByTestId("move-tree-row-label-0").waitFor({ timeout: 5000 });
  await page.locator('.watch-controls button[aria-label="Go to first position"]').click();
  await page.locator('.hitbox[data-file="1"][data-rank="0"]').click();
  await page.locator('.hitbox[data-file="2"][data-rank="2"]').click();
  await page.getByTestId("move-tree-row-label-0").waitFor({ timeout: 5000 });

  const activeRowText = await page.locator(".mtree-row").first().textContent();
  const variationText = await page.locator(".mtree-variation").allTextContents();
  const combinedVariationText = variationText.join(" ");
  if (!String(activeRowText || "").includes("b0c2")) {
    throw new Error(`Root variation setup did not keep the second first move active: ${String(activeRowText || "").trim()}`);
  }
  if (!combinedVariationText.includes("b2e2")) {
    throw new Error(`Alternate root move was hidden from the move tree: ${combinedVariationText}`);
  }
}

async function assertPgnTreeVariationExport(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });
  await page.evaluate(() => {
    window.__treePgnWrites = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.__treePgnWrites.push(String(text));
        },
      },
    });
  });

  await page.locator('.hitbox[data-file="1"][data-rank="2"]').click();
  await page.locator('.hitbox[data-file="4"][data-rank="2"]').click();
  await page.locator('.hitbox[data-file="7"][data-rank="9"]').click();
  await page.locator('.hitbox[data-file="6"][data-rank="7"]').click();
  await page.getByTestId("move-tree-row-label-0").waitFor({ timeout: 5000 });

  await page.locator('.watch-controls button[aria-label="Go to first position"]').click();
  await page.locator('.hitbox[data-file="1"][data-rank="0"]').click();
  await page.locator('.hitbox[data-file="2"][data-rank="2"]').click();
  await page.getByTestId("move-tree-row-label-0").waitFor({ timeout: 5000 });

  await page.getByTestId("copy-pgn-btn").click();
  await page.getByTestId("copy-pgn-btn").getByText("Copied").waitFor({ timeout: 5000 });

  const exported = await page.evaluate(() => ({
    pgn: window.__treePgnWrites?.[0] ?? "",
    overflowX: document.body.scrollWidth - document.body.clientWidth,
    activeRow: document.querySelector(".mtree-row")?.textContent?.trim() || "",
    variations: [...document.querySelectorAll(".mtree-variation")].map((el) => el.textContent?.trim() || "").join(" "),
  }));
  if (!exported.pgn.includes('[Variant "Xiangqi"]')) {
    throw new Error(`Tree PGN export omitted the variant tag:\n${exported.pgn}`);
  }
  if (!exported.pgn.includes("1. b0c2 (1. b2e2 h9g7) *")) {
    throw new Error(`Tree PGN export did not preserve the root variation:\n${exported.pgn}`);
  }
  if (!exported.activeRow.includes("b0c2") || !exported.variations.includes("b2e2") || exported.overflowX > 2) {
    throw new Error(`Tree PGN export setup did not keep the UI variation visible: ${JSON.stringify(exported)}`);
  }
}

async function assertCurrentPgnDownload(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });

  const downloadButton = page.getByTestId("download-pgn-btn");
  if (!(await downloadButton.isDisabled())) {
    throw new Error("Current-line PGN download should be disabled before any move.");
  }

  await page.getByRole("button", { name: "Start new game" }).click();
  await page.getByTestId("uci-line-input").fill('[Variant "Xiangqi"]\n1. b2e2 h9g7');
  await page.getByTestId("import-uci-line-btn").click();
  await page.getByTestId("move-tree-row-label-0").waitFor({ timeout: 5000 });

  if (await downloadButton.isDisabled()) {
    throw new Error("Current-line PGN download stayed disabled after importing moves.");
  }

  const downloadPromise = page.waitForEvent("download");
  await downloadButton.click();
  const download = await downloadPromise;
  const suggestedFilename = download.suggestedFilename();
  if (!/^web-xiangqi-\d{4}-\d{2}-\d{2}-[\w-]+\.pgn$/.test(suggestedFilename)) {
    throw new Error(`Unexpected PGN filename: ${suggestedFilename}`);
  }

  const savePath = path.resolve(__dirname, "..", ".current-line-export-test.pgn");
  try {
    await download.saveAs(savePath);
    const exportedPgn = fs.readFileSync(savePath, "utf8");
    if (!exportedPgn.includes('[Variant "Xiangqi"]')) {
      throw new Error(`Downloaded PGN omitted the Xiangqi variant tag:\n${exportedPgn}`);
    }
    if (!exportedPgn.includes('[Event "PvP"]')) {
      throw new Error(`Downloaded PGN omitted the current game mode:\n${exportedPgn}`);
    }
    if (!/1\. b2e2 h9g7 \*/i.test(exportedPgn)) {
      throw new Error(`Downloaded PGN omitted the current imported line:\n${exportedPgn}`);
    }
  } finally {
    fs.rmSync(savePath, { force: true });
  }
}

async function assertMainExportFailureFeedback(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });

  await page.getByRole("button", { name: "Start new game" }).click();
  await page.getByTestId("uci-line-input").fill('[Variant "Xiangqi"]\n1. b2e2 h9g7');
  await page.getByTestId("import-uci-line-btn").click();
  await page.getByTestId("move-tree-row-label-0").waitFor({ timeout: 5000 });
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new DOMException("Simulated clipboard denial", "NotAllowedError");
        },
      },
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: () => false,
    });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: undefined,
    });
  });

  const assertFailedButton = async (testId, expectedText, expectedTitleFragment, warningClass) => {
    const button = page.getByTestId(testId);
    await button.getByText(expectedText).waitFor({ timeout: 5000 });
    const state = await button.evaluate((el) => ({
      title: el.getAttribute("title") || "",
      className: el.className || "",
      text: el.textContent?.trim() || "",
    }));
    if (!state.title.includes(expectedTitleFragment) || !state.className.includes(warningClass)) {
      throw new Error(`Export failure feedback missing on ${testId}: ${JSON.stringify(state)}`);
    }
  };

  await page.getByTestId("copy-pgn-btn").click();
  await assertFailedButton("copy-pgn-btn", "Copy Failed", "Could not copy", "gc-btn-warning");

  await page.getByTestId("copy-share-link-btn").click();
  await assertFailedButton("copy-share-link-btn", "Copy Failed", "Could not copy", "gc-btn-warning");

  await page.getByTestId("copy-fen-btn").click();
  await assertFailedButton("copy-fen-btn", "Failed", "Could not copy", "bottombar-fen-copy-warning");

  await page.getByTestId("download-pgn-btn").click();
  await assertFailedButton("download-pgn-btn", "Export Failed", "Could not export", "gc-btn-warning");

  const overflowX = await page.evaluate(() => document.body.scrollWidth - document.body.clientWidth);
  if (overflowX > 2) {
    throw new Error(`Export failure feedback introduced horizontal overflow: ${overflowX}`);
  }
}

async function assertShareLinkRoundTrip(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });
  await page.evaluate(() => {
    window.__shareLinkWrites = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.__shareLinkWrites.push(String(text));
        },
      },
    });
  });

  const shareButton = page.getByTestId("copy-share-link-btn");
  if (!(await shareButton.isDisabled())) {
    throw new Error("Share link should be disabled before a line or custom root exists.");
  }

  await page.getByRole("button", { name: "Start new game" }).click();
  await page.getByTestId("uci-line-input").fill('[Variant "Xiangqi"]\n1. b2e2 h9g7');
  await page.getByTestId("import-uci-line-btn").click();
  await page.getByTestId("move-tree-row-label-0").waitFor({ timeout: 5000 });

  if (await shareButton.isDisabled()) {
    throw new Error("Share link stayed disabled after importing a line.");
  }
  await shareButton.click();
  await page.getByTestId("copy-share-link-btn").getByText("Copied").waitFor({ timeout: 5000 });

  const copiedUrl = await page.evaluate(() => window.__shareLinkWrites?.[0] ?? "");
  const parsed = new URL(copiedUrl);
  if (parsed.origin !== "http://127.0.0.1:8192") {
    throw new Error(`Share link used the wrong origin: ${copiedUrl}`);
  }
  if (parsed.searchParams.get("moves") !== "b2e2 h9g7") {
    throw new Error(`Share link omitted the current line: ${copiedUrl}`);
  }
  if (parsed.searchParams.has("fen")) {
    throw new Error(`Share link included an unnecessary start FEN: ${copiedUrl}`);
  }

  await page.goto(copiedUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByTestId("move-tree-row-label-0").waitFor({ timeout: 5000 });
  const activePoint = await page.getByTestId("graph-current-point").textContent();
  if (!String(activePoint || "").includes("Black H9") || !String(activePoint || "").includes("G7")) {
    throw new Error(`Share link did not restore the final move: ${String(activePoint || "").trim()}`);
  }
  const fen = await page.locator(".bottombar-fen").getAttribute("title");
  if (!fen || !fen.includes(" w ")) {
    throw new Error(`Share link did not restore side-to-move after two plies: ${fen}`);
  }
}

async function assertShareTreeRoundTrip(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });
  await page.evaluate(() => {
    window.__shareTreeWrites = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.__shareTreeWrites.push(String(text));
        },
      },
    });
  });

  await page.locator('.hitbox[data-file="1"][data-rank="2"]').click();
  await page.locator('.hitbox[data-file="4"][data-rank="2"]').click();
  await page.locator('.hitbox[data-file="7"][data-rank="9"]').click();
  await page.locator('.hitbox[data-file="6"][data-rank="7"]').click();
  await page.locator('.watch-controls button[aria-label="Go to first position"]').click();
  await page.locator('.hitbox[data-file="1"][data-rank="0"]').click();
  await page.locator('.hitbox[data-file="2"][data-rank="2"]').click();
  await page.getByTestId("move-tree-row-label-0").waitFor({ timeout: 5000 });

  await page.getByTestId("copy-share-link-btn").click();
  await page.getByTestId("copy-share-link-btn").getByText("Copied").waitFor({ timeout: 5000 });

  const copiedUrl = await page.evaluate(() => window.__shareTreeWrites?.[0] ?? "");
  const parsed = new URL(copiedUrl);
  if (parsed.searchParams.get("moves") !== "b0c2" || !parsed.searchParams.has("tree")) {
    throw new Error(`Share link did not include the active line and study tree: ${copiedUrl}`);
  }

  await page.goto(copiedUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByTestId("move-tree-row-label-0").waitFor({ timeout: 5000 });
  const loaded = await page.evaluate(() => ({
    activeRow: document.querySelector(".mtree-row")?.textContent?.trim() || "",
    variations: [...document.querySelectorAll(".mtree-variation")].map((el) => el.textContent?.trim() || "").join(" "),
    overflowX: document.body.scrollWidth - document.body.clientWidth,
  }));
  if (!loaded.activeRow.includes("b0c2") || !loaded.variations.includes("b2e2") || !loaded.variations.includes("h9g7") || loaded.overflowX > 2) {
    throw new Error(`Share tree link did not restore visible variations: ${JSON.stringify(loaded)}`);
  }
}

async function assertLongShareVariationVisible(page) {
  const tree = [
    {
      uci: "b2e2",
      children: [
        {
          uci: "h9g7",
          children: [
            {
              uci: "b0c2",
              children: [
                {
                  uci: "b9c7",
                  children: [
                    {
                      uci: "c3c4",
                      children: [
                        {
                          uci: "c6c5",
                          children: [
                            {
                              uci: "h0g2",
                              children: [{ uci: "g6g5" }],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    { uci: "b0c2" },
  ];
  const url = `http://127.0.0.1:8192/web-xiangqi/?moves=b0c2&tree=${encodeShareTreeParam(tree)}`;
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.getByTestId("move-tree-row-label-0").waitFor({ timeout: 5000 });
  const loaded = await page.evaluate(() => ({
    activeRow: document.querySelector(".mtree-row")?.textContent?.trim() || "",
    variations: [...document.querySelectorAll(".mtree-variation")].map((el) => el.textContent?.trim() || "").join(" "),
    overflowX: document.body.scrollWidth - document.body.clientWidth,
  }));
  if (!loaded.activeRow.includes("b0c2") || !loaded.variations.includes("h0g2") || !loaded.variations.includes("g6g5") || loaded.overflowX > 2) {
    throw new Error(`Long share variation was truncated or broke layout: ${JSON.stringify(loaded)}`);
  }
}

async function assertInvalidShareLinkFeedback(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/?moves=a0a9", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });
  await page.getByTestId("share-link-warning").waitFor({ timeout: 5000 });

  const state = await page.evaluate(() => ({
    warning: document.querySelector('[data-testid="share-link-warning"]')?.textContent?.trim() || "",
    activePoint: document.querySelector('[data-testid="graph-current-point"]')?.textContent?.trim() || "",
    fen: document.querySelector(".bottombar-fen")?.getAttribute("title") || "",
    overflowX: document.body.scrollWidth - document.body.clientWidth,
    hitboxCount: document.querySelectorAll(".hitbox").length,
  }));
  if (!state.warning.includes("Shared link not loaded")) {
    throw new Error(`Invalid share link warning was not visible: ${JSON.stringify(state)}`);
  }
  if (!state.activePoint.includes("Start") || !state.fen.includes(" w - - 0 1")) {
    throw new Error(`Invalid share link did not leave the app at the start position: ${JSON.stringify(state)}`);
  }
  if (state.overflowX > 2 || state.hitboxCount !== 90) {
    throw new Error(`Invalid share link warning broke layout: ${JSON.stringify(state)}`);
  }
}

async function assertMoveLineFileImport(page) {
  const importPath = path.resolve(__dirname, "..", ".move-line-import-test.pgn");
  fs.writeFileSync(importPath, '[Variant "Xiangqi"]\n1. B2E2 h9g7 2. b0c2\n');

  try {
    await page.setViewportSize({ width: 1280, height: 820 });
    await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForSelector(".xiangqi-board", { timeout: 30000 });

    await page.getByRole("button", { name: "Start new game" }).click();
    await page.getByTestId("uci-line-file-input").setInputFiles(importPath);

    await page.waitForFunction(() => {
      const input = document.querySelector('[data-testid="uci-line-input"]');
      return input && "value" in input && String(input.value).includes("B2E2 h9g7");
    }, null, { timeout: 5000 });
    const loadedText = await page.getByTestId("uci-line-input").inputValue();
    if (!loadedText.includes("B2E2 h9g7")) {
      throw new Error(`Move-line file did not load into the import box:\n${loadedText}`);
    }
    await page.getByText(".move-line-import-test.pgn").waitFor({ timeout: 5000 });

    await page.getByTestId("import-uci-line-btn").click();
    await page.getByTestId("move-tree-row-label-1").waitFor({ timeout: 5000 });
    const activePoint = await page.getByTestId("graph-current-point").textContent();
    if (!String(activePoint || "").includes("Red B0") || !String(activePoint || "").includes("C2")) {
      throw new Error(`File-imported line did not land on the final move: ${String(activePoint || "").trim()}`);
    }
  } finally {
    fs.rmSync(importPath, { force: true });
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

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("download-pgn-saved-qa-copy-pgn-game").click();
  const download = await downloadPromise;
  const suggestedFilename = download.suggestedFilename();
  if (!/^web-xiangqi-2024-03-09-pgn-copy-qa\.pgn$/.test(suggestedFilename)) {
    throw new Error(`Unexpected saved-game PGN filename: ${suggestedFilename}`);
  }

  const savePath = path.resolve(__dirname, "..", ".saved-game-export-test.pgn");
  try {
    await download.saveAs(savePath);
    const exportedPgn = fs.readFileSync(savePath, "utf8");
    if (!exportedPgn.includes(`[FEN "${blackToMoveFen}"]`)) {
      throw new Error(`Downloaded saved-game PGN omitted the root FEN:\n${exportedPgn}`);
    }
    if (!exportedPgn.includes("17... a6a5 18. a3a4 *")) {
      throw new Error(`Downloaded saved-game PGN used the wrong move numbering:\n${exportedPgn}`);
    }
  } finally {
    fs.rmSync(savePath, { force: true });
  }
}

async function assertSavedStudyTreeRoundTrip(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.evaluate(() => {
    localStorage.removeItem("xiangqi-game-library");
    window.__savedStudyPgnWrites = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.__savedStudyPgnWrites.push(String(text));
        },
      },
    });
  });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });

  await page.locator('.hitbox[data-file="1"][data-rank="2"]').click();
  await page.locator('.hitbox[data-file="4"][data-rank="2"]').click();
  await page.locator('.hitbox[data-file="7"][data-rank="9"]').click();
  await page.locator('.hitbox[data-file="6"][data-rank="7"]').click();
  await page.locator('.watch-controls button[aria-label="Go to first position"]').click();
  await page.locator('.hitbox[data-file="1"][data-rank="0"]').click();
  await page.locator('.hitbox[data-file="2"][data-rank="2"]').click();
  await page.getByTestId("move-tree-row-label-0").waitFor({ timeout: 5000 });

  await page.getByTestId("save-game-btn").click();
  const saved = await page.waitForFunction(() => {
    const raw = localStorage.getItem("xiangqi-game-library");
    if (!raw) return null;
    const games = JSON.parse(raw);
    return games.length === 1 ? games[0] : null;
  }, null, { timeout: 5000 }).then((handle) => handle.jsonValue());
  if (!saved?.id || saved.moves?.join(" ") !== "b0c2" || saved.moveTree?.length !== 2) {
    throw new Error(`Saved study tree did not persist the mainline and branches: ${JSON.stringify(saved)}`);
  }

  await page.locator('button[aria-label="Open game library"]').click();
  await page.getByTestId(`copy-pgn-saved-${saved.id}`).click();
  await page.getByRole("button", { name: "Saved game PGN copied" }).waitFor({ timeout: 5000 });
  const copiedPgn = await page.evaluate(() => window.__savedStudyPgnWrites?.[0] ?? "");
  if (!copiedPgn.includes("1. b0c2 (1. b2e2 h9g7) *")) {
    throw new Error(`Saved study tree PGN did not preserve variations:\n${copiedPgn}`);
  }

  await page.getByTestId(`load-saved-${saved.id}`).click();
  await page.waitForFunction(() => document.querySelector(".mtree-row")?.textContent?.includes("b0c2"), null, { timeout: 5000 });
  const loaded = await page.evaluate(() => ({
    activeRow: document.querySelector(".mtree-row")?.textContent?.trim() || "",
    variations: [...document.querySelectorAll(".mtree-variation")].map((el) => el.textContent?.trim() || "").join(" "),
    overflowX: document.body.scrollWidth - document.body.clientWidth,
  }));
  if (!loaded.activeRow.includes("b0c2") || !loaded.variations.includes("b2e2") || !loaded.variations.includes("h9g7") || loaded.overflowX > 2) {
    throw new Error(`Saved study tree did not reload with variations visible: ${JSON.stringify(loaded)}`);
  }
}

async function assertLibraryPgnFailureFeedback(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.evaluate(() => {
    localStorage.setItem("xiangqi-game-library", JSON.stringify([{
      id: "qa-library-export-failure",
      savedAt: 1710000000000,
      gameMode: "PvP",
      moves: ["b2e2", "h9g7"],
      result: "ongoing",
      label: "Library export failure QA",
    }]));
  });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new DOMException("Simulated clipboard denial", "NotAllowedError");
        },
      },
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: () => false,
    });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: undefined,
    });
  });

  await page.locator('button[aria-label="Open game library"]').click();
  await page.getByText("Library export failure QA").waitFor({ timeout: 10000 });
  await page.getByTestId("copy-pgn-saved-qa-library-export-failure").click();
  await page.getByTestId("library-action-error").getByText("Could not copy this PGN").waitFor({ timeout: 5000 });

  const afterCopy = await page.evaluate(() => ({
    role: document.querySelector('[data-testid="library-action-error"]')?.getAttribute("role") || "",
    copyText: document.querySelector('[data-testid="copy-pgn-saved-qa-library-export-failure"]')?.textContent?.trim() || "",
    copyClass: document.querySelector('[data-testid="copy-pgn-saved-qa-library-export-failure"]')?.className || "",
  }));
  if (afterCopy.role !== "alert" || afterCopy.copyText.includes("Copied") || !afterCopy.copyClass.includes("chip-btn-warning")) {
    throw new Error(`Library copy failure did not expose retryable alert state: ${JSON.stringify(afterCopy)}`);
  }

  await page.getByTestId("download-pgn-saved-qa-library-export-failure").click();
  await page.getByTestId("library-action-error").getByText("Could not download this PGN").waitFor({ timeout: 5000 });

  const afterDownload = await page.evaluate(() => ({
    role: document.querySelector('[data-testid="library-action-error"]')?.getAttribute("role") || "",
    downloadText: document.querySelector('[data-testid="download-pgn-saved-qa-library-export-failure"]')?.textContent?.trim() || "",
    downloadClass: document.querySelector('[data-testid="download-pgn-saved-qa-library-export-failure"]')?.className || "",
    overflowX: document.body.scrollWidth - document.body.clientWidth,
  }));
  if (afterDownload.role !== "alert" || afterDownload.downloadText.includes("Saved") || !afterDownload.downloadClass.includes("chip-btn-warning") || afterDownload.overflowX > 2) {
    throw new Error(`Library download failure did not expose retryable alert state: ${JSON.stringify(afterDownload)}`);
  }
}

async function assertLibraryMutationFailureFeedback(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.evaluate(() => {
    localStorage.setItem("xiangqi-game-library", JSON.stringify([{
      id: "qa-library-failure",
      savedAt: 1710000000000,
      gameMode: "PvP",
      moves: ["b2e2"],
      result: "ongoing",
      label: "Mutation failure QA",
    }]));
  });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.locator('button[aria-label="Open game library"]').click();
  await page.getByText("Mutation failure QA").waitFor({ timeout: 10000 });
  await page.evaluate(() => {
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItemWithLibraryFailure(key, value) {
      if (key === "xiangqi-game-library") {
        throw new DOMException("Simulated full storage", "QuotaExceededError");
      }
      return originalSetItem.call(this, key, value);
    };
  });

  await page.getByRole("button", { name: "Mutation failure QA" }).click();
  const renameForm = page.getByTestId("rename-form-saved-qa-library-failure");
  await renameForm.locator("input").fill("Renamed failure");
  await renameForm.getByRole("button", { name: "Save" }).click();
  await page.getByTestId("library-action-error").getByText("Could not rename").waitFor({ timeout: 5000 });

  const afterRename = await page.evaluate(() => ({
    label: JSON.parse(localStorage.getItem("xiangqi-game-library") || "[]")[0]?.label || "",
    editing: Boolean(document.querySelector('[data-testid="rename-form-saved-qa-library-failure"]')),
    alertRole: document.querySelector('[data-testid="library-action-error"]')?.getAttribute("role") || "",
  }));
  if (afterRename.label !== "Mutation failure QA" || !afterRename.editing || afterRename.alertRole !== "alert") {
    throw new Error(`Rename failure did not preserve data and editing state: ${JSON.stringify(afterRename)}`);
  }

  await renameForm.getByRole("button", { name: "Cancel" }).click();
  await page.getByTestId("delete-saved-qa-library-failure").click();
  await page.getByTestId("confirm-delete-saved-qa-library-failure").click();
  await page.getByTestId("library-action-error").getByText("Could not delete").waitFor({ timeout: 5000 });

  const afterDelete = await page.evaluate(() => ({
    gameCount: JSON.parse(localStorage.getItem("xiangqi-game-library") || "[]").length,
    stillVisible: document.body.textContent?.includes("Mutation failure QA") || false,
    confirmVisible: Boolean(document.querySelector('[data-testid="confirm-delete-saved-qa-library-failure"]')),
  }));
  if (afterDelete.gameCount !== 1 || !afterDelete.stillVisible || !afterDelete.confirmVisible) {
    throw new Error(`Delete failure did not preserve the saved game and retry state: ${JSON.stringify(afterDelete)}`);
  }
}

async function assertSaveFailureFeedback(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.evaluate(() => {
    localStorage.removeItem("xiangqi-game-library");
  });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });

  await page.locator('.hitbox[data-file="1"][data-rank="2"]').click();
  await page.locator('.hitbox[data-file="4"][data-rank="2"]').click();
  await page.getByTestId("save-game-btn").waitFor({ timeout: 5000 });
  await page.evaluate(() => {
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItemWithLibraryFailure(key, value) {
      if (key === "xiangqi-game-library") {
        throw new DOMException("Simulated full storage", "QuotaExceededError");
      }
      return originalSetItem.call(this, key, value);
    };
  });

  await page.getByTestId("save-game-btn").click();
  await page.getByTestId("save-game-btn").getByText("Save Failed").waitFor({ timeout: 5000 });
  const state = await page.evaluate(() => ({
    stored: localStorage.getItem("xiangqi-game-library"),
    title: document.querySelector('[data-testid="save-game-btn"]')?.getAttribute("title") || "",
    className: document.querySelector('[data-testid="save-game-btn"]')?.className || "",
  }));

  if (state.stored !== null) {
    throw new Error(`Failed save wrote a library entry anyway: ${state.stored}`);
  }
  if (!state.title.includes("Could not save") || !state.className.includes("gc-btn-warning")) {
    throw new Error(`Failed save did not expose warning feedback: ${JSON.stringify(state)}`);
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
  await page.waitForFunction(() => document.activeElement?.classList.contains("game-over-btn-primary"), null, { timeout: 5000 });
  const dialogState = await page.evaluate(() => {
    const modal = document.querySelector(".game-over-modal");
    return {
      role: modal?.getAttribute("role") || "",
      ariaModal: modal?.getAttribute("aria-modal") || "",
      activeText: document.activeElement?.textContent?.trim() || "",
      activeIsPrimary: document.activeElement?.classList.contains("game-over-btn-primary") || false,
    };
  });
  if (dialogState.role !== "dialog" || dialogState.ariaModal !== "true") {
    throw new Error(`Game-over modal was not exposed as a modal dialog: ${JSON.stringify(dialogState)}`);
  }
  if (!dialogState.activeIsPrimary) {
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
    await assertEnginePvLineControl(page);
    await assertPreferencePersistence(page);
    await assertBottomNewGameMenuResetsDraft(page);
    await assertInvalidFenToastTimerResets(page);
    await assertDisabledControlsLookInactive(page);
    await assertPanelTabAccessibility(page);
    await assertNewGameDialogFocusTrap(page);
    await assertBlackToMoveTreeNumbering(page);
    await assertMoveLineImport(page);
    await assertMoveLineImportIgnoresVariations(page);
    await assertMoveLineImportErrorAccessibility(page);
    await assertRootMoveVariationsVisible(page);
    await assertPgnTreeVariationExport(page);
    await assertCurrentPgnDownload(page);
    await assertMainExportFailureFeedback(page);
    await assertShareLinkRoundTrip(page);
    await assertShareTreeRoundTrip(page);
    await assertLongShareVariationVisible(page);
    await assertInvalidShareLinkFeedback(page);
    await assertMoveLineFileImport(page);
    await assertFenTaggedMoveLineImport(page);
    await assertDialogsBlockMoveShortcuts(page);
    await assertBoardMarkersSurviveSelection(page);
    await assertMobileBoardLayout(page, { width: 596, height: 668 });
    await assertMobileBoardLayout(page, { width: 390, height: 844 });
    await assertSaveFailureFeedback(page);
    await assertMobileSaveLibraryActions(page);
    await assertLibraryPgnCopy(page);
    await assertSavedStudyTreeRoundTrip(page);
    await assertLibraryPgnFailureFeedback(page);
    await assertLibraryMutationFailureFeedback(page);
    await assertLibraryDeleteConfirmation(page);
    await assertGameOverReviewPreservesResult(page);

    if (pageConsole.length > 0) {
      throw new Error("Unexpected browser console errors:\n" + pageConsole.join("\n"));
    }

    console.log("Desktop/mobile board layout, AI-turn lock, AI Play engine status, engine PV controls, preference persistence, panel tab accessibility, dialog focus trap, dialog shortcut guard, resize feedback, new-game reset, inactive disabled controls, invalid-FEN/share-link feedback timing, custom-FEN move numbering/graph labels, UCI/FEN-tag/file import with variation handling and accessible errors, root move variations, tree PGN variation export, long variation display, current-line PGN download/share link with study trees and export failure feedback, board marker persistence, save/library mutation failure feedback and PGN actions, saved study-tree round-trip, game-over review state, and library delete checks passed.");
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
