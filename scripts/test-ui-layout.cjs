/**
 * NOTE: the localStorage keys below mirror `src/utils/storageKeys.ts`. They are
 * written as literals because they are used inside page.evaluate closures,
 * which cannot capture Node values. When a key is renamed there it has to be
 * renamed here too, and `storageKeys.test.ts` fails if a legacy name is left
 * behind -- which is how the rename to `xiangqi:thing:v1` was caught: the app
 * migrated fine, and this harness went on clearing a key nothing wrote any
 * more, so preferences leaked between assertions and a Pro-mode check read
 * "coach".
 */
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

function buildFakePikafishScript({ variant, setupSource = "", goSource = "" }) {
  const tracksInstances = variant === "fake-restart-buffer" || variant === "fake-restart-options";
  return `
(() => {
  try {
    window.localStorage?.removeItem("xiangqi:preferences:v1");
  } catch (_) {}
  try {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  } catch (_) {}
  window.__engineCommands = [];
  ${tracksInstances ? "window.__engineInstanceCount = 0; window.__engineCommandsByInstance = [];" : ""}
  ${setupSource}
  window.Pikafish = function Pikafish() {};
  window.Pikafish.createWorkerEngine = async () => {
    const instanceId = ${tracksInstances ? "++window.__engineInstanceCount" : "0"};
    const listeners = [];
    const emit = (line) => listeners.forEach((listener) => listener(line));
    return {
      variant: ${JSON.stringify(variant)},
      addMessageListener(listener) {
        listeners.push(listener);
      },
      removeMessageListener(listener) {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      },
      postMessage(command) {
        window.__engineCommands.push(command);
        if (Array.isArray(window.__engineCommandsByInstance)) {
          window.__engineCommandsByInstance.push({ instanceId, command });
        }
        if (/^position\b/.test(command)) {
          window.__lastPositionCommand = command;
        }
        if (command === "uci") {
          setTimeout(() => {
            emit("id name Fake Pikafish");
            emit("option name MultiPV type spin default 1 min 1 max 128");
            emit("option name UCI_ShowWDL type check default false");
            emit("uciok");
          }, 0);
        } else if (command === "isready") {
          setTimeout(() => emit("readyok"), 0);
        } else if (/^go\\b/.test(command)) {
          ${goSource || (variant === "fake-mate-telemetry" ? `
          setTimeout(() => {
            emit("info depth 8 seldepth 10 multipv 1 score mate 3 wdl 1000 0 0 nodes 2345 nps 67890 hashfull 12 time 45 pv b2e2 h9g7");
            emit("bestmove b2e2");
          }, 20);
          ` : variant === "fake-restart-options" ? `
          setTimeout(() => {
            emit("info depth 4 multipv 1 score cp 42 wdl 410 220 370 pv b2e2 h9g7");
            emit("bestmove b2e2");
          }, 20);
          ` : "")}
        }
      },
      terminate() {
        return Promise.resolve();
      },
    };
  };
})();
`;
}

async function installFakePikafish(page, fakeConfig) {
  const source = buildFakePikafishScript(fakeConfig);
  await page.addInitScript((config) => {
    try {
      window.localStorage?.removeItem("xiangqi:preferences:v1");
    } catch (_) {}
    try {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    } catch (_) {}
    window.__engineCommands = [];
    if (config.variant === "fake-pv") {
      Math.random = () => 0.99;
    }
    if (config.variant === "fake-pv-play") {
      window.__goCount = 0;
    }
    if (config.variant === "fake-telemetry") {
      window.__goCount = 0;
    }
    if (config.variant === "fake-review-revisit" || config.variant === "fake-review-good-swing") {
      window.__reviewPositionCounts = {};
      try {
        Object.defineProperty(navigator, "hardwareConcurrency", { configurable: true, get: () => 8 });
        Object.defineProperty(navigator, "deviceMemory", { configurable: true, get: () => 8 });
      } catch (_) {}
    }
    if (config.variant === "fake-stall-ready" || config.variant === "fake-create-hangs") {
      window.__WEB_XIANGQI_ENGINE_READY_TIMEOUT_MS = 120;
    }
    if (config.variant === "fake-restart-buffer" || config.variant === "fake-restart-options") {
      window.__engineInstanceCount = 0;
      window.__goCount = 0;
      window.__engineCommandsByInstance = [];
    }
    window.Pikafish = function Pikafish() {};
    window.Pikafish.createWorkerEngine = async (engineOptions = {}) => {
      window.__createWorkerEngineOptions = [
        ...(window.__createWorkerEngineOptions || []),
        engineOptions,
      ];
      if (config.variant === "fake-create-hangs") {
        return new Promise(() => {});
      }
      const instanceId = config.variant === "fake-restart-buffer" || config.variant === "fake-restart-options"
        ? ++window.__engineInstanceCount
        : 0;
      const listeners = [];
      const emit = (line) => listeners.forEach((listener) => listener(line));
      return {
        variant: config.variant,
        addMessageListener(listener) {
          listeners.push(listener);
        },
        removeMessageListener(listener) {
          const index = listeners.indexOf(listener);
          if (index >= 0) listeners.splice(index, 1);
        },
        postMessage(command) {
          window.__engineCommands.push(command);
          if (Array.isArray(window.__engineCommandsByInstance)) {
            window.__engineCommandsByInstance.push({ instanceId, command });
          }
          if (/^position\b/.test(command)) {
            window.__lastPositionCommand = command;
          }
          if (command === "uci") {
            setTimeout(() => {
              emit("id name Fake Pikafish");
              emit("option name MultiPV type spin default 1 min 1 max 128");
              emit("option name UCI_ShowWDL type check default false");
              emit("uciok");
            }, 0);
          } else if (command === "isready") {
            if (config.variant === "fake-stall-ready") return;
            setTimeout(() => emit("readyok"), 0);
          } else if (command === "stop" && config.variant === "fake-review-hangs") {
            setTimeout(() => emit("bestmove b0c2"), 0);
          } else if (/^go\b/.test(command)) {
            if (config.variant === "fake-pv") {
              setTimeout(() => {
                emit("info depth 2 multipv 1 score cp 50 pv h0g2");
                emit("info depth 2 multipv 2 score cp 10 pv b0c2");
                emit("bestmove h0g2");
              }, 20);
            } else if (config.variant === "fake-analysis-ai-guard") {
              setTimeout(() => {
                emit("info depth 2 multipv 1 score cp 42 pv h0g2");
                emit("bestmove h0g2");
              }, 20);
            } else if (config.variant === "fake-pv-play") {
              window.__goCount += 1;
              const isAfterPlayedPv = /\bmoves\b.*\bb0c2\b/.test(window.__lastPositionCommand || "");
              setTimeout(() => {
                if (!isAfterPlayedPv) {
                  emit("info depth 4 multipv 1 score cp 300 pv b0c2");
                  emit("bestmove b0c2");
                  return;
                }
                emit("bestmove h9g7");
              }, 20);
            } else if (config.variant === "fake-restart-buffer") {
              window.__goCount += 1;
              setTimeout(() => {
                if (instanceId === 1) {
                  emit("info depth 6 multipv 1 score cp 900 pv b2e2 h9g7");
                  return;
                }
                emit("bestmove h9g7");
              }, 20);
            } else if (config.variant === "fake-restart-options") {
              window.__goCount += 1;
              setTimeout(() => {
                emit("info depth 4 multipv 1 score cp 42 wdl 410 220 370 pv b2e2 h9g7");
                emit("bestmove b2e2");
              }, 20);
            } else if (config.variant === "fake-telemetry") {
              window.__goCount += 1;
              const finishTelemetrySearch = () => {
                emit("info depth 8 seldepth 12 multipv 1 score cp 42 wdl 410 230 360 nodes 123456 nps 789000 hashfull 23 time 156 pv b2e2 h9g7");
                emit("bestmove b2e2");
              };
              if (window.__goCount === 1) {
                setTimeout(finishTelemetrySearch, 20);
              } else {
                let completed = false;
                let timer = null;
                const finishSecondSearch = () => {
                  if (completed) return;
                  completed = true;
                  if (timer !== null) clearTimeout(timer);
                  finishTelemetrySearch();
                };
                window.__finishFakeTelemetrySearch = finishSecondSearch;
                timer = setTimeout(finishSecondSearch, 8000);
              }
            } else if (config.variant === "fake-mate-telemetry") {
              setTimeout(() => {
                emit("info depth 8 seldepth 10 multipv 1 score mate 3 wdl 1000 0 0 nodes 2345 nps 67890 hashfull 12 time 45 pv b2e2 h9g7");
                emit("bestmove b2e2");
              }, 20);
            } else if (config.variant === "fake-review-revisit" || config.variant === "fake-review-good-swing") {
              const position = window.__lastPositionCommand || "";
              const count = (window.__reviewPositionCounts[position] || 0) + 1;
              window.__reviewPositionCounts[position] = count;
              // Positions are identified by the move list, not by the FEN.
              // The review used to send `position fen <fen>`; it now sends the
              // same command live analysis does -- `position startpos moves
              // ...` -- because the engine needs the history to see a
              // repetition, and in xiangqi a repetition is not a draw.
              const movesPart = position.includes(" moves ")
                ? position.slice(position.indexOf(" moves ") + 7).trim()
                : "";
              const isRoot = movesPart === "";
              const isAfterRedCannon = movesPart === "b2e2";
              const isAfterBlackHorse = movesPart === "b2e2 h9g7";
              setTimeout(() => {
                if (isRoot && count >= 2) {
                  emit("info depth 11 multipv 1 score cp 0 pv b0c2");
                  emit("bestmove b0c2");
                  return;
                }
                if (isRoot) {
                  emit("info depth 9 multipv 1 score cp 0 pv h2e2");
                  emit("bestmove h2e2");
                  return;
                }
                if (isAfterRedCannon) {
                  const score = config.variant === "fake-review-good-swing" ? -500 : 500;
                  emit(`info depth 9 multipv 1 score cp ${score} pv h9g7`);
                  emit("bestmove h9g7");
                  return;
                }
                if (isAfterBlackHorse) {
                  emit("info depth 9 multipv 1 score cp -480 pv b0c2");
                  emit("bestmove b0c2");
                  return;
                }
                emit("info depth 9 multipv 1 score cp 0 pv b2e2");
                emit("bestmove b2e2");
              }, 20);
            } else if (config.variant === "fake-review-hangs") {
              setTimeout(() => {
                emit("info depth 4 multipv 1 score cp 0 pv b0c2");
              }, 20);
            }
          }
        },
        terminate() {
          return Promise.resolve();
        },
      };
    };
  }, { variant: fakeConfig.variant });
  await page.route("**/pikafish.js", (route) => route.fulfill({
    status: 200,
    contentType: "application/javascript",
    body: source,
  }));
}

async function newIsolatedPage(browser, viewport = { width: 1280, height: 820 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  return { context, page };
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

async function assertNoDanglingAriaControls(page) {
  // Every aria-controls has to lead somewhere. The one accepted exception is a
  // collapsed disclosure -- aria-expanded="false" -- whose content is rendered
  // on demand and legitimately absent until opened. This app has six of those
  // and they are correct: each resolves to a role="dialog" once expanded.
  //
  // Anything else pointing at a missing id promises a screen-reader user a
  // destination that does not exist, which is worse than saying nothing.
  // Written after web-katrain shipped exactly that -- a tab whose
  // aria-controls named a panel React had not mounted -- and now checked in
  // all three sibling harnesses.
  //
  // Checked with the menus open as well as closed: the closed sweep alone
  // never evaluates a reference whose target is conditionally rendered, which
  // is precisely the shape of the bug this exists to catch.
  const sweep = () => page.evaluate(() => Array.from(document.querySelectorAll("[aria-controls]"))
    .filter((el) => el.getAttribute("aria-expanded") !== "false")
    .filter((el) => !document.getElementById(el.getAttribute("aria-controls")))
    .map((el) => (el.getAttribute("aria-label") || el.tagName) + "->#" + el.getAttribute("aria-controls")));

  const atRest = await sweep();
  if (atRest.length > 0) {
    throw new Error(`aria-controls pointing at nothing (at rest): ${atRest.join(", ")}`);
  }

  for (const label of ["Open settings", "Start new game"]) {
    const trigger = page.locator(`[aria-controls][aria-expanded][aria-label="${label}"]:visible`).first();
    if ((await trigger.count()) === 0) continue;
    await trigger.click();
    await page.waitForTimeout(400);
    const expanded = await trigger.getAttribute("aria-expanded");
    if (expanded !== "true") {
      throw new Error(`"${label}" did not report aria-expanded=true after opening`);
    }
    const whileOpen = await sweep();
    if (whileOpen.length > 0) {
      throw new Error(`aria-controls pointing at nothing (${label} open): ${whileOpen.join(", ")}`);
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
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
      appHeading: document.querySelector("h1.sr-only")?.textContent?.trim() || "",
      workspaceGroupRole: document.querySelector(".top-mode-pills")?.getAttribute("role") || "",
      workspaceGroupLabel: document.querySelector(".top-mode-pills")?.getAttribute("aria-label") || "",
      hitboxCount: document.querySelectorAll(".hitbox").length,
      tabbableHitboxCount: Array.from(document.querySelectorAll(".hitbox"))
        .filter((el) => el.tabIndex >= 0).length,
      emptyHitboxTabStops: Array.from(document.querySelectorAll(".hitbox"))
        .filter((el) => el.tabIndex >= 0 && (el.getAttribute("aria-label") || "").includes("empty"))
        .map((el) => el.getAttribute("aria-label") || ""),
      graphDescribedBy: document.querySelector(".winrate-graph")?.getAttribute("aria-describedby") || "",
      graphRole: document.querySelector(".winrate-graph")?.getAttribute("role") || "",
      graphLabel: document.querySelector(".winrate-graph")?.getAttribute("aria-label") || "",
      graphValueMin: document.querySelector(".winrate-graph")?.getAttribute("aria-valuemin") || "",
      graphValueMax: document.querySelector(".winrate-graph")?.getAttribute("aria-valuemax") || "",
      graphValueNow: document.querySelector(".winrate-graph")?.getAttribute("aria-valuenow") || "",
      graphValueText: document.querySelector(".winrate-graph")?.getAttribute("aria-valuetext") || "",
      graphOrientation: document.querySelector(".winrate-graph")?.getAttribute("aria-orientation") || "",
      graphKeyshortcuts: document.querySelector(".winrate-graph")?.getAttribute("aria-keyshortcuts") || "",
      graphVisualsHidden: document.querySelector(".winrate-graph > g")?.getAttribute("aria-hidden") || "",
      graphVisualsFocusable: document.querySelector(".winrate-graph > g")?.getAttribute("focusable") || "",
      graphDescriptionText: (() => {
        const id = document.querySelector(".winrate-graph")?.getAttribute("aria-describedby");
        return id ? document.getElementById(id)?.textContent?.replace(/\s+/g, " ").trim() || "" : "";
      })(),
      graphLegacyDescription: document.querySelector(".winrate-graph")?.getAttribute("aria-description") || "",
      compactWdlBarCount: document.querySelectorAll(".wdl-bar").length,
      decorativeBoardLayers: {
        gridHidden: document.querySelector(".board-svg-grid")?.getAttribute("aria-hidden") || "",
        gridFocusable: document.querySelector(".board-svg-grid")?.getAttribute("focusable") || "",
        riverHidden: document.querySelector(".river")?.getAttribute("aria-hidden") || "",
        arrowsHidden: document.querySelector(".board-arrows-layer")?.getAttribute("aria-hidden") || "",
        arrowsFocusable: document.querySelector(".board-arrows-layer")?.getAttribute("focusable") || "",
        piecesHidden: document.querySelector(".pieces-layer")?.getAttribute("aria-hidden") || "",
      },
      decorativeButtonIcons: {
        count: document.querySelectorAll("button svg").length,
        exposed: Array.from(document.querySelectorAll("button svg"))
          .filter((svg) => svg.getAttribute("aria-hidden") !== "true" || svg.getAttribute("focusable") !== "false")
          .map((svg) => svg.closest("button")?.getAttribute("aria-label") || svg.closest("button")?.textContent?.replace(/\s+/g, " ").trim() || ""),
      },
      visibleGraphShortcutPrompts: Array.from(document.querySelectorAll(".panel-copy.small"))
        .filter((el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden")
        .map((el) => el.textContent?.replace(/\s+/g, " ").trim() || "")
        .filter((text) => /keyboard navigation|left and right arrows|press enter/i.test(text)),
      graphJumpButtons: Array.from(document.querySelectorAll(".graph-jump-controls .graph-jump-btn"))
        .map((el) => ({
          label: el.getAttribute("aria-label") || "",
          title: el.getAttribute("title") || "",
          visibleText: el.textContent?.replace(/\s+/g, " ").trim() || "",
          width: el.getBoundingClientRect().width,
          height: el.getBoundingClientRect().height,
        })),
      centralCannonCandidateText: document.querySelector('[data-testid="book-candidate-h2e2"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
      clippedBookCandidateLabels: Array.from(document.querySelectorAll(".opening-candidate-main > span, .opening-candidate-main small"))
        .filter((el) => el.scrollWidth - el.clientWidth > 1)
        .map((el) => el.textContent?.trim() || ""),
      clippedGraphSummaryLabels: Array.from(document.querySelectorAll(".graph-summary-card span"))
        .filter((el) => el.scrollWidth - el.clientWidth > 1)
        .map((el) => el.textContent?.trim() || ""),
    };
  });

  if (layout.body.scrollWidth > layout.body.clientWidth + 2) {
    throw new Error(
      `Horizontal overflow at ${viewport.width}x${viewport.height}: ${layout.body.scrollWidth} > ${layout.body.clientWidth}`
    );
  }
  if (layout.appHeading !== "Web Xiangqi") {
    throw new Error(`App heading was not exposed to assistive technology: ${JSON.stringify(layout)}`);
  }
  if (layout.workspaceGroupRole !== "group" || layout.workspaceGroupLabel !== "Workspace mode") {
    throw new Error(`Workspace mode controls were not exposed as a named group: ${JSON.stringify(layout)}`);
  }
  if (layout.hitboxCount !== 90) {
    throw new Error(`Expected 90 board hitboxes, found ${layout.hitboxCount}.`);
  }
  if (
    layout.decorativeBoardLayers.gridHidden !== "true" ||
    layout.decorativeBoardLayers.gridFocusable !== "false" ||
    layout.decorativeBoardLayers.riverHidden !== "true" ||
    layout.decorativeBoardLayers.arrowsHidden !== "true" ||
    layout.decorativeBoardLayers.arrowsFocusable !== "false" ||
    layout.decorativeBoardLayers.piecesHidden !== "true"
  ) {
    throw new Error(`Decorative board layers should stay out of the accessibility tree: ${JSON.stringify(layout.decorativeBoardLayers)}`);
  }
  if (layout.decorativeButtonIcons.count === 0 || layout.decorativeButtonIcons.exposed.length > 0) {
    throw new Error(`Button icons should be decorative because the buttons already carry text or labels: ${JSON.stringify(layout.decorativeButtonIcons)}`);
  }
  if (layout.tabbableHitboxCount !== 32 || layout.emptyHitboxTabStops.length > 0) {
    throw new Error(`Board tab order should include only actionable pieces at the start: ${JSON.stringify(layout)}`);
  }
  if (layout.clippedGraphSummaryLabels.length > 0) {
    throw new Error(`Desktop graph summary labels are clipped: ${layout.clippedGraphSummaryLabels.join(", ")}`);
  }
  if (layout.compactWdlBarCount !== 0) {
    throw new Error(`Compact analysis should not show an unavailable WDL bar: ${JSON.stringify(layout)}`);
  }
  if (
    layout.graphDescribedBy !== "evaluation-graph-instructions" ||
    layout.graphRole !== "slider" ||
    layout.graphLabel !== "Evaluation graph move navigator" ||
    layout.graphValueMin !== "0" ||
    layout.graphValueMax !== "0" ||
    layout.graphValueNow !== "0" ||
    !layout.graphValueText.includes("Start position") ||
    !layout.graphValueText.includes("Red POV evaluation 0.00") ||
    layout.graphOrientation !== "horizontal" ||
    !layout.graphKeyshortcuts.includes("Home") ||
    layout.graphVisualsHidden !== "true" ||
    layout.graphVisualsFocusable !== "false" ||
    !layout.graphDescriptionText.includes("Use left and right arrows") ||
    layout.graphLegacyDescription
  ) {
    throw new Error(`Evaluation graph instructions are not exposed accessibly: ${JSON.stringify(layout)}`);
  }
  if (layout.visibleGraphShortcutPrompts.length > 0) {
    throw new Error(`Evaluation graph shortcut copy should stay out of the visible UI: ${JSON.stringify(layout)}`);
  }
  const expectedGraphJumpLabels = [
    "Go to first position",
    "Go to previous move",
    "Go to next move",
    "Go to latest move",
  ];
  const graphJumpLabels = layout.graphJumpButtons.map((button) => button.label);
  const graphJumpTitles = layout.graphJumpButtons.map((button) => button.title);
  if (
    layout.graphJumpButtons.length !== 4 ||
    JSON.stringify(graphJumpLabels) !== JSON.stringify(expectedGraphJumpLabels) ||
    JSON.stringify(graphJumpTitles) !== JSON.stringify(expectedGraphJumpLabels) ||
    layout.graphJumpButtons.some((button) => button.visibleText || button.width < 28 || button.height < 28)
  ) {
    throw new Error(`Evaluation graph jump controls are not compact and accessible: ${JSON.stringify(layout.graphJumpButtons)}`);
  }
  if (
    !layout.centralCannonCandidateText.includes("Central Cannon") ||
    !layout.centralCannonCandidateText.includes("中炮") ||
    layout.clippedBookCandidateLabels.length > 0
  ) {
    throw new Error(`Opening book candidates are not beginner/pro readable: ${JSON.stringify(layout)}`);
  }
  rectWithinDesktopLayout(layout);
}

async function assertOpeningBookArrowsGuideBoard(page) {
  await page.setViewportSize({ width: 1024, height: 720 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector(".top-mode-pills button[aria-pressed='true']")?.textContent?.trim() === "Play",
    null,
    { timeout: 5000 }
  );

  const initial = await page.evaluate(() => {
    const bookArrows = Array.from(document.querySelectorAll(".board-arrow-book"));
    const firstBookPath = document.querySelector(".board-arrow-book path");
    return {
      bookArrowCount: bookArrows.length,
      engineArrowCount: document.querySelectorAll(".board-arrow-engine").length,
      centralCannonArrow: Boolean(document.querySelector('.board-arrow-book[data-from="7:2"][data-to="4:2"]')),
      firstBookDash: firstBookPath ? getComputedStyle(firstBookPath).strokeDasharray : "",
      centralCannonCandidate: document.querySelector('[data-testid="book-candidate-h2e2"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
      overflowX: document.body.scrollWidth - document.body.clientWidth,
    };
  });
  if (
    initial.bookArrowCount < 2 ||
    initial.engineArrowCount !== 0 ||
    !initial.centralCannonArrow ||
    !initial.centralCannonCandidate.includes("Central Cannon") ||
    initial.firstBookDash === "none" ||
    initial.overflowX > 2
  ) {
    throw new Error(`Opening book arrows did not guide the start position: ${JSON.stringify(initial)}`);
  }

  await page.getByTestId("book-candidate-h2e2").click();
  await page.getByTestId("move-tree-row-label-0").waitFor({ timeout: 5000 });
  const reply = await page.evaluate(() => ({
    lastMoveArrow: Boolean(document.querySelector('.board-arrow-last[data-from="7:2"][data-to="4:2"]')),
    bookReplyCount: document.querySelectorAll(".board-arrow-book").length,
    screenHorseReply: Boolean(document.querySelector('.board-arrow-book[data-from="7:9"][data-to="6:7"]')),
    variationRows: Array.from(document.querySelectorAll(".mtree-row"))
      .map((el) => el.textContent?.replace(/\s+/g, " ").trim() || "")
      .join(" "),
    overflowX: document.body.scrollWidth - document.body.clientWidth,
  }));
  if (!reply.lastMoveArrow || reply.bookReplyCount < 2 || !reply.screenHorseReply || !reply.variationRows.includes("h2e2") || reply.overflowX > 2) {
    throw new Error(`Opening book arrows did not update after playing a candidate: ${JSON.stringify(reply)}`);
  }
}

async function assertBoardKeyboardNavigation(page) {
  await page.setViewportSize({ width: 1024, height: 720 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });

  const beforeFen = await page.locator(".bottombar-fen").getAttribute("title");
  await page.locator('.hitbox[data-file="1"][data-rank="0"]').focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");

  const focusState = await page.evaluate(() => ({
    file: document.activeElement?.getAttribute("data-file") || "",
    rank: document.activeElement?.getAttribute("data-rank") || "",
    label: document.activeElement?.getAttribute("aria-label") || "",
    shortcuts: document.activeElement?.getAttribute("aria-keyshortcuts") || "",
    overflowX: document.body.scrollWidth - document.body.clientWidth,
  }));

  if (
    focusState.file !== "2" ||
    focusState.rank !== "2" ||
    !focusState.label.includes("legal move") ||
    !focusState.shortcuts.includes("Enter") ||
    !focusState.shortcuts.includes("Space") ||
    !focusState.shortcuts.includes("ArrowUp") ||
    focusState.overflowX > 2
  ) {
    throw new Error(`Board arrow-key navigation did not focus a legal target: ${JSON.stringify(focusState)}`);
  }

  await page.keyboard.press("Enter");
  await page.waitForFunction((fen) => {
    return document.querySelector(".bottombar-fen")?.getAttribute("title") !== fen;
  }, beforeFen, { timeout: 5000 });

  const moveState = await page.evaluate(() => ({
    fen: document.querySelector(".bottombar-fen")?.getAttribute("title") || "",
    movedPiece: document.querySelector('.hitbox[data-file="2"][data-rank="2"]')?.getAttribute("aria-label") || "",
    timelineText: document.querySelector(".wc-meta strong")?.textContent?.trim() || "",
    scrubberValue: document.querySelector(".wc-scrubber")?.value || "",
    scrubberLabel: document.querySelector(".wc-scrubber")?.getAttribute("aria-label") || "",
    scrubberValueText: document.querySelector(".wc-scrubber")?.getAttribute("aria-valuetext") || "",
    overflowX: document.body.scrollWidth - document.body.clientWidth,
  }));

  if (
    moveState.fen === beforeFen ||
    !moveState.movedPiece.includes("red horse") ||
    moveState.timelineText !== "1 / 1" ||
    moveState.scrubberValue !== "1" ||
    moveState.scrubberValueText !== "Move 1 of 1 move" ||
    !moveState.scrubberLabel.includes("Move 1 of 1 move") ||
    moveState.overflowX > 2
  ) {
    throw new Error(`Board keyboard activation did not play the focused move: ${JSON.stringify(moveState)}`);
  }

  await page.locator('.watch-controls button[aria-label="Go to first position"]').click();
  const startTimelineState = await page.evaluate(() => ({
    timelineText: document.querySelector(".wc-meta strong")?.textContent?.trim() || "",
    scrubberValue: document.querySelector(".wc-scrubber")?.value || "",
    scrubberLabel: document.querySelector(".wc-scrubber")?.getAttribute("aria-label") || "",
    scrubberValueText: document.querySelector(".wc-scrubber")?.getAttribute("aria-valuetext") || "",
    overflowX: document.body.scrollWidth - document.body.clientWidth,
  }));
  if (
    startTimelineState.timelineText !== "Start / 1" ||
    startTimelineState.scrubberValue !== "0" ||
    startTimelineState.scrubberValueText !== "Start position, 0 of 1 move" ||
    !startTimelineState.scrubberLabel.includes("Start position, 0 of 1 move") ||
    startTimelineState.overflowX > 2
  ) {
    throw new Error(`Move timeline did not describe the start position: ${JSON.stringify(startTimelineState)}`);
  }

  const qualityLegendCount = await page.locator(".mtree-quality-legend").count();
  if (qualityLegendCount !== 0) {
    throw new Error("Move-loss legend appeared before the line had review or eval quality data.");
  }
}

async function assertBoardKeyboardNavigationFlipped(page) {
  await page.setViewportSize({ width: 1024, height: 720 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });

  await page.getByRole("button", { name: "Flip board orientation" }).click();

  const beforeFen = await page.locator(".bottombar-fen").getAttribute("title");
  await page.locator('.hitbox[data-file="1"][data-rank="0"]').focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");

  const focusState = await page.evaluate(() => ({
    file: document.activeElement?.getAttribute("data-file") || "",
    rank: document.activeElement?.getAttribute("data-rank") || "",
    label: document.activeElement?.getAttribute("aria-label") || "",
    shortcuts: document.activeElement?.getAttribute("aria-keyshortcuts") || "",
    overflowX: document.body.scrollWidth - document.body.clientWidth,
  }));

  if (
    focusState.file !== "2" ||
    focusState.rank !== "2" ||
    !focusState.label.includes("legal move") ||
    !focusState.shortcuts.includes("Enter") ||
    !focusState.shortcuts.includes("Space") ||
    !focusState.shortcuts.includes("ArrowDown") ||
    focusState.overflowX > 2
  ) {
    throw new Error(`Flipped board arrow-key navigation did not focus a legal target: ${JSON.stringify(focusState)}`);
  }

  await page.keyboard.press("Enter");
  await page.waitForFunction((fen) => {
    return document.querySelector(".bottombar-fen")?.getAttribute("title") !== fen;
  }, beforeFen, { timeout: 5000 });

  const moveState = await page.evaluate(() => ({
    fen: document.querySelector(".bottombar-fen")?.getAttribute("title") || "",
    movedPiece: document.querySelector('.hitbox[data-file="2"][data-rank="2"]')?.getAttribute("aria-label") || "",
    overflowX: document.body.scrollWidth - document.body.clientWidth,
  }));

  if (moveState.fen === beforeFen || !moveState.movedPiece.includes("red horse") || moveState.overflowX > 2) {
    throw new Error(`Flipped board keyboard activation did not play the focused move: ${JSON.stringify(moveState)}`);
  }
}

async function assertDesktopResizeFeedback(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });

  const handle = page.getByTestId("left-panel-resize-handle");
  const controlMeta = await page.evaluate(() => {
    const left = document.querySelector('[data-testid="left-panel-resize-handle"]');
    const right = document.querySelector('[data-testid="right-panel-resize-handle"]');
    const top = document.querySelector('[data-testid="top-bar-toggle-handle"]');
    const bottom = document.querySelector('[data-testid="bottom-bar-toggle-handle"]');
    return {
      leftRole: left?.getAttribute("role") || "",
      leftTabIndex: left?.getAttribute("tabindex") || "",
      leftLabel: left?.getAttribute("aria-label") || "",
      leftOrientation: left?.getAttribute("aria-orientation") || "",
      leftControls: left?.getAttribute("aria-controls") || "",
      leftValueNow: left?.getAttribute("aria-valuenow") || "",
      leftValueMax: left?.getAttribute("aria-valuemax") || "",
      leftTitle: left?.getAttribute("title") || "",
      rightRole: right?.getAttribute("role") || "",
      rightControls: right?.getAttribute("aria-controls") || "",
      topTag: top?.tagName || "",
      topLabel: top?.getAttribute("aria-label") || "",
      topExpanded: top?.getAttribute("aria-expanded") || "",
      bottomTag: bottom?.tagName || "",
      bottomLabel: bottom?.getAttribute("aria-label") || "",
      bottomExpanded: bottom?.getAttribute("aria-expanded") || "",
    };
  });
  if (
    controlMeta.leftRole !== "separator" ||
    controlMeta.leftTabIndex !== "0" ||
    !controlMeta.leftLabel.includes("Resize left graph and library panel") ||
    controlMeta.leftOrientation !== "vertical" ||
    controlMeta.leftControls !== "left-panel-content" ||
    controlMeta.leftValueNow !== "320" ||
    controlMeta.leftValueMax !== "600" ||
    !controlMeta.leftTitle.includes("Press arrow keys") ||
    controlMeta.rightRole !== "separator" ||
    controlMeta.rightControls !== "right-analysis-content" ||
    controlMeta.topTag !== "BUTTON" ||
    controlMeta.topLabel !== "Collapse top toolbar" ||
    controlMeta.topExpanded !== "true" ||
    controlMeta.bottomTag !== "BUTTON" ||
    controlMeta.bottomLabel !== "Collapse bottom command bar" ||
    controlMeta.bottomExpanded !== "true"
  ) {
    throw new Error(`Panel resize handles are not exposed as accessible controls: ${JSON.stringify(controlMeta)}`);
  }

  await handle.focus();
  await page.keyboard.press("ArrowLeft");
  await page.waitForFunction(() => {
    return Number(document.querySelector('[data-testid="left-panel-resize-handle"]')?.getAttribute("aria-valuenow") || 0) < 320;
  }, null, { timeout: 5000 });
  await page.keyboard.press("Home");
  await page.waitForFunction(() => {
    const handle = document.querySelector('[data-testid="left-panel-resize-handle"]');
    return handle?.getAttribute("aria-valuenow") === "0" && (handle.getAttribute("aria-label") || "").includes("Expand left graph and library panel");
  }, null, { timeout: 5000 });
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => {
    const handle = document.querySelector('[data-testid="left-panel-resize-handle"]');
    return handle?.getAttribute("aria-valuenow") === "320" && (handle.getAttribute("aria-label") || "").includes("Resize left graph and library panel");
  }, null, { timeout: 5000 });

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

async function assertIllegalMoveShowsRuleHint(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });

  const beforeFen = await page.locator(".bottombar-fen").getAttribute("title");
  await page.locator('.hitbox[data-file="1"][data-rank="0"]').click();
  await page.locator('.hitbox[data-file="1"][data-rank="3"]').click();
  await page.waitForFunction(() => {
    const hint = document.querySelector(".position-stat-selection em")?.textContent?.trim() || "";
    return /Horse moves one point straight, then one point diagonal/i.test(hint);
  }, null, { timeout: 5000 });

  const illegalState = await page.evaluate(() => ({
    fen: document.querySelector(".bottombar-fen")?.getAttribute("title") || "",
    hint: document.querySelector(".position-stat-selection em")?.textContent?.trim() || "",
    warningClass: document.querySelector(".position-stat-selection em")?.classList.contains("position-warning") || false,
    overflowX: document.body.scrollWidth - document.body.clientWidth,
  }));
  if (illegalState.fen !== beforeFen || !illegalState.warningClass || illegalState.overflowX > 2) {
    throw new Error(`Illegal move hint failed: ${JSON.stringify(illegalState)}`);
  }

  await page.locator('.hitbox[data-file="0"][data-rank="0"]').click();
  await page.locator('.hitbox[data-file="1"][data-rank="1"]').click();
  await page.waitForFunction(() => {
    const hint = document.querySelector(".position-stat-selection em")?.textContent?.trim() || "";
    return /Chariot moves in straight lines/i.test(hint);
  }, null, { timeout: 5000 });

  const chariotHintState = await page.evaluate(() => ({
    fen: document.querySelector(".bottombar-fen")?.getAttribute("title") || "",
    hint: document.querySelector(".position-stat-selection em")?.textContent?.trim() || "",
    overflowX: document.body.scrollWidth - document.body.clientWidth,
  }));
  if (chariotHintState.fen !== beforeFen || /rook/i.test(chariotHintState.hint) || chariotHintState.overflowX > 2) {
    throw new Error(`Chariot rule hint leaked chess wording: ${JSON.stringify(chariotHintState)}`);
  }

  await page.locator('.hitbox[data-file="1"][data-rank="0"]').click();
  await page.locator('.hitbox[data-file="2"][data-rank="2"]').click();
  await page.waitForFunction((fen) => {
    return document.querySelector(".bottombar-fen")?.getAttribute("title") !== fen;
  }, beforeFen, { timeout: 5000 });

  const clearedHint = await page.locator(".position-stat-selection em").textContent();
  if (/Horse moves one point straight, then one point diagonal|Chariot moves in straight lines/i.test(clearedHint || "")) {
    throw new Error("Illegal move hint did not clear after a legal move.");
  }

  await page.evaluate(() => {
    localStorage.setItem("xiangqi:preferences:v1", JSON.stringify({ assistMode: "pro" }));
  });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });

  const proBeforeFen = await page.locator(".bottombar-fen").getAttribute("title");
  await page.locator('.hitbox[data-file="1"][data-rank="0"]').click();
  await page.locator('.hitbox[data-file="1"][data-rank="3"]').click();
  await page.waitForFunction(() => {
    const hint = document.querySelector(".position-stat-selection em");
    const hintText = hint?.textContent?.trim() || "";
    return !!hint && /Horse moves one point straight, then one point diagonal/i.test(hintText) && getComputedStyle(hint).display !== "none";
  }, null, { timeout: 5000 });

  const proIllegalState = await page.evaluate(() => {
    const hint = document.querySelector(".position-stat-selection em");
    const hintRect = hint?.getBoundingClientRect();
    return {
      assistMode: document.querySelector(".app-shell")?.getAttribute("data-assist-mode") || "",
      fen: document.querySelector(".bottombar-fen")?.getAttribute("title") || "",
      hint: hint?.textContent?.trim() || "",
      display: hint ? getComputedStyle(hint).display : "",
      visibleHeight: hintRect?.height || 0,
      warningClass: hint?.classList.contains("position-warning") || false,
      overflowX: document.body.scrollWidth - document.body.clientWidth,
    };
  });
  if (
    proIllegalState.assistMode !== "pro" ||
    proIllegalState.fen !== proBeforeFen ||
    !/Horse moves one point straight, then one point diagonal/i.test(proIllegalState.hint) ||
    proIllegalState.display === "none" ||
    proIllegalState.visibleHeight <= 0 ||
    !proIllegalState.warningClass ||
    proIllegalState.overflowX > 2
  ) {
    throw new Error(`Pro illegal move hint failed: ${JSON.stringify(proIllegalState)}`);
  }

  await page.evaluate(() => localStorage.removeItem("xiangqi:preferences:v1"));
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
  await page.waitForFunction(() => {
    return /Engine ready/i.test(document.querySelector(".top-engine-state")?.getAttribute("aria-label") || "");
  }, null, { timeout: 45000 });

  const state = await page.evaluate(() => ({
    workspace: document.querySelector(".top-mode-pills .gc-pill-active")?.textContent?.trim() || "",
    engineText: document.querySelector(".top-engine-state")?.textContent?.trim() || "",
    engineRole: document.querySelector(".top-engine-state")?.getAttribute("role") || "",
    engineLabel: document.querySelector(".top-engine-state")?.getAttribute("aria-label") || "",
    overflowX: document.body.scrollWidth - document.body.clientWidth,
  }));
  if (state.workspace !== "Play") {
    throw new Error(`AI engine status setup did not switch to Play workspace: ${state.workspace}`);
  }
  if (!state.engineText) {
    throw new Error("AI Play mode hid the engine status.");
  }
  if (
    state.engineRole !== "status" ||
    !state.engineLabel ||
    !/Engine ready\s*·\s*\S+/i.test(state.engineText) ||
    /readysingle|enginesingle/i.test(`${state.engineText} ${state.engineLabel}`)
  ) {
    throw new Error(`AI engine status was not announced cleanly: ${JSON.stringify(state)}`);
  }
  if (state.overflowX > 2) {
    throw new Error(`AI Play mode introduced horizontal overflow: ${state.overflowX}`);
  }

  const fastSpeedButton = page.getByRole("button", { name: "Set speed to Fast", exact: true });
  const fastSpeedCount = await fastSpeedButton.count();
  if (fastSpeedCount !== 1) {
    throw new Error(`Expected one Fast speed button, found ${fastSpeedCount}`);
  }
  await fastSpeedButton.click();
  const speedA11y = await page.evaluate(() => {
    const speedGroup = document.querySelector(".wc-speed");
    const labelledBy = speedGroup?.getAttribute("aria-labelledby") || "";
    const labelText = labelledBy
      ? document.getElementById(labelledBy)?.textContent?.trim() || ""
      : "";
    const pressed = (name) => [...document.querySelectorAll(".wc-speed-pill")]
      .find((button) => button.textContent?.trim() === name)
      ?.getAttribute("aria-pressed") || "";
    return {
      groupRole: speedGroup?.getAttribute("role") || "",
      groupLabel: labelText,
      normalPressed: pressed("Normal"),
      fastPressed: pressed("Fast"),
      stepPressed: pressed("Step"),
      scrubberValueText: document.querySelector(".wc-scrubber")?.getAttribute("aria-valuetext") || "",
      overflowX: document.body.scrollWidth - document.body.clientWidth,
    };
  });
  if (
    speedA11y.groupRole !== "group" ||
    speedA11y.groupLabel !== "Speed" ||
    speedA11y.normalPressed !== "false" ||
    speedA11y.fastPressed !== "true" ||
    speedA11y.stepPressed !== "false" ||
    speedA11y.scrubberValueText !== "No moves" ||
    speedA11y.overflowX > 2
  ) {
    throw new Error(`AI playback controls are not fully accessible: ${JSON.stringify(speedA11y)}`);
  }

  const pauseAiButton = page.getByRole("button", { name: "Pause AI game", exact: true });
  const pauseAiButtonCount = await pauseAiButton.count();
  if (pauseAiButtonCount !== 1) {
    throw new Error(`Expected one AI pause button, found ${pauseAiButtonCount}`);
  }
  await pauseAiButton.click();
  const pausedA11y = await page.evaluate(() => {
    const status = document.querySelector(".board-ai-status");
    return {
      role: status?.getAttribute("role") || "",
      live: status?.getAttribute("aria-live") || "",
      label: status?.getAttribute("aria-label") || "",
      text: status?.textContent?.replace(/\s+/g, " ").trim() || "",
      overflowX: document.body.scrollWidth - document.body.clientWidth,
    };
  });
  if (
    pausedA11y.role !== "status" ||
    pausedA11y.live !== "polite" ||
    pausedA11y.label !== "AI paused" ||
    !/AI Paused/.test(pausedA11y.text) ||
    pausedA11y.overflowX > 2
  ) {
    throw new Error(`Paused AI board status is not announced cleanly: ${JSON.stringify(pausedA11y)}`);
  }
}

