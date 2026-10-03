const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { resolveBrowserExecutable, browserDOM } = require("./browser-executable");

const FIXTURE = path.join(__dirname, "worktodo-shared-drawer-browser.html");

async function runBrowser(browserExecutable) {
  const output = await browserDOM(browserExecutable, FIXTURE, { ready: '[data-audit*="checklistPanelOpenAfterAdd"]', query: "?consumer=worktodo-new&checklist-qa=1" });
  const match = output.match(/data-audit="([^\"]+)"/);
  return JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
}

test("WorkTodo uses the Shared Task Drawer presentation contract at runtime", async t => {
  const browserExecutable = resolveBrowserExecutable();
  if (!browserExecutable) return t.skip("Set CHROME_PATH, CHROMIUM_PATH, or BROWSER_EXECUTABLE to run the WorkTodo Shared Drawer browser regression");

  const audit = await runBrowser(browserExecutable);
  assert.equal(audit.framework, "v1");
  assert.equal(audit.gap, "8px");
  assert.equal(audit.rowGap, "8px");
  assert.match(audit.cardPadding, /16px/);
  assert.equal(audit.activityRows, 2);
  assert.equal(audit.systemActivityRendered, false);
  assert.equal(audit.systemActivityControls, false);
  assert.equal(audit.revisionOriginalRendered, false);
  assert.equal(audit.revisionLatestRendered, true);
  assert.equal(audit.tombstonedOriginalRendered, false);
  assert.equal(audit.activityReadPath, "engineering_activity_log");
  assert.equal(audit.legacyFallbackCalled, false);
  assert.equal(audit.legacyChecklistPathCalled, false);
  assert.ok(audit.canonicalChecklistReads >= 1);
  assert.equal(audit.hasSharedDrawer, true);
  assert.equal(audit.hasWorkTodoOwnedDrawer, false);
  assert.equal(audit.hasLegacyProperties, false);
  assert.equal(audit.hasAgreedDateProperty, true);
  assert.equal(audit.hasAgreedDateEditor, true);
  assert.equal(audit.agreementMode, "single");
  assert.equal(audit.agreementValue, "尚未設定");
  assert.equal(audit.agreementEditorAfterMetadataRow, true);
  assert.ok(audit.agreementEditorWidth > 0 && audit.agreementEditorWidth <= 360);
  assert.equal(audit.agreementEditorAlignmentDelta, 0);
  assert.equal(audit.metadataGridChildren, 4);
  assert.equal(audit.gptRemainsInMetadataRow, true);
  assert.equal(audit.agreedDateInputs, 1);
  assert.equal(audit.agreementPeriodHidden, true);
  assert.equal(audit.periodMode, "period");
  assert.equal(audit.periodDateInputs, 2);
  assert.equal(audit.clearMode, "single");
  assert.equal(audit.clearDateInputs, 1);
  assert.equal(audit.checklistDisabled, false);
  assert.equal(audit.checklistPanelOpen, true);
  assert.equal(audit.checklistAddLabel, "新增 Checklist 項目");
  assert.equal(audit.checklistAddPlaceholder, "新增 Checklist 項目…");
  assert.equal(audit.checklistAutocomplete, "off");
  assert.equal(audit.checklistPanelOpenAfterAdd, false, "新增 Checklist 後應保留使用者手動收合選擇");
  assert.equal(audit.checklistAddSubmitCalls, 1);
  assert.equal(audit.urlLink, true);
});
