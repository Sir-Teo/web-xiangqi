const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:8196/web-xiangqi/';
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [320, 390, 844]) {
      const page = await browser.newPage({ viewport: { width, height: width === 844 ? 390 : 640 }, hasTouch: true, reducedMotion: 'reduce' });
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
        await page.goto(base); await page.getByTestId('mobile-view-analysis').click();
        for (const fontSize of [16, 20, 32]) {
          await page.evaluate(fontSize => document.documentElement.style.fontSize = `${fontSize}px`, fontSize);
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const geometry = await page.locator('.mobile-analysis-tabs').evaluate(strip => {
            const box = node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height }; };
            return { strip: box(strip), tabs: [...strip.querySelectorAll('[role="tab"]')].map(button => {
              const text = [...button.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
              const range = document.createRange(); range.selectNodeContents(text);
              return { label: button.textContent.trim(), button: box(button), text: box(range), icon: box(button.querySelector('svg')) };
            }) };
          });
          for (const { label, button, text, icon } of geometry.tabs) {
            assert.ok(button.height >= 44, `${label} target too short`);
            for (const contents of [text, icon]) assert.ok(contents.left >= button.left - 1 && contents.right <= button.right + 1 && contents.top >= button.top - 1 && contents.bottom <= button.bottom + 1,
              `${width}px ${fontSize}px text: ${label} spills outside its button: ${JSON.stringify(geometry)}`);
            assert.ok(button.top >= geometry.strip.top && button.bottom <= geometry.strip.bottom + 1);
          }
          if (fontSize === 16) assert.equal(new Set(geometry.tabs.map(tab => Math.round(tab.button.top))).size, 1, 'Normal text should retain the compact single row');
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
          for (const id of ['moves', 'review', 'engine', 'graph', 'library']) {
            const tab = page.getByTestId(`mobile-analysis-tab-${id}`);
            await tab.tap();
            assert.equal(await tab.getAttribute('aria-selected'), 'true');
            assert.equal(await page.locator('#' + await tab.getAttribute('aria-controls')).isVisible(), true);
          }
          await page.getByTestId('mobile-analysis-tab-library').focus();
          await page.keyboard.press('ArrowLeft');
          assert.equal(await page.getByTestId('mobile-analysis-tab-graph').getAttribute('aria-selected'), 'true');
          await page.keyboard.press('Home');
          assert.equal(await page.getByTestId('mobile-analysis-tab-moves').getAttribute('aria-selected'), 'true');
          await page.keyboard.press('End');
          assert.equal(await page.getByTestId('mobile-analysis-tab-library').getAttribute('aria-selected'), 'true');
          if (fontSize === 32) await page.screenshot({ path: `/tmp/xiangqi-mobile-tabs-text-${browserType.name()}-${width}.png` });
        }
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}px: 100/125/200% text, contained labels/icons, 44px targets, touch activation, controlled panels and keyboard navigation passed`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