async function assertAiNewGameSwitchesToPlayWorkspace(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });

  await page.getByRole("button", { name: "Start new game" }).click();
  await page.getByRole("button", { name: /You play Black/i }).click();
  await page.getByRole("button", { name: "Start Fresh Board", exact: true }).click();
  await page.locator(".new-game-menu").waitFor({ state: "detached", timeout: 5000 });

  const state = await page.evaluate(() => ({
    workspace: document.querySelector(".top-mode-pills .gc-pill-active")?.textContent?.trim() || "",
    aiControls: Boolean(document.querySelector(".board-ai-status")),
    overflowX: document.body.scrollWidth - document.body.clientWidth,
  }));
  if (state.workspace !== "Play" || !state.aiControls || state.overflowX > 2) {
    throw new Error(`AI New Game did not enter Play workspace cleanly: ${JSON.stringify(state)}`);
  }
}

async function assertBeginnerAiUsesCandidatePv(browser) {
  const { context, page } = await newIsolatedPage(browser);
  try {
    await installFakePikafish(page, {
      variant: "fake-pv",
      setupSource: "Math.random = () => 0.99;",
      goSource: `
        setTimeout(() => {
          emit("info depth 2 multipv 1 score cp 50 pv h0g2");
          emit("info depth 2 multipv 2 score cp 10 pv b0c2");
          emit("bestmove h0g2");
        }, 20);
      `,
    });

    await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForSelector(".xiangqi-board", { timeout: 30000 });
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await page.getByRole("button", { name: "Start new game" }).click();
    await page.getByRole("button", { name: /You play Black/i }).click();
    await page.getByRole("button", { name: /Beginner: depth 2/i }).click();
    await page.getByRole("button", { name: "Start Fresh Board", exact: true }).click();
    await page.locator(".new-game-menu").waitFor({ state: "detached", timeout: 5000 });
    await page.waitForFunction(() => {
      const text = document.querySelector(".mtree-row")?.textContent || "";
      return text.includes("b0c2");
    }, null, { timeout: 10000 });

    const state = await page.evaluate(() => ({
      commands: window.__engineCommands || [],
      firstMove: document.querySelector(".mtree-row")?.textContent?.trim() || "",
      fen: document.querySelector(".bottombar-fen")?.getAttribute("title") || "",
      overflowX: document.body.scrollWidth - document.body.clientWidth,
    }));
    const multiPvIndex = state.commands.findIndex((command) => command === "setoption name MultiPV value 5");
    const goIndex = state.commands.findIndex((command) => command === "go depth 2");
    if (multiPvIndex < 0 || goIndex < 0 || multiPvIndex > goIndex) {
      throw new Error(`Beginner AI did not configure candidate PVs before searching: ${JSON.stringify(state.commands)}`);
    }
    if (!state.firstMove.includes("b0c2") || !state.fen.includes(" b ") || state.overflowX > 2) {
      throw new Error(`Beginner AI did not pick the tested candidate move cleanly: ${JSON.stringify(state)}`);
    }
  } finally {
    await context.close();
  }
}

async function assertAnalysisWorkspaceDoesNotAutoPlayAi(browser) {
  const { context, page } = await newIsolatedPage(browser);
  try {
    await installFakePikafish(page, {
      variant: "fake-analysis-ai-guard",
      goSource: `
        setTimeout(() => {
          emit("info depth 2 multipv 1 score cp 42 pv h0g2");
          emit("bestmove h0g2");
        }, 20);
      `,
    });

    const startFen = encodeURIComponent(
      "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1"
    );
    await page.goto(`http://127.0.0.1:8192/web-xiangqi/?mode=PvAI-Red&fen=${startFen}`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForSelector(".xiangqi-board", { timeout: 30000 });
    await page.waitForFunction(() => {
      const commands = window.__engineCommands || [];
      return commands.some((command) => /^go\b/.test(command));
    }, null, { timeout: 10000 });
    await page.waitForTimeout(400);

    const state = await page.evaluate(() => {
      const commands = window.__engineCommands || [];
      return {
        commands,
        plainAiGoCommands: commands.filter((command) => /^go depth \d+$/.test(command)),
        analysisGoCommands: commands.filter((command) => /^go depth \d+ movetime \d+$/.test(command)),
        workspace: document.querySelector(".top-mode-pills .gc-pill-active")?.textContent?.trim() || "",
        fen: document.querySelector(".bottombar-fen")?.getAttribute("title") || "",
        moveRows: document.querySelectorAll(".mtree-row").length,
        aiStatusVisible: Boolean(document.querySelector(".board-ai-status")),
        watchAiControlsVisible: Boolean(document.querySelector(".wc-play") || document.querySelector(".wc-speed")),
        overflowX: document.body.scrollWidth - document.body.clientWidth,
      };
    });

    if (
      state.workspace !== "Analysis" ||
      !state.fen.includes(" w ") ||
      state.moveRows !== 0 ||
      state.plainAiGoCommands.length > 0 ||
      state.analysisGoCommands.length === 0 ||
      state.aiStatusVisible ||
      state.watchAiControlsVisible ||
      state.overflowX > 2
    ) {
      throw new Error(`Analysis workspace auto-played or exposed AI controls: ${JSON.stringify(state)}`);
    }
  } finally {
    await context.close();
  }
}

async function assertEngineLoaderFailureShowsNotice(browser) {
  const { context, page } = await newIsolatedPage(browser);
  try {
    await page.route("**/pikafish.js", (route) => route.abort("failed"));
    await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForSelector(".xiangqi-board", { timeout: 30000 });
    await page.waitForFunction(() => {
      const text = document.querySelector(".top-engine-state")?.textContent?.trim() || "";
      return text && !/Loading engine/i.test(text);
    }, null, { timeout: 10000 });

    const state = await page.evaluate(() => ({
      engineText: document.querySelector(".top-engine-state")?.textContent?.trim() || "",
      overflowX: document.body.scrollWidth - document.body.clientWidth,
    }));
    if (!/Recovering engine|Engine paused after crashes/i.test(state.engineText)) {
      throw new Error(`Engine loader failure did not surface a recovery notice: ${JSON.stringify(state)}`);
    }
    if (state.overflowX > 2) {
      throw new Error(`Engine loader failure notice introduced horizontal overflow: ${state.overflowX}`);
    }
  } finally {
    await context.close();
  }
}

async function assertEngineReadyTimeoutShowsNotice(browser) {
  const { context, page } = await newIsolatedPage(browser);
  try {
    await installFakePikafish(page, { variant: "fake-stall-ready" });
    await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForSelector(".xiangqi-board", { timeout: 30000 });
    await page.waitForFunction(() => {
      const text = document.querySelector(".top-engine-state")?.textContent?.trim() || "";
      return /Recovering engine|Engine paused after crashes/i.test(text);
    }, null, { timeout: 5000 });
    await page.getByTestId("analysis-tab-review").click();

    const state = await page.evaluate(() => ({
      engineText: document.querySelector(".top-engine-state")?.textContent?.trim() || "",
      bottomEngineText: document.querySelector(".bottom-engine-info")?.textContent?.trim() || "",
      reviewStartText: document.querySelector('[data-testid="start-review-btn"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
      reviewStartTitle: document.querySelector('[data-testid="start-review-btn"]')?.getAttribute("title") || "",
      reviewStartLabel: document.querySelector('[data-testid="start-review-btn"]')?.getAttribute("aria-label") || "",
      commands: window.__engineCommands || [],
      overflowX: document.body.scrollWidth - document.body.clientWidth,
    }));
    if (!/Recovering engine|Engine paused after crashes/i.test(state.engineText)) {
      throw new Error(`Stalled engine handshake did not surface a recovery notice: ${JSON.stringify(state)}`);
    }
    if (!/Recovering engine|Engine paused after crashes/i.test(state.bottomEngineText)) {
      throw new Error(`Stalled engine handshake left the bottom status stale: ${JSON.stringify(state)}`);
    }
    if (
      state.reviewStartText !== "No Moves Yet" ||
      state.reviewStartTitle !== "Play or import moves before running review" ||
      state.reviewStartLabel !== "Game review unavailable: Play or import moves before running review"
    ) {
      throw new Error(`Empty review did not prioritize the actionable no-moves reason: ${JSON.stringify(state)}`);
    }
    if (!state.commands.includes("uci") || !state.commands.includes("isready")) {
      throw new Error(`Stalled engine handshake did not reach the UCI readiness phase: ${JSON.stringify(state.commands)}`);
    }
    if (state.overflowX > 2) {
      throw new Error(`Stalled engine recovery notice introduced horizontal overflow: ${state.overflowX}`);
    }

    await page.getByRole("button", { name: "Start new game" }).click();
    await page.getByTestId("uci-line-input").fill('[Variant "Xiangqi"]\n1. b2e2');
    await page.getByTestId("import-uci-line-btn").click();
    await page.getByTestId("start-review-bottom-btn").waitFor({ timeout: 5000 });

    const bottomState = await page.evaluate(() => ({
      text: document.querySelector('[data-testid="start-review-bottom-btn"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
      title: document.querySelector('[data-testid="start-review-bottom-btn"]')?.getAttribute("title") || "",
      label: document.querySelector('[data-testid="start-review-bottom-btn"]')?.getAttribute("aria-label") || "",
      disabled: Boolean(document.querySelector('[data-testid="start-review-bottom-btn"]')?.disabled),
      overflowX: document.body.scrollWidth - document.body.clientWidth,
    }));
    if (
      !bottomState.disabled ||
      !/Recovering Engine|Engine Paused/.test(bottomState.text) ||
      !/Recovering engine|Engine paused after crashes/.test(bottomState.title) ||
      !/Game review unavailable: (Recovering engine|Engine paused after crashes)/.test(bottomState.label) ||
      bottomState.overflowX > 2
    ) {
      throw new Error(`Bottom review action did not explain stalled engine state: ${JSON.stringify(bottomState)}`);
    }
  } finally {
    await context.close();
  }
}

async function assertEngineCreateTimeoutShowsNotice(browser) {
  const { context, page } = await newIsolatedPage(browser);
  try {
    await installFakePikafish(page, { variant: "fake-create-hangs" });
    await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForSelector(".xiangqi-board", { timeout: 30000 });
    await page.waitForFunction(() => {
      const text = document.querySelector(".top-engine-state")?.textContent?.trim() || "";
      return /Recovering engine|Engine paused after crashes/i.test(text);
    }, null, { timeout: 5000 });

    const state = await page.evaluate(() => ({
      engineText: document.querySelector(".top-engine-state")?.textContent?.trim() || "",
      commands: window.__engineCommands || [],
      options: window.__createWorkerEngineOptions || [],
      overflowX: document.body.scrollWidth - document.body.clientWidth,
    }));
    if (!/Recovering engine|Engine paused after crashes/i.test(state.engineText)) {
      throw new Error(`Hanging engine constructor did not surface a recovery notice: ${JSON.stringify(state)}`);
    }
    if (state.commands.length !== 0) {
      throw new Error(`Hanging engine constructor should not have reached UCI commands: ${JSON.stringify(state.commands)}`);
    }
    if (!state.options.some((option) => option.initTimeoutMs === 120)) {
      throw new Error(`Hanging engine constructor did not receive the app boot timeout: ${JSON.stringify(state.options)}`);
    }
    if (state.overflowX > 2) {
      throw new Error(`Hanging engine constructor notice introduced horizontal overflow: ${state.overflowX}`);
    }
  } finally {
    await context.close();
  }
}

async function assertAnalysisResumesAfterVisibilityReturn(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  try {
    await page.addInitScript(() => {
      let qaDocumentHidden = true;
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => qaDocumentHidden,
      });
      window.__webXiangqiSetHiddenForQa = (hidden) => {
        qaDocumentHidden = Boolean(hidden);
        document.dispatchEvent(new Event("visibilitychange"));
      };
    });

    await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForSelector(".xiangqi-board", { timeout: 30000 });
    await page.getByTestId("analysis-tab-engine").click();
    await page.waitForFunction(() => {
      const text = document.querySelector(".top-engine-state")?.textContent?.trim() || "";
      return /Engine ready/i.test(text);
    }, null, { timeout: 25000 });

    const hiddenState = await page.evaluate(() => ({
      pvLineCount: document.querySelectorAll('[data-testid^="play-engine-pv-"]').length,
      emptyText: document.querySelector(".pv-lines-container")?.textContent?.trim() || "",
      coachText: document.querySelector(".engine-coach-summary")?.textContent?.replace(/\s+/g, " ").trim() || "",
    }));
    if (
      hiddenState.pvLineCount !== 0 ||
      !hiddenState.emptyText.includes("No PV available yet") ||
      !hiddenState.coachText.includes("BestNo engine move yet") ||
      !hiddenState.coachText.includes("LineNo engine line yet")
    ) {
      throw new Error(`Hidden analysis unexpectedly searched before visibility returned: ${JSON.stringify(hiddenState)}`);
    }

    await page.evaluate(() => window.__webXiangqiSetHiddenForQa(false));
    await page.getByTestId("play-engine-pv-0").waitFor({ timeout: 25000 });

    const resumedState = await page.evaluate(() => ({
      pvLineCount: document.querySelectorAll('[data-testid^="play-engine-pv-"]').length,
      overflowX: document.body.scrollWidth - document.body.clientWidth,
    }));
    if (resumedState.pvLineCount < 1) {
      throw new Error(`Analysis did not resume after visibility returned: ${JSON.stringify(resumedState)}`);
    }
    if (resumedState.overflowX > 2) {
      throw new Error(`Visibility-return analysis introduced horizontal overflow: ${resumedState.overflowX}`);
    }
  } finally {
    await page.close();
  }
}

async function assertAiPlayPausesWhileHidden(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  try {
    await page.addInitScript(() => {
      let qaDocumentHidden = true;
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => qaDocumentHidden,
      });
      window.__webXiangqiSetHiddenForQa = (hidden) => {
        qaDocumentHidden = Boolean(hidden);
        document.dispatchEvent(new Event("visibilitychange"));
      };
    });

    await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForSelector(".xiangqi-board", { timeout: 30000 });
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await page.getByRole("button", { name: "Start new game" }).click();
    await page.getByRole("button", { name: /You play Black/i }).click();
    await page.getByRole("button", { name: "Start Fresh Board", exact: true }).click();
    await page.locator(".new-game-menu").waitFor({ state: "detached", timeout: 5000 });
    await page.waitForFunction(() => {
      const text = document.querySelector(".top-engine-state")?.textContent?.trim() || "";
      return /Engine ready/i.test(text);
    }, null, { timeout: 25000 });
    await page.waitForTimeout(1800);

    const hiddenState = await page.evaluate(() => ({
      fen: document.querySelector(".bottombar-fen")?.getAttribute("title") || "",
      aiStatus: document.querySelector(".board-ai-status")?.textContent?.replace(/\s+/g, " ").trim() || "",
      moveText: document.querySelector(".wc-scrubber")?.textContent?.replace(/\s+/g, " ").trim() || "",
      overflowX: document.body.scrollWidth - document.body.clientWidth,
    }));
    if (!hiddenState.fen.includes(" w ") || /Thinking/i.test(hiddenState.aiStatus) || hiddenState.overflowX > 2) {
      throw new Error(`Hidden AI play started a search or move: ${JSON.stringify(hiddenState)}`);
    }

    await page.evaluate(() => window.__webXiangqiSetHiddenForQa(false));
    await page.waitForFunction(() => {
      const fen = document.querySelector(".bottombar-fen")?.getAttribute("title") || "";
      return Boolean(fen && !fen.includes(" w "));
    }, null, { timeout: 30000 });

    const visibleState = await page.evaluate(() => ({
      fen: document.querySelector(".bottombar-fen")?.getAttribute("title") || "",
      graphPoint: document.querySelector('[data-testid="graph-current-point"]')?.textContent?.trim() || "",
      overflowX: document.body.scrollWidth - document.body.clientWidth,
    }));
    if (!visibleState.fen.includes(" b ") || visibleState.overflowX > 2) {
      throw new Error(`AI play did not resume cleanly after visibility returned: ${JSON.stringify(visibleState)}`);
    }
  } finally {
    await page.close();
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
    buttonLabels: [1, 3, 5].map((count) => document.querySelector(`[data-testid="engine-pv-lines-${count}"]`)?.getAttribute("aria-label") || ""),
    buttonTitles: [1, 3, 5].map((count) => document.querySelector(`[data-testid="engine-pv-lines-${count}"]`)?.getAttribute("title") || ""),
  }));
  if (
    !initial.detail.includes("MultiPV 3") ||
    !initial.detail.includes("WDL on") ||
    initial.active !== "true" ||
    initial.buttonLabels.join("|") !== [
      "Set principal variation lines to 1, fastest best-move search",
      "Set principal variation lines to 3, compare main candidates",
      "Set principal variation lines to 5, broad option scan",
    ].join("|") ||
    initial.buttonTitles.join("|") !== [
      "Show 1 engine line for the fastest best-move search.",
      "Show 3 engine lines to compare main candidate moves.",
      "Show 5 engine lines for a broader option scan. This uses more engine time.",
    ].join("|")
  ) {
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

  await page.getByTestId("restart-engine-btn").waitFor({ timeout: 5000 });
  const runtimeState = await page.evaluate(() => {
    const restart = document.querySelector('[data-testid="restart-engine-btn"]');
    const clear = document.querySelector('[data-testid="clear-engine-hash-btn"]');
    return {
      restartText: restart?.textContent?.replace(/\s+/g, " ").trim() || "",
      restartLabel: restart?.getAttribute("aria-label") || "",
      restartTitle: restart?.getAttribute("title") || "",
      restartDisabled: restart?.disabled ?? null,
      clearLabel: clear?.getAttribute("aria-label") || "",
      overflowX: document.body.scrollWidth - document.body.clientWidth,
    };
  });
  if (
    runtimeState.restartText !== "Restart" ||
    runtimeState.restartLabel !== "Restart engine" ||
    runtimeState.restartTitle !== "Restart the engine worker" ||
    runtimeState.restartDisabled ||
    runtimeState.clearLabel !== "Clear engine hash table"
  ) {
    throw new Error(`Engine runtime controls are not accessible: ${JSON.stringify(runtimeState)}`);
  }
  if (runtimeState.overflowX > 2) {
    throw new Error(`Engine runtime controls introduced horizontal overflow: ${runtimeState.overflowX}`);
  }

  await page.getByTestId("restart-engine-btn").click();
  await page.waitForFunction(() => {
    return /Engine ready/i.test(document.querySelector(".top-engine-state")?.getAttribute("aria-label") || "");
  }, null, { timeout: 30000 });

  await page.getByTestId("clear-engine-hash-btn").waitFor({ timeout: 5000 });
  await page.waitForFunction(() => {
    const button = document.querySelector('[data-testid="clear-engine-hash-btn"]');
    return button && !button.disabled;
  }, null, { timeout: 15000 });
  await page.getByTestId("clear-engine-hash-btn").click();
  await page.waitForFunction(() => {
    const button = document.querySelector('[data-testid="clear-engine-hash-btn"]');
    const text = button?.textContent?.trim() || "";
    const label = button?.getAttribute("aria-label") || "";
    return (
      (text === "Cleared" && label === "Engine hash cleared") ||
      (text === "Clear Hash" && label === "Clear engine hash table")
    );
  }, null, { timeout: 15000 });
  const cacheState = await page.evaluate(() => {
    const button = document.querySelector('[data-testid="clear-engine-hash-btn"]');
    return {
      text: button?.textContent?.trim() || "",
      label: button?.getAttribute("aria-label") || "",
      disabled: button?.disabled ?? null,
      overflowX: document.body.scrollWidth - document.body.clientWidth,
    };
  });
  if (
    !(
      (cacheState.text === "Cleared" && cacheState.label === "Engine hash cleared") ||
      (cacheState.text === "Clear Hash" && cacheState.label === "Clear engine hash table")
    ) ||
    cacheState.disabled
  ) {
    throw new Error(`Clear Hash control did not show successful feedback: ${JSON.stringify(cacheState)}`);
  }
  if (cacheState.overflowX > 2) {
    throw new Error(`Clear Hash control introduced horizontal overflow: ${cacheState.overflowX}`);
  }
}

