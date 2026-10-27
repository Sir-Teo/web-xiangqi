const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
const tree = [{ uci: 'h2e2', comment: 'Keep the cannon note', children: [
  { uci: 'h9g7', comment: 'Keep the horse reply' },
  { uci: 'b9c7', comment: 'Keep the alternative reply' },
] }];
const fixtures = [
  { id: 'missing-root', moves: ['b2e2'], moveTree: tree },
  { id: 'missing-tip', moves: ['h2e2', 'a9a8'], moveTree: tree },
  { id: 'complete-tree', moves: ['h2e2', 'h9g7'], moveTree: tree },
  { id: 'flat-record', moves: ['b2e2', 'h9g7'] },
].map((game, index) => ({ savedAt: index + 1, gameMode: 'PvP', label: game.id, ...game }));
async function readDownload(download) {
  const stream = await download.createReadStream();
  let text = '';
  for await (const chunk of stream) text += chunk.toString();
  return text;
}
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      page.setDefaultTimeout(10000);
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(fixtures => {
          localStorage.setItem('xiangqi:library:v1', JSON.stringify(fixtures));
          window.__copies = [];
          Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => window.__copies.push(text) } });
          window.__pgnFiles = 0;
          const create = URL.createObjectURL.bind(URL);
          URL.createObjectURL = blob => { if (blob.type.includes('chess-pgn')) window.__pgnFiles++; return create(blob); };
        }, fixtures);
        await page.goto(base); await page.locator('.board-stage .hitbox').first().waitFor();
        await page.keyboard.press('ControlOrMeta+k');
        await page.getByRole('combobox', { name: 'Search commands' }).fill('Library'); await page.keyboard.press('Enter');
        await page.getByRole('combobox', { name: 'Search commands' }).waitFor({ state: 'hidden' });
        await page.getByTestId('load-saved-missing-root').waitFor();
        const original = await page.evaluate(() => ({ library: localStorage.getItem('xiangqi:library:v1'), fen: document.querySelector('.bottombar-fen')?.title }));
        for (const id of ['missing-root', 'missing-tip']) {
          for (const action of ['copy', 'download']) {
            const control = page.getByTestId(`${action}-pgn-saved-${id}`);
            await control.press('Enter');
            const error = page.getByTestId('library-action-error');
            try { await error.waitFor({ state: 'visible', timeout: 3000 }); }
            catch (cause) { throw new Error(`An inconsistent saved path must report the export problem. Output: ${JSON.stringify(await page.evaluate(() => ({ copies: window.__copies, files: window.__pgnFiles, active: document.activeElement?.outerHTML, error: document.querySelector('[data-testid="library-action-error"]')?.outerHTML })))}`, { cause }); }
            assert.match(await error.innerText(), /saved moves.*variations/i);
            assert.match(await error.innerText(), /Download library backup/);
            assert.equal(await control.evaluate(node => node === document.activeElement), true, 'A rejected export must retain keyboard focus');
            assert.deepEqual(await page.evaluate(() => window.__copies), [], 'Do not copy a partial replacement record');
            assert.equal(await page.evaluate(() => window.__pgnFiles), 0, 'Do not create a partial PGN download');
          }
        }
        for (const id of ['complete-tree', 'flat-record']) {
          await page.getByTestId(`copy-pgn-saved-${id}`).click();
          await page.waitForFunction(id => window.__copies.at(-1)?.includes(`[White "${id}"]`), id);
          const pgn = await page.evaluate(() => window.__copies.at(-1));
          const event = page.waitForEvent('download'); await page.getByTestId(`download-pgn-saved-${id}`).click();
          assert.equal(await readDownload(await event), pgn, 'Copy and file export must retain the same record');
          if (id === 'complete-tree') for (const note of ['Keep the cannon note', 'Keep the horse reply', 'Keep the alternative reply']) assert.ok(pgn.includes(note), 'Every variation note must be retained');
          else assert.match(pgn, /b2e2.*h9g7/);
          assert.equal(await page.getByTestId('library-action-error').count(), 0, 'A valid export clears the previous error');
        }
        await page.getByText('Backup and restore', { exact: true }).click();
        const event = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download library backup', exact: true }).click();
        const backup = JSON.parse(await readDownload(await event));
        for (const game of fixtures) {
          const saved = backup.games.find(item => item.id === game.id);
          assert.deepEqual(saved.moves, game.moves);
          assert.deepEqual(saved.moveTree, game.moveTree, 'The full tree remains available in the recovery backup');
        }
        assert.deepEqual(await page.evaluate(() => ({ library: localStorage.getItem('xiangqi:library:v1'), fen: document.querySelector('.bottombar-fen')?.title })), original);
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}px: inconsistent paths cannot silently lose variations; valid copy/file exports and complete backup remain available`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
