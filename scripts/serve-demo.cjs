"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const defaultDistDir = path.resolve(__dirname, "..", "dist");
const port = Number(process.env.PORT || 8080);
const appBasePath = "/web-xiangqi/";

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".nnue": "application/octet-stream",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
};

const crossOriginIsolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Cache-Control": "no-cache",
    ...crossOriginIsolationHeaders,
    ...headers,
  });
  res.end(body);
}

function normalizeRequestPath(urlPath) {
  if (urlPath === appBasePath.slice(0, -1) || urlPath === appBasePath) {
    return "/index.html";
  }
  if (urlPath.startsWith(appBasePath)) {
    return `/${urlPath.slice(appBasePath.length) || "index.html"}`;
  }
  return urlPath === "/" ? "/index.html" : urlPath;
}

function relativePathForRequest(urlPath) {
  const normalizedPath = path.posix.normalize(normalizeRequestPath(urlPath));
  if (normalizedPath.includes("\\") || normalizedPath === ".." || normalizedPath.startsWith("../")) {
    return null;
  }
  return normalizedPath.replace(/^\/+/, "") || "index.html";
}

function isInsideDirectory(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function cacheControlForPath(relativePath) {
  if (relativePath === "index.html") return "no-cache";
  if (/^assets\/.+-[A-Za-z0-9_-]+\.(?:css|js)$/.test(relativePath)) {
    return "public, max-age=31536000, immutable";
  }
  if (/\.(?:js|wasm|nnue)$/.test(relativePath)) {
    return "public, max-age=0, must-revalidate";
  }
  return "no-cache";
}

function makeEtag(stat) {
  return `W/"${stat.size.toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}"`;
}

function requestHasMatchingValidator(req, stat, etag) {
  const ifNoneMatch = req.headers["if-none-match"];
  if (typeof ifNoneMatch === "string" && ifNoneMatch.split(/\s*,\s*/).includes(etag)) {
    return true;
  }

  const ifModifiedSince = req.headers["if-modified-since"];
  if (typeof ifModifiedSince !== "string") return false;
  const sinceMs = Date.parse(ifModifiedSince);
  return Number.isFinite(sinceMs) && Math.trunc(stat.mtimeMs / 1000) <= Math.trunc(sinceMs / 1000);
}

function sendFile(req, res, filePath, relativePath, stat) {
  const ext = path.extname(filePath).toLowerCase();
  const etag = makeEtag(stat);
  const headers = {
    ...crossOriginIsolationHeaders,
    "Cache-Control": cacheControlForPath(relativePath),
    "Content-Type": contentTypes[ext] || "application/octet-stream",
    "Content-Length": stat.size,
    "ETag": etag,
    "Last-Modified": stat.mtime.toUTCString(),
  };

  if (requestHasMatchingValidator(req, stat, etag)) {
    res.writeHead(304, headers);
    res.end();
    return;
  }

  res.writeHead(200, headers);
  if (req.method === "HEAD") {
    res.end();
    return;
  }

  fs.createReadStream(filePath)
    .on("error", (err) => {
      if (!res.headersSent) {
        send(res, 500, String(err && err.stack || err));
      } else {
        res.destroy(err);
      }
    })
    .pipe(res);
}

function createDemoServer(options = {}) {
  const distDir = options.distDir || defaultDistDir;

  return http.createServer((req, res) => {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        return send(res, 405, "Method not allowed", { "Allow": "GET, HEAD" });
      }

      const urlPath = new URL(req.url, "http://localhost").pathname;
      let relativePath = relativePathForRequest(urlPath);
      if (!relativePath) {
        return send(res, 403, "Forbidden");
      }

      let filePath = path.resolve(distDir, relativePath);
      if (!isInsideDirectory(distDir, filePath) && filePath !== path.join(distDir, "index.html")) {
        return send(res, 403, "Forbidden");
      }

      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        if (path.extname(relativePath)) {
          return send(res, 404, "Not found");
        }
        relativePath = "index.html";
        filePath = path.resolve(distDir, relativePath);
      }

      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        return send(res, 404, "Not found");
      }

      sendFile(req, res, filePath, relativePath, fs.statSync(filePath));
    } catch (err) {
      send(res, 500, String(err && err.stack || err));
    }
  });
}

if (process.env.SERVE_DEMO_TEST !== "1") {
  createDemoServer().listen(port, () => {
    console.log(`Serving demo from ${defaultDistDir}`);
    console.log(`Open http://localhost:${port}/web-xiangqi/`);
    console.log(`Root http://localhost:${port}/ also serves the React app shell.`);
    console.log("COOP/COEP headers are enabled for threaded WASM.");
  });
}

module.exports = {
  appBasePath,
  cacheControlForPath,
  createDemoServer,
  makeEtag,
  normalizeRequestPath,
  relativePathForRequest,
};
