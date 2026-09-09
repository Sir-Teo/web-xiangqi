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

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
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
    console.log('PASS: current cloud verdicts and failures, FEN validity, full-library save preserves all games, eval-graph axis labels are drawn whole, the phone header keeps its buttons on the turn row and its action menu clears it, the opening badge truncates inside itself, analysis buttons are 44px to a finger and dense to a mouse; desktop/mobile feedback and library action');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
