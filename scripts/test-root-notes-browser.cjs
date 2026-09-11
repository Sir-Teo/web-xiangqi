const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5174/web-xiangqi/';
const rootNote = 'Opening plan 开局: develop both horses.';
async function command(page, label) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  await page.keyboard.press('Enter');
}
async function openImport(page, width) {
  if (width < 900) await page.getByTestId('mobile-view-board').click();
  await page.getByRole('button', { name: width < 900 ? 'Open new game menu' : 'Start new game', exact: true }).click();
}
async function importPgn(page, width, text) {
  await openImport(page, width);
  await page.getByTestId('uci-line-input').fill(text);
  await page.getByTestId('import-uci-line-btn').click();
  await page.getByTestId('uci-line-input').waitFor({ state: 'hidden' });
  await page.keyboard.press('t');
}
async function atRoot(page) {
  const phone = page.viewportSize().width < 900;
  if (phone) await page.getByTestId('mobile-view-board').click();
  await page.locator('button[aria-label="Go to first position"]:visible').first().click();
  if (phone) await page.keyboard.press('t');
  await page.getByRole('textbox', { name: 'Note on starting position', exact: true }).waitFor();
}
async function noteIs(page, text) {
  await page.waitForFunction(text => document.querySelector('[data-testid="move-comment-input"]')?.value === text, text);
}
function xqf(diagram = false) {
  const header = Buffer.alloc(1024); header[0] = 0x58; header[1] = 0x51; header[2] = 10;
  header.set([80,70,60,50,40,30,20,10,0,72,12,83,63,43,23,3,9,19,29,39,49,59,69,79,89,17,77,6,26,46,66,86], 16);
  const step = (from, to, child, note) => {
    const text = Buffer.from(note); const value = Buffer.alloc(8 + text.length);
    value[0] = from + 0x18; value[1] = to + 0x20; value[2] = child ? 0xf0 : 0;
    value.writeUInt32LE(text.length, 4); text.copy(value, 8); return value;
  };
  return Buffer.concat([header, step(0,0,!diagram,'XQF opening plan'), ...(diagram ? [] : [step(72,42,false,'XQF move note')])]);
}
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 900 });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.context().addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__copied = text; } } }));
        await page.goto(base);
        await page.keyboard.press('t');
        await page.getByRole('textbox', { name: 'Note on starting position', exact: true }).fill(rootNote);
        await command(page, 'Save game');
        console.log(`${browserType.name()} ${width}px: initial note saved`);
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('xiangqi:library:v1') || '[]').length === 1);
        let saved = await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1')).at(-1));
        assert.equal(saved.rootComment, rootNote); assert.deepEqual(saved.moves, []);
        await command(page, 'Copy PGN');
        const diagramPgn = await page.evaluate(() => window.__copied);
        assert.ok(diagramPgn.includes('{ ' + rootNote + ' }'));
        await command(page, 'Copy share link');
        const url = await page.evaluate(() => window.__copied);
        assert.equal(new URL(url).searchParams.get('note'), rootNote);
        const recipient = await browser.newPage({ viewport: { width, height: 900 } });
        await recipient.goto(url); await recipient.keyboard.press('t'); await noteIs(recipient, rootNote); await recipient.close();
        await importPgn(page, width, `{${rootNote}} 1.h2e2 {Central cannon} (1.b2e2 {Other cannon}) h9g7 *`);
        await page.locator('.mtree-chip').filter({ hasText: 'h2e2' }).click(); await noteIs(page, 'Central cannon');
        await atRoot(page); await noteIs(page, rootNote);
        await command(page, 'Copy PGN');
        const treePgn = await page.evaluate(() => window.__copied);
        assert.ok(treePgn.indexOf(rootNote) < treePgn.indexOf('h2e2'));
        assert.ok(treePgn.includes('Other cannon'));
        await command(page, 'Save game');
        saved = await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1')).at(-1));
        assert.equal(saved.rootComment, rootNote); assert.equal(saved.moveTree[0].comment, 'Central cannon');
        await command(page, 'Library');
        await page.getByRole('searchbox', { name: 'Search library' }).fill('Opening plan 开局');
        await page.getByTestId(`load-saved-${saved.id}`).click();
        await page.keyboard.press('t'); await noteIs(page, rootNote);
        // A pagehide in the same JavaScript task as an input event must retain the uncommitted draft.
        const flushed = await page.evaluate(() => {
          const field = document.querySelector('[data-testid="move-comment-input"]'); field.focus();
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, 'Unfinished opening note');
          field.dispatchEvent(new Event('input', { bubbles: true }));
          const before = localStorage.getItem('xiangqi:auto-saved-game:v1');
          window.dispatchEvent(new Event('pagehide'));
          return { before, after: JSON.parse(localStorage.getItem('xiangqi:auto-saved-game:v1')) };
        });
        assert.ok(!flushed.before?.includes('Unfinished opening note')); assert.equal(flushed.after.game.rootComment, 'Unfinished opening note');
        await page.reload(); await page.getByRole('button', { name: 'Restore', exact: true }).click();
        await page.keyboard.press('t'); await noteIs(page, 'Unfinished opening note');
        await importPgn(page, width, diagramPgn); await noteIs(page, rootNote);
        console.log(`${browserType.name()} ${width}px: share, library and recovery passed`);
        // File import must keep an XQF root note distinct even when no moves follow it.
        for (const diagram of [false, true]) {
          await openImport(page, width);
          await page.getByTestId('uci-line-file-input').setInputFiles({ name: 'Opening.xqf', mimeType: 'application/octet-stream', buffer: xqf(diagram) });
          await page.getByTestId('uci-line-input').waitFor({ state: 'hidden' });
          await page.keyboard.press('t');
          if (!diagram) { await noteIs(page, 'XQF move note'); await atRoot(page); }
          await noteIs(page, 'XQF opening plan');
        }
        await importPgn(page, width, '[DhtmlXQ_movelist][/DhtmlXQ_movelist][DhtmlXQ_comment0]Dhtml opening plan[/DhtmlXQ_comment0]');
        await noteIs(page, 'Dhtml opening plan');
        await page.getByTestId('move-comment-input').fill(''); await page.getByTestId('move-comment-input').blur();
        await page.waitForFunction(() => !localStorage.getItem('xiangqi:auto-saved-game:v1'));
        await page.keyboard.press('Escape');
        await command(page, 'Library');
        await page.getByRole('searchbox', { name: 'Search library' }).fill('');
        const panel = page.getByTestId('pgn-collection-import');
        await panel.locator('summary').click();
        await panel.getByLabel('Choose PGN collection').setInputFiles({ name: 'Opening diagrams.pgn', mimeType: 'application/x-chess-pgn', buffer: Buffer.from('[Event "Root collection"] {Collection opening note} *') });
        await panel.getByRole('button', { name: 'Import 1 game', exact: true }).click();
        await panel.getByRole('status').filter({ hasText: 'Imported 1 game.' }).waitFor();
        const collected = await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1')).find(game => game.metadata?.event === 'Root collection'));
        assert.equal(collected.rootComment, 'Collection opening note');
        const download = page.waitForEvent('download');
        await page.getByTestId(`download-pgn-saved-${collected.id}`).click();
        const chunks = []; for await (const chunk of await (await download).createReadStream()) chunks.push(chunk);
        assert.ok(Buffer.concat(chunks).toString().includes('{ Collection opening note }'));
        await page.getByTestId(`load-saved-${collected.id}`).click();
        await page.keyboard.press('t'); await noteIs(page, 'Collection opening note');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.deepEqual(errors, []);
        await page.getByTestId('move-comment-input').fill(rootNote);
        await page.screenshot({ path: `/tmp/xiangqi-root-notes-${browserType.name()}-${width}.png` });
        console.log(`${browserType.name()} ${width}px: root/branch/diagram notes, library search/load, PGN/share, pending-draft recovery, XQF game/diagram, clearing and collection download passed`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
