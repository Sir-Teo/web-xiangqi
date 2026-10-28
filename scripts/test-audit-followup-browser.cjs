const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';

async function fullLibrary(browser, width) {
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript(() => localStorage.setItem('xiangqi:library:v1', JSON.stringify(
      Array.from({ length: 500 }, (_, i) => ({ id: `game-${i}`, savedAt: i + 1, gameMode: 'PvP', moves: ['h2e2'] }))
    )));
    await page.goto(base + '?moves=h2e2');
    const before = await page.evaluate(() => localStorage.getItem('xiangqi:library:v1'));
    // On a phone Save lives in the board's overflow menu.
    if (width < 900) await page.getByTestId('mobile-more-actions-btn').click();
    await page.getByTestId(width < 900 ? 'mobile-save-game-btn' : 'save-game-btn').click();
    const notice = page.getByTestId('save-game-error');
    await notice.waitFor();
    assert.match(await notice.innerText(), /full \(500 games\)/);
    assert.equal(await page.evaluate(() => localStorage.getItem('xiangqi:library:v1')), before);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `/tmp/xiangqi-library-full-${width}.png` });
    await notice.getByRole('button', { name: 'Open library' }).click();
    await page.getByTestId('saved-game-list').waitFor();
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
}

async function fenValidation(browser) {
  const page = await browser.newPage();
  try {
    const invalid = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/PPP1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
    await page.goto(base + '?fen=' + encodeURIComponent(invalid));
    await page.waitForFunction(() => document.querySelector('[data-testid="notice-announcement"]')?.textContent.trim());
    assert.equal(await page.locator('.piece').count(), 32);
    assert.match(await page.getByTestId('notice-announcement').innerText(), /position|FEN/i);
    const valid = '3k5/9/9/9/9/9/9/9/9/3RK4 b - - 47 32';
    await page.goto(base + '?fen=' + encodeURIComponent(valid));
    await page.waitForFunction(() => document.querySelectorAll('.piece').length === 3);
    assert.equal(await page.getByTestId('notice-announcement').innerText(), '');
    for (const [fen, reason] of [
      ['4k4/9/4P4/9/9/9/9/9/9/3RKR3 b - - 0 1', 'No legal moves - Xiangqi counts this as a loss'],
      ['R3k4/R8/9/9/9/9/9/9/9/3K5 b - - 0 1', 'Checkmate'],
    ]) {
      await page.goto(base + '?fen=' + encodeURIComponent(fen));
      await page.getByRole('heading', { name: 'Red Wins' }).waitFor();
      assert.equal((await page.locator('.game-over-subtitle').textContent()).trim(), reason);
    }
  } finally { await page.close(); }
}

async function cloudRuleFreshness(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pending = [];
  try {
    await page.route('**/chessdb.php*', route => {
      if (new URL(route.request().url()).searchParams.get('action') === 'queryrule') pending.push(route);
      else return route.fulfill({ body: 'unknown', contentType: 'text/plain' });
    });
    const moves = 'a0a1 a9a8 a1a0 a8a9 a0a1 a9a8 a1a0 a8a9';
    await page.goto(base + '?moves=' + encodeURIComponent(moves));
    await page.getByTestId('cloud-book-enable').click();
    const ruling = page.getByTestId('repetition-cloud-rule');
    await page.waitForFunction(() => document.querySelector('[data-testid="repetition-cloud-rule"]')?.textContent.includes('checking'));
    const waitForRoute = async () => {
      for (let i = 0; i < 100 && pending.length === 0; i++) await new Promise(resolve => setTimeout(resolve, 25));
      assert.ok(pending.length, 'Expected a cloud rule request');
      return pending.shift();
    };
    await (await waitForRoute()).fulfill({ body: 'move:a0a1,rule:ban', contentType: 'text/plain' });
    await page.waitForFunction(() => document.querySelector('[data-testid="repetition-cloud-rule"]')?.textContent.includes('forbidden'));
    await page.locator('.hitbox[data-file="0"][data-rank="0"]').click();
    await page.locator('.hitbox[data-file="0"][data-rank="1"]').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="repetition-cloud-rule"]')?.textContent.includes('checking'));
    assert.doesNotMatch(await ruling.innerText(), /forbidden/);
    await (await waitForRoute()).fulfill({ body: 'invalid movelist', contentType: 'text/plain' });
    await page.waitForFunction(() => document.querySelector('[data-testid="repetition-cloud-rule"]')?.textContent.includes('unavailable'));
    await page.screenshot({ path: '/tmp/xiangqi-cloud-rule-unavailable.png' });
    await page.getByTestId('cloud-book-disable').click();
    await ruling.waitFor({ state: 'detached' });
  } finally { await page.close(); }
}

// The y-axis labels are right-aligned inside a fixed gutter, so a label wider
// than the gutter does not wrap or shrink -- it runs off the left of the
// viewBox and SVG clips it. `R+10` and `B+10` lost their first stroke that way
// on every desktop width and read as `Я+10` and `3+10`. Measure the drawn boxes
// rather than the padding constant, so a font or font-size change is caught too.
async function evalGraphAxisLabels(browser, width) {
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  try {
    await page.goto(base + '?moves=h2e2');
    await page.waitForSelector('text.graph-grid-text');
    const labels = await page.evaluate(() => {
      const svg = document.querySelector('text.graph-grid-text').ownerSVGElement;
      const [, , viewWidth] = svg.getAttribute('viewBox').split(' ').map(Number);
      return Array.from(svg.querySelectorAll('text.graph-grid-text')).map(text => {
        const box = text.getBBox();
        return { label: text.textContent, left: box.x, right: box.x + box.width, viewWidth };
      });
    });
    assert.ok(labels.length >= 5, `Expected the eval graph axis labels, saw ${labels.length}`);
    for (const { label, left, right, viewWidth } of labels) {
      assert.ok(left >= 0, `Axis label ${label} is clipped by ${(-left).toFixed(1)}px at the left edge`);
      assert.ok(right <= viewWidth, `Axis label ${label} runs past the right edge`);
    }
  } finally { await page.close(); }
}

