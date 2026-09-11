const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(base);
    const measurement = await page.evaluate(async () => {
      const { buildLibraryPositionIndex } = await import('./src/utils/positionExplorer.ts');
      const { parseFenBoard, START_FEN } = await import('./src/utils/xiangqi.ts');
      const games = Array.from({ length: 400 }, (_, i) => ({ id: String(i), savedAt: i, gameMode: 'PvP', moves: Array.from({ length: 1024 }, (_, n) => ['a0a1', 'a9a8', 'a1a0', 'a8a9'][n % 4]) }));
      const start = performance.now();
      buildLibraryPositionIndex(games);
      const synchronousMs = performance.now() - start;
      let frames = 0;
      let done = false;
      const tick = () => { if (!done) { frames++; requestAnimationFrame(tick); } };
      requestAnimationFrame(tick);
      const workerStart = performance.now();
      const report = await new Promise((resolve, reject) => {
        const worker = new Worker(new URL('./src/workers/positionExplorer.worker.ts', location.href), { type: 'module' });
        worker.onerror = error => { worker.terminate(); reject(new Error(error.message)); };
        worker.onmessage = ({ data }) => { worker.terminate(); resolve(data); };
        worker.postMessage({ type: 'build', games });
        worker.postMessage({ type: 'lookup', requestId: 1, board: parseFenBoard(START_FEN), side: 'w' });
      });
      done = true;
      return { synchronousMs, workerWallMs: performance.now() - workerStart, framesWhileIndexing: frames, report };
    });
    assert.equal(measurement.report.report.games, 400);
    assert.equal(measurement.report.skipped, 0);
    assert.equal(measurement.report.report.moves[0].games, 400);
    assert.ok(measurement.framesWhileIndexing > 0, 'Board must be able to paint while indexing');
    console.log(JSON.stringify(measurement));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
