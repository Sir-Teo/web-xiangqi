const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 900, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      const cycle = ['a0a1', 'a9a8', 'a1a0', 'a8a9'];
      await page.goto(base + '?moves=' + Array.from({ length: 1024 }, (_, i) => cycle[i % 4]).join('+'));
      await page.locator('.xiangqi-board').waitFor();
      await page.keyboard.press('ControlOrMeta+k');
      await page.getByRole('combobox', { name: 'Search commands' }).fill('Move tree');
      await page.keyboard.press('Enter');
      await page.getByTestId('move-tree-active').waitFor();
      for (const size of [16, 32]) {
        await page.evaluate(size => { document.documentElement.style.fontSize = size + 'px'; }, size);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.ok(await page.locator('.mtree-chip').count() < 100, 'Long study rendered all move chips');
        assert.ok(await page.locator('.tree-breadcrumb-chip').count() <= 50, 'Long breadcrumb rendered all moves');
        await page.locator('.mtree-chip[tabindex="0"]').focus();
        await page.keyboard.press('Home');
        assert.equal(await page.evaluate(() => document.activeElement?.dataset.nodeId), 'n1');
        assert.equal(await page.getByTestId('move-tree-active').getAttribute('data-node-id'), 'n1024', 'Keyboard focus changed the game before activation');
        await page.keyboard.press('End');
        assert.equal(await page.evaluate(() => document.activeElement?.dataset.nodeId), 'n1024');
        assert.equal(await page.locator('.mtree-chip[tabindex="0"]').count(), 1);
        await page.locator('.mtree-scroll').dispatchEvent('wheel', { deltaY: -1000 });
        await page.locator('.mtree-scroll').evaluate(node => { node.scrollTop = node.scrollHeight / 2; node.dispatchEvent(new Event('scroll')); });
        await page.waitForFunction(() => [...document.querySelectorAll('.mtree-chip')].some(node => {
          const id = Number(node.dataset.nodeId?.slice(1)); return id > 250 && id < 800;
        }));
        assert.ok(await page.locator('.mtree-chip').count() < 100);
        assert.equal(await page.getByTestId('move-tree-active').count(), 1, 'Scrolling unmounted the active position');
        assert.equal(await page.evaluate(() => document.activeElement?.dataset.nodeId), 'n1024', 'Scrolling lost keyboard focus');
        await page.locator('.tree-breadcrumb-chip').last().focus();
        await page.keyboard.press('Home');
        assert.equal(await page.evaluate(() => document.activeElement?.dataset.breadcrumbIndex), '0');
        for (let index = 0; index < 55; index++) await page.keyboard.press('ArrowRight');
        assert.equal(await page.evaluate(() => document.activeElement?.dataset.breadcrumbIndex), '55', 'Breadcrumb arrows stopped at a window boundary');
        await page.keyboard.press('End');
        assert.equal(await page.evaluate(() => document.activeElement?.dataset.breadcrumbIndex), '1024');
        assert.equal(await page.locator('.tree-breadcrumb-chip[tabindex="0"]').count(), 1);
        await page.keyboard.press('Home'); await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.querySelector('[data-testid="move-comment-input"]')?.getAttribute('aria-label') === 'Note on starting position'
          && document.querySelector('.mtree-scroll')?.scrollTop < 2);
        const firstRowVisible = await page.locator('.mtree-chip[data-node-id="n1"]').evaluate(node => {
          const box = node.getBoundingClientRect(), viewport = node.closest('.mtree-scroll').getBoundingClientRect();
          return box.top >= viewport.top - 1 && box.bottom <= viewport.bottom + 1;
        });
        assert.equal(firstRowVisible, true, 'Returning to root did not reveal the first row');
        await page.keyboard.press('ControlOrMeta+k');
        await page.getByRole('combobox', { name: 'Search commands' }).fill('Go to latest move');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.querySelector('[data-testid="move-tree-active"]')?.dataset.nodeId === 'n1024');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      }
      assert.deepEqual(errors, []); await page.close();
      console.log(`${browserType.name()} ${width}px: bounded 1024-ply DOM, distant scrolling, focus retention, Home/End, breadcrumb boundaries and 200% text passed`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
