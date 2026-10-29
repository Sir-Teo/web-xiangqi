const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5200/web-xiangqi/';
const roots = ['h2c2','h2d2','h2e2','h2f2','h2g2','h2i2','b2a2','b2c2','b2d2','b2e2','b2f2','b2g2','h2h3','h2h4','h2h5','h2h6'];
const tail = Array.from({ length: 511 }, (_, i) => ['a9a8','a0a1','a8a9','a1a0'][i % 4]).join(' ');
const pgn = roots[0] + ' ' + roots.slice(1).map((move,i) => `(${move} ${tail} {Line ${i + 2} end})`).join(' ') + ` ${tail} {Line 1 end} *`;
const command = async (page, label) => {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  await page.keyboard.press('Enter');
};
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440,390,320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 900, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      try {
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
        await command(page, 'Library');
        const importer = page.getByTestId('pgn-collection-import'); await importer.locator('summary').click();
        await importer.getByLabel('Choose PGN collection').setInputFiles({ name: 'Broad repertoire.pgn', mimeType: 'application/x-chess-pgn', buffer: Buffer.from(pgn) });
        await importer.getByRole('button', { name: 'Open game 1 on board', exact: true }).waitFor({ timeout: 5000 }).catch(async error => {
          console.error(await importer.getByRole('alert').allTextContents()); throw error;
        });
        await importer.getByRole('button', { name: 'Import 1 game', exact: true }).click();
        await importer.getByRole('status').filter({ hasText: 'Imported 1 game.' }).waitFor();
        const stored = JSON.parse(await page.evaluate(() => localStorage.getItem('xiangqi:library:v1')))[0];
        const count = tree => { let total = 0, pending = [...tree]; while (pending.length) { const node = pending.pop(); total++; pending.push(...node.children || []); } return total; };
        assert.equal(count(stored.moveTree), 8192);
        assert.equal(stored.moveTree.length, 16);
        assert.equal(stored.moves.length, 512);
        await page.getByTestId('load-saved-' + stored.id).click();
        assert.equal(await page.getByTestId('move-comment-input').inputValue(), 'Line 1 end');
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('xiangqi:auto-saved-game:v1') || 'null')?.game.moveTree?.length === 16);
        assert.equal(await page.getByTestId('auto-save-error').count(), 0);
        await command(page, 'Go to start');
        await page.waitForFunction(() => document.querySelector('.mtree-scroll')?.scrollTop < 2);
        // A distant branch is deliberately absent from the virtual DOM. Walk
        // the scroll window as a reader does, including variable-height rows.
        const branch = page.locator('.mtree-chip').filter({ hasText: roots[15] });
        const scroll = page.locator('.mtree-scroll');
        await scroll.dispatchEvent('wheel', { deltaY: 1 });
        for (let step = 0; step < 400 && !(await branch.count()); step++) {
          await scroll.evaluate(node => { node.scrollTop += Math.max(100, node.clientHeight * .8); });
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        }
        assert.equal(await branch.count(), 1, 'Scrolling never mounted the last root variation');
        await branch.click();
        if (width < 900) await page.getByTestId('mobile-view-board').click();
        await page.getByRole('button', { name: 'Go to latest move', exact: true }).filter({ visible: true }).first().click();
        await page.keyboard.press('t');
        assert.equal(await page.getByTestId('move-comment-input').inputValue(), 'Line 16 end');
        await page.waitForFunction(move => JSON.parse(localStorage.getItem('xiangqi:auto-saved-game:v1') || 'null')?.game.moves[0] === move, roots[15]);
        await page.reload(); await page.getByRole('button', { name: 'Restore', exact: true }).click();
        await page.keyboard.press('t');
        assert.equal(await page.getByTestId('move-comment-input').inputValue(), 'Line 16 end');
        const recovered = JSON.parse(await page.evaluate(() => localStorage.getItem('xiangqi:auto-saved-game:v1'))).game;
        assert.equal(count(recovered.moveTree), 8192);
        const download = page.waitForEvent('download');
        await command(page, 'Export PGN');
        const chunks = []; for await (const chunk of await (await download).createReadStream()) chunks.push(chunk);
        const exported = Buffer.concat(chunks).toString();
        assert.equal((exported.match(/\b[a-i][0-9][a-i][0-9]\b/g) || []).length, 8192);
        for (let i = 1; i <= 16; i++) assert.ok(exported.includes(`Line ${i} end`));
        await command(page, 'Library'); await importer.locator('summary').click();
        await importer.getByLabel('Choose PGN collection').setInputFiles({ name: 'Recovered repertoire.pgn', mimeType: 'application/x-chess-pgn', buffer: Buffer.from(exported) });
        const open = importer.getByRole('button', { name: 'Open game 1 on board', exact: true });
        await open.waitFor();
        const font = await open.evaluate(el => parseFloat(getComputedStyle(el).fontSize));
        const labelFont = await importer.locator('.lib-pgn-game strong').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
        for (const size of [16,32]) {
          await page.evaluate(size => { document.documentElement.style.fontSize = size + 'px'; }, size);
          await page.waitForFunction(expected => Math.abs(parseFloat(getComputedStyle(document.querySelector('[aria-label="Open game 1 on board"]')).fontSize) - expected) < 0.01, font * size / 16);
          await page.waitForFunction(expected => Math.abs(parseFloat(getComputedStyle(document.querySelector('.lib-pgn-game strong')).fontSize) - expected) < 0.01, labelFont * size / 16);
          await open.evaluate(el => el.scrollIntoView({ block: 'center' }));
          assert.equal(await open.evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), true);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
          await page.screenshot({ path: `/tmp/xiangqi-study-breadth-${browserType.name()}-${width}-${size}.png` });
        }
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}px: 8,192-node / 16-line study imported, saved, navigated, recovered and re-exported intact`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
