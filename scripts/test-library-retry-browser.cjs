const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5200/web-xiangqi/';
(async () => {
  const browser = await browserType.launch();
  try {
    for (const [width, height] of [[1440, 900], [390, 900], [320, 900], [844, 390]]) {
      const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 900, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(() => {
          localStorage.setItem('xiangqi:library:v1', JSON.stringify([{ id: 'retry-study', savedAt: 1, gameMode: 'PvP', moves: ['h2e2', 'h9g7'], moveTree: [{ uci: 'h2e2', comment: 'Keep this study note', children: [{ uci: 'h9g7' }] }] }]));
          window.__constructorThrows = true; window.__postThrows = false;
          window.__indexWorkers = []; window.__replies = [];
          window.__engineCreates = 0; window.__engineTerminates = 0;
          const NativeWorker = Worker;
          window.Worker = function(url, options) {
            if (!String(url).includes('positionExplorer.worker')) return new NativeWorker(url, options);
            if (window.__constructorThrows) throw new Error('Controlled worker creation failure');
            const worker = { onmessage: null, onerror: null, onmessageerror: null, terminated: false,
              terminate() { this.terminated = true; },
              postMessage(data) {
                if (window.__postThrows) throw new Error('Controlled transfer failure');
                if (data.type === 'build') return;
                const placement = [...data.board].reverse().map(row => {
                  let out = '', empty = 0;
                  for (const piece of row) {
                    if (!piece) empty++; else { if (empty) out += empty; empty = 0; out += piece; }
                  }
                  return out + (empty || '');
                }).join('/');
                window.__replies.push({ deliver: this.onmessage, data: { requestId: data.requestId, key: placement + ' ' + data.side,
                  skipped: 0, report: { games: 1, hits: [], moves: [{ uci: 'h9g7', games: 1, redWins: 0, blackWins: 0, draws: 0, unknown: 1 }] } } });
              }
            };
            window.__indexWorkers.push(worker);
            return worker;
          };
        });
        await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: `
          window.Pikafish = function() {};
          window.Pikafish.createWorkerEngine = async () => {
            window.__engineCreates++;
            const listeners = []; const emit = line => listeners.forEach(listener => listener(line));
            return { variant: 'single-simd', addMessageListener: listener => listeners.push(listener), terminate() { window.__engineTerminates++; }, postMessage(command) {
              if (command === 'uci') queueMicrotask(() => emit('uciok'));
              if (command === 'isready') queueMicrotask(() => { emit('readyok'); window.__engineReady = true; });
              if (command.startsWith('go ') || command === 'stop') queueMicrotask(() => emit('bestmove (none)'));
            } };
          };` }));
        await page.goto(base + '?moves=h2e2');
        await page.locator('.xiangqi-board').waitFor();
        if (await page.getByTestId('start-engine-analysis').isVisible()) await page.getByTestId('start-engine-analysis').click();
        await page.waitForFunction(() => window.__engineReady);
        if (width < 900) {
          await page.getByTestId('mobile-view-analysis').click();
          await page.getByTestId('mobile-analysis-tab-moves').click();
        }
        const currentNote = 'Keep my current analysis note through recovery';
        await page.getByTestId('move-comment-input').fill(currentNote);
        await page.getByTestId('move-comment-input').blur();
        if (width < 900) await page.getByTestId('mobile-analysis-tab-graph').click();
        const retry = page.getByRole('button', { name: 'Retry library explorer', exact: true });
        const status = page.getByTestId('library-explorer-status');
        await status.filter({ hasText: 'unavailable' }).waitFor({ state: 'visible' });
        const before = await page.evaluate(() => ({ fen: document.querySelector('.bottombar-fen')?.getAttribute('title'), library: localStorage.getItem('xiangqi:library:v1'), creates: window.__engineCreates, terminates: window.__engineTerminates }));
        await retry.waitFor({ state: 'visible' });
        for (const size of [32, 16]) {
          await page.evaluate(size => { document.documentElement.style.fontSize = size + 'px'; }, size);
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          await retry.scrollIntoViewIfNeeded();
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
          const reach = await retry.evaluate(button => {
            const rect = button.getBoundingClientRect();
            const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
            return { reachable: button.scrollWidth <= button.clientWidth + 1 && button.scrollHeight <= button.clientHeight + 1 && button.contains(hit), rect: rect.toJSON(), hit: hit?.outerHTML.slice(0, 500), scrollWidth: button.scrollWidth, clientWidth: button.clientWidth, scrollHeight: button.scrollHeight, clientHeight: button.clientHeight };
          });
          if (!reach.reachable) await page.screenshot({ path: `/tmp/xiangqi-library-retry-failure-${width}-${size}.png` });
          assert.equal(reach.reachable, true, 'Retry is clipped or covered: ' + JSON.stringify(reach));
          if (size === 32) await page.screenshot({ path: `/tmp/xiangqi-library-retry-${browserType.name()}-${width}x${height}.png` });
        }
        await page.evaluate(() => { window.__constructorThrows = false; });
        await retry.focus(); await page.keyboard.press('Enter');
        await status.filter({ hasText: 'Checking' }).waitFor({ state: 'visible' });
        assert.equal(await page.evaluate(() => window.__indexWorkers.length), 1);
        // A decoding error must expose the same recovery action.
        await page.evaluate(() => window.__indexWorkers[0].onmessageerror({}));
        await retry.waitFor({ state: 'visible' });
        assert.equal(await page.evaluate(() => window.__indexWorkers[0].terminated), true);
        await page.evaluate(() => { window.__postThrows = true; });
        await retry.click();
        await page.waitForFunction(() => window.__indexWorkers.length === 2 && window.__indexWorkers[1].terminated);
        await retry.waitFor({ state: 'visible' });
        await page.evaluate(() => { window.__postThrows = false; });
        // Two activations before React commits still create one replacement.
        await retry.evaluate(button => { button.click(); button.click(); });
        await page.waitForFunction(() => window.__indexWorkers.length === 3 && window.__replies.length === 2);
        await status.filter({ hasText: 'Checking' }).waitFor({ state: 'visible' });
        await page.evaluate(() => window.__replies[0].deliver({ data: window.__replies[0].data }));
        assert.equal(await page.getByTestId('library-continuation-h9g7').count(), 0, 'An abandoned worker published a result');
        await page.evaluate(() => window.__replies[1].deliver({ data: window.__replies[1].data }));
        await page.getByTestId('library-continuation-h9g7').waitFor({ state: 'visible' });
        assert.equal(await retry.count(), 0);
        const after = await page.evaluate(() => ({ fen: document.querySelector('.bottombar-fen')?.getAttribute('title'), library: localStorage.getItem('xiangqi:library:v1'), creates: window.__engineCreates, terminates: window.__engineTerminates }));
        assert.deepEqual(after, before, 'Retry changed the board/library or restarted the engine');
        if (width < 900) await page.getByTestId('mobile-analysis-tab-moves').click();
        assert.equal(await page.getByTestId('move-comment-input').inputValue(), currentNote);
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}x${height}: construction/decoding/transfer failures, keyboard retry, duplicate activation, stale replies, recovery and 200% text passed`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
