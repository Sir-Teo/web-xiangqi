const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
const isExporter = url => String(url).includes('pgnExport.worker');
async function library(page) {
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('.board-stage .hitbox').first().waitFor();
  await page.keyboard.press('ControlOrMeta+k');
  const input = page.getByRole('combobox', { name: 'Search commands' });
  await input.fill('Library'); await page.keyboard.press('Enter'); await input.waitFor({ state: 'hidden' });
  await page.getByRole('searchbox', { name: 'Search library', exact: true }).waitFor();
}
async function readDownload(download) {
  const stream = await download.createReadStream(); let text = '';
  for await (const chunk of stream) text += chunk.toString();
  return text;
}
async function realExport(browser, width) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 900 });
  page.setDefaultTimeout(15000);
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (isExporter(request.url())) requests.push(request.url()); });
  try {
    await page.addInitScript(() => {
      const games = Array.from({ length: 105 }, (_, index) => ({ id: `set-${index}`, label: `Set ${index}`, savedAt: index + 1,
        gameMode: 'PvP', moves: ['h2e2', 'h9g7'], metadata: { event: 'Collection target' }, result: 'draw' }));
      let tree = [];
      for (let index = 1023; index >= 0; index--) tree = [{ uci: ['h0g2', 'h9g7', 'g2h0', 'g7h9'][index % 4],
        ...(index === 1023 ? { comment: 'Deepest study note', recordedResult: 'draw' } : {}), ...(index === 0 ? { nags: [1] } : {}), children: tree }];
      tree.push({ uci: 'b2e2', comment: 'Alternative cannon note' });
      Object.assign(games[0], { moves: [], moveTree: tree, rootComment: 'Opening plan', mainLinePinned: true });
      Object.assign(games[1], { moves: ['h9g7'], startFen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR b - - 0 17' });
      games.push({ ...games[2], id: 'other-result', label: 'Excluded by result', result: 'red' },
        { ...games[2], id: 'other-search', label: 'Excluded by search', metadata: { event: 'Other tournament' } },
        { id: 'draft', savedAt: 200, gameMode: 'PvP', label: 'Upcoming match', moves: [], metadata: { event: 'Draft event', redPlayer: 'Draft player' } },
        { ...games[2], id: 'inconsistent', label: 'Inconsistent record', metadata: { event: 'Damaged collection' },
          moves: ['b2e2'], moveTree: [{ uci: 'h2e2', comment: 'Preserve this incompatible variation' }] });
      localStorage.setItem('xiangqi:library:v1', JSON.stringify(games));
    });
    await library(page);
    const original = await page.evaluate(() => ({ library: localStorage.getItem('xiangqi:library:v1'), fen: document.querySelector('.bottombar-fen')?.title }));
    const search = page.getByRole('searchbox', { name: 'Search library', exact: true });
    await search.fill('Collection target');
    await page.getByRole('combobox', { name: 'Filter by result', exact: true }).selectOption('draw');
    await page.getByRole('combobox', { name: 'Sort saved games', exact: true }).selectOption('oldest');
    const exporter = page.getByTestId('library-pgn-export'); await exporter.locator('summary').click();
    const trigger = exporter.getByRole('button', { name: 'Download 105 games as PGN', exact: true });
    await trigger.waitFor(); await page.waitForFunction(() => !document.querySelector('[data-testid="library-pgn-export"] button')?.disabled);
    assert.equal(await page.locator('.lib-card[data-game-id]').count(), 100, 'The collection must include the next page too');
    assert.equal(requests.length, 0, 'Export code must load only when requested');
    if (width === 390) {
      const workerUrl = url => isExporter(url.href);
      await page.route(workerUrl, route => route.abort());
      await trigger.press('Enter');
      await exporter.getByRole('alert').filter({ hasText: 'exporter could not start' }).waitFor();
      await page.unroute(workerUrl);
    }
    const event = page.waitForEvent('download'); await trigger.press('Enter');
    const download = await event, pgn = await readDownload(download);
    assert.match(download.suggestedFilename(), /^web-xiangqi-\d{4}-\d{2}-\d{2}-105-games\.pgn$/);
    assert.ok(requests.length > 0, 'Prepare the real file in the worker');
    assert.equal((pgn.match(/\[Variant "Xiangqi"\]/g) || []).length, 105);
    let previous = -1;
    for (let index = 0; index < 105; index++) {
      const position = pgn.indexOf(`[White "Set ${index}"]`);
      assert.ok(position >= 0 && position > previous, 'Include every matching game in the chosen sort order'); previous = position;
    }
    for (const note of ['Opening plan', 'Deepest study note', 'Alternative cannon note']) assert.ok(pgn.includes(note));
    assert.match(pgn, /17\.\.\. h9g7/); assert.match(pgn, /h0g2 \$1/);
    assert.ok(!pgn.includes('Excluded by') && !pgn.includes('Inconsistent record'));
    await exporter.getByRole('status').filter({ hasText: 'Download started for 105 games.' }).waitFor();
    const importer = page.getByTestId('pgn-collection-import'); await importer.locator('summary').click();
    await importer.getByLabel('Choose PGN collection').setInputFiles({ name: 'Round-trip.pgn', mimeType: 'application/x-chess-pgn', buffer: Buffer.from(pgn) });
    await importer.getByText(/105 games checked\./).waitFor();
    assert.equal(await importer.getByRole('alert').count(), 0, 'The downloaded collection must reopen without truncation');
    await search.fill('Draft event');
    await page.getByRole('combobox', { name: 'Filter by result', exact: true }).selectOption('all');
    const draftEvent = page.waitForEvent('download');
    await exporter.getByRole('button', { name: 'Download 1 game as PGN', exact: true }).click();
    const draftPgn = await readDownload(await draftEvent);
    await importer.getByLabel('Choose PGN collection').setInputFiles({ name: 'Draft.pgn', mimeType: 'application/x-chess-pgn', buffer: Buffer.from(draftPgn) });
    await importer.getByText(/1 game checked\./).waitFor();
    assert.equal(await importer.getByRole('alert').count(), 0, 'A metadata-only saved draft must also reopen');
    assert.match(draftPgn, /\[White "Draft player"\]/);
    await search.fill('Damaged collection');
    const broken = exporter.getByRole('button', { name: 'Download 1 game as PGN', exact: true });
    await broken.click();
    await exporter.getByRole('alert').filter({ hasText: 'No PGN was exported' }).waitFor();
    assert.match(await exporter.getByRole('alert').innerText(), /library backup/);
    for (const fontSize of [16, 32]) {
      await page.evaluate(size => document.documentElement.style.fontSize = size + 'px', fontSize);
      await exporter.scrollIntoViewIfNeeded();
      assert.equal(await exporter.evaluate(node => node.scrollWidth > node.clientWidth + 1), false);
      assert.deepEqual(await exporter.locator('button').evaluateAll(nodes => nodes.filter(node => node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1).map(node => node.textContent)), []);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
    await search.fill('No matching record');
    assert.equal(await exporter.getByRole('button', { name: 'Download 0 games as PGN', exact: true }).isDisabled(), true);
    assert.deepEqual(await page.evaluate(() => ({ library: localStorage.getItem('xiangqi:library:v1'), fen: document.querySelector('.bottombar-fen')?.title })), original);
    assert.deepEqual(errors, []);
    console.log(`${browserType.name()} ${width}px: 105 filtered games across pages, sorted file, deep notes/variations, custom root, real reimport, incomplete-record refusal and 100/200% text passed`);
  } catch (error) {
    await page.screenshot({ path: `/tmp/xiangqi-collection-export-${browserType.name()}-${width}.png` }).catch(() => {});
    throw error;
  } finally { await page.close(); }
}
async function lifecycle(browser, width) {
  const page = await browser.newPage({ viewport: { width, height: width === 320 ? 568 : 900 } });
  page.setDefaultTimeout(15000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript(() => {
      localStorage.setItem('xiangqi:library:v1', JSON.stringify([
        { id: 'one', savedAt: 1, gameMode: 'PvP', label: 'Target one', moves: ['h2e2'] },
        { id: 'two', savedAt: 2, gameMode: 'PvP', label: 'Other study', moves: ['b2e2'] },
      ]));
      const NativeWorker = Worker, nativeTimeout = window.setTimeout.bind(window), create = URL.createObjectURL.bind(URL);
      window.__exportWorkers = []; window.__exportMode = ''; window.__exportFiles = 0;
      window.setTimeout = (callback, delay, ...args) => {
        if (delay === 30000 && window.__exportWorkers.length) window.__exportTimeout = callback;
        return nativeTimeout(callback, delay, ...args);
      };
      URL.createObjectURL = blob => {
        if (blob.type.includes('chess-pgn')) {
          if (window.__denyExportDownload) throw new Error('Controlled file creation failure');
          window.__exportFiles++;
        }
        return create(blob);
      };
      window.Worker = function(url, options) {
        if (!String(url).includes('pgnExport.worker')) return new NativeWorker(url, options);
        if (window.__exportMode === 'constructor') throw new Error('Controlled worker creation failure');
        const worker = { terminated: false, onmessage: null, onmessageerror: null, onerror: null,
          terminate() { this.terminated = true; }, postMessage(data) {
            if (window.__exportMode === 'transfer') throw new Error('Controlled transfer failure');
            this.data = data; this.deliver = this.onmessage;
          } };
        window.__exportWorkers.push(worker); return worker;
      };
    });
    await library(page);
    const original = await page.evaluate(() => localStorage.getItem('xiangqi:library:v1'));
    const exporter = page.getByTestId('library-pgn-export'); await exporter.locator('summary').click();
    if (width === 320) await page.evaluate(() => document.documentElement.style.fontSize = '32px');
    const trigger = () => exporter.getByRole('button', { name: /^Download \d+ games? as PGN$/ });
    const start = async (mode = '') => {
      await page.evaluate(mode => { window.__exportMode = mode; }, mode);
      await page.waitForFunction(() => !document.querySelector('[data-testid="library-pgn-export"] button')?.disabled);
      await trigger().press('Enter');
      if (!mode) await exporter.getByRole('button', { name: 'Cancel export', exact: true }).waitFor();
    };
    const staleReply = () => page.evaluate(() => window.__exportWorkers.at(-1).deliver({ data: { pgn: 'Old result', count: 2 } }));
    await start();
    assert.equal(await exporter.getByRole('button', { name: 'Cancel export', exact: true }).evaluate(node => node === document.activeElement), true,
      'A keyboard export must put the available Cancel action in focus while its trigger is disabled');
    await page.waitForFunction(() => {
      const node = document.activeElement, rect = node?.getBoundingClientRect();
      return node?.textContent === 'Cancel export' && node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    });
    const focusRing = await exporter.getByRole('button', { name: 'Cancel export', exact: true }).evaluate(node => {
      const style = getComputedStyle(node); return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
    });
    assert.ok(focusRing.style !== 'none' && focusRing.width >= 2, 'The keyboard Cancel action needs a visible focus ring');
    if (width === 320) await page.screenshot({ path: `/tmp/xiangqi-export-cancel-focus-${browserType.name()}-320.png` });
    await page.keyboard.press('Enter');
    assert.equal(await trigger().evaluate(node => node === document.activeElement), true);
    await staleReply(); assert.equal(await page.evaluate(() => window.__exportFiles), 0);
    await start();
    const search = page.getByRole('searchbox', { name: 'Search library', exact: true }); await search.fill('Target one');
    await page.waitForFunction(() => window.__exportWorkers.at(-1).terminated);
    await staleReply(); assert.equal(await page.evaluate(() => window.__exportFiles), 0);
    assert.equal(await search.evaluate(node => node === document.activeElement), true);
    assert.equal(await exporter.getByRole('alert').count(), 0);
    for (const mode of ['constructor', 'transfer', 'decode', 'error', 'malformed', 'count', 'timeout', 'download']) {
      await start(['constructor', 'transfer'].includes(mode) ? mode : '');
      if (!['constructor', 'transfer'].includes(mode)) await page.evaluate(mode => {
        const worker = window.__exportWorkers.at(-1);
        if (mode === 'decode') worker.onmessageerror();
        else if (mode === 'error') {
          const event = new ErrorEvent('error', { cancelable: true }); worker.onerror(event);
          if (!event.defaultPrevented) throw new Error('A handled worker failure must not become an uncaught page error');
        } else if (mode === 'malformed') worker.deliver({ data: null });
        else if (mode === 'count') worker.deliver({ data: { count: 999, pgn: 'Incomplete file' } });
        else if (mode === 'timeout') window.__exportTimeout();
        else { window.__denyExportDownload = true; worker.deliver({ data: { count: 1, pgn: 'Prepared file' } }); window.__denyExportDownload = false; }
      }, mode);
      await exporter.getByRole('alert').waitFor();
      assert.equal(await trigger().isEnabled(), true, 'Failures must leave export retryable');
      assert.equal(await trigger().evaluate(node => node === document.activeElement), true, 'A failed keyboard export must retain focus for retry');
      assert.equal(await page.evaluate(() => window.__exportFiles), 0);
    }
    await start();
    const event = page.waitForEvent('download');
    await page.evaluate(() => window.__exportWorkers.at(-1).deliver({ data: { count: 1, pgn: '[Variant "Xiangqi"]\n\n1. h2e2 *\n' } }));
    await event;
    await page.evaluate(() => window.__exportWorkers.at(-1).deliver({ data: { count: 1, pgn: '[Variant "Xiangqi"]\n\n1. h2e2 *\n' } }));
    assert.equal(await page.evaluate(() => window.__exportFiles), 1, 'Ignore duplicate replies after completion');
    assert.equal(await exporter.getByRole('alert').count(), 0);
    await start();
    await page.keyboard.press('ControlOrMeta+k');
    const commands = page.getByRole('combobox', { name: 'Search commands' });
    await commands.fill('Evaluation graph'); await page.keyboard.press('Enter'); await commands.waitFor({ state: 'hidden' });
    await exporter.waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => window.__exportWorkers.at(-1).terminated), true);
    await staleReply(); assert.equal(await page.evaluate(() => window.__exportFiles), 1);
    assert.equal(await page.evaluate(() => localStorage.getItem('xiangqi:library:v1')), original);
    assert.deepEqual(errors, []);
    console.log(`${browserType.name()} ${width}px: cancellation, changed filters, stale/duplicate replies, worker/transfer/decoding/timeout/download failures, keyboard retry and unmount cleanup passed`);
  } catch (error) {
    console.error(JSON.stringify({ width, errors, active: await page.evaluate(() => document.activeElement?.outerHTML), body: (await page.locator('body').innerText()).slice(-6000) }));
    await page.screenshot({ path: `/tmp/xiangqi-export-lifecycle-${browserType.name()}-${width}.png` }).catch(() => {});
    throw error;
  } finally { await page.close(); }
}
(async () => {
  const browser = await browserType.launch();
  try { for (const width of [1440, 390, 320]) {
    if (!process.argv.includes('--lifecycle-only')) await realExport(browser, width);
    await lifecycle(browser, width);
  } }
  finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