// The phone header wraps, and what lands on the second row is decided by the
// order of its children. With the opening name inside the turn info, the name
// kept the first row and pushed the five action buttons onto the second one,
// left-aligned -- the buttons moved on the first move played and never moved
// back. The name belongs on the row of its own instead, so the controls stay
// where they were before the move.
async function mobileHeaderRows(browser, width, height) {
  const page = await browser.newPage({ viewport: { width, height }, isMobile: true, hasTouch: true });
  try {
    await page.goto(base + '?moves=h2e2%20h9g7%20b0c2%20b9c7');
    await page.waitForSelector('.mobile-opening-pill');
    const box = await page.evaluate(() => {
      const rect = selector => {
        const found = document.querySelector(selector);
        const b = found.getBoundingClientRect();
        return { top: b.top, bottom: b.bottom, right: b.right, width: b.width };
      };
      return {
        header: rect('.mobile-board-header'),
        info: rect('.mobile-board-turn-info'),
        actions: rect('.mobile-board-actions'),
        pill: rect('.mobile-opening-pill'),
        pillTruncated: (() => { const p = document.querySelector('.mobile-opening-pill'); return p.scrollWidth > p.clientWidth + 1; })(),
        hscroll: document.documentElement.scrollWidth > innerWidth,
      };
    });
    assert.ok(box.actions.top < box.info.bottom, 'The action buttons dropped below the turn info');
    assert.ok(box.pill.top >= box.actions.bottom - 1, 'The opening name is sharing the row with the buttons');
    assert.ok(box.header.right - box.actions.right < 20, 'The action row is no longer right-aligned');
    assert.equal(box.pillTruncated, false, 'The opening name is truncated on its own row');
    assert.equal(box.hscroll, false, 'The header pushed the page into horizontal scroll');
  } finally { await page.close(); }
}

// The board action menu and its backdrop were positioned at a fixed 56px and
// 40px from the top of the stage -- the header's height when the header is one
// row. It is 57px with an opening name and 73px carrying a request notice, so
// the menu covered the second row, and a "Shared link not loaded" notice was
// hidden by it entirely. Both now take the stage grid's second row, which
// begins wherever the header ends. Check the states that make it wrap.
async function actionMenuClearsHeader(browser, width, height) {
  for (const [state, query, settled] of [
    ['one row', '', '.mobile-board-turn-info'],
    ['an opening name', '?moves=h2e2%20h9g7%20b0c2%20b9c7', '.mobile-opening-pill'],
    ['a request notice', '?moves=h2e2%20zzzz', '.mobile-request-notice'],
  ]) {
    // A page each: the moves one state plays are autosaved, and the recovery
    // offer they raise in the next state covers the header with its backdrop.
    const page = await browser.newPage({ viewport: { width, height }, isMobile: true, hasTouch: true });
    try {
      await page.goto(base + query);
      // The row that makes the header wrap arrives after the first paint, and
      // clicking into a header still reflowing under the cursor is what this
      // waits out -- not the menu itself.
      await page.locator(settled).waitFor();
      await page.getByTestId('mobile-more-actions-btn').click();
      await page.locator('.mobile-board-action-menu').waitFor();
      const box = await page.evaluate(() => {
        const rect = s => document.querySelector(s).getBoundingClientRect();
        const header = rect('.mobile-board-header');
        const menu = rect('.mobile-board-action-menu');
        return {
          gap: menu.top - header.bottom,
          backdropGap: rect('.mobile-board-action-backdrop').top - header.bottom,
          offRight: menu.right - innerWidth,
          offLeft: -menu.left,
        };
      });
      assert.ok(box.gap >= 0, `The action menu covers the header by ${(-box.gap).toFixed(1)}px with ${state} at ${width}px`);
      assert.ok(box.backdropGap >= 0, `The backdrop covers the header by ${(-box.backdropGap).toFixed(1)}px with ${state} at ${width}px`);
      assert.ok(box.offRight <= 0 && box.offLeft <= 0, `The action menu runs off screen with ${state} at ${width}px`);
    } finally { await page.close(); }
  }
}

// `text-overflow: ellipsis` renders only on the box whose own inline content
// overflows. The opening badge is a flex container, so the name inside it is a
// flex item and the badge's ellipsis never applied: the name was cut mid-word
// at the badge's edge, past its right border, with nothing to say there was
// more of it. Assert the drawn name stays inside the badge rather than
// asserting the property, so any future flex/limit change is caught as well.
async function openingBadgeTruncation(browser, width) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  try {
    await page.goto(base + '?moves=h2e2%20h9g7%20b0c2%20b9c7%20b2b6%20a9b9');
    await page.waitForSelector('.opening-badge-name');
    const box = await page.evaluate(() => {
      const badge = document.querySelector('.opening-badge');
      const name = document.querySelector('.opening-badge-name');
      const chinese = document.querySelector('.opening-badge-chinese');
      const b = badge.getBoundingClientRect();
      return {
        overhang: name.getBoundingClientRect().right - b.right,
        chineseOverhang: chinese.getBoundingClientRect().right - b.right,
        chineseWhole: chinese.scrollWidth <= chinese.clientWidth + 1,
        ellipsis: getComputedStyle(name).textOverflow,
        title: badge.getAttribute('title'),
      };
    });
    assert.ok(box.overhang <= 0, `The opening name is cut ${box.overhang.toFixed(1)}px past the badge`);
    assert.ok(box.chineseOverhang <= 0, `The Chinese opening name is cut past the badge`);
    assert.equal(box.chineseWhole, true, 'The Chinese opening name gave way instead of holding its width');
    assert.equal(box.ellipsis, 'ellipsis', 'The opening name truncates without an ellipsis');
    assert.match(box.title || '', /Screen Horse/, 'The badge does not carry the full name for a reader');
  } finally { await page.close(); }
}

// The analysis panel's buttons are sized for a mouse and a phone was handed
// the same 25px. Check both halves of the fix: a finger gets the 44px Apple's
// HIG and WCAG 2.5.5 ask for, and a mouse keeps the dense sizing -- a rule
// that leaked to `pointer: fine` would quietly loosen every desktop panel.
async function analysisTouchTargets(browser) {
  const selectors = ['.engine-cache-btn', '.engine-pv-btn', '.pv-action-btn'];
  const moves = '?moves=h2e2%20h9g7%20b0c2%20b9c7%20b2b6%20a9b9';
  const heights = async (page, open) => {
    await page.goto(base + moves);
    await open(page);
    // `.pv-action-btn` only exists once the engine has returned a line, so wait
    // for each selector rather than assuming they arrive together.
    for (const selector of selectors) await page.locator(selector).first().waitFor();
    return page.evaluate(list => {
      const found = {};
      for (const selector of list) {
        for (const el of document.querySelectorAll(selector)) {
          const box = el.getBoundingClientRect();
          if (box.height > 0) found[selector] = Math.min(found[selector] ?? Infinity, box.height);
        }
      }
      return found;
    }, selectors);
  };

  const touch = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const box = await heights(touch, async page => {
      await page.getByTestId('mobile-view-analysis').click();
      await page.getByTestId('mobile-analysis-tab-engine').click();
    });
    assert.equal(await touch.evaluate(() => matchMedia('(pointer: coarse)').matches), true);
    for (const selector of selectors) {
      assert.ok(box[selector] >= 44, `${selector} is ${box[selector]}px to a finger, under the 44px minimum`);
    }
  } finally { await touch.close(); }

  const mouse = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    const box = await heights(mouse, page => page.getByTestId('analysis-tab-engine').click());
    assert.equal(await mouse.evaluate(() => matchMedia('(pointer: fine)').matches), true);
    for (const selector of selectors) {
      assert.ok(box[selector] < 40, `${selector} grew to ${box[selector]}px on a mouse; the touch rule is leaking`);
    }
  } finally { await mouse.close(); }
}

