const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { resolveBrowserExecutable, browserDOM } = require("./browser-executable");

test("Drawer PM acceptance and QJC card drag share the formal completion lifecycle", async t => {
  const browserExecutable = resolveBrowserExecutable();
  if (!browserExecutable) return t.skip("Set CHROME_PATH, CHROMIUM_PATH, or BROWSER_EXECUTABLE to run the browser regression");
  const fixture = path.join(__dirname, "ai-board-completion-gate-browser.html");
  const output = await browserDOM(browserExecutable, fixture, { ready: '#completion-gate-audit' });
  const audit = output.match(/id="completion-gate-audit"[^>]*>([^<]*)/)?.[1] || "";
  assert.match(audit, /calls=pm-acceptance:button-task:pass,pm-acceptance:drag-task:pass,pretransition:gpt-drag-task:qa\/QJC,pm-acceptance:gpt-drag-task:pass,pm-acceptance-fail:gpt-fail-task/);
  assert.match(audit, /result=button-task:done:completed:QJC\|drag-task:done:completed:QJC\|gpt-drag-task:done:completed:QJC\|gpt-fail-task:qa:qjc:GPT/);
  assert.match(audit, /sameFormalResult=true/);
  assert.match(audit, /audit=button-task:task_completed_after_pm_acceptance:pm_acceptance_pass:completed\|drag-task:task_completed_after_pm_acceptance:pm_acceptance_pass:completed\|gpt-drag-task:task_completed_after_pm_acceptance:pm_acceptance_pass:completed/);
  assert.match(audit, /moveCalls=0/);
  assert.match(audit, /gptCheckboxes=0/);
  assert.match(audit, /gptLabel=true/);
  assert.match(audit, /failStayed=true/);
  assert.match(audit, /failMessage=true/);
  assert.match(audit, /promptCalls=0/);
  assert.match(audit, /errors=$/);
});
