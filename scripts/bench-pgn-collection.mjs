import assert from 'node:assert/strict';
import { createServer } from 'vite';

// Whole collection parsing, excluding file I/O, worker startup, UI, and storage.
const server = await createServer({ server: { middlewareMode: true } });
try {
  const { parsePgnCollection } = await server.ssrLoadModule('/src/utils/pgnCollection.ts');
  for (const count of [5000, 20000, 74000]) {
    const source = `h2e2 {${'[%xqanalysis '.repeat(count)}} *`;
    const parse = () => {
      try { parsePgnCollection(source); return null; }
      catch (error) { return error.message; }
    };
    assert.equal(parse(), 'Game 1: A move note exceeds 500 characters.');
    for (let i = 0; i < 5; i++) parse();
    const samples = [];
    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      const message = parse();
      samples.push(performance.now() - start);
      assert.equal(message, 'Game 1: A move note exceeds 500 characters.');
    }
    samples.sort((a, b) => a - b);
    console.log(JSON.stringify({ characters: source.length, samples: samples.length,
      medianMs: +samples[10].toFixed(3), p95Ms: +samples[18].toFixed(3) }));
  }
} finally { await server.close(); }
