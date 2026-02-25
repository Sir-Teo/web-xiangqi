"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const distDir = path.resolve(__dirname, "..", "dist");
const port = Number(process.env.PORT || 8080);

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".nnue": "application/octet-stream",
  ".json": "application/json; charset=utf-8",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(body);
}

http.createServer((req, res) => {
  try {
    const urlPath = new URL(req.url, "http://localhost").pathname;
    const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
    let filePath = path.join(distDir, safePath === "/" ? "index.html" : safePath);

    if (!filePath.startsWith(distDir)) {
      return send(res, 403, "Forbidden");
    }

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      return send(res, 404, "Not found");
    }

    const ext = path.extname(filePath).toLowerCase();
    const data = fs.readFileSync(filePath);
    send(res, 200, data, {
      "Content-Type": contentTypes[ext] || "application/octet-stream",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Resource-Policy": "same-origin",
    });
  } catch (err) {
    send(res, 500, String(err && err.stack || err));
  }
}).listen(port, () => {
  console.log(`Serving demo from ${distDir}`);
  console.log(`Open http://localhost:${port}/`);
  console.log("COOP/COEP headers are enabled for threaded WASM.");
});

