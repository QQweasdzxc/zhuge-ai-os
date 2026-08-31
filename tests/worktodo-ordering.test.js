const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const ordering = require(path.join(root, "modules/worklog/worktodo-ordering.js"));

function task(workCode, fields = {}) {
  return { workCode, title: workCode, ...fields };
}

test("waiting acceptance uses the acceptance date first and puts undated tasks last", () => {
  const rows = [
    task("WLTK-003", { dueDate: "2026-09-04", updatedAt: "2026-08-30T12:00:00Z" }),
    task("WLTK-001", { dueDate: "2026-09-01", updatedAt: "2026-08-20T12:00:00Z" }),
    task("WLTK-002", { agreementStartDate: "2026-08-01", agreementEndDate: "2026-09-01", updatedAt: "2026-08-10T12:00:00Z" }),
    task("WLTK-004", { updatedAt: "2026-08-31T12:00:00Z" })
  ];
  const sorted = ordering.sortTasks(rows, { workspaceForTask: () => "waiting_acceptance" });
  assert.deepEqual(sorted.map(row => row.workCode), ["WLTK-001", "WLTK-002", "WLTK-003", "WLTK-004"]);
});

test("waiting acceptance breaks same-date ties by latest progress", () => {
  const rows = [
    task("WLTK-002", { dueDate: "2026-09-01", updatedAt: "2026-08-31T14:00:00Z" }),
    task("WLTK-001", { dueDate: "2026-09-01", updatedAt: "2026-08-20T14:00:00Z" })
  ];
  const journals = new Map([
    ["WLTK-002", [{ createdAt: "2026-08-30T08:00:00Z" }]],
    ["WLTK-001", [{ createdAt: "2026-08-31T08:00:00Z" }]]
  ]);
  const sorted = ordering.sortTasks(rows, {
    workspaceForTask: () => "waiting_acceptance",
    journalsForTask: row => journals.get(row.workCode) || []
  });
  assert.deepEqual(sorted.map(row => row.workCode), ["WLTK-001", "WLTK-002"]);
});

test("waiting acceptance uses a period end date as the deadline", () => {
  const rows = [
    task("WLTK-001", { agreementMode: "period", agreementStartDate: "2026-09-14", agreementEndDate: "2026-09-18" }),
    task("WLTK-003", { agreementMode: "single", agreementStartDate: "2026-09-04" }),
    task("WLTK-005", { agreementMode: "period", agreementStartDate: "2026-09-02", agreementEndDate: "2026-09-03" }),
    task("WLTK-006", { agreementMode: "period", agreementStartDate: "2026-09-07", agreementEndDate: "2026-09-12" }),
    task("WLTK-024", { agreementMode: "period", agreementStartDate: "2026-09-19", agreementEndDate: "2026-09-25" }),
    task("WLTK-030", { agreementMode: "single", agreementStartDate: "2026-09-11" })
  ];
  const sorted = ordering.sortTasks(rows, { workspaceForTask: () => "waiting_acceptance" });
  assert.deepEqual(sorted.map(row => row.workCode), ["WLTK-005", "WLTK-003", "WLTK-030", "WLTK-006", "WLTK-001", "WLTK-024"]);
});

test("other workspaces use latest progress and fall back to task update time", () => {
  const rows = [
    task("WLTK-001", { updatedAt: "2026-08-31T09:00:00Z" }),
    task("WLTK-002", { updatedAt: "2026-08-30T09:00:00Z" }),
    task("WLTK-003", { updatedAt: "2026-08-29T09:00:00Z" })
  ];
  const journals = new Map([
    ["WLTK-001", [{ createdAt: "2026-08-28T09:00:00Z" }]],
    ["WLTK-002", [{ createdAt: "2026-08-31T10:00:00Z" }]]
  ]);
  const sorted = ordering.sortTasks(rows, {
    workspaceForTask: () => "not_started",
    journalsForTask: row => journals.get(row.workCode) || []
  });
  assert.deepEqual(sorted.map(row => row.workCode), ["WLTK-002", "WLTK-003", "WLTK-001"]);
});

test("ordering rejects invalid dates and preserves deterministic code order", () => {
  assert.equal(ordering.parseDateOnly("2026-02-30"), null);
  const rows = [
    task("WLTK-010", { dueDate: "invalid", updatedAt: "2026-08-30T10:00:00Z" }),
    task("WLTK-002", { dueDate: "invalid", updatedAt: "2026-08-30T10:00:00Z" })
  ];
  const sorted = ordering.sortTasks(rows, { workspaceForTask: () => "waiting_acceptance" });
  assert.deepEqual(sorted.map(row => row.workCode), ["WLTK-002", "WLTK-010"]);
});

test("WorkLog loads the ordering contract before the app runtime and renders the two-column control center", () => {
  const entry = fs.readFileSync(path.join(root, "modules/worklog/index.html"), "utf8");
  const app = fs.readFileSync(path.join(root, "modules/worklog/worklog-app.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "modules/worklog/worklog.css"), "utf8");
  assert.ok(entry.indexOf('"worktodo-ordering.js"') < entry.indexOf('"worklog-app.js"'));
  assert.match(app, /class="control-center-layout"/);
  assert.match(app, /class="control-center-status-column"/);
  assert.match(app, /class="control-center-management-column"/);
  assert.match(css, /\.control-center-layout\{[^}]*grid-template-columns:minmax\(280px,2fr\) minmax\(0,3fr\)/);
  assert.match(css, /@media\(max-width:1023px\)\{\.control-center-layout\{grid-template-columns:1fr\}/);
});
