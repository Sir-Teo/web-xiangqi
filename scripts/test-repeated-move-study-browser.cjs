const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
const fixtures = [
  { id: 'repeated', savedAt: 1, gameMode: 'PvP', label: 'Repeated moves', moves: ['h2e2', 'h9g7'], mainLinePinned: true,
    moveTree: [
      { uci: 'h2e2', comment: 'Original cannon', children: [{ uci: 'h9g7', comment: 'Original main reply' }] },
      { uci: 'h2e2', comment: 'Needle root plan', children: [
        { uci: 'h9g7', comment: 'Other repeated reply' }, { uci: 'h9g7', comment: 'Needle nested plan' },
      ] },
    ] },
  { id: 'legacy-repeat', savedAt: 2, gameMode: 'PvP', label: 'Legacy repeated continuation', moves: ['h2e2', 'b9c7'],
    moveTree: [{ uci: 'h2e2', children: [{ uci: 'h9g7', comment: 'Unchosen continuation' }] },
      { uci: 'h2e2', children: [{ uci: 'b9c7', comment: 'Unique continuation beyond a repeated move' }] }] },
  { id: 'review-repeat', savedAt: 3, gameMode: 'PvP', label: 'Reviewed repeated move', moves: ['h2e2'],
    moveTree: [{ uci: 'h2e2', comment: 'Reviewed first occurrence' }, { uci: 'h2e2', comment: 'Unreviewed second occurrence' }],
    review: { summary: { totalMoves: 1, accuracy: 90, reviewedAt: 1 },
      annotations: [{ moveIndex: 0, evalScore: 30, quality: 'good', reviewNote: 'Review of the first occurrence' }] } },
  { id: 'result-repeat', savedAt: 4, gameMode: 'PvP', label: 'Repeated results', moves: ['h2e2'],
    moveTreePath: [1], mainLinePinned: true, result: 'black',
    moveTree: [{ uci: 'h2e2', comment: 'First result occurrence', recordedResult: 'red-wins' },
      { uci: 'h2e2', comment: 'Second result occurrence', recordedResult: 'black-wins' }] },
];
async function command(page, label) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  await page.keyboard.press('Enter');
  await page.getByRole('combobox', { name: 'Search commands' }).waitFor({ state: 'hidden' });
}
async function note(page, text) {
  await command(page, 'Move tree');
  await page.waitForFunction(text => document.querySelector('[data-testid="move-comment-input"]')?.value === text, text);
}
async function openMatch(page, id, query, expected) {
  await command(page, 'Library');
  await page.getByRole('searchbox', { name: 'Search library' }).fill(query);
  const matches = page.getByTestId(`study-matches-${id}`);
  const expand = matches.getByRole('button', { name: 'Find matching positions', exact: true });
  if (await expand.count()) await expand.click();
  await matches.locator('[data-library-action="open-match"]').click();
  await note(page, expected);
}
async function downloadedJson(page, action) {
  const pending = page.waitForEvent('download'); await action();
  const chunks = []; for await (const chunk of await (await pending).createReadStream()) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString());
}
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const viewport = { width, height: width === 320 ? 640 : 900 };
      const page = await browser.newPage({ viewport, hasTouch: width < 900, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(games => {
          if (!sessionStorage.getItem('__repeated_seeded')) {
            sessionStorage.setItem('__repeated_seeded', '1');
            localStorage.setItem('xiangqi:library:v1', JSON.stringify(games));
          }
          Object.defineProperty(navigator, 'clipboard', { configurable: true,
            value: { writeText: async text => { window.__copied = text; } } });
        }, fixtures);
        await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: `
          window.Pikafish = function() {};
          window.Pikafish.createWorkerEngine = async () => {
            const listeners = []; const emit = line => listeners.forEach(listener => listener(line));
            return { variant: 'single-simd', addMessageListener: listener => listeners.push(listener), terminate() {}, postMessage(command) {
              if (command === 'uci') queueMicrotask(() => emit('uciok'));
              if (command === 'isready') queueMicrotask(() => emit('readyok'));
              if (command.startsWith('go ') || command === 'stop') queueMicrotask(() => emit('bestmove (none)'));
            } };
          };` }));
        await page.goto(base); await page.locator('.xiangqi-board').waitFor();
        const raw = () => page.evaluate(() => localStorage.getItem('xiangqi:library:v1'));
        const original = await raw();
        await openMatch(page, 'repeated', 'Needle root', 'Needle root plan');
        assert.equal(await raw(), original, 'Opening an exact occurrence must leave the library unchanged');
        assert.match(await page.getByTestId('study-save-status').textContent(), /Saved study/);
        await command(page, 'Delete this move and what follows');
        await page.getByTestId('delete-undo-btn').click();
        await note(page, 'Needle root plan');
        assert.equal(await page.locator('.mtree-chip').count(), 5, 'Undo must keep repeated moves as separate annotated occurrences');
        await command(page, 'Find study notes');
        await page.locator('#study-notes-search').fill('Needle nested');
        await page.locator('.study-note-result').click();
        await note(page, 'Needle nested plan');
        assert.equal(await raw(), original, 'Undo and note navigation must leave the library unchanged');
        await openMatch(page, 'repeated', 'Needle nested', 'Needle nested plan');
        assert.equal(await raw(), original);
        assert.match(await page.getByTestId('study-main-line').textContent(), /Exploring a variation/);
        await page.getByTestId('move-comment-input').fill('Updated needle nested plan');
        const details = page.getByTestId('game-metadata');
        if (await details.getAttribute('open') === null) await details.locator('summary').click();
        await details.getByLabel('Event', { exact: true }).fill('Repeated-move workshop');
        await page.keyboard.press('ControlOrMeta+s');
        await page.waitForFunction(() => {
          const game = JSON.parse(localStorage.getItem('xiangqi:library:v1') || '[]').find(game => game.id === 'repeated');
          return game?.moveTreePath?.join('.') === '1.1' && game.moveTree[1].children[1].comment === 'Updated needle nested plan';
        });
        assert.equal(JSON.parse(await raw()).length, fixtures.length);
        const saved = JSON.parse(await raw()).find(game => game.id === 'repeated');
        assert.equal(saved.moveTree[0].children[0].comment, 'Original main reply');
        assert.equal(saved.moveTree[1].children[0].comment, 'Other repeated reply');
        assert.equal(saved.mainLinePinned, true);
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('xiangqi:auto-saved-game:v1') || 'null')?.game?.moveTreePath?.join('.') === '1.1');
        await page.reload();
        await page.getByRole('button', { name: 'Restore', exact: true }).click();
        await note(page, 'Updated needle nested plan');
        assert.match(await page.getByTestId('study-save-status').textContent(), /Saved study/);
        await command(page, 'Copy link');
        const url = await page.evaluate(() => window.__copied);
        const shared = new URL(url);
        const params = new URLSearchParams(shared.hash.startsWith('#share=1&') ? shared.hash.slice(9) : shared.search);
        assert.equal(params.get('path'), '1.1');
        const recipient = await browser.newPage({ viewport, hasTouch: width < 900 });
        try {
          await recipient.goto(url); await recipient.locator('.xiangqi-board').waitFor();
          await note(recipient, 'Updated needle nested plan');
          assert.match(await recipient.getByTestId('study-main-line').textContent(), /Exploring a variation/);
          await command(recipient, 'Go to study main line');
          await note(recipient, 'Original main reply');
          assert.equal(await recipient.evaluate(() => localStorage.getItem('xiangqi:library:v1')), null);
        } finally { await recipient.close(); }
        params.set('path', '9.9');
        if (shared.hash.startsWith('#share=1&')) shared.hash = '#share=1&' + params.toString();
        else shared.search = params.toString();
        const invalid = await browser.newPage({ viewport });
        try {
          await invalid.goto(shared.toString());
          await invalid.waitForFunction(() => document.body.textContent.includes('The selected variation could not be identified'));
          assert.match(await invalid.locator('.bottombar-fen').getAttribute('title'), / w - - 0 1$/);
          assert.equal(await invalid.locator('.mtree-chip').count(), 0);
        } finally { await invalid.close(); }
        await command(page, 'Library');
        await page.getByRole('searchbox', { name: 'Search library' }).fill('');
        const savedCard = page.locator('.lib-card').filter({ has: page.getByTestId('load-saved-repeated') });
        assert.match(await savedCard.textContent(), /saved on variation/);
        const transfer = page.getByRole('region', { name: 'Library backup and recovery' });
        await transfer.locator('summary').filter({ hasText: 'Backup and restore' }).click();
        const backup = await downloadedJson(page, () => transfer.getByRole('button', { name: 'Download library backup', exact: true }).click());
        assert.deepEqual(backup.games.find(game => game.id === 'repeated').moveTreePath, [1, 1]);
        await page.getByTestId('load-saved-repeated').click();
        await note(page, 'Updated needle nested plan');
        await command(page, 'Evaluation graph');
        const matchingGames = page.getByTestId('library-matches');
        await matchingGames.waitFor();
        if (await matchingGames.getAttribute('open') === null) await matchingGames.locator('summary').click();
        await matchingGames.getByTestId('library-match-repeated').click();
        await note(page, 'Original main reply');
        const beforeLegacy = await raw();
        await command(page, 'Library');
        await page.getByTestId('load-saved-legacy-repeat').click();
        await note(page, 'Unique continuation beyond a repeated move');
        assert.equal(await raw(), beforeLegacy, 'Legacy backtracking must remain read-only');
        await openMatch(page, 'review-repeat', 'Unreviewed second', 'Unreviewed second occurrence');
        assert.doesNotMatch(await page.getByTestId('move-tree-active').getAttribute('class'), /quality-good/);
        await command(page, 'Review panel');
        await page.getByTestId('review-off-line').waitFor();
        await openMatch(page, 'review-repeat', 'Reviewed first', 'Reviewed first occurrence');
        assert.match(await page.getByTestId('move-tree-active').getAttribute('class'), /quality-good/);
        await command(page, 'Review panel');
        assert.equal(await page.getByTestId('review-off-line').count(), 0);
        assert.equal(await raw(), beforeLegacy);
        await command(page, 'Library');
        await page.getByRole('searchbox', { name: 'Search library' }).fill('');
        await page.getByTestId('load-saved-result-repeat').click();
        await page.getByRole('dialog', { name: 'Black Wins', exact: true }).getByRole('button', { name: 'Review', exact: true }).click();
        await note(page, 'Second result occurrence');
        const resultDetails = page.getByTestId('game-metadata');
        if (await resultDetails.getAttribute('open') === null) await resultDetails.locator('summary').click();
        const resultSelect = resultDetails.getByRole('combobox', { name: /Result at this position/ });
        assert.equal(await resultSelect.inputValue(), 'black-wins');
        await resultDetails.getByLabel('Event', { exact: true }).fill('Independent result declarations');
        await page.keyboard.press('ControlOrMeta+s');
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('xiangqi:library:v1') || '[]')
          .find(game => game.id === 'result-repeat')?.metadata?.event === 'Independent result declarations');
        const resultSaved = JSON.parse(await raw()).find(game => game.id === 'result-repeat');
        assert.deepEqual(resultSaved.moveTreePath, [1]);
        assert.equal(resultSaved.result, 'black');
        assert.equal(resultSaved.moveTree[0].recordedResult, 'red-wins');
        assert.equal(resultSaved.moveTree[1].recordedResult, 'black-wins');
        const beforeMainLine = await raw();
        await command(page, 'Go to study main line');
        await note(page, 'First result occurrence');
        assert.equal(await resultSelect.inputValue(), 'red-wins');
        assert.equal(await raw(), beforeMainLine, 'Viewing a pinned result must not overwrite the saved occurrence');
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}px: exact repeated-move notes, independent edits/review/results, save/recovery, shared location and pinned line, invalid address rejection, backup and legacy continuation passed`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
