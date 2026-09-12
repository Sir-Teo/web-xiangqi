const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5200/web-xiangqi/';
const long = word => (word + ' 王 ').repeat(60).slice(0, 230) + ' ' + word + 'Last';
const metadata = { redPlayer: long('Red'), blackPlayer: long('Black'), redRating: '2500', blackRating: '2450',
  event: long('Event'), site: long('Site'), date: '2026.09.12', round: '12', timeControl: '40/7200:3600+30', annotator: long('Coach') };
const games = [
  { id: 'details-a', savedAt: 3, gameMode: 'PvP', label: 'Tournament A', moves: ['h2e2'], metadata },
  { id: 'details-b', savedAt: 2, gameMode: 'PvP', label: 'Tournament B', moves: ['h2e2'], metadata },
  { id: 'plain', savedAt: 1, gameMode: 'PvP', label: 'No metadata', moves: ['h2e2'] },
];
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
(async () => {
  const browser = await browserType.launch();
  try {
    for (const [width, height] of [[1440, 900], [390, 844], [320, 480], [844, 390]]) {
      const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 900, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(games => localStorage.setItem('xiangqi:library:v1', JSON.stringify(games)), games);
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
        await page.goto(base); await page.locator('.xiangqi-board').waitFor();
        await page.getByTestId(width < 900 ? 'mobile-open-library-btn' : 'left-panel-tab-library').click();
        const panel = page.getByTestId('metadata-saved-details-a');
        await panel.waitFor();
        const toggle = panel.getByRole('button', { name: 'Game details for Tournament A', exact: true });
        assert.equal(await toggle.count(), 1, 'Clipped details need a keyboard/touch disclosure');
        assert.equal(await page.getByTestId('metadata-saved-plain').count(), 0);
        const before = await page.evaluate(() => localStorage.getItem('xiangqi:library:v1'));
        for (const size of [16, 32]) {
          await page.evaluate(size => { document.documentElement.style.fontSize = size + 'px'; }, size);
          await settle(page); await toggle.scrollIntoViewIfNeeded();
          assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
          const collapsed = await panel.locator('.lib-detail-line').evaluateAll(nodes => nodes.map(node => ({ visible: node.clientHeight, full: node.scrollHeight })));
          assert.ok(collapsed.every(line => line.full > line.visible + 1), 'Long values must stay compact initially');
          const box = await toggle.boundingBox(); assert.ok(box.height >= 43.99 && box.width >= 44);
          await toggle.focus(); await page.keyboard.press('Enter'); await settle(page);
          assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
          assert.equal(await toggle.evaluate(node => node === document.activeElement), true);
          assert.equal(await toggle.evaluate(node => {
            const r = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
          }), true, 'Expanding must keep the focused control in view');
          await page.screenshot({ path: `/tmp/xiangqi-library-details-${browserType.name()}-${width}-${size}-control.png` });
          const target = await toggle.getAttribute('aria-controls');
          assert.equal(await page.locator(`[id="${target}"]`).count(), 1);
          for (const line of await panel.locator('.lib-detail-line').all()) {
            assert.ok(await line.evaluate(node => node.scrollHeight <= node.clientHeight + 1), 'Expanded values must not be clipped');
            await line.evaluate(node => node.scrollIntoView({ block: 'end' })); await settle(page);
            const end = await line.evaluate(node => {
              const text = node.firstChild; const range = document.createRange();
              range.setStart(text, Math.max(0, text.length - 12)); range.setEnd(text, text.length);
              const rect = [...range.getClientRects()].at(-1);
              const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
              return { reachable: node.contains(hit), rect: rect.toJSON(), hit: hit?.outerHTML.slice(0, 160) };
            });
            if (!end.reachable) await page.screenshot({ path: '/tmp/xiangqi-library-details-failure.png' });
            assert.equal(end.reachable, true, `The end of each full value must be reachable by scrolling: ${JSON.stringify(end)}`);
          }
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
          await page.screenshot({ path: `/tmp/xiangqi-library-details-${browserType.name()}-${width}-${size}.png` });
          await toggle.scrollIntoViewIfNeeded();
          if (width < 900) await toggle.tap(); else { await toggle.focus(); await page.keyboard.press('Space'); }
          await settle(page); assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
        }
        assert.equal(await page.evaluate(() => localStorage.getItem('xiangqi:library:v1')), before, 'Reading details must not change saved studies');
        await page.evaluate(() => { document.documentElement.style.fontSize = '16px'; }); await settle(page);
        await toggle.focus(); await page.keyboard.press('ArrowDown');
        const next = page.getByRole('button', { name: 'Game details for Tournament B', exact: true });
        assert.equal(await next.evaluate(node => node === document.activeElement), true, 'Down must reach the next card’s corresponding action');
        assert.equal(await toggle.getAttribute('tabindex'), '-1');
        assert.equal(await next.getAttribute('tabindex'), '0');
        await page.keyboard.press('Enter'); await settle(page);
        await page.evaluate(() => {
          const games = JSON.parse(localStorage.getItem('xiangqi:library:v1'));
          games[1].metadata.annotator = 'Updated coach';
          localStorage.setItem('xiangqi:library:v1', JSON.stringify(games));
          dispatchEvent(new StorageEvent('storage', { key: 'xiangqi:library:v1', storageArea: localStorage }));
        });
        await page.getByTestId('metadata-saved-details-b').getByText(/Annotated by Updated coach/).waitFor();
        assert.equal(await next.getAttribute('aria-expanded'), 'true');
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}x${height}: compact previews, full values, keyboard/touch toggle, 100/200% text, end-of-text reachability, roving focus and same-ID refresh passed`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
