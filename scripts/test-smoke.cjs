const path = require("path");
const { loadPikafishNode } = require("./load-pikafish-node.cjs");

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
      if (predicate(line)) {
        cleanup();
        resolve(line);
      }
    }

    function cleanup() {
      clearTimeout(timer);
      engine.removeMessageListener(onLine);
    }

    engine.addMessageListener(onLine);
  });
}

async function main() {
  const variant = (process.argv[2] || process.env.PIKAFISH_VARIANT || "threaded").trim();
  const distDir = path.resolve(__dirname, "..", "dist");
  const pikafish = loadPikafishNode(distDir, variant, "pikafish-smoke");

  const engine = await pikafish.createPikafish({
    basePath: distDir,
    nnuePath: path.join(distDir, "pikafish.nnue"),
    variant: pikafish.variant,
    coreFactory: pikafish.coreFactory,
    allowSIMD: pikafish.variant.includes("simd"),
  });

  const lines = [];
  const logListener = (line) => {
    lines.push(line);
    console.log(line);
  };
  engine.addMessageListener(logListener);

  engine.postMessage("uci");
  await waitFor(engine, lines, (line) => line === "uciok", 20000, "uciok");

  engine.postMessage("isready");
  await waitFor(engine, lines, (line) => line === "readyok", 20000, "readyok");

  engine.postMessage("ucinewgame");
  engine.postMessage("position startpos");
  engine.postMessage("go depth 1");

  const bestmove = await waitFor(engine, lines, (line) => /^bestmove\s/.test(line), 60000, "bestmove");

  engine.postMessage("quit");
  engine.removeMessageListener(logListener);
  await engine.terminate();

  if (!/^bestmove\s+\S+/.test(bestmove)) {
    throw new Error(`Unexpected bestmove line: ${bestmove}`);
  }

  if (!lines.some((line) => /id name/i.test(line))) {
    throw new Error("Did not receive engine id");
  }

  console.log(`\nSmoke test passed (${pikafish.variant}).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
