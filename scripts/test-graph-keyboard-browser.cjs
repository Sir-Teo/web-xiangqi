const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
const board = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR';
async function command(page, label) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  await page.keyboard.press('Enter');
  await page.getByRole('combobox', { name: 'Search commands' }).waitFor({ state: 'hidden' });
}
(async () => {
  const browser = await browserType.launch();
  try {
    for (const [width, height] of [[1440, 900], [390, 844], [320, 480], [844, 390]]) for (const black of [false, true]) {
      const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 900, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      const engines = []; page.on('request', request => { if (/pikafish\.js|\.nnue|\.wasm/.test(request.url())) engines.push(request.url()); });
      try {
        const cycle = black ? ['a9a8', 'a0a1', 'a8a9', 'a1a0'] : ['a0a1', 'a9a8', 'a1a0', 'a8a9'];
        const params = new URLSearchParams({ fen: `${board} ${black ? 'b' : 'w'} - - 7 23`,
          moves: Array.from({ length: 6 }, (_, index) => cycle[index % 4]).join(' ') });
        await page.goto(`${base}?${params}`);
        await page.locator('.xiangqi-board').waitFor();
        await command(page, 'Evaluation graph');
        const slider = page.getByRole('slider', { name: 'Evaluation graph move navigator' });
        await slider.waitFor();
        const fen = () => page.locator('.bottombar-fen').getAttribute('title');
        const positions = new Map([[6, await fen()]]);
        for (const size of [16, 32]) {
          await page.evaluate(size => { document.documentElement.style.fontSize = size + 'px'; }, size);
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          await slider.focus();
          for (const [key, ply] of [['Home', 0], ['ArrowUp', 1], ['ArrowUp', 2], ['ArrowRight', 3], ['ArrowDown', 2],
            ['ArrowLeft', 1], ['PageDown', 2], ['PageUp', 1], ['End', 6], ['ArrowUp', 6], ['ArrowDown', 5], ['Home', 0], ['ArrowDown', 0], ['Enter', 0], ['Space', 0]]) {
            await page.keyboard.press(key);
            await page.waitForFunction(ply => document.querySelector('[aria-label="Evaluation graph move navigator"]')?.getAttribute('aria-valuenow') === String(ply), ply, { timeout: 10000 });
            assert.equal(await slider.evaluate(node => document.activeElement === node), true, `${key} must retain graph focus`);
            const position = await fen();
            if (positions.has(ply)) assert.equal(position, positions.get(ply), `${key} must restore the board position announced by the slider`);
            else positions.set(ply, position);
          }
          for (const flags of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { isComposing: true }, { keyCode: 229 }, { prePrevented: true }]) {
            const state = await slider.evaluate((node, flags) => {
              const event = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true, ...flags });
              if (flags.prePrevented) event.preventDefault();
              node.dispatchEvent(event);
              return { value: node.getAttribute('aria-valuenow'), prevented: event.defaultPrevented };
            }, flags);
            assert.deepEqual(state, { value: '0', prevented: !!flags.prePrevented });
            assert.equal(await fen(), positions.get(0));
          }
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
        }
        assert.equal(await slider.getAttribute('aria-valuemin'), '0');
        assert.equal(await slider.getAttribute('aria-valuemax'), '6');
        for (const key of ['ArrowUp', 'ArrowDown']) assert.ok((await slider.getAttribute('aria-keyshortcuts')).includes(key));
        assert.deepEqual(engines, [], 'Navigating the graph must not start an engine download');
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}x${height}/${black ? 'Black' : 'Red'}: slider arrows step in both directions, stop at edges, preserve board/announcement/focus, and respect IME/modifiers at 100/200% text`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
