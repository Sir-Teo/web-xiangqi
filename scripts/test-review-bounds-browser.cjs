const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5200/web-xiangqi/';
async function command(page, label) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  await page.keyboard.press('Enter');
}
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 900, reducedMotion: 'reduce' });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: `
          window.Pikafish = function() {};
          window.Pikafish.createWorkerEngine = async () => {
            let position = ''; const listeners = [];
            const emit = line => listeners.forEach(fn => fn(line));
            window.__reviewMode = 'exact'; window.__reviewSearches = 0;
            return { variant: 'single-simd', addMessageListener: fn => listeners.push(fn), terminate() {},
              postMessage(command) {
                if (command.startsWith('position ')) position = command;
                if (command === 'uci') queueMicrotask(() => emit('uciok'));
                if (command === 'isready') queueMicrotask(() => emit('readyok'));
                if (command.startsWith('go ')) queueMicrotask(() => {
                  const move = position === 'position startpos' ? 'h2e2' : position.endsWith('h2e2') ? 'h9g7' : 'h0g2';
                  const mode = window.__reviewMode, step = window.__reviewSearches++;
                  const score = mode === 'lower' ? 'cp 150 lowerbound' : mode === 'upper' ? 'cp 150 upperbound'
                    : mode === 'mate' ? 'mate 3 lowerbound' : mode === 'late-bound' ? (step === 2 ? 'cp 900 lowerbound' : 'cp 600') : 'cp 0';
                  if (mode !== 'none') emit('info depth 12 multipv 1 score ' + score + ' pv ' + move);
                  if (mode === 'tail') emit('info depth 13 multipv 1 score cp 900 lowerbound pv ' + move);
                  emit('bestmove ' + move);
                });
                if (command === 'stop') queueMicrotask(() => emit('bestmove (none)'));
              }
            };
          };`
        }));
        await page.goto(base + '?moves=h2e2+h9g7');
        await page.getByTestId('start-engine-analysis').click();
        await page.locator('.xiangqi-board').waitFor();
        await command(page, 'Review panel');
        await page.waitForFunction(() => document.querySelector('[data-testid="start-review-btn"]')?.disabled === false);
        const save = async () => {
          const count = await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1') || '[]').length);
          await command(page, 'Save game');
          await page.waitForFunction(count => JSON.parse(localStorage.getItem('xiangqi:library:v1') || '[]').length > count, count);
          return page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1')).at(-1));
        };
        let previousReview;
        for (const mode of ['lower', 'upper', 'mate', 'none', 'tail', 'late-bound', 'exact']) {
          await page.evaluate(mode => { window.__reviewMode = mode; window.__reviewSearches = 0; }, mode);
          await page.getByTestId(previousReview ? 'rerun-review-btn' : 'start-review-btn').click();
          if (mode === 'tail' || mode === 'exact') {
            await page.getByTestId('rerun-review-btn').waitFor();
            assert.equal(await page.getByTestId('review-error').count(), 0, 'A successful retry must clear the failure notice');
            const saved = await save();
            assert.equal(saved.review.summary.averageCentipawnLoss, 0, 'A later PV bound must not displace the retained exact score');
            assert.equal(saved.review.summary.accuracy, 100);
            assert.ok(saved.review.annotations.every(annotation => annotation.evalScore === 0));
            previousReview = saved.review;
          } else {
            const notice = page.getByTestId('review-error');
            await notice.waitFor();
            assert.match(await notice.innerText(), mode === 'none' ? /no evaluation/ : /only a score bound/);
            assert.match(await notice.innerText(), /Existing scores were kept.*Try reviewing again/);
            assert.equal(await notice.getAttribute('role'), 'alert');
            assert.equal(await page.getByTestId('cancel-review-btn').count(), 0, 'A rejected review must stop');
            assert.deepEqual((await save()).review, previousReview, 'Incomplete review must preserve the prior summary and every annotation');
            if (mode === 'late-bound') assert.equal(await page.evaluate(() => window.__reviewSearches), 3, 'Exercise failure after provisional exact results');
            for (const fontSize of ['16px', '32px', '16px']) {
              await page.evaluate(size => { document.documentElement.style.fontSize = size; }, fontSize);
              await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
              await notice.scrollIntoViewIfNeeded();
              assert.equal(await notice.evaluate(node => node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1), false, 'Review failure explanation must remain readable with enlarged text');
              assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
              if (fontSize === '32px' && mode === 'lower') await notice.screenshot({ path: `/tmp/xiangqi-review-bound-${browserType.name()}-${width}.png` });
            }
          }
        }
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()}: bound-only/no-score review rejection, retained exact scores, partial rerun preservation and recovery passed at ${width}px`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
