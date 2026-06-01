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
        body: `
          window.Pikafish = function Pikafish() {};
          window.Pikafish.createWorkerEngine = async () => {
            const listeners = [];
            const emit = (line) => listeners.forEach((listener) => listener(line));
            return {
              variant: "fake-invalid-ai-move",
              addMessageListener(listener) { listeners.push(listener); },
              removeMessageListener(listener) {
                const index = listeners.indexOf(listener);
                if (index >= 0) listeners.splice(index, 1);
              },
              postMessage(command) {
                if (command === "uci") {
                  setTimeout(() => {
                    emit("id name Fake Invalid Move");
                    emit("option name MultiPV type spin default 1 min 1 max 128");
                    emit("option name UCI_ShowWDL type check default false");
                    emit("uciok");
                  }, 0);
                } else if (command === "isready") {
                  setTimeout(() => emit("readyok"), 0);
                } else if (/^go\\b/.test(command)) {
                  setTimeout(() => {
                    emit("info depth 2 multipv 1 score cp 0 pv a0a9");
                    emit("bestmove a0a9");
                  }, 20);
                }
              },
              terminate() { return Promise.resolve(); },
            };
          };
        `,
      }));
      await invalidMovePage.goto(`${baseUrl}/web-xiangqi/`, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      await invalidMovePage.waitForSelector(".xiangqi-board", { timeout: 30000 });
      await invalidMovePage.getByRole("button", { name: "Play", exact: true }).click();
      await invalidMovePage.getByRole("button", { name: "Start new game" }).click();
      await invalidMovePage.getByRole("button", { name: /You play Black/i }).click();
      await invalidMovePage.getByRole("button", { name: "Start Fresh Board", exact: true }).click();
      await invalidMovePage.waitForFunction(() => {
        return Boolean(document.querySelector(".board-ai-status"));
      }, null, { timeout: 5000 });
      await invalidMovePage.waitForTimeout(800);
      const invalidMoveState = await invalidMovePage.evaluate(() => ({
        fen: document.querySelector(".bottombar-fen")?.getAttribute("title") || "",
        moveRows: document.querySelectorAll(".mtree-row").length,
        overflowX: document.body.scrollWidth - document.body.clientWidth,
      }));
      assert.match(invalidMoveState.fen, /\sw\s/);
      assert.equal(invalidMoveState.moveRows, 0);
      assert.equal(invalidMoveState.overflowX <= 2, true, "Rejected AI move should not introduce horizontal overflow.");
      assert.deepEqual(invalidMoveConsoleIssues, []);
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
