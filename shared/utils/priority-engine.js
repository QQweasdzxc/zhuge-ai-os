/* Sprint 6.2: shared deterministic AI OS Priority Engine. */
(function (global) {
  const TIME_ZONE = "Asia/Taipei";
  const AI_SCORE_DEFAULT = 0;
  const PRIORITY_WEIGHT = Object.freeze({ p1: 400, p2: 300, p3: 200, p4: 100 });
  const PRIORITY_META = Object.freeze({
    p1: { label: "P1", icon: "🔴", reason: "🔴 P1 高優先" },
    p2: { label: "P2", icon: "🟠", reason: "🟠 P2 優先" },
    p3: { label: "P3", icon: "🟡", reason: "🟡 P3 一般" },
    p4: { label: "P4", icon: "⚪", reason: "⚪ P4 低優先" }
  });

  function dateKey(value = new Date()) {
    const parts = new Intl.DateTimeFormat("zh-TW-u-ca-gregory", {
      timeZone: TIME_ZONE,
      year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(value);
    const map = Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, part.value]));
    return `${map.year}-${map.month}-${map.day}`;
  }

  function normalizePriority(value = "medium") {
    const key = String(value || "medium").trim().toLowerCase();
    return ({
      p1: "p1", "1": "p1", urgent: "p1", high: "p1", 高: "p1", 重要: "p1",
      p2: "p2", "2": "p2", medium: "p2", 中: "p2",
      p3: "p3", "3": "p3", low: "p3", 低: "p3",
      p4: "p4", "4": "p4"
    })[key] || "p2";
  }

  function calculateScore(task = {}, now = new Date()) {
    const today = dateKey(now);
    const due = String(task.dueDate || task.due_date || "").slice(0, 10);
    const priority = normalizePriority(task.priority);
    const priorityScore = PRIORITY_WEIGHT[priority] || PRIORITY_WEIGHT.p2;
    const dueScore = due ? (due < today ? 700 : due === today ? 600 : due <= dateKey(new Date(now.getTime() + 7 * 86400000)) ? 250 : 40) : 0;
    const pinScore = task.pin === true || task.userPinned === true || task.user_pinned === true ? 1000 : 0;
    const aiScore = Number(task.aiScore ?? task.ai_score ?? task.priorityScore ?? task.priority_score ?? AI_SCORE_DEFAULT) || AI_SCORE_DEFAULT;
    return pinScore + dueScore + priorityScore + aiScore;
  }

  function rank(tasks = [], options = {}) {
    const now = options instanceof Date ? options : options.now || new Date();
    const includeCompleted = options.includeCompleted === true;
    return (Array.isArray(tasks) ? tasks : [])
      .filter(task => task && (includeCompleted || (task.status !== "completed" && task.done !== true && task.completed !== true)))
      .slice()
      .sort((a, b) => {
        if (includeCompleted && a.status !== b.status) return a.status === "completed" ? 1 : -1;
        const scoreDelta = calculateScore(b, now) - calculateScore(a, now);
        if (scoreDelta) return scoreDelta;
        const dueA = String(a.dueDate || a.due_date || "9999-12-31");
        const dueB = String(b.dueDate || b.due_date || "9999-12-31");
        return dueA.localeCompare(dueB)
          || String(b.updatedAt || b.updated_at || "").localeCompare(String(a.updatedAt || a.updated_at || ""))
          || String(a.title || a.name || "").localeCompare(String(b.title || b.name || ""), "zh-Hant");
      });
  }

  function getTopTask(tasks = [], options = {}) {
    return rank(tasks, options)[0] || null;
  }

  function getReason(task = {}, now = new Date()) {
    const today = dateKey(now);
    const due = String(task.dueDate || task.due_date || "").slice(0, 10);
    const priority = normalizePriority(task.priority);
    if (due && due < today) return "⚠️ 已逾期";
    if (due === today) return "🔥 今天到期";
    if (task.pin === true || task.userPinned === true || task.user_pinned === true) return "📌 已置頂";
    return PRIORITY_META[priority]?.reason || "依目前工作優先順序。";
  }

  function getPriorityMeta(value) {
    return PRIORITY_META[normalizePriority(value)] || PRIORITY_META.p2;
  }

  // Backward-compatible aliases keep existing Product Layer callers stable while
  // exposing the Sprint 6.2 platform API to every future module.
  global.PriorityEngine = Object.freeze({
    AI_SCORE_DEFAULT,
    PRIORITY_WEIGHT,
    dateKey,
    normalizePriority,
    getPriorityMeta,
    calculateScore,
    score: calculateScore,
    rank,
    getTopTask,
    getReason,
    reason: getReason
  });
})(window);
