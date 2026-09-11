const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5174/web-xiangqi/';
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 900 });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(() => {
          const NativeWorker = Worker;
          window.__indexWorkers = []; window.__indexReplies = []; window.__indexBuilds = [];
          window.Worker = function(url, options) {
            if (!String(url).includes('positionExplorer.worker')) return new NativeWorker(url, options);
            const worker = { onmessage: null, onerror: null, onmessageerror: null, terminated: false,
              terminate() { this.terminated = true; },
              postMessage(data) {
                if (data.type === 'build') { this.games = data.games; window.__indexBuilds.push(data.games); return; }
                const fen = [...data.board].reverse().map(row => {
                  let out = '', empty = 0;
                  for (const piece of row) {
                    if (!piece) empty++; else { if (empty) out += empty; empty = 0; out += piece; }
                  }
                  return out + (empty || '');
                }).join('/') + ' ' + data.side;
                const uci = this.games?.[0]?.moves[data.side === 'b' ? 1 : 0];
                const report = { games: this.games?.length || 0, hits: [], moves: uci
                  ? [{ uci, games: this.games.length, redWins: 0, blackWins: 0, draws: 0, unknown: this.games.length }] : [] };
                window.__indexReplies.push({ deliver: this.onmessage, data: { requestId: data.requestId, key: fen, report, skipped: 0 } });
              }
            };
            window.__indexWorkers.push(worker);
            return worker;
          };
          window.__deliverIndex = (index, id) => {
            const reply = window.__indexReplies[index];
            reply.deliver({ data: { ...reply.data, ...(id === undefined ? {} : { requestId: id }) } });
          };
          window.__failIndex = index => {
            const event = new ErrorEvent('error', { message: 'Controlled index failure', cancelable: true });
            window.__indexWorkers[index].onerror(event);
            return event.defaultPrevented;
          };
        });
        // This test isolates the library worker from the engine worker.
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
        await page.goto(base + '?moves=h2e2');
        if (width < 900) {
          await page.getByTestId('mobile-view-analysis').click();
          await page.getByTestId('mobile-analysis-tab-graph').click();
        }
        assert.equal(await page.evaluate(() => window.__indexWorkers.length), 0, 'Empty startup created an index worker');
        const publish = async (id, move = 'b9c7') => {
          await page.evaluate(({ id, move }) => {
            localStorage.setItem('xiangqi:library:v1', JSON.stringify(id ? [{ id, savedAt: Date.now(), gameMode: 'PvP', moves: ['h2e2', move], moveTree: [{ uci: 'h2e2', comment: 'Retained study note' }] }] : []));
            dispatchEvent(new StorageEvent('storage', { key: 'xiangqi:library:v1', storageArea: localStorage }));
          }, { id, move });
          // Separate user/library updates into distinct renders, while the worker stays busy.
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        };
        await publish('old', 'h9g7');
        await page.waitForFunction(() => window.__indexReplies.length === 1);
        for (let i = 0; i < 20; i++) await publish('latest-' + i);
        assert.deepEqual(await page.evaluate(() => ({ workers: window.__indexWorkers.length, builds: window.__indexBuilds.length, lookups: window.__indexReplies.length })), { workers: 1, builds: 1, lookups: 1 });
        await page.evaluate(() => window.__deliverIndex(0));
        await page.waitForFunction(() => window.__indexReplies.length === 2);
        assert.equal(await page.getByTestId('library-continuation-h9g7').count(), 0, 'An old library result was displayed');
        assert.equal(await page.evaluate(() => window.__indexBuilds[1][0].id), 'latest-19');
        assert.equal(await page.evaluate(() => 'moveTree' in window.__indexBuilds[1][0]), false);
        // Duplicate old replies must not complete the current request.
        await page.evaluate(() => window.__deliverIndex(0));
        assert.equal(await page.getByTestId('library-continuation-h9g7').count(), 0);
        await page.evaluate(() => window.__deliverIndex(1));
        await page.getByTestId('library-continuation-b9c7').waitFor({ state: 'visible' });
        assert.equal(await page.evaluate(() => window.__indexBuilds.length), 2);
        await publish(null);
        await page.waitForFunction(() => window.__indexReplies.length === 3);
        assert.deepEqual(await page.evaluate(() => window.__indexBuilds.at(-1)), []);
        await page.evaluate(() => window.__deliverIndex(2));
        assert.equal(await page.locator('.library-explorer-card').count(), 0, 'Clearing the library left an old report');
        await publish('recovered');
        await page.waitForFunction(() => window.__indexReplies.length === 4);
        await page.evaluate(() => window.__deliverIndex(3));
        assert.equal(await page.evaluate(() => window.__indexWorkers.length), 1, 'Clearing then repopulating restarted the worker');
        assert.equal(await page.evaluate(() => window.__failIndex(0)), true);
        await page.getByTestId('library-explorer-status').filter({ hasText: 'unavailable' }).waitFor({ state: 'visible' });
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1'))[0].id), 'recovered');
        await publish('after-failure');
        await page.waitForFunction(() => window.__indexWorkers.length === 2 && window.__indexReplies.length === 5);
        await page.evaluate(() => { window.__deliverIndex(3); window.__failIndex(0); });
        assert.equal(await page.getByTestId('library-explorer-status').filter({ hasText: 'unavailable' }).count(), 0, 'An abandoned worker overwrote the replacement state');
        await page.evaluate(() => window.__deliverIndex(4));
        await page.getByTestId('library-continuation-b9c7').waitFor({ state: 'visible' });
        await page.getByTestId('library-continuation-b9c7').scrollIntoViewIfNeeded();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.screenshot({ path: `/tmp/xiangqi-library-worker-${browserType.name()}-${width}.png` });
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()}: 21 library versions used 1 worker/2 builds; stale replies, clearing, failure/recovery and layout passed at ${width}px`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