async function assertEngineTelemetryDashboard(browser) {
  const { context, page } = await newIsolatedPage(browser);
  try {
    await installFakePikafish(page, { variant: "fake-telemetry" });
    await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForSelector(".xiangqi-board", { timeout: 30000 });
    await page.getByTestId("analysis-tab-engine").click();
    await page.waitForFunction(() => {
      const searchCard = [...document.querySelectorAll(".engine-stat")]
        .map((el) => el.textContent?.replace(/\s+/g, " ").trim() || "")
        .find((text) => text.includes("Search")) || "";
      const searchDetail = [...document.querySelectorAll(".engine-stat")]
        .map((el) => `${el.getAttribute("aria-label") || ""} ${el.getAttribute("title") || ""}`)
        .find((text) => text.includes("Search D8/S12")) || "";
      const pvText = document.querySelector(".pv-lines-container")?.textContent?.replace(/\s+/g, " ").trim() || "";
      return searchCard.includes("D8/S12") &&
        searchCard.includes("789k nps") &&
        searchCard.includes("hash 2%") &&
        searchDetail.includes("123k nodes") &&
        searchDetail.includes("156ms") &&
        /Line 1\s*Best/.test(pvText) &&
        pvText.includes("B2→E2");
    }, null, { timeout: 15000 });

    const telemetry = await page.evaluate(() => {
      const searchCard = [...document.querySelectorAll(".engine-stat")]
        .map((el) => el.textContent?.replace(/\s+/g, " ").trim() || "")
        .find((text) => text.includes("Search")) || "";
      return {
        searchCard,
        searchDetail: [...document.querySelectorAll(".engine-stat")]
          .map((el) => `${el.getAttribute("aria-label") || ""} ${el.getAttribute("title") || ""}`)
          .find((text) => text.includes("Search D8/S12")) || "",
        firstLineLabel: document.querySelector(".pv-line")?.getAttribute("aria-label") || "",
        firstScoreLabel: document.querySelector('[data-testid="engine-pv-score-0"]')?.getAttribute("aria-label") || "",
        firstScoreTitle: document.querySelector('[data-testid="engine-pv-score-0"]')?.getAttribute("title") || "",
        firstScoreText: document.querySelector('[data-testid="engine-pv-score-0"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
        stageEvalText: document.querySelector(".board-stage-chip-eval")?.textContent?.replace(/\s+/g, " ").trim() || "",
        stageEvalLabel: document.querySelector(".board-stage-chip-eval")?.getAttribute("aria-label") || "",
        firstLineActionsLabel: document.querySelector(".pv-line-actions")?.getAttribute("aria-label") || "",
        playLineLabel: document.querySelector('[data-testid="play-engine-pv-0"]')?.getAttribute("aria-label") || "",
        playLineTitle: document.querySelector('[data-testid="play-engine-pv-0"]')?.getAttribute("title") || "",
        copyLineLabel: document.querySelector('[data-testid="copy-engine-pv-0"]')?.getAttribute("aria-label") || "",
        copyLineTitle: document.querySelector('[data-testid="copy-engine-pv-0"]')?.getAttribute("title") || "",
        pvText: document.querySelector(".pv-lines-container")?.textContent?.replace(/\s+/g, " ").trim() || "",
        wdlLabel: document.querySelector(".wdl-bar")?.getAttribute("aria-label") || "",
        wdlTitle: document.querySelector(".wdl-bar")?.getAttribute("title") || "",
        wdlText: document.querySelector(".wdl-labels")?.textContent?.replace(/\s+/g, " ").trim() || "",
        overflowX: document.body.scrollWidth - document.body.clientWidth,
      };
    });

    if (
      !telemetry.searchCard.includes("D8/S12") ||
      !telemetry.searchCard.includes("789k nps") ||
      !telemetry.searchCard.includes("hash 2%") ||
      !telemetry.searchDetail.includes("123k nodes") ||
      !telemetry.searchDetail.includes("156ms") ||
      !/Engine line 1, Best/.test(telemetry.firstLineLabel) ||
      !telemetry.firstLineLabel.includes("Red POV score +0.4") ||
      telemetry.firstScoreLabel !== "Red POV score +0.4" ||
      telemetry.firstScoreTitle !== "Red POV score +0.4" ||
      telemetry.firstScoreText !== "+0Red POV" ||
      telemetry.stageEvalText !== "Red POV +0.4" ||
      telemetry.stageEvalLabel !== "Live engine evaluation, Red POV +0.4" ||
      !telemetry.firstLineLabel.includes("depth 8") ||
      !telemetry.firstLineLabel.includes("moves B2→E2 H9→G7") ||
      telemetry.firstLineActionsLabel !== "Actions for engine line 1, depth 8, moves B2→E2 H9→G7" ||
      telemetry.playLineLabel !== "Play B2→E2 from engine line 1" ||
      telemetry.playLineTitle !== "Play B2→E2 from this engine line" ||
      telemetry.copyLineLabel !== "Copy engine line 1: B2→E2 H9→G7" ||
      telemetry.copyLineTitle !== "Copy this engine line as raw UCI moves: B2→E2 H9→G7" ||
      !/Line 1\s*Best/.test(telemetry.pvText) ||
      !telemetry.pvText.includes("B2→E2") ||
      telemetry.wdlLabel !== "Win/draw/loss estimate: Red 41.0%, Draw 23.0%, Black 36.0%" ||
      telemetry.wdlTitle !== telemetry.wdlLabel ||
      telemetry.wdlText !== "Red 41.0%Draw 23.0%Black 36.0%" ||
      telemetry.overflowX > 2
    ) {
      throw new Error(`Engine telemetry dashboard did not render UCI search stats: ${JSON.stringify(telemetry)}`);
    }

    await page.getByTestId("engine-pv-line-0").focus();
    await page.waitForFunction(() => {
      return document.querySelector('[data-testid="engine-pv-line-0"]')?.getAttribute("data-spotlight") === "true" &&
        Boolean(document.querySelector('[data-testid^="board-arrow-engine-focus"]'));
    }, null, { timeout: 5000 });
    await page.getByTestId("copy-engine-pv-0").focus();
    const spotlight = await page.evaluate(() => {
      const line = document.querySelector('[data-testid="engine-pv-line-0"]');
      const arrow = document.querySelector('[data-testid^="board-arrow-engine-focus"]');
      return {
        role: line?.getAttribute("role") || "",
        tabIndex: line?.getAttribute("tabindex") || "",
        spotlight: line?.getAttribute("data-spotlight") || "",
        arrowFrom: arrow?.getAttribute("data-from") || "",
        arrowTo: arrow?.getAttribute("data-to") || "",
        overflowX: document.body.scrollWidth - document.body.clientWidth,
      };
    });
    if (
      spotlight.role !== "group" ||
      spotlight.tabIndex !== "0" ||
      spotlight.spotlight !== "true" ||
      spotlight.arrowFrom !== "1:2" ||
      spotlight.arrowTo !== "4:2" ||
      spotlight.overflowX > 2
    ) {
      throw new Error(`Engine PV spotlight did not keep candidate focus visible: ${JSON.stringify(spotlight)}`);
    }

    await page.locator('.hitbox[data-file="1"][data-rank="2"]').click();
    await page.locator('.hitbox[data-file="4"][data-rank="2"]').click();
    await page.waitForFunction(() => {
      const fen = document.querySelector(".bottombar-fen")?.getAttribute("title") || "";
      const pvText = document.querySelector(".pv-lines-container")?.textContent?.replace(/\s+/g, " ").trim() || "";
      const searchCard = [...document.querySelectorAll(".engine-stat")]
        .map((el) => el.textContent?.replace(/\s+/g, " ").trim() || "")
        .find((text) => text.includes("Search")) || "";
      const bottomStatus = document.querySelector(".bottom-engine-info")?.textContent?.replace(/\s+/g, " ").trim() || "";
      const clearTitle = document.querySelector('[data-testid="clear-engine-hash-btn"]')?.getAttribute("title") || "";
      return (window.__goCount || 0) >= 2 &&
        fen.includes(" b ") &&
        !fen.includes("1C5C1/9/RNBAKABNR w ") &&
        pvText.includes("No PV available yet") &&
        /Queued|Pending/.test(searchCard) &&
        /Queued|Analyzing/.test(bottomStatus) &&
        clearTitle.includes("current search") &&
        searchCard.includes("target D8") &&
        !searchCard.includes("789k nps") &&
        !searchCard.includes("hash 2%");
    }, null, { timeout: 5000 });

    const clearHashCommandsBefore = await page.evaluate(() => {
      return (window.__engineCommands || []).filter((cmd) => cmd === "setoption name Clear Hash").length;
    });
    await page.getByTestId("clear-engine-hash-btn").click();
    const queuedHashState = await page.evaluate((beforeCount) => {
      const button = document.querySelector('[data-testid="clear-engine-hash-btn"]');
      return {
        text: button?.textContent?.replace(/\s+/g, " ").trim() || "",
        label: button?.getAttribute("aria-label") || "",
        title: button?.getAttribute("title") || "",
        clearHashCommandCount: (window.__engineCommands || []).filter((cmd) => cmd === "setoption name Clear Hash").length,
        beforeCount,
        overflowX: document.body.scrollWidth - document.body.clientWidth,
      };
    }, clearHashCommandsBefore);
    if (
      queuedHashState.text !== "Queued" ||
      queuedHashState.label !== "Engine hash clear queued" ||
      !queuedHashState.title.includes("queued after the current search") ||
      queuedHashState.clearHashCommandCount !== queuedHashState.beforeCount ||
      queuedHashState.overflowX > 2
    ) {
      throw new Error(`Clear Hash did not disclose queued search feedback: ${JSON.stringify(queuedHashState)}`);
    }

    const cleared = await page.evaluate(() => {
      const searchCard = [...document.querySelectorAll(".engine-stat")]
        .map((el) => el.textContent?.replace(/\s+/g, " ").trim() || "")
        .find((text) => text.includes("Search")) || "";
      return {
        fen: document.querySelector(".bottombar-fen")?.getAttribute("title") || "",
        searchCard,
        bottomStatus: document.querySelector(".bottom-engine-info")?.textContent?.replace(/\s+/g, " ").trim() || "",
        pvText: document.querySelector(".pv-lines-container")?.textContent?.replace(/\s+/g, " ").trim() || "",
        overflowX: document.body.scrollWidth - document.body.clientWidth,
      };
    });

    if (
      !cleared.fen.includes(" b ") ||
      cleared.fen.includes("1C5C1/9/RNBAKABNR w ") ||
      !cleared.pvText.includes("No PV available yet") ||
      !/Queued|Pending/.test(cleared.searchCard) ||
      !/Queued|Analyzing/.test(cleared.bottomStatus) ||
      !cleared.searchCard.includes("target D8") ||
      /789k nps|hash 2%/.test(cleared.searchCard) ||
      cleared.overflowX > 2
    ) {
      throw new Error(`Engine telemetry leaked after the position changed: ${JSON.stringify(cleared)}`);
    }

    await page.waitForFunction(() => typeof window.__finishFakeTelemetrySearch === "function", null, { timeout: 10000 });
    await page.evaluate(() => window.__finishFakeTelemetrySearch());
    await page.waitForFunction((beforeCount) => {
      const clearHashCommandCount = (window.__engineCommands || []).filter((cmd) => cmd === "setoption name Clear Hash").length;
      const buttonText = document.querySelector('[data-testid="clear-engine-hash-btn"]')?.textContent?.replace(/\s+/g, " ").trim() || "";
      return clearHashCommandCount > beforeCount && buttonText !== "Queued";
    }, clearHashCommandsBefore, { timeout: 5000 });
    const flushedHashState = await page.evaluate((beforeCount) => {
      const button = document.querySelector('[data-testid="clear-engine-hash-btn"]');
      const clearHashCommandCount = (window.__engineCommands || []).filter((cmd) => cmd === "setoption name Clear Hash").length;
      return {
        text: button?.textContent?.replace(/\s+/g, " ").trim() || "",
        label: button?.getAttribute("aria-label") || "",
        clearHashCommandCount,
        beforeCount,
        overflowX: document.body.scrollWidth - document.body.clientWidth,
      };
    }, clearHashCommandsBefore);
    if (
      flushedHashState.clearHashCommandCount <= flushedHashState.beforeCount ||
      !["Cleared", "Clear Hash"].includes(flushedHashState.text) ||
      !["Engine hash cleared", "Clear engine hash table"].includes(flushedHashState.label) ||
      flushedHashState.overflowX > 2
    ) {
      throw new Error(`Queued Clear Hash did not flush after the search completed: ${JSON.stringify(flushedHashState)}`);
    }
  } finally {
    await context.close();
  }
}

async function assertEngineMateScoresRenderAsMate(browser) {
  const desktop = await newIsolatedPage(browser);
  try {
    const { context, page } = desktop;
    await installFakePikafish(page, { variant: "fake-mate-telemetry" });
    await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForSelector(".xiangqi-board", { timeout: 30000 });
    await page.getByTestId("analysis-tab-engine").click();
    await page.waitForFunction(() => {
      return document.querySelector('[data-testid="engine-pv-score-0"]')?.textContent?.includes("+M3") &&
        document.querySelector(".board-stage-chip-eval")?.textContent?.includes("Red POV +M3");
    }, null, { timeout: 15000 });

    const state = await page.evaluate(() => ({
      firstLineLabel: document.querySelector(".pv-line")?.getAttribute("aria-label") || "",
      firstScoreLabel: document.querySelector('[data-testid="engine-pv-score-0"]')?.getAttribute("aria-label") || "",
      firstScoreTitle: document.querySelector('[data-testid="engine-pv-score-0"]')?.getAttribute("title") || "",
      firstScoreText: document.querySelector('[data-testid="engine-pv-score-0"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
      stageEvalText: document.querySelector(".board-stage-chip-eval")?.textContent?.replace(/\s+/g, " ").trim() || "",
      stageEvalLabel: document.querySelector(".board-stage-chip-eval")?.getAttribute("aria-label") || "",
      stageEvalClass: document.querySelector(".board-stage-chip-eval")?.className || "",
      overflowX: document.body.scrollWidth - document.body.clientWidth,
    }));

    if (
      !state.firstLineLabel.includes("Red POV score +M3") ||
      state.firstScoreLabel !== "Red POV score +M3" ||
      state.firstScoreTitle !== "Red POV score +M3" ||
      state.firstScoreText !== "+M3Red POV" ||
      state.stageEvalText !== "Red POV +M3" ||
      state.stageEvalLabel !== "Live engine evaluation, Red POV +M3" ||
      !state.stageEvalClass.includes("eval-positive") ||
      state.overflowX > 2
    ) {
      throw new Error(`Engine mate score did not render as mate on desktop: ${JSON.stringify(state)}`);
    }
    await context.close();
  } catch (error) {
    try { await desktop.context.close(); } catch (_) {}
    throw error;
  }

  const mobile = await newIsolatedPage(browser, { width: 390, height: 844 });
  try {
    const { context, page } = mobile;
    await installFakePikafish(page, { variant: "fake-mate-telemetry" });
    const blackToMoveFen = encodeURIComponent("rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR b - - 0 1");
    await page.goto(`http://127.0.0.1:8192/web-xiangqi/?fen=${blackToMoveFen}`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForSelector(".xiangqi-board", { timeout: 30000 });
    await page.waitForFunction(() => {
      return document.querySelector(".mobile-eval-chip")?.textContent?.includes("-M3");
    }, null, { timeout: 15000 });

    const state = await page.evaluate(() => ({
      turnText: document.querySelector(".mobile-turn-label")?.textContent?.trim() || "",
      evalText: document.querySelector(".mobile-eval-chip")?.textContent?.replace(/\s+/g, " ").trim() || "",
      evalLabel: document.querySelector(".mobile-eval-chip")?.getAttribute("aria-label") || "",
      evalTitle: document.querySelector(".mobile-eval-chip")?.getAttribute("title") || "",
      evalClass: document.querySelector(".mobile-eval-chip")?.className || "",
      overflowX: document.body.scrollWidth - document.body.clientWidth,
    }));

    if (
      state.turnText !== "Black" ||
      state.evalText !== "-M3" ||
      state.evalLabel !== "Live engine evaluation, Red POV -M3" ||
      state.evalTitle !== state.evalLabel ||
      !state.evalClass.includes("eval-negative") ||
      state.overflowX > 2
    ) {
      throw new Error(`Engine mate score did not flip for black-to-move mobile state: ${JSON.stringify(state)}`);
    }
    await context.close();
  } catch (error) {
    try { await mobile.context.close(); } catch (_) {}
    throw error;
  }
}

async function assertEngineRestartDropsBufferedInfo(browser) {
  const { context, page } = await newIsolatedPage(browser);
  try {
    await installFakePikafish(page, { variant: "fake-restart-buffer" });
    await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForSelector(".xiangqi-board", { timeout: 30000 });
    await page.getByTestId("analysis-tab-engine").click();
    await page.getByTestId("restart-engine-btn").waitFor({ timeout: 5000 });
    await page.waitForFunction(() => window.__engineCommands?.some((cmd) => /^go\b/.test(cmd)), null, { timeout: 10000 });
    await page.waitForTimeout(40);
    await page.getByTestId("restart-engine-btn").click();
    await page.waitForFunction(() => {
      return window.__engineInstanceCount >= 2 &&
        /Engine ready/i.test(document.querySelector(".top-engine-state")?.getAttribute("aria-label") || "");
    }, null, { timeout: 15000 });
    await page.waitForTimeout(300);

    const state = await page.evaluate(() => ({
      instanceCount: window.__engineInstanceCount,
      goCount: window.__goCount,
      pvText: document.querySelector(".pv-lines-container")?.textContent?.replace(/\s+/g, " ").trim() || "",
      coachText: document.querySelector(".engine-coach-summary")?.textContent?.replace(/\s+/g, " ").trim() || "",
      engine: document.querySelector(".top-engine-state")?.getAttribute("aria-label") || "",
      overflowX: document.body.scrollWidth - document.body.clientWidth,
    }));

    if (
      state.instanceCount < 2 ||
      /b2e2|9\.00|\+9/.test(`${state.pvText} ${state.coachText}`) ||
      !/Engine ready/i.test(state.engine) ||
      state.overflowX > 2
    ) {
      throw new Error(`Engine restart leaked buffered info from the previous worker: ${JSON.stringify(state)}`);
    }
  } finally {
    await context.close();
  }
}

async function assertEngineRestartRestoresDetailOptions(browser) {
  const { context, page } = await newIsolatedPage(browser);
  try {
    await installFakePikafish(page, { variant: "fake-restart-options" });
    await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForSelector(".xiangqi-board", { timeout: 30000 });
    await page.getByTestId("analysis-tab-engine").click();
    await page.waitForFunction(() => {
      return /Engine ready/i.test(document.querySelector(".top-engine-state")?.getAttribute("aria-label") || "");
    }, null, { timeout: 15000 });
    const activeInstanceId = await page.evaluate(() => window.__engineInstanceCount || 0);
    await page.getByTestId("engine-pv-lines-5").click();
    await page.waitForFunction((instanceId) => {
      const firstCommands = (window.__engineCommandsByInstance || [])
        .filter((entry) => entry.instanceId === instanceId)
        .map((entry) => entry.command);
      return firstCommands.includes("setoption name MultiPV value 5") &&
        firstCommands.includes("setoption name UCI_ShowWDL value true");
    }, activeInstanceId, { timeout: 10000 });

    await page.getByTestId("restart-engine-btn").click();
    await page.waitForFunction((instanceId) => {
      return window.__engineInstanceCount > instanceId &&
        /Engine ready/i.test(document.querySelector(".top-engine-state")?.getAttribute("aria-label") || "");
    }, activeInstanceId, { timeout: 15000 });
    const restartedInstanceId = await page.evaluate(() => window.__engineInstanceCount || 0);
    await page.waitForFunction((instanceId) => {
      const secondCommands = (window.__engineCommandsByInstance || [])
        .filter((entry) => entry.instanceId === instanceId)
        .map((entry) => entry.command);
      return secondCommands.includes("setoption name MultiPV value 5") &&
        secondCommands.includes("setoption name UCI_ShowWDL value true");
    }, restartedInstanceId, { timeout: 10000 });

    const state = await page.evaluate((instanceId) => {
      const secondCommands = (window.__engineCommandsByInstance || [])
        .filter((entry) => entry.instanceId === instanceId)
        .map((entry) => entry.command);
      return {
        instanceCount: window.__engineInstanceCount,
        detail: [...document.querySelectorAll(".engine-stat")]
          .map((el) => el.textContent || "")
          .find((text) => text.includes("Detail")) || "",
        activeFive: document.querySelector('[data-testid="engine-pv-lines-5"]')?.getAttribute("aria-pressed") || "",
        secondCommands,
        overflowX: document.body.scrollWidth - document.body.clientWidth,
      };
    }, restartedInstanceId);

    if (
      state.instanceCount <= activeInstanceId ||
      !state.detail.includes("MultiPV 5") ||
      !state.detail.includes("WDL on") ||
      state.activeFive !== "true" ||
      !state.secondCommands.includes("setoption name MultiPV value 5") ||
      !state.secondCommands.includes("setoption name UCI_ShowWDL value true") ||
      state.overflowX > 2
    ) {
      throw new Error(`Engine restart did not restore selected detail options: ${JSON.stringify(state)}`);
    }
  } finally {
    await context.close();
  }
}

async function assertPlayedEnginePvDoesNotStoreRootEval(browser) {
  const { context, page } = await newIsolatedPage(browser);
  try {
    await installFakePikafish(page, {
      variant: "fake-pv-play",
      setupSource: "window.__goCount = 0;",
      goSource: `
        window.__goCount += 1;
        const isAfterPlayedPv = /\\bmoves\\b.*\\bb0c2\\b/.test(window.__lastPositionCommand || "");
        setTimeout(() => {
          if (!isAfterPlayedPv) {
            emit("info depth 4 multipv 1 score cp 300 pv b0c2");
            emit("bestmove b0c2");
            return;
          }
          emit("bestmove h9g7");
        }, 20);
      `,
    });

    await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForSelector(".xiangqi-board", { timeout: 30000 });
    await page.getByTestId("analysis-tab-engine").click();
    await page.getByTestId("play-engine-pv-0").waitFor({ timeout: 15000 });
    await page.getByTestId("play-engine-pv-0").click();
    await page.waitForFunction(() => {
      const row = document.querySelector(".mtree-row")?.textContent || "";
      return row.includes("b0c2");
    }, null, { timeout: 5000 });

    const state = await page.evaluate(() => ({
      graphPoint: document.querySelector('[data-testid="graph-current-point"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
      graphEval: document.querySelector(".graph-legend strong")?.textContent?.trim() || "",
      rows: [...document.querySelectorAll(".mtree-row")].map((el) => el.textContent?.replace(/\s+/g, " ").trim() || "").join(" "),
      goCount: window.__goCount,
      overflowX: document.body.scrollWidth - document.body.clientWidth,
    }));
    if (
      !state.rows.includes("b0c2") ||
      !state.graphPoint.includes("Red B0") ||
      state.graphEval !== "Red POV 0.00" ||
      state.goCount < 1 ||
      state.overflowX > 2
    ) {
      throw new Error(`Playing an engine PV stored the root eval on the child move: ${JSON.stringify(state)}`);
    }
  } finally {
    await context.close();
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
    await page.evaluate(() => localStorage.removeItem("xiangqi:preferences:v1"));
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector(".xiangqi-board", { timeout: 30000 });

    await page.evaluate(() => {
      localStorage.setItem("xiangqi:preferences:v1", JSON.stringify({
        assistMode: "pro",
        analysisEngineMode: "stable",
        enginePvLineCount: 5,
        junk: "x".repeat(5000),
      }));
    });
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector(".xiangqi-board", { timeout: 30000 });
    const oversizedPrefsState = await page.evaluate(() => ({
      assistMode: document.querySelector(".app-shell")?.getAttribute("data-assist-mode") || "",
      overflowX: document.body.scrollWidth - document.body.clientWidth,
    }));
    if (oversizedPrefsState.assistMode !== "coach" || oversizedPrefsState.overflowX > 2) {
      throw new Error(`Oversized preferences were not ignored cleanly: ${JSON.stringify(oversizedPrefsState)}`);
    }
    await page.evaluate(() => localStorage.removeItem("xiangqi:preferences:v1"));
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector(".xiangqi-board", { timeout: 30000 });

    await page.getByRole("button", { name: "Open settings" }).click();
    const settings = page.locator(".settings-body");
    await settings.getByRole("button", {
      name: "Pro interface, compact analysis with fewer teaching prompts",
      exact: true,
    }).click();
    await settings.getByRole("button", {
      name: "Stable analysis engine profile, safer boot and conservative resources",
      exact: true,
    }).click();
    await settings.getByRole("button", { name: "Off", exact: true }).click();
    const settingsA11y = await settings.evaluate((root) => {
      const byId = (id) => root.querySelector(`#${id}`);
      const labelTextFor = (id) => byId(id)?.labels?.[0]?.textContent?.replace(/\s+/g, " ").trim() || "";
      const groupLabel = (id) => root.querySelector(`[aria-labelledby="${id}"]`)?.textContent?.replace(/\s+/g, " ").trim() || "";
      const pressed = (name) => [...root.querySelectorAll("button")]
        .find((button) => button.textContent?.trim() === name)
        ?.getAttribute("aria-pressed") || "";
      const buttonMeta = (name) => {
        const button = [...root.querySelectorAll("button")]
          .find((candidate) => candidate.textContent?.trim() === name);
        return {
          label: button?.getAttribute("aria-label") || "",
          title: button?.getAttribute("title") || "",
        };
      };
      const coachMeta = buttonMeta("Coach");
      const proMeta = buttonMeta("Pro");
      const stableMeta = buttonMeta("Stable");
      const optimizedMeta = buttonMeta("Optimized");
      const noticeLink = root.querySelector(".settings-link");
      return {
        workspaceLabel: labelTextFor("settings-workspace-mode"),
        gameModeLabel: labelTextFor("settings-game-mode"),
        searchDepthLabel: labelTextFor("settings-search-depth"),
        interfaceGroup: groupLabel("settings-interface-label"),
        orientationGroup: groupLabel("settings-orientation-label"),
        layoutGroup: groupLabel("settings-layout-label"),
        engineGroup: groupLabel("settings-analysis-engine-label"),
        soundGroup: groupLabel("settings-sound-label"),
        coachPressed: pressed("Coach"),
        proPressed: pressed("Pro"),
        stablePressed: pressed("Stable"),
        optimizedPressed: pressed("Optimized"),
        redPressed: pressed("Red at bottom"),
        blackPressed: pressed("Black at bottom"),
        graphPressed: pressed("Graph Panel"),
        treePressed: pressed("Tree Panel"),
        onPressed: pressed("On"),
        offPressed: pressed("Off"),
        coachLabel: coachMeta.label,
        coachTitle: coachMeta.title,
        proLabel: proMeta.label,
        proTitle: proMeta.title,
        stableLabel: stableMeta.label,
        stableTitle: stableMeta.title,
        optimizedLabel: optimizedMeta.label,
        optimizedTitle: optimizedMeta.title,
        noticeText: noticeLink?.textContent?.replace(/\s+/g, " ").trim() || "",
        noticeHref: noticeLink?.getAttribute("href") || "",
        noticeTarget: noticeLink?.getAttribute("target") || "",
        noticeRel: noticeLink?.getAttribute("rel") || "",
      };
    });
    if (
      settingsA11y.workspaceLabel !== "Workspace" ||
      settingsA11y.gameModeLabel !== "Game Mode" ||
      !settingsA11y.searchDepthLabel.startsWith("Search Depth") ||
      !settingsA11y.interfaceGroup.includes("Coach") ||
      !settingsA11y.orientationGroup.includes("Red at bottom") ||
      !settingsA11y.layoutGroup.includes("Graph Panel") ||
      !settingsA11y.engineGroup.includes("Stable") ||
      !settingsA11y.soundGroup.includes("On") ||
      settingsA11y.coachPressed !== "false" ||
      settingsA11y.proPressed !== "true" ||
      settingsA11y.stablePressed !== "true" ||
      settingsA11y.optimizedPressed !== "false" ||
      settingsA11y.redPressed !== "true" ||
      settingsA11y.blackPressed !== "false" ||
      settingsA11y.graphPressed !== "true" ||
      settingsA11y.treePressed !== "true" ||
      settingsA11y.onPressed !== "false" ||
      settingsA11y.offPressed !== "true" ||
      settingsA11y.coachLabel !== "Coach interface, show rule hints and guided move context" ||
      settingsA11y.coachTitle !== "Coach interface: show rule hints and guided move context." ||
      settingsA11y.proLabel !== "Pro interface, compact analysis with fewer teaching prompts" ||
      settingsA11y.proTitle !== "Pro interface: compact analysis with fewer teaching prompts." ||
      settingsA11y.stableLabel !== "Stable analysis engine profile, safer boot and conservative resources" ||
      settingsA11y.stableTitle !== "Stable profile: safer boot and conservative engine resources." ||
      settingsA11y.optimizedLabel !== "Optimized analysis engine profile, faster search when supported" ||
      settingsA11y.optimizedTitle !== "Optimized profile: faster search when this device supports it." ||
      settingsA11y.noticeText !== "Engine Notices" ||
      !settingsA11y.noticeHref.endsWith("/web-xiangqi/THIRD_PARTY_NOTICES.md") ||
      settingsA11y.noticeTarget !== "_blank" ||
      !settingsA11y.noticeRel.includes("noreferrer") ||
      !settingsA11y.noticeRel.includes("noopener")
    ) {
      throw new Error(`Settings controls are not fully accessible: ${JSON.stringify(settingsA11y)}`);
    }
    await settings.getByRole("button", { name: "Close settings" }).click();
    await page.locator(".settings-body").waitFor({ state: "detached", timeout: 5000 });

    await page.getByTestId("analysis-tab-engine").click();
    await page.getByTestId("engine-pv-lines-5").click();

    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("xiangqi:preferences:v1") || "{}"));
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
      terminalRole: document.querySelector('[data-testid="engine-output-terminal"]')?.getAttribute("role") || "",
      terminalLabel: document.querySelector('[data-testid="engine-output-terminal"]')?.getAttribute("aria-label") || "",
      terminalTitle: document.querySelector('[data-testid="engine-output-terminal"]')?.getAttribute("title") || "",
      terminalLive: document.querySelector('[data-testid="engine-output-terminal"]')?.getAttribute("aria-live") || "",
      terminalRelevant: document.querySelector('[data-testid="engine-output-terminal"]')?.getAttribute("aria-relevant") || "",
      terminalText: document.querySelector('[data-testid="engine-output-terminal"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
      overflowX: document.body.scrollWidth - document.body.clientWidth,
    }));

    if (
      restored.pv5Active !== "true" ||
      !restored.detail.includes("MultiPV 5") ||
      !restored.profile.includes("stable") ||
      restored.terminalRole !== "log" ||
      !restored.terminalLabel.startsWith("Raw engine UCI output, ") ||
      restored.terminalTitle !== restored.terminalLabel ||
      restored.terminalLive !== "off" ||
      restored.terminalRelevant !== "additions text" ||
      restored.terminalText.length === 0
    ) {
      throw new Error(`Preferences were not restored into the UI: ${JSON.stringify(restored)}`);
    }
    if (restored.overflowX > 2) {
      throw new Error(`Restored preferences introduced horizontal overflow: ${restored.overflowX}`);
    }

    await page.evaluate(() => {
      window.dispatchEvent(new StorageEvent("storage", {
        key: "xiangqi:preferences:v1",
        newValue: JSON.stringify({
          assistMode: "coach",
          analysisEngineMode: "optimized",
          enginePvLineCount: 1,
          soundEnabled: true,
          orientation: "black",
          showArrows: false,
          searchDepth: 3,
          aiStrength: 2,
          aiSpeed: "fast",
        }),
        storageArea: localStorage,
      }));
    });
    await page.waitForFunction(() => {
      const stored = JSON.parse(localStorage.getItem("xiangqi:preferences:v1") || "{}");
      return document.querySelector(".app-shell")?.getAttribute("data-assist-mode") === "coach" &&
        document.querySelector('[data-testid="engine-pv-lines-1"]')?.getAttribute("aria-pressed") === "true" &&
        stored.assistMode === "coach" &&
        stored.analysisEngineMode === "optimized" &&
        stored.enginePvLineCount === 1 &&
        stored.orientation === "black" &&
        stored.showArrows === false &&
        stored.searchDepth === 3 &&
        stored.aiStrength === 2 &&
        stored.aiSpeed === "fast";
    }, null, { timeout: 5000 });
    const synced = await page.evaluate(() => ({
      assistMode: document.querySelector(".app-shell")?.getAttribute("data-assist-mode") || "",
      pv1Active: document.querySelector('[data-testid="engine-pv-lines-1"]')?.getAttribute("aria-pressed") || "",
      profile: [...document.querySelectorAll(".engine-stat")]
        .map((el) => el.textContent || "")
        .find((text) => text.includes("Profile")) || "",
      stored: JSON.parse(localStorage.getItem("xiangqi:preferences:v1") || "{}"),
      overflowX: document.body.scrollWidth - document.body.clientWidth,
    }));
    if (
      synced.assistMode !== "coach" ||
      synced.pv1Active !== "true" ||
      !synced.profile.includes("optimized") ||
      synced.stored.orientation !== "black" ||
      synced.stored.showArrows !== false ||
      synced.stored.searchDepth !== 3 ||
      synced.stored.aiStrength !== 2 ||
      synced.stored.aiSpeed !== "fast" ||
      synced.overflowX > 2
    ) {
      throw new Error(`Cross-tab preference sync did not update the UI cleanly: ${JSON.stringify(synced)}`);
    }

    await page.getByRole("button", { name: "Open settings" }).click();
    await page.getByTestId("reset-preferences-btn").click();
    const resetState = await page.evaluate(() => ({
      assistMode: document.querySelector(".app-shell")?.getAttribute("data-assist-mode") || "",
      stored: JSON.parse(localStorage.getItem("xiangqi:preferences:v1") || "{}"),
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
    await page.evaluate(() => localStorage.removeItem("xiangqi:preferences:v1")).catch(() => {});
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

  await page.waitForTimeout(800);
  await loadButton.click();
  await page.waitForTimeout(1400);

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
  await page.getByTestId("mobile-analysis-tab-review").click();
  await page.waitForFunction(() => {
    return document.querySelector('[data-testid="mobile-analysis-tab-review"]')?.getAttribute("aria-selected") === "true" &&
      document.querySelector('[data-testid="analysis-tab-review"]')?.getAttribute("aria-selected") === "true";
  }, null, { timeout: 5000 });
  await page.getByTestId("mobile-analysis-tab-engine").click();
  await page.waitForFunction(() => {
    return document.querySelector('[data-testid="mobile-analysis-tab-engine"]')?.getAttribute("aria-selected") === "true" &&
      document.querySelector('[data-testid="analysis-tab-engine"]')?.getAttribute("aria-selected") === "true" &&
      Boolean(document.querySelector(".engine-dashboard"));
  }, null, { timeout: 5000 });
  await page.getByTestId("mobile-analysis-tab-library").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="mobile-analysis-tab-library"]')?.getAttribute("aria-selected") === "true", null, { timeout: 5000 });

  const mobileUpdated = await page.evaluate(() => ({
    boardCurrent: document.querySelector('[data-testid="mobile-view-board"]')?.getAttribute("aria-current") || "",
    analysisCurrent: document.querySelector('[data-testid="mobile-view-analysis"]')?.getAttribute("aria-current") || "",
    tablist: document.querySelector(".mobile-analysis-tabs")?.getAttribute("role") || "",
    tabCount: document.querySelectorAll(".mobile-analysis-tabs [role='tab']").length,
    movesSelected: document.querySelector('[data-testid="mobile-analysis-tab-moves"]')?.getAttribute("aria-selected") || "",
    reviewControls: document.querySelector('[data-testid="mobile-analysis-tab-review"]')?.getAttribute("aria-controls") || "",
    engineControls: document.querySelector('[data-testid="mobile-analysis-tab-engine"]')?.getAttribute("aria-controls") || "",
    librarySelected: document.querySelector('[data-testid="mobile-analysis-tab-library"]')?.getAttribute("aria-selected") || "",
    libraryControls: document.querySelector('[data-testid="mobile-analysis-tab-library"]')?.getAttribute("aria-controls") || "",
    hiddenPanelTabStrips: [...document.querySelectorAll(".panel-header-tabs")].every((el) => getComputedStyle(el).display === "none"),
    overflowX: document.body.scrollWidth - document.body.clientWidth,
  }));
  if (
    mobileUpdated.boardCurrent !== "" ||
    mobileUpdated.analysisCurrent !== "page" ||
    mobileUpdated.tablist !== "tablist" ||
    mobileUpdated.tabCount !== 5 ||
    mobileUpdated.movesSelected !== "false" ||
    mobileUpdated.reviewControls !== "right-analysis-content" ||
    mobileUpdated.engineControls !== "right-analysis-content" ||
    mobileUpdated.librarySelected !== "true" ||
    mobileUpdated.libraryControls !== "left-panel-content" ||
    !mobileUpdated.hiddenPanelTabStrips ||
    mobileUpdated.overflowX > 2
  ) {
    throw new Error(`Mobile panel tabs are not exposed accessibly: ${JSON.stringify(mobileUpdated)}`);
  }
}

async function assertLibraryLoadsAnalysisWorkspace(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.evaluate(() => {
    localStorage.setItem("xiangqi:library:v1", JSON.stringify([{
      id: "qa-load-analysis-workspace",
      savedAt: 1710000007000,
      gameMode: "PvAI-Black",
      moves: ["b2e2", "h9g7"],
      result: "ongoing",
      label: "Load analysis workspace QA",
    }]));
  });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });

  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForFunction(() => {
    const play = [...document.querySelectorAll(".top-mode-pills button")]
      .find((button) => button.textContent?.trim() === "Play");
    return play?.getAttribute("aria-pressed") === "true";
  }, null, { timeout: 5000 });

  await page.locator('button[aria-label="Open game library"]').click();
  await page.getByTestId("load-saved-qa-load-analysis-workspace").click();
  await page.getByTestId("move-tree-row-label-0").waitFor({ timeout: 5000 });

  const state = await page.evaluate(() => {
    const modeButtons = [...document.querySelectorAll(".top-mode-pills button")];
    const play = modeButtons.find((button) => button.textContent?.trim() === "Play");
    const analysis = modeButtons.find((button) => button.textContent?.trim() === "Analysis");
    return {
      playPressed: play?.getAttribute("aria-pressed") || "",
      analysisPressed: analysis?.getAttribute("aria-pressed") || "",
      treeSelected: document.querySelector('[data-testid="analysis-tab-tree"]')?.getAttribute("aria-selected") || "",
      engineTabVisible: Boolean(document.querySelector('[data-testid="analysis-tab-engine"]')),
      rowText: document.querySelector(".mtree-row")?.textContent?.replace(/\s+/g, " ").trim() || "",
      aiPlaybackControls: Boolean(document.querySelector(".wc-play")),
      modeBadge: document.querySelector(".game-mode-badge")?.textContent?.replace(/\s+/g, " ").trim() || "",
      overflowX: document.body.scrollWidth - document.body.clientWidth,
    };
  });
  if (
    state.playPressed !== "false" ||
    state.analysisPressed !== "true" ||
    state.treeSelected !== "true" ||
    !state.engineTabVisible ||
    !state.rowText.includes("b2e2") ||
    state.aiPlaybackControls ||
    !state.modeBadge.includes("You play Red") ||
    state.overflowX > 2
  ) {
    throw new Error(`Saved AI study did not load into Analysis workspace: ${JSON.stringify(state)}`);
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

async function assertMobileNewGameStartButtonVisible(page) {
  await page.setViewportSize({ width: 390, height: 624 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });

  await page.getByRole("button", { name: "Open new game menu" }).click();
  await page.locator(".new-game-menu").waitFor({ timeout: 5000 });
  const newGameExpanded = await page.evaluate(() => (
    document.querySelector('.mobile-board-actions [aria-label="Open new game menu"]')?.getAttribute("aria-expanded") || ""
  ));
  if (newGameExpanded !== "true") {
    throw new Error(`Mobile New Game trigger did not expose expanded state: ${newGameExpanded}`);
  }
  await page.waitForFunction(() => {
    const menu = document.querySelector(".new-game-menu");
    return Boolean(menu && menu.contains(document.activeElement));
  }, null, { timeout: 5000 });
  await page.locator(".new-game-mode-btn").filter({ hasText: "You play Black" }).click();
  await page.locator('button[aria-label^="Beginner: depth 2"]').click();

  const layout = await page.evaluate(() => {
    const menu = document.querySelector(".new-game-menu");
    const footer = document.querySelector(".new-game-menu-footer");
    const start = document.querySelector(".new-game-start-btn");
    const menuRect = menu?.getBoundingClientRect();
    const startRect = start?.getBoundingClientRect();
    const footerStyle = footer ? getComputedStyle(footer) : null;
    return {
      innerHeight: window.innerHeight,
      menu: menuRect ? { top: menuRect.top, bottom: menuRect.bottom, height: menuRect.height } : null,
      start: startRect ? { top: startRect.top, bottom: startRect.bottom, height: startRect.height } : null,
      footerPosition: footerStyle?.position || "",
      menuScrollTop: menu?.scrollTop ?? -1,
      modeButtonLabels: Array.from(document.querySelectorAll(".new-game-mode-btn"))
        .map((button) => button.getAttribute("aria-label") || ""),
      selectionLabel: document.querySelector(".new-game-selection")?.getAttribute("aria-label") || "",
      overflowX: document.body.scrollWidth - document.body.clientWidth,
    };
  });

  if (!layout.menu || !layout.start || layout.footerPosition !== "sticky") {
    throw new Error(`Mobile New Game footer was not sticky: ${JSON.stringify(layout)}`);
  }
  if (!layout.modeButtonLabels.every((label) => /^[^.]+\. .+/.test(label))) {
    throw new Error(`New Game mode buttons need readable accessible labels: ${JSON.stringify(layout)}`);
  }
  if (!/^Selected .+\. .+/.test(layout.selectionLabel)) {
    throw new Error(`New Game selected mode summary needs a readable accessible label: ${JSON.stringify(layout)}`);
  }
  if (layout.start.bottom > layout.innerHeight - 6 || layout.start.top < 0) {
    throw new Error(`Mobile New Game start button was not immediately reachable: ${JSON.stringify(layout)}`);
  }
  if (layout.overflowX > 2) {
    throw new Error(`Mobile New Game dialog introduced horizontal overflow: ${layout.overflowX}`);
  }

  await page.getByRole("button", { name: "Start Fresh Board", exact: true }).click();
  await page.locator(".new-game-menu").waitFor({ state: "detached", timeout: 5000 });
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

async function assertMoveLineImportPreservesVariations(page) {
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
  const variationText = await page.locator(".mtree-variation").allTextContents();
  if (!variationText.join(" ").includes("b0c2")) {
    throw new Error(`PGN variation branch was not visible after import: ${variationText.join(" ")}`);
  }

  const activePoint = await page.getByTestId("graph-current-point").textContent();
  if (!String(activePoint || "").includes("Black H9") || !String(activePoint || "").includes("G7")) {
    throw new Error(`Variation import did not land on the mainline final move: ${String(activePoint || "").trim()}`);
  }
}

async function assertMoveLineImportRecoversUnclosedVariation(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });

  await page.getByRole("button", { name: "Start new game" }).click();
  await page.getByTestId("uci-line-input").fill('[Variant "Xiangqi"]\n1. b2e2 h9g7 (1... b9c7');
  await page.getByTestId("import-uci-line-btn").click();
  await page.getByTestId("move-tree-row-label-0").waitFor({ timeout: 5000 });

  const rows = await page.locator(".mtree-row").allTextContents();
  const rowText = rows.join(" ");
  if (!rowText.includes("b2e2") || !rowText.includes("h9g7") || rowText.includes("b9c7")) {
    throw new Error(`Unclosed PGN variation changed the imported mainline: ${rowText}`);
  }

  const variationText = await page.locator(".mtree-variation").allTextContents();
  if (!variationText.join(" ").includes("b9c7")) {
    throw new Error(`Unclosed PGN variation was not visible after import: ${variationText.join(" ")}`);
  }

  const activePoint = await page.getByTestId("graph-current-point").textContent();
  if (!String(activePoint || "").includes("Black H9") || !String(activePoint || "").includes("G7")) {
    throw new Error(`Unclosed variation import did not recover the mainline final move: ${String(activePoint || "").trim()}`);
  }
}

async function assertMoveLineImportRejectsInvalidVariation(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });

  await page.getByRole("button", { name: "Start new game" }).click();
  const input = page.getByTestId("uci-line-input");
  await input.fill('[Variant "Xiangqi"]\n1. b2e2 (1. a0a9) h9g7');
  await page.getByTestId("import-uci-line-btn").click();

  const error = page.locator("#new-game-line-error");
  await error.waitFor({ timeout: 5000 });
  const errorText = await error.textContent();
  if (!String(errorText || "").includes("Variation a0a9")) {
    throw new Error(`Invalid PGN variation did not show a branch-specific error: ${String(errorText || "").trim()}`);
  }
}

