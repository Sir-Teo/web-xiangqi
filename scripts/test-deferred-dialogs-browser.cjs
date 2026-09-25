const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5200/web-xiangqi/';
const cases = [
  { module: 'BoardEditor', title: 'Set up a position', ready: 'editor-brush-erase', dialog: 'board-editor' },
  { module: 'RuleLessons', title: 'Learn the rules', ready: 'lesson-select', dialog: 'rule-lessons' },
];
const isModule = (url, name) => new RegExp(`/(?:assets/${name}-[^/]+\\.(?:js|css)|src/components/(?:Board/)?${name}\\.(?:tsx|css))(?:\\?|$)`).test(url);
async function open(page, title) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(title);
  await page.keyboard.press('Enter');
}
async function setup(page) {
  await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: `
    window.Pikafish = function() {};
    window.Pikafish.createWorkerEngine = async () => {
      const listeners = []; const emit = line => listeners.forEach(listener => listener(line));
      window.__goCount = 0; window.__releaseAiMove = () => emit('bestmove h9g7');
      return { variant: 'single-simd', addMessageListener: listener => listeners.push(listener), terminate() {}, postMessage(command) {
        if (command === 'uci') queueMicrotask(() => emit('uciok'));
        if (command === 'isready') queueMicrotask(() => emit('readyok'));
        if (command.startsWith('go ')) { window.__goCount++; if (!window.__holdAiMove) queueMicrotask(() => emit('bestmove (none)')); }
        if (command === 'stop') queueMicrotask(() => emit('bestmove (none)'));
      } };
    };` }));
}
(async () => {
  const browser = await browserType.launch();
  const tab = browserType.name() === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab';
  try {
    for (const item of cases) for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: width === 320 ? 480 : 900 }, reducedMotion: 'reduce' });
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      try {
        await setup(page);
        const requests = [];
        page.on('request', request => { if (cases.some(item => isModule(request.url(), item.module))) requests.push(request.url()); });
        // Hold code, allowing styles to settle. A pending stylesheet can block
        // browser restyling and hide the enlarged-text layout from this check.
        await page.route(url => isModule(url.href, item.module) && /\.(?:js|tsx)(?:\?|$)/.test(url.href), async route => { await gate; await route.continue(); });
        await page.goto(base); const launcher = page.locator('.board-stage .hitbox[tabindex="0"]').first(); await launcher.focus();
        assert.deepEqual(requests, [], 'Optional dialog code and styles must not be requested at startup');
        const fen = await page.locator('.bottombar-fen').getAttribute('title');
        await open(page, item.title);
        const notice = page.getByTestId('dialog-load'); await notice.getByRole('status').waitFor();
        assert.equal(await notice.getByRole('button', { name: 'Close', exact: true }).evaluate(node => node === document.activeElement), true);
        await page.keyboard.press(tab);
        assert.equal(await notice.evaluate(node => node.contains(document.activeElement)), true);
        await page.keyboard.press('Shift+' + tab);
        assert.equal(await notice.evaluate(node => node.contains(document.activeElement)), true);
        await page.evaluate(() => { document.documentElement.style.fontSize = '32px'; });
        await page.waitForFunction(() => {
          const title = document.querySelector('.dialog-load h2');
          return title && parseFloat(getComputedStyle(title).fontSize) >= 36.7;
        }, null, { timeout: 5000 });
        const textSize = await notice.locator('h2').evaluate(node => ({ title: getComputedStyle(node).fontSize, root: getComputedStyle(document.documentElement).fontSize, style: document.documentElement.getAttribute('style') }));
        assert.ok(parseFloat(textSize.title) >= 36.7, JSON.stringify(textSize));
        assert.equal(await notice.locator('button').evaluate(node => node.scrollWidth > node.clientWidth + 1), false, 'Enlarged Close label must fit its button');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.equal(await notice.evaluate(node => node.scrollWidth > node.clientWidth + 1), false);
        await page.screenshot({ path: `/tmp/xiangqi-deferred-${item.module}-${browserType.name()}-${width}.png` });
        await page.keyboard.press('Escape'); await notice.waitFor({ state: 'hidden' });
        assert.equal(await launcher.evaluate(node => node === document.activeElement), true);
        release();
        await page.waitForFunction(name => performance.getEntriesByType('resource').some(entry => entry.name.includes(name) && /\.(?:js|tsx)(?:\?|$)/.test(entry.name)), item.module);
        assert.equal(await page.getByTestId(item.dialog).count(), 0, 'A late module must not reopen a dismissed tool');
        await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
        await open(page, item.title); await page.getByTestId(item.ready).waitFor();
        assert.equal(await page.getByTestId(item.dialog).evaluate(node => node.contains(document.activeElement)), true);
        await page.keyboard.press('Escape'); await page.getByTestId(item.dialog).waitFor({ state: 'hidden' });
        assert.equal(await launcher.evaluate(node => node === document.activeElement), true, 'Loaded content must restore the original launcher');
        assert.equal(await page.locator('.bottombar-fen').getAttribute('title'), fen);
        assert.ok(requests.length > 0, 'Opening must request the deferred module');
        console.log(`${browserType.name()} ${item.module} ${width}px: no startup request, delayed close/Tab/Escape, 200% text, late resolution and loaded focus restoration passed`);
      } finally { release(); await page.close(); }
    }
    for (const item of cases) for (const extension of ['js', 'css']) {
      const page = await browser.newPage({ viewport: { width: 320, height: 480 } });
      try {
        await setup(page);
        await page.route(url => isModule(url.href, item.module) && (extension === 'css' ? /\.css(?:\?|$)/ : /\.(?:js|tsx)(?:\?|$)/).test(url.href), route => route.abort());
        await page.goto(base); const launcher = page.locator('.board-stage .hitbox[tabindex="0"]').first(); await launcher.focus();
        await open(page, item.title); const notice = page.getByTestId('dialog-load'); await notice.getByRole('alert').waitFor();
        assert.equal(await notice.evaluate(node => node.contains(document.activeElement)), true);
        await page.keyboard.press(tab); assert.equal(await notice.evaluate(node => node.contains(document.activeElement)), true);
        await notice.getByRole('button', { name: 'Close', exact: true }).click(); await notice.waitFor({ state: 'hidden' });
        assert.equal(await launcher.evaluate(node => node === document.activeElement), true);
        assert.equal(await page.locator('.board-stage .hitbox').count(), 90);
        await open(page, item.title); await notice.getByRole('alert').waitFor(); await page.keyboard.press('Escape');
        await notice.waitFor({ state: 'hidden' });
        console.log(`${browserType.name()} ${item.module}: failed ${extension} retains an accessible close action and the main board`);
      } finally { await page.close(); }
    }
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: width === 320 ? 480 : 900 } });
      let release; const gate = new Promise(resolve => { release = resolve; });
      try {
        await setup(page); await page.addInitScript(() => { window.__holdAiMove = true; });
        await page.route(url => isModule(url.href, 'BoardEditor') && /\.(?:js|tsx)(?:\?|$)/.test(url.href), async route => { await gate; await route.continue(); });
        await page.goto(base + '?moves=h2e2&mode=PvAI-Black');
        await page.locator('.board-stage .hitbox[tabindex="0"]').first().focus();
        await open(page, 'Settings');
        // The shared link opens analysis. Count only searches started after
        // switching to Play, so the held reply belongs to an actual AI turn.
        // Wait for the analysis search to start first: under load the engine
        // becomes ready late, its analysis `go` landed after this reset and was
        // taken for the AI's, and the reply was released into a search that
        // had already been stopped.
        await page.waitForFunction(() => window.__goCount > 0);
        await page.evaluate(() => { window.__goCount = 0; });
        await page.locator('#settings-workspace-mode').selectOption('play');
        await page.getByRole('button', { name: 'Close settings', exact: true }).click();
        await page.waitForFunction(() => window.__goCount > 0);
        const before = await page.locator('.bottombar-fen').getAttribute('title');
        await open(page, 'Set up a position'); await page.getByTestId('dialog-load').waitFor();
        await page.evaluate(() => window.__releaseAiMove());
        await page.waitForFunction(fen => document.querySelector('.bottombar-fen').getAttribute('title') !== fen, before);
        const after = await page.locator('.bottombar-fen').getAttribute('title');
        release(); await page.getByTestId('editor-fen').waitFor();
        // The FEN is an editable field now, not a paragraph; innerText on an
        // input is always empty, which read as "the editor opened blank".
        assert.equal((await page.getByTestId('editor-fen').inputValue()).split(' ').slice(0, 2).join(' '), before.split(' ').slice(0, 2).join(' '));
        await page.keyboard.press('Escape'); await page.getByTestId('board-editor').waitFor({ state: 'hidden' });
        assert.equal(await page.locator('.bottombar-fen').getAttribute('title'), after, 'Cancel must leave the main game at its latest position');
        console.log(`${browserType.name()} ${width}px: an AI-turn reply during download preserves the editor's opening position and Cancel leaves the game intact`);
      } finally { release(); await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
