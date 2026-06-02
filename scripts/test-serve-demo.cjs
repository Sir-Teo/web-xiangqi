"use strict";

const assert = require("assert");
const playwright = require("playwright");

process.env.SERVE_DEMO_TEST = "1";

const {
  appBasePath,
  cacheControlForPath,
  createDemoServer,
  normalizeRequestPath,
  relativePathForRequest,
} = require("./serve-demo.cjs");

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertMetaTag(html, attributeName, attributeValue, content) {
  assert.match(
    html,
    new RegExp(`<meta ${attributeName}="${escapeRegExp(attributeValue)}" content="${escapeRegExp(content)}"\\s*/?>`)
  );
}

function buildFakeAiEngineScript({ variant, infoLines, bestmove }) {
  return `
    window.Pikafish = function Pikafish() {};
    window.__pikafishCreateWorkerEngineOptions = null;
    window.Pikafish.createWorkerEngine = async (opts = {}) => {
      window.__pikafishCreateWorkerEngineOptions = {
        basePath: opts.basePath || "",
        workerScript: opts.workerScript || "",
        nnuePath: opts.nnuePath || "",
        variant: opts.variant || "",
        initTimeoutMs: opts.initTimeoutMs || 0
      };
      const listeners = [];
      const infoLines = ${JSON.stringify(infoLines)};
      const bestmove = ${JSON.stringify(bestmove)};
      const emit = (line) => listeners.forEach((listener) => listener(line));
      return {
        variant: ${JSON.stringify(variant)},
        addMessageListener(listener) { listeners.push(listener); },
        removeMessageListener(listener) {
          const index = listeners.indexOf(listener);
          if (index >= 0) listeners.splice(index, 1);
        },
        postMessage(command) {
          if (command === "uci") {
            setTimeout(() => {
              emit("id name Fake AI QA");
              emit("option name MultiPV type spin default 1 min 1 max 128");
              emit("option name UCI_ShowWDL type check default false");
              emit("uciok");
            }, 0);
          } else if (command === "isready") {
            setTimeout(() => emit("readyok"), 0);
          } else if (/^go\\b/.test(command)) {
            setTimeout(() => {
              infoLines.forEach(emit);
              emit("bestmove " + bestmove);
            }, 20);
          }
        },
        terminate() { return Promise.resolve(); },
      };
    };
  `;
}

