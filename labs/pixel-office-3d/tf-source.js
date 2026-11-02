'use strict';

// Zhuge Office 3D — client-side TaskFlow source, aligned with the VERIFIED
// deployed contract (2026-10-30, api service main@b115764):
//   1. Supabase access token lives in localStorage (zhuge_ai_os_google_auth_session_v1,
//      fallback zhuge_ai_os_session_v1) after the ordinary Zhuge Google login.
//   2. POST {apiBase}/auth/zhuge {access_token} exchanges it for a local JWT.
//   3. GET {apiBase}/api/zhuge/native-ai-tasks needs Authorization: Bearer <jwt>
//      + X-Workspace-Slug header, credentials:'omit'. Cookies/same-origin do NOT
//      authenticate (verified 401 "missing authorization").
// Chain order on the server: 401 missing authorization -> 400 workspace required
// -> 403 workspace member binding mismatch. This module NEVER falls back to
// demo/fixture data: any failure yields an explicit state and an empty board.

// --- pure part (shared with tests) -----------------------------------------

function displayStatus(issueStatus) {
  switch (issueStatus) {
    case 'done': return 'done';
    case 'cancelled': return 'interrupted';
    case 'blocked': return 'waiting';
    case 'in_review': return 'waiting';
    case 'in_progress':
    case 'todo':
    case 'backlog':
    default: return 'idle';
  }
}

// Normalize the full workspace issue list. opts: {projectsById,
// nativeByIssueId, commentsByIssue, now}. Agent queue/executor facts come only
// from the native-ai-tasks merge; human cards stay executor-less (未指派).
function normalizeTfIssues(issues, opts) {
  opts = opts || {};
  const projectsById = opts.projectsById || {};
  const nativeByIssueId = opts.nativeByIssueId || {};
  const commentsByIssue = opts.commentsByIssue || {};
  const now = opts.now || Date.now();
  return (issues || []).map((it, i) => {
    const issueId = (it && (it.id || it.issue_id)) || `issue-${i}`;
    const native = nativeByIssueId[issueId] || null;
    const isAgentCard = !!(it && it.assignee_type === 'agent');
    const category = (it && (it.status_category || it.status)) || 'backlog';
    const labels = commentsByIssue[issueId] || [];
    const identifier = (it && it.identifier) || null;
    const projectTitle = (it && it.project_id && projectsById[it.project_id]) || null;
    const executorId = isAgentCard && native ? (native.executor_id || null) : null;
    return {
      key: `zhuge:${issueId}`,
      agent: 'zhuge',
      agentName: executorId,
      id: issueId,
      sessionId: null,
      parentId: null,
      subagent: false,
      cwd: projectTitle || '',
      project: projectTitle,
      title: `${identifier ? identifier + ' ' : ''}${(it && it.title) || '(無標題)'}`,
      model: executorId,
      status: displayStatus(category),
      stuck: 0,
      context: null,
      today: null,
      activity: null,
      prompt: null,
      reply: null,
      error: null,
      turnStartedAt: null,
      lastEventAt: it && it.updated_at ? Date.parse(it.updated_at) : now,
      startedAt: it && it.updated_at ? Date.parse(it.updated_at) : now,
      history: labels.map((text, j) => ({ role: 'assistant', text, at: now - (labels.length - j) * 60000 })),
      tf: {
        executorId,
        isAgentCard,
        identifier,
        issueStatus: category,
        taskflowTaskStatus: native ? (native.taskflow_task_status || null) : null,
        taskflowTaskId: native ? (native.taskflow_task_id || null) : null,
        providerRuntimeState: 'unverified', // by design, never displayed as fact
        reportLabels: labels,
        excerptGap: labels.length === 0,
        updatedAt: (it && it.updated_at) || null,
      },
    };
  });
}

// Backward-compatible wrapper for the original native-only task shape.
function normalizeTfTasks(tasks, commentsByIssue, now) {
  const nativeByIssueId = {};
  for (const t of tasks || []) if (t && t.issue_id) nativeByIssueId[t.issue_id] = t;
  const issues = (tasks || []).map((t) => ({
    id: t.issue_id,
    title: t.title,
    status_category: t.issue_status,
    project_id: null,
    assignee_type: 'agent',
    updated_at: t.updated_at,
  }));
  const sessions = normalizeTfIssues(issues, { nativeByIssueId, commentsByIssue, now });
  sessions.forEach((s, i) => {
    const t = tasks[i] || {};
    if (t.project_title) { s.project = t.project_title; s.cwd = t.project_title; }
  });
  return sessions;
}

function classifyStatus(status) {
  if (status === 200) return 'ok';
  if (status === 401) return 'auth-required';
  if (status === 403) return 'auth-forbidden';
  return 'error';
}

const TOKEN_KEYS = ['zhuge_ai_os_google_auth_session_v1', 'zhuge_ai_os_session_v1'];