// A saved game's imported players and event are bounded at 256 characters
// apiece and were laid out in full, so one imported game could stand taller
// than the panel and push every other saved game out of view -- the list stops
// being a list. Both lines are clamped to two rows now, with the rest on a
// title. The *label* is deliberately not clamped: gameLibrary bounds it to 120
// characters at the storage boundary, and test-ui-layout asserts a label that
// long is shown whole. Compare against an ordinary card rather than a pixel
// count, so the check says "cards stay comparable" and survives restyling.
async function libraryCardHeight(browser, width, height, mobile) {
  const page = await browser.newPage({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile });
  try {
    await page.addInitScript(([long, nospace]) => {
      localStorage.setItem('xiangqi:library:v1', JSON.stringify([
        { id: 'long', savedAt: 2, gameMode: 'PvP', moves: ['h2e2'], label: nospace,
          metadata: { redPlayer: long, blackPlayer: nospace, event: long, site: nospace, date: '2026.??.??', round: '1' } },
        { id: 'plain', savedAt: 1, gameMode: 'PvP', moves: ['h2e2'], label: 'Ordinary game',
          metadata: { redPlayer: 'Hu Ronghua', blackPlayer: 'Yang Guanlin', event: 'National Championship', site: 'Beijing', date: '2026.03.01', round: '4' } },
      ]));
      // Within the library's own 120-character label bound, and worded the way
      // a real long label is, so the card measured here is one the app can
      // actually hold rather than an unreachable worst case.
    }, ['Wang '.repeat(52).slice(0, 256), 'Long saved game label '.repeat(5).slice(0, 120)]);
    await page.goto(base + '?moves=h2e2');
    if (mobile) {
      await page.getByTestId('mobile-view-analysis').click();
      await page.getByTestId('mobile-analysis-tab-library').click();
    } else {
      await page.getByTestId('left-panel-tab-library').click();
    }
    await page.getByTestId('metadata-saved-plain').waitFor();
    const box = await page.evaluate(() => {
      const card = id => document.querySelector(`[data-testid="metadata-saved-${id}"]`).closest('.lib-card').getBoundingClientRect().height;
      const label = document.querySelector('.lib-game-name-button');
      const line = document.querySelector('.lib-detail-line');
      return {
        long: card('long'), plain: card('plain'),
        labelWhole: label.scrollHeight <= label.clientHeight + 1,
        lineClamped: line.scrollHeight > line.clientHeight + 1,
        lineTitled: !!line.getAttribute('title'),
        hscroll: document.documentElement.scrollWidth > innerWidth,
      };
    });
    const ratio = box.long / box.plain;
    assert.ok(ratio < 1.6, `A long-metadata card is ${ratio.toFixed(1)}x an ordinary one at ${width}px; it is not clamped`);
    assert.equal(box.labelWhole, true, 'The saved-game label is being clipped; it is bounded at 120 characters and meant to be read whole');
    assert.equal(box.lineClamped, true, 'The players line is not clamped');
    assert.equal(box.lineTitled, true, 'The clamped players line does not carry the full text on a title');
    assert.equal(box.hscroll, false, 'A long label pushed the page into horizontal scroll');
  } finally { await page.close(); }
}

// A palette row is a command name beside its description. Both entered flex
// layout at their full text widths, so a row that overflowed by a hair shrank
// both -- leaving the name a fraction of a pixel under what its own text needs
// and wrapping it. "Write a note on this move" stood 63px tall in a list of
// 39px rows while its one-line description sat beside it. The description now
// asks for none of the row and grows into what the name leaves.
async function commandPaletteRows(browser, width, height, mobile) {
  const page = await browser.newPage({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile });
  try {
    await page.goto(base + '?moves=h2e2%20h9g7%20b0c2%20b9c7');
    await page.locator('.xiangqi-board').waitFor();
    await page.keyboard.press('Control+k');
    await page.locator('.command-palette-button').first().waitFor();
    const rows = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('.command-palette-button')];
      const truncated = [...document.querySelectorAll('.command-palette-label')]
        .filter(label => label.scrollWidth > label.clientWidth + 1)
        .map(label => label.textContent.trim());
      return {
        count: buttons.length,
        heights: [...new Set(buttons.map(b => Math.round(b.getBoundingClientRect().height)))],
        truncated,
      };
    });
    assert.ok(rows.count > 20, `Expected the palette's commands, saw ${rows.count}`);
    assert.deepEqual(rows.heights.length, 1,
      `Palette rows are ${rows.heights.sort((a, b) => a - b).join('/')}px at ${width}px; a command name is wrapping beside a one-line description`);
    // A name is what the list is read for -- it wraps when a row genuinely
    // cannot hold it, but it is never cut off.
    assert.deepEqual(rows.truncated, [], `Palette command names are truncated at ${width}px`);
  } finally { await page.close(); }
}

