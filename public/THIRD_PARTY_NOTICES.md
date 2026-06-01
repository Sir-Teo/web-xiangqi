# Third-party notices

Web Xiangqi bundles browser engine artifacts built from Pikafish, a UCI Xiangqi engine.

## Pikafish

- Upstream source: https://github.com/official-pikafish/Pikafish
- Source revision used by the default build script: `beeca5cc785ceb2026c5f9248f6e057573b12906`
- Upstream license text included with this distribution: `Pikafish-Copying.txt`
- Bundled engine artifacts: `pikafish.js`, `pikafish-core*.js`, `pikafish-core*.wasm`, `pikafish-core*.worker.js`, and `pikafish.nnue`

The corresponding source for the bundled engine artifacts is the pinned Pikafish revision above, plus this repository's `patches/pikafish-wasm.patch`, `templates/emscripten/`, `templates/pikafish.js`, and `scripts/build-pikafish.sh`.

To rebuild the distributed browser engine artifacts from source:

```bash
bash scripts/install-emsdk.sh
npm run build
```

Set `PIKAFISH_UPSTREAM_REF=<commit-or-ref>` only when intentionally testing a newer upstream revision, and update the WebAssembly patch and `pikafish.nnue` together.
