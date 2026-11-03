'use strict';

// Zhuge Office 3D — private office members: people who belong in the office
// scene WITHOUT a task feed (requested 2026-10-30 through the task
// assignment: members belong in the office scene with a neutral state and no assigned tasks). The roster is read
// from the account-private roster when signed in. Legacy localStorage is
// migration input only. Names are never bundled or logged. Members get
// a neutral presence: no task status, no alerts, no "online/working" claim,
// and they are excluded from task statistics (separate 成員 group).

const Members = (() => {
  const KEY = 'zhuge.office.members';

  // Accepts a JSON array of strings or {name} objects. Never throws.
  function parseRoster(raw, limit = 24) {
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
        if (out.length >= limit) break;
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

  // Serialize reads/migrations/edits. Conditional writes prevent a migration
  // from overwriting another device's changes between GET and PATCH.
  function createSync({ storage, getToken, getAuth, fetchImpl, config, onChange = () => {} }) {
    let names = [], token = null, queue = Promise.resolve();
    const clean = value => parseRoster(JSON.stringify(value));
    const current = auth => getToken() === auth.token;
    const check = auth => { if (!current(auth)) throw new Error('account-changed'); };
    const url = `${config.supabaseUrl}/rest/v1/office_member_roster`;
    function visible() {
      return getToken() && getToken() === token ? [...names] : [];
    }
    async function request(auth, suffix, init = {}) {
      check(auth);
      const response = await fetchImpl(url + suffix, {
        ...init, credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(15000),
        headers: { apikey: config.supabaseAnonKey, Authorization: `Bearer ${auth.token}`,
          'Content-Type': 'application/json', Prefer: 'return=representation', ...init.headers },
      });
      check(auth);
      if (response.status === 409) throw new Error('conflict');
      if (!response.ok) throw new Error('cloud-failed'); // never expose response bodies/names
      const rows = await response.json();
      if (!Array.isArray(rows)) throw new Error('invalid-response');
      return rows;
    }
    async function read(auth) {
      const rows = await request(auth, `?owner=eq.${encodeURIComponent(auth.owner)}&select=owner,names,updated_at`);
      if (rows.length > 1) throw new Error('invalid-response');
      const row = rows[0] || null;
      if (row && (row.owner !== auth.owner || !Array.isArray(row.names) || !row.updated_at)) throw new Error('invalid-response');
      return row;
    }
    async function write(auth, row, next) {
      const suffix = row ? `?owner=eq.${encodeURIComponent(auth.owner)}&updated_at=eq.${encodeURIComponent(row.updated_at)}` : '';
      const rows = await request(auth, suffix, { method: row ? 'PATCH' : 'POST',
        body: JSON.stringify(row ? { names: next } : { owner: auth.owner, names: next }) });
      if (!rows.length) throw new Error('conflict');
      if (rows.length !== 1 || rows[0].owner !== auth.owner || !rows[0].updated_at ||
          JSON.stringify(rows[0].names) !== JSON.stringify(next)) throw new Error('unconfirmed-write');
      return rows[0];
    }
    function run(edit) {
      const editToken = edit ? getToken() : null;
      const task = async () => {
        onChange({ status: 'loading', names: visible() });
        try {
          if (edit && (!editToken || getToken() !== editToken)) throw new Error('account-changed');
          const auth = await getAuth();
          if (!auth) {
            if (getToken()) throw new Error('auth-unavailable');
            if (edit) throw new Error('login-required');
            token = null; names = [];
            onChange({ status: 'signed-out', pending: load(k => storage.getItem(k)).length > 0, names: [] });
            return visible();
          }
          check(auth);
          if (token !== auth.token) { token = auth.token; names = []; }
          let row;
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              row = await read(auth);
              const raw = storage.getItem(KEY);
              // Old settings could persist more than the renderer's cap.
              // Inspect the entire legacy list before deciding it is safe to
              // remove the only device copy.
              const local = parseRoster(raw, Infinity);
              if (local.length) {
                const union = [...new Set([...(row ? row.names : []), ...local])];
                // Never discard legacy names that cannot fit within the cap.
                if (union.length > 24) throw new Error('roster-full');
                row = await write(auth, row, clean(union));
                check(auth);
                // A second tab may have added names while the request ran.
                if (storage.getItem(KEY) !== raw) throw new Error('local-changed');
                storage.removeItem(KEY); // only after confirmed representation
              }
              if (edit) row = await write(auth, row, edit);
              break;
            } catch (error) {
              if (error.message !== 'conflict' || attempt === 2) throw error;
            }
          }
          check(auth);
          names = row ? clean(row.names) : [];
          onChange({ status: 'synced', names: visible() });
          return visible();
        } catch (error) {
          onChange({ status: 'error', code: error.message === 'roster-full' ? 'roster-full' : 'sync-failed', names: visible() });
          throw new Error('roster-sync-failed');
        }
      };
      const result = queue.then(task);
      queue = result.catch(() => {});
      return result;
    }
    return { visible, sync: () => run(), save: value => run(clean(value)) };
  }

  return { KEY, parseRoster, load, toSessions, createSync };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Members;
if (typeof window !== 'undefined') window.OfficeMembers = Members;
