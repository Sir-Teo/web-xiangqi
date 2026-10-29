const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:8196/web-xiangqi/';

(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(() => {
          const game = { id: 'startup-study', savedAt: 1, gameMode: 'PvP', moves: ['h2e2', 'h9g7'],
            metadata: { event: 'Recovery startup regression' },
            moveTree: Array.from({ length: 128 }, (_, i) => ({ uci: 'h2e2', comment: 'Branch ' + i + ' ' + 'x'.repeat(256),
              children: [{ uci: 'h9g7', comment: 'Final note' }] })) };
          const raw = JSON.stringify({ version: 1, draftId: 'startup-owner', savedAt: 1, game });
          localStorage.setItem('xiangqi:recovery-draft:v1:startup-owner', raw);
          localStorage.setItem('xiangqi:auto-saved-game:v1', raw);
          window.__recoveryRaw = raw;
          window.__recoveryParses = 0;
          const parse = JSON.parse;
          JSON.parse = function(value, ...args) {
            if (typeof value === 'string' && value === raw) window.__recoveryParses++;
            return parse.call(this, value, ...args);
          };
        });
        await page.goto(base);
        await page.getByRole('dialog', { name: 'Unfinished game', exact: true }).waitFor();
        assert.equal(await page.evaluate(() => window.__recoveryParses), 1,
          'The startup scan must parse a draft and its identical compatibility mirror only once');
        assert.equal(await page.evaluate(() => localStorage.getItem('xiangqi:auto-saved-game:v1') === window.__recoveryRaw), true);
        await page.getByRole('button', { name: 'Restore', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('.bottombar-fen')?.title?.includes(' w - - 2 2'));
        await page.keyboard.press('t');
        await page.waitForFunction(() => document.querySelector('[data-testid="move-comment-input"]')?.value === 'Final note');
        assert.equal(await page.evaluate(() => localStorage.getItem('xiangqi:recovery-draft:v1:startup-owner')), null);
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:auto-saved-game:v1')).game);
        assert.equal(saved.metadata.event, 'Recovery startup regression');
        assert.equal(saved.moveTree.length, 128);
        assert.equal(saved.moveTree[127].comment, 'Branch 127 ' + 'x'.repeat(256));
        assert.equal(saved.moveTree[127].children[0].comment, 'Final note');
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}px: one startup parse, unchanged recovery bytes, and complete restoration of branches, notes and metadata passed`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
