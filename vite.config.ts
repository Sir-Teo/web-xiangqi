import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const crossOriginIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
}

// https://vite.dev/config/
export default defineConfig({
  base: '/web-xiangqi/',
  plugins: [react()],
  server: {
    headers: crossOriginIsolationHeaders,
  },
  preview: {
    headers: crossOriginIsolationHeaders,
  },
  build: {
    emptyOutDir: false, // WASM artifacts in dist/ are built first; don't wipe them
  },
  test: {
    // emsdk unpacks into .deps/, and it ships its own *.test.js files --
    // Emscripten's embind and asyncify suites, which expect globals this
    // project has never heard of. Vitest's default excludes cover node_modules
    // and dist but not .deps, so anything that runs `npm test` after
    // scripts/install-emsdk.sh picks them up and fails on someone else's tests.
    //
    // That is exactly what the Pages deploy does: install emsdk, build the
    // WASM, then verify. It cannot be reproduced from a partial local emsdk
    // (a cached toolchain has no test/ directory), which is why it only
    // appeared once the workflow ran end to end.
    exclude: [...configDefaults.exclude, '**/.deps/**'],
  },
})
