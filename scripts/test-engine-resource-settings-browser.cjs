const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5200/web-xiangqi/';
const realEngine = process.env.XIANGQI_QA_REAL_ENGINE === '1';
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const preferences = page => page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:preferences:v1')));
const openSettings = async page => {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill('Settings');
  await page.keyboard.press('Enter');
  await page.locator('.settings-body[role="dialog"]').waitFor();
  await page.getByTestId('advanced-engine-settings').locator('summary').click();
};
(async () => {
  const browser = await browserType.launch();
  try {
    for (const [width, height] of (realEngine ? [[1440, 900]] : [[1440, 900], [390, 844], [320, 480], [844, 390]])) {
      const page = await browser.newPage({ viewport: { width, height }, screen: { width, height }, hasTouch: width < 900, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(({ width, height }) => {
          Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 18 });
          Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
          // Firefox does not consistently apply Playwright's screen option.
          // Model the device screen explicitly; resizing alone must not lower
          // engine resources on a desktop with a narrow window.
          Object.defineProperty(screen, 'width', { get: () => width });
          Object.defineProperty(screen, 'height', { get: () => height });
          if (!localStorage.getItem('xiangqi:preferences:v1')) localStorage.setItem('xiangqi:preferences:v1', JSON.stringify({ soundEnabled: false, notationStyle: 'uci' }));
        }, { width, height });
        await page.route('**/pikafish.js', async route => {
          if (realEngine) {
            const response = await route.fetch();
            return route.fulfill({ response, body: await response.text() + `
              if (typeof window !== 'undefined') {
                window.__resourceBoots = []; window.__resourceTerminations = 0;
                const create = window.Pikafish.createWorkerEngine;
                window.Pikafish.createWorkerEngine = async function(options) {
                  const engine = await create.call(this, options);
                  window.__resourceBoots.push({ threads: options.threads, hashMB: options.hashMB });
                  const terminate = engine.terminate.bind(engine);
                  engine.terminate = () => { window.__resourceTerminations++; terminate(); };
                  return engine;
                };
              }` });
          }
          return route.fulfill({ contentType: 'application/javascript', body: `
          window.__resourceBoots = []; window.__resourceTerminations = 0;
          window.Pikafish = function() {};
          window.Pikafish.createWorkerEngine = async options => {
            window.__resourceBoots.push({ threads: options.threads, hashMB: options.hashMB });
            const listeners = []; const emit = line => listeners.forEach(listener => listener(line));
            return { variant: options.variant, addMessageListener: listener => listeners.push(listener),
              terminate() { window.__resourceTerminations++; }, postMessage(command) {
                if (command === 'uci') queueMicrotask(() => emit('uciok'));
                if (command === 'isready') queueMicrotask(() => emit('readyok'));
                if (command.startsWith('go ') || command === 'stop') queueMicrotask(() => emit('bestmove (none)'));
              } };
          };` });
        });
        await page.goto(base); await page.locator('.xiangqi-board').waitFor();
        await page.getByTestId('start-engine-analysis').click();
        await page.waitForFunction(() => window.__resourceBoots?.length === 1);
        const expected = width === 1440 ? { threads: 8, hashMB: 256 } : { threads: 2, hashMB: 64 };
        assert.deepEqual(await page.evaluate(() => window.__resourceBoots[0]), expected);
        await openSettings(page);
        const reset = page.getByRole('button', { name: 'Use device defaults', exact: true });
        await reset.waitFor({ timeout: 3000 });
        for (const size of (realEngine ? [16] : [16, 32])) {
          await page.evaluate(size => { document.documentElement.style.fontSize = size + 'px'; }, size); await settle(page);
          const hash = page.getByRole('group', { name: 'Engine Hash', exact: true });
          const manualHash = width === 1440 ? 512 : 128;
          await hash.getByRole('button', { name: `Engine hash ${manualHash} megabytes`, exact: true }).click();
          await page.waitForFunction(value => window.__resourceBoots.at(-1).hashMB === value, manualHash);
          if (width === 1440) {
            await page.getByRole('button', { name: 'Engine threads 1', exact: true }).click();
            await page.waitForFunction(() => window.__resourceBoots.at(-1).threads === 1);
          }
          const before = await page.evaluate(() => ({ boots: window.__resourceBoots.length, terminations: window.__resourceTerminations }));
          for (const help of await page.locator('.settings-help').all()) {
            await help.scrollIntoViewIfNeeded();
            assert.equal(await help.evaluate(node => parseFloat(getComputedStyle(node).fontSize)), size * .8125);
            assert.equal(await help.evaluate(node => node.scrollWidth > node.clientWidth + 1), false);
          }
          await reset.scrollIntoViewIfNeeded();
          const box = await reset.boundingBox(); assert.ok(box.height >= 44 && box.width >= 44);
          await reset.focus(); await page.keyboard.press('Enter');
          await page.waitForFunction(expected => {
            const boot = window.__resourceBoots.at(-1);
            return boot.threads === expected.threads && boot.hashMB === expected.hashMB;
          }, expected);
          await settle(page);
          assert.equal(await reset.evaluate(node => node === document.activeElement), true, 'Reset must retain keyboard focus');
          assert.equal(await reset.evaluate(node => { const r = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), true);
          assert.equal(await page.evaluate(() => window.__resourceBoots.length), before.boots + 1, 'Reset both values in one engine restart');
          assert.equal(await page.evaluate(() => window.__resourceTerminations), before.terminations + 1, 'Retire the previous engine');
          const saved = await preferences(page);
          assert.equal(saved.engineHashMB, undefined); assert.equal(saved.engineThreads, undefined);
          assert.equal(saved.soundEnabled, false); assert.equal(saved.notationStyle, 'uci');
          assert.equal(await hash.locator('[aria-pressed="true"]').getAttribute('aria-label'), `Engine hash ${expected.hashMB} megabytes`);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
          assert.equal(await page.locator('.settings-body').evaluate(node => node.scrollWidth > node.clientWidth + 1), false);
          await page.screenshot({ path: `/tmp/xiangqi-resource-settings-${browserType.name()}-${width}-${size}.png` });
          await reset.press('Space'); await settle(page);
          assert.equal(await page.evaluate(() => window.__resourceBoots.length), before.boots + 1, 'Reset at defaults must not restart again');
        }
        await page.reload(); await page.locator('.xiangqi-board').waitFor();
        await page.getByTestId('start-engine-analysis').click();
        await page.waitForFunction(() => window.__resourceBoots?.length === 1);
        assert.deepEqual(await page.evaluate(() => window.__resourceBoots[0]), expected, 'Reload must retain automatic defaults');
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}x${height}: manual settings, one-restart reset, persistence and keyboard focus passed (${realEngine ? 'real engine' : 'stub engine, 100/200% text'})`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
