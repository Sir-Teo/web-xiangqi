const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5174/web-xiangqi/';
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      for (const blackToMove of [false, true]) {
        const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 900 });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        try {
          await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: `
            window.Pikafish = function() {};
            window.Pikafish.createWorkerEngine = async () => {
              const listeners = []; const emit = line => listeners.forEach(listener => listener(line));
              let position = '', depth = 10;
              window.__scores = ['cp 29999', 'cp 29950'];
              window.__sendScores = scores => {
                window.__scores = scores; depth++;
                window.__scoreDepth = depth;
                const moves = position === 'position startpos' ? ['h2e2', 'b2e2'] : ['h9g7', 'b9c7'];
                scores.forEach((score, i) => emit('info depth ' + depth + ' multipv ' + (i + 1) + ' score ' + score + ' pv ' + moves[i]));
              };
              return { variant: 'single-simd', addMessageListener: listener => listeners.push(listener), terminate() {},
                postMessage(command) {
                  if (command.startsWith('position ')) position = command;
                  if (command === 'uci') queueMicrotask(() => emit('uciok'));
                  if (command === 'isready') queueMicrotask(() => emit('readyok'));
                  if (command.startsWith('go ')) queueMicrotask(() => window.__sendScores(window.__scores));
                  if (command === 'stop') queueMicrotask(() => emit('bestmove (none)'));
                }
              };
            };` }));
          await page.goto(base + (blackToMove ? '?moves=h2e2' : ''));
          await page.locator('.xiangqi-board').waitFor();
          await page.keyboard.press('e');
          const line = page.getByTestId('engine-pv-line-1');
          const standing = line.locator('.pv-line-standing');
          const expectStanding = async label => {
            await page.waitForFunction(label => document.querySelector('[data-testid="engine-pv-line-1"] .pv-line-standing')?.textContent === label, label);
            assert.ok((await line.getAttribute('aria-label')).includes(`, ${label},`), 'Accessible line description disagrees with visible comparison');
          };
          await expectStanding('0.5 behind');
          assert.equal(await page.getByTestId('engine-pv-score-1').locator('strong').innerText(), blackToMove ? '-299.5' : '+299.5');
          for (const [scores, expected] of [
            [['cp 150', 'mate 0'], 'Gets mated'],
            [['mate 3', 'cp 29950'], 'No mate shown'],
            [['cp 100 lowerbound', 'cp 90'], 'Not exact'],
            [['cp 100 upperbound', 'cp 90'], 'Not exact'],
            [['mate 3 lowerbound', 'cp 90'], 'Not exact'],
            [['cp 100 lowerbound upperbound', 'cp 90'], 'Not exact'],
            [['cp 100', 'cp 90 upperbound'], 'Not exact'],
            [['cp 100', 'cp 90'], '0.1 behind'],
            [['cp 30', 'cp 60'], '0.3 ahead'],
          ]) {
            await page.evaluate(scores => window.__sendScores(scores), scores);
            await page.waitForFunction(() => document.querySelector('[data-testid="engine-pv-line-0"] .turnNum')?.textContent?.trim() === 'Depth ' + window.__scoreDepth);
            await expectStanding(expected);
            const first = page.getByTestId('engine-pv-line-0');
            const firstLabel = /lowerbound|upperbound/.test(scores[0]) ? 'Not exact' : 'Best';
            assert.equal(await first.locator('.pv-line-standing').textContent(), firstLabel, 'Line 1 must identify a bounded reading too');
            assert.ok((await first.getAttribute('aria-label')).includes(`, ${firstLabel},`), 'Line 1 accessible description must preserve score uncertainty');
            if (width < 900) await page.getByTestId('mobile-view-board').click();
            const boardReading = page.locator(width < 900 ? '.mobile-eval-chip' : '.eval-bar');
            if (firstLabel === 'Not exact') {
              assert.equal(await boardReading.getByTestId('board-eval-bound').textContent(), 'Bound', 'The board must visibly identify uncertain evaluations');
              const rawLower = scores[0].includes('lowerbound');
              const rawUpper = scores[0].includes('upperbound');
              const boundLabel = rawLower === rawUpper ? 'Bound' : rawLower !== blackToMove ? 'Lower bound' : 'Upper bound';
              const explanation = `${boundLabel}, not an exact score`;
              assert.ok((await boardReading.getAttribute('aria-label')).includes(explanation), 'Board bounds must use Red perspective');
              assert.ok((await (width < 900 ? boardReading : boardReading.locator('.eval-bar-readout')).getAttribute('title')).includes(explanation));
              assert.doesNotMatch(await boardReading.getAttribute('aria-label'), /winning chances/, 'A bound must not announce a definite winning-chance percentage');
              for (const fontSize of ['16px', '32px', '16px']) {
                await page.evaluate(size => { document.documentElement.style.fontSize = size; }, fontSize);
                await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
                assert.equal(await boardReading.evaluate(node => {
                  const label = node.querySelector('[data-testid="board-eval-bound"]');
                  const rect = label.getBoundingClientRect();
                  if (label.scrollWidth > label.clientWidth + 1 || rect.left < 0 || rect.right > innerWidth || rect.top < 0 || rect.bottom > innerHeight) return true;
                  for (let parent = label.parentElement; parent; parent = parent.parentElement) {
                    const bounds = parent.getBoundingClientRect();
                    const style = getComputedStyle(parent);
                    if (/hidden|clip|auto|scroll/.test(style.overflowX) && (rect.left < bounds.left - 1 || rect.right > bounds.right + 1)) return true;
                    if (/hidden|clip|auto|scroll/.test(style.overflowY) && (rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1)) return true;
                  }
                  return false;
                }), false, 'Board bound label must fit at enlarged text sizes');
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
                if (fontSize === '32px' && scores[0] === 'cp 100 lowerbound') await page.screenshot({ path: `/tmp/xiangqi-board-bound-${browserType.name()}-${width}-${blackToMove ? 'black' : 'red'}.png` });
              }
            } else {
              assert.equal(await boardReading.getByTestId('board-eval-bound').count(), 0, 'Exact board scores must clear the bound qualifier');
              assert.doesNotMatch(await boardReading.getAttribute('aria-label'), /bound, not an exact score/);
            }
            if (width < 900) await page.keyboard.press('e');
            if (scores[0] === 'cp 100 lowerbound') {
              assert.equal(await first.locator('.pv-line-standing-best').count(), 0, 'A bounded score should not use the exact-best highlight');
              assert.match(await first.locator('.pv-line-standing').getAttribute('title'), /This score is a bound/);
              await page.evaluate(() => { document.documentElement.style.fontSize = '32px'; });
              await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
              assert.equal(await first.locator('.pv-line-heading').evaluate(node => node.scrollWidth > node.clientWidth + 1), false, 'Bound label must fit with enlarged text');
              await first.screenshot({ path: `/tmp/xiangqi-first-pv-bound-${browserType.name()}-${width}-${blackToMove ? 'black' : 'red'}.png` });
              await page.evaluate(() => { document.documentElement.style.fontSize = '16px'; });
            }
            if (scores[1] === 'mate 0') {
              assert.equal(await page.getByTestId('engine-pv-score-1').locator('strong').innerText(), blackToMove ? '+M0' : '-M0');
            }
          }
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
          await line.screenshot({ path: `/tmp/xiangqi-pv-standing-${browserType.name()}-${width}-${blackToMove ? 'black' : 'red'}.png` });
          assert.equal(await standing.textContent(), '0.3 ahead');
          assert.deepEqual(errors, []);
          console.log(`${browserType.name()}: cp/mate distinction, mate zero, bounds, relative gaps and Red POV passed at ${width}px (${blackToMove ? 'Black' : 'Red'} to move)`);
        } finally { await page.close(); }
      }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
