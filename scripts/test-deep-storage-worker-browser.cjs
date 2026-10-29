const assert = require('node:assert/strict');
const { readdirSync } = require('node:fs');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';

(async () => {
  const browser = await browserType.launch();
  try {
    const page = await browser.newPage();
    await page.goto(base);
    const assets = readdirSync('dist/assets');
    const urls = Object.fromEntries(['autoSave', 'libraryRead'].map(name => {
      const asset = assets.find(file => file.startsWith(name + '.worker-') && file.endsWith('.js'));
      assert.ok(asset, `${name} production worker is missing`);
      return [name, new URL('assets/' + asset, base).href];
    }));
    const result = await page.evaluate(async urls => {
      const run = (url, data) => new Promise((resolve, reject) => {
        const worker = new Worker(url, { type: 'module' });
        const timer = setTimeout(() => { worker.terminate(); reject(new Error('Storage worker timed out')); }, 10_000);
        worker.onmessage = event => { clearTimeout(timer); worker.terminate(); resolve(event.data); };
        worker.onerror = event => { clearTimeout(timer); worker.terminate(); reject(new Error(event.message)); };
        worker.postMessage(data);
      });
      const moves = Array.from({ length: 1024 }, (_, index) => ['a0a1', 'a9a8', 'a1a0', 'a8a9'][index % 4]);
      const flatMoveTree = moves.map((uci, index) => ({
        uci, parent: index - 1, comment: `Note ${index}: ` + '中炮'.repeat(40),
        evalScore: 20000 + index, evalScoreKind: 'cp', evalDepth: 20, nags: [1],
      }));
      const game = { gameMode: 'PvP', result: 'ongoing', moves: moves.slice(0, 1014), cursorPly: 1014, flatMoveTree };
      const prepared = await run(urls.autoSave, { game, savedAt: 123 });
      if (prepared.result !== 'ready') return { prepared: prepared.result };
      const snapshot = JSON.parse(prepared.serialized);
      let nodes = snapshot.game.moveTree;
      let count = 0;
      while (nodes?.length) {
        const node = nodes[0];
        const expected = flatMoveTree[count];
        if (nodes.length !== 1 || node.uci !== expected.uci || node.comment !== expected.comment
          || node.evalScore !== expected.evalScore || node.evalScoreKind !== 'cp' || node.evalDepth !== 20 || node.nags?.[0] !== 1) {
          throw new Error(`Autosave changed node ${count}`);
        }
        count++; nodes = node.children;
      }
      const raw = JSON.stringify([snapshot.game]);
      const loaded = await run(urls.libraryRead, raw);
      const saved = loaded.games[0];
      const tooDeep = await run(urls.autoSave, { game: {
        ...game, flatMoveTree: [...flatMoveTree, { uci: 'a0a1', parent: 1023 }],
      }, savedAt: 124 });
      return {
        prepared: prepared.result, count, savedAt: snapshot.savedAt, cursor: snapshot.game.cursorPly,
        rawLength: raw.length, blocked: loaded.mutationBlocked, games: loaded.games.length,
        flat: saved?.flatMoveTree, tooDeep: tooDeep.result, expected: flatMoveTree,
      };
    }, urls);
    assert.equal(result.prepared, 'ready', 'A full-depth study must remain recoverable in the worker');
    assert.equal(result.count, 1024);
    assert.equal(result.savedAt, 123);
    assert.equal(result.cursor, 1014);
    assert.ok(result.rawLength > 64 * 1024, 'Exercise the background library read size threshold');
    assert.equal(result.blocked, false);
    assert.equal(result.games, 1);
    assert.deepEqual(result.flat, result.expected, 'Background library reading changed the full-depth study');
    assert.equal(result.tooDeep, 'too-large');
    console.log(`${browserType.name()}: real production workers round-trip 1,024 annotated moves, scores and cursor; excessive depth rejected`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
