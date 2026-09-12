const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5200/web-xiangqi/';
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
(async () => {
  const browser = await browserType.launch();
  try {
    for (const [width, height] of [[320, 480], [390, 844], [844, 390], [1440, 900]]) {
      const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 900, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(() => localStorage.setItem('xiangqi:beginner-guide-dismissed:v1', 'true'));
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
        for (const mode of ['Coach', 'Pro']) {
          await page.keyboard.press('ControlOrMeta+k');
          await page.getByRole('combobox', { name: 'Search commands' }).fill('Settings');
          await page.keyboard.press('Enter');
          await page.getByRole('button', { name: new RegExp(`^${mode} interface,`) }).click();
          await page.getByRole('button', { name: 'Close settings', exact: true }).click();
          for (const size of [16, 32]) {
            await page.evaluate(size => { document.documentElement.style.fontSize = size + 'px'; }, size); await settle(page);
            for (const selected of [false, true]) {
              if (selected) await page.locator('.hitbox[data-file="0"][data-rank="0"]').click();
              for (const field of await page.locator('.position-stat-turn > span, .position-stat-turn > strong, .position-stat-selection > span, .position-stat-selection > strong, .position-stat-material > span, .position-stat-material > strong').all()) {
                await field.scrollIntoViewIfNeeded();
                const info = await field.evaluate(node => {
                  const range = document.createRange(); range.selectNodeContents(node);
                  const card = node.closest('.position-stat').getBoundingClientRect();
                  const style = getComputedStyle(node);
                  return { text: node.textContent, card: card.toJSON(), rects: [...range.getClientRects()].map(r => r.toJSON()),
                    clipped: (['hidden', 'clip'].includes(style.overflowX) && node.scrollWidth > node.clientWidth + 1)
                      || (['hidden', 'clip'].includes(style.overflowY) && node.scrollHeight > node.clientHeight + 1) };
                });
                assert.equal(info.clipped, false, `${width}/${mode}/${size}: text must not clip: ${JSON.stringify(info)}`);
                assert.ok(info.rects.every(r => r.left >= info.card.left && r.right <= info.card.right && r.top >= info.card.top && r.bottom <= info.card.bottom), `${width}/${mode}/${size}: text must stay in its card: ${JSON.stringify(info)}`);
                if (['Turn', 'Selection', 'Material'].includes(info.text)) assert.equal(info.rects.length, 1, 'Give short headings enough width to stay intact');
              }
              if (selected) await page.locator('.hitbox[data-file="0"][data-rank="0"]').click();
            }
            for (const square of await page.locator('.hitbox').all()) {
              await square.scrollIntoViewIfNeeded();
              assert.equal(await square.evaluate(node => { const r = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), true, `${width}/${mode}/${size}: every board intersection must remain reachable`);
            }
            const board = await page.locator('.xiangqi-board-container').boundingBox();
            assert.ok(Math.abs(board.width / board.height - .9) < .02);
            if (size === 32) assert.ok(board.width >= (width === 844 ? 140 : 250), 'Keep a usable board with enlarged text');
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
            await page.locator('.position-stat-selection').scrollIntoViewIfNeeded();
            await page.screenshot({ path: `/tmp/xiangqi-position-cards-${browserType.name()}-${width}-${mode}-${size}.png` });
          }
        }
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}x${height}: Coach/Pro position headings and values fit at 100/200% text; board remains reachable`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
