# web-xiangqi

`pikafish.js` / `pikafish.wasm` style build pipeline for Xiangqi, based on upstream [Pikafish](https://github.com/official-pikafish/Pikafish) + Emscripten.

## Status

Working end-to-end in Node.js (tested on macOS arm64):

- builds WASM from upstream `Pikafish`
- loads `pikafish.nnue` into Emscripten FS
- speaks UCI through a JS `postMessage()`-style wrapper
- smoke test passes (`uci`, `isready`, `position startpos`, `go depth 1`)

## What this repo contains

- `patches/pikafish-wasm.patch`: minimal upstream patch set (Makefile + UCI command bridge)
- `templates/emscripten/*`: Emscripten build overrides injected into upstream `Pikafish`
- `templates/pikafish.js`: JS wrapper around generated `pikafish-core.js/.wasm`
- `scripts/build-pikafish.sh`: clone, patch, build, copy artifacts to `dist/`
- `scripts/test-smoke.js`: Node smoke test

## Quick start

1. Install emsdk locally (once):

```bash
bash scripts/install-emsdk.sh
```

2. Build artifacts:

```bash
npm run build
```

3. Run smoke test:

```bash
npm run test:smoke
```

Artifacts are written to `dist/`:

- `dist/pikafish.js` (wrapper)
- `dist/pikafish-core.js`
- `dist/pikafish-core.wasm`
- `dist/pikafish-core.worker.js` (pthread worker; if generated)
- `dist/pikafish.nnue`

## Notes

- Current build is configured as a pthread-enabled WASM build and tested in Node.
- Browser use will require proper worker file hosting (`pikafish-core.worker.js`) and cross-origin isolation headers for WASM threads (`COOP`/`COEP`).
- The build script currently uses a `debug=yes optimize=no` compile to avoid upstream Makefile LTO/clang flag incompatibilities with current Emscripten. It is functional, but not tuned for size/speed yet.

## Next improvements

- Add a release-oriented Emscripten config (optimize + size tuning)
- Add browser worker demo and header checks
- Add a single-thread fallback build for non-isolated browser environments
