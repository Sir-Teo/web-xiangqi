import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import type { ViteDevServer } from 'vite'

const crossOriginIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
}

const parserTimingTests = [
  'src/__fuzz.test.ts',
  'src/utils/__fuzz.test.ts',
  'src/utils/moveImport.performance.test.ts',
]

function installIsolationHeaders(server: Pick<ViteDevServer, 'middlewares'>) {
  // Vite's static/transform handlers can return 304 before applying their
  // configured headers. WebKit rejects cached workers without COEP on that
  // response, so set isolation headers before either handler can short-circuit.
  server.middlewares.use((_request, response, next) => {
    for (const [name, value] of Object.entries(crossOriginIsolationHeaders)) {
      response.setHeader(name, value)
    }
    next()
  })
}

// https://vite.dev/config/
export default defineConfig({
  base: '/web-xiangqi/',
  plugins: [react(), {
    name: 'isolation-headers-on-revalidation',
    configureServer: installIsolationHeaders,
    configurePreviewServer: installIsolationHeaders,
  }],
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
    // npm test runs these groups in separate Vitest processes: parser timing
    // checks get fresh workers and heaps after the parallel unit suite exits.
    // Keep their ordering for direct `vitest run` invocations too.
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          exclude: [...configDefaults.exclude, '**/.deps/**', ...parserTimingTests],
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: 'parser-limits',
          include: parserTimingTests,
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
})
