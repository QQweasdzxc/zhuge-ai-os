const test = require("node:test");
const assert = require("node:assert/strict");
const Summary = require("../shared/components/task-card-summary.js");

test("Shared Task Card summary prefers latest progress over work content", () => {
  assert.equal(Summary.resolve({ latestProgress: "最新進度", workContent: "工作內容" }), "最新進度");
  assert.match(Summary.render({ latestProgress: "最新進度", workContent: "工作內容" }), /最新進度/);
  assert.doesNotMatch(Summary.render({ latestProgress: "最新進度", workContent: "工作內容" }), /工作內容/);
});

test("Shared Task Card summary falls back to work content and otherwise renders empty", () => {
  assert.equal(Summary.resolve({ workContent: "工作內容" }), "工作內容");
  assert.equal(Summary.render({ latestProgress: "", workContent: "" }), "");
});

test("Shared Task Card summary keeps URL rendering safe", () => {
  const html = Summary.render({ latestProgress: "請看 https://example.com/a <script>alert(1)</script>" });
  assert.match(html, /href="https:\/\/example\.com\/a"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /javascript:/i);
});
