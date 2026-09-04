/**
 * A seeded random walk over the app, checking invariants as it goes.
 *
 * `test-ui-layout.cjs` asserts specific behaviours: it knows what it is looking
 * for and fails when that one thing is wrong. This asks the opposite question
 * -- drive the app the way nobody planned for, and see whether anything that
 * should always be true stops being true. The two find different bugs, and the
 * ones this finds are the ones nobody thought to write a case for.
 *
 * **This is not a gate**, and is deliberately not in `verify` or in `ci.yml`.
 * A random walk that fails tells you a seed and a round number, not a
 * behaviour, and a suite that sometimes fails for reasons nobody has named is
 * worse than no suite. Run it when changing something structural -- layout,
 * navigation, the review, storage -- and when it does fail, the seed reproduces
 * it exactly.
 *
 *     node scripts/test-ui-soak.cjs                 # three seeds, both profiles
 *     node scripts/test-ui-soak.cjs --seeds 1,2,3,4 --rounds 200
 *     node scripts/test-ui-soak.cjs --profile mobile --seeds 7
 *
 * ## What it checks, and why each one
 *
 * Everything here is a property of *any* state the app can be in, which is what
 * makes it usable from a random walk:
 *
 * - **The FEN parses.** Ten ranks of nine points with exactly two generals. The
 *   board and the engine both read this string; a malformed one means the two
 *   are looking at different games.
 * - **The board keeps its 9:10 box** and stays inside the viewport. The board
 *   is sized from the height of its row, and every layout change in this repo
 *   has had to be checked against that -- see "The board paid for the reader's
 *   text size" in docs/architecture.md.
 * - **Nothing overflows sideways.** A phone that scrolls horizontally is a
 *   layout bug that no single-state check catches, because it takes a
 *   particular combination of panel, notice and viewport to produce.
 * - **No `NaN` or `undefined` reaches the screen.** The review is arithmetic on
 *   engine output, and a non-finite value has reached a `d` attribute here
 *   before.
 * - **The error boundary has not fired**, and no page error was thrown.
 *
 * The board check is skipped when the stage is `display: none`, which is what
 * the phone's analysis view does -- a zero-width board there is the layout
 * working, not failing.
 */
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");

const DESKTOP = { width: 1440, height: 900 };
const RESIZE_WIDTHS = [1440, 1100, 920, 760, 390];
const START_LINE = "b2b4+b7c7+b4d4+e9e8+h2c2+c7f7+c2e2+e8f8+e2i2+f7f6";
const BASE = "http://127.0.0.1:8193/web-xiangqi/";

function parseArgs(argv) {
  const args = { seeds: [1, 2, 3], rounds: 140, profile: "both" };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--seeds") args.seeds = String(argv[++i]).split(",").map(Number).filter(Number.isFinite);
    else if (argv[i] === "--rounds") args.rounds = Number(argv[++i]);
    else if (argv[i] === "--profile") args.profile = String(argv[++i]);
  }
  return args;
}

