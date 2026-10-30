'use strict';

// Zhuge Office 3D — private office members: people who belong in the office
// scene WITHOUT a task feed (requested 2026-10-30 through the task
// assignment: members belong in the office scene with a neutral state and no assigned tasks). The roster is read
// ONLY from this device's localStorage (zhuge.office.members) — never bundled,
// never shipped in public fixtures, never fetched from a server. Members get
// a neutral presence: no task status, no alerts, no "online/working" claim,
// and they are excluded from task statistics (separate 成員 group).

const Members = (() => {
  const KEY = 'zhuge.office.members';

  // Accepts a JSON array of strings or {name} objects. Never throws.
  function parseRoster(raw) {
    try {
      const a = JSON.parse(raw || '[]');
      if (!Array.isArray(a)) return [];
      const seen = new Set();
      const out = [];
      for (const x of a) {
        const n = typeof x === 'string' ? x : (x && typeof x.name === 'string' ? x.name : '');
        const name = n.trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        out.push(name);
        if (out.length >= 24) break;
      }
      return out;
    } catch { return []; }
  }

  function load(storageGet) {
    try { return parseRoster(storageGet ? storageGet(KEY) : null); } catch { return []; }
  }

  // Neutral presence sessions: constant idle, no timestamps (no activity
  // claim), member:true so stats/alerts/grouping keep them apart from tasks.
  function toSessions(names) {
    return (names || []).map((name, i) => ({
      key: `member:${i}:${name}`,
      agent: 'person',
      agentName: name,
      id: `member-${i}`,
      sessionId: null,
      parentId: null,
      subagent: false,
      member: true,
      cwd: '',
      project: name, // label + card header show the name
      title: '',
      model: '',
      status: 'idle',
      stuck: 0,
      context: null,
      today: null,
      activity: null,
      prompt: null,
      reply: null,
      error: null,
      turnStartedAt: null,
      lastEventAt: null,
      startedAt: null,
      history: [],
    }));
  }

  return { KEY, parseRoster, load, toSessions };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Members;
if (typeof window !== 'undefined') window.OfficeMembers = Members;
