"use strict";

const assert = require("assert");

process.env.SERVE_DEMO_TEST = "1";

const {
  appBasePath,
  cacheControlForPath,
  createDemoServer,
  normalizeRequestPath,
  relativePathForRequest,
} = require("./serve-demo.cjs");

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertMetaTag(html, attributeName, attributeValue, content) {
  assert.match(
    html,
    new RegExp(`<meta ${attributeName}="${escapeRegExp(attributeValue)}" content="${escapeRegExp(content)}"\\s*/?>`)
  );
}

async function main() {
  assert.equal(appBasePath, "/web-xiangqi/");
  assert.equal(normalizeRequestPath("/"), "/index.html");
  assert.equal(normalizeRequestPath("/web-xiangqi"), "/index.html");
  assert.equal(normalizeRequestPath("/web-xiangqi/"), "/index.html");
  assert.equal(normalizeRequestPath("/web-xiangqi/assets/index-abc123.js"), "/assets/index-abc123.js");
  assert.equal(relativePathForRequest("/web-xiangqi/pikafish.nnue"), "pikafish.nnue");
  assert.equal(cacheControlForPath("index.html"), "no-cache");
  assert.equal(cacheControlForPath("assets/index-abc123.js"), "public, max-age=31536000, immutable");
  assert.equal(cacheControlForPath("pikafish.nnue"), "public, max-age=0, must-revalidate");

  const server = createDemoServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const indexResponse = await fetch(`${baseUrl}/web-xiangqi/`);
    assert.equal(indexResponse.status, 200);
    assert.equal(indexResponse.headers.get("cross-origin-opener-policy"), "same-origin");
    assert.equal(indexResponse.headers.get("x-content-type-options"), "nosniff");
    const html = await indexResponse.text();
    assert.match(html, /<title>Web Xiangqi \| Pikafish Analysis Board<\/title>/);
    assertMetaTag(html, "name", "description", "A fast Xiangqi analysis board with Pikafish engine lines, game review, openings, saved studies, PGN/FEN import, and shareable variations.");
    assertMetaTag(html, "name", "application-name", "Web Xiangqi");
    assertMetaTag(html, "name", "color-scheme", "dark");
    assertMetaTag(html, "name", "theme-color", "#050505");
    assertMetaTag(html, "property", "og:title", "Web Xiangqi");
    assertMetaTag(html, "name", "twitter:card", "summary");
    assert.match(html, /<link rel="preload" href="\/web-xiangqi\/pikafish\.js" as="script"\s*\/?>/);
    const assetPath = html.match(/src="([^"]+\/assets\/[^"]+\.js)"/)?.[1];
    assert(assetPath, "React build should reference a hashed JS asset.");

    const assetResponse = await fetch(`${baseUrl}${assetPath}`);
    assert.equal(assetResponse.status, 200);
    assert.equal(assetResponse.headers.get("cache-control"), "public, max-age=31536000, immutable");
    assert.equal(assetResponse.headers.get("x-content-type-options"), "nosniff");
    const etag = assetResponse.headers.get("etag");
    assert(etag, "Static assets should include an ETag.");

    const cachedResponse = await fetch(`${baseUrl}${assetPath}`, {
      headers: { "If-None-Match": etag },
    });
    assert.equal(cachedResponse.status, 304);

    const nnueHead = await fetch(`${baseUrl}/web-xiangqi/pikafish.nnue`, { method: "HEAD" });
    assert.equal(nnueHead.status, 200);
    assert.equal(nnueHead.headers.get("cache-control"), "public, max-age=0, must-revalidate");
    assert(Number(nnueHead.headers.get("content-length")) > 50_000_000);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((err) => err ? reject(err) : resolve());
    });
  }

  console.log("Demo server routing and cache headers passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
