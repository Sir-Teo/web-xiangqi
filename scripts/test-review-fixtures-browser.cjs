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

async function main() {
  let playwright;
  try {
    playwright = require("playwright");
  } catch (e) {
    throw new Error(
      "Missing playwright dependency. Install it first (e.g. `npm install --no-save playwright`) before running this script."
    );
  }

  const port = Number(process.env.PORT || 4174);
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

    const result = await page.evaluate(async (runtimeBasePath) => {
      const review = await import(`${runtimeBasePath}src/utils/review.ts`);
      const storage = await import(`${runtimeBasePath}src/utils/gameLibrary.ts`);
      const gameExport = await import(`${runtimeBasePath}src/utils/gameExport.ts`);
      const serviceWorkerCleanup = await import(`${runtimeBasePath}src/utils/serviceWorkerCleanup.ts`);

      const thresholdCases = [
        [40, "best"],
        [41, "good"],
        [90, "good"],
        [91, "inaccuracy"],
        [180, "inaccuracy"],
        [181, "mistake"],
        [320, "mistake"],
        [321, "blunder"],
      ];

      for (const [delta, expected] of thresholdCases) {
        const actual = review.classifyMoveQuality(delta);
        if (actual !== expected) {
          throw new Error(`classifyMoveQuality(${delta}) => ${actual}, expected ${expected}`);
        }
      }

      const lossCases = [
        [0, 200, "red", 0],
        [200, 0, "red", 200],
        [200, 0, "black", 0],
        [0, 200, "black", 200],
      ];

      for (const [before, after, side, expected] of lossCases) {
        const actual = review.getEvalLossForMove(before, after, side);
        if (actual !== expected) {
          throw new Error(`getEvalLossForMove(${before}, ${after}, ${side}) => ${actual}, expected ${expected}`);
        }
      }

      const treeNodes = {
        root: { parentId: null },
        n1: { parentId: "root", record: { uci: "b2e2", piece: "C", ply: 1, evalScore: 22 } },
        n2: { parentId: "n1", record: { uci: "h9g7", piece: "n", ply: 2, evalScore: 148, bestMove: "b9c7" } },
        n3: { parentId: "n2", record: { uci: "h0g2", piece: "N", ply: 3, evalScore: -76, bestMove: "a0a1" } },
        n4: { parentId: "n3", record: { uci: "b9c7", piece: "n", ply: 4, evalScore: 300, bestMove: "i0i1" } },
      };

      const { summary, annotations } = review.computeReviewArtifacts(
        ["n1", "n2", "n3", "n4"],
        treeNodes,
        { root: 0 },
        1700000000000,
      );

      const qualities = annotations.map((entry) => entry.quality).join(",");
      if (qualities !== "best,inaccuracy,mistake,blunder") {
        throw new Error(`Unexpected annotation qualities: ${qualities}`);
      }

      const rankedMoments = summary.keyMoments.map((moment) => `${moment.moveIndex}:${moment.quality}`).join(",");
      if (rankedMoments !== "3:blunder,2:mistake,1:inaccuracy") {
        throw new Error(`Unexpected key-moment order: ${rankedMoments}`);
      }

      const migratedLegacy = storage.normalizeSavedGame({
        id: "legacy-1",
        savedAt: 1710000000000,
        gameMode: "PvP",
        moves: ["b2e2", "h9g7"],
      });
      if (!migratedLegacy || migratedLegacy.result !== "ongoing" || migratedLegacy.review !== undefined) {
        throw new Error("Legacy save migration failed.");
      }

      const migratedReviewed = storage.normalizeSavedGame({
        id: "reviewed-1",
        savedAt: 1710000001000,
        gameMode: "PvP",
        moves: ["b2e2", "h9g7"],
        result: "red",
        review: {
          summary: {
            totalMoves: 2,
            accuracy: 74,
            bestCount: 0,
            goodCount: 1,
            inaccuracyCount: 1,
            mistakeCount: 0,
            blunderCount: 0,
            reviewedAt: 1710000001000,
            keyMoments: [
              {
                moveIndex: 1,
                jumpTarget: 1,
                ply: 2,
                side: "black",
                quality: "inaccuracy",
                swing: 126,
                evalBefore: 22,
                evalAfter: 148,
                bestMove: "b9c7",
                playedMove: "h9g7",
                note: "Small slip. B9C7 was stronger by 126cp.",
              },
            ],
          },
          annotations: [
            { moveIndex: 0, evalScore: 22, quality: "best", reviewNote: "Engine-approved move." },
            { moveIndex: 1, evalScore: 148, bestMove: "b9c7", quality: "inaccuracy", swing: 126, reviewNote: "Small slip. B9C7 was stronger by 126cp." },
          ],
        },
      });

      if (!migratedReviewed?.review) {
        throw new Error("Reviewed save migration failed.");
      }

      if (migratedReviewed.review.summary.lineSignature !== review.makeReviewLineSignatureFromMoves(migratedReviewed.moves)) {
        throw new Error("Reviewed save line signature was not normalized.");
      }

      if (migratedReviewed.review.annotations[1]?.quality !== "inaccuracy") {
        throw new Error("Reviewed save annotations were not preserved.");
      }

      const clipboardWrites = [];
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text) => {
            clipboardWrites.push(String(text));
          },
        },
      });
      if (!(await gameExport.copyToClipboard("modern clipboard"))) {
        throw new Error("Clipboard API copy failed.");
      }
      if (clipboardWrites[0] !== "modern clipboard") {
        throw new Error("Clipboard API copy wrote the wrong text.");
      }

      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async () => {
            throw new DOMException("Blocked", "NotAllowedError");
          },
        },
      });
      const focusedInput = document.createElement("input");
      focusedInput.value = "keep focus";
      document.body.appendChild(focusedInput);
      focusedInput.focus();
      let fallbackCopyText = "";
      Object.defineProperty(document, "execCommand", {
        configurable: true,
        value: (command) => {
          if (command !== "copy") return false;
          const active = document.activeElement;
          fallbackCopyText = active && "value" in active ? String(active.value) : "";
          return true;
        },
      });
      if (!(await gameExport.copyToClipboard("fallback clipboard"))) {
        throw new Error("Selection fallback copy failed.");
      }
      if (fallbackCopyText !== "fallback clipboard") {
        throw new Error(`Selection fallback copied "${fallbackCopyText}" instead of the requested text.`);
      }
      if (document.querySelector("textarea[readonly]")) {
        throw new Error("Selection fallback left a temporary textarea in the document.");
      }
      if (document.activeElement !== focusedInput) {
        throw new Error("Selection fallback did not restore focus.");
      }
      focusedInput.remove();

      if (!serviceWorkerCleanup.isLegacyRuntimeCacheKey("pikafish-demo-v1-shell")) {
        throw new Error("Legacy runtime cache prefix was not detected.");
      }
      if (serviceWorkerCleanup.isLegacyRuntimeCacheKey("unrelated-cache")) {
        throw new Error("Unrelated cache key was treated as legacy runtime cache.");
      }

      const unregistered = [];
      const deletedCaches = [];
      const cleanupResult = await serviceWorkerCleanup.cleanupLegacyRuntimeStorage({
        appBasePath: "/web-xiangqi/",
        locationHref: "https://example.test/web-xiangqi/",
        serviceWorker: {
          getRegistrations: async () => [
            {
              scope: "https://example.test/web-xiangqi/",
              active: { scriptURL: "https://example.test/web-xiangqi/sw.js" },
              unregister: async () => {
                unregistered.push("web-xiangqi");
                return true;
              },
            },
            {
              scope: "https://example.test/other/",
              active: { scriptURL: "https://example.test/other/sw.js" },
              unregister: async () => {
                unregistered.push("other");
                return true;
              },
            },
          ],
        },
        cacheStorage: {
          keys: async () => ["pikafish-demo-v1-shell", "pikafish-demo-v1-engine", "app-cache"],
          delete: async (cacheKey) => {
            deletedCaches.push(cacheKey);
            return true;
          },
        },
      });

      if (cleanupResult.registrationsChecked !== 2 || cleanupResult.registrationsUnregistered !== 1) {
        throw new Error(`Unexpected legacy SW cleanup result: ${JSON.stringify(cleanupResult)}`);
      }
      if (unregistered.join(",") !== "web-xiangqi") {
        throw new Error(`Unexpected service worker unregisters: ${unregistered.join(",")}`);
      }
      if (deletedCaches.join(",") !== "pikafish-demo-v1-shell,pikafish-demo-v1-engine") {
        throw new Error(`Unexpected deleted cache keys: ${deletedCaches.join(",")}`);
      }

      return {
        accuracy: summary.accuracy,
        keyMoments: summary.keyMoments.length,
        cacheKeysDeleted: cleanupResult.cacheKeysDeleted,
      };
    }, basePath);

    console.log("Review fixture tests passed.");
    console.log(`Accuracy fixture: ${result.accuracy}%`);
    console.log(`Key moments fixture: ${result.keyMoments}`);
    console.log(`Legacy runtime caches deleted: ${result.cacheKeysDeleted}`);
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
