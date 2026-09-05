const test = require("node:test");
const assert = require("node:assert/strict");
const Renderer = require("../shared/components/activity-text-renderer.js");

test("shared activity renderer linkifies HTTP and HTTPS while preserving text and line breaks", () => {
  const html = Renderer.render("前文 https://drive.google.com/file?id=1, 後文 http://example.com/a\n第二行沒有連結");
  assert.equal((html.match(/<a /g) || []).length, 2);
  assert.match(html, /href="https:\/\/drive\.google\.com\/file\?id=1"/);
  assert.match(html, /href="http:\/\/example\.com\/a"/);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /https:\/\/drive\.google\.com\/file\?id=1<\/a>, 後文/);
  assert.match(html, /<br>第二行沒有連結/);
});

test("shared activity renderer escapes markup and refuses non-HTTP protocols", () => {
  const html = Renderer.render("<img src=x onerror=alert(1)> javascript:alert(1) data:text/html,blocked");
  assert.doesNotMatch(html, /<img\b/i);
  assert.doesNotMatch(html, /<a\b[^>]+href="(?:javascript|data):/i);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.equal(Renderer.isSafeHttpUrl("javascript:alert(1)"), "");
  assert.equal(Renderer.isSafeHttpUrl("data:text/plain,blocked"), "");
  assert.equal(Renderer.isSafeHttpUrl("https://example.com"), "https://example.com");
});