// A reviewed move is marked in the tree by a 5px disc whose only difference
// between the grades is its background colour, so forced colours left every
// reviewed move looking the same -- and unlike the review panel's chips the
// disc has no label beside it. Under forced colours the three grades worth
// answering for carry the glyph this app's PGN export already writes.
//
// The markup is built here rather than driven through a real review: what can
// regress is the stylesheet, and a full engine review costs a minute for the
// same three declarations. That the classes reach real moves is covered by
// MoveListTreeQuality.test.tsx, and the structure below mirrors the tree's.
async function reviewGradesUnderForcedColors(browser) {
  const build = () => {
    const host = document.createElement('div');
    host.id = 'qa-quality-probe';
    for (const grade of ['best', 'good', 'inaccuracy', 'mistake', 'blunder']) {
      const row = document.createElement('span');
      row.className = `quality-${grade}`;
      const dot = document.createElement('span');
      dot.className = 'mtree-quality-dot';
      row.appendChild(dot);
      host.appendChild(row);
    }
    document.querySelector('.app-shell').appendChild(host);
    const read = {};
    for (const row of host.children) {
      const grade = row.className.replace('quality-', '');
      read[grade] = getComputedStyle(row.firstChild, '::after').content;
    }
    host.remove();
    return read;
  };

  const forced = await browser.newPage({ viewport: { width: 1440, height: 900 }, forcedColors: 'active' });
  try {
    await forced.goto(base + '?moves=h2e2');
    await forced.locator('.app-shell').waitFor();
    assert.equal(await forced.evaluate(() => matchMedia('(forced-colors: active)').matches), true);
    const marks = await forced.evaluate(build);
    assert.match(marks.inaccuracy, /\?!/, `An inaccuracy is marked ${marks.inaccuracy} under forced colours`);
    assert.match(marks.mistake, /"\?"/, `A mistake is marked ${marks.mistake} under forced colours`);
    assert.match(marks.blunder, /\?\?/, `A blunder is marked ${marks.blunder} under forced colours`);
    const distinct = new Set([marks.inaccuracy, marks.mistake, marks.blunder, marks.best]);
    assert.equal(distinct.size, 4, `Review grades are not told apart under forced colours: ${JSON.stringify(marks)}`);
  } finally { await forced.close(); }

  // And nothing changes for everyone else: the glyphs are a forced-colours
  // fallback, not a new mark on the default board.
  const plain = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await plain.goto(base + '?moves=h2e2');
    await plain.locator('.app-shell').waitFor();
    const marks = await plain.evaluate(build);
    for (const [grade, content] of Object.entries(marks)) {
      assert.equal(content, 'none', `A ${grade} move grew a ${content} glyph outside forced colours`);
    }
  } finally { await plain.close(); }
}

// The six AI strength rungs took an equal share of their row whatever their
// labels weigh -- a zero flex basis, with a min-width that let the share fall
// under the label and `white-space: nowrap` to push the excess out of the
// button. "Full strength" was cut at every width, and at 320px so were
// Beginner, Medium and Master. They size from their text now and the row wraps.
async function strengthRungLabels(browser, width, height, mobile) {
  const page = await browser.newPage({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile });
  try {
    await page.goto(base);
    await page.getByRole('button', { name: mobile ? /Open new game menu/i : /Start new game/i }).first().click();
    await page.getByRole('button', { name: /You play Red/i }).click();
    await page.locator('.new-game-strength-pills .new-game-strength-btn').first().waitFor();
    const row = await page.evaluate(() => {
      const chips = [...document.querySelectorAll('.new-game-strength-pills .new-game-strength-btn')];
      const list = document.querySelector('.new-game-strength-pills');
      return {
        count: chips.length,
        cut: chips.filter(c => c.scrollWidth > c.clientWidth + 1)
          .map(c => `${c.textContent.trim()} (needs ${c.scrollWidth}px, has ${c.clientWidth}px)`),
        overflow: list.scrollWidth - list.clientWidth,
      };
    });
    assert.equal(row.count, 6, `Expected six strength rungs, saw ${row.count}`);
    assert.deepEqual(row.cut, [], `Strength labels are cut off at ${width}px`);
    assert.ok(row.overflow <= 1, `The strength row overflows by ${row.overflow}px at ${width}px`);
  } finally { await page.close(); }
}

// The undo toast was held off the bottom of the window by a flat 76px, which
// is the height of neither thing it has to clear: it sat 47px over the desktop
// bottom bar, covering New Game, Save and Copy PGN for the ten seconds the
// Undo is offered, and it cleared the phone's tab bar by 20px only while the
// safe-area inset is zero. It is positioned inside the workspace now, whose
// bottom edge is where that chrome begins on both.
async function undoToastClearsChrome(browser, width, height, mobile) {
  const page = await browser.newPage({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile });
  try {
    await page.goto(base + '?moves=h2e2%20h9g7%20b0c2');
    // The board is on screen in both layouts; the move tree is not -- a phone
    // opens on the board view and keeps the tree behind the Analysis tab.
    await page.locator('.xiangqi-board').waitFor();
    await page.keyboard.press('Control+k');
    await page.locator('.command-palette-button').first().waitFor();
    await page.keyboard.type('Delete this move');
    await page.keyboard.press('Enter');
    const toast = page.getByTestId('delete-undo-toast');
    await toast.waitFor();
    const box = await page.evaluate(() => {
      const t = document.querySelector('.undo-toast').getBoundingClientRect();
      // whichever bottom chrome this layout has
      const bar = document.querySelector('.mobile-tab-bar')?.getBoundingClientRect()
        ?? document.querySelector('.panel.bottom')?.getBoundingClientRect();
      const undo = document.querySelector('[data-testid="delete-undo-btn"]').getBoundingClientRect();
      const onTop = document.elementFromPoint(undo.left + undo.width / 2, undo.top + undo.height / 2);
      return {
        gap: bar ? bar.top - t.bottom : null,
        offScreen: t.bottom - innerHeight,
        undoReachable: !!onTop?.closest('[data-testid="delete-undo-btn"]'),
      };
    });
    assert.ok(box.gap !== null, 'Found no bottom chrome to measure the toast against');
    assert.ok(box.gap >= 0, `The undo toast covers the bottom chrome by ${(-box.gap).toFixed(0)}px at ${width}x${height}`);
    assert.ok(box.offScreen <= 0, `The undo toast runs off the bottom at ${width}x${height}`);
    assert.equal(box.undoReachable, true, `Nothing is on top of the Undo button at ${width}x${height}`);
  } finally { await page.close(); }
}

