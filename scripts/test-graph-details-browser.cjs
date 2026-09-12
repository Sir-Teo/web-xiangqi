const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5200/web-xiangqi/';
async function command(page, label) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  await page.keyboard.press('Enter');
  await page.getByRole('combobox', { name: 'Search commands' }).waitFor({ state: 'hidden' });
}
(async () => {
  const browser = await browserType.launch();
  try {
    for (const [width, height, hasTouch] of [[1440, 900, false], [390, 844, true], [320, 480, true], [844, 390, true], [390, 844, false]]) {
      const page = await browser.newPage({ viewport: { width, height }, hasTouch, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(() => localStorage.setItem('xiangqi:library:v1', JSON.stringify([{
          id: 'graph-details', savedAt: 1710000005000, gameMode: 'PvP', moves: ['b2e2', 'h9g7'], result: 'ongoing', label: 'Graph details QA',
          review: {
            summary: {
              totalMoves: 2, accuracy: 66, averageCentipawnLoss: 130, redAccuracy: 39, blackAccuracy: 93,
              redAverageCentipawnLoss: 240, blackAverageCentipawnLoss: 20,
              bestCount: 0, goodCount: 1, inaccuracyCount: 0, mistakeCount: 1, blunderCount: 0,
              reviewedAt: 1710000005000, lineSignature: 'b2e2 h9g7', keyMoments: [],
              engine: { tier: 'high', baseDepth: 10, baseMoveTimeMs: 1500, revisitDepth: 12, revisitMoveTimeMs: 3000 },
            },
            annotations: [
              { moveIndex: 0, evalScore: -240, bestMove: 'b0c2', quality: 'mistake', swing: 240, winPercentLoss: 20.7, reviewNote: 'Missed a stronger continuation. B0->C2 was stronger by 240cp.' },
              { moveIndex: 1, evalScore: -220, quality: 'good', swing: 20, winPercentLoss: 1.5, reviewNote: 'Solid choice.' },
            ],
          },
        }])));
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
        await page.locator('.xiangqi-board').waitFor();
        await command(page, 'Library');
        await page.getByTestId('load-saved-graph-details').click();
        await command(page, 'Evaluation graph');
        const navigator = page.getByRole('slider', { name: 'Evaluation graph move navigator' });
        await navigator.waitFor();
        for (const textSize of [16, 32, 16]) {
          await page.evaluate(size => { document.documentElement.style.fontSize = size + 'px'; }, textSize);
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          await navigator.scrollIntoViewIfNeeded();
          await navigator.focus();
          await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight');
          await page.waitForFunction(() => document.querySelector('.graph-tooltip')?.textContent?.includes('Missed a stronger continuation.'));
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const details = page.locator('.graph-tooltip');
          const layout = await details.evaluate(node => {
            const rect = node.getBoundingClientRect();
            const plot = document.querySelector('.winrate-graph').getBoundingClientRect();
            return { top: rect.top, plotBottom: plot.bottom, position: getComputedStyle(node).position,
              clippedX: node.scrollWidth > node.clientWidth + 1, clippedY: node.scrollHeight > node.clientHeight + 1 };
          });
          if (width < 900 || textSize === 32) {
            assert.ok(layout.top >= layout.plotBottom, `${browserType.name()} ${width}px/${textSize}px: details must leave the plot uncovered: ${JSON.stringify(layout)}`);
            assert.equal(layout.clippedX || layout.clippedY, false, 'The complete review note must fit');
          } else assert.equal(layout.position, 'absolute', 'Roomy mouse layouts retain anchored details');
          assert.match(await details.innerText(), /Mistake/);
          assert.match(await details.innerText(), /Chance -21%/);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
          assert.equal(await page.locator('.graph-wrap').evaluate(node => node.scrollHeight > node.clientHeight + 1), false);
          if (textSize === 32) {
            await page.setViewportSize({ width, height: 1600 });
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            await page.locator('.left .panel-content').evaluate(node => { node.scrollTop = 0; });
            await page.screenshot({ path: `/tmp/xiangqi-graph-details-${browserType.name()}-${width}-${hasTouch ? 'touch' : 'mouse'}.png` });
            await page.setViewportSize({ width, height });
          }
          await navigator.scrollIntoViewIfNeeded();
          await navigator.focus();
          await page.keyboard.press('ArrowRight');
          await page.waitForFunction(() => document.querySelector('.graph-tooltip')?.textContent?.includes('Solid choice.'));
        }
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}x${height}/${hasTouch ? 'touch' : 'mouse'}: review details leave the plot visible on narrow/enlarged layouts and update with keyboard navigation`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
