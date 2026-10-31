const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
const cycle = ['a0a1', 'a9a8', 'a1a0', 'a8a9'];
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * p)];

(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390]) for (const plies of [0, 1000]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 900 });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        if (browserType.name() === 'chromium') {
          const cdp = await page.context().newCDPSession(page);
          await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
        }
        await page.goto(base + (plies ? '?moves=' + Array.from({ length: plies }, (_, i) => cycle[i % 4]).join('+') : ''));
        const board = page.locator('.xiangqi-board').first();
        await board.waitFor();
        const square = (file, rank) => board.locator(`.hitbox[data-file="${file}"][data-rank="${rank}"]`);
        const activate = locator => width < 900 ? locator.tap() : locator.click();
        // Real mouse/touch events include focus, pointer capture and click
        // suppression. No waits for the piece animation between either click.
        for (const move of cycle) {
          await activate(square(move.charCodeAt(0) - 97, Number(move[1])));
          assert.match(await square(move.charCodeAt(0) - 97, Number(move[1])).getAttribute('aria-label'), /selected/);
          await activate(square(move.charCodeAt(2) - 97, Number(move[3])));
          assert.equal(await board.locator('.piece.selected').count(), 0);
          assert.equal(await board.locator(`.piece[data-file="${move.charCodeAt(2) - 97}"][data-rank="${move[3]}"]`).count(), 1);
        }
        const samples = await page.evaluate(async cycle => {
          const board = document.querySelector('.xiangqi-board');
          const paint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const activate = (file, rank) => board.querySelector(`.hitbox[data-file="${file}"][data-rank="${rank}"]`).click();
          const samples = [];
          for (let index = 0; index < 16; index++) {
            const move = cycle[index % cycle.length];
            let start = performance.now();
            activate(move.charCodeAt(0) - 97, Number(move[1]));
            await paint();
            const selection = performance.now() - start;
            if (!board.querySelector('.piece.selected')) throw new Error('Selection was lost');
            start = performance.now();
            activate(move.charCodeAt(2) - 97, Number(move[3]));
            await paint();
            const elapsed = performance.now() - start;
            if (!board.querySelector(`.piece[data-file="${move.charCodeAt(2) - 97}"][data-rank="${move[3]}"]`)) throw new Error('Move was lost');
            const animations = board.getAnimations({ subtree: true }).filter(animation => animation instanceof CSSTransition);
            for (const animation of animations) {
              if (!['transform', 'translate'].includes(animation.transitionProperty)) throw new Error('Board movement animates layout');
              if (animation.effect.getTiming().duration > 100) throw new Error('Board motion exceeds 100ms');
            }
            if (index >= 4) samples.push({ selection, move: elapsed });
          }
          await Promise.all(board.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})));
          // After motion finishes, the visible piece must be centered on the
          // actual input target, including the phone's differently sized grid.
          const target = board.querySelector('.hitbox[data-file="0"][data-rank="0"]').getBoundingClientRect();
          const piece = board.querySelector('.piece[data-file="0"][data-rank="0"]').getBoundingClientRect();
          if (Math.abs(piece.x + piece.width / 2 - target.x - target.width / 2) > 1
            || Math.abs(piece.y + piece.height / 2 - target.y - target.height / 2) > 1) throw new Error('Piece landed away from its input target');
          return samples;
        }, cycle);
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ width, plies, browser: browserType.name(), samples: samples.length,
          medianSelectionToPaintMs: +percentile(samples.map(sample => sample.selection), .5).toFixed(1),
          p95SelectionToPaintMs: +percentile(samples.map(sample => sample.selection), .95).toFixed(1),
          medianMoveToPaintMs: +percentile(samples.map(sample => sample.move), .5).toFixed(1),
          p95MoveToPaintMs: +percentile(samples.map(sample => sample.move), .95).toFixed(1) }));
        if (width === 1440 && !plies) {
          for (const move of cycle) {
            const from = await square(move.charCodeAt(0) - 97, Number(move[1])).boundingBox();
            const to = await square(move.charCodeAt(2) - 97, Number(move[3])).boundingBox();
            await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
            await page.mouse.down();
            await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 3 });
            await page.mouse.up();
            assert.equal(await board.locator('.piece.selected').count(), 0, 'A completed drag must not reselect the source');
            assert.equal(await board.locator(`.piece[data-file="${move.charCodeAt(2) - 97}"][data-rank="${move[3]}"]`).count(), 1);
          }
        }
        // The second click must also capture, and must not wait for the engine.
        if (!plies) {
          await activate(square(1, 2));
          await activate(square(1, 9));
          assert.equal(await board.locator('.piece').count(), 31);
          assert.equal(await board.locator('.piece.red[data-file="1"][data-rank="9"]').count(), 1);
        }
      } finally { await page.close(); }
    }
    const page = await browser.newPage({ reducedMotion: 'reduce' });
    try {
      await page.goto(base);
      await page.locator('.xiangqi-board .hitbox[data-file="0"][data-rank="0"]').click();
      await page.locator('.xiangqi-board .hitbox[data-file="0"][data-rank="1"]').click();
      assert.equal(await page.locator('.piece[data-file="0"][data-rank="1"]').count(), 1);
      assert.equal(await page.evaluate(() => document.querySelector('.xiangqi-board').getAnimations({ subtree: true }).length), 0);
    } finally { await page.close(); }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
