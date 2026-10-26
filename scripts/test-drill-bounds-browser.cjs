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
    for (const [width, height] of [[1440, 900], [1440, 650], [844, 390], [320, 900]]) for (const black of [false, true]) {
      const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 900, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(black => {
          const moves = ['h2e2', 'h9g7', 'b0c2', 'b9c7', 'a0b0', 'a9b9'];
          const index = black ? 3 : 2, loss = black ? 240 : -240, bestMove = black ? 'h7h6' : 'h0g2';
          localStorage.setItem('xiangqi:library:v1', JSON.stringify([{
            id: 'drill-bound-fixture', savedAt: 1710000009000, gameMode: 'PvP', moves, result: 'ongoing', label: 'Practice bounds',
            review: {
              summary: { totalMoves: 6, accuracy: 80, averageCentipawnLoss: 40, redAccuracy: 70, blackAccuracy: 90,
                bestCount: 5, goodCount: 0, inaccuracyCount: 0, mistakeCount: 1, blunderCount: 0,
                reviewedAt: 1710000009000, lineSignature: moves.join(' '), keyMoments: [{
                  nodeId: 'n' + (index + 1), moveIndex: index, jumpTarget: index, ply: index + 1, side: black ? 'black' : 'red', quality: 'mistake',
                  swing: 240, winPercentLoss: 20.7, evalBefore: 0, evalAfter: loss, bestMove, playedMove: moves[index], note: 'Missed a stronger continuation.'
                }] },
              annotations: moves.map((_, moveIndex) => ({ moveIndex, evalScore: moveIndex >= index ? loss : 0,
                quality: moveIndex === index ? 'mistake' : 'best', swing: moveIndex === index ? 240 : 0, winPercentLoss: moveIndex === index ? 20.7 : 0,
                ...(moveIndex === index ? { bestMove, reviewNote: 'Missed a stronger continuation.' } : {}) }))
            }
          }]));
        }, black);
        await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: `
          window.Pikafish = function() {};
          window.Pikafish.createWorkerEngine = async () => {
            let position = '', depth = 12; const listeners = [];
            const emit = line => listeners.forEach(fn => fn(line));
            window.__waiting = false;
            window.__finish = scores => {
              const plies = position.includes(' moves ') ? position.split(' moves ')[1].split(' ').length : 0;
              const move = plies % 2 ? 'i9i8' : 'i0i1';
              scores.forEach(score => emit('info depth ' + (++depth) + ' multipv 1 score ' + score + ' pv ' + move));
              window.__waiting = false; emit('bestmove ' + move);
            };
            return { variant: 'single-simd', addMessageListener: fn => listeners.push(fn), terminate() {}, postMessage(command) {
              if (command === 'uci') queueMicrotask(() => emit('uciok'));
              if (command === 'isready') queueMicrotask(() => emit('readyok'));
              if (command.startsWith('position ')) position = command;
              if (command.startsWith('go ')) queueMicrotask(() => {
                if (position.endsWith('${black ? 'i9i8' : 'i0i1'}')) window.__waiting = true;
                else window.__finish(['cp 0']);
              });
              if (command === 'stop') queueMicrotask(() => { window.__waiting = false; emit('bestmove (none)'); });
            } };
          };`
        }));
        await page.goto(base);
        await page.getByTestId('start-engine-analysis').click();
        await page.locator('.xiangqi-board').waitFor();
        await command(page, 'Library');
        await page.getByTestId('load-saved-drill-bound-fixture').click();
        const moment = page.getByTestId('review-moment-' + (black ? 3 : 2));
        const originalMoment = await moment.textContent();
        assert.ok(originalMoment, 'The reviewed moment must contain its move details');
        await page.waitForFunction(() => document.querySelector('[data-testid="learn-from-mistakes-btn"]')?.disabled === false);
        await page.getByTestId('learn-from-mistakes-btn').click();
        const banner = page.getByTestId('mistake-drill');
        await page.waitForFunction(() => document.querySelector('[data-testid="mistake-drill"]')?.dataset.verdict === 'asking');
        await page.getByLabel(black ? 'i9, black chariot' : 'i0, red chariot', { exact: true }).click();
        await page.getByLabel(black ? 'i8, empty, legal move' : 'i1, empty, legal move', { exact: true }).click();
        await page.waitForFunction(() => window.__waiting && document.querySelector('[data-testid="mistake-drill"]')?.dataset.verdict === 'pending');
        const attemptedBoard = await page.locator('.hitbox').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')));
        for (const [index, scores] of [['cp 1500 lowerbound'], ['cp 1500 upperbound'], ['mate 3 lowerbound'], [], ['cp 0', 'cp 1500 lowerbound']].entries()) {
          if (index) {
            await page.getByTestId('drill-reanalyze-btn').click();
            await page.waitForFunction(() => window.__waiting && document.querySelector('[data-testid="mistake-drill"]')?.dataset.verdict === 'pending');
          }
          await page.evaluate(scores => window.__finish(scores), scores);
          if (!scores.length) {
            await page.waitForFunction(() => document.querySelector('[data-testid="mistake-drill"]')?.dataset.verdict !== 'pending');
          } else {
            await page.waitForFunction(() => !['asking', 'pending'].includes(document.querySelector('[data-testid="mistake-drill"]')?.dataset.verdict));
          }
          assert.equal(await banner.getAttribute('data-verdict'), index === 4 ? 'good' : 'unavailable', 'Uncertain or missing scores must not grade the attempted move');
          assert.deepEqual(await page.locator('.hitbox').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label'))), attemptedBoard, 'Retry analysis must keep the attempted position');
          if (index < 4) {
            assert.match(await banner.innerText(), scores.length ? /only a score bound/ : /no evaluation/);
            assert.match(await banner.innerText(), /has not been graded/);
            assert.equal(await page.getByTestId('drill-next-btn').innerText(), 'Skip');
            await page.getByTestId('drill-show-btn').waitFor();
            for (const fontSize of ['16px', '32px', '16px']) {
              await page.evaluate(size => { document.documentElement.style.fontSize = size; }, fontSize);
              await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
              assert.equal(await banner.evaluate(node => [node, ...node.querySelectorAll('strong, em, button, .drill-banner-actions')].some(el => el.scrollWidth > el.clientWidth + 1)), false, 'Practice recovery text and actions must fit at enlarged text');
              assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
              if (fontSize === '32px' && index === 0) {
                const board = await page.locator('.xiangqi-board').boundingBox();
                assert.ok(board?.width >= 200, `Practice must keep a usable board with enlarged text: ${JSON.stringify(board)}`);
                for (const [file, rank] of [[0, 0], [8, 0], [0, 9], [8, 9]]) {
                  const point = page.locator(`.hitbox[data-file="${file}"][data-rank="${rank}"]`);
                  await point.scrollIntoViewIfNeeded();
                  assert.equal(await point.evaluate(node => {
                    const rect = node.getBoundingClientRect();
                    return node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
                  }), true, 'Both back ranks must remain reachable during practice');
                }
                for (const button of await banner.getByRole('button').all()) {
                  await button.scrollIntoViewIfNeeded();
                  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
                  const reach = await button.evaluate(node => {
                    const rect = node.getBoundingClientRect();
                    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
                    const parents = [];
                    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
                      const style = getComputedStyle(parent);
                      parents.push({ name: parent.className, overflow: style.overflow, scroll: parent.scrollTop, scrollHeight: parent.scrollHeight, height: parent.clientHeight });
                    }
                    return { reachable: node.contains(hit), label: node.textContent, rect: rect.toJSON(), hit: hit?.outerHTML.slice(0, 200), parents };
                  });
                  if (!reach.reachable) await page.screenshot({ path: '/tmp/xiangqi-drill-reach-failure.png' });
                  assert.equal(reach.reachable, true, `Every recovery action must remain reachable at doubled text: ${JSON.stringify(reach)}`);
                }
                // A taller capture shows the full card without sticky navigation
                // overlaid on a locator screenshot. Assertions use the actual profile.
                await page.setViewportSize({ width, height: 1800 });
                await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
                await banner.screenshot({ path: `/tmp/xiangqi-drill-bound-${browserType.name()}-${width}x${height}-${black ? 'black' : 'red'}.png` });
                await page.setViewportSize({ width, height });
              }
            }
          }
        }
        await page.getByTestId('drill-next-btn').click();
        assert.match(await banner.innerText(), /Done: 1 of 1 found/);
        await page.getByTestId('drill-close-btn').click();
        await command(page, 'Review panel');
        assert.equal(await moment.textContent(), originalMoment, 'Practice must preserve the original reviewed mistake');
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}x${height}/${black ? 'Black' : 'Red'}: uncertain/missing practice scores, same-position retry, exact recovery and enlarged actions passed`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
