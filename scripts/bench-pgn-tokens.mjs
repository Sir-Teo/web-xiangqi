import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'vite';

// Isolated tokenizing of a pasted record; excludes rendering, storage and
// engine work. Guards the hand-written `{...}` scan in `pgnTokens`: the
// obvious spelling of the same rule, `\{[^}]*\}`, is quadratic on a paste full
// of unterminated openers, and the original `\{[^}]*(?:\}|$)` was linear only
// because it swallowed the rest of the file -- which hid the next game.
const LIMIT = 200_000; // MAX_MOVE_IMPORT_TEXT_LENGTH
const ref = process.argv[2];
const baseline = ref ? execFileSync('git', ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], { encoding: 'utf8' }).trim() : null;
const previousSource = baseline ? execFileSync('git', ['show', `${baseline}:src/utils/pgnText.ts`], { encoding: 'utf8' }) : null;
const server = await createServer({ configFile: false, cacheDir: '.cache/bench-pgn', optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, hmr: false, watch: null }, plugins: [{
    name: 'pgn-token-benchmark-baseline', enforce: 'pre',
    load(id) { if (previousSource && id.endsWith('/src/utils/pgnText.ts?token-baseline')) return previousSource; },
  }] });
try {
  const { pgnTokens, firstPgnGame } = await server.ssrLoadModule('/src/utils/pgnText.ts');
  const previous = baseline ? await server.ssrLoadModule('/src/utils/pgnText.ts?token-baseline') : null;
  if (previous) {
    for (const text of [';\n', '%\n', '{}[]', '炮二平五', '{', '[Event "Study"]\n1.h2e2 * h9g7', '0-1 h2e2', '1/2-1/2 h2e2']) {
      const source = text.length < 8 ? text.repeat(Math.floor(LIMIT / text.length)) : text;
      assert.deepEqual(firstPgnGame(source), previous.firstPgnGame(source));
      const samples = { before: [], after: [] };
      for (let sample = 0; sample < 9; sample++) for (const [key, read] of (sample % 2 ? [['after', firstPgnGame], ['before', previous.firstPgnGame]] : [['before', previous.firstPgnGame], ['after', firstPgnGame]])) {
        const start = performance.now(); read(source);
        if (sample > 1) samples[key].push(performance.now() - start);
      }
      console.log(JSON.stringify({ scope: 'first-game boundary scan', baseline, prefix: text, characters: source.length,
        medianMs: Object.fromEntries(Object.entries(samples).map(([key, values]) => [key, +values.sort((a, b) => a - b)[3].toFixed(3)])) }));
    }
  }

  // The behaviour the speed must not be bought with: an unterminated comment
  // stops at the next game, so the second game is still found.
  const twoGames = '[Event "one"]\n1. h2e2 {oops\n\n[Event "two"]\n1. b2e2 1-0\n';
  assert.equal(firstPgnGame(twoGames).truncated, true);
  assert.ok(!firstPgnGame(twoGames).text.includes('b2e2'));
  // ...and one that never reaches a next game still runs to the end, so its
  // contents are not read as moves or as a result.
  assert.equal(firstPgnGame('1.h2e2 {a note mentioning 1-0').marker, undefined);

  const cases = {
    'openers, no closer': '{'.repeat(LIMIT),
    'closer then openers': `}${'{'.repeat(LIMIT - 1)}`,
    'openers among moves': 'h2e2 {'.repeat(Math.floor(LIMIT / 6)),
    'plain record': '[Event "x"]\n1. h2e2 {ok} b2e2\n'.repeat(Math.floor(LIMIT / 29)),
    // Every game truncated mid-comment: the shape that calls `nextTagSection`
    // once per game rather than once for the file.
    'a truncated comment in every game': '[Event "x"]\n1. h2e2 {oops\n'.repeat(Math.floor(LIMIT / 26)),
  };
  for (const [name, source] of Object.entries(cases)) {
    const run = () => { let n = 0; for (const _token of pgnTokens(source)) n++; return n; };
    const tokens = run();
    for (let i = 0; i < 5; i++) run();
    const samples = [];
    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      run();
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    console.log(JSON.stringify({ case: name, characters: source.length, tokens,
      medianMs: +samples[10].toFixed(3), p95Ms: +samples[18].toFixed(3) }));
  }
  const { extractUciMoveTree } = await server.ssrLoadModule('/src/utils/moveImport.ts');
  const annotated = extractUciMoveTree('%tool data\n1.h2e2 {Keep this note}\n;\n h9g7 *');
  assert.deepEqual(annotated.moves, ['h2e2', 'h9g7']);
  assert.equal(annotated.moveTree[0].comment, 'Keep this note');
  for (const marker of ['%', ';']) {
    const source = `${marker}\n`.repeat(LIMIT / 2);
    for (let run = 0; run < 5; run++) extractUciMoveTree(source);
    const samples = [];
    for (let run = 0; run < 20; run++) {
      const start = performance.now();
      const tree = extractUciMoveTree(source);
      samples.push(performance.now() - start);
      assert.deepEqual(tree.moves, []);
      assert.deepEqual(tree.moveTree, []);
    }
    samples.sort((a, b) => a - b);
    console.log(JSON.stringify({ case: `coordinate tree, blank ${marker} lines`, characters: source.length,
      medianMs: +samples[10].toFixed(3), p95Ms: +samples[18].toFixed(3) }));
  }
} finally { await server.close(); }