// A short desktop window is wide and short the way a landscape phone is, and
// the stacked dock answers it the way a portrait phone is answered: the board
// is sized by the height the dock leaves, so at 1440x700 it came out 330px
// with 470px of the stage empty beside it. Below 700px tall the dock moves to
// the board's side, as the landscape-phone rule does under 900px wide. Check
// both sides of the threshold, so the rule cannot quietly widen to every
// desktop height -- or to a window too narrow to pay for a side rail, where it
// costs the board more than the stacked dock does (283px against 188px at
// 1024x600).
async function shortDesktopDock(browser, width, height, expected) {
  const page = await browser.newPage({ viewport: { width, height } });
  try {
    await page.goto(base + '?moves=h2e2%20b9c7%20e2e6%20c7e6');
    await page.getByTestId('start-engine-analysis').click();
    await page.locator('.position-dock').waitFor();
    const box = await page.evaluate(() => {
      const rectOf = s => document.querySelector(s).getBoundingClientRect();
      const board = rectOf('.xiangqi-board');
      const dock = rectOf('.position-dock');
      const stage = document.querySelector('.board-stage');
      // The stage is allowed to scroll -- that is where a floored board's
      // overflow goes, by design. What must hold is that the board never paints
      // over the dock, and that every rank stays reachable by scrolling.
      stage.scrollTop = 0;
      const top = rectOf('.xiangqi-board').top >= -1;
      stage.scrollTop = stage.scrollHeight;
      const bottom = rectOf('.xiangqi-board').bottom <= innerHeight + 1;
      stage.scrollTop = 0;
      return {
        beside: dock.left >= board.right - 1,
        below: dock.top >= board.bottom - 1,
        boardWidth: board.width,
        ratio: board.width / board.height,
        overlapsDock: Math.min(board.bottom, dock.bottom) - Math.max(board.top, dock.top) > 1
          && Math.min(board.right, dock.right) - Math.max(board.left, dock.left) > 1,
        reachable: top && bottom,
        hscroll: document.documentElement.scrollWidth > innerWidth,
      };
    });
    assert.equal(box[expected], true,
      `At ${width}x${height} the dock is not ${expected} the board (beside=${box.beside} below=${box.below})`);
    assert.equal(box.overlapsDock, false, `The board paints over the dock at ${width}x${height}`);
    assert.equal(box.reachable, true, `A rank of the board is unreachable at ${width}x${height}`);
    assert.ok(Math.abs(box.ratio - 0.9) < 0.02, `The board is not 9:10 at ${width}x${height}: ${box.ratio.toFixed(3)}`);
    assert.equal(box.hscroll, false, `The stage pushed the page into horizontal scroll at ${width}x${height}`);
    if (expected === 'beside') {
      assert.ok(box.boardWidth > 340, `The side dock did not buy the board room: ${box.boardWidth.toFixed(0)}px at ${width}x${height}`);
    }
  } finally { await page.close(); }
}

// `shortDesktopDock` asks whether the board's box fits the *window*, and that
// is not the same question as whether a rank can be played. The chrome that
// covers the board is drawn over the stage rather than beside it, so a board
// hanging out through the bottom of the stage still measured `bottom <=
// innerHeight` while the bottom bar sat on top of Red's back rank. Ask the
// board itself instead: every intersection has a hitbox, so hit-test each one
// and require the board to answer. The board is 9x10, so 90 is the whole of it,
// and the sweep runs at the scroll position the reader lands on, which is where
// a game is played.
async function everyIntersectionReachable(browser, width, height, note) {
  const page = await browser.newPage({ viewport: { width, height } });
  try {
    await page.goto(base + '?moves=h2e2%20b9c7%20e2e6%20c7e6');
    await page.getByTestId('start-engine-analysis').click();
    await page.locator('.hitboxes-layer').waitFor();
    const covered = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('.hitboxes-layer .hitbox')) {
        const r = el.getBoundingClientRect();
        if (!r.width) continue;
        const x = Math.round(r.x + r.width / 2);
        const y = Math.round(r.y + r.height / 2);
        const hit = (x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight)
          ? document.elementFromPoint(x, y)
          : null;
        if (hit && hit.closest('.xiangqi-board')) continue;
        const on = hit ? (hit.className.baseVal ?? hit.className).toString().trim() : 'off screen';
        out.push(`${el.getAttribute('aria-label') || `${x},${y}`} -> ${on || hit.tagName}`);
      }
      return out;
    });
    assert.deepEqual(covered, [],
      `${covered.length} board intersections are covered at ${width}x${height} (${note}): ${covered.slice(0, 4).join('; ')}`);
    assert.equal(await page.locator('.hitboxes-layer .hitbox').count(), 90,
      'The sweep did not see all 9x10 intersections');
  } finally { await page.close(); }
}

// The eval bar is absolutely positioned beside the board, on the stated
// assumption that it "lives in the stage padding beside the board, which is
// empty at every viewport this renders at". That holds only while the board is
// narrower than its stage. Once the board fills the column the bar is drawn
// outside the stage, which clips its overflow and lets the left panel's resize
// handle paint over it -- 19px of its 22px past the stage's edge at 901x900,
// still 6px at 1024x768. Measure the bar against the stage rather than against
// the board: it is the board it is aligned to and the stage it has to fit.
async function evalBarFitsBesideTheBoard(browser, width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  try {
    await page.goto(base + '?moves=h2e2%20b9c7%20e2e6%20c7e6');
    await page.getByTestId('start-engine-analysis').click();
    await page.locator('.eval-bar').waitFor();
    const box = await page.evaluate(() => {
      const bar = document.querySelector('.eval-bar').getBoundingClientRect();
      const stage = document.querySelector('.board-stage').getBoundingClientRect();
      const board = document.querySelector('.xiangqi-board').getBoundingClientRect();
      const centre = document.elementFromPoint(
        Math.round(bar.x + bar.width / 2),
        Math.round(bar.y + bar.height / 2),
      );
      return {
        insideStage: bar.left >= stage.left - 0.5 && bar.right <= stage.right + 0.5,
        outside: Math.round(stage.left - bar.left),
        besideBoard: bar.right <= board.left + 0.5,
        matchesBoardHeight: Math.abs(bar.height - board.height) < 2,
        // Nothing of the surrounding chrome may be on top of it. The stage's own
        // boxes are fine -- the bar is inside them.
        coveredBy: centre && !centre.closest('.board-stage')
          ? (centre.className.baseVal ?? centre.className).toString().trim()
          : null,
      };
    });
    assert.equal(box.insideStage, true,
      `The eval bar is drawn ${box.outside}px outside the board stage at ${width}x${height}`);
    assert.equal(box.besideBoard, true, `The eval bar overlaps the board at ${width}x${height}`);
    assert.equal(box.matchesBoardHeight, true,
      `The eval bar is not the board's height at ${width}x${height}`);
    assert.equal(box.coveredBy, null,
      `The eval bar is covered by ${box.coveredBy} at ${width}x${height}`);
  } finally { await page.close(); }
}

