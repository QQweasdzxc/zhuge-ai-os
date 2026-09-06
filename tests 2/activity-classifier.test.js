const test = require("node:test");
const assert = require("node:assert/strict");

const ActivityClassifier = require("../shared/components/activity-classifier.js");

test("canonical classifier grants Human Progress only to explicit created or edited activity", () => {
  assert.equal(ActivityClassifier.isHumanProgressActivity({
    activity_type: "human_progress_note",
    action: "progress_note_created"
  }), true);
  assert.equal(ActivityClassifier.isHumanProgressActivity({
    activityType: "human_progress_note",
    action: "progress_note_edited"
  }), true);
});

test("canonical classifier fails closed for deleted, system, unknown, and missing activity type", () => {
  const samples = [
    { activity_type: "human_progress_note", action: "progress_note_deleted" },
    { activity_type: "system_activity", action: "progress_note_deleted", tombstone_of: "1" },
    { activity_type: "system_activity", action: "worktodo_task_updated" },
    { action: "progress_note_created" },
    { activity_type: "unknown", action: "progress_note_created" }
  ];
  samples.forEach(sample => assert.equal(ActivityClassifier.isHumanProgressActivity(sample), false));
});
