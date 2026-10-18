/*
 * Read-only evidence adapter for the isolated P3 office preview.
 *
 * It never connects to TaskFlow or sends credentials. A short-lived, explicit
 * manual handoff may provide a current agent status; public GitHub PR evidence
 * is shown as an unattributed engineering timeline. Neither animation nor an
 * empty event list is used to infer that an agent is working or idle.
 */
(() => {
  "use strict";

  const REPO = "QQweasdzxc/zhuge-ai-os";
  const REPO_PATH = `/${REPO}/`;
  const PR_NUMBER = 65;
  const PR_URL = `https://github.com/${REPO}/pull/${PR_NUMBER}`;
  const API_ROOT = `https://api.github.com/repos/${REPO}`;
  const MAX_EVENT_AGE_MS = 30 * 24 * 60 * 60 * 1000;
  const MAX_STATUS_AGE_MS = 60 * 60 * 1000;
  // A public GitHub API visitor is normally rate-limited to 60 requests/hour.
  // The page refreshes its UI every 30 seconds, so hold the source snapshot
  // for five minutes instead of re-fetching four public endpoints each tick.
  const GITHUB_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
  const MAX_BODY_LENGTH = 180;
  const ALLOWED_ROLE_IDS = new Set(["pm", "co", "gem", "gpt", "betty", "anan", "kaka"]);
  const HANDOFF_STATE_LABELS = Object.freeze({ working: "工作中", reviewing: "審查中", blocked: "受阻", waiting: "等待中", completed: "已交付" });
  const ROLE_INFO = [
    { id: "pm", name: "PM", kind: "operator", role: "PM／最終決策", description: "產品方向、驗收與正式發布決策。" },
    { id: "co", name: "Co", kind: "agent", role: "首席工程師", description: "負責工程實作、整合與 QA。" },
    { id: "gem", name: "Gem", kind: "agent", role: "第二工程師", description: "依交接範圍獨立實作與交付證據。" },
    { id: "gpt", name: "GPT", kind: "agent", role: "PM 助理／協作 AI", description: "協助需求整理、技術審查與驗收。" },
    { id: "betty", name: "Betty", kind: "resident", role: "生活型角色", description: "虛擬居民，常在 Lounge 與休息區活動。", visualActivity: "在 Lounge 休息（虛擬活動）" },
    { id: "anan", name: "安安", kind: "resident", role: "生活型角色", description: "虛擬居民，喜歡閱讀與休閒互動。", visualActivity: "閱讀與休閒互動（虛擬活動）" },
    { id: "kaka", name: "卡卡", kind: "resident", role: "生活型角色", description: "虛擬居民，喜歡活潑走動與休閒互動。", visualActivity: "辦公室散步（虛擬活動）" }
  ];
  let githubCache = null;

  function isIsoDate(value) {
    return typeof value === "string" && Number.isFinite(Date.parse(value));
  }

  function safeGithubUrl(value) {
    if (typeof value !== "string") return "";
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.hostname !== "github.com" || !url.pathname.startsWith(REPO_PATH) || url.username || url.password) return "";
      for (const key of url.searchParams.keys()) {
        if (/token|secret|signature|(^|_)sig(nature)?($|_)|api[_-]?key|authorization/i.test(key)) return "";
      }
      return url.href;
    } catch {
      return "";
    }
  }

  function shortText(value) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, MAX_BODY_LENGTH);
  }

  function buildHandoffEvidence(document, now) {
    const evidence = new Map();
    if (!document || document.schemaVersion !== 1 || !Array.isArray(document.agentUpdates)) return evidence;

    for (const record of document.agentUpdates) {
      if (!record || !ALLOWED_ROLE_IDS.has(record.roleId) || !["co", "gem", "gpt"].includes(record.roleId)) continue;
      if (!Object.hasOwn(HANDOFF_STATE_LABELS, record.state)) continue;
      const sourceUrl = safeGithubUrl(record.sourceUrl);
      if (!sourceUrl || !isIsoDate(record.updatedAt) || !isIsoDate(record.validUntil)) continue;
      if (!shortText(record.label)) continue;
      const updatedAtMs = Date.parse(record.updatedAt);
      const validUntilMs = Date.parse(record.validUntil);
      if (validUntilMs <= updatedAtMs || validUntilMs - updatedAtMs > MAX_STATUS_AGE_MS || updatedAtMs > now + 5 * 60 * 1000) continue;
      const ageMs = Math.max(0, now - updatedAtMs);
      const status = {
        label: `${HANDOFF_STATE_LABELS[record.state]} · ${shortText(record.label)}`,
        sourceType: "confirmed_handoff",
        sourceUrl,
        updatedAt: record.updatedAt,
        ref: shortText(record.ref),
        taskId: null,
        freshnessMs: ageMs,
        validUntil: record.validUntil,
        state: record.state,
        freshness: now >= validUntilMs || ageMs > MAX_STATUS_AGE_MS ? "stale" : "fresh"
      };
      const existing = evidence.get(record.roleId);
      if (!existing || Date.parse(existing.updatedAt) < updatedAtMs) evidence.set(record.roleId, status);
    }
    return evidence;
  }

  async function getJson(url, signal) {
    const response = await fetch(url, {
      method: "GET",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      headers: { Accept: "application/vnd.github+json" },
      signal
    });
    if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
    return response.json();
  }

  function withCurrentFreshness(events, now) {
    return events.map(event => ({ ...event, freshness: ageLabel(event.updatedAt, now) }));
  }

  function validateStaticSnapshot(snapshot, now) {
    if (!snapshot || snapshot.schemaVersion !== 1 || snapshot.repository !== REPO
      || snapshot.prNumber !== PR_NUMBER || !/^[a-f0-9]{40}$/i.test(snapshot.headSha || "")
      || !isIsoDate(snapshot.verifiedAt) || Date.parse(snapshot.verifiedAt) > now + 5 * 60 * 1000
      || !Array.isArray(snapshot.events) || snapshot.events.length > 12) return null;
    const allowedTypes = new Set(["github_pr", "github_commit", "github_comment", "github_actions"]);
    const events = snapshot.events.filter(event => event && event.roleId === null
      && allowedTypes.has(event.sourceType) && isIsoDate(event.updatedAt)
      && safeGithubUrl(event.sourceUrl) && shortText(event.label))
      .map(event => ({
        id: shortText(event.id, 160),
        label: shortText(event.label, 500),
        detail: shortText(event.detail, 500),
        roleId: null,
        sourceType: event.sourceType,
        sourceUrl: safeGithubUrl(event.sourceUrl),
        updatedAt: event.updatedAt,
        ref: shortText(event.ref, 160),
        taskId: null,
        freshness: ageLabel(event.updatedAt, now)
      }));
    if (!events.length) return null;
    return {
      verifiedAt: snapshot.verifiedAt,
      headSha: snapshot.headSha,
      events: events.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 12)
    };
  }

  function ageLabel(iso, now) {
    const time = Date.parse(iso || "");
    if (!Number.isFinite(time) || time > now + 5 * 60 * 1000 || now - time > MAX_EVENT_AGE_MS) return "stale";
    return "fresh";
  }

  function collectGithubEvents({ pr, commits, comments, checks }, now) {
    const events = [];
    const prUrl = safeGithubUrl(pr?.html_url) || PR_URL;

    if (pr && isIsoDate(pr.updated_at)) {
      events.push({
        id: `pr-${PR_NUMBER}-${pr.updated_at}`,
        label: `PR #${PR_NUMBER} · ${shortText(pr.title)}`,
        detail: `狀態：${String(pr.state || "unknown")}${pr.draft ? " · Draft" : ""}`,
        roleId: null,
        sourceType: "github_pr",
        sourceUrl: prUrl,
        updatedAt: pr.updated_at,
        ref: `PR #${PR_NUMBER}`,
        taskId: null,
        freshness: ageLabel(pr.updated_at, now)
      });
    }

    for (const commit of Array.isArray(commits) ? commits : []) {
      const sha = String(commit?.sha || "");
      const date = commit?.commit?.committer?.date || commit?.commit?.author?.date;
      const sourceUrl = safeGithubUrl(commit?.html_url);
      if (!/^[a-f0-9]{40}$/i.test(sha) || !sourceUrl || !isIsoDate(date)) continue;
      events.push({
        id: `commit-${sha}`,
        label: `Commit · ${shortText(commit?.commit?.message?.split("\n")[0]) || sha.slice(0, 12)}`,
        detail: "GitHub 儲存的程式版本事件；未據此推斷工程師目前狀態。",
        roleId: null,
        sourceType: "github_commit",
        sourceUrl,
        updatedAt: date,
        ref: sha.slice(0, 12),
        taskId: null,
        freshness: ageLabel(date, now)
      });
    }

    for (const comment of Array.isArray(comments) ? comments : []) {
      const date = comment?.updated_at || comment?.created_at;
      const sourceUrl = safeGithubUrl(comment?.html_url);
      const body = shortText(comment?.body);
      if (!sourceUrl || !isIsoDate(date) || !body) continue;
      events.push({
        id: `comment-${comment.id}`,
        label: `PR #${PR_NUMBER} 交接／審查留言`,
        detail: body,
        roleId: null,
        sourceType: "github_comment",
        sourceUrl,
        updatedAt: date,
        ref: `PR #${PR_NUMBER}`,
        taskId: null,
        freshness: ageLabel(date, now)
      });
    }

    for (const run of Array.isArray(checks) ? checks : []) {
      const date = run?.completed_at || run?.started_at || run?.created_at;
      const sourceUrl = safeGithubUrl(run?.html_url);
      if (!sourceUrl || !isIsoDate(date)) continue;
      const result = run.conclusion || run.status || "unknown";
      events.push({
        id: `check-${run.id}`,
        label: `GitHub Actions · ${shortText(run.name) || "workflow"} · ${result}`,
        detail: "自動化檢查的實際 GitHub 狀態。",
        roleId: null,
        sourceType: "github_actions",
        sourceUrl,
        updatedAt: date,
        ref: String(run.head_sha || "").slice(0, 12) || `PR #${PR_NUMBER}`,
        taskId: null,
        freshness: ageLabel(date, now)
      });
    }

    return events
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, 12);
  }

  async function load() {
    const now = Date.now();
    const handoffController = new AbortController();
    const githubController = new AbortController();
    const handoffTimer = setTimeout(() => handoffController.abort(), 4500);
    const githubTimer = setTimeout(() => githubController.abort(), 6500);
    const roles = ROLE_INFO.map(role => ({ ...role, statusEvidence: null, events: [] }));
    let handoffStatus = "unavailable";

    try {
      const response = await fetch("./personnel-handoff.json", {
        method: "GET",
        credentials: "omit",
        cache: "no-store",
        signal: handoffController.signal,
        headers: { Accept: "application/json" }
      });
      if (!response.ok) throw new Error(`Handoff HTTP ${response.status}`);
      const manual = await response.json();
      const statuses = buildHandoffEvidence(manual, Date.now());
      for (const [roleId, statusEvidence] of statuses) {
        const role = roles.find(item => item.id === roleId);
        if (role) {
          role.statusEvidence = statusEvidence.freshness === "fresh" ? statusEvidence : null;
          role.events.push({
            id: `handoff-${roleId}-${statusEvidence.updatedAt}`,
            label: statusEvidence.label,
            detail: "經確認的短效人工交接紀錄；逾期後不再代表目前狀態。",
            roleId,
            sourceType: statusEvidence.sourceType,
            sourceUrl: statusEvidence.sourceUrl,
            updatedAt: statusEvidence.updatedAt,
            ref: statusEvidence.ref,
            taskId: null,
            freshness: statusEvidence.freshness
          });
        }
      }
      handoffStatus = [...statuses.values()].some(status => status.freshness === "fresh")
        ? "fresh"
        : statuses.size ? "stale" : "no-current-record";
    } catch {
      handoffStatus = "unavailable";
    } finally {
      clearTimeout(handoffTimer);
    }

    let githubEvents = [];
    let githubStatus = "unavailable";
    let githubNote = "P3 測試區未連接 TaskFlow；GitHub 資料為公開唯讀來源。";
    let sourceRefreshedAt = null;
    if (githubCache && now - githubCache.fetchedAt < GITHUB_REFRESH_INTERVAL_MS) {
      githubEvents = withCurrentFreshness(githubCache.events, Date.now());
      githubStatus = githubCache.status;
      githubNote = githubCache.note;
      sourceRefreshedAt = githubCache.sourceRefreshedAt;
    } else try {
      const pullUrl = `${API_ROOT}/pulls/${PR_NUMBER}`;
      const [prResult, commitsResult, commentsResult] = await Promise.allSettled([
        getJson(pullUrl, githubController.signal),
        getJson(`${API_ROOT}/pulls/${PR_NUMBER}/commits?per_page=12`, githubController.signal),
        getJson(`${API_ROOT}/issues/${PR_NUMBER}/comments?per_page=12`, githubController.signal)
      ]);
      const pr = prResult.status === "fulfilled" ? prResult.value : null;
      const commits = commitsResult.status === "fulfilled" ? commitsResult.value : [];
      const comments = commentsResult.status === "fulfilled" ? commentsResult.value : [];
      let checks = [];
      const sha = String(pr?.head?.sha || "");
      if (/^[a-f0-9]{40}$/i.test(sha)) {
        try {
          const checkData = await getJson(`${API_ROOT}/commits/${sha}/check-runs?per_page=20`, githubController.signal);
          checks = Array.isArray(checkData?.check_runs) ? checkData.check_runs : [];
        } catch {
          checks = [];
        }
      }
      githubEvents = collectGithubEvents({ pr, commits, comments, checks }, Date.now());
      const successes = [prResult, commitsResult, commentsResult].filter(item => item.status === "fulfilled").length;
      githubStatus = successes === 3 ? (githubEvents.length ? "fresh" : "empty") : successes ? "partial" : "unavailable";
      if (successes === 0) {
        try {
          const snapshotController = new AbortController();
          const rawSnapshot = await getJson("./personnel-github-snapshot.json", snapshotController.signal);
          const snapshot = validateStaticSnapshot(rawSnapshot, Date.now());
          if (snapshot) {
            githubEvents = snapshot.events;
            githubStatus = "snapshot";
            sourceRefreshedAt = snapshot.verifiedAt;
            githubNote = `P3 未連接 TaskFlow；GitHub API 無法讀取，改顯示唯讀靜態快照（核對時間 ${snapshot.verifiedAt} · PR HEAD ${snapshot.headSha.slice(0, 12)}）。`;
          }
        } catch {
          // Keep the honest unavailable state when both public sources fail.
        }
      }
      if (!sourceRefreshedAt) sourceRefreshedAt = new Date().toISOString();
      githubCache = { fetchedAt: Date.now(), events: githubEvents, status: githubStatus, note: githubNote, sourceRefreshedAt };
    } catch {
      githubStatus = "unavailable";
      githubNote = "P3 測試區未連接 TaskFlow；GitHub 即時來源與靜態快照目前皆無法讀取。";
      sourceRefreshedAt = new Date().toISOString();
      githubCache = { fetchedAt: Date.now(), events: [], status: githubStatus, note: githubNote, sourceRefreshedAt };
    } finally {
      clearTimeout(githubTimer);
    }

    return {
      roles,
      events: githubEvents,
      refreshedAt: sourceRefreshedAt || new Date().toISOString(),
      sourceStatus: {
        taskflow: "not-connected",
        handoff: handoffStatus,
        github: githubStatus,
        note: githubNote
      }
    };
  }

  window.P3PersonnelEvidence = Object.freeze({ load });
})();
