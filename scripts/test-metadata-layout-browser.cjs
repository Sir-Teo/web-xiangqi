const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5199/web-xiangqi/';
(async () => {
  const browser = await browserType.launch();
  try {
    for (const [width, height] of [[1440, 900], [390, 844], [320, 480], [844, 390]]) {
      const page = await browser.newPage({ viewport: { width, height }, hasTouch: true, reducedMotion: 'reduce' });
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
        await page.goto(base);
        const coarsePointer = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
        // Desktop Firefox does not emulate a coarse pointer with hasTouch.
        // Keep touch coverage mandatory in engines that support it.
        if (browserType.name() !== 'firefox') assert.equal(coarsePointer, true);
        const activate = locator => coarsePointer ? locator.tap() : locator.click();
        if (width < 900) {
          await page.getByTestId('mobile-view-analysis').click();
          await page.getByTestId('mobile-analysis-tab-moves').click();
        }
        const editor = page.getByTestId('game-metadata'); const summary = editor.locator('summary');
        for (const fontSize of [16, 32]) {
          await page.evaluate(size => document.documentElement.style.fontSize = `${size}px`, fontSize);
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          await summary.scrollIntoViewIfNeeded();
          if (coarsePointer) assert.ok((await summary.boundingBox()).height >= 43.99, `${width}px: game-details disclosure needs a 44px touch target`);
          if (await editor.getAttribute('open') === null) await activate(summary);
          await editor.locator('input').first().waitFor({ state: 'visible' });
          const inputs = await editor.locator('input').all();
          for (const [index, input] of inputs.entries()) {
            await input.scrollIntoViewIfNeeded(); await activate(input); await input.fill(`Detail ${index} 王`);
            const bounds = await input.boundingBox();
            // Firefox can return 43.999969px for an exactly 44px input.
            assert.ok(bounds.height >= 43.99 && bounds.x >= 0 && bounds.x + bounds.width <= width + 1,
              `${width}px/${fontSize}px field ${index}: ${JSON.stringify(bounds)}`);
            const size = await input.evaluate(node => parseFloat(getComputedStyle(node).fontSize));
            assert.ok(size >= fontSize, 'Input text must scale without shrinking below 16px');
            const labelSize = await input.evaluate(node => parseFloat(getComputedStyle(node.closest('label')).fontSize));
            assert.ok(labelSize >= fontSize * .75, 'Visible field labels must follow the reader’s text size');
            assert.equal(await input.inputValue(), `Detail ${index} 王`);
          }
          const boxes = await editor.locator('input').evaluateAll(nodes => nodes.map(node => ({ x: node.getBoundingClientRect().x, y: node.getBoundingClientRect().y })));
          if (fontSize === 32 && width <= 390) assert.equal(new Set(boxes.map(box => Math.round(box.x))).size, 1, 'Enlarged phone fields must form one readable column');
          if (fontSize === 16 && width === 390) assert.equal(boxes[0].y, boxes[1].y, 'Default phone layout stays compact');
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
          await summary.scrollIntoViewIfNeeded();
          await page.screenshot({ path: `/tmp/xiangqi-metadata-layout-${browserType.name()}-${width}-${fontSize}.png` });
          await activate(summary); assert.equal(await editor.getAttribute('open'), null);
        }
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}x${height}: 100/200% text, 44px inputs, field reflow and reachable editing passed (${coarsePointer ? 'touch disclosure verified' : 'mouse; coarse-pointer emulation unavailable'})`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
