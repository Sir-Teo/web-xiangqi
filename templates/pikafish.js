"use strict";

(function() {
  function wasmThreadsSupported() {
    try {
      const source = Uint8Array.of(0x0, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00);
      if (typeof WebAssembly !== "object" || typeof WebAssembly.validate !== "function") return false;
      if (!WebAssembly.validate(source)) return false;
      if (typeof SharedArrayBuffer !== "function") return false;
      if (typeof Atomics !== "object") return false;
      const mem = new WebAssembly.Memory({ shared: true, initial: 8, maximum: 16 });
      if (!(mem.buffer instanceof SharedArrayBuffer)) return false;
      if (typeof window !== "undefined" && typeof window.postMessage === "function") {
        try { window.postMessage(mem, "*"); } catch (_) { return false; }
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  function isNode() {
    return typeof process !== "undefined" &&
      process.versions &&
      process.versions.node;
  }

  function isWorker() {
    return typeof self !== "undefined" &&
      typeof importScripts === "function" &&
      (typeof document === "undefined");
  }

  function dirname(p) {
    return p.replace(/[\\/][^\\/]*$/, "");
  }

  async function readBytes(input) {
    if (input instanceof Uint8Array) return input;
    if (isNode()) {
      const fs = require("fs");
      return fs.readFileSync(input);
    }
    const res = await fetch(input);
    if (!res.ok) throw new Error("Failed to fetch NNUE: " + input);
    return new Uint8Array(await res.arrayBuffer());
  }

  function defaultBasePath() {
    if (isNode()) return __dirname;
    if (typeof self !== "undefined" && self.location) {
      const url = self.location.href.split("#")[0];
      return dirname(url);
    }
    return ".";
  }

  function joinPath(base, file) {
    if (isNode()) {
      const path = require("path");
      return path.join(base, file);
    }
    return String(base).replace(/\/+$/, "") + "/" + file;
  }

  function resolveVariant(opts) {
    const requested = (opts && opts.variant) || "auto";
    if (requested === "threaded" || requested === "single") return requested;
    if (isNode()) return "threaded";
    return wasmThreadsSupported() ? "threaded" : "single";
  }

  function coreMeta(variant) {
    return variant === "single"
      ? { jsFile: "pikafish-core-single.js", globalName: "PikafishCoreSingle" }
      : { jsFile: "pikafish-core.js", globalName: "PikafishCore" };
  }

  function getCoreFactory(opts) {
    if (opts && opts.coreFactory) return opts.coreFactory;
    const meta = coreMeta(opts.variant);
    if (isNode()) {
      const path = require("path");
      const corePath = (opts && opts.coreJsPath) || path.join(opts.basePath || __dirname, meta.jsFile);
      return require(corePath);
    }
    if (typeof self !== "undefined" && typeof self[meta.globalName] !== "undefined") return self[meta.globalName];
    throw new Error(meta.globalName + " not found. Load " + meta.jsFile + " first.");
  }

  async function createEngine(opts) {
    opts = opts || {};
    const variant = resolveVariant(opts);
    const basePath = opts.basePath || defaultBasePath();
    const coreFactory = getCoreFactory({ ...opts, basePath, variant });
    const listeners = new Set();
    const pending = [];
    let searching = false;
    let quitting = false;
    let mod;

    function emit(line) {
      for (const fn of listeners) fn(line);
    }

    function maybeFlush() {
      if (searching || !pending.length) return;
      while (pending.length && !searching) {
        const cmd = pending.shift();
        rawSend(cmd);
      }
    }

    function onLine(line) {
      emit(line);
      if (/^bestmove\b/.test(line)) {
        searching = false;
        maybeFlush();
      }
    }

    mod = await coreFactory({
      listener: onLine,
      locateFile: function(file) {
        if (file.endsWith(".wasm") || file.endsWith(".worker.js")) {
          return joinPath(basePath, file);
        }
        return file;
      }
    });

    async function loadNNUE(nnueSource) {
      const target = "/pikafish.nnue";
      const bytes = await readBytes(nnueSource || opts.nnuePath || joinPath(basePath, "pikafish.nnue"));
      try {
        mod.FS.unlink(target);
      } catch (_) {}
      mod.FS.writeFile(target, bytes);
      rawSend("setoption name EvalFile value " + target);
      return target;
    }

    function rawSend(cmd) {
      mod.ccall("command", null, ["string"], [cmd]);
      if (/^quit\b/.test(cmd)) quitting = true;
    }

    function postMessage(cmd) {
      cmd = String(cmd).trim();
      if (!cmd) return;
      if (/^go\b/.test(cmd)) {
        searching = true;
        rawSend(cmd);
        return;
      }
      if (searching && (/^setoption\b/.test(cmd) || /^position\b/.test(cmd) || /^ucinewgame\b/.test(cmd))) {
        pending.push(cmd);
        return;
      }
      rawSend(cmd);
    }

    if (opts.autoLoadNNUE !== false) {
      await loadNNUE(opts.nnuePath);
    }

    return {
      variant,
      postMessage,
      loadNNUE,
      addMessageListener(fn) { listeners.add(fn); },
      removeMessageListener(fn) { listeners.delete(fn); },
      async terminate() {
        if (!quitting) {
          try { postMessage("quit"); } catch (_) {}
        }
        try {
          if (typeof mod.terminate === "function") mod.terminate();
        } catch (_) {}
      }
    };
  }

  createEngine.wasmThreadsSupported = wasmThreadsSupported;

  if (isNode()) {
    module.exports = createEngine;
    return;
  }

  if (isWorker()) {
    let enginePromise = null;
    let basePathOverride = null;
    let nnuePathOverride = null;
    let variantOverride = "auto";

    function ensureEngine() {
      if (!enginePromise) {
        enginePromise = createEngine({
          basePath: basePathOverride || defaultBasePath(),
          nnuePath: nnuePathOverride || null,
          variant: variantOverride
        });
      }
      return enginePromise;
    }

    self.onmessage = async function(event) {
      const data = event.data;
      if (data && typeof data === "object" && data.type === "init") {
        if (data.coreScript) importScripts(data.coreScript);
        basePathOverride = data.basePath || basePathOverride;
        nnuePathOverride = data.nnuePath || nnuePathOverride;
        variantOverride = data.variant || variantOverride;
        await ensureEngine();
        return;
      }
      const engine = await ensureEngine();
      engine.addMessageListener(function forward(line) {
        self.postMessage(line);
        if (/^bestmove\b/.test(line) || line === "uciok" || line === "readyok") {
          engine.removeMessageListener(forward);
        }
      });
      engine.postMessage(String(data));
    };
    self.Pikafish = createEngine;
    return;
  }

  self.Pikafish = createEngine;
})();