async function main() {
  assert.equal(appBasePath, "/web-xiangqi/");
  assert.equal(normalizeRequestPath("/"), "/index.html");
  assert.equal(normalizeRequestPath("/web-xiangqi"), "/index.html");
  assert.equal(normalizeRequestPath("/web-xiangqi/"), "/index.html");
  assert.equal(normalizeRequestPath("/web-xiangqi/assets/index-abc123.js"), "/assets/index-abc123.js");
  assert.equal(relativePathForRequest("/web-xiangqi/pikafish.nnue"), "pikafish.nnue");
  assert.equal(cacheControlForPath("index.html"), "no-cache");
  assert.equal(cacheControlForPath("assets/index-abc123.js"), "public, max-age=31536000, immutable");
  assert.equal(cacheControlForPath("pikafish.nnue"), "public, max-age=0, must-revalidate");

  const server = createDemoServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const indexResponse = await fetch(`${baseUrl}/web-xiangqi/`);
    assert.equal(indexResponse.status, 200);
    assert.equal(indexResponse.headers.get("cross-origin-opener-policy"), "same-origin");
    assert.equal(indexResponse.headers.get("x-content-type-options"), "nosniff");
    const html = await indexResponse.text();
    assert.match(html, /<title>Web Xiangqi \| Pikafish Analysis Board<\/title>/);
    assertMetaTag(html, "name", "description", "A fast Xiangqi analysis board with Pikafish engine lines, game review, openings, saved studies, PGN/FEN import, and shareable variations.");
    assertMetaTag(html, "name", "application-name", "Web Xiangqi");
    assertMetaTag(html, "name", "color-scheme", "dark");
    assertMetaTag(html, "name", "theme-color", "#050505");
    assertMetaTag(html, "property", "og:title", "Web Xiangqi");
    assertMetaTag(html, "name", "twitter:card", "summary");
    assert.match(html, /<link rel="preload" href="\.\/pikafish\.js" as="script"\s*\/?>/);
    const assetPath = html.match(/src="([^"]+\/assets\/[^"]+\.js)"/)?.[1];
    assert(assetPath, "React build should reference a hashed JS asset.");

    const assetResponse = await fetch(`${baseUrl}${assetPath}`);
    assert.equal(assetResponse.status, 200);
    assert.equal(assetResponse.headers.get("cache-control"), "public, max-age=31536000, immutable");
    assert.equal(assetResponse.headers.get("x-content-type-options"), "nosniff");
    const etag = assetResponse.headers.get("etag");
    assert(etag, "Static assets should include an ETag.");

    const cachedResponse = await fetch(`${baseUrl}${assetPath}`, {
      headers: { "If-None-Match": etag },
    });
    assert.equal(cachedResponse.status, 304);

    const wrapperHead = await fetch(`${baseUrl}/web-xiangqi/pikafish.js`, { method: "HEAD" });
    assert.equal(wrapperHead.status, 200);
    assert.match(wrapperHead.headers.get("content-type") || "", /javascript/);

    const nnueHead = await fetch(`${baseUrl}/web-xiangqi/pikafish.nnue`, { method: "HEAD" });
    assert.equal(nnueHead.status, 200);
    assert.equal(nnueHead.headers.get("cache-control"), "public, max-age=0, must-revalidate");
    assert(Number(nnueHead.headers.get("content-length")) > 50_000_000);

    const noticesResponse = await fetch(`${baseUrl}/web-xiangqi/THIRD_PARTY_NOTICES.md`);
    assert.equal(noticesResponse.status, 200);
    assert.match(noticesResponse.headers.get("content-type") || "", /text\/markdown/);
    const noticesText = await noticesResponse.text();
    assert.match(noticesText, /official-pikafish\/Pikafish/);
    assert.match(noticesText, /beeca5cc785ceb2026c5f9248f6e057573b12906/);
    assert.match(noticesText, /Pikafish-Copying\.txt/);

    const copyingHead = await fetch(`${baseUrl}/web-xiangqi/Pikafish-Copying.txt`, { method: "HEAD" });
    assert.equal(copyingHead.status, 200);
    assert.match(copyingHead.headers.get("content-type") || "", /text\/plain/);

    const browser = await playwright.chromium.launch({
      headless: true,
      args: ["--no-sandbox"],
    });
    try {
      const page = await browser.newPage();
      const consoleIssues = [];
      page.on("console", (msg) => {
        if (msg.type() === "warning" || msg.type() === "error") {
          consoleIssues.push(`${msg.type()}: ${msg.text()}`);
        }
      });
      page.on("pageerror", (err) => {
        consoleIssues.push(err && err.stack ? err.stack : String(err));
      });
      await page.route("**/pikafish.js", (route) => route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: "window.Pikafish = function Pikafish() {};",
      }));
      await page.goto(`${baseUrl}/web-xiangqi/`, {
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
      assert.match(state.engineText, /Recovering engine|Engine paused after crashes/i);
      assert.equal(state.overflowX <= 2, true, "Engine failure notice should not introduce horizontal overflow.");

      await page.getByRole("button", { name: "a3, red soldier", exact: true }).click();
      await page.getByRole("button", { name: "a4, empty, legal move", exact: true }).click();
      await page.waitForFunction(() => {
        return document.querySelector("[data-file='0'][data-rank='4']")?.getAttribute("aria-label") === "a4, red soldier" &&
          document.querySelectorAll(".mtree-row").length === 1;
      }, null, { timeout: 5000 });
      const playableState = await page.evaluate(() => ({
        fromLabel: document.querySelector("[data-file='0'][data-rank='3']")?.getAttribute("aria-label") || "",
        toLabel: document.querySelector("[data-file='0'][data-rank='4']")?.getAttribute("aria-label") || "",
        fen: document.querySelector(".bottombar-fen")?.getAttribute("title") || "",
        moveRows: document.querySelectorAll(".mtree-row").length,
      }));
      assert.equal(playableState.fromLabel, "a3, empty");
      assert.equal(playableState.toLabel, "a4, red soldier");
      assert.match(playableState.fen, /\sb\s/);
      assert.equal(playableState.moveRows, 1);
      assert.deepEqual(consoleIssues, []);

      const invalidMovePage = await browser.newPage();
      const invalidMoveConsoleIssues = [];
      invalidMovePage.on("console", (msg) => {
        if (msg.type() === "warning" || msg.type() === "error") {
          invalidMoveConsoleIssues.push(`${msg.type()}: ${msg.text()}`);
        }
      });
      invalidMovePage.on("pageerror", (err) => {
        invalidMoveConsoleIssues.push(err && err.stack ? err.stack : String(err));
      });
      await invalidMovePage.route("**/pikafish.js", (route) => route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: buildFakeAiEngineScript({
          variant: "fake-invalid-ai-move",
          infoLines: ["info depth 2 multipv 1 score cp 0 pv a0a9"],
          bestmove: "a0a9",
        }),
      }));
      await invalidMovePage.goto(`${baseUrl}/web-xiangqi/`, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      await invalidMovePage.waitForSelector(".xiangqi-board", { timeout: 30000 });
      await invalidMovePage.waitForFunction(() => {
        return Boolean(window.__pikafishCreateWorkerEngineOptions);
      }, null, { timeout: 5000 });
      const engineAssetOptions = await invalidMovePage.evaluate(() => window.__pikafishCreateWorkerEngineOptions);
      assert.match(engineAssetOptions.basePath, /\/web-xiangqi\/$/);
      assert.match(engineAssetOptions.workerScript, /\/web-xiangqi\/pikafish\.js$/);
      assert.match(engineAssetOptions.nnuePath, /\/web-xiangqi\/pikafish\.nnue$/);
      assert.equal(engineAssetOptions.initTimeoutMs >= 90000, true);
      await invalidMovePage.getByRole("button", { name: "Play", exact: true }).click();
      await invalidMovePage.getByRole("button", { name: "Start new game" }).click();
      await invalidMovePage.getByRole("button", { name: /You play Black/i }).click();
      await invalidMovePage.getByRole("button", { name: "Start Fresh Board", exact: true }).click();
      await invalidMovePage.waitForFunction(() => {
        return document.querySelector(".board-ai-status")?.textContent?.includes("AI move rejected");
      }, null, { timeout: 5000 });
      await invalidMovePage.waitForTimeout(800);
      const invalidMoveState = await invalidMovePage.evaluate(() => ({
        fen: document.querySelector(".bottombar-fen")?.getAttribute("title") || "",
        aiStatus: document.querySelector(".board-ai-status")?.textContent?.replace(/\s+/g, " ").trim() || "",
        moveRows: document.querySelectorAll(".mtree-row").length,
        overflowX: document.body.scrollWidth - document.body.clientWidth,
      }));
      assert.match(invalidMoveState.fen, /\sw\s/);
      assert.match(invalidMoveState.aiStatus, /AI move rejected/);
      assert.equal(invalidMoveState.moveRows, 0);
      assert.equal(invalidMoveState.overflowX <= 2, true, "Rejected AI move should not introduce horizontal overflow.");
      assert.deepEqual(invalidMoveConsoleIssues, []);

      const pvFallbackPage = await browser.newPage();
      const pvFallbackConsoleIssues = [];
      pvFallbackPage.on("console", (msg) => {
        if (msg.type() === "warning" || msg.type() === "error") {
          pvFallbackConsoleIssues.push(`${msg.type()}: ${msg.text()}`);
        }
      });
      pvFallbackPage.on("pageerror", (err) => {
        pvFallbackConsoleIssues.push(err && err.stack ? err.stack : String(err));
      });
      await pvFallbackPage.route("**/pikafish.js", (route) => route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: buildFakeAiEngineScript({
          variant: "fake-pv-only-ai-move",
          infoLines: ["info depth 2 multipv 1 score cp 35 pv h0g2"],
          bestmove: "(none)",
        }),
      }));
      await pvFallbackPage.goto(`${baseUrl}/web-xiangqi/`, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      await pvFallbackPage.waitForSelector(".xiangqi-board", { timeout: 30000 });
      await pvFallbackPage.getByRole("button", { name: "Play", exact: true }).click();
      await pvFallbackPage.getByRole("button", { name: "Start new game" }).click();
      await pvFallbackPage.getByRole("button", { name: /You play Black/i }).click();
      await pvFallbackPage.getByRole("button", { name: "Start Fresh Board", exact: true }).click();
      await pvFallbackPage.waitForFunction(() => {
        return document.querySelectorAll(".mtree-row").length === 1 &&
          /\sb\s/.test(document.querySelector(".bottombar-fen")?.getAttribute("title") || "");
      }, null, { timeout: 5000 });
      const pvFallbackState = await pvFallbackPage.evaluate(() => ({
        fen: document.querySelector(".bottombar-fen")?.getAttribute("title") || "",
        aiStatus: document.querySelector(".board-ai-status")?.textContent?.replace(/\s+/g, " ").trim() || "",
        moveRows: document.querySelectorAll(".mtree-row").length,
        overflowX: document.body.scrollWidth - document.body.clientWidth,
      }));
      assert.match(pvFallbackState.fen, /\sb\s/);
      assert.equal(pvFallbackState.moveRows, 1);
      assert.doesNotMatch(pvFallbackState.aiStatus, /AI move (rejected|unavailable)/);
      assert.equal(pvFallbackState.overflowX <= 2, true, "PV fallback AI move should not introduce horizontal overflow.");
      assert.deepEqual(pvFallbackConsoleIssues, []);
    } finally {
      await browser.close();
    }
  } finally {
    await new Promise((resolve, reject) => {
      server.close((err) => err ? reject(err) : resolve());
    });
  }

  console.log("Demo server routing and cache headers passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
