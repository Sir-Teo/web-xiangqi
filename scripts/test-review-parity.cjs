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

function parseLatestScore(lines) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    const mateMatch = line.match(/\bscore mate (-?\d+)/);
    if (mateMatch) {
      const mate = Number(mateMatch[1]);
      return mate > 0 ? 30000 - mate : -30000 - mate;
    }
    const cpMatch = line.match(/\bscore cp (-?\d+)/);
    if (cpMatch) {
      return Number(cpMatch[1]);
    }
  }
  throw new Error("No score found in engine output.");
}

async function initEngine(variant) {
  const distDir = path.resolve(__dirname, "..", "dist");
  const createPikafish = require(path.join(distDir, "pikafish.js"));
  const engine = await createPikafish({
    basePath: distDir,
    nnuePath: path.join(distDir, "pikafish.nnue"),
    variant,
    autoTune: false,
  });
  await engine.uci({ timeoutMs: 20000 });
  await engine.isReady({ timeoutMs: 20000 });
  engine.setOption("MultiPV", 1);
  engine.setOption("UCI_ShowWDL", false);
  return engine;
}

async function searchPosition(engine, positionCmd, depth) {
  const lines = [];
  const logListener = (line) => {
    lines.push(line);
  };
  engine.addMessageListener(logListener);
  try {
    engine.postMessage("ucinewgame");
    engine.postMessage(positionCmd);
    engine.postMessage(`go depth ${depth}`);
    const bestmoveLine = await waitFor(engine, lines, (line) => /^bestmove\s/.test(line), 60000, `bestmove for ${positionCmd}`);
    const bestMove = bestmoveLine.split(/\s+/)[1] || "";
    const score = parseLatestScore(lines);
    return { bestMove, score };
  } finally {
    engine.removeMessageListener(logListener);
  }
}

async function main() {
  const exactCases = [
    { name: "startpos", positionCmd: "position startpos", depth: 1 },
    { name: "after-b2e2", positionCmd: "position startpos moves b2e2", depth: 1 },
  ];
  const toleranceCases = [
    { name: "quiet-opening-1", positionCmd: "position startpos moves b2e2 h9g7 h0g2", depth: 4, tolerance: 120 },
    { name: "quiet-opening-2", positionCmd: "position startpos moves b2e2 h9g7 h0g2 b9c7", depth: 4, tolerance: 120 },
  ];

  const single = await initEngine("single");
  const threaded = await initEngine("threaded");

  try {
    for (const testCase of exactCases) {
      const singleResult = await searchPosition(single, testCase.positionCmd, testCase.depth);
      const threadedResult = await searchPosition(threaded, testCase.positionCmd, testCase.depth);
      if (singleResult.bestMove !== threadedResult.bestMove) {
        throw new Error(
          `[${testCase.name}] exact bestmove mismatch: single=${singleResult.bestMove} threaded=${threadedResult.bestMove}`
        );
      }
      console.log(
        `[exact] ${testCase.name}: ${singleResult.bestMove} (single=${singleResult.score} cp, threaded=${threadedResult.score} cp)`
      );
    }

    for (const testCase of toleranceCases) {
      const singleResult = await searchPosition(single, testCase.positionCmd, testCase.depth);
      const threadedResult = await searchPosition(threaded, testCase.positionCmd, testCase.depth);
      const delta = Math.abs(singleResult.score - threadedResult.score);
      if (delta > testCase.tolerance) {
        throw new Error(
          `[${testCase.name}] eval drift too large: single=${singleResult.score} threaded=${threadedResult.score} tolerance=${testCase.tolerance}`
        );
      }
      console.log(
        `[tolerance] ${testCase.name}: delta=${delta}cp single=${singleResult.bestMove}/${singleResult.score} threaded=${threadedResult.bestMove}/${threadedResult.score}`
      );
    }

    console.log("Review parity checks passed.");
  } finally {
    try {
      single.postMessage("quit");
      await single.terminate();
    } catch (_) {}
    try {
      threaded.postMessage("quit");
      await threaded.terminate();
    } catch (_) {}
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
