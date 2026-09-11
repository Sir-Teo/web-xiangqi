import assert from 'node:assert/strict';
import { createServer } from 'vite';
const server = await createServer({ server: { middlewareMode: true } });
try {
  const { parseDhtmlXqRecord } = await server.ssrLoadModule('/src/utils/dhtmlxq.ts');
  for (const count of [2500, 5500, 11000]) {
    for (const kind of ['movelist', 'comment']) {
      const source = kind === 'movelist' ? '[DhtmlXQ_movelist]'.repeat(count)
        : '[DhtmlXQ_movelist]7774[/DhtmlXQ_movelist]' + '[DhtmlXQ_comment1]'.repeat(count);
      const parse = () => {
        const result = parseDhtmlXqRecord(source);
        if (kind === 'movelist') assert.equal(result, null);
        else { assert.deepEqual(result.moves, ['h2h5']); assert.equal(result.comments.size, 0); }
      };
      for (let i = 0; i < 3; i++) parse();
      const samples = [];
      for (let i = 0; i < 10; i++) { const start = performance.now(); parse(); samples.push(performance.now() - start); }
      samples.sort((a, b) => a - b);
      console.log(JSON.stringify({ kind, characters: source.length, samples: samples.length, medianMs: +samples[5].toFixed(3), p90Ms: +samples[8].toFixed(3) }));
    }
  }
} finally { await server.close(); }
