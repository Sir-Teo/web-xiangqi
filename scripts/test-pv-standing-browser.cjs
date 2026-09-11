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
            [['cp 100', 'cp 90 upperbound'], 'Not exact'],
            [['cp 100', 'cp 90'], '0.1 behind'],
            [['cp 30', 'cp 60'], '0.3 ahead'],
          ]) {
            await page.evaluate(scores => window.__sendScores(scores), scores);
            await expectStanding(expected);
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