async function assertReviewBestMoveBranchAction(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.evaluate(() => {
    const savedAt = 1710000005000;
    localStorage.setItem("xiangqi:library:v1", JSON.stringify([{
      id: "review-best-branch",
      savedAt,
      gameMode: "PvP",
      moves: ["b2e2", "h9g7"],
      result: "ongoing",
      label: "Review best branch QA",
      review: {
        summary: {
          totalMoves: 2,
          accuracy: 66,
          averageCentipawnLoss: 130,
          redAccuracy: 39,
          blackAccuracy: 93,
          redAverageCentipawnLoss: 240,
          blackAverageCentipawnLoss: 20,
          bestCount: 0,
          goodCount: 1,
          inaccuracyCount: 0,
          mistakeCount: 1,
          blunderCount: 0,
          reviewedAt: savedAt,
          lineSignature: "b2e2 h9g7",
          engine: {
            tier: "high",
            baseDepth: 10,
            baseMoveTimeMs: 1500,
            revisitDepth: 12,
            revisitMoveTimeMs: 3000,
          },
          keyMoments: [{
            nodeId: "saved-0",
            moveIndex: 0,
            jumpTarget: 0,
            ply: 1,
            side: "red",
            quality: "mistake",
            swing: 240,
            winPercentLoss: 20.75881993130915,
            evalBefore: 0,
            evalAfter: -240,
            bestMove: "b0c2",
            playedMove: "b2e2",
            note: "Missed a stronger continuation. B0->C2 was stronger by 240cp.",
          }],
        },
        annotations: [
          { moveIndex: 0, evalScore: -240, bestMove: "b0c2", quality: "mistake", swing: 240, winPercentLoss: 20.75881993130915, reviewNote: "Missed a stronger continuation. B0->C2 was stronger by 240cp." },
          { moveIndex: 1, evalScore: -220, quality: "good", swing: 20, winPercentLoss: 1.5, reviewNote: "Solid choice." },
        ],
      },
    }]));
  });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });

  await page.locator('button[aria-label="Open game library"]').click();
  await page.getByTestId("review-meta-saved-review-best-branch").waitFor({ timeout: 5000 });
  const libraryReviewMeta = await page.evaluate(() => ({
    metaText: document.querySelector('[data-testid="review-meta-saved-review-best-branch"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
    metaLabel: document.querySelector('[data-testid="review-meta-saved-review-best-branch"]')?.getAttribute("aria-label") || "",
    redAccuracyText: document.querySelector('[data-testid="review-red-accuracy-saved-review-best-branch"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
    redAccuracyLabel: document.querySelector('[data-testid="review-red-accuracy-saved-review-best-branch"]')?.getAttribute("aria-label") || "",
    blackAccuracyText: document.querySelector('[data-testid="review-black-accuracy-saved-review-best-branch"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
    blackAccuracyLabel: document.querySelector('[data-testid="review-black-accuracy-saved-review-best-branch"]')?.getAttribute("aria-label") || "",
    averageLossText: document.querySelector('[data-testid="review-average-loss-saved-review-best-branch"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
    averageLossLabel: document.querySelector('[data-testid="review-average-loss-saved-review-best-branch"]')?.getAttribute("aria-label") || "",
    blunderText: document.querySelector('[data-testid="review-blunders-saved-review-best-branch"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
    mistakeText: document.querySelector('[data-testid="review-mistakes-saved-review-best-branch"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
    inaccuracyText: document.querySelector('[data-testid="review-inaccuracies-saved-review-best-branch"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
    engineText: document.querySelector('[data-testid="review-engine-saved-review-best-branch"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
    engineLabel: document.querySelector('[data-testid="review-engine-saved-review-best-branch"]')?.getAttribute("aria-label") || "",
    engineTitle: document.querySelector('[data-testid="review-engine-saved-review-best-branch"]')?.getAttribute("title") || "",
    loadLabel: document.querySelector('[data-testid="load-saved-review-best-branch"]')?.getAttribute("aria-label") || "",
    copyLabel: document.querySelector('[data-testid="copy-pgn-saved-review-best-branch"]')?.getAttribute("aria-label") || "",
    downloadLabel: document.querySelector('[data-testid="download-pgn-saved-review-best-branch"]')?.getAttribute("aria-label") || "",
    deleteLabel: document.querySelector('[data-testid="delete-saved-review-best-branch"]')?.getAttribute("aria-label") || "",
    overflowX: document.body.scrollWidth - document.body.clientWidth,
  }));
  if (
    !libraryReviewMeta.metaText.includes("42% accuracy") ||
    !libraryReviewMeta.metaText.includes("Avg loss 130cp") ||
    !libraryReviewMeta.metaText.includes("Red 39%") ||
    !libraryReviewMeta.metaText.includes("Black 93%") ||
    !libraryReviewMeta.metaLabel.includes("Red 39%") ||
    !libraryReviewMeta.metaLabel.includes("Black 93%") ||
    !libraryReviewMeta.metaLabel.includes("Avg loss 130cp") ||
    libraryReviewMeta.redAccuracyText !== "Red 39%" ||
    libraryReviewMeta.redAccuracyLabel !== "Red review accuracy 39%" ||
    libraryReviewMeta.blackAccuracyText !== "Black 93%" ||
    libraryReviewMeta.blackAccuracyLabel !== "Black review accuracy 93%" ||
    libraryReviewMeta.averageLossText !== "Avg loss 130cp" ||
    libraryReviewMeta.averageLossLabel !== "Average centipawn loss 130cp" ||
    libraryReviewMeta.blunderText !== "0 blunders" ||
    libraryReviewMeta.mistakeText !== "1 mistake" ||
    libraryReviewMeta.inaccuracyText !== "0 inaccuracies" ||
    !libraryReviewMeta.engineText.includes("D10/1.5s") ||
    !libraryReviewMeta.engineText.includes("revisit D12/3s") ||
    !libraryReviewMeta.engineLabel.includes("Review engine: high tier engine") ||
    !libraryReviewMeta.engineTitle.includes("base depth 10 for 1.5s") ||
    !libraryReviewMeta.metaLabel.includes("Review summary for Review best branch QA") ||
    !libraryReviewMeta.metaLabel.includes("1 mistake") ||
    !libraryReviewMeta.metaLabel.includes("Engine: high tier engine") ||
    libraryReviewMeta.loadLabel !== "Load Review best branch QA" ||
    libraryReviewMeta.copyLabel !== "Copy PGN for Review best branch QA" ||
    libraryReviewMeta.downloadLabel !== "Download PGN for Review best branch QA" ||
    libraryReviewMeta.deleteLabel !== "Delete Review best branch QA" ||
    libraryReviewMeta.overflowX > 2
  ) {
    throw new Error(`Saved reviewed-game card is not self-describing: ${JSON.stringify(libraryReviewMeta)}`);
  }
  await page.getByTestId("load-saved-review-best-branch").click();
  await page.getByTestId("review-try-best-0").waitFor({ timeout: 5000 });
  const reviewReadout = await page.evaluate(() => ({
    focus: document.querySelector('[data-testid="review-focus-card"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
    focusEval: document.querySelector('[data-testid="review-focus-eval"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
    focusEvalLabel: document.querySelector('[data-testid="review-focus-eval"]')?.getAttribute("aria-label") || "",
    focusEvalTitle: document.querySelector('[data-testid="review-focus-eval"]')?.getAttribute("title") || "",
    focusChance: document.querySelector('[data-testid="review-focus-chance"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
    focusChanceLabel: document.querySelector('[data-testid="review-focus-chance"]')?.getAttribute("aria-label") || "",
    redAccuracy: document.querySelector('[data-testid="review-red-accuracy"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
    redAccuracyLabel: document.querySelector('[data-testid="review-red-accuracy"]')?.getAttribute("aria-label") || "",
    blackAccuracy: document.querySelector('[data-testid="review-black-accuracy"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
    blackAccuracyLabel: document.querySelector('[data-testid="review-black-accuracy"]')?.getAttribute("aria-label") || "",
    averageLoss: document.querySelector('[data-testid="review-average-loss"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
    averageLossLabel: document.querySelector('[data-testid="review-average-loss"]')?.getAttribute("aria-label") || "",
    momentCount: document.querySelector('[data-testid="review-moment-count"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
    momentSideFilter: document.querySelector('[data-testid="review-moment-side-filter"]')?.value || "",
    momentQualityFilter: document.querySelector('[data-testid="review-moment-quality-filter"]')?.value || "",
    momentEval: document.querySelector('[data-testid="review-moment-eval-0"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
    momentEvalLabel: document.querySelector('[data-testid="review-moment-eval-0"]')?.getAttribute("aria-label") || "",
    momentChance: document.querySelector('[data-testid="review-moment-chance-0"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
    momentChanceLabel: document.querySelector('[data-testid="review-moment-chance-0"]')?.getAttribute("aria-label") || "",
    momentLabel: document.querySelector('[data-testid="review-moment-0"]')?.getAttribute("aria-label") || "",
    best: document.querySelector('[data-testid="review-quality-best"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
    good: document.querySelector('[data-testid="review-quality-good"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
    inaccuracy: document.querySelector('[data-testid="review-quality-inaccuracy"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
    mistake: document.querySelector('[data-testid="review-quality-mistake"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
    blunder: document.querySelector('[data-testid="review-quality-blunder"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
    engine: document.querySelector('[data-testid="review-engine-summary"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
    engineLabel: document.querySelector('[data-testid="review-engine-summary"]')?.getAttribute("aria-label") || "",
    engineTitle: document.querySelector('[data-testid="review-engine-summary"]')?.getAttribute("title") || "",
    bestLabel: document.querySelector('[data-testid="review-quality-best"]')?.getAttribute("aria-label") || "",
    goodLabel: document.querySelector('[data-testid="review-quality-good"]')?.getAttribute("aria-label") || "",
    inaccuracyLabel: document.querySelector('[data-testid="review-quality-inaccuracy"]')?.getAttribute("aria-label") || "",
    mistakeLabel: document.querySelector('[data-testid="review-quality-mistake"]')?.getAttribute("aria-label") || "",
    blunderLabel: document.querySelector('[data-testid="review-quality-blunder"]')?.getAttribute("aria-label") || "",
    mistakeTitle: document.querySelector('[data-testid="review-quality-mistake"]')?.getAttribute("title") || "",
    rerunLabel: document.querySelector('[data-testid="rerun-review-btn"]')?.getAttribute("aria-label") || "",
    rerunTitle: document.querySelector('[data-testid="rerun-review-btn"]')?.getAttribute("title") || "",
    clearReviewLabel: document.querySelector('[data-testid="clear-review-btn"]')?.getAttribute("aria-label") || "",
    clearReviewTitle: document.querySelector('[data-testid="clear-review-btn"]')?.getAttribute("title") || "",
    bottomSummaryText: document.querySelector('[data-testid="bottom-review-summary"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
    bottomSummaryLabel: document.querySelector('[data-testid="bottom-review-summary"]')?.getAttribute("aria-label") || "",
    bottomRedAccuracy: document.querySelector('[data-testid="bottom-review-red-accuracy"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
    bottomRedAccuracyLabel: document.querySelector('[data-testid="bottom-review-red-accuracy"]')?.getAttribute("aria-label") || "",
    bottomBlackAccuracy: document.querySelector('[data-testid="bottom-review-black-accuracy"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
    bottomBlackAccuracyLabel: document.querySelector('[data-testid="bottom-review-black-accuracy"]')?.getAttribute("aria-label") || "",
    bottomAverageLoss: document.querySelector('[data-testid="bottom-review-average-loss"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
    bottomAverageLossLabel: document.querySelector('[data-testid="bottom-review-average-loss"]')?.getAttribute("aria-label") || "",
    bottomViewLabel: document.querySelector('[data-testid="view-completed-review-btn"]')?.getAttribute("aria-label") || "",
    bottomViewTitle: document.querySelector('[data-testid="view-completed-review-btn"]')?.getAttribute("title") || "",
    bottomClearLabel: document.querySelector('[data-testid="clear-review-bottom-btn"]')?.getAttribute("aria-label") || "",
    bottomClearTitle: document.querySelector('[data-testid="clear-review-bottom-btn"]')?.getAttribute("title") || "",
    graphTooltip: document.querySelector(".graph-tooltip")?.textContent?.replace(/\s+/g, " ").trim() || "",
    graphValueText: document.querySelector(".winrate-graph")?.getAttribute("aria-valuetext") || "",
    overflowX: document.body.scrollWidth - document.body.clientWidth,
  }));
  if (
    !reviewReadout.focus.includes("Study focus") ||
    !reviewReadout.focus.includes("Mistake at ply 1") ||
    !reviewReadout.focus.includes("B0→C2") ||
    !reviewReadout.focusEval.includes("0.00") ||
    !reviewReadout.focusEval.includes("-2.40") ||
    reviewReadout.focusEvalLabel !== "Red evaluation changed from 0.00 to -2.40" ||
    reviewReadout.focusEvalTitle !== "Red POV: 0.00 → -2.40" ||
    reviewReadout.focusChance !== "Chance-21%" ||
    reviewReadout.focusChanceLabel !== "Red practical winning chance dropped by 21 percentage points" ||
    reviewReadout.redAccuracy !== "Red39%240cp loss" ||
    reviewReadout.redAccuracyLabel !== "Red accuracy 39%, average centipawn loss 240cp" ||
    reviewReadout.blackAccuracy !== "Black93%20cp loss" ||
    reviewReadout.blackAccuracyLabel !== "Black accuracy 93%, average centipawn loss 20cp" ||
    reviewReadout.averageLoss !== "Avg loss130cp" ||
    reviewReadout.averageLossLabel !== "Average centipawn loss 130cp" ||
    reviewReadout.momentCount !== "1/1" ||
    reviewReadout.momentSideFilter !== "all" ||
    reviewReadout.momentQualityFilter !== "all" ||
    !reviewReadout.momentEval.includes("0.00") ||
    !reviewReadout.momentEval.includes("-2.40") ||
    reviewReadout.momentEvalLabel !== "Red evaluation changed from 0.00 to -2.40" ||
    reviewReadout.momentChance !== "Chance-21%" ||
    reviewReadout.momentChanceLabel !== "Red practical winning chance dropped by 21 percentage points" ||
    !reviewReadout.momentLabel.includes("Red practical winning chance dropped by 21 percentage points") ||
    !reviewReadout.momentLabel.includes("Red evaluation changed from 0.00 to -2.40") ||
    reviewReadout.best !== "Best0" ||
    reviewReadout.good !== "Good1" ||
    reviewReadout.inaccuracy !== "Inaccuracy0" ||
    reviewReadout.mistake !== "Mistake1" ||
    reviewReadout.blunder !== "Blunder0" ||
    !reviewReadout.engine.includes("D10/1.5s") ||
    !reviewReadout.engine.includes("revisit D12/3s") ||
    !reviewReadout.engineLabel.includes("Review engine: high tier engine") ||
    !reviewReadout.engineTitle.includes("base depth 10 for 1.5s") ||
    reviewReadout.bestLabel !== "0 best moves" ||
    reviewReadout.goodLabel !== "1 good move" ||
    reviewReadout.inaccuracyLabel !== "0 inaccuracies" ||
    reviewReadout.mistakeLabel !== "1 mistake" ||
    reviewReadout.blunderLabel !== "0 blunders" ||
    reviewReadout.mistakeTitle !== "1 mistake" ||
    reviewReadout.rerunLabel !== "Re-run game review unavailable: Engine is still loading" ||
    reviewReadout.rerunTitle !== "Engine is still loading" ||
    reviewReadout.clearReviewLabel !== "Clear completed game review" ||
    reviewReadout.clearReviewTitle !== "Clear completed game review" ||
    // 42, not the 66 a plain mean of 39 and 93 gives. The game figure is
    // weighted by how volatile the game was around each move: Red's mistake
    // cost 21 points of winning chances and carries a weight of 10.4, Black's
    // quiet reply 0.75. Per-side figures are unchanged -- a single move has the
    // same mean either way. See utils/accuracyAggregate.
    !reviewReadout.bottomSummaryText.includes("42% accuracy") ||
    !reviewReadout.bottomSummaryText.includes("Avg loss 130cp") ||
    !reviewReadout.bottomSummaryText.includes("Red 39%") ||
    !reviewReadout.bottomSummaryText.includes("Black 93%") ||
    !reviewReadout.bottomSummaryText.includes("0 blunders") ||
    !reviewReadout.bottomSummaryText.includes("1 mistake") ||
    !reviewReadout.bottomSummaryText.includes("0 inaccuracies") ||
    !reviewReadout.bottomSummaryLabel.includes("Review summary: 42% accuracy") ||
    !reviewReadout.bottomSummaryLabel.includes("average centipawn loss 130cp") ||
    !reviewReadout.bottomSummaryLabel.includes("Red 39% accuracy") ||
    !reviewReadout.bottomSummaryLabel.includes("Black 93% accuracy") ||
    reviewReadout.bottomRedAccuracy !== "Red 39%" ||
    reviewReadout.bottomRedAccuracyLabel !== "Red accuracy 39%" ||
    reviewReadout.bottomBlackAccuracy !== "Black 93%" ||
    reviewReadout.bottomBlackAccuracyLabel !== "Black accuracy 93%" ||
    reviewReadout.bottomAverageLoss !== "Avg loss 130cp" ||
    reviewReadout.bottomAverageLossLabel !== "Average centipawn loss 130cp" ||
    !reviewReadout.bottomSummaryLabel.includes("1 mistake") ||
    !reviewReadout.bottomSummaryLabel.includes("Engine: high tier engine") ||
    reviewReadout.bottomViewLabel !== "Open completed game review" ||
    reviewReadout.bottomViewTitle !== "Open completed game review" ||
    reviewReadout.bottomClearLabel !== "Clear completed game review" ||
    reviewReadout.bottomClearTitle !== "Clear completed game review" ||
    !reviewReadout.graphTooltip.includes("Chance -1.5%") ||
    !reviewReadout.graphValueText.includes("Black practical winning chance dropped by 1.5 percentage points") ||
    reviewReadout.overflowX > 2
  ) {
    throw new Error(`Completed review readout did not expose quality breakdown and study focus: ${JSON.stringify(reviewReadout)}`);
  }
  await page.getByTestId("review-moment-side-filter").selectOption("black");
  await page.waitForFunction(() => document.querySelector('[data-testid="review-moment-count"]')?.textContent?.trim() === "0/1", null, { timeout: 5000 });
  const blackFilteredMoments = await page.evaluate(() => ({
    count: document.querySelector('[data-testid="review-moment-count"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
    cardCount: document.querySelectorAll(".review-moment-card").length,
    emptyText: document.querySelector(".review-panel .empty-state")?.textContent?.replace(/\s+/g, " ").trim() || "",
    sideFilter: document.querySelector('[data-testid="review-moment-side-filter"]')?.value || "",
    overflowX: document.body.scrollWidth - document.body.clientWidth,
  }));
  if (
    blackFilteredMoments.count !== "0/1" ||
    blackFilteredMoments.cardCount !== 0 ||
    !blackFilteredMoments.emptyText.includes("No moments match these filters.") ||
    blackFilteredMoments.sideFilter !== "black" ||
    blackFilteredMoments.overflowX > 2
  ) {
    throw new Error(`Review side filter did not narrow key moments: ${JSON.stringify(blackFilteredMoments)}`);
  }

  await page.getByTestId("review-moment-side-filter").selectOption("all");
  await page.getByTestId("review-moment-quality-filter").selectOption("mistake");
  await page.waitForFunction(() => document.querySelector('[data-testid="review-moment-count"]')?.textContent?.trim() === "1/1", null, { timeout: 5000 });
  const mistakeFilteredMoments = await page.evaluate(() => ({
    count: document.querySelector('[data-testid="review-moment-count"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
    cardCount: document.querySelectorAll(".review-moment-card").length,
    qualityFilter: document.querySelector('[data-testid="review-moment-quality-filter"]')?.value || "",
    firstMoment: document.querySelector('[data-testid="review-moment-0"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
    overflowX: document.body.scrollWidth - document.body.clientWidth,
  }));
  if (
    mistakeFilteredMoments.count !== "1/1" ||
    mistakeFilteredMoments.cardCount !== 1 ||
    mistakeFilteredMoments.qualityFilter !== "mistake" ||
    !mistakeFilteredMoments.firstMoment.includes("Mistake") ||
    mistakeFilteredMoments.overflowX > 2
  ) {
    throw new Error(`Review severity filter did not keep the matching key moment: ${JSON.stringify(mistakeFilteredMoments)}`);
  }

  await page.getByTestId("review-moment-quality-filter").selectOption("blunder");
  await page.waitForFunction(() => document.querySelector('[data-testid="review-moment-count"]')?.textContent?.trim() === "0/1", null, { timeout: 5000 });
  const blunderFilteredMoments = await page.evaluate(() => ({
    count: document.querySelector('[data-testid="review-moment-count"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
    cardCount: document.querySelectorAll(".review-moment-card").length,
    emptyText: document.querySelector(".review-panel .empty-state")?.textContent?.replace(/\s+/g, " ").trim() || "",
    qualityFilter: document.querySelector('[data-testid="review-moment-quality-filter"]')?.value || "",
    overflowX: document.body.scrollWidth - document.body.clientWidth,
  }));
  if (
    blunderFilteredMoments.count !== "0/1" ||
    blunderFilteredMoments.cardCount !== 0 ||
    !blunderFilteredMoments.emptyText.includes("No moments match these filters.") ||
    blunderFilteredMoments.qualityFilter !== "blunder" ||
    blunderFilteredMoments.overflowX > 2
  ) {
    throw new Error(`Review severity filter did not empty unmatched key moments: ${JSON.stringify(blunderFilteredMoments)}`);
  }

  await page.getByTestId("review-moment-quality-filter").selectOption("all");
  await page.waitForSelector('[data-testid="review-try-best-0"]', { timeout: 5000 });
  await page.getByTestId("save-game-btn").click();
  await page.getByTestId("save-game-btn").getByText("Saved").waitFor({ timeout: 5000 });
  const resavedReview = await page.evaluate(() => {
    const games = JSON.parse(localStorage.getItem("xiangqi:library:v1") || "[]");
    const copy = games.find((game) => game.id !== "review-best-branch" && game.review);
    return {
      count: games.length,
      annotationChance: copy?.review?.annotations?.[0]?.winPercentLoss,
      keyMomentChance: copy?.review?.summary?.keyMoments?.[0]?.winPercentLoss,
      overflowX: document.body.scrollWidth - document.body.clientWidth,
    };
  });
  if (
    resavedReview.count !== 2 ||
    typeof resavedReview.annotationChance !== "number" ||
    typeof resavedReview.keyMomentChance !== "number" ||
    Math.abs(resavedReview.annotationChance - 20.75881993130915) > 0.001 ||
    Math.abs(resavedReview.keyMomentChance - 20.75881993130915) > 0.001 ||
    resavedReview.overflowX > 2
  ) {
    throw new Error(`Loaded review chance loss was not preserved when re-saving: ${JSON.stringify(resavedReview)}`);
  }
  await page.getByTestId("review-try-best-0").click();
  await page.getByTestId("move-tree-active").waitFor({ timeout: 5000 });
  const state = await page.evaluate(() => ({
    active: document.querySelector('[data-testid="move-tree-active"]')?.textContent?.trim() || "",
    variations: [...document.querySelectorAll(".mtree-variation")].map((el) => el.textContent?.trim() || "").join(" "),
    selectedTab: document.querySelector('[data-testid="analysis-tab-tree"]')?.getAttribute("aria-selected") || "",
    overflowX: document.body.scrollWidth - document.body.clientWidth,
  }));
  if (!state.active.includes("b0c2") || !state.variations.includes("b2e2") || state.selectedTab !== "true" || state.overflowX > 2) {
    throw new Error(`Review best-move action did not create a visible study branch: ${JSON.stringify(state)}`);
  }
}

async function assertLastMoveArrowUsesPracticalReviewQuality(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.evaluate(() => {
    localStorage.setItem("xiangqi:library:v1", JSON.stringify([{
      id: "decisive-arrow-quality",
      savedAt: 1710000006000,
      gameMode: "PvP",
      moves: ["b2e2", "h9g7", "b0c2"],
      result: "ongoing",
      label: "Decisive arrow quality QA",
      review: {
        summary: {
          totalMoves: 3,
          accuracy: 82,
          averageCentipawnLoss: 123,
          redAccuracy: 75,
          blackAccuracy: 95,
          redAverageCentipawnLoss: 175,
          blackAverageCentipawnLoss: 0,
          bestCount: 1,
          goodCount: 1,
          inaccuracyCount: 1,
          mistakeCount: 0,
          blunderCount: 0,
          reviewedAt: 1710000006000,
          lineSignature: "b2e2 h9g7 b0c2",
          keyMoments: [{
            nodeId: "saved-2",
            moveIndex: 2,
            jumpTarget: 2,
            ply: 3,
            side: "red",
            quality: "inaccuracy",
            swing: 350,
            winPercentLoss: 5.9,
            evalBefore: 1000,
            evalAfter: 650,
            bestMove: "h0g2",
            playedMove: "b0c2",
            note: "Still winning, but H0->G2 kept more of the advantage (350cp).",
          }],
        },
        annotations: [
          { moveIndex: 0, evalScore: 20, quality: "good", swing: 20, reviewNote: "Solid choice." },
          { moveIndex: 1, evalScore: 1000, quality: "best", swing: 0, reviewNote: "Engine-approved move." },
          { moveIndex: 2, evalScore: 650, bestMove: "h0g2", quality: "inaccuracy", swing: 350, winPercentLoss: 5.9, reviewNote: "Still winning, but H0->G2 kept more of the advantage (350cp)." },
        ],
      },
    }]));
  });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });
  await page.locator('button[aria-label="Open game library"]').click();
  await page.getByTestId("load-saved-decisive-arrow-quality").click();
  await page.waitForFunction(() => {
    const arrow = document.querySelector('.board-arrow-last[data-from="1:0"][data-to="2:2"] path');
    return arrow?.getAttribute("stroke") === "#facc15";
  }, null, { timeout: 5000 });

  const state = await page.evaluate(() => ({
    arrowStroke: document.querySelector('.board-arrow-last[data-from="1:0"][data-to="2:2"] path')?.getAttribute("stroke") || "",
    reviewMoment: document.querySelector('[data-testid="review-moment-2"]')?.getAttribute("aria-label") || "",
    overflowX: document.body.scrollWidth - document.body.clientWidth,
  }));
  if (
    state.arrowStroke !== "#facc15" ||
    !state.reviewMoment.includes("Inaccuracy review moment") ||
    state.overflowX > 2
  ) {
    throw new Error(`Last-move arrow did not follow practical review quality: ${JSON.stringify(state)}`);
  }
}

async function assertRunningReviewCancelsOnLineChange(browser) {
  const { context, page } = await newIsolatedPage(browser);
  try {
    await installFakePikafish(page, { variant: "fake-review-hangs" });
    await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForSelector(".xiangqi-board", { timeout: 30000 });

    await page.getByRole("button", { name: "Start new game" }).click();
    await page.getByTestId("uci-line-input").fill('[Variant "Xiangqi"]\n1. b2e2');
    await page.getByTestId("import-uci-line-btn").click();
    await page.getByTestId("move-tree-row-label-0").waitFor({ timeout: 5000 });
    await page.getByTestId("analysis-tab-review").click();
    // Live analysis and the review now send the same command for the same
    // position -- that is the fix being checked elsewhere -- so the counter
    // cannot tell them apart by string any more. Reset it here and everything
    // counted from now on belongs to the review.
    await page.evaluate(() => { window.__reviewPositionCounts = {}; });
    await page.getByTestId("start-review-btn").click();
    await page.getByTestId("cancel-review-bottom-btn").waitFor({ timeout: 5000 });

    await page.getByLabel("h9, black horse").click();
    await page.getByLabel("g7, empty, legal move").click();
    await page.waitForFunction(() => {
      return !document.querySelector('[data-testid="cancel-review-bottom-btn"]') &&
        Boolean(document.querySelector('[data-testid="start-review-bottom-btn"]'));
    }, null, { timeout: 5000 });

    const state = await page.evaluate(() => ({
      moveMeta: document.querySelector(".wc-meta strong")?.textContent?.replace(/\s+/g, " ").trim() || "",
      lastMoveArrow: Boolean(document.querySelector('.board-arrow-last[data-from="7:9"][data-to="6:7"]')),
      cancelExists: Boolean(document.querySelector('[data-testid="cancel-review-bottom-btn"]')),
      restartExists: Boolean(document.querySelector('[data-testid="start-review-bottom-btn"]')),
      reviewPanelText: document.querySelector(".review-panel")?.textContent?.replace(/\s+/g, " ").trim() || "",
      stopSent: (window.__engineCommands || []).includes("stop"),
      overflowX: document.body.scrollWidth - document.body.clientWidth,
    }));
    if (
      state.moveMeta !== "2 / 2" ||
      !state.lastMoveArrow ||
      state.cancelExists ||
      !state.restartExists ||
      // The panel offers the run affordance again once the review is cancelled.
      // Was "Run a review", which the copy stopped saying on 2026-08-26; the
      // assertion was not updated and the Playwright ordering bug above failed
      // first, so this never got a chance to be seen.
      !state.reviewPanelText.includes("Run Review") ||
      !state.stopSent ||
      state.overflowX > 2
    ) {
      throw new Error(`Running review did not cancel after the reviewed line changed: ${JSON.stringify(state)}`);
    }
  } finally {
    await context.close();
  }
}

async function assertReviewMomentFiltersResetOnLoad(browser) {
  const { context, page } = await newIsolatedPage(browser);
  try {
    await page.setViewportSize({ width: 1280, height: 820 });
    await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.evaluate(() => {
      const moves = ["b2e2", "h9g7"];
      localStorage.setItem("xiangqi:library:v1", JSON.stringify([
        {
          id: "qa-review-filter-a",
          savedAt: 1710000001000,
          gameMode: "PvP",
          moves,
          result: "ongoing",
          label: "Filter Reset Mistake QA",
          review: {
            summary: {
              totalMoves: 2,
              accuracy: 66,
              redAccuracy: 39,
              blackAccuracy: 93,
              bestCount: 0,
              goodCount: 1,
              inaccuracyCount: 0,
              mistakeCount: 1,
              blunderCount: 0,
              reviewedAt: 1710000001000,
              lineSignature: "b2e2 h9g7",
              keyMoments: [{
                nodeId: "saved-0",
                moveIndex: 0,
                jumpTarget: 0,
                ply: 1,
                side: "red",
                quality: "mistake",
                swing: 240,
                winPercentLoss: 20.75881993130915,
                evalBefore: 0,
                evalAfter: -240,
                bestMove: "b0c2",
                playedMove: "b2e2",
                note: "Red missed a stronger continuation. B0->C2 was stronger by 240cp.",
              }],
            },
            annotations: [
              { moveIndex: 0, evalScore: -240, bestMove: "b0c2", quality: "mistake", swing: 240, winPercentLoss: 20.75881993130915, reviewNote: "Red missed a stronger continuation. B0->C2 was stronger by 240cp." },
              { moveIndex: 1, evalScore: -220, quality: "good", swing: 20, winPercentLoss: 1.5, reviewNote: "Solid choice." },
            ],
          },
        },
        {
          id: "qa-review-filter-b",
          savedAt: 1710000002000,
          gameMode: "PvP",
          moves,
          result: "ongoing",
          label: "Filter Reset Blunder QA",
          review: {
            summary: {
              totalMoves: 2,
              accuracy: 51,
              redAccuracy: 81,
              blackAccuracy: 22,
              bestCount: 0,
              goodCount: 1,
              inaccuracyCount: 0,
              mistakeCount: 0,
              blunderCount: 1,
              reviewedAt: 1710000002000,
              lineSignature: "b2e2 h9g7",
              keyMoments: [{
                nodeId: "saved-1",
                moveIndex: 1,
                jumpTarget: 1,
                ply: 2,
                side: "black",
                quality: "blunder",
                swing: 520,
                winPercentLoss: 35,
                evalBefore: -240,
                evalAfter: 260,
                bestMove: "b9c7",
                playedMove: "h9g7",
                note: "Black missed a defensive resource. B9->C7 was stronger by 520cp.",
              }],
            },
            annotations: [
              { moveIndex: 0, evalScore: -240, quality: "good", swing: 20, winPercentLoss: 1.5, reviewNote: "Solid choice." },
              { moveIndex: 1, evalScore: 260, bestMove: "b9c7", quality: "blunder", swing: 520, winPercentLoss: 35, reviewNote: "Black missed a defensive resource. B9->C7 was stronger by 520cp." },
            ],
          },
        },
      ]));
    });
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector(".xiangqi-board", { timeout: 30000 });

    await page.locator('button[aria-label="Open game library"]').click();
    await page.getByTestId("load-saved-qa-review-filter-a").click();
    await page.getByTestId("review-moment-quality-filter").selectOption("mistake");
    await page.waitForFunction(() => {
      return document.querySelector('[data-testid="review-moment-quality-filter"]')?.value === "mistake" &&
        document.querySelector('[data-testid="review-moment-count"]')?.textContent?.trim() === "1/1";
    }, null, { timeout: 5000 });

    await page.locator('button[aria-label="Open game library"]').click();
    await page.getByTestId("load-saved-qa-review-filter-b").click();
    await page.waitForFunction(() => {
      return document.querySelector('[data-testid="review-moment-side-filter"]')?.value === "all" &&
        document.querySelector('[data-testid="review-moment-quality-filter"]')?.value === "all" &&
        document.querySelector('[data-testid="review-moment-count"]')?.textContent?.trim() === "1/1";
    }, null, { timeout: 5000 });

    const state = await page.evaluate(() => ({
      count: document.querySelector('[data-testid="review-moment-count"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
      sideFilter: document.querySelector('[data-testid="review-moment-side-filter"]')?.value || "",
      qualityFilter: document.querySelector('[data-testid="review-moment-quality-filter"]')?.value || "",
      momentText: document.querySelector('[data-testid="review-moment-1"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
      momentLabel: document.querySelector('[data-testid="review-moment-1"]')?.getAttribute("aria-label") || "",
      momentEvalText: document.querySelector('[data-testid="review-moment-eval-1"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
      momentEvalLabel: document.querySelector('[data-testid="review-moment-eval-1"]')?.getAttribute("aria-label") || "",
      momentEvalTitle: document.querySelector('[data-testid="review-moment-eval-1"]')?.getAttribute("title") || "",
      focusText: document.querySelector('[data-testid="review-focus-card"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
      focusEvalText: document.querySelector('[data-testid="review-focus-eval"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
      focusEvalLabel: document.querySelector('[data-testid="review-focus-eval"]')?.getAttribute("aria-label") || "",
      focusEvalTitle: document.querySelector('[data-testid="review-focus-eval"]')?.getAttribute("title") || "",
      overflowX: document.body.scrollWidth - document.body.clientWidth,
    }));
    if (
      state.count !== "1/1" ||
      state.sideFilter !== "all" ||
      state.qualityFilter !== "all" ||
      !state.momentText.includes("Blunder") ||
      !state.momentText.includes("H9→G7") ||
      !state.momentText.includes("Black POV") ||
      !state.momentEvalText.includes("Black POV") ||
      !state.momentEvalText.includes("+2.40") ||
      !state.momentEvalText.includes("-2.60") ||
      state.momentEvalLabel !== "Black evaluation changed from +2.40 to -2.60" ||
      state.momentEvalTitle !== "Black POV: +2.40 → -2.60" ||
      !state.momentLabel.includes("Black evaluation changed from +2.40 to -2.60") ||
      !state.focusText.includes("Blunder at ply 2") ||
      !state.focusEvalText.includes("Black POV") ||
      state.focusEvalLabel !== "Black evaluation changed from +2.40 to -2.60" ||
      state.focusEvalTitle !== "Black POV: +2.40 → -2.60" ||
      state.overflowX > 2
    ) {
      throw new Error(`Review filters did not reset after loading another review: ${JSON.stringify(state)}`);
    }
  } finally {
    await context.close();
  }
}

async function assertReviewRevisitRefreshesDecisionBestMove(browser) {
  const { context, page } = await newIsolatedPage(browser);
  try {
    await installFakePikafish(page, { variant: "fake-review-revisit" });
    await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForSelector(".xiangqi-board", { timeout: 30000 });

    await page.getByRole("button", { name: "Start new game" }).click();
    await page.getByTestId("uci-line-input").fill('[Variant "Xiangqi"]\n1. b2e2 h9g7');
    await page.getByTestId("import-uci-line-btn").click();
    await page.getByTestId("move-tree-row-label-0").waitFor({ timeout: 5000 });
    await page.getByTestId("analysis-tab-review").click();
    // Live analysis and the review now send the same command for the same
    // position -- that is the fix being checked elsewhere -- so the counter
    // cannot tell them apart by string any more. Reset it here and everything
    // counted from now on belongs to the review.
    await page.evaluate(() => { window.__reviewPositionCounts = {}; });
    await page.getByTestId("start-review-btn").click();
    await page.getByTestId("review-try-best-0").waitFor({ timeout: 10000 });

    const state = await page.evaluate(() => {
      // The root is the position command with no move list after it. It used
      // to be recognised by its FEN; the review now sends `position startpos
      // moves ...` like live analysis does, so the root is the one with
      // nothing to append.
      const rootSearches = Object.entries(window.__reviewPositionCounts || {})
        .filter(([position]) => !position.includes(" moves "))
        .reduce((sum, [, count]) => sum + Number(count || 0), 0);
      return {
        tryBestText: document.querySelector('[data-testid="review-try-best-0"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
        tryBestLabel: document.querySelector('[data-testid="review-try-best-0"]')?.getAttribute("aria-label") || "",
        focusText: document.querySelector('[data-testid="review-focus-card"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
        rootSearches,
        overflowX: document.body.scrollWidth - document.body.clientWidth,
      };
    });

    if (
      !state.tryBestText.includes("B0→C2") ||
      state.tryBestText.includes("H2→E2") ||
      !state.tryBestLabel.includes("B0→C2") ||
      !state.focusText.includes("B0→C2") ||
      state.rootSearches < 2 ||
      state.overflowX > 2
    ) {
      throw new Error(`Review revisit did not refresh the decision-point best move: ${JSON.stringify(state)}`);
    }
  } finally {
    await context.close();
  }
}

async function assertReviewRevisitIgnoresGoodScoreSwings(browser) {
  const { context, page } = await newIsolatedPage(browser);
  try {
    await installFakePikafish(page, { variant: "fake-review-good-swing" });
    await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForSelector(".xiangqi-board", { timeout: 30000 });

    await page.getByRole("button", { name: "Start new game" }).click();
    await page.getByTestId("uci-line-input").fill('[Variant "Xiangqi"]\n1. b2e2 h9g7');
    await page.getByTestId("import-uci-line-btn").click();
    await page.getByTestId("move-tree-row-label-0").waitFor({ timeout: 5000 });
    await page.getByTestId("analysis-tab-review").click();
    // Live analysis and the review now send the same command for the same
    // position -- that is the fix being checked elsewhere -- so the counter
    // cannot tell them apart by string any more. Reset it here and everything
    // counted from now on belongs to the review.
    await page.evaluate(() => { window.__reviewPositionCounts = {}; });
    await page.getByTestId("start-review-btn").click();
    await page.getByTestId("rerun-review-btn").waitFor({ timeout: 10000 });

    const state = await page.evaluate(() => {
      // See the note in the revisit check: the root is the position command
      // with no move list after it.
      const rootSearches = Object.entries(window.__reviewPositionCounts || {})
        .filter(([position]) => !position.includes(" moves "))
        .reduce((sum, [, count]) => sum + Number(count || 0), 0);
      return {
        focusText: document.querySelector('[data-testid="review-focus-card"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
        tryBestCount: document.querySelectorAll('[data-testid^="review-try-best-"]').length,
        rootSearches,
        overflowX: document.body.scrollWidth - document.body.clientWidth,
      };
    });

    if (
      !state.focusText.includes("Clean main line") ||
      state.tryBestCount !== 0 ||
      state.rootSearches !== 1 ||
      state.overflowX > 2
    ) {
      throw new Error(`Review revisit spent deep search on a good score swing: ${JSON.stringify(state)}`);
    }
  } finally {
    await context.close();
  }
}

async function assertCompletedReviewRerunRespectsEngineState(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.evaluate(() => {
    const savedAt = 1710000006000;
    localStorage.setItem("xiangqi:library:v1", JSON.stringify([{
      id: "review-rerun-state",
      savedAt,
      gameMode: "PvP",
      moves: ["b2e2", "h9g7"],
      result: "ongoing",
      label: "Review rerun QA",
      review: {
        summary: {
          totalMoves: 2,
          accuracy: 76,
          bestCount: 1,
          goodCount: 1,
          inaccuracyCount: 0,
          mistakeCount: 0,
          blunderCount: 0,
          reviewedAt: savedAt,
          lineSignature: "b2e2 h9g7",
          keyMoments: [],
        },
        annotations: [
          { moveIndex: 0, evalScore: 35, quality: "best", swing: 20, reviewNote: "Best move." },
          { moveIndex: 1, evalScore: 20, quality: "good", swing: 15, reviewNote: "Solid choice." },
        ],
      },
    }]));
  });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });

  await page.locator('button[aria-label="Open game library"]').click();
  await page.getByTestId("load-saved-review-rerun-state").click();
  await page.getByTestId("rerun-review-btn").waitFor({ timeout: 5000 });
  await page.waitForFunction(() => {
    const button = document.querySelector('[data-testid="rerun-review-btn"]');
    return button && !button.disabled;
  }, null, { timeout: 30000 });

  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForFunction(() => {
    const button = document.querySelector('[data-testid="rerun-review-btn"]');
    return button && button.disabled;
  }, null, { timeout: 5000 });

  const state = await page.evaluate(() => {
    const rerun = document.querySelector('[data-testid="rerun-review-btn"]');
    const play = [...document.querySelectorAll(".top-mode-pills button")]
      .find((button) => button.textContent?.trim() === "Play");
    return {
      disabled: Boolean(rerun?.disabled),
      title: rerun?.getAttribute("title") || "",
      playPressed: play?.getAttribute("aria-pressed") || "",
      overflowX: document.body.scrollWidth - document.body.clientWidth,
    };
  });
  if (
    !state.disabled ||
    state.title !== "Switch to Analysis to review this line" ||
    state.playPressed !== "true" ||
    state.overflowX > 2
  ) {
    throw new Error(`Completed review rerun did not reflect engine availability: ${JSON.stringify(state)}`);
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

  await input.fill(Array.from({ length: 1025 }, () => "b2e2").join(" "));
  await page.getByTestId("import-uci-line-btn").click();
  await error.getByText("Move line is too large").waitFor({ timeout: 5000 });
  const oversizedState = await page.evaluate(() => ({
    errorText: document.querySelector("#new-game-line-error")?.textContent?.trim() || "",
    invalid: document.querySelector('[data-testid="uci-line-input"]')?.getAttribute("aria-invalid") || "",
    moveRows: document.querySelectorAll(".mtree-row").length,
    overflowX: document.body.scrollWidth - document.body.clientWidth,
  }));
  if (
    !oversizedState.errorText.includes("1024 moves or fewer") ||
    oversizedState.invalid !== "true" ||
    oversizedState.moveRows !== 0 ||
    oversizedState.overflowX > 2
  ) {
    throw new Error(`Oversized import did not fail cleanly: ${JSON.stringify(oversizedState)}`);
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

async function assertReplayedMoveKeepsChosenContinuation(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });

  await page.locator('.hitbox[data-file="1"][data-rank="2"]').click();
  await page.locator('.hitbox[data-file="4"][data-rank="2"]').click();
  await page.locator('.hitbox[data-file="1"][data-rank="9"]').click();
  await page.locator('.hitbox[data-file="2"][data-rank="7"]').click();
  await page.locator('.hitbox[data-file="2"][data-rank="3"]').click();
  await page.locator('.hitbox[data-file="2"][data-rank="4"]').click();

  await page.locator('.watch-controls button[aria-label="Go to previous move"]').click();
  await page.locator('.hitbox[data-file="7"][data-rank="0"]').click();
  await page.locator('.hitbox[data-file="6"][data-rank="2"]').click();

  await page.locator('.watch-controls button[aria-label="Go to previous move"]').click();
  await page.locator('.watch-controls button[aria-label="Go to previous move"]').click();
  await page.locator('.hitbox[data-file="1"][data-rank="9"]').click();
  await page.locator('.hitbox[data-file="2"][data-rank="7"]').click();
  await page.getByTestId("move-tree-row-label-0").waitFor({ timeout: 5000 });

  const state = await page.evaluate(() => ({
    rows: [...document.querySelectorAll(".mtree-row")].map((el) => el.textContent?.trim() || "").join(" "),
    variations: [...document.querySelectorAll(".mtree-variation")].map((el) => el.textContent?.trim() || "").join(" "),
    active: document.querySelector('[data-testid="move-tree-active"]')?.textContent?.trim() || "",
    activeCurrent: document.querySelector('[data-testid="move-tree-active"]')?.getAttribute("aria-current") || "",
    activeLabel: document.querySelector('[data-testid="move-tree-active"]')?.getAttribute("aria-label") || "",
    overflowX: document.body.scrollWidth - document.body.clientWidth,
  }));
  if (
    !state.active.includes("b9c7") ||
    state.activeCurrent !== "step" ||
    !state.activeLabel.includes("Current move") ||
    !state.activeLabel.includes("UCI B9→C7") ||
    !state.rows.includes("h0g2") ||
    !state.variations.includes("c3c4") ||
    state.overflowX > 2
  ) {
    throw new Error(`Replaying an existing move did not preserve the chosen continuation: ${JSON.stringify(state)}`);
  }
}

async function assertMoveTreeRespectsReducedMotion(page) {
  await page.emulateMedia({ reducedMotion: "reduce" });

  try {
    await page.setViewportSize({ width: 1280, height: 820 });
    await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForSelector(".xiangqi-board", { timeout: 30000 });
    await page.evaluate(() => {
      window.__moveTreeScrollCalls = [];
      window.__originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
      Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
        configurable: true,
        value(options) {
          window.__moveTreeScrollCalls.push(options || null);
          if (typeof window.__originalScrollIntoView === "function") {
            window.__originalScrollIntoView.call(this, options);
          }
        },
      });
    });

    await page.locator('.hitbox[data-file="1"][data-rank="2"]').click();
    await page.locator('.hitbox[data-file="4"][data-rank="2"]').click();
    await page.getByTestId("move-tree-active").waitFor({ timeout: 5000 });

    const calls = await page.evaluate(() => window.__moveTreeScrollCalls || []);
    if (!calls.some((call) => call && call.behavior === "auto" && call.block === "nearest")) {
      throw new Error(`Move tree did not disable smooth scroll for reduced motion: ${JSON.stringify(calls)}`);
    }

    const arrowMotionState = await page.evaluate(() => {
      const arrowGroup = document.querySelector(".board-arrow-group");
      return {
        arrowVisible: Boolean(arrowGroup),
        smilAnimations: document.querySelectorAll(".board-arrow-group animate").length,
        animationName: arrowGroup ? getComputedStyle(arrowGroup).animationName : "",
        bodyScrollBehavior: getComputedStyle(document.body).scrollBehavior,
        overflowX: document.body.scrollWidth - document.body.clientWidth,
      };
    });
    if (
      !arrowMotionState.arrowVisible ||
      arrowMotionState.smilAnimations !== 0 ||
      arrowMotionState.animationName !== "none" ||
      arrowMotionState.bodyScrollBehavior !== "auto" ||
      arrowMotionState.overflowX > 2
    ) {
      throw new Error(`Board arrows did not respect reduced motion: ${JSON.stringify(arrowMotionState)}`);
    }
  } finally {
    await page.evaluate(() => {
      if (typeof window.__originalScrollIntoView === "function") {
        HTMLElement.prototype.scrollIntoView = window.__originalScrollIntoView;
      }
    }).catch(() => {});
    await page.emulateMedia({ reducedMotion: "no-preference" });
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

async function assertRootStudyTreeShareExportSave(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });
  await page.evaluate(() => {
    localStorage.removeItem("xiangqi:library:v1");
    window.__rootStudyWrites = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.__rootStudyWrites.push(String(text));
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
  await page.locator('.watch-controls button[aria-label="Go to first position"]').click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="graph-current-point"]')?.textContent?.includes("Start"),
    null,
    { timeout: 5000 }
  );

  const rootActionState = await page.evaluate(() => ({
    shareDisabled: Boolean(document.querySelector('[data-testid="copy-share-link-btn"]')?.disabled),
    copyPgnDisabled: Boolean(document.querySelector('[data-testid="copy-pgn-btn"]')?.disabled),
    saveDisabled: Boolean(document.querySelector('[data-testid="save-game-btn"]')?.disabled),
    activeMove: Boolean(document.querySelector('[data-testid="move-tree-active"]')),
    currentPoint: document.querySelector('[data-testid="graph-current-point"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
    overflowX: document.body.scrollWidth - document.body.clientWidth,
  }));
  if (
    rootActionState.shareDisabled ||
    rootActionState.copyPgnDisabled ||
    rootActionState.saveDisabled ||
    rootActionState.activeMove ||
    !rootActionState.currentPoint.includes("Start") ||
    rootActionState.overflowX > 2
  ) {
    throw new Error(`Root study actions were not available while staying at Start: ${JSON.stringify(rootActionState)}`);
  }

  await page.getByTestId("copy-share-link-btn").click();
  await page.getByTestId("copy-share-link-btn").getByText("Copied").waitFor({ timeout: 5000 });
  await page.getByTestId("copy-pgn-btn").click();
  await page.getByTestId("copy-pgn-btn").getByText("Copied").waitFor({ timeout: 5000 });
  await page.getByTestId("save-game-btn").click();
  await page.getByTestId("save-game-btn").getByText("Saved").waitFor({ timeout: 5000 });

  const exported = await page.evaluate(() => {
    const copiedUrl = window.__rootStudyWrites?.[0] ?? "";
    const copiedPgn = window.__rootStudyWrites?.[1] ?? "";
    const saved = JSON.parse(localStorage.getItem("xiangqi:library:v1") || "[]")[0] || null;
    const parsed = new URL(copiedUrl);
    return {
      copiedUrl,
      copiedPgn,
      moves: parsed.searchParams.get("moves"),
      hasTree: parsed.searchParams.has("tree"),
      saved,
      overflowX: document.body.scrollWidth - document.body.clientWidth,
    };
  });
  if (
    exported.moves !== null ||
    !exported.hasTree ||
    !exported.copiedPgn.includes("1. b0c2 (1. b2e2 h9g7) *") ||
    exported.saved?.moves?.length !== 0 ||
    exported.saved?.moveTree?.length !== 2 ||
    exported.saved?.startFen ||
    exported.overflowX > 2
  ) {
    throw new Error(`Root study share/export/save did not preserve a root-position tree: ${JSON.stringify(exported)}`);
  }

  await page.locator('button[aria-label="Open game library"]').click();
  await page.getByTestId(`load-saved-${exported.saved.id}`).waitFor({ timeout: 5000 });
  const librarySummary = await page.evaluate((savedId) => {
    const card = document.querySelector(`[data-testid="load-saved-${savedId}"]`)?.closest(".lib-card");
    return {
      meta: card?.querySelector(".lib-card-meta")?.textContent?.replace(/\s+/g, " ").trim() || "",
      overflowX: document.body.scrollWidth - document.body.clientWidth,
    };
  }, exported.saved.id);
  if (
    !librarySummary.meta.includes("Start position") ||
    !librarySummary.meta.includes("2 study lines") ||
    librarySummary.overflowX > 2
  ) {
    throw new Error(`Root study library card did not summarize the study tree: ${JSON.stringify(librarySummary)}`);
  }
  await page.getByTestId(`load-saved-${exported.saved.id}`).click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="graph-current-point"]')?.textContent?.includes("Start"),
    null,
    { timeout: 5000 }
  );
  const loadedSaved = await page.evaluate(() => ({
    activeMove: Boolean(document.querySelector('[data-testid="move-tree-active"]')),
    rowText: [...document.querySelectorAll(".mtree-row")].map((el) => el.textContent?.trim() || "").join(" "),
    variations: [...document.querySelectorAll(".mtree-variation")].map((el) => el.textContent?.trim() || "").join(" "),
    fen: document.querySelector(".bottombar-fen")?.getAttribute("title") || "",
    overflowX: document.body.scrollWidth - document.body.clientWidth,
  }));
  if (
    loadedSaved.activeMove ||
    !loadedSaved.rowText.includes("b2e2") ||
    !loadedSaved.rowText.includes("h9g7") ||
    !loadedSaved.variations.includes("b0c2") ||
    !loadedSaved.fen.includes("RNBAKABNR w - - 0 1") ||
    loadedSaved.overflowX > 2
  ) {
    throw new Error(`Saved root study did not reload at Start with visible branches: ${JSON.stringify(loadedSaved)}`);
  }

  await page.goto(exported.copiedUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByTestId("move-tree-row-label-0").waitFor({ timeout: 5000 });
  const loadedShare = await page.evaluate(() => ({
    activeMove: Boolean(document.querySelector('[data-testid="move-tree-active"]')),
    currentPoint: document.querySelector('[data-testid="graph-current-point"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
    rowText: [...document.querySelectorAll(".mtree-row")].map((el) => el.textContent?.trim() || "").join(" "),
    variations: [...document.querySelectorAll(".mtree-variation")].map((el) => el.textContent?.trim() || "").join(" "),
    fen: document.querySelector(".bottombar-fen")?.getAttribute("title") || "",
    overflowX: document.body.scrollWidth - document.body.clientWidth,
  }));
  if (
    loadedShare.activeMove ||
    !loadedShare.currentPoint.includes("Start") ||
    !loadedShare.rowText.includes("b2e2") ||
    !loadedShare.rowText.includes("h9g7") ||
    !loadedShare.variations.includes("b0c2") ||
    !loadedShare.fen.includes("RNBAKABNR w - - 0 1") ||
    loadedShare.overflowX > 2
  ) {
    throw new Error(`Root study share link did not preserve the Start view and branches: ${JSON.stringify(loadedShare)}`);
  }
}

async function assertOversizedShareTreeWarning(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.evaluate(() => {
    const branch = {
      uci: "b2e2",
      children: [{
        uci: "h9g7",
        children: [{
          uci: "b0c2",
          children: [{ uci: "b9c7" }],
        }],
      }],
    };
    localStorage.setItem("xiangqi:library:v1", JSON.stringify([{
      id: "qa-oversized-share-tree",
      savedAt: 1710000000000,
      gameMode: "PvP",
      moves: ["b2e2", "h9g7", "b0c2", "b9c7"],
      moveTree: Array.from({ length: 128 }, () => branch),
      result: "ongoing",
      label: "Oversized share tree QA",
    }]));
  });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate(() => {
    window.__oversizedShareWrites = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.__oversizedShareWrites.push(String(text));
        },
      },
    });
  });
  await page.locator('button[aria-label="Open game library"]').click();
  await page.getByText("Oversized share tree QA").waitFor({ timeout: 10000 });
  await page.getByTestId("load-saved-qa-oversized-share-tree").click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="graph-current-point"]')?.textContent?.includes("Ply 4"),
    null,
    { timeout: 5000 }
  );

  await page.getByTestId("copy-share-link-btn").click();
  await page.getByTestId("copy-share-link-btn").getByText("Copied").waitFor({ timeout: 5000 });
  await page.getByTestId("share-link-warning").getByText("Variations omitted").waitFor({ timeout: 5000 });

  const state = await page.evaluate(() => {
    const copiedUrl = window.__oversizedShareWrites?.[0] ?? "";
    const parsed = new URL(copiedUrl);
    return {
      moves: parsed.searchParams.get("moves"),
      hasTree: parsed.searchParams.has("tree"),
      warning: document.querySelector('[data-testid="share-link-warning"]')?.textContent?.trim() || "",
      brandTextHeight: document.querySelector(".app-brand-text")?.getBoundingClientRect().height ?? 0,
      brandWhiteSpace: document.querySelector(".app-brand-text")
        ? getComputedStyle(document.querySelector(".app-brand-text")).whiteSpace
        : "",
      overflowX: document.body.scrollWidth - document.body.clientWidth,
    };
  });

  if (
    state.moves !== "b2e2 h9g7 b0c2 b9c7" ||
    state.hasTree ||
    !state.warning.includes("Variations omitted") ||
    state.brandTextHeight > 22 ||
    state.brandWhiteSpace !== "nowrap" ||
    state.overflowX > 2
  ) {
    throw new Error(`Oversized study share did not warn and fall back to a mainline-only link: ${JSON.stringify(state)}`);
  }

  await page.locator('.hitbox[data-file="7"][data-rank="0"]').click();
  await page.locator('.hitbox[data-file="6"][data-rank="2"]').click();
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="share-link-warning"]'),
    null,
    { timeout: 5000 }
  );
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

async function assertInvalidShareTreeFallsBackToMainline(page) {
  const tree = [
    { uci: "b2e2", children: [{ uci: "h9g7" }] },
    { uci: "a0a9" },
  ];
  const url = `http://127.0.0.1:8192/web-xiangqi/?moves=b2e2%20h9g7&tree=${encodeShareTreeParam(tree)}`;
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.getByTestId("move-tree-row-label-0").waitFor({ timeout: 5000 });
  await page.getByTestId("share-link-warning").waitFor({ timeout: 5000 });
  const loaded = await page.evaluate(() => ({
    warning: document.querySelector('[data-testid="share-link-warning"]')?.textContent?.trim() || "",
    rows: [...document.querySelectorAll(".mtree-row")].map((el) => el.textContent?.trim() || "").join(" "),
    variations: [...document.querySelectorAll(".mtree-variation")].map((el) => el.textContent?.trim() || "").join(" "),
    activePoint: document.querySelector('[data-testid="graph-current-point"]')?.textContent?.trim() || "",
    overflowX: document.body.scrollWidth - document.body.clientWidth,
  }));
  if (
    !loaded.warning.includes("Shared variations not loaded") ||
    !loaded.rows.includes("b2e2") ||
    !loaded.rows.includes("h9g7") ||
    loaded.variations.includes("a0a9") ||
    !loaded.activePoint.includes("Black H9") ||
    loaded.overflowX > 2
  ) {
    throw new Error(`Invalid share tree did not fall back cleanly to the mainline: ${JSON.stringify(loaded)}`);
  }
}

async function assertMismatchedShareTreeFallsBackToMainline(page) {
  const tree = [
    { uci: "b2e2", children: [{ uci: "h9g7" }] },
  ];
  const url = `http://127.0.0.1:8192/web-xiangqi/?moves=b0c2&tree=${encodeShareTreeParam(tree)}`;
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.getByTestId("move-tree-row-label-0").waitFor({ timeout: 5000 });
  await page.getByTestId("share-link-warning").waitFor({ timeout: 5000 });
  const loaded = await page.evaluate(() => ({
    warning: document.querySelector('[data-testid="share-link-warning"]')?.textContent?.trim() || "",
    rows: [...document.querySelectorAll(".mtree-row")].map((el) => el.textContent?.trim() || "").join(" "),
    variations: [...document.querySelectorAll(".mtree-variation")].map((el) => el.textContent?.trim() || "").join(" "),
    activePoint: document.querySelector('[data-testid="graph-current-point"]')?.textContent?.trim() || "",
    overflowX: document.body.scrollWidth - document.body.clientWidth,
  }));
  if (
    !loaded.warning.includes("Shared variations not loaded") ||
    !loaded.rows.includes("b0c2") ||
    loaded.rows.includes("b2e2") ||
    loaded.variations.includes("h9g7") ||
    !loaded.activePoint.includes("Red B0") ||
    loaded.overflowX > 2
  ) {
    throw new Error(`Mismatched share tree did not fall back to the explicit mainline: ${JSON.stringify(loaded)}`);
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

  await page.goto("http://127.0.0.1:8192/web-xiangqi/?moves=not-a-xiangqi-move", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });
  await page.getByTestId("share-link-warning").waitFor({ timeout: 5000 });

  const malformedState = await page.evaluate(() => ({
    warning: document.querySelector('[data-testid="share-link-warning"]')?.textContent?.trim() || "",
    activePoint: document.querySelector('[data-testid="graph-current-point"]')?.textContent?.trim() || "",
    fen: document.querySelector(".bottombar-fen")?.getAttribute("title") || "",
    overflowX: document.body.scrollWidth - document.body.clientWidth,
  }));
  if (
    !malformedState.warning.includes("Shared link not loaded") ||
    !malformedState.activePoint.includes("Start") ||
    !malformedState.fen.includes(" w - - 0 1") ||
    malformedState.overflowX > 2
  ) {
    throw new Error(`Malformed share move parameter did not show feedback: ${JSON.stringify(malformedState)}`);
  }

  const impossibleFen = encodeURIComponent("4k4/4R4/9/9/9/9/9/9/9/4K4 w - - 0 1");
  await page.goto(`http://127.0.0.1:8192/web-xiangqi/?fen=${impossibleFen}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });
  await page.getByTestId("share-link-warning").waitFor({ timeout: 5000 });

  const impossibleFenState = await page.evaluate(() => ({
    warning: document.querySelector('[data-testid="share-link-warning"]')?.textContent?.trim() || "",
    activePoint: document.querySelector('[data-testid="graph-current-point"]')?.textContent?.trim() || "",
    fen: document.querySelector(".bottombar-fen")?.getAttribute("title") || "",
    overflowX: document.body.scrollWidth - document.body.clientWidth,
  }));
  if (
    !impossibleFenState.warning.includes("Shared link not loaded") ||
    !impossibleFenState.activePoint.includes("Start") ||
    !impossibleFenState.fen.includes(" w - - 0 1") ||
    impossibleFenState.overflowX > 2
  ) {
    throw new Error(`Impossible checked-side FEN did not show feedback: ${JSON.stringify(impossibleFenState)}`);
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

async function assertOversizedMoveLineFileRejected(page) {
  const importPath = path.resolve(__dirname, "..", ".move-line-oversized-test.pgn");
  fs.writeFileSync(importPath, "b2e2 ".repeat(42000));

  try {
    await page.setViewportSize({ width: 1280, height: 820 });
    await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForSelector(".xiangqi-board", { timeout: 30000 });

    await page.getByRole("button", { name: "Start new game" }).click();
    await page.getByTestId("uci-line-file-input").setInputFiles(importPath);
    await page.getByText("File is too large").waitFor({ timeout: 5000 });

    const state = await page.evaluate(() => {
      const input = document.querySelector('[data-testid="uci-line-input"]');
      const importButton = document.querySelector('[data-testid="import-uci-line-btn"]');
      return {
        valueLength: input && "value" in input ? String(input.value).length : -1,
        invalid: input?.getAttribute("aria-invalid") || "",
        describedBy: input?.getAttribute("aria-describedby") || "",
        fileNameVisible: Boolean(document.querySelector(".new-game-file-name")),
        importDisabled: Boolean(importButton?.disabled),
        error: document.querySelector("#new-game-line-error")?.textContent?.trim() || "",
        overflowX: document.body.scrollWidth - document.body.clientWidth,
      };
    });
    if (
      state.valueLength !== 0 ||
      state.invalid !== "true" ||
      state.describedBy !== "new-game-line-error" ||
      state.fileNameVisible ||
      !state.importDisabled ||
      !state.error.includes("1024 moves or fewer") ||
      state.overflowX > 2
    ) {
      throw new Error(`Oversized move-line file was not rejected cleanly: ${JSON.stringify(state)}`);
    }
  } finally {
    fs.rmSync(importPath, { force: true });
  }
}

async function assertOversizedMoveLinePasteRejected(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });

  await page.getByRole("button", { name: "Start new game" }).click();
  await page.getByTestId("uci-line-input").fill("b2e2 ".repeat(42000));
  await page.getByText("Move line is too large").waitFor({ timeout: 5000 });

  const state = await page.evaluate(() => {
    const input = document.querySelector('[data-testid="uci-line-input"]');
    const importButton = document.querySelector('[data-testid="import-uci-line-btn"]');
    return {
      valueLength: input && "value" in input ? String(input.value).length : -1,
      invalid: input?.getAttribute("aria-invalid") || "",
      describedBy: input?.getAttribute("aria-describedby") || "",
      importDisabled: Boolean(importButton?.disabled),
      error: document.querySelector("#new-game-line-error")?.textContent?.trim() || "",
      overflowX: document.body.scrollWidth - document.body.clientWidth,
    };
  });
  if (
    state.valueLength !== 0 ||
    state.invalid !== "true" ||
    state.describedBy !== "new-game-line-error" ||
    !state.importDisabled ||
    !state.error.includes("1024 moves or fewer") ||
    state.overflowX > 2
  ) {
    throw new Error(`Oversized pasted move line was not rejected cleanly: ${JSON.stringify(state)}`);
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

  await page.locator('.hitbox[data-file="4"][data-rank="4"]').focus();
  const markerShortcuts = await page.evaluate(() => document.activeElement?.getAttribute("aria-keyshortcuts") || "");
  if (!markerShortcuts.includes("Shift+Enter") || !markerShortcuts.includes("Shift+Space")) {
    throw new Error(`Board markers are not keyboard discoverable from square shortcuts: ${markerShortcuts}`);
  }

  await page.keyboard.press("Shift+Enter");
  await page.waitForFunction(() => document.querySelectorAll(".marker-highlight").length === 1, null, { timeout: 5000 });
  await page.keyboard.press("Shift+Space");
  await page.waitForFunction(() => document.querySelectorAll(".marker-highlight").length === 0, null, { timeout: 5000 });

  await page.locator('button[aria-label="Toggle board arrows and markers"]').click();
  await page.locator('.hitbox[data-file="4"][data-rank="4"]').focus();
  const hiddenMarkerShortcuts = await page.evaluate(() => document.activeElement?.getAttribute("aria-keyshortcuts") || "");
  if (hiddenMarkerShortcuts.includes("Shift+Enter") || hiddenMarkerShortcuts.includes("Shift+Space")) {
    throw new Error(`Hidden marker mode should not advertise marker shortcuts: ${hiddenMarkerShortcuts}`);
  }
  await page.keyboard.press("Shift+Enter");
  await page.waitForTimeout(100);
  const hiddenMarkerCount = await page.locator(".marker-highlight").count();
  if (hiddenMarkerCount !== 0) {
    throw new Error(`Hidden marker mode created an invisible marker: ${hiddenMarkerCount}`);
  }
  await page.locator('button[aria-label="Toggle board arrows and markers"]').click();

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
      mobileFirstLabel: document.querySelector(".mobile-board-nav .mobile-nav-btn")?.getAttribute("aria-label") || "",
      mobilePositionText: document.querySelector(".mobile-nav-label")?.textContent?.trim() || "",
      mobilePositionLabel: document.querySelector(".mobile-nav-label")?.getAttribute("aria-label") || "",
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
  if (
    layout.mobileFirstLabel !== "Go to first position" ||
    layout.mobilePositionText !== "No moves" ||
    layout.mobilePositionLabel !== "No moves"
  ) {
    throw new Error(`Mobile move navigation labels were unclear: ${JSON.stringify(layout)}`);
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
    localStorage.setItem("xiangqi:library:v1", JSON.stringify([{
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
  const initialDeleteLabels = await page.evaluate(() => {
    const button = document.querySelector('[data-testid="delete-saved-qa-delete-game"]');
    return {
      label: button?.getAttribute("aria-label") || "",
      title: button?.getAttribute("title") || "",
    };
  });
  if (
    initialDeleteLabels.label !== "Delete Delete confirmation QA" ||
    initialDeleteLabels.title !== "Delete Delete confirmation QA"
  ) {
    throw new Error(`Saved game delete action was not game-specific: ${JSON.stringify(initialDeleteLabels)}`);
  }

  await page.getByTestId("delete-saved-qa-delete-game").click();
  await page.getByTestId("confirm-delete-saved-qa-delete-game").waitFor({ timeout: 5000 });
  const pendingDeleteLabels = await page.evaluate(() => {
    const confirm = document.querySelector('[data-testid="confirm-delete-saved-qa-delete-game"]');
    const cancel = document.querySelector('[data-testid="cancel-delete-saved-qa-delete-game"]');
    return {
      confirmLabel: confirm?.getAttribute("aria-label") || "",
      confirmTitle: confirm?.getAttribute("title") || "",
      cancelLabel: cancel?.getAttribute("aria-label") || "",
      cancelTitle: cancel?.getAttribute("title") || "",
    };
  });
  if (
    pendingDeleteLabels.confirmLabel !== "Confirm delete Delete confirmation QA" ||
    pendingDeleteLabels.confirmTitle !== "Confirm delete Delete confirmation QA" ||
    pendingDeleteLabels.cancelLabel !== "Cancel delete Delete confirmation QA" ||
    pendingDeleteLabels.cancelTitle !== "Cancel delete Delete confirmation QA"
  ) {
    throw new Error(`Saved game delete confirmation controls were not game-specific: ${JSON.stringify(pendingDeleteLabels)}`);
  }
  if (await page.getByText("Delete confirmation QA").count() !== 1) {
    throw new Error("Saved game disappeared before delete confirmation.");
  }

  await page.getByRole("button", { name: "Cancel delete Delete confirmation QA" }).click();
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
    const raw = localStorage.getItem("xiangqi:library:v1");
    return raw ? JSON.parse(raw).length : 0;
  });
  if (remaining !== 0) {
    throw new Error(`Saved game remained in localStorage after confirmed delete: ${remaining}`);
  }
}

async function assertLibraryRespondsToStorageChanges(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.evaluate(() => {
    localStorage.setItem("xiangqi:library:v1", "[]");
  });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });

  await page.locator('button[aria-label="Open game library"]').click();
  await page.getByText("No saved games yet. Use the Save button to save the current game.").waitFor({ timeout: 10000 });

  await page.evaluate(() => {
    const key = "xiangqi:library:v1";
    const nextValue = JSON.stringify([{
      id: "qa-storage-sync-game",
      savedAt: 1710000000000,
      gameMode: "PvP",
      moves: ["b2e2"],
      result: "ongoing",
      label: "Storage sync QA",
    }]);
    localStorage.setItem(key, nextValue);
    window.dispatchEvent(new StorageEvent("storage", {
      key,
      newValue: nextValue,
      storageArea: localStorage,
    }));
  });

  await page.getByText("Storage sync QA").waitFor({ timeout: 5000 });
  const state = await page.evaluate(() => ({
    savedCards: document.querySelectorAll('[data-testid="saved-game-list"] .lib-card').length,
    summaryText: document.querySelector(".lib-summary-row")?.textContent?.replace(/\s+/g, " ").trim() || "",
    summaryLabel: document.querySelector(".lib-summary-row")?.getAttribute("aria-label") || "",
    overflowX: document.body.scrollWidth - document.body.clientWidth,
  }));
  if (
    state.savedCards !== 1 ||
    !state.summaryText.includes("1 saved") ||
    !state.summaryLabel.includes("1 saved game.") ||
    state.overflowX > 2
  ) {
    throw new Error(`Library did not refresh after storage change: ${JSON.stringify(state)}`);
  }
}

async function assertLibrarySavedGameSorting(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.evaluate(() => {
    const makeReview = (accuracy, redAccuracy, blackAccuracy, averageCentipawnLoss) => ({
      summary: {
        totalMoves: 1,
        accuracy,
        averageCentipawnLoss,
        redAccuracy,
        blackAccuracy,
        bestCount: 0,
        goodCount: 1,
        inaccuracyCount: 0,
        mistakeCount: 0,
        blunderCount: 0,
        reviewedAt: 1710000000000,
        lineSignature: "b2e2",
        keyMoments: [],
      },
      annotations: [{ moveIndex: 0, evalScore: 20, quality: "good", swing: 20, reviewNote: "Solid choice." }],
    });
    localStorage.setItem("xiangqi:library:v1", JSON.stringify([
      {
        id: "qa-sort-strong-red",
        savedAt: 1710000000500,
        gameMode: "PvP",
        moves: ["b2e2"],
        result: "ongoing",
        label: "Red Accuracy Peak QA",
        review: makeReview(70, 90, 99, 35),
      },
      {
        id: "qa-sort-high",
        savedAt: 1710000001000,
        gameMode: "PvP",
        moves: ["b2e2"],
        result: "ongoing",
        label: "High Accuracy QA",
        review: makeReview(92, 88, 95, 12),
      },
      {
        id: "qa-sort-low",
        savedAt: 1710000002000,
        gameMode: "PvP",
        moves: ["b2e2"],
        result: "ongoing",
        label: "Low Accuracy QA",
        review: makeReview(42, 35, 70, 280),
      },
      {
        id: "qa-sort-recent-unreviewed",
        savedAt: 1710000003000,
        gameMode: "PvP",
        moves: ["b2e2"],
        result: "ongoing",
        label: "Recent Unreviewed QA",
      },
    ]));
  });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });

  await page.locator('button[aria-label="Open game library"]').click();
  await page.getByLabel("Sort saved games").waitFor({ timeout: 5000 });

  const readOrder = async () => page.evaluate(() => ({
    labels: Array.from(document.querySelectorAll('[data-testid="saved-game-list"] .lib-game-name-button'))
      .map((node) => node.textContent?.trim() || ""),
    summaryText: document.querySelector(".lib-summary-row")?.textContent?.replace(/\s+/g, " ").trim() || "",
    summaryLabel: document.querySelector(".lib-summary-row")?.getAttribute("aria-label") || "",
    overflowX: document.body.scrollWidth - document.body.clientWidth,
  }));
  const assertOrder = async (sortValue, expectedPrefix, expectedSummary) => {
    await page.getByLabel("Sort saved games").selectOption(sortValue);
    await page.waitForFunction((expected) => {
      const labels = Array.from(document.querySelectorAll('[data-testid="saved-game-list"] .lib-game-name-button'))
        .map((node) => node.textContent?.trim() || "");
      return expected.every((label, index) => labels[index] === label);
    }, expectedPrefix, { timeout: 5000 });
    const state = await readOrder();
    if (
      expectedPrefix.some((label, index) => state.labels[index] !== label) ||
      !state.summaryLabel.includes(expectedSummary) ||
      !state.summaryText.includes("3 reviewed") ||
      !state.summaryText.includes("68% avg") ||
      !state.summaryText.includes("109cp loss") ||
      !state.summaryLabel.includes("3 reviewed games") ||
      !state.summaryLabel.includes("average accuracy 68%") ||
      !state.summaryLabel.includes("average centipawn loss 109cp") ||
      state.overflowX > 2
    ) {
      throw new Error(`Saved-game sort ${sortValue} produced the wrong order: ${JSON.stringify(state)}`);
    }
  };

  await assertOrder("recent", [
    "Recent Unreviewed QA",
    "Low Accuracy QA",
    "High Accuracy QA",
    "Red Accuracy Peak QA",
  ], "Sorted by Newest first.");
  await assertOrder("accuracy-high", [
    "High Accuracy QA",
    "Red Accuracy Peak QA",
    "Low Accuracy QA",
    "Recent Unreviewed QA",
  ], "Sorted by Highest accuracy.");
  await assertOrder("accuracy-low", [
    "Low Accuracy QA",
    "Red Accuracy Peak QA",
    "High Accuracy QA",
    "Recent Unreviewed QA",
  ], "Sorted by Lowest accuracy.");
  await assertOrder("average-loss-low", [
    "High Accuracy QA",
    "Red Accuracy Peak QA",
    "Low Accuracy QA",
    "Recent Unreviewed QA",
  ], "Sorted by Lowest avg loss.");
  await assertOrder("red-accuracy-high", [
    "Red Accuracy Peak QA",
    "High Accuracy QA",
    "Low Accuracy QA",
    "Recent Unreviewed QA",
  ], "Sorted by Red accuracy.");
  await assertOrder("black-accuracy-high", [
    "Red Accuracy Peak QA",
    "High Accuracy QA",
    "Low Accuracy QA",
    "Recent Unreviewed QA",
  ], "Sorted by Black accuracy.");

  await page.getByRole("button", { name: "Reset" }).click();
  await page.waitForFunction(() => {
    const labels = Array.from(document.querySelectorAll('[data-testid="saved-game-list"] .lib-game-name-button'))
      .map((node) => node.textContent?.trim() || "");
    return labels[0] === "Recent Unreviewed QA";
  }, null, { timeout: 5000 });
}

async function assertLargeLibraryRendersProgressively(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.evaluate(() => {
    const savedAtBase = 1710000000000;
    const games = Array.from({ length: 150 }, (_, index) => {
      const baseGame = {
        id: `qa-large-library-${index}`,
        savedAt: savedAtBase + index,
        gameMode: "PvP",
        moves: ["b2e2"],
        result: "ongoing",
        label: `Bulk saved game ${index}`,
      };
      if (index === 0) {
        return {
          ...baseGame,
          label: "Move metadata QA",
          moves: ["b0c2", "h9g7"],
          moveTree: [{ uci: "b0c2", children: [{ uci: "c0e2" }] }],
          review: {
            summary: {
              totalMoves: 2,
              accuracy: 51,
              averageCentipawnLoss: 220,
              redAccuracy: 42,
              blackAccuracy: 60,
              bestCount: 0,
              goodCount: 1,
              inaccuracyCount: 0,
              mistakeCount: 0,
              blunderCount: 1,
              reviewedAt: savedAtBase,
              lineSignature: "b0c2 h9g7",
              keyMoments: [{
                nodeId: "qa-large-library-0-0",
                moveIndex: 0,
                jumpTarget: 0,
                ply: 1,
                side: "red",
                quality: "blunder",
                swing: 420,
                winPercentLoss: 35,
                evalBefore: 0,
                evalAfter: -420,
                bestMove: "c0e2",
                playedMove: "b0c2",
                note: "Hidden branch move decides the study.",
              }],
            },
            annotations: [
              { moveIndex: 0, evalScore: -420, bestMove: "c0e2", quality: "blunder", swing: 420, winPercentLoss: 35, reviewNote: "Hidden branch move decides the study." },
              { moveIndex: 1, evalScore: -390, quality: "good", swing: 30, winPercentLoss: 2, reviewNote: "Solid reply." },
            ],
          },
        };
      }
      if (index === 1) {
        return {
          ...baseGame,
          label: "Needle hidden QA",
        };
      }
      return baseGame;
    });
    localStorage.setItem("xiangqi:library:v1", JSON.stringify(games));
  });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });

  await page.locator('button[aria-label="Open game library"]').click();
  await page.getByTestId("library-show-more-saved").waitFor({ timeout: 10000 });

  const initial = await page.evaluate(() => ({
    searchPlaceholder: document.querySelector('[aria-label="Search library"]')?.getAttribute("placeholder") || "",
    savedCards: document.querySelectorAll('[data-testid="saved-game-list"] .lib-card').length,
    historicalCards: document.querySelectorAll('[data-testid="historical-game-list"] .lib-card').length,
    showMoreText: document.querySelector('[data-testid="library-show-more-saved"]')?.textContent?.trim() || "",
    needleVisible: document.body.textContent?.includes("Needle hidden QA") || false,
    overflowX: document.body.scrollWidth - document.body.clientWidth,
  }));
  if (
    initial.savedCards !== 100 ||
    initial.historicalCards !== 10 ||
    !initial.searchPlaceholder.includes("moves") ||
    !initial.searchPlaceholder.includes("reviews") ||
    !initial.showMoreText.includes("50 more") ||
    initial.needleVisible ||
    initial.overflowX > 2
  ) {
    throw new Error(`Large library did not render progressively: ${JSON.stringify(initial)}`);
  }

  await page.getByTestId("library-show-more-saved").click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="saved-game-list"] .lib-card').length === 150, null, { timeout: 5000 });

  await page.getByLabel("Search library").fill("Needle hidden QA");
  await page.waitForFunction(() => {
    const cards = document.querySelectorAll('[data-testid="saved-game-list"] .lib-card');
    return cards.length === 1 && document.body.textContent?.includes("Needle hidden QA");
  }, null, { timeout: 5000 });

  const searched = await page.evaluate(() => ({
    savedCards: document.querySelectorAll('[data-testid="saved-game-list"] .lib-card').length,
    needleVisible: document.body.textContent?.includes("Needle hidden QA") || false,
    showMoreVisible: Boolean(document.querySelector('[data-testid="library-show-more-saved"]')),
    overflowX: document.body.scrollWidth - document.body.clientWidth,
  }));
  if (searched.savedCards !== 1 || !searched.needleVisible || searched.showMoreVisible || searched.overflowX > 2) {
    throw new Error(`Large library search did not reach hidden saved games: ${JSON.stringify(searched)}`);
  }

  await page.getByLabel("Search library").fill("c0e2");
  await page.waitForFunction(() => {
    const cards = document.querySelectorAll('[data-testid="saved-game-list"] .lib-card');
    return cards.length === 1 && document.body.textContent?.includes("Move metadata QA");
  }, null, { timeout: 5000 });

  const branchSearched = await page.evaluate(() => ({
    savedCards: document.querySelectorAll('[data-testid="saved-game-list"] .lib-card').length,
    metadataVisible: document.body.textContent?.includes("Move metadata QA") || false,
    needleVisible: document.body.textContent?.includes("Needle hidden QA") || false,
    showMoreVisible: Boolean(document.querySelector('[data-testid="library-show-more-saved"]')),
    overflowX: document.body.scrollWidth - document.body.clientWidth,
  }));
  if (
    branchSearched.savedCards !== 1 ||
    !branchSearched.metadataVisible ||
    branchSearched.needleVisible ||
    branchSearched.showMoreVisible ||
    branchSearched.overflowX > 2
  ) {
    throw new Error(`Large library search did not find hidden branch moves: ${JSON.stringify(branchSearched)}`);
  }

  await page.getByLabel("Search library").fill("blunder");
  await page.waitForFunction(() => {
    const cards = document.querySelectorAll('[data-testid="saved-game-list"] .lib-card');
    return cards.length === 1 && document.body.textContent?.includes("1 blunder");
  }, null, { timeout: 5000 });

  const reviewSearched = await page.evaluate(() => ({
    savedCards: document.querySelectorAll('[data-testid="saved-game-list"] .lib-card').length,
    metadataVisible: document.body.textContent?.includes("Move metadata QA") || false,
    reviewText: document.querySelector('[data-testid="review-blunders-saved-qa-large-library-0"]')?.textContent?.trim() || "",
    showMoreVisible: Boolean(document.querySelector('[data-testid="library-show-more-saved"]')),
    overflowX: document.body.scrollWidth - document.body.clientWidth,
  }));
  if (
    reviewSearched.savedCards !== 1 ||
    !reviewSearched.metadataVisible ||
    reviewSearched.reviewText !== "1 blunder" ||
    reviewSearched.showMoreVisible ||
    reviewSearched.overflowX > 2
  ) {
    throw new Error(`Large library search did not find hidden review metadata: ${JSON.stringify(reviewSearched)}`);
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
    localStorage.setItem("xiangqi:library:v1", JSON.stringify([
      {
        id: "qa-copy-pgn-game",
        savedAt: 1710000000000,
        gameMode: "PvAI-Black",
        moves: ["a6a5", "a3a4"],
        startFen: fen,
        result: "ongoing",
        label: "PGN copy QA",
        opening: "Custom study",
      },
      {
        id: "qa-mismatched-tree-pgn-game",
        savedAt: 1710000001000,
        gameMode: "PvP",
        moves: ["b0c2"],
        moveTree: [{ uci: "b2e2", children: [{ uci: "h9g7" }] }],
        result: "ongoing",
        label: "Mismatched tree PGN QA",
      },
    ]));
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
  await page.getByRole("button", { name: "Copied PGN for PGN copy QA" }).waitFor({ timeout: 5000 });

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

  await page.getByText("Mismatched tree PGN QA").waitFor({ timeout: 10000 });
  await page.getByTestId("copy-pgn-saved-qa-mismatched-tree-pgn-game").click();
  await page.getByRole("button", { name: "Copied PGN for Mismatched tree PGN QA" }).waitFor({ timeout: 5000 });
  const fallbackPgn = await page.evaluate(() => window.__libraryPgnWrites?.at(-1) ?? "");
  if (!fallbackPgn.includes("1. b0c2 *") || fallbackPgn.includes("b2e2")) {
    throw new Error(`Saved-game PGN exported a tree branch that does not contain the saved mainline:\n${fallbackPgn}`);
  }
}

async function assertSavedStudyTreeRoundTrip(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.evaluate(() => {
    localStorage.removeItem("xiangqi:library:v1");
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
    const raw = localStorage.getItem("xiangqi:library:v1");
    if (!raw) return null;
    const games = JSON.parse(raw);
    return games.length === 1 ? games[0] : null;
  }, null, { timeout: 5000 }).then((handle) => handle.jsonValue());
  if (!saved?.id || saved.moves?.join(" ") !== "b0c2" || saved.moveTree?.length !== 2) {
    throw new Error(`Saved study tree did not persist the mainline and branches: ${JSON.stringify(saved)}`);
  }

  await page.locator('button[aria-label="Open game library"]').click();
  await page.getByTestId(`copy-pgn-saved-${saved.id}`).click();
  await page.waitForFunction((savedId) => {
    return (document.querySelector(`[data-testid="copy-pgn-saved-${savedId}"]`)?.getAttribute("aria-label") || "").startsWith("Copied PGN for ");
  }, saved.id, { timeout: 5000 });
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

async function assertVariationPreviewMatchesNavigation(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.evaluate(() => {
    localStorage.setItem("xiangqi:library:v1", JSON.stringify([
      {
        id: "qa-variation-preview",
        savedAt: 1710000000000,
        gameMode: "PvP",
        moves: ["h2e2"],
        moveTree: [
          { uci: "h2e2" },
          { uci: "b0c2", children: [{ uci: "b9c7" }, { uci: "h9g7" }] },
        ],
        result: "ongoing",
        label: "Variation Preview QA",
      },
    ]));
  });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.locator('button[aria-label="Open game library"]').click();
  await page.getByTestId("load-saved-qa-variation-preview").click();
  await page.waitForFunction(() => document.querySelector(".mtree-row")?.textContent?.includes("h2e2"), null, { timeout: 5000 });

  const preview = await page.evaluate(() => ({
    activeRow: document.querySelector(".mtree-row")?.textContent?.replace(/\s+/g, " ").trim() || "",
    variationText: [...document.querySelectorAll(".mtree-variation")].map((el) => el.textContent?.replace(/\s+/g, " ").trim() || "").join(" "),
    overflowX: document.body.scrollWidth - document.body.clientWidth,
  }));
  if (
    !preview.activeRow.includes("h2e2") ||
    !preview.variationText.includes("b0c2") ||
    !preview.variationText.includes("h9g7") ||
    preview.variationText.includes("b9c7") ||
    preview.overflowX > 2
  ) {
    throw new Error(`Variation preview did not match the preferred continuation: ${JSON.stringify(preview)}`);
  }

  await page.evaluate(() => {
    const branch = [...document.querySelectorAll(".mtree-variation .mtree-chip")]
      .find((el) => el.textContent?.includes("b0c2"));
    branch?.click();
  });
  await page.waitForFunction(
    () => [...document.querySelectorAll(".mtree-row")].some((el) => el.textContent?.includes("b0c2") && el.textContent?.includes("h9g7")),
    null,
    { timeout: 5000 }
  );
  const navigated = await page.evaluate(() => ({
    rows: [...document.querySelectorAll(".mtree-row")].map((el) => el.textContent?.replace(/\s+/g, " ").trim() || "").join(" "),
    active: document.querySelector('[data-testid="move-tree-active"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
    overflowX: document.body.scrollWidth - document.body.clientWidth,
  }));
  if (!navigated.rows.includes("b0c2") || !navigated.rows.includes("h9g7") || !navigated.active.includes("b0c2") || navigated.overflowX > 2) {
    throw new Error(`Variation branch navigation did not follow the previewed continuation: ${JSON.stringify(navigated)}`);
  }
}

async function assertLibraryPgnFailureFeedback(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.evaluate(() => {
    localStorage.setItem("xiangqi:library:v1", JSON.stringify([{
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

async function assertLibraryInvalidSavedGameLoadFeedback(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.evaluate(() => {
    localStorage.setItem("xiangqi:library:v1", JSON.stringify([
      {
        id: "qa-long-label",
        savedAt: 1710000001000,
        gameMode: "PvP",
        moves: ["b2e2"],
        result: "ongoing",
        label: "Long saved game label ".repeat(12),
        opening: "Long opening name ".repeat(12),
      },
      {
        id: "qa-invalid-load",
        savedAt: 1710000000000,
        gameMode: "PvP",
        moves: ["a0a9"],
        result: "ongoing",
        label: "Invalid load QA",
      },
      {
        id: "qa-invalid-timestamp",
        savedAt: 1e100,
        gameMode: "PvP",
        moves: ["b2e2"],
        result: "ongoing",
        label: "Invalid timestamp QA",
      },
    ]));
  });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });

  await page.locator('button[aria-label="Open game library"]').click();
  await page.getByText("Invalid load QA").waitFor({ timeout: 10000 });
  await page.getByTestId("load-saved-qa-invalid-load").click();
  await page.getByTestId("library-action-error").getByText("Could not load this game").waitFor({ timeout: 5000 });

  const state = await page.evaluate(() => ({
    role: document.querySelector('[data-testid="library-action-error"]')?.getAttribute("role") || "",
    loadClass: document.querySelector('[data-testid="load-saved-qa-invalid-load"]')?.className || "",
    titleClipped: (() => {
      const title = document.querySelector(".lib-game-name-button");
      if (!title) return true;
      return title.scrollWidth - title.clientWidth > 1;
    })(),
    titleDisplay: (() => {
      const title = document.querySelector(".lib-game-name-button");
      return title ? getComputedStyle(title).display : "";
    })(),
    titleTextAlign: (() => {
      const title = document.querySelector(".lib-game-name-button");
      return title ? getComputedStyle(title).textAlign : "";
    })(),
    longTitleLength: (() => {
      const title = document.querySelector('[data-testid="load-saved-qa-long-label"]')?.closest(".lib-card")?.querySelector(".lib-game-name-button");
      return title?.textContent?.trim().length || 0;
    })(),
    longTitleClipped: (() => {
      const title = document.querySelector('[data-testid="load-saved-qa-long-label"]')?.closest(".lib-card")?.querySelector(".lib-game-name-button");
      if (!title) return true;
      return title.scrollWidth - title.clientWidth > 1;
    })(),
    stillVisible: document.body.textContent?.includes("Invalid load QA") || false,
    invalidTimestampVisible: document.body.textContent?.includes("Invalid timestamp QA") || false,
    moveRows: document.querySelectorAll(".mtree-row").length,
  }));
  if (
    state.role !== "alert" ||
    !state.loadClass.includes("chip-btn-warning") ||
    state.titleClipped ||
    state.titleDisplay !== "block" ||
    state.titleTextAlign !== "left" ||
    state.longTitleLength > 120 ||
    state.longTitleClipped ||
    !state.stillVisible ||
    state.invalidTimestampVisible ||
    state.moveRows !== 0
  ) {
    throw new Error(`Invalid saved-game load did not preserve library state with retry feedback: ${JSON.stringify(state)}`);
  }
}

async function assertLibraryMutationFailureFeedback(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.evaluate(() => {
    localStorage.setItem("xiangqi:library:v1", JSON.stringify([{
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
      if (key === "xiangqi:library:v1") {
        throw new DOMException("Simulated full storage", "QuotaExceededError");
      }
      return originalSetItem.call(this, key, value);
    };
  });

  await page.getByRole("button", { name: "Mutation failure QA", exact: true }).click();
  const renameForm = page.getByTestId("rename-form-saved-qa-library-failure");
  const renameLabels = await page.evaluate(() => {
    const form = document.querySelector('[data-testid="rename-form-saved-qa-library-failure"]');
    const save = document.querySelector('[data-testid="save-rename-saved-qa-library-failure"]');
    const cancel = document.querySelector('[data-testid="cancel-rename-saved-qa-library-failure"]');
    return {
      formLabel: form?.getAttribute("aria-label") || "",
      saveLabel: save?.getAttribute("aria-label") || "",
      saveTitle: save?.getAttribute("title") || "",
      cancelLabel: cancel?.getAttribute("aria-label") || "",
      cancelTitle: cancel?.getAttribute("title") || "",
    };
  });
  if (
    renameLabels.formLabel !== "Rename Mutation failure QA" ||
    renameLabels.saveLabel !== "Save rename for Mutation failure QA" ||
    renameLabels.saveTitle !== "Save rename for Mutation failure QA" ||
    renameLabels.cancelLabel !== "Cancel rename for Mutation failure QA" ||
    renameLabels.cancelTitle !== "Cancel rename for Mutation failure QA"
  ) {
    throw new Error(`Saved game rename controls were not game-specific: ${JSON.stringify(renameLabels)}`);
  }
  await renameForm.locator("input").fill("Renamed failure");
  await renameForm.getByRole("button", { name: "Save rename for Mutation failure QA" }).click();
  await page.getByTestId("library-action-error").getByText("Could not rename").waitFor({ timeout: 5000 });

  const afterRename = await page.evaluate(() => ({
    label: JSON.parse(localStorage.getItem("xiangqi:library:v1") || "[]")[0]?.label || "",
    editing: Boolean(document.querySelector('[data-testid="rename-form-saved-qa-library-failure"]')),
    alertRole: document.querySelector('[data-testid="library-action-error"]')?.getAttribute("role") || "",
  }));
  if (afterRename.label !== "Mutation failure QA" || !afterRename.editing || afterRename.alertRole !== "alert") {
    throw new Error(`Rename failure did not preserve data and editing state: ${JSON.stringify(afterRename)}`);
  }

  await renameForm.getByRole("button", { name: "Cancel rename for Mutation failure QA" }).click();
  await page.getByTestId("delete-saved-qa-library-failure").click();
  await page.getByTestId("confirm-delete-saved-qa-library-failure").click();
  await page.getByTestId("library-action-error").getByText("Could not delete").waitFor({ timeout: 5000 });

  const afterDelete = await page.evaluate(() => ({
    gameCount: JSON.parse(localStorage.getItem("xiangqi:library:v1") || "[]").length,
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
    localStorage.removeItem("xiangqi:library:v1");
  });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });

  await page.locator('.hitbox[data-file="1"][data-rank="2"]').click();
  await page.locator('.hitbox[data-file="4"][data-rank="2"]').click();
  await page.getByTestId("save-game-btn").waitFor({ timeout: 5000 });
  await page.evaluate(() => {
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItemWithLibraryFailure(key, value) {
      if (key === "xiangqi:library:v1") {
        throw new DOMException("Simulated full storage", "QuotaExceededError");
      }
      return originalSetItem.call(this, key, value);
    };
  });

  await page.getByTestId("save-game-btn").click();
  await page.getByTestId("save-game-btn").getByText("Save Failed").waitFor({ timeout: 5000 });
  const state = await page.evaluate(() => ({
    stored: localStorage.getItem("xiangqi:library:v1"),
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
    localStorage.removeItem("xiangqi:library:v1");
  });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });
  await page.waitForTimeout(500);

  const saveButton = page.getByTestId("mobile-save-game-btn");
  const libraryButton = page.getByTestId("mobile-open-library-btn");
  const moreButton = page.getByTestId("mobile-more-actions-btn");
  await saveButton.waitFor({ timeout: 10000 });
  await libraryButton.waitFor({ timeout: 10000 });
  await moreButton.waitFor({ timeout: 10000 });

  const mobileTriggerA11y = await page.evaluate(() => {
    const actions = document.querySelector(".mobile-board-actions");
    const newGame = actions?.querySelector('[aria-label="Open new game menu"]');
    const settings = actions?.querySelector('[aria-label="Open settings"]');
    return {
      newGamePopup: newGame?.getAttribute("aria-haspopup") || "",
      newGameExpanded: newGame?.getAttribute("aria-expanded") || "",
      newGameControls: newGame?.getAttribute("aria-controls") || "",
      settingsPopup: settings?.getAttribute("aria-haspopup") || "",
      settingsExpanded: settings?.getAttribute("aria-expanded") || "",
      settingsControls: settings?.getAttribute("aria-controls") || "",
    };
  });
  if (
    mobileTriggerA11y.newGamePopup !== "dialog" ||
    mobileTriggerA11y.newGameExpanded !== "false" ||
    mobileTriggerA11y.newGameControls !== "new-game-menu-dialog" ||
    mobileTriggerA11y.settingsPopup !== "dialog" ||
    mobileTriggerA11y.settingsExpanded !== "false" ||
    mobileTriggerA11y.settingsControls !== "settings-dialog"
  ) {
    throw new Error(`Mobile dialog triggers were not exposed accessibly: ${JSON.stringify(mobileTriggerA11y)}`);
  }

  if (!(await saveButton.isDisabled())) {
    throw new Error("Mobile save action should be disabled before any move or custom position.");
  }
  if ((await page.getByTestId("mobile-download-pgn-btn").count()) !== 0) {
    throw new Error("Mobile PGN export action should stay hidden until there is a line to export.");
  }
  if ((await page.getByTestId("mobile-copy-share-link-btn").count()) !== 0) {
    throw new Error("Mobile share action should stay hidden until there is a line or custom root.");
  }

  await page.locator('.hitbox[data-file="1"][data-rank="2"]').click();
  await page.locator('.hitbox[data-file="4"][data-rank="2"]').click();
  if (await saveButton.isDisabled()) {
    throw new Error("Mobile save action stayed disabled after a legal move.");
  }
  await moreButton.click();
  await page.getByTestId("mobile-download-pgn-btn").waitFor({ timeout: 5000 });
  await page.getByTestId("mobile-copy-share-link-btn").waitFor({ timeout: 5000 });
  const actionStrip = await page.evaluate(() => {
    const el = document.querySelector(".mobile-board-actions");
    const info = document.querySelector(".mobile-board-turn-info");
    const turnLabel = document.querySelector(".mobile-turn-label");
    return {
      clientWidth: el?.clientWidth ?? 0,
      scrollWidth: el?.scrollWidth ?? 0,
      overflowX: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      turnLabelClientWidth: turnLabel?.clientWidth ?? 0,
      turnLabelScrollWidth: turnLabel?.scrollWidth ?? 0,
      turnLabelText: turnLabel?.textContent?.trim() || "",
      turnLabelRight: turnLabel?.getBoundingClientRect().right ?? 0,
      turnInfoRight: info?.getBoundingClientRect().right ?? 0,
      menuItems: document.querySelectorAll(".mobile-board-action-menu button").length,
    };
  });
  if (actionStrip.scrollWidth - actionStrip.clientWidth > 2 || actionStrip.overflowX > 2) {
    throw new Error(`Mobile board actions did not fit after export/share appeared: ${JSON.stringify(actionStrip)}`);
  }
  if (
    actionStrip.turnLabelText !== "Black" ||
    actionStrip.turnLabelScrollWidth - actionStrip.turnLabelClientWidth > 1 ||
    actionStrip.turnLabelRight > actionStrip.turnInfoRight + 1 ||
    actionStrip.menuItems < 5
  ) {
    throw new Error(`Mobile turn label was clipped after export/share appeared: ${JSON.stringify(actionStrip)}`);
  }

  await page.locator(".mobile-board-action-backdrop").click();
  await page.waitForFunction(() => !document.querySelector(".mobile-board-action-menu"), null, { timeout: 2000 });
  await moreButton.click();
  await page.getByTestId("mobile-download-pgn-btn").waitFor({ timeout: 5000 });
  await page.getByTestId("mobile-view-analysis").click();
  await page.getByTestId("mobile-view-board").click();
  if ((await page.locator(".mobile-board-action-menu").count()) !== 0) {
    throw new Error("Mobile board action menu reopened after switching away from the board view.");
  }

  // The palette used to be reachable only through Cmd/Ctrl+K, which a phone
  // does not have -- so every command in it was unreachable on touch, not
  // merely undiscoverable. This asserts the menu route end to end, because it
  // is the only route mobile has: the top-bar button is display:none here,
  // which the last check below pins so this test cannot quietly stop covering
  // the thing it was written for.
  await moreButton.click();
  const mobilePaletteButton = page.getByTestId("mobile-command-palette-btn");
  await mobilePaletteButton.waitFor({ timeout: 5000 });
  await mobilePaletteButton.click();
  await page.getByRole("dialog", { name: "Commands" }).waitFor({ timeout: 5000 });
  const paletteState = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"][aria-label="Commands"]');
    const input = dialog?.querySelector("input");
    const rect = dialog?.getBoundingClientRect();
    return {
      menuStillOpen: Boolean(document.querySelector(".mobile-board-action-menu")),
      optionCount: dialog?.querySelectorAll('[role="option"]').length ?? 0,
      inputFocused: Boolean(input) && document.activeElement === input,
      fits: Boolean(rect) && rect.width <= window.innerWidth && rect.height <= window.innerHeight,
      topBarButtonWidth:
        document.querySelector('[data-testid="command-palette-btn"]')?.getBoundingClientRect().width ?? 0,
    };
  });
  if (paletteState.menuStillOpen) {
    throw new Error("Mobile action menu stayed open behind the command palette.");
  }
  if (paletteState.optionCount === 0 || !paletteState.inputFocused || !paletteState.fits) {
    throw new Error(`Command palette opened from the mobile menu in a bad state: ${JSON.stringify(paletteState)}`);
  }
  if (paletteState.topBarButtonWidth !== 0) {
    throw new Error(
      `Top-bar palette button is visible at mobile width, so this check no longer covers the only mobile route: ${JSON.stringify(paletteState)}`,
    );
  }
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () => !document.querySelector('[role="dialog"][aria-label="Commands"]'),
    null,
    { timeout: 2000 },
  );

  await saveButton.click();
  const savedGame = await page.waitForFunction(() => {
    const raw = localStorage.getItem("xiangqi:library:v1");
    if (!raw) return null;
    const games = JSON.parse(raw);
    return games.length === 1 ? games[0] : null;
  }, null, { timeout: 5000 }).then((handle) => handle.jsonValue());
  const savedGameId = savedGame?.id;

  if (!savedGameId) {
    throw new Error("Mobile save did not create a saved game.");
  }
  if (Object.prototype.hasOwnProperty.call(savedGame, "startFen")) {
    throw new Error(`Default-start saves should not persist a redundant root FEN: ${JSON.stringify(savedGame)}`);
  }

  await libraryButton.click();
  await page.getByText("My Games").waitFor({ timeout: 5000 });
  await page.getByTestId(`load-saved-${savedGameId}`).waitFor({ timeout: 5000 });
  const activeMobileTab = await page.locator(".mobile-tab-btn.active").textContent();
  if (!String(activeMobileTab || "").includes("Library")) {
    throw new Error(`Mobile library opened under the wrong analysis tab: ${String(activeMobileTab || "").trim()}`);
  }

  await page.getByTestId(`load-saved-${savedGameId}`).click();
  await page.getByTestId("move-tree-row-label-0").waitFor({ timeout: 5000 });
  const loadedState = await page.evaluate(() => ({
    activeMobileTab: document.querySelector(".mobile-tab-btn.active")?.textContent?.replace(/\s+/g, " ").trim() || "",
    rowText: document.querySelector(".mtree-row")?.textContent?.replace(/\s+/g, " ").trim() || "",
    rightPanelVisible: getComputedStyle(document.querySelector(".panel.right")).display !== "none",
    leftPanelHidden: getComputedStyle(document.querySelector(".panel.left")).display === "none",
    overflowX: document.body.scrollWidth - document.body.clientWidth,
  }));
  if (
    loadedState.activeMobileTab !== "Moves" ||
    !loadedState.rowText.includes("b2e2") ||
    !loadedState.rightPanelVisible ||
    !loadedState.leftPanelHidden ||
    loadedState.overflowX > 2
  ) {
    throw new Error(`Mobile saved-game load did not switch to the move tree: ${JSON.stringify(loadedState)}`);
  }
}

async function assertSimpleRepetitionDoesNotAutoDraw(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  const repeatedLine = [
    "b0c2", "b9c7", "c2b0", "c7b9",
    "b0c2", "b9c7", "c2b0", "c7b9",
  ].join(" ");
  await page.goto(`http://127.0.0.1:8192/web-xiangqi/?moves=${encodeURIComponent(repeatedLine)}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });
  await page.waitForFunction(() => document.querySelectorAll(".mtree-chip").length >= 8, null, { timeout: 5000 });

  const repetitionState = await page.evaluate(() => ({
    modalTitle: document.querySelector(".game-over-title")?.textContent?.trim() || "",
    modalSubtitle: document.querySelector(".game-over-subtitle")?.textContent?.trim() || "",
    activePoint: document.querySelector('[data-testid="graph-current-point"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
    moveChips: document.querySelectorAll(".mtree-chip").length,
    overflowX: document.body.scrollWidth - document.body.clientWidth,
  }));
  if (repetitionState.modalTitle || repetitionState.modalSubtitle || repetitionState.moveChips < 8 || repetitionState.overflowX > 2) {
    throw new Error(`Simple repeated position was prematurely adjudicated: ${JSON.stringify(repetitionState)}`);
  }

  const beforeFen = await page.locator(".bottombar-fen").getAttribute("title");
  await page.locator('.hitbox[data-file="0"][data-rank="0"]').click();
  await page.locator('.hitbox[data-file="0"][data-rank="1"]').click();
  await page.waitForFunction((fen) => {
    return document.querySelector(".bottombar-fen")?.getAttribute("title") !== fen;
  }, beforeFen, { timeout: 5000 });
  await page.waitForFunction(() => document.querySelectorAll(".mtree-chip").length >= 9, null, { timeout: 5000 });

  const continuedState = await page.evaluate(() => ({
    modalTitle: document.querySelector(".game-over-title")?.textContent?.trim() || "",
    activePoint: document.querySelector('[data-testid="graph-current-point"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
    moveChips: document.querySelectorAll(".mtree-chip").length,
  }));
  if (continuedState.modalTitle || continuedState.moveChips < 9 || !continuedState.activePoint.includes("Red A0")) {
    throw new Error(`Repeated position did not remain playable: ${JSON.stringify(continuedState)}`);
  }
}

async function assertDenseEvalGraphLimitsPointMarkers(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  const cycle = ["b0c2", "b9c7", "c2b0", "c7b9"];
  const denseLine = Array.from({ length: 64 }, () => cycle).flat().join(" ");
  await page.goto(`http://127.0.0.1:8192/web-xiangqi/?moves=${encodeURIComponent(denseLine)}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });
  await page.waitForFunction(
    () => document.querySelector('[data-testid="graph-current-point"]')?.textContent?.includes("Ply 256"),
    null,
    { timeout: 10000 }
  );

  const initial = await page.evaluate(() => {
    const graph = document.querySelector(".winrate-graph");
    const moveTree = document.querySelector(".mtree-scroll");
    const activeMove = document.querySelector('[data-testid="move-tree-active"]');
    const breadcrumb = document.querySelector(".tree-breadcrumb");
    const activeBreadcrumb = document.querySelector(".tree-breadcrumb-chip-active");
    const treeRect = moveTree?.getBoundingClientRect();
    const activeMoveRect = activeMove?.getBoundingClientRect();
    const breadcrumbRect = breadcrumb?.getBoundingClientRect();
    const activeBreadcrumbRect = activeBreadcrumb?.getBoundingClientRect();
    const activeMoveVisible = Boolean(
      treeRect &&
      activeMoveRect &&
      activeMoveRect.top >= treeRect.top - 1 &&
      activeMoveRect.bottom <= treeRect.bottom + 1
    );
    return {
      totalPoints: Number(graph?.getAttribute("data-total-points") || 0),
      renderedPoints: Number(graph?.getAttribute("data-rendered-points") || 0),
      pointNodes: document.querySelectorAll(".graph-point").length,
      activePoints: document.querySelectorAll(".graph-point-active").length,
      valueMax: graph?.getAttribute("aria-valuemax") || "",
      activePoint: document.querySelector('[data-testid="graph-current-point"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
      activeMove: activeMove?.textContent?.replace(/\s+/g, " ").trim() || "",
      activeMoveVisible,
      activeMoveOffsetTop: treeRect && activeMoveRect ? Math.round(activeMoveRect.top - treeRect.top) : null,
      activeMoveOffsetBottom: treeRect && activeMoveRect ? Math.round(activeMoveRect.bottom - treeRect.top) : null,
      moveTreeScrollTop: moveTree ? Math.round(moveTree.scrollTop) : null,
      moveTreeClientHeight: moveTree ? Math.round(moveTree.clientHeight) : null,
      breadcrumbHeight: breadcrumbRect ? Math.round(breadcrumbRect.height) : null,
      breadcrumbScrollWidth: breadcrumb ? Math.round(breadcrumb.scrollWidth) : null,
      breadcrumbClientWidth: breadcrumb ? Math.round(breadcrumb.clientWidth) : null,
      breadcrumbScrollLeft: breadcrumb ? Math.round(breadcrumb.scrollLeft) : null,
      activeBreadcrumbText: activeBreadcrumb?.textContent?.replace(/\s+/g, " ").trim() || "",
      activeBreadcrumbLabel: activeBreadcrumb?.getAttribute("aria-label") || "",
      activeBreadcrumbVisible: Boolean(
        breadcrumbRect &&
        activeBreadcrumbRect &&
        activeBreadcrumbRect.left >= breadcrumbRect.left - 1 &&
        activeBreadcrumbRect.right <= breadcrumbRect.right + 1
      ),
      overflowX: document.body.scrollWidth - document.body.clientWidth,
    };
  });
  if (
    initial.totalPoints !== 257 ||
    initial.renderedPoints >= 90 ||
    initial.pointNodes !== initial.renderedPoints ||
    initial.activePoints !== 1 ||
    initial.valueMax !== "256" ||
    !initial.activePoint.includes("Ply 256") ||
    !initial.activeMove.includes("c7b9") ||
    !initial.activeMoveVisible ||
    !(initial.moveTreeScrollTop > 0) ||
    !(initial.moveTreeClientHeight >= 200) ||
    !(initial.breadcrumbHeight <= 60) ||
    !(initial.breadcrumbScrollWidth > initial.breadcrumbClientWidth) ||
    !(initial.breadcrumbScrollLeft > 0) ||
    !initial.activeBreadcrumbText.includes("馬 C7→B9") ||
    !initial.activeBreadcrumbLabel.includes("Ply 256: Black horse from C7 moves to B9") ||
    !initial.activeBreadcrumbVisible ||
    initial.overflowX > 2
  ) {
    throw new Error(`Dense evaluation graph did not thin decorative markers: ${JSON.stringify(initial)}`);
  }

  await page.locator(".winrate-graph").focus();
  await page.keyboard.press("Home");
  await page.waitForFunction(
    () => document.querySelector('[data-testid="graph-current-point"]')?.textContent?.includes("Start"),
    null,
    { timeout: 5000 }
  );
  await page.keyboard.press("End");
  await page.waitForFunction(
    () => document.querySelector('[data-testid="graph-current-point"]')?.textContent?.includes("Ply 256"),
    null,
    { timeout: 5000 }
  );

  const navigated = await page.evaluate(() => {
    const moveTree = document.querySelector(".mtree-scroll");
    const activeMove = document.querySelector('[data-testid="move-tree-active"]');
    const breadcrumb = document.querySelector(".tree-breadcrumb");
    const activeBreadcrumb = document.querySelector(".tree-breadcrumb-chip-active");
    const treeRect = moveTree?.getBoundingClientRect();
    const activeMoveRect = activeMove?.getBoundingClientRect();
    const breadcrumbRect = breadcrumb?.getBoundingClientRect();
    const activeBreadcrumbRect = activeBreadcrumb?.getBoundingClientRect();
    return {
      activePoint: document.querySelector('[data-testid="graph-current-point"]')?.textContent?.replace(/\s+/g, " ").trim() || "",
      activePoints: document.querySelectorAll(".graph-point-active").length,
      activeMove: activeMove?.textContent?.replace(/\s+/g, " ").trim() || "",
      activeBreadcrumbText: activeBreadcrumb?.textContent?.replace(/\s+/g, " ").trim() || "",
      activeBreadcrumbLabel: activeBreadcrumb?.getAttribute("aria-label") || "",
      activeMoveVisible: Boolean(
        treeRect &&
        activeMoveRect &&
        activeMoveRect.top >= treeRect.top - 1 &&
        activeMoveRect.bottom <= treeRect.bottom + 1
      ),
      activeBreadcrumbVisible: Boolean(
        breadcrumbRect &&
        activeBreadcrumbRect &&
        activeBreadcrumbRect.left >= breadcrumbRect.left - 1 &&
        activeBreadcrumbRect.right <= breadcrumbRect.right + 1
      ),
      overflowX: document.body.scrollWidth - document.body.clientWidth,
    };
  });
  if (
    !navigated.activePoint.includes("Ply 256") ||
    navigated.activePoints !== 1 ||
    !navigated.activeMove.includes("c7b9") ||
    !navigated.activeBreadcrumbText.includes("馬 C7→B9") ||
    !navigated.activeBreadcrumbLabel.includes("Ply 256: Black horse from C7 moves to B9") ||
    !navigated.activeMoveVisible ||
    !navigated.activeBreadcrumbVisible ||
    navigated.overflowX > 2
  ) {
    throw new Error(`Dense evaluation graph navigation failed after marker thinning: ${JSON.stringify(navigated)}`);
  }
}

async function assertStalemateLossIsLabeled(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  const stalemateFen = encodeURIComponent("4k4/R8/9/9/9/4P4/9/9/9/3RKR3 b - - 0 1");
  await page.goto(`http://127.0.0.1:8192/web-xiangqi/?fen=${stalemateFen}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });
  // The heading, not any text saying it: a screen-reader live region also
  // announces "Red wins.", and getByText matches it case-insensitively, so a
  // bare text locator hits two elements and Playwright refuses in strict mode.
  await page.getByRole("heading", { name: "Red Wins" }).waitFor({ timeout: 5000 });

  const stalemateState = await page.evaluate(() => ({
    title: document.querySelector(".game-over-title")?.textContent?.trim() || "",
    subtitle: document.querySelector(".game-over-subtitle")?.textContent?.trim() || "",
    fen: document.querySelector(".bottombar-fen")?.getAttribute("title") || "",
    overflowX: document.body.scrollWidth - document.body.clientWidth,
  }));
  if (
    stalemateState.title !== "Red Wins" ||
    stalemateState.subtitle !== "No legal moves - Xiangqi counts this as a loss" ||
    !stalemateState.fen.includes(" b ") ||
    stalemateState.overflowX > 2
  ) {
    throw new Error(`Stalemate loss was not labeled correctly: ${JSON.stringify(stalemateState)}`);
  }
}

async function assertGameOverReviewPreservesResult(page) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("http://127.0.0.1:8192/web-xiangqi/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.evaluate(() => {
    localStorage.removeItem("xiangqi:library:v1");
  });

  const terminalFen = "4k4/3RRR3/9/9/9/9/9/9/9/4K4 b - - 0 1";
  await page.getByRole("button", { name: "Start new game" }).click();
  await page.getByLabel("FEN string").fill(terminalFen);
  await page.getByRole("button", { name: "Load" }).click();

  // The heading, not any text saying it: a screen-reader live region also
  // announces "Red wins.", and getByText matches it case-insensitively, so a
  // bare text locator hits two elements and Playwright refuses in strict mode.
  await page.getByRole("heading", { name: "Red Wins" }).waitFor({ timeout: 5000 });
  await page.waitForFunction(() => document.activeElement?.classList.contains("game-over-btn-primary"), null, { timeout: 5000 });
  const dialogState = await page.evaluate(() => {
    const modal = document.querySelector(".game-over-modal");
    return {
      role: modal?.getAttribute("role") || "",
      ariaModal: modal?.getAttribute("aria-modal") || "",
      subtitle: document.querySelector(".game-over-subtitle")?.textContent?.trim() || "",
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
  if (dialogState.subtitle !== "Checkmate") {
    throw new Error(`Checkmate finish was mislabeled: ${JSON.stringify(dialogState)}`);
  }

  await page.keyboard.press("Shift+Tab");
  const wrappedBackward = await page.evaluate(() => document.activeElement?.textContent?.trim() || "");
  await page.keyboard.press("Tab");
  const wrappedForward = await page.evaluate(() => document.activeElement?.textContent?.trim() || "");
  await page.keyboard.press("Tab");
  const cycledForward = await page.evaluate(() => document.activeElement?.textContent?.trim() || "");
  if (wrappedBackward !== "Review" || wrappedForward !== "New Game" || cycledForward !== "Review") {
    throw new Error(`Game-over modal focus escaped or did not wrap: ${JSON.stringify({ wrappedBackward, wrappedForward, cycledForward })}`);
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
    const raw = localStorage.getItem("xiangqi:library:v1");
    if (!raw) return null;
    const games = JSON.parse(raw);
    return games.length === 1 ? games[0].result : null;
  }, null, { timeout: 5000 }).then((handle) => handle.jsonValue());

  if (savedResult !== "red") {
    throw new Error(`Game-over Review action lost the finished result before save: ${savedResult}`);
  }
}

async function assertMobileGameOverReviewOpensReviewTab(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  const terminalFen = encodeURIComponent("4k4/3RRR3/9/9/9/9/9/9/9/4K4 b - - 0 1");
  await page.goto(`http://127.0.0.1:8192/web-xiangqi/?fen=${terminalFen}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector(".xiangqi-board", { timeout: 30000 });
  // The heading, not any text saying it: a screen-reader live region also
  // announces "Red wins.", and getByText matches it case-insensitively, so a
  // bare text locator hits two elements and Playwright refuses in strict mode.
  await page.getByRole("heading", { name: "Red Wins" }).waitFor({ timeout: 5000 });
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="mobile-analysis-tab-review"]')?.getAttribute("aria-selected") === "true", null, { timeout: 5000 });

  const state = await page.evaluate(() => ({
    mobileAnalysisCurrent: document.querySelector('[data-testid="mobile-view-analysis"]')?.getAttribute("aria-current") || "",
    activeMobileTab: document.querySelector(".mobile-tab-btn.active")?.textContent?.replace(/\s+/g, " ").trim() || "",
    reviewSelected: document.querySelector('[data-testid="analysis-tab-review"]')?.getAttribute("aria-selected") || "",
    reviewPanelVisible: Boolean(document.querySelector(".review-panel")),
    overflowX: document.body.scrollWidth - document.body.clientWidth,
  }));
  if (
    state.mobileAnalysisCurrent !== "page" ||
    state.activeMobileTab !== "Review" ||
    state.reviewSelected !== "true" ||
    !state.reviewPanelVisible ||
    state.overflowX > 2
  ) {
    throw new Error(`Mobile game-over Review did not open the Review tab: ${JSON.stringify(state)}`);
  }
}

/**
 * The app auto-saves a game in progress and offers to restore it on the next
 * load. These assertions share one page across dozens of navigations, so a game
 * left on the board by an earlier assertion brought the recovery modal up in a
 * later one, and its backdrop swallowed the clicks — which is how
 * assertBoardKeyboardNavigationFlipped started failing on "auto-save-backdrop
 * intercepts pointer events".
 *
 * Clear the slot before every navigation. These tests are about layout; the
 * recovery flow has its own coverage.
 */
async function clearAutoSaveBetweenNavigations(page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.removeItem("xiangqi:auto-saved-game:v1");
    } catch {
      // Storage unavailable in this context; nothing to clear.
    }
  });
}

async function assertAppErrorBoundaryFallback(browser) {
  const page = await browser.newPage();
  await clearAutoSaveBetweenNavigations(page);
  try {
    await page.setViewportSize({ width: 390, height: 720 });
    await page.goto("http://127.0.0.1:8192/web-xiangqi/?qa-error-boundary=1", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForSelector(".app-error-fallback", { timeout: 10000 });

    const state = await page.evaluate(() => ({
      role: document.querySelector(".app-error-fallback")?.getAttribute("role") || "",
      title: document.querySelector("#app-error-title")?.textContent?.trim() || "",
      message: document.querySelector("#app-error-message")?.textContent?.replace(/\s+/g, " ").trim() || "",
      button: document.querySelector(".app-error-fallback button")?.textContent?.trim() || "",
      detail: document.querySelector(".app-error-fallback code")?.textContent?.trim() || "",
      boardCount: document.querySelectorAll(".xiangqi-board").length,
      overflowX: document.body.scrollWidth - document.body.clientWidth,
    }));

    if (
      state.role !== "alert" ||
      state.title !== "Something interrupted the board" ||
      state.message !== "Reload the app to recover the analysis board." ||
      state.button !== "Reload App" ||
      state.detail !== "Forced error boundary QA" ||
      state.boardCount !== 0 ||
      state.overflowX > 2
    ) {
      throw new Error(`App error boundary fallback is not recoverable: ${JSON.stringify(state)}`);
    }
  } finally {
    await page.close();
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
    await clearAutoSaveBetweenNavigations(page);
    const pageConsole = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") pageConsole.push(msg.text());
    });
    page.on("pageerror", (err) => pageConsole.push(err && err.stack ? err.stack : String(err)));

    await assertDesktopBoardLayout(page, { width: 1024, height: 720 });
    await assertNoDanglingAriaControls(page);
    await assertOpeningBookArrowsGuideBoard(page);
    await assertBoardKeyboardNavigation(page);
    await assertBoardKeyboardNavigationFlipped(page);
    await assertDesktopResizeFeedback(page);
    await assertPausedAiTurnBlocksManualMove(page);
    await assertIllegalMoveShowsRuleHint(page);
    await assertAiPlayModeShowsEngineStatus(page);
    await assertAiNewGameSwitchesToPlayWorkspace(page);
    await assertBeginnerAiUsesCandidatePv(browser);
    await assertAnalysisWorkspaceDoesNotAutoPlayAi(browser);
    await assertEngineLoaderFailureShowsNotice(browser);
    await assertEngineCreateTimeoutShowsNotice(browser);
    await assertEngineReadyTimeoutShowsNotice(browser);
    await assertAnalysisResumesAfterVisibilityReturn(browser);
    await assertAiPlayPausesWhileHidden(browser);
    await assertEnginePvLineControl(page);
    await assertEngineTelemetryDashboard(browser);
    await assertEngineMateScoresRenderAsMate(browser);
    await assertEngineRestartDropsBufferedInfo(browser);
    await assertEngineRestartRestoresDetailOptions(browser);
    await assertPlayedEnginePvDoesNotStoreRootEval(browser);
    await assertPreferencePersistence(page);
    await assertBottomNewGameMenuResetsDraft(page);
    await assertInvalidFenToastTimerResets(page);
    await assertDisabledControlsLookInactive(page);
    await assertPanelTabAccessibility(page);
    await assertLibraryLoadsAnalysisWorkspace(page);
    await assertNewGameDialogFocusTrap(page);
    await assertMobileNewGameStartButtonVisible(page);
    await assertBlackToMoveTreeNumbering(page);
    await assertMoveLineImport(page);
    await assertMoveLineImportPreservesVariations(page);
    await assertMoveLineImportRecoversUnclosedVariation(page);
    await assertMoveLineImportRejectsInvalidVariation(page);
    await assertReviewBestMoveBranchAction(page);
    await assertLastMoveArrowUsesPracticalReviewQuality(page);
    await assertRunningReviewCancelsOnLineChange(browser);
    await assertReviewMomentFiltersResetOnLoad(browser);
    await assertReviewRevisitRefreshesDecisionBestMove(browser);
    await assertReviewRevisitIgnoresGoodScoreSwings(browser);
    await assertCompletedReviewRerunRespectsEngineState(page);
    await assertMoveLineImportErrorAccessibility(page);
    await assertRootMoveVariationsVisible(page);
    await assertReplayedMoveKeepsChosenContinuation(page);
    await assertMoveTreeRespectsReducedMotion(page);
    await assertPgnTreeVariationExport(page);
    await assertCurrentPgnDownload(page);
    await assertMainExportFailureFeedback(page);
    await assertShareLinkRoundTrip(page);
    await assertShareTreeRoundTrip(page);
    await assertRootStudyTreeShareExportSave(page);
    await assertOversizedShareTreeWarning(page);
    await assertLongShareVariationVisible(page);
    await assertInvalidShareTreeFallsBackToMainline(page);
    await assertMismatchedShareTreeFallsBackToMainline(page);
    await assertInvalidShareLinkFeedback(page);
    await assertMoveLineFileImport(page);
    await assertOversizedMoveLineFileRejected(page);
    await assertOversizedMoveLinePasteRejected(page);
    await assertFenTaggedMoveLineImport(page);
    await assertDialogsBlockMoveShortcuts(page);
    await assertBoardMarkersSurviveSelection(page);
    await assertMobileBoardLayout(page, { width: 596, height: 668 });
    await assertMobileBoardLayout(page, { width: 390, height: 844 });
    await assertSaveFailureFeedback(page);
    await assertMobileSaveLibraryActions(page);
    await assertLibraryPgnCopy(page);
    await assertSavedStudyTreeRoundTrip(page);
    await assertVariationPreviewMatchesNavigation(page);
    await assertLibraryPgnFailureFeedback(page);
    await assertLibraryInvalidSavedGameLoadFeedback(page);
    await assertLibraryMutationFailureFeedback(page);
    await assertLibraryDeleteConfirmation(page);
    await assertLibraryRespondsToStorageChanges(page);
    await assertLibrarySavedGameSorting(page);
    await assertLargeLibraryRendersProgressively(page);
    await assertDenseEvalGraphLimitsPointMarkers(page);
    await assertSimpleRepetitionDoesNotAutoDraw(page);
    await assertStalemateLossIsLabeled(page);
    await assertGameOverReviewPreservesResult(page);
    await assertMobileGameOverReviewOpensReviewTab(page);
    await assertAppErrorBoundaryFallback(browser);

    if (pageConsole.length > 0) {
      throw new Error("Unexpected browser console errors:\n" + pageConsole.join("\n"));
    }

    console.log("Desktop/mobile board layout, opening book board arrows, board keyboard navigation/flipped orientation, adaptive mobile actions, touch-reachable command palette, aria-controls targets, AI-turn lock, illegal-move rule hint, AI Play engine status, AI new-game workspace routing, beginner AI candidate-PV play, Analysis workspace AI auto-play guard, engine loader failure, boot-timeout, and ready-timeout notices, visibility-return analysis resume, hidden-tab AI pause/resume, engine PV controls, engine telemetry and mate-score labels, engine restart detail restoration, PV play eval integrity, preference persistence, panel tab accessibility, saved-study workspace routing, mobile analysis tab sync, dialog focus trap, mobile new-game start visibility, dialog shortcut guard, resize feedback, new-game reset, inactive disabled controls, invalid-FEN/share-link feedback timing, custom-FEN move numbering/graph labels, UCI/FEN-tag/file import with variation and unclosed-variation recovery, oversized import guard/file and paste guards, and accessible errors, actionable review suggestions, decisive review arrow quality, running review cancellation, review revisit best-move refresh, review revisit loss filtering, review engine metadata, and rerun state, root move variations, active continuation replay, reduced-motion move tree scroll, tree PGN variation export, long variation display, current-line PGN download/share link and root-study PGN/share/save with study trees, oversized-tree share warning, invalid/mismatched-tree fallback, export failure feedback, board marker persistence, save/library mutation failure feedback and PGN actions, invalid saved-game load feedback, saved study-tree round-trip, variation preview navigation, storage-synced library refresh, saved-game sorting, progressive large-library rendering, simple repetition playability, terminal result labels, game-over review state, app error boundary fallback, and library delete checks passed.");
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
