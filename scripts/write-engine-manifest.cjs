const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

function writeEngineManifest(directory) {
  const assets = {};
  const files = fs.readdirSync(directory).filter(name => /^pikafish-core(?:-single)?(?:-simd)?\.(?:js|wasm)$/.test(name) || name === 'pikafish.nnue').sort();
  for (const name of files) {
    const bytes = fs.readFileSync(path.join(directory, name));
    assets[name] = { sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length };
  }
  if (!assets['pikafish.nnue'] || !assets['pikafish-core-single.js'] || !assets['pikafish-core-single.wasm']) throw new Error('Incomplete engine asset publication');
  const manifest = { version: 1, buildId: createHash('sha256').update(JSON.stringify(assets)).digest('hex'), assets };
  fs.writeFileSync(path.join(directory, 'engine-assets.json'), JSON.stringify(manifest) + '\n');
  return manifest;
}

module.exports = { writeEngineManifest };
if (require.main === module) writeEngineManifest(path.resolve(process.argv[2] || 'public'));
