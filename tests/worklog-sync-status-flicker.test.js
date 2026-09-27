const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'modules', 'worklog', 'worklog-app.js'), 'utf8');

test('cloud sync status refresh preserves DOM nodes and avoids repeated innerHTML replacement', () => {
  const start = source.indexOf('function refreshCloudSyncStatusDisplay()');
  const end = source.indexOf('\nfunction refreshAuthenticatedSurface', start);
  assert.ok(start >= 0 && end > start, 'refreshCloudSyncStatusDisplay must exist');
  const body = source.slice(start, end);
  assert.doesNotMatch(body, /box\.innerHTML\s*=/, 'status refresh must not replace innerHTML');
  assert.match(body, /textContent !== statusLabel/);
  assert.match(body, /textContent !== syncTime/);
});
