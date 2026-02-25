const { spawn } = require("child_process");
const path = require("path");
const http = require("http");

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

  const port = Number(process.env.PORT || 8181);
  const root = path.resolve(__dirname, "..");
  const server = spawn(process.execPath, [path.join(root, "scripts", "serve-demo.js")], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let serverStdout = "";
  let serverStderr = "";
  server.stdout.on("data", (chunk) => { serverStdout += String(chunk); process.stdout.write(chunk); });
  server.stderr.on("data", (chunk) => { serverStderr += String(chunk); process.stderr.write(chunk); });

  let browser;
  try {
    await waitForHttp(`http://localhost:${port}/worker-parity.html`, 30000);

    browser = await playwright.chromium.launch({
      headless: true,
      args: ["--no-sandbox"]
    });
    const page = await browser.newPage();
    const pageConsole = [];
    page.on("console", (msg) => pageConsole.push(`[${msg.type()}] ${msg.text()}`));
    page.on("pageerror", (err) => pageConsole.push(`[pageerror] ${err && err.stack ? err.stack : String(err)}`));

    await page.goto(`http://localhost:${port}/worker-parity.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector("#run-quick", { timeout: 30000 });
    await page.click("#run-quick");

    await page.waitForFunction(() => {
      const el = document.querySelector("#status");
      return !!el && /worker parity passed/i.test(el.textContent || "");
    }, { timeout: 300000 });

    const status = await page.$eval("#status", (el) => el.textContent || "");
    const outputTail = await page.$eval("#out", (el) => {
      const t = el.textContent || "";
      return t.slice(-3000);
    });

    console.log("Browser worker parity passed.");
    console.log("Status:", status.trim());
    console.log("Output tail:\n" + outputTail);
    if (pageConsole.length) {
      console.log("Console tail:\n" + pageConsole.slice(-20).join("\n"));
    }
  } catch (e) {
    let pageDump = "";
    try {
      if (browser) {
        const pages = browser.contexts().flatMap((c) => c.pages());
        const page = pages[0];
        if (page) {
          const status = await page.$eval("#status", (el) => el.textContent || "").catch(() => "");
          const out = await page.$eval("#out", (el) => (el.textContent || "").slice(-6000)).catch(() => "");
          pageDump = `\nPage status: ${status}\nPage output tail:\n${out}\n`;
        }
      }
    } catch (_) {}
    throw new Error(
      (e && e.stack ? e.stack : String(e)) +
      pageDump +
      "\nServer stdout:\n" + serverStdout.slice(-4000) +
      "\nServer stderr:\n" + serverStderr.slice(-4000)
    );
  } finally {
    try { if (browser) await browser.close(); } catch (_) {}
    if (!server.killed) {
      server.kill("SIGTERM");
      await new Promise((resolve) => {
        const t = setTimeout(() => {
          try { server.kill("SIGKILL"); } catch (_) {}
          resolve();
        }, 2000);
        server.once("exit", () => {
          clearTimeout(t);
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