/** Seeded, so a failure reproduces from its seed and round number alone. */
function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const status = await new Promise((resolve, reject) => {
        const req = http.get(url, (res) => { res.resume(); resolve(res.statusCode); });
        req.on("error", reject);
        req.setTimeout(2000, () => req.destroy(new Error("timeout")));
      });
      if (status && status < 500) return;
    } catch (_) { /* not up yet */ }
    if (Date.now() > deadline) throw new Error(`Server never answered at ${url}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** Runs in the page. Returns the names of broken invariants, or an empty list. */
function checkInvariants() {
  const out = [];
  const fenText = (document.body.innerText.match(/FEN: ([^\n]+)/) || [])[1] || "";
  if (fenText) {
    const rows = fenText.trim().split(" ")[0].split("/");
    if (rows.length !== 10) out.push(`fen has ${rows.length} ranks`);
    for (const row of rows) {
      let points = 0;
      for (const ch of row) points += /\d/.test(ch) ? Number(ch) : 1;
      if (points !== 9) { out.push(`fen rank "${row}" is ${points} points wide`); break; }
    }
    const generals = (fenText.match(/[kK]/g) || []).length;
    if (generals !== 2) out.push(`fen has ${generals} generals`);
  }

  const stage = document.querySelector(".board-stage");
  const board = document.querySelector(".xiangqi-board");
  // A hidden stage is the phone's analysis view, where a zero box is correct.
  const boardShown = Boolean(stage && board) && getComputedStyle(stage).display !== "none";
  if (boardShown) {
    const box = board.getBoundingClientRect();
    if (box.width > 4) {
      if (Math.abs(box.width / box.height - 0.9) > 0.03) {
        out.push(`board is ${(box.width / box.height).toFixed(3)} rather than 9:10`);
      }
      if (box.right > window.innerWidth + 2) out.push("board reaches past the right edge");
      const pieces = document.querySelectorAll(".piece").length;
      if (pieces < 8 || pieces > 32) out.push(`${pieces} pieces on the board`);
    }
  }

  if (document.body.scrollWidth - document.body.clientWidth > 2) out.push("page scrolls sideways");
  if (/\bNaN\b|\bundefined\b/.test(document.body.innerText)) out.push("NaN or undefined is on screen");
  if (document.querySelector(".app-error-fallback")) out.push("the error boundary fired");
  return out;
}

async function runOne(browser, playwright, { seed, rounds, profile }) {
  const random = rng(seed);
  const phone = profile === "mobile";
  const context = await browser.newContext(
    phone
      ? { ...playwright.devices["iPhone 13"], isMobile: true, hasTouch: true }
      : { viewport: DESKTOP }
  );
  const problems = [];
  try {
    const page = await context.newPage();
    page.on("pageerror", (err) => problems.push(`page error: ${String(err).split("\n")[0].slice(0, 180)}`));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const text = message.text();
      if (/favicon|net::ERR|Failed to load resource/.test(text)) return;
      problems.push(`console error: ${text.slice(0, 180)}`);
    });
    await page.addInitScript(() => {
      try { window.localStorage.clear(); } catch (_) { /* storage unavailable */ }
      try {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      } catch (_) { /* already defined */ }
    });

    await page.goto(`${BASE}?moves=${START_LINE}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector(".xiangqi-board", { timeout: 30000 });
    for (const name of [/keep the link/i, /start fresh/i, /restore/i]) {
      const button = page.getByRole("button", { name });
      if (await button.count()) { await button.first().click().catch(() => {}); break; }
    }
    await page.waitForTimeout(600);

    const tap = async (locator) => {
      if (await locator.count() && await locator.first().isVisible()) {
        await locator.first().click({ timeout: 2500 }).catch(() => {});
      }
    };
    const key = async (name) => {
      // Somewhere that is not a control, so the global handler is what answers.
      await page.evaluate(() => document.body.click());
      await page.keyboard.press(name);
    };

    const actions = phone
      ? [
        () => tap(page.getByRole("button", { name: /^board$/i })),
        () => tap(page.getByRole("button", { name: /^analysis$/i })),
        () => tap(page.getByTestId("mobile-analysis-tab-moves")),
        () => tap(page.getByTestId("mobile-analysis-tab-review")),
        () => tap(page.getByTestId("mobile-analysis-tab-engine")),
        () => tap(page.getByTestId("mobile-analysis-tab-graph")),
        () => tap(page.getByTestId("mobile-analysis-tab-library")),
        () => tap(page.getByTestId("mobile-more-actions-btn")),
        () => tap(page.getByTestId("mobile-command-palette-btn")),
        () => page.keyboard.press("Escape"),
        async () => {
          const box = await (await page.$(".xiangqi-board"))?.boundingBox();
          if (!box) return;
          const file = Math.floor(random() * 9);
          const rank = Math.floor(random() * 10);
          await page.mouse.click(
            box.x + box.width * (0.055 + (file / 8) * 0.89),
            box.y + box.height * (0.05 + (rank / 9) * 0.9)
          );
        },
      ]
      : [
        () => key("ArrowLeft"),
        () => key("ArrowRight"),
        () => key("ArrowUp"),
        () => key("ArrowDown"),
        () => key("f"),
        () => key("x"),
        () => tap(page.getByTestId("analysis-tab-tree")),
        () => tap(page.getByTestId("analysis-tab-review")),
        () => tap(page.getByTestId("analysis-tab-engine")),
        () => tap(page.getByTestId("left-panel-tab-graph")),
        () => tap(page.getByTestId("left-panel-tab-library")),
        async () => {
          await page.evaluate((r) => {
            const chips = document.querySelectorAll(".mtree-chip");
            if (chips.length) chips[Math.floor(r * chips.length)].click();
          }, random());
        },
        async () => {
          const field = page.getByTestId("move-comment-input");
          if (await field.count() && await field.isVisible() && !(await field.isDisabled())) {
            await field.fill(`soak note ${Math.floor(random() * 1000)}`, { timeout: 4000 });
            await page.evaluate(() => document.querySelector('[data-testid="move-comment-input"]').blur());
          }
        },
        async () => {
          await page.keyboard.press("Control+k");
          await page.waitForTimeout(120);
          await page.keyboard.press("Escape");
        },
        async () => {
          const width = RESIZE_WIDTHS[Math.floor(random() * RESIZE_WIDTHS.length)];
          await page.setViewportSize({ width, height: DESKTOP.height });
        },
      ];

    for (let round = 0; round < rounds && problems.length < 5; round += 1) {
      const index = Math.floor(random() * actions.length);
      try {
        await actions[index]();
      } catch (error) {
        problems.push(`round ${round}: action ${index} threw ${String(error.message).split("\n")[0].slice(0, 120)}`);
      }
      await page.waitForTimeout(90 + Math.floor(random() * 220));
      if (round % 5 === 0) {
        // The check itself can lose its execution context if the page is
        // mid-reload; that is the harness losing its footing rather than the
        // app breaking, so it is not a finding.
        const broken = await page.evaluate(checkInvariants).catch(() => []);
        if (broken.length) problems.push(`round ${round}: ${broken.join("; ")}`);
      }
    }

    if (!phone) await page.setViewportSize(DESKTOP);
    await page.waitForTimeout(700);
    const broken = await page.evaluate(checkInvariants).catch(() => []);
    if (broken.length) problems.push(`at rest: ${broken.join("; ")}`);
  } finally {
    await context.close();
  }
  return problems;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let playwright;
  try {
    playwright = require("playwright");
  } catch (_) {
    throw new Error("Missing playwright dependency. Install it first (e.g. `npm install --no-save playwright`).");
  }

  const root = path.resolve(__dirname, "..");
  const viteBin = path.join(root, "node_modules", "vite", "bin", "vite.js");
  const server = spawn(process.execPath, [viteBin, "--host", "127.0.0.1", "--port", "8193"], {
    cwd: root,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.resume();
  server.stderr.resume();

  let browser;
  const failures = [];
  try {
    await waitForHttp(BASE, 30000);
    browser = await playwright.chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const profiles = args.profile === "both" ? ["desktop", "mobile"] : [args.profile];
    for (const profile of profiles) {
      for (const seed of args.seeds) {
        const problems = await runOne(browser, playwright, { seed, rounds: args.rounds, profile });
        const label = `${profile} seed ${seed}`;
        if (problems.length) {
          failures.push(`${label}:\n    ${problems.join("\n    ")}`);
          console.log(`${label}: ${problems.length} problem(s)`);
        } else {
          console.log(`${label}: clean (${args.rounds} rounds)`);
        }
      }
    }
  } finally {
    if (browser) await browser.close();
    if (!server.killed) {
      server.kill("SIGTERM");
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          try { server.kill("SIGKILL"); } catch (_) { /* already gone */ }
          resolve();
        }, 2000);
        server.once("exit", () => { clearTimeout(timer); resolve(); });
      });
    }
  }

  if (failures.length) {
    throw new Error(`Soak found problems. Rerun one with --seeds <n> --profile <p>.\n\n${failures.join("\n\n")}`);
  }
  console.log("\nSoak clean: no invariant broken and no page error.");
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