// `.panel.left` falls back to 320px until the app sets `--left-panel-w`, and
// `.panel` transitions its width, so whatever width the window actually calls
// for used to arrive as a 220ms slide on every load -- 320 to 266 at 1024, on
// both panels at once, measured with a `transitionstart` listener ~790ms in.
// A width transition is for a reader dragging a panel; the first paint should
// already be right. Assert both halves: nothing animates on load, and a
// deliberate collapse afterwards still does.
async function panelsDoNotAnimateOnLoad(browser, width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  try {
    await page.addInitScript(() => {
      window.__panelTransitions = [];
      document.addEventListener('transitionstart', event => {
        const target = event.target;
        if (target instanceof Element && target.classList.contains('panel')) {
          window.__panelTransitions.push(`${target.className} ${event.propertyName}`);
        }
      }, true);
    });
    await page.goto(base + '?moves=h2e2%20b9c7%20e2e6%20c7e6');
    await page.getByTestId('start-engine-analysis').click();
    await page.locator('.xiangqi-board').waitFor();
    // Tolerant on purpose: against the unfixed code the attribute never appears,
    // and the point of this check is to report the animation it was added to
    // stop, not to time out on a missing attribute.
    await page.waitForFunction(
      () => document.documentElement.hasAttribute('data-panels-ready'),
      null,
      { timeout: 4000 },
    ).catch(() => {});
    await page.waitForTimeout(900);
    const onLoad = await page.evaluate(() => window.__panelTransitions.slice());
    assert.deepEqual(onLoad, [],
      `A panel animated on load at ${width}x${height}: ${onLoad.join(', ')}`);

    await page.evaluate(() => { window.__panelTransitions.length = 0; });
    await page.getByTestId('left-panel-resize-handle').focus();
    await page.keyboard.press('Home');
    // Wait for the event rather than for a delay: the React update that starts
    // the transition is not instant, and a flat wait raced it in both
    // directions -- once reporting no animation, once measuring the grip three
    // quarters of the way through its own.
    await page.waitForFunction(
      () => window.__panelTransitions.some(entry => entry.endsWith('width')),
      null,
      { timeout: 5000 },
    ).catch(() => {
      throw new assert.AssertionError({
        message: `Collapsing a panel by hand no longer animates at ${width}x${height}`,
        actual: 'no width transition within 5s', expected: 'a width transition', operator: '===',
      });
    });

    // And the grip that is now the only way back says so, and is big enough to
    // find: 3x32px in 15% grey was a scratch on the window edge. Wait for the
    // pill to finish growing rather than for a fixed delay -- it transitions
    // over 200ms and the React update that starts it is not instant, so a flat
    // wait measured it three quarters of the way there.
    await page.waitForFunction(() => {
      const pill = document.querySelector('[data-testid="left-panel-resize-handle"] .resize-pill');
      return pill && pill.getBoundingClientRect().height >= 46;
    });
    const grip = await page.evaluate(() => {
      const handle = document.querySelector('[data-testid="left-panel-resize-handle"]');
      const pill = handle.querySelector('.resize-pill').getBoundingClientRect();
      const box = handle.getBoundingClientRect();
      const at = document.elementFromPoint(
        Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2));
      return {
        collapsed: handle.getAttribute('data-collapsed'),
        area: Math.round(pill.width * pill.height),
        reachable: at === handle || handle.contains(at),
        name: handle.getAttribute('aria-label'),
      };
    });
    assert.equal(grip.collapsed, 'true', `The grip does not report its state at ${width}x${height}`);
    assert.ok(grip.area >= 180, `The collapsed grip is too faint to find: ${grip.area}px2`);
    assert.equal(grip.reachable, true, `Something covers the collapsed grip at ${width}x${height}`);
    assert.match(grip.name, /expand/i, 'The collapsed grip does not say what it does');
  } finally { await page.close(); }
}

// The side panels are dragged to whatever width the reader wants and neither
// of them knows the board has a floor. The stage between them is a flex item
// with `min-width: 0`, so it was squeezed to a sliver while the floor held the
// board at 272px inside it, and the excess went sideways -- the one direction
// `overflow-x: hidden` cannot recover. Both panels at maximum: 20 of the 90
// intersections covered at 1440x900, 80 at 1280x800 and all 90 at 1024x768,
// the board entirely behind the panels. Drive it with the keyboard rather than
// a synthetic drag, because that is also the path a keyboard user takes.
async function panelsCannotEraseTheBoard(browser, width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  try {
    await page.goto(base + '?moves=h2e2%20b9c7%20e2e6%20c7e6');
    await page.getByTestId('start-engine-analysis').click();
    await page.locator('.xiangqi-board').waitFor();
    for (const [handle, key] of [
      ['left-panel-resize-handle', 'ArrowRight'],
      ['right-panel-resize-handle', 'ArrowLeft'],
    ]) {
      await page.getByTestId(handle).focus();
      // Comfortably more presses than PANEL_MAX_WIDTH / PANEL_KEYBOARD_STEP.
      for (let i = 0; i < 40; i += 1) await page.keyboard.press(key);
    }
    await page.waitForTimeout(400);
    const box = await page.evaluate(() => {
      const board = document.querySelector('.xiangqi-board').getBoundingClientRect();
      const stage = document.querySelector('.board-stage').getBoundingClientRect();
      const covered = [];
      for (const el of document.querySelectorAll('.hitboxes-layer .hitbox')) {
        const r = el.getBoundingClientRect();
        if (!r.width) continue;
        const x = Math.round(r.x + r.width / 2);
        const y = Math.round(r.y + r.height / 2);
        const hit = (x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight)
          ? document.elementFromPoint(x, y)
          : null;
        if (!hit || !hit.closest('.xiangqi-board')) covered.push(el.getAttribute('aria-label'));
      }
      return {
        covered: covered.length,
        inside: board.left >= stage.left - 1 && board.right <= stage.right + 1,
        boardWidth: Math.round(board.width),
        ratio: board.width / board.height,
      };
    });
    assert.equal(box.covered, 0,
      `${box.covered} intersections are behind the panels at ${width}x${height} with both dragged out`);
    assert.equal(box.inside, true,
      `The board overhangs its stage at ${width}x${height} with both panels dragged out`);
    assert.ok(Math.abs(box.ratio - 0.9) < 0.02,
      `The board is not 9:10 at ${width}x${height} with both panels dragged out`);
    // The floor is what it is allowed to shrink to, not a size it may go under.
    assert.ok(box.boardWidth >= 270,
      `The board fell under its floor at ${width}x${height}: ${box.boardWidth}px`);
  } finally { await page.close(); }
}

