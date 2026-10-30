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

function normalizeTfTasks(tasks, commentsByIssue, now) {
  commentsByIssue = commentsByIssue || {};
  now = now || Date.now();
  return (tasks || []).map((t, i) => {
    const labels = commentsByIssue[t.issue_id] || [];
    return {
      key: `zhuge:${t.taskflow_task_id || t.issue_id || `task-${i}`}`,
      agent: 'zhuge',
      agentName: t.executor_id,
      id: t.taskflow_task_id || t.issue_id || `task-${i}`,
      sessionId: null,
      parentId: null,
      subagent: false,
      cwd: t.project_title || '',
      project: t.project_title || null,
      title: t.title || '(無標題)',
      model: t.executor_id,
      status: displayStatus(t.issue_status),
      stuck: 0,
      context: null,
      today: null,
      activity: null,
      prompt: null,
      reply: null,
      error: null,
      turnStartedAt: null,
      lastEventAt: t.updated_at ? Date.parse(t.updated_at) : now,
      startedAt: t.updated_at ? Date.parse(t.updated_at) : now,
      history: labels.map((text, j) => ({ role: 'assistant', text, at: now - (labels.length - j) * 60000 })),
      tf: {
        executorId: t.executor_id || null,
        issueStatus: t.issue_status || null,
        taskflowTaskStatus: t.taskflow_task_status || null,
        providerRuntimeState: 'unverified', // by design, never displayed as fact
        reportLabels: labels,
        excerptGap: labels.length === 0,
        updatedAt: t.updated_at || null,
      },
    };
  });
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
    res = await fetchImpl(`${apiBase}/api/zhuge/native-ai-tasks?limit=100&offset=0`, {
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
  const tasks = data.tasks || data.items || [];
  const commentsByIssue = await fetchReportLabels(fetchImpl, apiBase, {
    authorization: `Bearer ${ex.jwt}`, 'X-Workspace-Slug': opts.workspace, Accept: 'application/json',
  }, tasks);
  const sessions = normalizeTfTasks(tasks, commentsByIssue, now);
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

const TfSource = { displayStatus, normalizeTfTasks, classifyStatus, readSupabaseToken, exchangeJwt, pollTfOnce, fetchReportLabels, TOKEN_KEYS };
if (typeof module !== 'undefined' && module.exports) module.exports = TfSource;

// --- browser part -----------------------------------------------------------

if (typeof window !== 'undefined') {
  window.ZhugeTfSource = TfSource;
  // Start polling and feed the existing onData pipeline. Interval default 1h,
  // min 60s — faster live polling needs the user's explicit approval.
  window.startTfSource = function startTfSource(opts) {
    const intervalMs = Math.max(60000, (opts.intervalSec || 3600) * 1000);
    let stopped = false;
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
