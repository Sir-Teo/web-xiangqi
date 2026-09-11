import assert from 'node:assert/strict';
import { createServer } from 'vite';

// Isolated import parsing; excludes rendering, storage, and engine work.
const server = await createServer({ server: { middlewareMode: true } });
try {
  const { extractAnnotatedMainLine } = await server.ssrLoadModule('/src/utils/moveImport.ts');
  for (const repetitions of [5000, 20000, 99000]) {
    const source = `h2e2 {${'[%'.repeat(repetitions)}} h9g7`;
    const parse = () => extractAnnotatedMainLine(source);
    const read = parse();
    assert.deepEqual(read.moves, ['h2e2', 'h9g7']);
    assert.equal(read.annotations[0].comment, '[%'.repeat(250));
    for (let i = 0; i < 5; i++) parse();
    const samples = [];
    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      parse();
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    console.log(JSON.stringify({ characters: source.length, samples: samples.length,
      medianMs: +samples[10].toFixed(3), p95Ms: +samples[18].toFixed(3) }));
  }
} finally { await server.close(); }
