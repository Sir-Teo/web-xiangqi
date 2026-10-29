const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5200/web-xiangqi/';
const roots = ['h2c2','h2d2','h2e2','h2f2','h2g2','h2i2','b2a2','b2c2','b2d2','b2e2','b2f2','b2g2','h2h3','h2h4','h2h5','h2h6'];
const tails = Array.from({ length: 511 }, (_, i) => ['a9a8','a0a1','a8a9','a1a0'][i % 4]);
const tree = roots.map((uci, index) => {
  const root = { uci }; let cursor = root;
  for (const move of tails) { const next = { uci: move }; cursor.children = [next]; cursor = next; }
  cursor.comment = `Line ${index + 1} end`;
  return root;
});
const saved = { id: 'large-tree', savedAt: 1, label: 'Large repertoire', gameMode: 'PvP', moves: [roots[0], ...tails], moveTree: tree };
const command = async (page, label) => {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  await page.keyboard.press('Enter');
  await page.getByRole('combobox', { name: 'Search commands' }).waitFor({ state: 'hidden' });
};
(async () => {
  const browser = await browserType.launch();
  try {
    for (const [width, height] of [[1440, 900], [390, 844], [320, 480], [844, 390]]) {
      const mobile = width < 900;
      const page = await browser.newPage({ viewport: { width, height }, hasTouch: mobile, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(raw => {
          localStorage.setItem('xiangqi:library:v1', raw);
          const unshift = Array.prototype.unshift;
          window.__breadcrumbShiftedEntries = 0;
          Array.prototype.unshift = function(...items) {
            if (typeof items[0] === 'string' && /^n\d+$/.test(items[0])) window.__breadcrumbShiftedEntries += this.length;
            return Reflect.apply(unshift, this, items);
          };
        }, JSON.stringify([saved]));
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
        await page.getByTestId('load-saved-large-tree').click();
        const hideTree = async () => {
          if (mobile) await page.getByTestId('mobile-view-board').click();
          else { await page.getByTestId('right-panel-resize-handle').focus(); await page.keyboard.press('Home'); }
          await page.evaluate(() => document.activeElement?.blur());
        };
        await hideTree();
        const hiddenChips = await page.locator('.mtree-chip').count();
        const hiddenBreadcrumbs = await page.locator('.tree-breadcrumb-chip').count();
        await page.evaluate(() => {
          window.__treeChanges = 0; window.__breadcrumbChanges = 0; window.__breadcrumbShiftedEntries = 0;
          new MutationObserver(changes => {
            window.__treeChanges += changes.filter(change => change.target instanceof Element && change.target.matches('.mtree-chip')).length;
            window.__breadcrumbChanges += changes.filter(change => change.target instanceof Element && change.target.matches('.tree-breadcrumb-chip')).length;
          })
            .observe(document.body, { subtree: true, attributes: true });
        });
        for (let step = 0; step < 10; step++) {
          const fen = await page.locator('.bottombar-fen').getAttribute('title');
          await page.keyboard.press('ArrowLeft');
          await page.waitForFunction(fen => document.querySelector('.bottombar-fen')?.getAttribute('title') !== fen, fen);
        }
        const mutations = await page.evaluate(() => window.__treeChanges);
        console.log(`${browserType.name()} ${width}px: hidden tree retained ${hiddenChips} move buttons and changed ${mutations} attributes across ten board steps`);
        const breadcrumbWork = await page.evaluate(() => ({ changes: window.__breadcrumbChanges, shifted: window.__breadcrumbShiftedEntries }));
        console.log(`${browserType.name()} ${width}px: hidden breadcrumbs retained ${hiddenBreadcrumbs} buttons, changed ${breadcrumbWork.changes} attributes and prepended across ${breadcrumbWork.shifted} existing entries`);
        if (process.env.XIANGQI_QA_MEASURE_ONLY) continue;
        assert.equal(hiddenBreadcrumbs, 0, 'Hidden breadcrumbs must release their controls');
        assert.deepEqual(breadcrumbWork, { changes: 0, shifted: 0 }, 'Hidden navigation must not update breadcrumb controls or prepend ancestry');
        assert.equal(hiddenChips, 0, 'A hidden move list must release its controls');
        assert.equal(mutations, 0, 'Board navigation must not update a hidden move list');
        const checkBreadcrumbs = async (length, firstNode) => {
          const strip = page.locator('.tree-breadcrumb');
          const chips = strip.locator('.tree-breadcrumb-chip');
          const entries = await chips.evaluateAll(nodes => nodes.map(node => ({ index: Number(node.dataset.breadcrumbIndex), id: node.dataset.breadcrumbNodeId })));
          assert.ok(entries.length >= 2 && entries.length <= 50, 'Reopened breadcrumbs must keep a bounded window');
          assert.deepEqual(entries[0], { index: 0, id: 'root' });
          assert.equal(entries.at(-1).index, length - 1);
          const start = Number(firstNode.slice(1));
          entries.slice(1).forEach((entry, index) => {
            assert.ok(entry.index > entries[index].index && entry.index < length);
            assert.equal(entry.id, 'n' + (start + entry.index - 1), 'The window belongs to another branch');
          });
          const omitted = await strip.locator('.tree-breadcrumb-gap').evaluateAll(nodes => nodes.reduce((total, node) => total + Number(node.getAttribute('aria-label').match(/Show (\d+)/)[1]), 0));
          assert.equal(entries.length + omitted, length, 'Breadcrumb gaps lost part of the selected history');
          assert.equal(await chips.last().getAttribute('aria-current'), 'true');
          assert.equal(await strip.locator('[tabindex="0"]').count(), 1);
          await page.waitForFunction(() => {
            const chip = document.querySelector('.tree-breadcrumb-chip-active');
            const r = chip?.getBoundingClientRect(); const strip = chip?.parentElement?.getBoundingClientRect();
            return r && strip && strip.width > 0 && r.left >= strip.left - 1 && r.right <= strip.right + 1;
          });
        };
        await command(page, 'Move tree');
        await checkBreadcrumbs(503, 'n1');
        await page.locator('.mtree-chip').first().waitFor();
        assert.ok(await page.locator('[data-virtual-key]').count() < 64, 'Reopening mounted the entire row model');
        assert.ok(await page.locator('.mtree-chip').count() < 1712, 'Reopening rendered every branch preview');
        const active = page.locator('.mtree-chip[aria-current="step"]');
        await active.waitFor();
        assert.match(await active.getAttribute('aria-label'), /Current move/);
        await page.waitForFunction(() => {
          const chip = document.querySelector('.mtree-chip[aria-current="step"]');
          const r = chip?.getBoundingClientRect(); const parent = chip?.closest('.mtree-scroll')?.getBoundingClientRect();
          return r && parent && r.top >= parent.top - 1 && r.bottom <= parent.bottom + 1;
        }, null, { timeout: 3000 }).catch(async error => {
          console.error(await active.evaluate(node => ({ chip: node.getBoundingClientRect().toJSON(), scroll: node.closest('.mtree-scroll').getBoundingClientRect().toJSON(), scrollTop: node.closest('.mtree-scroll').scrollTop, scrollHeight: node.closest('.mtree-scroll').scrollHeight, outer: node.closest('.panel-content').getBoundingClientRect().toJSON() })));
          await page.screenshot({ path: '/tmp/xiangqi-tree-centering-failure.png' }); throw error;
        });
        await command(page, 'Go to start');
        await page.waitForFunction(() => document.querySelector('.mtree-scroll')?.scrollTop < 2);
        const branch = page.locator('.mtree-chip').filter({ has: page.locator('.move-uci', { hasText: 'h2h6' }) });
        const scroll = page.locator('.mtree-scroll');
        await scroll.dispatchEvent('wheel', { deltaY: 1 });
        for (let step = 0; step < 400 && !(await branch.count()); step++) {
          await scroll.evaluate(node => { node.scrollTop += Math.max(100, node.clientHeight * .8); });
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        }
        assert.equal(await branch.count(), 1, 'The last root variation never became reachable');
        await branch.click();
        await command(page, 'Go to latest move');
        await page.waitForFunction(() => document.querySelector('[data-testid="move-comment-input"]')?.value === 'Line 16 end');
        await hideTree(); await command(page, 'Move tree');
        await page.waitForFunction(() => document.querySelector('[data-testid="move-comment-input"]')?.value === 'Line 16 end');
        await checkBreadcrumbs(513, 'n7681');
        // Navigate through the reopened strip, then back to the saved endpoint.
        await page.locator('.tree-breadcrumb-chip-active').focus();
        await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Enter');
        await checkBreadcrumbs(512, 'n7681');
        assert.equal(await page.locator('.tree-breadcrumb-chip-active').evaluate(n => n === document.activeElement), true);
        await page.keyboard.press('Home'); await page.keyboard.press('Enter');
        assert.equal(await page.locator('.tree-breadcrumb-chip').count(), 1);
        await command(page, 'Go to latest move');
        await checkBreadcrumbs(513, 'n7681');
        // The newly mounted list must have a usable keyboard entry point.
        const tabStop = page.locator('.mtree-chip[tabindex="0"]');
        assert.equal(await tabStop.count(), 1);
        await tabStop.focus(); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Enter');
        assert.equal(await page.locator('.mtree-chip[aria-current="step"]').evaluate(node => node === document.activeElement), true);
        for (const size of [16, 32]) {
          await page.evaluate(size => { document.documentElement.style.fontSize = size + 'px'; }, size);
          await hideTree(); await command(page, 'Move tree');
          await checkBreadcrumbs(512, 'n7681');
          await page.locator('.tree-breadcrumb-chip-active').scrollIntoViewIfNeeded();
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          await checkBreadcrumbs(512, 'n7681');
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
          await page.screenshot({ path: `/tmp/xiangqi-move-tree-visibility-${browserType.name()}-${width}-${size}.png` });
        }
        if (!mobile) {
          for (const [key, tab] of [['r', 'review'], ['e', 'engine'], ['t', 'tree']]) {
            await hideTree(); await page.keyboard.press(key);
            await page.waitForFunction(tab => document.querySelector(`[data-testid="analysis-tab-${tab}"]`)?.getAttribute('aria-selected') === 'true'
              && document.querySelector('.panel.right')?.getBoundingClientRect().width > 0, tab);
          }
          for (const label of ['Review panel', 'Engine panel', 'Write a note on this move', 'Find study notes']) {
            await hideTree(); await command(page, label);
            await page.waitForFunction(() => document.querySelector('.panel.right')?.getBoundingClientRect().width > 0);
          }
        }
        assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('xiangqi:library:v1'))), [saved], 'Navigation must not modify the saved repertoire');
        assert.deepEqual(errors, []);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