function readSupabaseToken(storageGet) {
  for (const k of TOKEN_KEYS) {
    try {
      const j = JSON.parse(storageGet(k) || 'null');
      if (j && typeof j.access_token === 'string' && j.access_token.length) return j.access_token;
    } catch { /* old/invalid session treated as absent */ }
  }
  return null;
}

// Exchange Supabase token for the local JWT via the app's own /auth/zhuge.
async function exchangeJwt(fetchImpl, apiBase, supaToken) {
  const r = await fetchImpl(`${apiBase}/auth/zhuge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ access_token: supaToken }),
    mode: 'cors',
    credentials: 'omit',
  });
  if (!r || r.status !== 200) return { error: r ? r.status : 'network' };
  const j = await r.json();
  const jwt = j.token || j.Token;
  return jwt ? { jwt } : { error: 'no-token' };
}

// One poll cycle. opts: {apiBase, workspace, storageGet}. Never throws.
async function pollTfOnce(fetchImpl, base, now, opts) {
  opts = opts || {};
  const apiBase = (opts.apiBase || base || '').replace(/\/$/, '');
  if (!opts.workspace) return { state: 'error', note: '缺少工作區設定（workspace_slug）' };
  // The stored Supabase pair outlives any single page. When the access token
  // is due, rotate it through the shared auth-service (loaded by index.html)
  // instead of reporting a false logout. Without a stored session (anonymous
  // visit) nothing changes: the read below yields the signed-out state as
  // before. A terminally dead session is cleared by auth-service itself and
  // the read below yields the honest signed-out state. A recoverable refresh
  // failure (network/5xx) keeps the stored pair; skip this round instead of
  // exchanging the known-stale token into a false terminal banner - the next
  // scheduled poll retries at the existing cadence.
  if (opts.storageGet && typeof getStoredAuthSession === "function" && typeof refreshAuthSession === "function" && typeof accessTokenNeedsRefresh === "function") {
    const storedBefore = getStoredAuthSession();
    if (storedBefore && storedBefore.refresh_token && accessTokenNeedsRefresh()) {
      let refreshed = null;
      try { refreshed = await refreshAuthSession(false); } catch { refreshed = null; }
      if (!refreshed && getStoredAuthSession()) {
        return { state: 'error', note: '連線不穩，將自動重試' };
      }
    }
  }
  const supa = opts.storageGet ? readSupabaseToken(opts.storageGet) : (opts.supabaseToken || null);
  if (!supa) return { state: 'auth-required', note: '需要登入 Zhuge AI OS' };
  let ex;
  try {
    ex = await exchangeJwt(fetchImpl, apiBase, supa);
  } catch (e) {
    return { state: 'error', note: `連線失敗：${e && e.message ? e.message : 'network'}` };
  }
  if (ex.error) return { state: 'auth-required', note: '登入狀態已失效，請重新登入 Zhuge AI OS', server: String(ex.error) };
  let res;
  try {
    res = await fetchImpl(`${apiBase}/api/issues?limit=200`, {
      headers: { authorization: `Bearer ${ex.jwt}`, 'X-Workspace-Slug': opts.workspace, Accept: 'application/json' },
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch (e) {
    return { state: 'error', note: `連線失敗：${e && e.message ? e.message : 'network'}` };
  }
  const cls = classifyStatus(res.status);
  if (cls !== 'ok') {
    let srvMsg = '';
    try { const j = await res.json(); if (j && j.error) srvMsg = String(j.error).slice(0, 120); } catch {}
    if (cls === 'auth-required') return { state: cls, note: '登入狀態已失效，請重新登入 Zhuge AI OS', server: srvMsg };
    if (cls === 'auth-forbidden') return { state: cls, note: '此帳號沒有此工作區權限', server: srvMsg };
    return { state: cls, note: `TaskFlow 暫時無法讀取（HTTP ${res.status}${srvMsg ? `：${srvMsg}` : ''}）`, server: srvMsg };
  }
  let data;
  try { data = await res.json(); } catch { return { state: 'error', note: 'TaskFlow 回應格式異常' }; }
  const issues = data.issues || data.items || [];
  const headers = { authorization: `Bearer ${ex.jwt}`, 'X-Workspace-Slug': opts.workspace, Accept: 'application/json' };
  // Best-effort enrichment; a failed extra read never blocks the task list.
  // Per-poll budget: 1 issues + 1 projects + 1 native + comments for agent
  // cards only (bounded by fetchReportLabels), so an hourly poll stays ~5
  // requests for typical workspaces.
  const projectsById = {};
  try {
    const rp = await fetchImpl(`${apiBase}/api/projects?limit=100`, { headers, mode: 'cors', credentials: 'omit', cache: 'no-store' });
    if (rp && rp.status === 200) {
      const pd = await rp.json();
      for (const p of pd.projects || pd.items || []) if (p && p.id) projectsById[p.id] = p.title || p.name || null;
    }
  } catch { /* project titles fall back to blank */ }
  const nativeByIssueId = {};
  try {
    const rn = await fetchImpl(`${apiBase}/api/zhuge/native-ai-tasks?limit=100&offset=0`, { headers, mode: 'cors', credentials: 'omit', cache: 'no-store' });
    if (rn && rn.status === 200) {
      const nd = await rn.json();
      for (const t of nd.tasks || nd.items || []) if (t && t.issue_id) nativeByIssueId[t.issue_id] = t;
    }
  } catch { /* queue info falls back to blank */ }
  const agentIssueIds = issues.filter((it) => it && it.assignee_type === 'agent').map((it) => ({ issue_id: it.id || it.issue_id }));
  const commentsByIssue = await fetchReportLabels(fetchImpl, apiBase, headers, agentIssueIds);
  const sessions = normalizeTfIssues(issues, { projectsById, nativeByIssueId, commentsByIssue, now });
  return { state: 'ok', sessions, note: '即時連線（Zhuge 登入授權）', total: data.total, schema: data.schema };
}

// Report labels come from the EXISTING authenticated comments endpoint
// (verified live 2026-10-30: GET /api/issues/{id}/comments -> 200, same
// Bearer + X-Workspace-Slug chain). Comments hold only templated "[AI 回報]"
// labels — never raw conversation — so the excerpt gap note stays until a
// real transcript source exists. Best-effort: a failed comments read never
// blocks the task list.
async function fetchReportLabels(fetchImpl, apiBase, headers, tasks) {
  const out = {};
  // Bounded fan-out: at most 5 comment reads in flight, so an hourly poll of
  // a large workspace never bursts the API.
  const queue = [...(tasks || [])];
  async function worker() {
    while (queue.length) {
      const task = queue.shift();
      if (!task || !task.issue_id) continue;
      try {
        const r = await fetchImpl(`${apiBase}/api/issues/${encodeURIComponent(task.issue_id)}/comments`, {
          headers, mode: 'cors', credentials: 'omit', cache: 'no-store',
        });
        if (!r || r.status !== 200) continue;
        const j = await r.json();
        const arr = Array.isArray(j) ? j : (j.comments || j.items || []);
        const labels = arr
          .map((c) => (c && (c.content || c.text || c.body)) || '')
          .filter((x) => typeof x === 'string' && x.trim())
          .slice(0, 20);
        if (labels.length) out[task.issue_id] = labels;
      } catch { /* best-effort: labels stay empty, gap note covers it */ }
    }
  }
  await Promise.all(Array.from({ length: 5 }, worker));
  return out;
}

// Conversation excerpts come from the EXISTING authenticated endpoint
// GET {apiBase}/api/tasks/{taskId}/messages (router.go ListTaskMessagesByUser),
// where taskId is the agent_task_queue id that the native-ai-tasks readback
// already exposes as taskflow_task_id. The server ACLs it to the caller's own
// workspace (cross-workspace reads answer 404), so an excerpt read stays
// inside the signed-in user's own task; it never lists or guesses other
// tasks. Best-effort: any failure yields ok:false and the UI shows an honest
// note instead of content. Payload contract (pkg/protocol/messages.go
// TaskMessagePayload): {task_id, issue_id, seq, type, tool, content, input,
// output, output_truncated, created_at}; type is text | tool_use |
// tool_result | error. Daemon-side redaction trims secrets before persist;
// the UI still renders every field as escaped plain text.
async function fetchTaskMessages(fetchImpl, apiBase, headers, taskId) {
  if (!taskId) return { ok: false, reason: 'no-task' };
  let r;
  try {
    r = await fetchImpl(`${apiBase}/api/tasks/${encodeURIComponent(taskId)}/messages`, {
      headers, mode: 'cors', credentials: 'omit', cache: 'no-store',
    });
  } catch { return { ok: false, reason: 'network' }; }
  if (!r || r.status !== 200) return { ok: false, reason: 'http', status: r && r.status };
  let arr;
  try { arr = await r.json(); } catch { return { ok: false, reason: 'bad-json' }; }
  if (!Array.isArray(arr)) return { ok: false, reason: 'bad-shape' };
  const messages = [];
  for (const m of arr) {
    if (!m || typeof m !== 'object') continue;
    const at = m.created_at ? Date.parse(m.created_at) : null;
    if (m.type === 'text' && typeof m.content === 'string' && m.content.trim()) {
      messages.push({ role: 'assistant', text: m.content, at });
    } else if (m.type === 'tool_use' && m.tool) {
      messages.push({ role: 'tool', text: String(m.tool), at });
    } else if (m.type === 'tool_result' && typeof m.output === 'string' && m.output.trim()) {
      const suffix = m.output_truncated === true ? '…' : '';
      messages.push({ role: 'tool', text: `${m.tool ? m.tool + ': ' : ''}${m.output}${suffix}`, at });
    } else if (m.type === 'error' && typeof m.content === 'string' && m.content.trim()) {
      messages.push({ role: 'assistant', text: m.content, at });
    }
  }
  return { ok: true, messages };
}


// 3D-1 member work overview (ZG-48). Counts and rows come straight from the
// real card list a poll already returned. No member-to-executor binding is
// inferred anywhere: unassigned or unmapped cards are NEVER attributed to a
// character, so the panel must label this as board-wide truth, not the
// member's own assignments.
const MEMBER_OVERVIEW_RANK = { in_review: 0, blocked: 1, in_progress: 2, todo: 3, backlog: 4, done: 5, cancelled: 6 };
// opts.executorIds: the executor ids VERIFIED to belong to one member. When
// given, only cards whose real executor is in the list are counted; every
// other card stays out. Omit it for the board-wide view (the 全看板 entry).
function memberOverview(sessions, opts) {
  const ids = opts && Array.isArray(opts.executorIds) ? opts.executorIds : null;
  const counts = { todo: 0, in_progress: 0, in_review: 0, done: 0 };
  const rows = [];
  for (const s of sessions || []) {
    if (!s || !s.tf) continue; // member/owner sessions carry no card payload
    if (ids && !ids.includes(s.tf.executorId)) continue;
    const st = s.tf.issueStatus || 'backlog';
    if (Object.hasOwn(counts, st)) counts[st] += 1;
    rows.push({ key: s.key, title: s.title || '', issueStatus: st, updatedAt: s.tf.updatedAt || null });
  }
  rows.sort((a, b) =>
    ((MEMBER_OVERVIEW_RANK[a.issueStatus] ?? 9) - (MEMBER_OVERVIEW_RANK[b.issueStatus] ?? 9)) ||
    String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  return { counts, rows };
}

const TfSource = { displayStatus, normalizeTfIssues, normalizeTfTasks, classifyStatus, readSupabaseToken, exchangeJwt, pollTfOnce, fetchReportLabels, fetchTaskMessages, memberOverview, TOKEN_KEYS };
if (typeof module !== 'undefined' && module.exports) module.exports = TfSource;

// --- browser part -----------------------------------------------------------

if (typeof window !== 'undefined') {
  window.ZhugeTfSource = TfSource;
  // Start polling and feed the existing onData pipeline. Interval default 1h,
  // min 60s — faster live polling needs the user's explicit approval.
  window.startTfSource = function startTfSource(opts) {
    const intervalMs = Math.max(60000, (opts.intervalSec || 3600) * 1000);
    let stopped = false;
    // Excerpt reads reuse the exact same auth chain as the hourly poll
    // (stored Supabase token -> /auth/zhuge exchange -> Bearer + workspace
    // slug). No new credential, scope, or permission is introduced.
    window.loadTfTaskExcerpts = async function loadTfTaskExcerpts(taskId) {
      try {
        const storageGet = (k) => { try { return window.localStorage.getItem(k); } catch { return null; } };
        const supa = TfSource.readSupabaseToken(storageGet);
        if (!supa) return { ok: false, reason: 'auth' };
        const ex = await TfSource.exchangeJwt(window.fetch.bind(window), opts.apiBase, supa);
        if (ex.error) return { ok: false, reason: 'auth' };
        const headers = { authorization: `Bearer ${ex.jwt}`, 'X-Workspace-Slug': opts.workspace, Accept: 'application/json' };
        return await TfSource.fetchTaskMessages(window.fetch.bind(window), opts.apiBase, headers, taskId);
      } catch { return { ok: false, reason: 'error' }; }
    };
    async function tick() {
      const r = await TfSource.pollTfOnce(window.fetch.bind(window), opts.base || '', Date.now(), {
        apiBase: opts.apiBase,
        workspace: opts.workspace,
        storageGet: (k) => { try { return window.localStorage.getItem(k); } catch { return null; } },
      });
      if (stopped) return;
      if (r.state === 'ok') {
        opts.onState && opts.onState({ auth: null, error: null });
        opts.onData({ now: Date.now(), sessions: r.sessions, source: 'live-tf', sourceNote: r.note });
      } else if (r.state === 'auth-required' || r.state === 'auth-forbidden') {
        opts.onState && opts.onState({ auth: r.state, error: null });
        opts.onData({ now: Date.now(), sessions: [], source: 'live-tf', sourceNote: r.note });
      } else {
        opts.onState && opts.onState({ auth: null, error: r.note });
      }
    }
    tick();
    const timer = setInterval(tick, intervalMs);
    return () => { stopped = true; clearInterval(timer); };
  };
}
