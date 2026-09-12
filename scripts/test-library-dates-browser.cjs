const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5200/web-xiangqi/';
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
(async () => {
  const browser = await browserType.launch();
  try {
    for (const [locale, timezoneId, width, height] of [['en-US', 'America/New_York', 1440, 900], ['zh-CN', 'Asia/Shanghai', 390, 844], ['en-GB', 'Europe/London', 320, 640]]) {
      // Playwright owns explicitly configured emulation, so reserve one default
      // Chromium context for changing host defaults through our own CDP session.
      const liveDefaults = browserType.name() === 'chromium' && width === 1440;
      const page = await browser.newPage({ ...(!liveDefaults ? { locale, timezoneId } : {}), viewport: { width, height }, hasTouch: width < 900 });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        let cdp;
        if (liveDefaults) {
          cdp = await page.context().newCDPSession(page);
          await cdp.send('Emulation.setTimezoneOverride', { timezoneId: 'UTC' });
          await cdp.send('Emulation.setLocaleOverride', { locale: 'en_US' });
        }
        await page.addInitScript(() => {
          const games = Array.from({ length: 400 }, (_, i) => ({ id: 'dates-' + i, savedAt: Date.UTC(2026, 2, 8, 4, 30) + i * 86400000,
            gameMode: 'PvP', moves: ['h2e2'], ...(i === 399 ? {} : { label: 'Study alpha beta ' + i }) }));
          // Keep the day distinct from other searchable numbers (e.g. 100%
          // accuracy), since library search matches terms across all fields.
          games[398].savedAt = Date.UTC(2027, 3, 22, 4, 30);
          games[398].review = { summary: { totalMoves: 1, accuracy: 100, averageCentipawnLoss: 0, redAccuracy: 100,
            bestCount: 1, goodCount: 0, inaccuracyCount: 0, mistakeCount: 0, blunderCount: 0,
            reviewedAt: Date.UTC(2026, 10, 1, 3, 30), lineSignature: 'h2e2', keyMoments: [] },
            annotations: [{ moveIndex: 0, evalScore: 20, quality: 'best', swing: 0, winPercentLoss: 0 }] };
          localStorage.setItem('xiangqi:library:v1', JSON.stringify(games));
          window.__dateWork = { nativeCalls: 0, constructors: 0, formats: 0, ms: 0 };
          const nativeDate = Date.prototype.toLocaleDateString;
          window.__expectedDate = ts => nativeDate.call(new Date(ts), undefined, { year: 'numeric', month: 'short', day: 'numeric' });
          const timed = fn => { const start = performance.now(); try { return fn(); } finally { window.__dateWork.ms += performance.now() - start; } };
          Date.prototype.toLocaleDateString = function(...args) { window.__dateWork.nativeCalls++; return timed(() => nativeDate.apply(this, args)); };
          const NativeFormatter = Intl.DateTimeFormat;
          const format = Object.getOwnPropertyDescriptor(NativeFormatter.prototype, 'format');
          Object.defineProperty(NativeFormatter.prototype, 'format', { ...format, get() {
            const bound = format.get.call(this);
            return (...args) => { window.__dateWork.formats++; return timed(() => bound(...args)); };
          } });
          Intl.DateTimeFormat = new Proxy(NativeFormatter, {
            construct(target, args) { window.__dateWork.constructors++; return timed(() => Reflect.construct(target, args)); },
            apply(target, self, args) { window.__dateWork.constructors++; return timed(() => Reflect.apply(target, self, args)); },
          });
        });
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
        await page.goto(base);
        await page.locator('.xiangqi-board').waitFor();
        await page.getByTestId(width < 900 ? 'mobile-open-library-btn' : 'left-panel-tab-library').click();
        const search = page.getByRole('searchbox', { name: 'Search library' });
        const unnamed = page.locator('.lib-card[data-game-id="dates-399"]');
        const reviewed = page.locator('.lib-card[data-game-id="dates-398"]');
        const checkDates = async () => {
          const expected = await page.evaluate(() => {
            const games = JSON.parse(localStorage.getItem('xiangqi:library:v1'));
            return { unnamed: window.__expectedDate(games[399].savedAt), saved: window.__expectedDate(games[398].savedAt), reviewed: window.__expectedDate(games[398].review.summary.reviewedAt) };
          });
          assert.equal(await unnamed.locator('.lib-game-name-button').innerText(), `Game — ${expected.unnamed}`);
          assert.equal(await reviewed.locator('.lib-date').innerText(), expected.saved);
          assert.equal(await reviewed.locator('.lib-review-date').innerText(), `Reviewed ${expected.reviewed}`);
          return expected;
        };
        await checkDates();
        await search.fill('alpha');
        await settle(page);
        if (browserType.name() === 'chromium') {
          cdp ??= await page.context().newCDPSession(page);
          await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
        }
        const samples = [];
        for (const query of ['beta', 'study', 'alpha beta', 'study alpha', 'alpha']) {
          await page.evaluate(() => { window.__dateWork = { nativeCalls: 0, constructors: 0, formats: 0, ms: 0 }; });
          const start = performance.now();
          await search.fill(query); await settle(page);
          assert.equal(await page.locator('.lib-card[data-game-id]').count(), 100);
          samples.push({ query, interactionMs: +(performance.now() - start).toFixed(1), ...await page.evaluate(() => window.__dateWork) });
        }
        console.log(JSON.stringify({ browser: browserType.name(), defaults: await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions()), width, cpuSlowdown: cdp ? 4 : 1, samples }));
        assert.ok(samples.every(sample => sample.nativeCalls === 0 && sample.constructors <= 8 && sample.formats >= 100), 'Visible dates must share formatter setup: ' + JSON.stringify(samples));
        await search.fill(''); await settle(page); await checkDates();
        const checkDateSearch = async expected => {
          for (const [query, card, label] of [[expected.unnamed, unnamed, 'unnamed game date'],
            [expected.saved, reviewed, 'saved date'], [expected.reviewed, reviewed, 'review date']]) {
            await search.fill(query); await settle(page);
            assert.equal(await card.count(), 1, `Searching the displayed ${label} (${query}) must find its game`);
          }
          await search.fill(''); await settle(page);
        };
        await checkDateSearch(await checkDates());
        if (cdp && liveDefaults) {
          for (const [method, args] of [['Emulation.setLocaleOverride', { locale: 'fr_FR' }],
            ['Emulation.setTimezoneOverride', { timezoneId: 'America/Los_Angeles' }]]) {
            const before = await checkDates();
            await cdp.send(method, args);
            await search.fill('alpha'); await search.fill(''); await settle(page);
            const after = await checkDates();
            assert.notDeepEqual(after, before, 'An open panel must pick up changed default locale/time zone');
            await checkDateSearch(after);
            for (const key of ['saved', 'reviewed']) {
              await search.fill(before[key]); await settle(page);
              assert.equal(await reviewed.count(), 0, `The stale ${key} date must no longer match this game`);
            }
            await search.fill(''); await settle(page);
          }
        }
        await page.evaluate(() => { document.documentElement.style.fontSize = '32px'; });
        await settle(page); await reviewed.locator('.lib-review-date').scrollIntoViewIfNeeded();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.equal(await reviewed.locator('.lib-review-date').evaluate(node => {
          const rect = node.getBoundingClientRect();
          return node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
        }), true, 'The enlarged review date must be reachable');
        await page.screenshot({ path: `/tmp/xiangqi-library-dates-${browserType.name()}-${width}.png` });
        assert.deepEqual(errors, []);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
