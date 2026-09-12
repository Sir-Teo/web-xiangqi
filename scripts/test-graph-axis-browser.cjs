const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5200/web-xiangqi/';
(async () => {
  const browser = await browserType.launch();
  try {
    for (const [width, height] of [[1440, 900], [390, 844], [320, 480], [844, 390]]) {
      for (const length of [0, 1, 5, 40, 1024]) {
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
          const cycle = ['a0a1', 'a9a8', 'a1a0', 'a8a9'];
          await page.goto(base + (length ? '?moves=' + Array.from({ length }, (_, index) => cycle[index % 4]).join('+') : ''));
          if (width < 900) {
            await page.getByTestId('mobile-view-analysis').click();
            await page.getByTestId('mobile-analysis-tab-graph').click();
          }
          const navigator = page.getByRole('slider', { name: 'Evaluation graph move navigator' });
          await navigator.waitFor();
          for (const textSize of [16, 32, 16]) {
            await page.evaluate(size => { document.documentElement.style.fontSize = size + 'px'; }, textSize);
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            const clippedSummary = await page.locator('.graph-summary-card span, .graph-summary-card strong, .graph-summary-hint').evaluateAll(nodes => nodes.filter(node => node.scrollWidth > node.clientWidth + 1).map(node => node.textContent));
            assert.deepEqual(clippedSummary, [], `${width}px/${textSize}px: graph summary text must fit`);
            for (const area of await page.locator('.graph-legend, .graph-extrema').all()) {
              assert.equal(await area.evaluate(node => node.scrollWidth > node.clientWidth + 1), false, `${width}px/${textSize}px: graph legend and extrema must fit`);
            }
            for (const [key, ply] of [['Home', 0], ['End', length], ['ArrowLeft', Math.max(0, length - 1)]]) {
              await navigator.focus(); await page.keyboard.press(key);
              await page.waitForFunction(ply => document.querySelector('[role="slider"][aria-label="Evaluation graph move navigator"]')?.getAttribute('aria-valuenow') === String(ply), ply);
              const labels = await page.locator('.graph-axis-text').evaluateAll(nodes => nodes.map(node => {
                const rect = node.getBoundingClientRect();
                return { text: node.textContent, left: rect.left, right: rect.right };
              }).sort((a, b) => a.left - b.left));
              assert.ok(labels.length > 0);
              assert.equal(labels[0].text, 'Start');
              if (length) assert.equal(labels.at(-1).text, String(length));
              for (let index = 1; index < labels.length; index++) {
                assert.ok(labels[index].left >= labels[index - 1].right + 2, `${browserType.name()} ${width}px/${length} moves/${textSize}px/${key}: overlapping axis labels ${JSON.stringify(labels)}`);
              }
              assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
            }
            if (length === 1024 && textSize === 32) {
              // A tall full-view capture keeps the stacked cards in view;
              // the assertions above still use the short viewport.
              await page.setViewportSize({ width, height: 1400 });
              await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
              await navigator.blur();
              await page.mouse.move(0, 0);
              await page.evaluate(() => { document.querySelector('.left .panel-content').scrollTop = 0; });
              await page.screenshot({ path: `/tmp/xiangqi-graph-readable-${browserType.name()}-${width}.png` });
              await page.setViewportSize({ width, height });
            }
          }
          assert.deepEqual(errors, []);
        } finally { await page.close(); }
      }
      console.log(`${browserType.name()} ${width}x${height}: graph axis labels do not overlap for 0/1/5/40/1024 moves, three cursor positions and doubled text`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
