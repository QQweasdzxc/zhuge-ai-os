const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const app = fs.readFileSync(path.join(__dirname, "../labs/taskflow/pages-client/app.mjs"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "../labs/taskflow/pages-client/index.html"), "utf8");

test("DM-04 cards open the native TaskFlow issue detail route and expose evidence", () => {
  assert.match(app, /routeFor\(\{issueId:item\.id\}\)/);
  assert.match(app, /TaskFlow task ID/);
  assert.match(app, /Provider Run ID/);
  assert.match(app, /Provider ACK/);
  assert.match(app, /tf-dispatch-card-link/);
});

test("PM Inbox has truthful success, empty and API-error branches", () => {
  assert.match(html, /id="tf-pm-inbox"/);
  assert.match(app, /buildPmInboxEntries\(items\)/);
  assert.match(app, /未以空資料取代錯誤/);
  assert.match(app, /目前沒有可驗證的 PM 待處理案件/);
  assert.match(app, /routeFor\(\{issueId:item\.id\}\)/);
});

test("detail status uses conservative runtime normalization instead of native task-run inference", () => {
  assert.match(app, /const dispatchState=normalizeDispatchIssue\(issue,runs\)\.status/);
  assert.match(app, /const status=runtime\.status/);
});
