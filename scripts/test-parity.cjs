const fs = require("fs");
const path = require("path");

async function waitFor(engine, lines, predicate, timeoutMs, label) {
  for (const line of lines) {
    if (predicate(line)) return line;
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timeout waiting for ${label}`));
    }, timeoutMs);

    function onLine(line) {
      if (!predicate(line)) return;
      cleanup();
      resolve(line);
    }

    function cleanup() {
      clearTimeout(timer);
      engine.removeMessageListener(onLine);
    }

    engine.addMessageListener(onLine);
  });
}

async function waitForFile(engine, filePath, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      return await engine.readFile(filePath);
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timeout waiting for file ${filePath}`);
}

async function main() {
  const variant = (process.argv[2] || process.env.PIKAFISH_VARIANT || "single").trim();
  const distDir = path.resolve(__dirname, "..", "dist");
  const createPikafish = require(path.join(distDir, "pikafish.js"));

  const engine = await createPikafish({
    basePath: distDir,
    nnuePath: path.join(distDir, "pikafish.nnue"),
    variant,
    autoTune: false,
  });

  const lines = [];
  const logListener = (line) => {
    lines.push(line);
    console.log(line);
  };
  engine.addMessageListener(logListener);

  // Wrapper parity helpers
  for (const key of ["waitForLine", "readFile", "writeFile", "unlink", "mkdir", "readdir", "uci", "isReady", "setOption"]) {
    if (typeof engine[key] !== "function") throw new Error(`Missing JS engine method: ${key}`);
  }

  await engine.uci({ timeoutMs: 20000 });
  if (!lines.some((l) => /^option name Debug Log File\b/.test(l))) {
    throw new Error("Missing native option in WASM build: Debug Log File");
  }
  if (!lines.some((l) => /^option name NumaPolicy\b/.test(l))) {
    throw new Error("Missing native option in WASM build: NumaPolicy");
  }
  await engine.isReady({ timeoutMs: 20000 });

  // Engine option parity: Debug Log File (writes to Emscripten FS)
  const debugLogPath = "/tmp/pikafish-debug.log";
  try { await engine.unlink(debugLogPath); } catch (_) {}
  engine.setOption("Debug Log File", debugLogPath);

  // Native debug commands parity: d / eval / flip
  engine.postMessage("position startpos");
  engine.postMessage("rulejudge");
  await waitFor(engine, lines, (l) => /^rulejudge (none|claim\b)/i.test(l), 10000, "rulejudge output");

  engine.postMessage("d");
  await waitFor(engine, lines, (l) => /^Fen: rnbakabnr\/9\/1c5c1\/p1p1p1p1p\/9\/9\/P1P1P1P1P\/1C5C1\/9\/RNBAKABNR w /i.test(l), 10000, "d output (startpos fen)");

  engine.postMessage("eval");
  await waitFor(engine, lines, (l) => /NNUE evaluation|Final evaluation/i.test(l), 20000, "eval output");

  engine.postMessage("flip");
  engine.postMessage("d");
  await waitFor(engine, lines, (l) => /^Fen: rnbakabnr\/9\/1c5c1\/p1p1p1p1p\/9\/9\/P1P1P1P1P\/1C5C1\/9\/RNBAKABNR b /i.test(l), 10000, "flip+d output (flipped side)");

  engine.postMessage("help");
  await waitFor(engine, lines, (l) => /Pikafish is a powerful xiangqi engine/.test(l), 10000, "help text");

  engine.postMessage("compiler");
  await waitFor(engine, lines, (l) => /Compiled by|settings:|compiler/i.test(l), 10000, "compiler output");
  // Close the log to flush before reading it back.
  engine.setOption("Debug Log File", "");
  await waitForFile(engine, debugLogPath, 10000);
  const debugLog = await engine.readFile(debugLogPath, { encoding: "utf8" });
  if (!/Compiled by|Compilation architecture/i.test(debugLog)) {
    throw new Error("Debug Log File did not capture engine output");
  }
  // Native option parity: NumaPolicy should be accepted on Emscripten too.
  engine.setOption("NumaPolicy", "auto");

  engine.postMessage("this_is_not_a_real_command");
  await waitFor(engine, lines, (l) => /^Unknown command: /.test(l), 10000, "unknown command message");

  // FS bridge parity (JS-side)
  await engine.mkdir("/tmp");
  await engine.writeFile("/tmp/hello.txt", "hello");
  const hello = await engine.readFile("/tmp/hello.txt", { encoding: "utf8" });
  if (hello !== "hello") throw new Error(`FS read/write mismatch: ${hello}`);
  const entries = await engine.readdir("/tmp");
  if (!entries.includes("hello.txt")) throw new Error("FS readdir missing hello.txt");
  await engine.unlink("/tmp/hello.txt");

  // Native utility command parity: export_net
  const exportPath = "/tmp/exported.nnue";
  try { await engine.unlink(exportPath); } catch (_) {}
  engine.postMessage(`export_net ${exportPath}`);
  const exported = await waitForFile(engine, exportPath, 120000);
  if (!(exported instanceof Uint8Array) || exported.length < 1024) {
    throw new Error(`export_net produced invalid file (${exported && exported.length})`);
  }
  console.log(`export_net ok (${exported.length} bytes)`);
  await engine.unlink(exportPath);

  // Native utility command parity: bench
  // Use a very small depth for quick runtime.
  engine.postMessage("bench 16 1 1 default depth");
  await waitFor(engine, lines, (l) => /Nodes searched|Total time/.test(l), 120000, "bench output");

  // Native utility command parity: speedtest / benchmark (alias constant in uci.cpp)
  // Use a very short target duration so CI/local checks stay fast.
  engine.postMessage("speedtest 1 16 1");
  await waitFor(engine, lines, (l) => /Total nodes searched|Nodes\/second/.test(l), 120000, "speedtest output");

  engine.postMessage("quit");
  engine.removeMessageListener(logListener);
  await engine.terminate();

  console.log(`\nParity test passed (${variant}).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
