const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5199/web-xiangqi/';
async function command(page, label) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  const current = await page.getByRole('option').first().getAttribute('aria-disabled') === 'true';
  await page.keyboard.press(current ? 'Escape' : 'Enter');
  await page.getByRole('combobox', { name: 'Search commands' }).waitFor({ state: 'hidden' });
}
async function assertFits(page, label) {
  const bounds = await page.locator('.mtree-scroll').evaluate(container => {
    const box = container.getBoundingClientRect();
    return { width: container.clientWidth, scrollWidth: container.scrollWidth,
      columns: getComputedStyle(container.querySelector('.mtree-row')).gridTemplateColumns,
      clipped: [...container.querySelectorAll('.mtree-chip, .mtree-comment, .mtree-num')].filter(element => {
        const rect = element.getBoundingClientRect();
        return rect.left < box.left - 1 || rect.right > box.right + 1 || element.scrollWidth > element.clientWidth + 1;
      }).map(element => ({ text: element.textContent, width: element.clientWidth, scrollWidth: element.scrollWidth,
        left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right, containerLeft: box.left, containerRight: box.right })),
    };
  });
  assert.ok(bounds.scrollWidth <= bounds.width + 1 && !bounds.clipped.length, `${label}: ${JSON.stringify(bounds)}`);
}
(async () => {
  const browser = await browserType.launch();
  try {
    for (const [width, height] of [[1440, 900], [390, 844], [320, 480], [844, 390]]) {
      const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 900, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
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
        await page.goto(base + '?moves=h2e2+h9g7+h0g2+b9c7');
        await page.getByTestId('move-tree-active').waitFor({ state: 'attached' });
        await page.keyboard.press('t');
        await page.getByTestId('move-comment-input').fill('Q'.repeat(500));
        await page.getByTestId('move-comment-input').blur();
        await page.locator('.mtree-comment').waitFor();
        for (const fontSize of [16, 32, 16, 32]) {
          await page.evaluate(size => { document.documentElement.style.fontSize = size + 'px'; }, fontSize);
          for (const notation of ['WXF', 'Chinese', 'coordinates']) {
            await command(page, `Write moves in ${notation}`);
            assert.ok((await page.locator('.mtree-row .mtree-chip').first().innerText()).includes(
              notation === 'WXF' ? 'C2=5' : notation === 'Chinese' ? '炮二平五' : 'H2→E2'));
            await assertFits(page, `${browserType.name()} ${width}px/${fontSize}px ${notation}`);
          }
          await command(page, 'Write moves in WXF');
          const chips = page.locator('.mtree-row .mtree-chip');
          await chips.first().focus();
          const stacked = await chips.evaluateAll(elements => elements[1].getBoundingClientRect().top >= elements[0].getBoundingClientRect().bottom);
          await page.keyboard.press('ArrowDown');
          assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-node-id')), stacked ? 'n2' : 'n3');
          await page.keyboard.press('ArrowUp');
          assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-node-id')), 'n1');
          if (width === 320) await page.screenshot({ path: `/tmp/xiangqi-move-reflow-${browserType.name()}-${fontSize}.png` });
        }
        if (width < 900) await page.getByTestId('mobile-view-board').click();
        await page.getByRole('button', { name: width < 900 ? 'Open new game menu' : 'Start new game', exact: true }).click();
        await page.getByTestId('uci-line-input').fill('[FEN "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR b - - 0 42"]\n'
          + `42... h9g7 (b9c7 {${'Z'.repeat(500)}}) h2e2 b9c7 *`);
        await page.getByTestId('import-uci-line-btn').click();
        await page.getByTestId('uci-line-input').waitFor({ state: 'hidden' });
        await page.keyboard.press('t');
        assert.equal(await page.locator('.mtree-num').first().innerText(), '42...');
        assert.equal(await page.locator('.mtree-row .mtree-side').first().textContent(), 'Black');
        assert.equal(await page.locator('.mtree-row .mtree-side').nth(1).textContent(), 'Red');
        for (const notation of ['WXF', 'Chinese', 'coordinates']) {
          await command(page, `Write moves in ${notation}`);
          await assertFits(page, `${browserType.name()} ${width}px black-start annotated variation ${notation}`);
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}x${height}: all notations and long notes fit at 100/200% text; vertical keyboard navigation follows layout`);
      } catch (error) {
        await page.screenshot({ path: `/tmp/xiangqi-move-reflow-failure-${browserType.name()}-${width}.png` });
        throw error;
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
