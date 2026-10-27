const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
const labels = { keep: 'keep', replace: 'Study-name-'.repeat(10), copy: 'copy' };

(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: width === 320 ? 640 : 844 }, hasTouch: width < 900, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      const games = ['keep', 'replace', 'copy'].map(id => ({ id, label: labels[id], savedAt: 1, gameMode: 'PvP', moves: ['h2e2'], rootComment: 'Current' }));
      try {
        await page.addInitScript(games => localStorage.setItem('xiangqi:library:v1', JSON.stringify(games)), games);
        await page.goto(base); await page.locator('.xiangqi-board').waitFor();
        const fen = await page.locator('.bottombar-fen').getAttribute('title');
        await page.keyboard.press('ControlOrMeta+k'); await page.getByRole('combobox').fill('Library'); await page.keyboard.press('Enter');
        await page.locator('.lib-transfer summary').filter({ hasText: 'Backup and restore' }).click();
        await page.getByLabel('Restore library backup', { exact: true }).setInputFiles({ name: 'backup.json', mimeType: 'application/json',
          buffer: Buffer.from(JSON.stringify({ format: 'web-xiangqi-library', version: 1, games: games.map(game => ({ ...game, rootComment: 'Backup' })) })) });
        const choice = id => page.getByRole('combobox', { name: `Resolve ${labels[id]}`, exact: true });
        await choice('keep').waitFor();
        for (const size of [16, 32]) {
          await page.evaluate(size => { document.documentElement.style.fontSize = size + 'px'; }, size);
          for (const id of ['keep', 'replace', 'copy']) {
            const field = choice(id); await field.scrollIntoViewIfNeeded();
            await page.keyboard.press('Tab'); await field.focus();
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            const geometry = await field.evaluate(node => {
              const box = node.getBoundingClientRect(), style = getComputedStyle(node), panel = node.closest('.lib-panel');
              return { left: box.left, right: box.right, height: box.height, font: parseFloat(style.fontSize),
                outline: style.outlineStyle, outlineWidth: parseFloat(style.outlineWidth), overflow: panel.scrollWidth - panel.clientWidth };
            });
            assert.ok(geometry.height >= 44 && geometry.font >= size - 0.1, `${width}px/${size}px: ${JSON.stringify(geometry)}`);
            assert.ok(geometry.left >= 0 && geometry.right <= width && geometry.overflow <= 1, JSON.stringify(geometry));
            assert.ok(geometry.outline !== 'none' && geometry.outlineWidth >= 2, 'Conflict choices need a visible keyboard focus ring');
            assert.match(await field.evaluate(node => document.getElementById(node.getAttribute('aria-describedby'))?.textContent || ''), /Keep the current study/);
          }
        }
        await choice('replace').selectOption('replace');
        assert.match(await choice('replace').evaluate(node => document.getElementById(node.getAttribute('aria-describedby')).textContent), /Replace the current study/);
        await choice('copy').selectOption('copy');
        assert.match(await choice('copy').evaluate(node => document.getElementById(node.getAttribute('aria-describedby')).textContent), /separate copy/);
        assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1'))), games, 'Preview choices must not change saved games');
        await choice('replace').scrollIntoViewIfNeeded();
        await page.screenshot({ path: `/tmp/xiangqi-backup-conflicts-${browserType.name()}-${width}.png` });
        await page.getByRole('button', { name: 'Restore 1 game', exact: true }).click();
        await page.getByText(/Replaced 1; kept 1/).waitFor();
        const result = await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1')));
        assert.equal(result.length, 4);
        assert.equal(result.find(game => game.id === 'keep').rootComment, 'Current');
        assert.equal(result.find(game => game.id === 'replace').rootComment, 'Backup');
        assert.equal(result.find(game => game.id === 'copy').rootComment, 'Current');
        assert.ok(result.some(game => !games.some(original => original.id === game.id) && game.rootComment === 'Backup'));
        assert.equal(await page.locator('.bottombar-fen').getAttribute('title'), fen);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}px: readable backup choices at 100/200% text, keyboard focus, long names, previews and independent keep/replace/copy passed`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
