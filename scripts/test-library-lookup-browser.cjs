const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5200/web-xiangqi/';
(async () => {
  const browser = await browserType.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.addInitScript(() => {
      localStorage.setItem('xiangqi:library:v1', JSON.stringify([{ id: 'discover-worker', savedAt: 1, gameMode: 'PvP', moves: ['h2e2'] }]));
      const NativeWorker = Worker;
      window.Worker = function(url, options) {
        if (String(url).includes('positionExplorer.worker')) window.__explorerUrl = String(url);
        return new NativeWorker(url, options);
      };
    });
    await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: `
      window.Pikafish = function() {};
      window.Pikafish.createWorkerEngine = async () => {
        const listeners = []; const emit = line => listeners.forEach(listener => listener(line));
        return { variant: 'single-simd', addMessageListener: listener => listeners.push(listener), terminate() {}, postMessage(command) {
          if (command === 'uci') queueMicrotask(() => emit('uciok'));
          if (command === 'isready') queueMicrotask(() => emit('readyok'));
          if (command.startsWith('go ') || command === 'stop') queueMicrotask(() => emit('bestmove (none)'));
        } };
      };` }));
    await page.goto(base);
    await page.getByTestId('library-continuation-h2e2').waitFor({ state: 'visible' });
    const measurement = await page.evaluate(async () => {
      // Wrap the real built worker to count duplicate-game checks. No engine
      // or explorer algorithm is replaced; timing is descriptive, not a gate.
      const source = `
        let checks = 0;
        const has = Set.prototype.has;
        Set.prototype.has = function(value) {
          if (typeof value === 'string' && value.startsWith('cache-')) checks++;
          return has.call(this, value);
        };
        const post = self.postMessage.bind(self);
        self.postMessage = data => post({ ...data, checks });
        await import(${JSON.stringify(window.__explorerUrl)});
        post({ ready: true });
      `;
      const url = URL.createObjectURL(new Blob([source], { type: 'application/javascript' }));
      const worker = new Worker(url, { type: 'module' });
      let pending;
      worker.onmessage = ({ data }) => pending?.resolve(data);
      worker.onerror = event => pending?.reject(new Error(event.message));
      const receive = () => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Worker reply timed out')), 30000);
        pending = { resolve: data => { clearTimeout(timer); resolve(data); }, reject: error => { clearTimeout(timer); reject(error); } };
      });
      try {
        await receive();
        const cycle = ['a0a1', 'a9a8', 'a1a0', 'a8a9'];
        const games = Array.from({ length: 400 }, (_, i) => ({ id: 'cache-' + i, savedAt: i + 1, gameMode: 'PvP', label: 'Study ' + i, result: 'draw', moves: Array.from({ length: 1024 }, (_, ply) => cycle[ply % 4]) }));
        const rows = ['RNBAKABNR', '9', '1C5C1', 'P1P1P1P1P', '9', '9', 'p1p1p1p1p', '1c5c1', '9', 'rnbakabnr'];
        const board = rows.map(row => [...row].flatMap(piece => /[1-9]/.test(piece) ? Array(Number(piece)).fill('') : [piece]));
        let requestId = 0;
        const query = async (position = board, side = 'w') => {
          const reply = receive();
          const id = ++requestId;
          worker.postMessage({ type: 'lookup', requestId: id, board: position, side });
          const result = await reply;
          if (result.requestId !== id) throw new Error('Reply used a stale request ID');
          return result;
        };
        worker.postMessage({ type: 'build', games });
        const first = await query();
        const samples = [];
        for (let i = 0; i < 20; i++) {
          const start = performance.now();
          const reply = await query();
          samples.push({ ms: performance.now() - start, checks: reply.checks - first.checks });
          if (JSON.stringify(reply.report) !== JSON.stringify(first.report)) throw new Error('Revisited position changed its report');
        }
        const black = await query(board, 'b');
        // Same IDs and position, new line/result/label, plus an illegal suffix.
        const replacement = games.slice(0, 2).map(game => ({ ...game, label: 'Updated', result: 'black', moves: ['h2e2', 'a0a9'] }));
        worker.postMessage({ type: 'build', games: replacement });
        const changed = await query();
        worker.postMessage({ type: 'build', games: [] });
        const cleared = await query();
        return { first, samples, black: black.report, changed, cleared: cleared.report };
      } finally { worker.terminate(); URL.revokeObjectURL(url); }
    });
    assert.equal(measurement.first.report.games, 400);
    assert.equal(measurement.first.report.hits.length, 8);
    assert.ok(measurement.first.report.hits.every(hit => hit.ply === 0));
    assert.equal(measurement.first.report.moves[0].draws, 400);
    assert.ok(measurement.first.checks >= 102400);
    console.log(`${browserType.name()}: ${JSON.stringify({ initialDuplicateChecks: measurement.first.checks, repeatedLookupSamples: measurement.samples })}`);
    assert.ok(measurement.samples.every(sample => sample.checks === 0), 'Revisiting a cached position rescanned duplicate games');
    assert.equal(measurement.black.games, 0, 'Side to move must distinguish positions');
    assert.equal(measurement.changed.skipped, 2);
    assert.equal(measurement.changed.report.games, 2);
    assert.deepEqual(measurement.changed.report.moves.map(move => [move.uci, move.blackWins]), [['h2e2', 2]]);
    assert.ok(measurement.changed.report.hits.every(hit => hit.label === 'Updated'));
    assert.deepEqual(measurement.cleared, { games: 0, moves: [], hits: [] });
    console.log(`${browserType.name()}: cached reports preserve counts, first visits, side to move, current request IDs, library updates, invalid suffixes and clearing`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