// The board is derived from its row's height, which is only safe while the
// column is wider than 0.9 of that row. On a narrow, tall desktop window it is
// not: at 901x900 the board came out 515px wide in a 433px stage and painted
// over both side panels, twenty of the ninety intersections answering a panel
// rather than the board. It held from 901 through about 1150 and came right on
// its own only where the stage finally outgrew the board, which is why every
// viewport the suite already checked missed it -- they are all wide.
//
// Two assertions, because either alone passes the bug in some form: the board
// has to stay inside the stage it is centred in, and it has to keep 9:10 while
// doing it. Clamping the width without re-deriving the height satisfies the
// first by distorting the board, which is the trap the fix had to avoid.
async function boardFitsItsColumn(browser, width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  try {
    await page.goto(base + '?moves=h2e2%20b9c7%20e2e6%20c7e6');
    await page.getByTestId('start-engine-analysis').click();
    await page.locator('.xiangqi-board').waitFor();
    const box = await page.evaluate(() => {
      const board = document.querySelector('.xiangqi-board').getBoundingClientRect();
      const stage = document.querySelector('.board-stage').getBoundingClientRect();
      const covered = [];
      for (const el of document.querySelectorAll('.hitboxes-layer .hitbox')) {
        const r = el.getBoundingClientRect();
        if (!r.width) continue;
        const x = Math.round(r.x + r.width / 2);
        const y = Math.round(r.y + r.height / 2);
        const hit = (x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight)
          ? document.elementFromPoint(x, y)
          : null;
        if (!hit || !hit.closest('.xiangqi-board')) covered.push(el.getAttribute('aria-label'));
      }
      return {
        inside: board.left >= stage.left - 1 && board.right <= stage.right + 1,
        ratio: board.width / board.height,
        overhang: Math.round(Math.max(stage.left - board.left, board.right - stage.right)),
        covered: covered.length,
      };
    });
    assert.equal(box.inside, true,
      `The board overhangs its stage by ${box.overhang}px at ${width}x${height}`);
    assert.ok(Math.abs(box.ratio - 0.9) < 0.02,
      `The board is not 9:10 at ${width}x${height}: ${box.ratio.toFixed(3)}`);
    assert.equal(box.covered, 0,
      `${box.covered} board intersections are covered at ${width}x${height}`);
  } finally { await page.close(); }
}

// Every safe-area rule in this stylesheet has been argued rather than measured
// -- the audit that added the last one said so -- because a display cutout is a
// device property and the harness had no way to produce one. It does:
// `Emulation.setSafeAreaInsetsOverride` makes `env(safe-area-inset-*)` report
// whatever is asked for, so the insets can be turned on and the app measured
// under them like any other layout.
//
// What that found: on a phone the board stage is the topmost content -- the
// toolbar carrying the left/right insets is the desktop one, hidden here -- so
// nothing cleared the cutout. In landscape at 59px/34px the turn readout
// started under it, the last move-nav button ended under it, and the analysis
// view's first and last tabs sat under both. Asymmetric on purpose: a cutout is
// on one side, and a rule that reads only one inset passes a symmetric test.
async function cutoutClearance(browser, width, height, view) {
  const insets = { left: 59, right: 34, top: 0, bottom: 21 };
  const page = await browser.newPage({ viewport: { width, height }, hasTouch: true });
  try {
    const cdp = await page.context().newCDPSession(page);
    await page.goto(base + '?moves=h2e2%20b9c7');
    await page.locator('.mobile-tab-bar').waitFor();
    if (view === 'analysis') {
      await page.getByTestId('mobile-view-analysis').click();
      await page.locator('.mobile-analysis-tabs').waitFor();
    }
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets });
    // The override is asynchronous in the renderer, so wait for it to land
    // rather than for a fixed delay -- and this doubles as the check that the
    // emulation did anything at all.
    await page.waitForFunction(
      left => getComputedStyle(document.querySelector('.mobile-tab-bar')).paddingLeft === `${left}px`,
      insets.left,
    );
    const covered = await page.evaluate(inset => {
      const out = [];
      const selector = 'button, input, select, a, [role="tab"], .mobile-turn-label, .mobile-eval-chip, .position-stat';
      for (const el of document.querySelectorAll(selector)) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        if (getComputedStyle(el).visibility === 'hidden') continue;
        if (r.left >= inset.left - 0.5 && r.right <= innerWidth - inset.right + 0.5) continue;
        const name = el.getAttribute('data-testid') || el.getAttribute('aria-label')
          || (el.textContent || '').trim() || el.className.toString();
        out.push(`${name.slice(0, 30)} [${Math.round(r.left)},${Math.round(r.right)}]`);
      }
      return out;
    }, insets);
    assert.deepEqual(covered, [],
      `${covered.length} controls sit under the display cutout at ${width}x${height} (${view}): ${covered.slice(0, 4).join('; ')}`);
  } finally { await page.close(); }
}

