const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");

test("normalizeWorkProfile accepts a null cloud row without crashing", () => {
  const source = fs.readFileSync(path.join(ROOT, "modules", "worklog", "worklog-app.js"), "utf8");
  const helperSource = source.slice(0, source.indexOf("function applyWorkProfileToProfile"));
  const context = {
    profile: { ecpOwner: "Owner", ecpDepartment: "Dept", ecpTasks: ["Task"], tags: ["Model"] },
    currentUserUuid: () => "user-1",
    Date,
    console
  };
  vm.createContext(context);
  vm.runInContext(`${helperSource}\nthis.result = normalizeWorkProfile(null, profile);`, context);

  assert.equal(context.result.userUuid, "user-1");
  assert.equal(context.result.ecpResponsiblePerson, "Owner");
  assert.equal(context.result.ecpDepartment, "Dept");
  assert.equal(context.result.defaultTask, "Task");
  assert.equal(context.result.profileCompleted, true);
});