// A landscape phone is short and wide, and the move nav spent the scarce axis:
// a full-width bar under the board, 38px plus a 12px gap, while 375px of the
// stage sat empty beside the board and its status column. It first rode the
// header's row; since d83b312 the header, status cards and nav stack in a
// column of their own beside the board, which gives the board the full height. Check the board actually got the height -- against the same board in
// portrait at the same area, which is the only figure that cannot drift with the
// rest of the layout -- and that the action menu followed the buttons it hangs
// off, which moved with the header into a column of their own.
async function landscapeNavRidesHeader(browser, width, height) {
  const page = await browser.newPage({ viewport: { width, height }, hasTouch: true });
  try {
    await page.goto(base + '?moves=h2e2%20b9c7%20e2e6%20c7e6');
    await page.getByTestId('start-engine-analysis').click();
    await page.locator('.mobile-board-nav').waitFor();
    await page.getByTestId('mobile-more-actions-btn').click();
    await page.locator('.mobile-board-action-menu').waitFor();
    const box = await page.evaluate(() => {
      const r = s => document.querySelector(s).getBoundingClientRect();
      const header = r('.mobile-board-header');
      const nav = r('.mobile-board-nav');
      const board = r('.xiangqi-board');
      const menu = r('.mobile-board-action-menu');
      return {
        headerTop: header.top,
        navInHeaderColumn: Math.abs(nav.left - header.left) < 4 && nav.top >= header.bottom - 1,
        boardBeside: board.right <= Math.min(header.left, nav.left) + 1,
        boardHeight: board.height,
        menuFollowsButtons: Math.abs(menu.right - header.right) < 2,
        menuBelowHeader: menu.top >= header.bottom - 1,
        menuOnScreen: menu.left >= 0 && menu.right <= innerWidth && menu.bottom <= innerHeight,
        hscroll: document.documentElement.scrollWidth > innerWidth,
      };
    });
    assert.equal(box.navInHeaderColumn, true, `The move nav is not in the header's column at ${width}x${height}`);
    assert.equal(box.boardBeside, true, `The board runs under the header column at ${width}x${height}`);
    assert.equal(box.menuFollowsButtons, true,
      `The action menu did not follow the header's right edge at ${width}x${height}`);
    assert.equal(box.menuBelowHeader, true, `The action menu covers the header at ${width}x${height}`);
    assert.equal(box.menuOnScreen, true, `The action menu runs off screen at ${width}x${height}`);
    // Comfortable targets and enlarged labels can make this menu scroll.
    // Reveal each action before checking whether it can actually be reached.
    for (const item of await page.locator('.mobile-action-menu-btn').all()) {
      await item.scrollIntoViewIfNeeded();
      assert.equal(await item.evaluate(node => {
        const rect = node.getBoundingClientRect();
        return node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
      }), true, `An action menu item is covered at ${width}x${height}: ${await item.textContent()}`);
    }
    const headerTop = await page.locator('.mobile-board-header').evaluate(node => node.getBoundingClientRect().top);
    assert.ok(Math.abs(headerTop - box.headerTop) < 1, `Scrolling actions displaced the header at ${width}x${height}`);
    assert.equal(box.hscroll, false, `The landscape stage scrolls sideways at ${width}x${height}`);
    // The nav's own bar was 38px plus a 12px gap. Anything less than most of it
    // back means the row it left is being spent somewhere else again.
    const floor = height >= 390 ? 270 : 200;
    assert.ok(box.boardHeight >= floor,
      `The board did not take the row the nav left at ${width}x${height}: ${box.boardHeight.toFixed(0)}px < ${floor}px`);
  } finally { await page.close(); }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    // The narrow-and-tall desktop band, both edges and the middle, plus one
    // width past it that was always correct.
    // The band where the board fills its stage, so the bar has only the stage's
    // own padding to stand in, and one width past it where it never did.
    await panelsDoNotAnimateOnLoad(browser, 1024, 768);
    await panelsDoNotAnimateOnLoad(browser, 1440, 900);
    await panelsCannotEraseTheBoard(browser, 1440, 900);
    await panelsCannotEraseTheBoard(browser, 1280, 800);
    await panelsCannotEraseTheBoard(browser, 1024, 768);
    await panelsCannotEraseTheBoard(browser, 901, 900);
    await evalBarFitsBesideTheBoard(browser, 901, 900);
    await evalBarFitsBesideTheBoard(browser, 1024, 768);
    await evalBarFitsBesideTheBoard(browser, 1200, 900);
    await evalBarFitsBesideTheBoard(browser, 1440, 900);
    await boardFitsItsColumn(browser, 901, 900);
    await boardFitsItsColumn(browser, 1000, 900);
    await boardFitsItsColumn(browser, 1100, 900);
    await boardFitsItsColumn(browser, 1200, 900);
    // The same question on a landscape phone, where the answer is the dock rail
    // rather than a side panel. Sizing the board from the row alone was enough
    // while a full-width move nav kept the row short; with the nav on the
    // header's row it is not, and 480x400 and 600x500 drew a board that was not
    // 9:10 at all. 320 and 390px handsets never reach that height, which is why
    // the landscape checks below do not catch it.
    await boardFitsItsColumn(browser, 480, 400);
    await boardFitsItsColumn(browser, 600, 500);
    await boardFitsItsColumn(browser, 540, 450);
    await cutoutClearance(browser, 844, 390, 'board');
    await cutoutClearance(browser, 844, 390, 'analysis');
    await cutoutClearance(browser, 390, 844, 'board');
    await landscapeNavRidesHeader(browser, 844, 390);
    await landscapeNavRidesHeader(browser, 667, 375);
    // Before the side rail's height bound: 9 covered at 1440x650 and 45 at
    // 1920x650 -- the rule capped `.board-wrap` and left the container inside
    // it at its own 9:10, so the board grew with the window's width while its
    // height stayed the window's. Both sides of each threshold are checked, so
    // the bound cannot come back off, and the phone layouts are here because
    // this is the sweep the whole board should pass everywhere.
    await everyIntersectionReachable(browser, 1440, 650, 'dock beside, shortest');
    await everyIntersectionReachable(browser, 1440, 700, 'dock beside, at the threshold');
    await everyIntersectionReachable(browser, 1280, 660, 'dock beside, narrowest');
    await everyIntersectionReachable(browser, 1920, 650, 'dock beside, wide');
    await everyIntersectionReachable(browser, 1440, 900, 'dock below');
    await everyIntersectionReachable(browser, 390, 844, 'phone, portrait');
    await everyIntersectionReachable(browser, 844, 390, 'phone, landscape');
    await shortDesktopDock(browser, 1440, 650, 'beside');
    await shortDesktopDock(browser, 1440, 800, 'below');   // too tall to need it
    await shortDesktopDock(browser, 1100, 650, 'below');   // too narrow to pay for it
    await undoToastClearsChrome(browser, 1440, 900, false);
    await undoToastClearsChrome(browser, 390, 844, true);
    await strengthRungLabels(browser, 1440, 900, false);
    await strengthRungLabels(browser, 390, 844, true);
    await strengthRungLabels(browser, 320, 568, true);
    await reviewGradesUnderForcedColors(browser);
    await commandPaletteRows(browser, 1440, 900, false);
    await commandPaletteRows(browser, 390, 844, true);
    await libraryCardHeight(browser, 1440, 900, false);
    await libraryCardHeight(browser, 390, 844, true);
    await analysisTouchTargets(browser);
    await openingBadgeTruncation(browser, 1440);
    await openingBadgeTruncation(browser, 1280);
    await fullLibrary(browser, 1440);
    await fullLibrary(browser, 390);
    await fenValidation(browser);
    await evalGraphAxisLabels(browser, 1440);
    await evalGraphAxisLabels(browser, 1100);
    await mobileHeaderRows(browser, 390, 844);
    await mobileHeaderRows(browser, 320, 568);
    await actionMenuClearsHeader(browser, 390, 844);
    await actionMenuClearsHeader(browser, 320, 568);
    await cloudRuleFreshness(browser);
    console.log('PASS: the panels do not animate to their opening width on load and a collapsed grip is findable, dragging both panels out cannot erase the board, the eval bar stays inside the stage beside the board, the board fits its column on a narrow tall desktop and a tall landscape phone, nothing sits under a display cutout on a phone, a landscape phone puts the move nav on the header row and the board takes the height, every board intersection is reachable at seven viewports, current cloud verdicts and failures, FEN validity, full-library save preserves all games, eval-graph axis labels are drawn whole, the phone header keeps its buttons on the turn row and its action menu clears it, the opening badge truncates inside itself, analysis buttons are 44px to a finger and dense to a mouse, a long-metadata library card stays comparable to an ordinary one, palette rows are one height, review grades survive forced colours, every AI strength rung is legible, the undo toast clears the bottom chrome, a short desktop window docks beside the board; desktop/mobile feedback and library action');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
