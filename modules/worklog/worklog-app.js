// P5.2A-1 Foundation Split: app startup, routing, rendering, and module coordination.
function nextMonthKey(month = monthKey()) {
  const [year, m] = month.split("-").map(Number);
  const d = new Date(year, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function defaultWorkProfileSeed(baseProfile = profile) {
  const firstTask = (Array.isArray(baseProfile?.ecpTasks) ? baseProfile.ecpTasks : []).find(Boolean) || baseProfile?.ecpTask || "";
  const completed = !!(baseProfile?.ecpOwner && baseProfile?.ecpDepartment && firstTask);
  return {
    userUuid: currentUserUuid(),
    ecpResponsiblePerson: baseProfile?.ecpOwner || "",
    ecpDepartment: baseProfile?.ecpDepartment || "",
    defaultTask: firstTask,
    defaultWorkModel: (Array.isArray(baseProfile?.tags) ? baseProfile.tags : []).find(Boolean) || "",
    profileCompleted: completed,
    profileCompletedAt: completed ? new Date().toISOString() : "",
    lastProfileCheckDate: "",
    lastProfilePromptDate: "",
    taskEffectiveMonth: firstTask ? monthKey() : "",
    taskVerifiedAt: firstTask ? new Date().toISOString() : "",
    expiresAt: ""
  };
}

function normalizeWorkProfile(value = {}, baseProfile = profile) {
  const seed = defaultWorkProfileSeed(baseProfile);
  const pick = (camel, snake, fallback = "") => {
    if (Object.prototype.hasOwnProperty.call(value, camel)) return value[camel] ?? "";
    if (Object.prototype.hasOwnProperty.call(value, snake)) return value[snake] ?? "";
    return fallback;
  };
  const result = {
    userUuid: pick("userUuid", "user_uuid", seed.userUuid),
    ecpResponsiblePerson: pick("ecpResponsiblePerson", "ecp_responsible_person", seed.ecpResponsiblePerson),
    ecpDepartment: pick("ecpDepartment", "ecp_department", seed.ecpDepartment),
    defaultTask: pick("defaultTask", "default_task", seed.defaultTask),
    defaultWorkModel: pick("defaultWorkModel", "default_work_model", seed.defaultWorkModel),
    profileCompleted: Boolean(value.profileCompleted ?? value.profile_completed ?? seed.profileCompleted),
    profileCompletedAt: pick("profileCompletedAt", "profile_completed_at", seed.profileCompletedAt),
    lastProfileCheckDate: pick("lastProfileCheckDate", "last_profile_check_date", seed.lastProfileCheckDate),
    lastProfilePromptDate: pick("lastProfilePromptDate", "last_profile_prompt_date", seed.lastProfilePromptDate),
    taskEffectiveMonth: pick("taskEffectiveMonth", "task_effective_month", seed.taskEffectiveMonth),
    taskVerifiedAt: pick("taskVerifiedAt", "task_verified_at", seed.taskVerifiedAt),
    expiresAt: pick("expiresAt", "expires_at", seed.expiresAt)
  };
  result.profileCompleted = !!(result.ecpResponsiblePerson && result.ecpDepartment && result.defaultTask);
  if (!result.profileCompleted) result.profileCompletedAt = "";
  if (result.profileCompleted && !result.profileCompletedAt) result.profileCompletedAt = new Date().toISOString();
  if (result.defaultTask && !result.taskEffectiveMonth) result.taskEffectiveMonth = monthKey();
  if (result.defaultTask && !result.taskVerifiedAt) result.taskVerifiedAt = new Date().toISOString();
  return result;
}

function applyWorkProfileToProfile(nextWorkProfile = workProfile) {
  const p = normalizeWorkProfile(nextWorkProfile);
  if (!profile) profile = { role: "採購", tags: [], sources: ["Google Drive", "手動紀錄"], workHours: "09:00~18:00", lunch: "12:00~13:00", sop: "" };
  profile.ecpOwner = p.ecpResponsiblePerson || "";
  profile.ecpDepartment = p.ecpDepartment || "";
  if (p.defaultTask) {
    const tasks = [...new Set([p.defaultTask, ...ecpTasks()].map(x => String(x || "").trim()).filter(Boolean))];
    setEcpTasks(tasks);
  }
  if (p.defaultWorkModel) {
    const objects = workMemoryObjects();
    if (!objects.some(item => item.name === p.defaultWorkModel)) objects.unshift(normalizeWorkMemoryObject({ name: p.defaultWorkModel, source: "manual", isActive: true }));
    setWorkModels(objects);
  }
  workProfile = p;
  LocalCache.save("work_profile", workProfile);
  return workProfile;
}

function workProfileFromCloud(row = null, exportSettings = null, ecpTaskRows = [], baseProfile = profile) {
  const firstTask = Array.isArray(ecpTaskRows) ? ecpTaskRows.map(row => row.name).find(Boolean) : "";
  return normalizeWorkProfile({
    ...(row || {}),
    ecp_responsible_person: row?.ecp_responsible_person || exportSettings?.ecp_owner || baseProfile?.ecpOwner || "",
    ecp_department: row?.ecp_department || exportSettings?.ecp_department || baseProfile?.ecpDepartment || "",
    default_task: row?.default_task || firstTask || baseProfile?.ecpTask || "",
    default_work_model: row?.default_work_model || (Array.isArray(baseProfile?.tags) ? baseProfile.tags[0] : "")
  }, baseProfile);
}

function workProfileMissingFields(p = workProfile) {
  const next = normalizeWorkProfile(p);
  const missing = [];
  if (!next.ecpResponsiblePerson) missing.push("ECP 負責人");
  if (!next.ecpDepartment) missing.push("ECP 負責部門");
  if (!next.defaultTask) missing.push("目前工作任務");
  return missing;
}

function isWorkProfileReady(p = workProfile) {
  return workProfileMissingFields(p).length === 0;
}

function syncWorkProfileFromProfile() {
  workProfile = normalizeWorkProfile(workProfile || {}, profile);
  return applyWorkProfileToProfile(workProfile);
}

function profileFromCloud(cloudProfile, exportSettings, workModels, ecpTaskRows, options = {}) {
  const workHours = `${String(cloudProfile?.work_start_time || "09:00").slice(0, 5)}~${String(cloudProfile?.work_end_time || "18:00").slice(0, 5)}`;
  const lunch = `${String(cloudProfile?.lunch_start_time || "12:00").slice(0, 5)}~${String(cloudProfile?.lunch_end_time || "13:00").slice(0, 5)}`;
  const fallbackRole = profile?.role || "採購";
  const fallbackTags = Array.isArray(profile?.tags) && profile.tags.length ? profile.tags : tagsForRole(fallbackRole);
  const fallbackEcpTasks = Array.isArray(profile?.ecpTasks) && profile.ecpTasks.length ? profile.ecpTasks : defaultEcpTasks;
  const cloudWorkModels = Array.isArray(workModels) ? workModels.filter(row => row.is_active !== false && row.isActive !== false).map(row => row.name).filter(Boolean) : [];
  const cloudEcpTasks = Array.isArray(ecpTaskRows) ? ecpTaskRows.map(row => row.name).filter(Boolean) : [];
  return {
    ...(profile || {}),
    role: roleName(cloudProfile?.role_code || roleCode(fallbackRole)),
    tags: options.workModelsLoaded ? cloudWorkModels : fallbackTags,
    workHours,
    lunch,
    ecpOwner: exportSettings?.ecp_owner || profile?.ecpOwner || "",
    ecpDepartment: exportSettings?.ecp_department || profile?.ecpDepartment || "",
    ecpTasks: options.ecpTasksLoaded ? cloudEcpTasks : fallbackEcpTasks
  };
}

function entryFromCloud(row) {
  const localAt = formatTaipeiDateTimeInput(row.started_at);
  const entryType = eventTypeNameMap[row.event_type || "WORK"] || "work";
  return {
    id: row.legacy_id || row.id,
    cloudId: row.id,
    date: row.work_date || localAt.slice(0, 10),
    at: localAt,
    title: row.title || "",
    note: row.note || "",
    ecpTask: row.ecp_task_name_snapshot || "",
    hours: Number(row.hours || 0),
    entryType,
    type: eventTypeLabel(entryType),
    status: row.status || "completed",
    source: row.source || "manual",
    taskUuid: row.task_uuid || "",
    taskTitleSnapshot: row.task_title_snapshot || ""
  };
}

function setEntries(nextEntries = []) {
  entries = Array.isArray(nextEntries) ? nextEntries : [];
  normalizeEntries();
  LocalCache.save("entries", entries);
}

function setLibrary(nextLibrary = []) {
  library = Array.isArray(nextLibrary) ? nextLibrary.map(normalizedLibraryItem) : [];
  LocalCache.save("library", library);
}

function uid(prefix = "wl") {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch]));
}

function normalizeEntries() {
  let changed = false;
  entries = entries.map(e => {
    const next = { ...e };
    if (!next.id) { next.id = uid(); changed = true; }
    const normalizedEntryType = normalizeEntryType(next.entryType || next.type || "work");
    if (next.entryType !== normalizedEntryType) { next.entryType = normalizedEntryType; changed = true; }
    const entryTypeName = eventTypeLabel(normalizedEntryType);
    if (next.type !== entryTypeName) { next.type = entryTypeName; changed = true; }
    if (next.note == null) {
      next.note = next.task && next.task !== next.title ? next.task : "";
      changed = true;
    }
    if (next.task != null) { delete next.task; changed = true; }
    if (next.ecpTask == null) { next.ecpTask = ""; changed = true; }
    return next;
  });
  library = library.map(item => item.id ? item : { ...item, id: uid("lib") });
  if (changed) saveAll();
}

function validateEntry(item) {
  if (!item.title) return "請輸入工作描述";
  if (worklogDescriptionLength(item.title) > WORKLOG_DESCRIPTION_MAX_LENGTH) return `工作描述不可超過 ${WORKLOG_DESCRIPTION_MAX_LENGTH} 個字元`;
  if (!item.at || Number.isNaN(new Date(item.at).getTime())) return "請選擇正確時間";
  if (!item.hours || item.hours <= 0) return "請選擇工時";
  if (item.hours > 8) return "單筆工時不可超過 8 小時";
  const sameDayHours = entries
    .filter(e => e.date === item.date && e.id !== item.id)
    .reduce((s, e) => s + Number(e.hours || 0), 0);
  if (sameDayHours + Number(item.hours) > 12) return "同日工時已超過 12 小時，請確認是否輸入錯誤";
  if (worklogTimeConflicts(item)) return "這段時間與既有工時重疊，請調整日期或開始時間";
  return "";
}

function worklogDescriptionLength(value = "") {
  return Array.from(String(value || "")).length;
}

function worklogTimeConflicts(item = {}) {
  const date = String(item.date || item.at || "").slice(0, 10);
  const start = entryStartMinutes(item);
  const end = start + Math.max(1, Math.round(Number(item.hours || 0) * 60));
  return entries.some(entry => {
    if (entry.id === item.id || entry.status === "deleted" || entry.date !== date) return false;
    const existingStart = entryStartMinutes(entry);
    const existingEnd = entryEndMinutes(entry);
    return start < existingEnd && end > existingStart;
  });
}

function saveAll(options = {}) {
  saveLocalSnapshot();
}

function saveLocalSnapshot() {
  localStorage.setItem("wl_profile", JSON.stringify(profile));
  localStorage.setItem("wl_work_profile", JSON.stringify(workProfile));
  localStorage.setItem("wl_feedback", JSON.stringify(feedback));
  localStorage.setItem(AI_OS_SESSION_KEY, JSON.stringify(session));
  localStorage.removeItem("wl_session");
  // P5: wl_library remains legacy backup only. Official Knowledge cache is user-scoped LocalCache.
  localStorage.setItem(ACTIVE_MODULE_KEY, activeModule);
  localStorage.setItem(OS_OPEN_TABS_KEY, JSON.stringify(openTabs));
  localStorage.setItem(OS_ACTIVE_WORKSPACE_KEY, activeWorkspace);
  localStorage.setItem(OS_RECENT_WORKSPACES_KEY, JSON.stringify(recentWorkspaces));
  hasOsShellState = true;
  localStorage.setItem("wl_view", view);
  localStorage.setItem("wl_selected", selected.toISOString());
  localStorage.setItem("wl_selected_month", selectedMonth);
  saveTasks();
  LocalCache.saveAll();
}

function taskStorageKey() {
  return scopedLocalKey(TASKS_KEY);
}

// Sprint 7: drafts are intentionally local and user-scoped. They are never
// sent to Supabase until the user explicitly presses 建立/儲存.
function taskDraftStorageKey(taskId = "new") {
  return scopedLocalKey(`task_draft_${taskId || "new"}`);
}

function loadTaskDraft(taskId = "new") {
  try { return readJson(taskDraftStorageKey(taskId), null); } catch { return null; }
}

function saveTaskDraft(taskId = "new", draft = {}) {
  const next = { ...draft, updatedAt: new Date().toISOString() };
  taskDraft = next;
  localStorage.setItem(taskDraftStorageKey(taskId), JSON.stringify(next));
  return next;
}

function clearTaskDraft(taskId = "new") {
  taskDraft = null;
  localStorage.removeItem(taskDraftStorageKey(taskId));
}

const TASK_WORKFLOW_STATUSES = Object.freeze([
  "not_started", "in_progress", "waiting_reply", "waiting_acceptance", "blocked", "completed"
]);
const TASK_WORKFLOW_STATUS_LABELS = Object.freeze({
  not_started: "待開始",
  in_progress: "進行中",
  waiting_reply: "等待回覆",
  waiting_acceptance: "等待驗收",
  blocked: "阻塞",
  completed: "完成"
});

function normalizeTaskStatus(value = "not_started", item = {}) {
  const raw = String(value || "").trim().toLowerCase();
  const aliases = { open: "not_started", todo: "not_started", "in progress": "in_progress", waiting: "waiting_reply", done: "completed", complete: "completed" };
  const status = aliases[raw] || raw;
  if (TASK_WORKFLOW_STATUSES.includes(status)) return status;
  return item.startedAt || item.started_at ? "in_progress" : "not_started";
}

function taskStatusLabel(value = "not_started") {
  return TASK_WORKFLOW_STATUS_LABELS[normalizeTaskStatus(value)] || TASK_WORKFLOW_STATUS_LABELS.not_started;
}

function taskProgressValue(value = 0) {
  return Math.max(0, Math.min(100, Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0));
}

function taskWorkflowBadge(task = {}) {
  const status = normalizeTaskStatus(task.status, task);
  const progress = status === "completed" ? 100 : taskProgressValue(task.progress);
  return `<span class="task-workflow-badge task-status-${status}">${escapeHtml(taskStatusLabel(status))} · ${progress}%</span>`;
}

function taskStatusOptions(selected = "not_started") {
  return TASK_WORKFLOW_STATUSES.map(status => `<option value="${status}" ${selected === status ? "selected" : ""}>${escapeHtml(TASK_WORKFLOW_STATUS_LABELS[status])}</option>`).join("");
}

function normalizeTask(item = {}) {
  const title = String(item.title || item.name || "").trim();
  const clientId = item.legacy_id || item.clientId || item.client_id || item.id || uid("task");
  const priority = typeof PriorityEngine !== "undefined"
    ? PriorityEngine.normalizePriority(item.priority)
    : String(item.priority || "p2").toLowerCase();
  const status = normalizeTaskStatus(item.status, item);
  return {
    id: String(clientId),
    cloudId: String(item.cloudId || item.cloud_id || (item.legacy_id ? item.id || "" : "")),
    title,
    note: String(item.note || "").trim(),
    dueDate: String(item.dueDate || item.deadline || item.due_date || "").slice(0, 10),
    status,
    progress: status === "completed" ? 100 : taskProgressValue(item.progress),
    priority,
    priorityScore: Number(item.priorityScore ?? item.priority_score ?? 0) || 0,
    sortScore: Number(item.sortScore ?? item.sort_score ?? 0) || 0,
    userPinned: item.pin === true || item.userPinned === true || item.user_pinned === true,
    estimatedMinutes: Number(item.estimatedMinutes ?? item.estimated_minutes ?? 0) || 0,
    createdAt: item.createdAt || new Date().toISOString(),
    updatedAt: item.updatedAt || item.updated_at || item.createdAt || new Date().toISOString(),
    completedAt: item.completedAt || item.completed_at || "",
    startedAt: item.startedAt || item.started_at || "",
    completedNote: String(item.completedNote || item.completed_note || "").trim(),
    completedBy: item.completedBy || item.completed_by || "",
    completionSource: item.completionSource || item.completion_source || "manual"
  };
}

function loadTasksForSession() {
  // LocalStorage is a cache only.  The authoritative task list is hydrated by
  // DataService from Supabase before the authenticated workspace is trusted.
  tasks = [];
}

function saveTasks() {
  if (!currentUserUuid()) return;
  LocalCache.save("tasks", tasks.map(normalizeTask));
  if (typeof DataService !== "undefined") DataService.queueAutoSave("tasks");
}

function setTasksFromCloud(rows = []) {
  tasks = (Array.isArray(rows) ? rows : []).map(normalizeTask).filter(item => item.title);
  LocalCache.save("tasks", tasks);
  return tasks;
}

// Sprint 7.2: Work Journal is a first-class cloud domain.  The task only
// stores its current snapshot; every progress note is retained in this 1:N
// timeline and is never folded into task.note.
function normalizeWorkJournalEntry(row = {}) {
  return {
    id: String(row.id || row.client_id || uid("journal")),
    cloudId: String(row.id || row.cloudId || ""),
    clientId: String(row.client_id || row.clientId || row.id || uid("journal")),
    taskUuid: String(row.task_uuid || row.taskUuid || ""),
    entryType: String(row.entry_type || row.entryType || "progress"),
    content: String(row.content || "").trim(),
    status: row.status ? normalizeTaskStatus(row.status) : "",
    progress: taskProgressValue(row.progress),
    workEntryUuid: String(row.work_entry_uuid || row.workEntryUuid || ""),
    metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : {},
    createdBy: String(row.created_by || row.createdBy || ""),
    createdAt: row.created_at || row.createdAt || new Date().toISOString(),
    updatedAt: row.updated_at || row.updatedAt || row.created_at || new Date().toISOString()
  };
}

function setWorkJournalFromCloud(rows = []) {
  workJournalEntries = (Array.isArray(rows) ? rows : [])
    .map(normalizeWorkJournalEntry)
    .filter(entry => entry.taskUuid && entry.content)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  LocalCache.save("work_journal", workJournalEntries);
  return workJournalEntries;
}

function upsertWorkJournalEntry(row = {}) {
  const next = normalizeWorkJournalEntry(row);
  const key = next.cloudId || next.clientId;
  workJournalEntries = [...workJournalEntries.filter(item => (item.cloudId || item.clientId) !== key), next]
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  LocalCache.save("work_journal", workJournalEntries);
  return next;
}

function taskCloudUuid(task = {}) {
  return String(task.cloudId || "").trim();
}

function taskWorklogEntries(task = {}) {
  const ids = new Set([String(task.id || ""), taskCloudUuid(task)].filter(Boolean));
  return entries.filter(entry => ids.has(String(entry.taskUuid || "")));
}

function taskWorklogHours(task = {}) {
  return taskWorklogEntries(task).reduce((total, entry) => total + (Number(entry.hours) || 0), 0);
}

function taskCompletionElapsedHours(task = {}, completedAt = new Date().toISOString()) {
  if (!task.startedAt) return 0;
  const start = new Date(task.startedAt).getTime();
  const end = new Date(completedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.max(0.5, Math.round(((end - start) / 3600000) * 2) / 2);
}

function workJournalForTask(task = {}) {
  const cloudId = taskCloudUuid(task);
  if (!cloudId) return [];
  return workJournalEntries.filter(entry => entry.taskUuid === cloudId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

function journalEntryTypeLabel(value = "progress") {
  return ({ progress: "進度更新", status_change: "狀態變更", worklog: "工時紀錄", note: "工作筆記", completion: "結案紀錄" })[value] || "工作推進";
}

async function openTaskJournal(taskId = "") {
  const task = tasks.find(item => item.id === taskId);
  if (!task) return;
  taskJournalTaskId = task.id;
  taskJournalDraft = null;
  taskJournalLoading = true;
  render("journal-open");
  try {
    if (!taskCloudUuid(task)) throw new Error("此待辦事項尚未完成 Cloud 建立，請先儲存後再新增工作紀錄");
    const rows = await DataService.loadWorkJournal(taskCloudUuid(task));
    const other = workJournalEntries.filter(entry => entry.taskUuid !== taskCloudUuid(task));
    setWorkJournalFromCloud([...other, ...(rows || [])]);
  } catch (error) {
    console.error("Work Journal load failed", error);
    toast(error.message || "工作紀錄載入失敗");
  } finally {
    taskJournalLoading = false;
    render("journal-loaded");
  }
}

async function saveTaskJournal(taskId = "") {
  let task = tasks.find(item => item.id === taskId);
  const content = document.getElementById("taskJournalContent")?.value?.trim() || "";
  if (!task || !content) return toast("請輸入工作推進紀錄");
  const isFirstJournal = workJournalForTask(task).length === 0;
  const journalStartedAt = task.startedAt || new Date().toISOString();
  const updateStatus = document.getElementById("taskJournalUpdateStatus")?.checked === true;
  const updateProgress = document.getElementById("taskJournalUpdateProgress")?.checked === true;
  let status = updateStatus ? normalizeTaskStatus(document.getElementById("taskJournalStatus")?.value || task.status, task) : normalizeTaskStatus(task.status, task);
  let progress = updateProgress ? taskProgressValue(document.getElementById("taskJournalProgress")?.value || task.progress) : taskProgressValue(task.progress);
  if (isFirstJournal && status !== "completed") {
    status = "in_progress";
    progress = Math.max(1, progress);
  }
  if (updateStatus && status === "completed") progress = 100;
  try {
    if (!taskCloudUuid(task)) {
      await DataService.saveTasksNow(tasks);
      task = tasks.find(item => item.id === taskId);
    }
    const cloudTaskUuid = taskCloudUuid(task);
    if (!cloudTaskUuid) throw new Error("待辦事項尚未取得 Cloud UUID，請先儲存待辦事項");
    const saved = await DataService.saveWorkJournalEntry({
      taskUuid: cloudTaskUuid,
      entryType: status === "completed" ? "completion" : "progress",
      content,
      status,
      progress,
      metadata: { source: "task-workspace", previousStatus: task.status, previousProgress: task.progress, updateStatus, updateProgress, autoStarted: isFirstJournal && task.status !== "completed", startedAt: isFirstJournal && task.status !== "completed" ? journalStartedAt : task.startedAt }
    });
    if (updateStatus || updateProgress || (isFirstJournal && task.status !== "completed")) {
      tasks = tasks.map(item => item.id === task.id ? normalizeTask({ ...item, status, progress, startedAt: isFirstJournal && item.status !== "completed" ? journalStartedAt : item.startedAt, completedAt: updateStatus && status === "completed" ? new Date().toISOString() : item.completedAt, completedNote: updateStatus && status === "completed" ? content : item.completedNote, completedBy: updateStatus && status === "completed" ? currentUserUuid() : item.completedBy, updatedAt: new Date().toISOString() }) : item);
      await DataService.saveTasksNow(tasks);
    }
    upsertWorkJournalEntry(saved);
    taskJournalDraft = null;
    toast(isFirstJournal && task.status !== "completed" ? "工作已開始，推進紀錄已儲存至 Cloud" : "工作推進紀錄已儲存至 Cloud");
    render("journal-saved");
  } catch (error) {
    console.error("Work Journal save failed", { error, taskId });
    toast(error.message || "工作紀錄同步失敗，未完成儲存");
  }
}

function taskListItems() {
  const search = taskSearch.trim().toLowerCase();
  const filtered = tasks
    .filter(task => taskFilter === "all" || (taskFilter === "open" ? task.status !== "completed" : task.status === "completed"))
    .filter(task => !search || `${task.title} ${task.note}`.toLowerCase().includes(search));
  return typeof PriorityEngine !== "undefined"
    ? PriorityEngine.rank(filtered, { includeCompleted: true })
    : filtered;
}

function taskPriorityOptions(selected = "p2") {
  const options = [
    ["p1", "🔴 P1", "最高優先"],
    ["p2", "🟠 P2", "優先"],
    ["p3", "🟡 P3", "一般"],
    ["p4", "⚪ P4", "低優先"]
  ];
  return options.map(([value, label, hint]) => `<label class="task-priority-option"><input type="radio" name="taskPriority" value="${value}" ${selected === value ? "checked" : ""}><span>${label}</span><small>${hint}</small></label>`).join("");
}

function taskPriorityBadge(task = {}) {
  const meta = typeof PriorityEngine !== "undefined" ? PriorityEngine.getPriorityMeta(task.priority) : { label: "P2", icon: "🟠" };
  const reason = typeof PriorityEngine !== "undefined" ? PriorityEngine.getReason(task) : "依目前工作優先順序。";
  return `<span class="task-priority-badge task-priority-${meta.label.toLowerCase()}" title="${escapeHtml(reason)}">${meta.icon} ${meta.label}</span>`;
}

function legacyTaskWorkspace() {
  const editing = tasks.find(task => task.id === editingTaskId) || null;
  const list = taskListItems();
  const form = `<section class="task-form"><div class="panel-head"><div><h3>${editing ? "✏️ 編輯待辦事項" : "＋ 新增待辦事項"}</h3><div class="muted">把需要完成的事情留下來，完成後再標記即可。</div></div></div><label>待辦事項名稱</label><input class="input" id="taskTitle" value="${escapeHtml(editing?.title || "")}" placeholder="例如：寄出採購資料"><label>備註（選填）</label><textarea class="input" id="taskNote" rows="2" placeholder="補充說明">${escapeHtml(editing?.note || "")}</textarea><label>期限（選填）</label><input class="input" id="taskDueDate" type="date" value="${escapeHtml(editing?.dueDate || "")}"><fieldset class="task-priority-fieldset"><legend>Priority</legend><div class="task-priority-options">${taskPriorityOptions(editing?.priority || "p2")}</div><label class="task-pin-option"><input type="checkbox" id="taskPinned" ${editing?.userPinned ? "checked" : ""}> 📌 置頂</label></fieldset><div class="form-actions"><button class="btn2" type="button" data-task-cancel="1" ${editing ? "" : "disabled"}>取消</button><button class="btn" type="button" data-task-save="1">${editing ? "儲存修改" : "建立待辦事項"}</button></div></section>`;
  const rows = list.length ? list.map(task => `<div class="entry task-row ${task.status === "completed" ? "task-completed" : ""}"><div class="entry-main"><div class="task-row-title">${taskPriorityBadge(task)} <b>${task.status === "completed" ? "✅" : "⬜"} ${escapeHtml(task.title)}</b></div><small>${task.dueDate ? `期限：${escapeHtml(task.dueDate)}` : "無期限"}｜${escapeHtml(typeof PriorityEngine !== "undefined" ? PriorityEngine.getReason(task) : "依目前工作優先順序。")}${task.note ? `｜${escapeHtml(task.note)}` : ""}</small></div><div class="actions compact"><button class="btn2" type="button" data-task-toggle="${escapeHtml(task.id)}">${task.status === "completed" ? "恢復" : "完成"}</button><button class="btn2" type="button" data-task-edit="${escapeHtml(task.id)}">編輯</button><button class="btn2 danger" type="button" data-task-delete="${escapeHtml(task.id)}">刪除</button></div></div>`).join("") : `<div class="empty"><b>${taskSearch ? "找不到符合的待辦事項" : "目前還沒有待辦事項"}</b><div class="muted">可以從上方建立第一個待辦事項，或在 Mr. KM 對話中說：「提醒我寄採購資料」。</div></div>`;
  return `<section class="panel tasks-workspace" style="margin-top:18px"><div class="panel-head"><div><h2>✅ 待辦事項</h2><div class="muted">目前 ${tasks.length} 項｜未完成 ${tasks.filter(task => task.status === "open").length} 項</div></div><button class="btn2" type="button" data-task-new="1">＋ 新增待辦事項</button></div>${form}<section class="task-list-section"><div class="task-toolbar"><div class="task-filters">${["all", "open", "completed"].map(filter => `<button class="btn2 ${taskFilter === filter ? "selected" : ""}" type="button" data-task-filter="${filter}">${filter === "all" ? "全部" : filter === "open" ? "未完成" : "已完成"}</button>`).join("")}</div><div class="task-search"><input class="input" id="taskSearch" value="${escapeHtml(taskSearch)}" placeholder="搜尋待辦事項"><button class="btn2" type="button" data-task-search-submit="1">搜尋</button></div></div><div class="task-list">${rows}</div></section></section>`;
}

// Sprint 7 lifecycle workspace. This later declaration intentionally replaces
// the legacy task renderer without touching the validated worklog layout.
function taskWorkspaceV7() {
  const editing = tasks.find(task => task.id === editingTaskId) || null;
  const list = taskListItems();
  const draft = loadTaskDraft(editingTaskId || "new") || {};
  const value = (key, fallback = "") => editing ? (draft[key] ?? editing[key] ?? fallback) : (draft[key] ?? fallback);
  const form = `<section class="task-form"><div class="panel-head"><div><h3>${editing ? "✏️ 編輯待辦事項" : "＋ 新增待辦事項"}</h3><div class="muted">草稿只保存在本機；按下建立或儲存後才會同步雲端。</div></div></div><label>待辦事項名稱</label><input class="input" id="taskTitle" value="${escapeHtml(value("title"))}" placeholder="例如：寄出採購資料"><label>備註（選填）</label><textarea class="input" id="taskNote" rows="3" placeholder="補充說明">${escapeHtml(value("note"))}</textarea><label>期限（選填）</label><input class="input task-date-input" id="taskDueDate" type="date" value="${escapeHtml(value("dueDate"))}"><fieldset class="task-priority-fieldset"><legend>Priority</legend><div class="task-priority-options">${taskPriorityOptions(value("priority", editing?.priority || "p2"))}</div><label class="task-pin-option"><input type="checkbox" id="taskPinned" ${value("userPinned", editing?.userPinned) ? "checked" : ""}> 📌 置頂</label></fieldset><div class="form-actions"><button class="btn2" type="button" data-task-cancel="1" ${editing ? "" : "disabled"}>取消</button><button class="btn" type="button" data-task-save="1">${editing ? "儲存修改" : "建立待辦事項"}</button></div></section>`;
  const rows = list.length ? list.map(task => `<article class="entry task-row ${task.status === "completed" ? "task-completed" : ""}" data-task-card="${escapeHtml(task.id)}"><div class="entry-main"><div class="task-row-title">${taskPriorityBadge(task)} <b>${task.status === "completed" ? "✅" : "⬜"} ${escapeHtml(task.title)}</b></div><small>${task.dueDate ? `期限：${escapeHtml(task.dueDate)}` : "無期限"}｜${escapeHtml(typeof PriorityEngine !== "undefined" ? PriorityEngine.getReason(task) : "依目前工作優先順序。")} ${task.note ? `｜${escapeHtml(task.note)}` : ""}</small>${task.status === "completed" && task.completedNote ? `<div class="task-completion-note">完成說明：${escapeHtml(task.completedNote)}</div>` : ""}</div><div class="actions compact"><button class="btn2" type="button" data-task-start="${escapeHtml(task.id)}" ${task.status === "completed" ? "disabled" : ""}>${task.startedAt ? "繼續工作" : "開始工作"}</button><button class="btn2" type="button" data-task-toggle="${escapeHtml(task.id)}">${task.status === "completed" ? "恢復" : "完成"}</button><button class="btn2" type="button" data-task-edit="${escapeHtml(task.id)}">編輯</button><button class="btn2 danger" type="button" data-task-delete="${escapeHtml(task.id)}">刪除</button></div></article>`).join("") : `<div class="empty"><b>${taskSearch ? "找不到符合的待辦事項" : "目前還沒有待辦事項"}</b><div class="muted">可以從上方建立第一個待辦事項，或在 Mr. KM 對話中說：「提醒我寄採購資料」。</div></div>`;
  const completionTask = taskCompletionDialogId ? tasks.find(task => task.id === taskCompletionDialogId) : null;
  const dialog = completionTask ? `<div class="quick-add-dialog task-completion-dialog" role="dialog" aria-modal="true"><div class="quick-add-card"><h3>完成待辦事項</h3><p>請留下完成說明，讓 Mr. KM 了解這次工作的結果。</p><label for="taskCompletionNote">完成說明</label><textarea class="input" id="taskCompletionNote" rows="4" placeholder="例如：已完成施工並驗收，客戶確認無誤。"></textarea><div class="form-actions"><button class="btn2" type="button" data-task-completion-cancel>取消</button><button class="btn" type="button" data-task-completion-confirm>儲存並完成</button></div></div></div>` : "";
  return `<section class="panel tasks-workspace lifecycle-task-workspace" style="margin-top:18px"><div class="panel-head"><div><h2>✅ 待辦事項</h2><div class="muted">目前 ${tasks.length} 項｜未完成 ${tasks.filter(task => task.status === "open").length} 項</div></div><button class="btn2" type="button" data-task-new="1">＋ 新增待辦事項</button></div><div class="task-workspace-grid"><section class="task-list-section"><div class="task-toolbar"><div class="task-filters">${["all", "open", "completed"].map(filter => `<button class="btn2 ${taskFilter === filter ? "selected" : ""}" type="button" data-task-filter="${filter}">${filter === "all" ? "全部" : filter === "open" ? "未完成" : "已完成"}</button>`).join("")}</div><div class="task-search"><span aria-hidden="true">🔍</span><input class="input" id="taskSearch" value="${escapeHtml(taskSearch)}" placeholder="搜尋待辦事項"><button class="btn2 task-search-clear" type="button" data-task-search-clear aria-label="清除搜尋">✕</button></div></div><div class="task-list">${rows}</div></section>${form}</div>${dialog}</section>`;
}

function toast(t) {
  const e = document.createElement("div");
  e.className = "toast";
  e.textContent = t;
  document.body.appendChild(e);
  setTimeout(() => e.classList.add("show"), 10);
  setTimeout(() => { e.classList.remove("show"); setTimeout(() => e.remove(), 220); }, 1800);
}

function workProfileSyncDiagnostic(error = {}) {
  const rootError = error?.cause || error || {};
  const supabase = error?.supabase || rootError?.supabase || {};
  const stageMap = {
    user_profile: "使用者設定 user_profiles",
    export_settings: "匯出設定 user_export_settings",
    work_profile: "工作身分 user_work_profiles",
    ecp_tasks: "ECP 任務",
    unknown: "未識別同步階段"
  };
  const stage = error?.syncStage || rootError?.syncStage || "unknown";
  const status = Number(supabase.status || 0);
  const code = String(supabase.code || error?.code || rootError?.code || "");
  const message = String(supabase.message || error?.message || rootError?.message || "工作身分同步失敗");
  const path = String(supabase.path || "");
  let source = "ZIP 程式／前端狀態";
  let suggestion = "請重新整理頁面並重新登入後再試；若仍失敗，請提供本診斷內容。";
  if (status || path || supabase.message) {
    source = "Supabase API／資料庫設定";
    suggestion = "請依 API、狀態碼與錯誤代碼檢查 Supabase Table、RLS Policy、欄位或 Constraint。";
  }
  if (status === 401 || code === "AUTH_SESSION_EXPIRED") {
    source = "登入工作階段／Token";
    suggestion = "請重新整理頁面並重新登入；若立即再次發生，需檢查 Shared Session Refresh。";
  } else if (status === 403 || code === "42501") {
    suggestion = "Supabase 已收到請求但拒絕寫入，優先檢查該資料表的 RLS INSERT／UPDATE Policy。";
  } else if (status === 404 || code === "42P01" || /relation .* does not exist|schema cache/i.test(message)) {
    suggestion = "優先確認資料表是否存在，以及 Supabase API Schema Cache 是否已更新。";
  } else if (status === 409 || /^23/.test(code)) {
    suggestion = "優先檢查唯一鍵、外鍵、NOT NULL 或資料型態 Constraint。";
  }
  return {
    stage,
    stageLabel: stageMap[stage] || stage,
    source,
    suggestion,
    path,
    method: String(supabase.method || ""),
    status: status || "—",
    code: code || "—",
    message,
    details: String(supabase.details || ""),
    hint: String(supabase.hint || ""),
    tokenExpiresAt: String(supabase.access_token_expires_at || "")
  };
}

function showWorkProfileSyncDiagnostic(error = {}) {
  const diagnostic = workProfileSyncDiagnostic(error);
  const existing = document.querySelector("[data-work-profile-diagnostic]");
  if (existing) existing.remove();
  const overlay = document.createElement("div");
  overlay.className = "quick-add-dialog";
  overlay.dataset.workProfileDiagnostic = "1";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.style.display = "grid";
  const rows = [
    ["判斷來源", diagnostic.source],
    ["失敗階段", diagnostic.stageLabel],
    ["API", [diagnostic.method, diagnostic.path].filter(Boolean).join(" ") || "—"],
    ["HTTP 狀態", String(diagnostic.status)],
    ["錯誤代碼", diagnostic.code],
    ["錯誤訊息", diagnostic.message],
    ["詳細資訊", diagnostic.details || "—"],
    ["Supabase Hint", diagnostic.hint || "—"],
    ["Token 到期時間", diagnostic.tokenExpiresAt || "—"]
  ];
  const report = rows.map(([label, value]) => `${label}: ${value}`).join("\n") + `\n建議: ${diagnostic.suggestion}`;
  overlay.innerHTML = `<div class="quick-add-card" style="max-width:760px"><div class="panel-head"><div><h3>工作身分同步診斷</h3><div class="muted">此畫面不顯示 Access Token 或敏感資料。</div></div></div><div style="display:grid;gap:10px;margin-top:14px">${rows.map(([label, value]) => `<div style="display:grid;grid-template-columns:minmax(120px,160px) 1fr;gap:12px;padding:9px 0;border-bottom:1px solid rgba(148,163,184,.18)"><strong>${escapeHtml(label)}</strong><span style="overflow-wrap:anywhere">${escapeHtml(value)}</span></div>`).join("")}</div><div class="panel" style="margin-top:14px;padding:12px"><strong>建議處理</strong><div style="margin-top:6px">${escapeHtml(diagnostic.suggestion)}</div></div><div class="form-actions"><button class="btn2" type="button" data-copy-work-profile-diagnostic>複製診斷</button><button class="btn" type="button" data-close-work-profile-diagnostic>關閉</button></div></div>`;
  document.body.appendChild(overlay);
  overlay.querySelector("[data-close-work-profile-diagnostic]")?.addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", event => { if (event.target === overlay) overlay.remove(); });
  overlay.querySelector("[data-copy-work-profile-diagnostic]")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(report);
      toast("診斷內容已複製");
    } catch {
      console.info("Work Profile sync diagnostic", report);
      toast("無法存取剪貼簿，診斷內容已輸出至 Console");
    }
  });
}

function showCreatedWorklogToast(item = {}) {
  const e = document.createElement("div");
  e.className = "toast worklog-created-toast";
  const timeRange = formatWorklogTimeRange(item);
  e.innerHTML = `<div><strong>✅ 已建立工時</strong><span>${escapeHtml(timeRange)}｜${escapeHtml(formatHumanDuration(item.hours))}</span></div><div class="toast-actions"><button type="button" data-toast-undo>復原</button><button type="button" data-toast-edit>編輯</button></div>`;
  document.body.appendChild(e);
  let dismissed = false;
  const close = () => {
    if (dismissed) return;
    dismissed = true;
    e.classList.remove("show");
    setTimeout(() => e.remove(), 220);
  };
  e.querySelector("[data-toast-undo]").onclick = async () => {
    try {
      await DataService.deleteEntry(item);
      recordSuggestionMetric(item.title, "deleted", item);
      saveAll({ skipSync: true });
      close();
      render();
      toast("已復原這筆工時");
    } catch (error) {
      console.error("Undo suggestion WorkLog failed", { error, item });
      toast("復原失敗，請稍後再試");
    }
  };
  e.querySelector("[data-toast-edit]").onclick = () => {
    editingEntryId = item.id;
    captureSeed = null;
    activeWorkspace = "worklog";
    if (!openTabs.includes("worklog")) openTabs.push("worklog");
    rememberWorkspace("worklog");
    view = "capture";
    saveAll();
    close();
    render();
  };
  setTimeout(() => e.classList.add("show"), 10);
  setTimeout(close, 8000);
}

const BUSINESS_TIME_ZONE = "Asia/Taipei";
const BUSINESS_UTC_OFFSET = "+08:00";

function parseTaipeiBusinessDateTime(value, fallback = new Date()) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? fallback : new Date(value.getTime());
  const text = String(value || "").trim();
  const localMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  const normalized = localMatch
    ? `${localMatch[1]}-${localMatch[2]}-${localMatch[3]}T${localMatch[4]}:${localMatch[5]}:${localMatch[6] || "00"}${BUSINESS_UTC_OFFSET}`
    : text;
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

function taipeiDateTimeParts(value) {
  const d = parseTaipeiBusinessDateTime(value);
  const parts = new Intl.DateTimeFormat("zh-TW-u-ca-gregory", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false
  }).formatToParts(d);
  return Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, part.value]));
}

function formatTaipeiDateTimeInput(value) {
  if (!value) return "";
  const p = taipeiDateTimeParts(value);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

function safeDate(value, fallback = new Date()) {
  return parseTaipeiBusinessDateTime(value, fallback);
}

function selectedMonthDate(day = 1) {
  const [year, month] = selectedMonth.split("-").map(Number);
  return new Date(year, (month || 1) - 1, day);
}

async function setSelectedMonth(month, day = 1) {
  selectedMonth = monthKey(month);
  selected = selectedMonthDate(day);
  saveAll();
  await DataService.loadMonthEntries(selectedMonth);
  render();
}

function fmt(dt) {
  const p = taipeiDateTimeParts(dt);
  return `${p.year}/${p.month}/${p.day} ${p.hour}:${p.minute}`;
}

function formatWorklogTimeRange(entry = {}) {
  const start = parseTaipeiBusinessDateTime(entry.at);
  const end = new Date(start.getTime() + Math.max(0, Math.round(Number(entry.hours || 0) * 60)) * 60000);
  const startParts = taipeiDateTimeParts(start);
  const endParts = taipeiDateTimeParts(end);
  const startClock = `${startParts.hour}:${startParts.minute}`;
  const endClock = `${endParts.hour}:${endParts.minute}`;
  const sameDay = startParts.year === endParts.year
    && startParts.month === endParts.month
    && startParts.day === endParts.day;
  if (sameDay) return `${startClock}～${endClock}`;
  const startDate = `${Number(startParts.month)}/${Number(startParts.day)}`;
  const endDate = `${Number(endParts.month)}/${Number(endParts.day)}`;
  return `${startDate} ${startClock}～${endDate} ${endClock}`;
}

function dayEntries() {
  return entries.filter(e => e.date === key()).sort((a, b) => new Date(a.at) - new Date(b.at));
}

function selectedDayEntries() {
  return entries.filter(e => e.date === key(selected)).sort((a, b) => new Date(a.at) - new Date(b.at));
}

function monthEntries() {
  return entries.filter(e => String(e.date || "").startsWith(selectedMonth)).sort((a, b) => new Date(a.at) - new Date(b.at));
}

function entriesForDate(d) {
  const dk = key(d);
  return entries.filter(e => e.date === dk).sort((a, b) => new Date(a.at) - new Date(b.at));
}

function hours(list = dayEntries()) {
  return list.reduce((s, e) => s + Number(e.hours || 0), 0);
}

function formatHumanDuration(value = 0) {
  const totalMinutes = Math.max(0, Math.round(Number(value || 0) * 60));
  const wholeHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!wholeHours) return `${minutes}m`;
  if (!minutes) return `${wholeHours}h`;
  return `${wholeHours}h ${minutes}m`;
}

function tagsForRole(role) {
  return roleTagMap[role] || defaultTags;
}

function normalizeWorkMemoryObject(value = {}, index = 0, existing = null) {
  const raw = typeof value === "string" ? { name: value } : (value || {});
  const name = String(raw.name || "").trim();
  const base = existing || {};
  const aliases = arrayFromInput(raw.aliases ?? base.aliases ?? []);
  const keywords = arrayFromInput(raw.keywords ?? base.keywords ?? []);
  const sourceReferencesRaw = raw.sourceReferences ?? raw.source_references ?? base.sourceReferences ?? [];
  const sourceReferences = Array.isArray(sourceReferencesRaw)
    ? sourceReferencesRaw.filter(Boolean).map(reference => typeof reference === "string" ? { label: reference } : reference)
    : [];
  if (!sourceReferences.some(reference => reference?.type === "role_profile")) {
    const runtimeRole = typeof profile !== "undefined" ? profile?.role : "";
    const primaryRole = String(raw.primaryRole || base.primaryRole || runtimeRole || "採購");
    const secondaryRole = String(raw.secondaryRole || raw.category || base.category || "一般工作");
    sourceReferences.push({
      type: "role_profile",
      primaryRole,
      secondaryRoles: secondaryRole && secondaryRole !== primaryRole ? [{ role: secondaryRole, ratio: 0.3 }] : [],
      primaryRatio: secondaryRole && secondaryRole !== primaryRole ? 0.7 : 1
    });
  }
  return {
    id: raw.id || raw.cloudId || base.id || base.cloudId || "",
    cloudId: raw.cloudId || raw.id || base.cloudId || base.id || "",
    userUuid: raw.userUuid || raw.user_uuid || base.userUuid || currentUserUuid() || "",
    name,
    description: String(raw.description ?? base.description ?? "").trim(),
    category: String(raw.category ?? base.category ?? "一般工作").trim() || "一般工作",
    aliases: [...new Set(aliases)],
    source: String(raw.source ?? base.source ?? "manual").trim() || "manual",
    sourceReferences,
    keywords: [...new Set(keywords)],
    isActive: Boolean(raw.isActive ?? raw.is_active ?? base.isActive ?? true),
    familiarity: Math.min(5, Math.max(1, Number(raw.familiarity ?? base.familiarity ?? 1) || 1)),
    lastUsedAt: raw.lastUsedAt || raw.last_used_at || base.lastUsedAt || "",
    sortOrder: Number(raw.sortOrder ?? raw.sort_order ?? base.sortOrder ?? index) || 0,
    createdAt: raw.createdAt || raw.created_at || base.createdAt || "",
    updatedAt: raw.updatedAt || raw.updated_at || base.updatedAt || ""
  };
}

function workMemoryObjects() {
  const state = Array.isArray(DataService.workModelsState) ? DataService.workModelsState : null;
  const fallback = Array.isArray(profile?.tags) && profile.tags.length ? profile.tags : tagsForRole(profile?.role || "採購");
  const source = state || fallback;
  return source.map((item, index) => normalizeWorkMemoryObject(item, index)).filter(item => item.name);
}

// Canonical dataset for all ordinary Work Memory and Copilot behavior.
// Inactive rows remain in workMemoryObjects() for history/rollback only.
function activeWorkMemoryObjects() {
  const seen = new Set();
  return workMemoryObjects().filter(item => {
    if (item.isActive === false || seen.has(item.name)) return false;
    seen.add(item.name);
    return true;
  });
}

function workModels() {
  return [...new Set(activeWorkMemoryObjects().map(item => item.name))];
}

function systemReference(model = {}, type = "") {
  return (model.sourceReferences || []).find(reference => reference?.type === type) || null;
}

function suggestionMetricsFor(model = {}) {
  const value = systemReference(model, "suggestion_metrics") || {};
  const usageEvents = Array.isArray(value.usageEvents) ? value.usageEvents.filter(event => event?.at && event?.type).slice(-180) : [];
  const now = Date.now();
  const recentAddedCount = days => usageEvents.filter(event => event.type === "added" && now - new Date(event.at).getTime() <= days * 86400000).length;
  return {
    suggestionCount: Number(value.suggestionCount || 0),
    addedCount: Number(value.addedCount || 0),
    editedCount: Number(value.editedCount || 0),
    deletedCount: Number(value.deletedCount || 0),
    lastUsedAt: value.lastUsedAt || model.lastUsedAt || "",
    averageHours: Number(value.averageHours || 0),
    commonTimes: value.commonTimes && typeof value.commonTimes === "object" ? value.commonTimes : {},
    presentedDates: Array.isArray(value.presentedDates) ? value.presentedDates : [],
    usageEvents,
    recent7Days: Number(value.recent7Days ?? recentAddedCount(7)),
    recent30Days: Number(value.recent30Days ?? recentAddedCount(30))
  };
}

function roleProfileFor(model = {}) {
  const value = systemReference(model, "role_profile") || {};
  const primaryRole = String(value.primaryRole || profile?.role || "採購");
  const secondaryRoles = Array.isArray(value.secondaryRoles) ? value.secondaryRoles : [];
  return {
    primaryRole,
    primaryRatio: Number(value.primaryRatio ?? (secondaryRoles.length ? 0.7 : 1)),
    secondaryRoles,
    usageByRole: value.usageByRole && typeof value.usageByRole === "object" ? value.usageByRole : { [primaryRole]: 1 }
  };
}

function recordSuggestionMetric(modelName = "", event = "suggested", entry = null) {
  // Update the active row in the full object list so inactive history rows
  // survive metric writes and remain available to rollback/history.
  const models = workMemoryObjects();
  const index = models.findIndex(model => model.name === String(modelName || ""));
  if (index < 0 || models[index].isActive === false) return;
  const model = { ...models[index] };
  const current = suggestionMetricsFor(model);
  const today = key(new Date());
  if (event === "suggested" && current.presentedDates.includes(today)) return;
  const next = { ...current };
  const eventAt = new Date().toISOString();
  if (event === "suggested") {
    next.suggestionCount += 1;
    next.presentedDates = [...current.presentedDates.slice(-29), today];
  }
  if (event === "added") next.addedCount += 1;
  if (event === "edited") next.editedCount += 1;
  if (event === "deleted") next.deletedCount += 1;
  if (["added", "edited", "deleted"].includes(event)) next.lastUsedAt = eventAt;
  if (["suggested", "added", "edited", "deleted"].includes(event)) {
    next.usageEvents = [...current.usageEvents, { type: event, at: eventAt, hours: Number(entry?.hours || 0), time: String(entry?.at || "").slice(11, 16) }].slice(-180);
  }
  if (event === "added" && entry) {
    const previousTotal = current.averageHours * current.addedCount;
    next.averageHours = Math.round(((previousTotal + Number(entry.hours || 0)) / Math.max(1, next.addedCount)) * 100) / 100;
    const commonTime = String(entry.at || "").slice(11, 16);
    if (commonTime) next.commonTimes = { ...current.commonTimes, [commonTime]: Number(current.commonTimes[commonTime] || 0) + 1 };
  }
  if (event === "edited" && entry && next.addedCount > 0) {
    next.averageHours = Math.round(((current.averageHours * Math.max(0, next.addedCount - 1) + Number(entry.hours || 0)) / next.addedCount) * 100) / 100;
    const commonTime = String(entry.at || "").slice(11, 16);
    if (commonTime) next.commonTimes = { ...current.commonTimes, [commonTime]: Number(current.commonTimes[commonTime] || 0) + 1 };
  }
  const addedEvents = next.usageEvents.filter(item => item.type === "added");
  const now = Date.now();
  next.recent7Days = addedEvents.filter(item => now - new Date(item.at).getTime() <= 7 * 86400000).length;
  next.recent30Days = addedEvents.filter(item => now - new Date(item.at).getTime() <= 30 * 86400000).length;
  next.usageFrequency = next.suggestionCount ? Math.round(next.addedCount / next.suggestionCount * 1000) / 1000 : 0;
  model.lastUsedAt = next.lastUsedAt || model.lastUsedAt;
  const roleProfile = roleProfileFor(model);
  if (event === "added") {
    const learnedRole = model.category && model.category !== "一般工作" ? model.category : roleProfile.primaryRole;
    roleProfile.usageByRole = { ...roleProfile.usageByRole, [learnedRole]: Number(roleProfile.usageByRole[learnedRole] || 0) + 1 };
    const total = Math.max(1, Object.values(roleProfile.usageByRole).reduce((sum, count) => sum + Number(count || 0), 0));
    roleProfile.primaryRatio = Math.round(Number(roleProfile.usageByRole[roleProfile.primaryRole] || 0) / total * 1000) / 1000;
    roleProfile.secondaryRoles = Object.entries(roleProfile.usageByRole)
      .filter(([role]) => role !== roleProfile.primaryRole)
      .map(([role, count]) => ({ role, ratio: Math.round(Number(count || 0) / total * 1000) / 1000 }))
      .sort((a, b) => b.ratio - a.ratio);
  }
  model.sourceReferences = [
    ...(model.sourceReferences || []).filter(reference => !["suggestion_metrics", "role_profile"].includes(reference?.type)),
    { type: "suggestion_metrics", ...next },
    { type: "role_profile", ...roleProfile }
  ];
  models[index] = model;
  setWorkModels(models);
  saveAll({ skipSync: true });
  DataService.queueAutoSave("workModels");
}

function setWorkModels(models = []) {
  if (!profile) profile = { role: "採購", tags: [], sources: ["Google Drive", "手動紀錄"], workHours: "09:00~18:00", lunch: "12:00~13:00", sop: "目前沒有 SOP，先用職務模型" };
  const current = workMemoryObjects();
  const normalized = (models || []).map((item, index) => {
    const name = String(typeof item === "string" ? item : item?.name || "").trim();
    const existing = current.find(model => model.name === name || (item?.id && model.id === item.id));
    return normalizeWorkMemoryObject(item, index, existing);
  }).filter(item => item.name);
  DataService.workModelsState = normalized.filter((item, index, list) => list.findIndex(candidate => candidate.name === item.name) === index);
  // Work Memory changes invalidate the in-memory suggestion snapshot.  The
  // next workspace render will derive suggestions from the canonical model.
  workMemorySuggestionItemsCache = null;
  profile.tags = DataService.workModelsState.filter(item => item.isActive).map(item => item.name);
  LocalCache.save("work_models", DataService.workModelsState);
  return profile.tags;
}

function ecpTasks() {
  if (Array.isArray(DataService.ecpTasksState)) return [...new Set(DataService.ecpTasksState.map(x => String(x).trim()).filter(Boolean))];
  const source = Array.isArray(profile?.ecpTasks) && profile.ecpTasks.length ? profile.ecpTasks : (profile?.ecpTask ? [profile.ecpTask] : defaultEcpTasks);
  return [...new Set(source.map(x => String(x).trim()).filter(Boolean))];
}

function setEcpTasks(tasks = []) {
  if (!profile) profile = { role: "採購", tags: [], sources: ["Google Drive", "手動紀錄"], workHours: "09:00~18:00", lunch: "12:00~13:00", sop: "目前沒有 SOP，先用職務模型" };
  DataService.ecpTasksState = [...new Set((tasks || []).map(x => String(x).trim()).filter(Boolean))];
  profile.ecpTasks = [...DataService.ecpTasksState];
  profile.ecpTask = "";
  LocalCache.save("ecp_tasks", profile.ecpTasks);
  return profile.ecpTasks;
}

function ecpTaskOptions(selectedTask = "") {
  const tasks = ecpTasks();
  return `<option value="">不指定 ECP 任務</option>${tasks.map(task => `<option value="${escapeHtml(task)}" ${task === selectedTask ? "selected" : ""}>${escapeHtml(task)}</option>`).join("")}<option value="__add__">＋新增 ECP 任務</option>`;
}

function ecpTaskList(tasks = ecpTasks()) {
  return `<div class="ecp-task-list" id="ecpTaskList">${tasks.map(task => `<div class="ecp-task-item"><span>${escapeHtml(task)}</span><button class="btn2 danger" type="button" data-remove-ecp-task="${escapeHtml(task)}">移除</button></div>`).join("")}</div>`;
}

function firstEcpTaskFor(title = "") {
  const tasks = ecpTasks();
  return tasks.find(task => title && title.includes(task)) || tasks[0] || "";
}

function tagButtons(tags) {
  return tags.map(t => `<button class="btn2 tag-btn" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join("");
}

function workModelChecks(models = [], selectedModels = models) {
  const selectedSet = new Set(selectedModels);
  return models.map(model => `<label class="work-model-check"><input type="checkbox" class="work-model-option" value="${escapeHtml(model)}" ${selectedSet.has(model) ? "checked" : ""}><span>${escapeHtml(model)}</span></label>`).join("");
}

function workModelOptions(selectedModel = "") {
  const models = workModels();
  const selectedValue = selectedModel || models[0] || "";
  const options = selectedValue && !models.includes(selectedValue) ? [selectedValue, ...models] : models;
  return options.map(model => `<option value="${escapeHtml(model)}" ${model === selectedValue ? "selected" : ""}>${escapeHtml(model)}</option>`).join("");
}

function addWorkModel(model) {
  const name = String(model || "").trim();
  if (!name) return false;
  const models = workMemoryObjects();
  if (!models.some(item => item.name === name)) setWorkModels([...models, normalizeWorkMemoryObject({ name, category: workMemoryCategoryFor(name), source: "manual", isActive: true })]);
  return true;
}

async function saveWorkModel(model, options = {}) {
  const name = String(model || "").trim();
  if (!name) return false;
  addWorkModel(name);
  saveAll({ skipSync: true });
  await DataService.saveWorkModelsOnly(options);
  return true;
}

const addWorkDescription = saveWorkModel;

function googleConnectionLabel() {
  const token = typeof currentGoogleProviderToken === "function" ? currentGoogleProviderToken() : "";
  return token ? "🟢 已授權" : "⚪ 尚未授權";
}

function cloudSyncLabel() {
  if (cloudSync.status === "synced") return "🟢 已同步";
  if (cloudSync.status === "syncing") return "🟡 同步中";
  if (cloudSync.status === "pending") return "🔄 尚未同步";
  if (cloudSync.status === "knowledge_uninitialized") return "🟡 Knowledge 未初始化";
  if (cloudSync.status === "work_memory_uninitialized") return "🟡 Work Memory 未初始化";
  if (cloudSync.status === "tasks_uninitialized") return "🟡 Tasks Cloud 未初始化";
  if (cloudSync.status === "migration_required") return "🟡 等待資料搬移";
  if (cloudSync.status === "migrating") return "🟡 資料搬移中";
  if (cloudSync.status === "failed") return "🔴 同步失敗";
  return "⚪ 尚未同步";
}

function cloudSyncDetail() {
  if (cloudSync.status === "failed") return cloudSync.error || "請稍後再試";
  if (cloudSync.status === "pending") return "等待自動同步";
  if (cloudSync.status === "syncing") return "同步中...";
  if (cloudSync.status === "knowledge_uninitialized") return "請先建立 Knowledge Database 與 Storage Bucket";
  if (cloudSync.status === "work_memory_uninitialized") return `請先執行 ${WORK_MEMORY_SCHEMA_SQL}`;
  if (cloudSync.status === "tasks_uninitialized") return `請先執行 ${PRIORITY_ENGINE_SCHEMA_SQL}`;
  if (cloudSync.status === "migration_required") return "請先確認 Migration Preview";
  if (cloudSync.status === "migrating") return "正在搬移 RC3.3 本機資料";
  if (!cloudSync.lastSyncedAt) return "等待 Cloud Sync";
  return `最後同步：${fmt(cloudSync.lastSyncedAt)}`;
}

function sidebarSyncStatusLabel() {
  if (cloudSync.status === "synced") return "🟢 已同步";
  if (cloudSync.status === "syncing") return "🟡 同步中";
  if (cloudSync.status === "failed") return "🔴 同步失敗";
  return "🟡 尚未同步";
}

function conversationSyncLabel() {
  if (conversationSync.status === "synced") return "💬 Conversation 已同步";
  if (conversationSync.status === "syncing") return "💬 Conversation 同步中";
  if (conversationSync.status === "pending") return "💬 Conversation 等待同步";
  if (conversationSync.status === "uninitialized") return "💬 Conversation 尚未初始化";
  if (conversationSync.status === "failed") return "💬 Conversation 同步失敗";
  return "💬 Conversation 尚未同步";
}

function conversationSyncDetail() {
  if (conversationSync.status === "uninitialized") return "聊天目前僅儲存在此瀏覽器";
  if (conversationSync.status === "failed") return conversationSync.error || "請檢查 Conversation Cloud";
  if (conversationSync.status === "pending") return "等待寫入 Supabase";
  if (conversationSync.status === "syncing") return "正在讀取 / 寫入 Conversation";
  if (!conversationSync.lastSyncedAt) return "等待 Conversation Cloud";
  return `最後同步：${fmt(conversationSync.lastSyncedAt)}`;
}

function refreshCloudSyncStatusDisplay() {
  const box = document.getElementById("developerCloudSyncStatus");
  if (!box) return;
  const syncTime = cloudSync.lastSyncedAt ? fmt(cloudSync.lastSyncedAt) : "尚未同步";
  box.innerHTML = `<strong>${escapeHtml(sidebarSyncStatusLabel())}</strong><span>最後同步</span><time>${escapeHtml(syncTime)}</time>`;
}

function refreshAuthenticatedSurface(reason = "navigation-refresh") {
  if (!hasGoogleOAuthSession() || !document.querySelector(".os-shell")) {
    render(reason);
    return;
  }
  if (typeof RenderEngine !== "undefined") {
    RenderEngine.partial(reason, () => {
      refreshCloudSyncStatusDisplay();
      return true;
    });
  } else refreshCloudSyncStatusDisplay();
  refreshConversationFromCloud(true);
}

// Sprint 7.1: Realtime updates refresh only the surface that owns the changed
// records. This keeps WorkLog stable while a background Cloud event arrives;
// the authenticated shell and calendar are not rebuilt for every row update.
function bindTodayPanel(panel = document) {
  panel.querySelectorAll("[data-action=add]").forEach(button => button.onclick = () => {
    editingEntryId = null;
    captureSeed = null;
    activeWorkspace = "worklog";
    if (!openTabs.includes("worklog")) openTabs.push("worklog");
    rememberWorkspace("worklog");
    view = "capture";
    saveAll();
    render("worklog-capture");
  });
  panel.querySelectorAll("[data-edit-id]").forEach(button => button.onclick = () => {
    editingEntryId = button.dataset.editId;
    captureSeed = null;
    activeWorkspace = "worklog";
    if (!openTabs.includes("worklog")) openTabs.push("worklog");
    rememberWorkspace("worklog");
    view = "capture";
    saveAll();
    render("worklog-edit");
  });
  panel.querySelectorAll("[data-del-id]").forEach(button => button.onclick = async () => {
    const removed = entries.find(entry => entry.id === button.dataset.delId);
    if (!removed) return;
    try {
      await DataService.deleteEntry(removed);
      if (removed.source === "ai-card") recordSuggestionMetric(removed.title, "deleted", removed);
      saveAll({ skipSync: true });
      toast("已刪除");
    } catch (error) {
      console.error("Delete entry failed", error);
      toast("刪除同步失敗，請稍後再試");
    }
  });
}

function refreshRealtimeSurface(table = "") {
  const reason = `realtime-${table || "cloud"}`;
  if (typeof RenderEngine === "undefined") {
    refreshCloudSyncStatusDisplay();
    return;
  }
  RenderEngine.partial(reason, () => {
    if (table === "work_entries" && activeWorkspace === "worklog" && view === "center") {
      const target = document.querySelector(".today-module");
      if (target) {
        target.innerHTML = todayPanel();
        bindTodayPanel(target);
      }
    }
    if (table === "user_tasks" && activeWorkspace === "tasks") {
      const target = document.querySelector(".tasks-workspace");
      if (target) {
        target.outerHTML = taskWorkspace();
        bindTasks();
      }
    }
    if (table === "work_journal_entries" && activeWorkspace === "tasks") {
      const target = document.querySelector(".tasks-workspace");
      if (target) {
        target.outerHTML = taskWorkspace();
        bindTasks();
      }
    }
    refreshCloudSyncStatusDisplay();
    return true;
  });
}

function isKnowledgeNotInitializedError(error) {
  const text = `${error?.supabase?.status || ""} ${error?.supabase?.message || ""} ${error?.supabase?.body || ""} ${error?.message || ""}`;
  return (/404/.test(text) && /knowledge_sources|knowledge_units|knowledge_recommendation_candidates/i.test(text))
    || /extracted_text|intelligence_summary|intelligence_error|processed_at|verified_at|knowledge_recommendation_candidates/i.test(text)
    || /Bucket not found|knowledge-sources/i.test(text);
}

function isConversationNotInitializedError(error) {
  const text = `${error?.supabase?.status || ""} ${error?.supabase?.message || ""} ${error?.supabase?.body || ""} ${error?.message || ""}`;
  return /404/.test(text) && /assistant_(conversations|messages|conversation_states)/i.test(text);
}

function isWorkProfileNotInitializedError(error) {
  const text = `${error?.supabase?.status || ""} ${error?.supabase?.message || ""} ${error?.supabase?.body || ""} ${error?.message || ""}`;
  return /404/.test(text) && /user_work_profiles/i.test(text);
}

function isWorkMemoryNotInitializedError(error) {
  const text = `${error?.supabase?.status || ""} ${error?.supabase?.code || ""} ${error?.supabase?.message || ""} ${error?.supabase?.body || ""} ${error?.message || ""}`;
  return /user_work_models/i.test(text) && /description|category|aliases|source_references|keywords|familiarity|last_used_at|schema cache|column/i.test(text);
}

function isTasksNotInitializedError(error) {
  const text = `${error?.supabase?.status || ""} ${error?.supabase?.code || ""} ${error?.supabase?.message || ""} ${error?.supabase?.body || ""} ${error?.message || ""}`;
  return /user_tasks/i.test(text) && (/404|42P01|relation|schema cache|column|not found/i.test(text));
}

function minutesFromTime(value = "09:00") {
  const [h = 9, m = 0] = String(value || "09:00").slice(0, 5).split(":").map(Number);
  return h * 60 + (m || 0);
}

function timeFromMinutes(total = 540) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function profileWorkSchedule() {
  const work = parseWorkTimeRange(profile?.workHours || "09:00~18:00");
  const lunch = parseWorkTimeRange(profile?.lunch || "12:00~13:00");
  return {
    workStart: minutesFromTime(work.start || "09:00"),
    workEnd: minutesFromTime(work.end || "18:00"),
    lunchStart: minutesFromTime(lunch.start || "12:00"),
    lunchEnd: minutesFromTime(lunch.end || "13:00")
  };
}

function normalizeStartMinutes(minutes, durationHours = 1) {
  const s = profileWorkSchedule();
  let start = Math.max(Number(minutes || 0), s.workStart);
  return start;
}

function entryStartMinutes(entry) {
  const time = String(entry?.at || "").slice(11, 16);
  return minutesFromTime(time || "09:00");
}

function entryEndMinutes(entry) {
  return entryStartMinutes(entry) + Math.round(Number(entry?.hours || 0) * 60);
}

function requiresOvertimeConfirmation(entry) {
  return entryEndMinutes(entry) > profileWorkSchedule().workEnd;
}

function confirmOvertimeEntry(entry) {
  // Overtime is valid WorkLog data. Explicit and user-confirmed times must not be blocked.
  return true;
}

function mergeTimeIntervals(intervals = []) {
  const sorted = intervals
    .filter(x => Number.isFinite(x.start) && Number.isFinite(x.end) && x.end > x.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (!last || interval.start > last.end) merged.push({ ...interval });
    else last.end = Math.max(last.end, interval.end);
  }
  return merged;
}

const LUNCH_STATES = Object.freeze({
  NORMAL: "NORMAL",
  DELAYED: "DELAYED",
  WAIVED: "WAIVED",
  UNKNOWN: "UNKNOWN"
});

function workIntervalsForDate(dateKey = key(), excludeId = null, reserved = []) {
  const persisted = entries
    .filter(entry => entry.date === dateKey && entry.id !== excludeId && entry.status !== "deleted")
    .map(entry => ({
      start: entryStartMinutes(entry),
      end: entryEndMinutes(entry),
      source: "worklog"
    }));
  const planned = (Array.isArray(reserved) ? reserved : [])
    .map(interval => ({
      start: Number(interval?.start),
      end: Number(interval?.end),
      source: interval?.source || "reserved"
    }))
    .filter(interval => Number.isFinite(interval.start) && Number.isFinite(interval.end) && interval.end > interval.start);
  return [...persisted, ...planned];
}

function determineLunchState(intervals = [], schedule = profileWorkSchedule(), options = {}) {
  const lunchStart = Number(schedule?.lunchStart);
  const lunchEnd = Number(schedule?.lunchEnd);
  if (!Number.isFinite(lunchStart) || !Number.isFinite(lunchEnd) || lunchEnd <= lunchStart) {
    return { state: LUNCH_STATES.UNKNOWN, window: null, nominalWindow: null };
  }
  const nominalWindow = { start: lunchStart, end: lunchEnd };
  if (options.completedEightHours) {
    return { state: LUNCH_STATES.WAIVED, window: null, nominalWindow };
  }
  const merged = mergeTimeIntervals(intervals);
  const lunchDuration = lunchEnd - lunchStart;
  let window = { ...nominalWindow };
  let delayed = false;
  for (let attempt = 0; attempt <= merged.length; attempt += 1) {
    const overlap = merged.find(interval => interval.start < window.end && interval.end > window.start);
    if (!overlap) break;
    window = { start: overlap.end, end: overlap.end + lunchDuration };
    delayed = true;
  }
  return { state: delayed ? LUNCH_STATES.DELAYED : LUNCH_STATES.NORMAL, window, nominalWindow };
}

function workScheduleContext(dateKey = key(), excludeId = null, reserved = []) {
  const schedule = profileWorkSchedule();
  const intervals = workIntervalsForDate(dateKey, excludeId, reserved);
  const persistedMinutes = entries
    .filter(entry => entry.date === dateKey && entry.id !== excludeId && entry.status !== "deleted")
    .reduce((sum, entry) => sum + Math.max(0, Math.round(Number(entry.hours || 0) * 60)), 0);
  const reservedMinutes = (Array.isArray(reserved) ? reserved : [])
    .reduce((sum, interval) => sum + Math.max(0, Number(interval?.end || 0) - Number(interval?.start || 0)), 0);
  const workedMinutes = persistedMinutes + reservedMinutes;
  const completedEightHours = workedMinutes >= 8 * 60;
  const lunch = determineLunchState(intervals, schedule, { completedEightHours });
  return {
    dateKey,
    schedule,
    intervals,
    mergedIntervals: mergeTimeIntervals(intervals),
    lunchState: lunch.state,
    lunchWindow: lunch.window,
    nominalLunchWindow: lunch.nominalWindow,
    workedMinutes,
    completedEightHours
  };
}

function timeResolutionContext(dateKey = key(), excludeId = null, reserved = []) {
  return workScheduleContext(dateKey, excludeId, reserved);
}

function availableStartMinutes(dateKey = key(), durationHours = 1, excludeId = null, reserved = []) {
  const context = timeResolutionContext(dateKey, excludeId, reserved);
  const s = context.schedule;
  const duration = Math.max(1, Math.round(Number(durationHours || 1) * 60));
  const merged = context.mergedIntervals;
  if (context.completedEightHours) return null;
  // Once today's latest entry has crossed the workday boundary, the next automatic
  // suggestion starts on the next workday instead of back-filling an earlier gap.
  if (merged.some(interval => interval.end > s.workEnd)) return null;
  const normalizeAutomaticCandidate = value => {
    const candidate = Math.max(Number(value || 0), s.workStart);
    const lunchWindow = context.lunchWindow;
    if (!lunchWindow) return candidate;
    return candidate >= lunchWindow.start && candidate < lunchWindow.end ? lunchWindow.end : candidate;
  };

  let candidate = normalizeAutomaticCandidate(s.workStart);
  for (const interval of merged) {
    if (interval.end <= candidate) continue;
    if (interval.start > candidate) {
      if (candidate + duration <= Math.min(interval.start, s.workEnd)) return candidate;
      candidate = normalizeAutomaticCandidate(interval.end);
    } else if (interval.end > candidate) {
      candidate = normalizeAutomaticCandidate(interval.end);
    }
    if (candidate >= s.workEnd) break;
  }
  if (candidate + duration <= s.workEnd) return candidate;
  // Keep the user on the current workday when a shorter duration could still
  // use the remaining tail. The duration selector can then be changed without
  // silently moving the form to the next workday.
  if (candidate < s.workEnd) return candidate;
  return null;
}

function dateFromWorkKey(dateKey = key()) {
  const match = String(dateKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return new Date();
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0);
}

function nextWorkdayKey(dateKey = key()) {
  const next = dateFromWorkKey(dateKey);
  do next.setDate(next.getDate() + 1);
  while (next.getDay() === 0 || next.getDay() === 6);
  return key(next);
}

function earliestAvailableWorkTime(dateKey = key(), durationHours = 1, excludeId = null, reserved = []) {
  let candidateDate = dateKey;
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const start = availableStartMinutes(candidateDate, durationHours, excludeId, attempt === 0 ? reserved : []);
    if (start != null) return { dateKey: candidateDate, minutes: start, at: `${candidateDate}T${timeFromMinutes(start)}` };
    candidateDate = nextWorkdayKey(candidateDate);
  }
  const schedule = profileWorkSchedule();
  return { dateKey: candidateDate, minutes: schedule.workStart, at: `${candidateDate}T${timeFromMinutes(schedule.workStart)}` };
}

function finalizeTimeResolution(result = {}, hours = 1, excludeId = null, reserved = []) {
  const dateKey = result.dateKey || String(result.at || "").slice(0, 10) || key();
  const start = minutesFromTime(String(result.at || "").slice(11, 16) || "09:00");
  const duration = Math.max(1, Math.round(Number(hours || 1) * 60));
  const before = timeResolutionContext(dateKey, excludeId, reserved);
  const after = timeResolutionContext(dateKey, excludeId, [
    ...(Array.isArray(reserved) ? reserved : []),
    { start, end: start + duration, source: "candidate" }
  ]);
  return {
    ...result,
    dateKey,
    previousLunchState: before.lunchState,
    previousLunchWindow: before.lunchWindow,
    lunchState: after.lunchState,
    lunchWindow: after.lunchWindow,
    previousCompletedEightHours: before.completedEightHours,
    completedEightHours: after.completedEightHours
  };
}

function assistantRelativeTimeSignal(raw = "") {
  const text = String(raw || "");
  if (/才完成|剛完成|剛剛完成|剛做完|剛結束|才做完/.test(text)) return "just_completed";
  if (/剛剛|現在|此刻|剛才/.test(text)) return "now";
  return "";
}

function roundedCurrentMinutes(now = new Date()) {
  return Math.floor((now.getHours() * 60 + now.getMinutes()) / 5) * 5;
}

function resolveWorklogTime({ raw = "", dateKey = key(), hours = 1, explicitAt = "", now = new Date(), excludeId = null, reserved = [] } = {}) {
  if (explicitAt) {
    return finalizeTimeResolution({ at: explicitAt, dateKey: String(explicitAt).slice(0, 10), reason: "explicit" }, hours, excludeId, reserved);
  }
  const relative = assistantRelativeTimeSignal(raw);
  if (relative) {
    const durationMinutes = Math.max(1, Math.round(Number(hours || 1) * 60));
    const current = roundedCurrentMinutes(now);
    const start = relative === "just_completed" ? Math.max(0, current - durationMinutes) : current;
    return finalizeTimeResolution({ at: `${dateKey}T${timeFromMinutes(start)}`, dateKey, reason: relative }, hours, excludeId, reserved);
  }
  return finalizeTimeResolution({ ...earliestAvailableWorkTime(dateKey, hours, excludeId, reserved), reason: "earliest_gap" }, hours, excludeId, reserved);
}

function nextAvailableStart(dateKey = key(), durationHours = 1, excludeId = null, reserved = []) {
  return resolveWorklogTime({ dateKey, hours: durationHours, excludeId, reserved }).at;
}

function nextStart() {
  return nextAvailableStart(key(), 1);
}

function captureDefaultStart(durationHours = 1) {
  return nextAvailableStart(key(), durationHours, editingEntryId);
}

function defaultEcpTaskName(title = "") {
  return firstEcpTaskFor(title) || ecpTasks()[0] || "";
}

function assistantGreeting() {
  return { role: "assistant", text: "您好，我是 Mr. KM。今天想完成什麼？" };
}

function conversationKey() {
  return scopedLocalKey(WORKLOG_CHAT_KEY);
}

function conversationPendingKey() {
  return scopedLocalKey(WORKLOG_CHAT_PENDING_KEY);
}

function assistantWelcomeKey() {
  return scopedLocalKey(ZHUGE_ASSISTANT_WELCOME_KEY);
}

function assistantOpenKey() {
  return scopedLocalKey(ZHUGE_ASSISTANT_OPEN_KEY);
}

function isStandaloneChatRoute() {
  return /\/chat\/?$/.test(location.pathname) || new URLSearchParams(location.search).get("chat") === "1";
}

function appHomeUrl() {
  if (isStandaloneChatRoute()) return location.href.replace(/\/chat\/?(\?.*)?$/, "/").replace(/[?&]chat=1/, "");
  return WEB_APP_URL;
}

function standaloneChatUrl() {
  if (/\/chat\/?$/.test(location.pathname)) return location.href;
  const base = location.href.replace(/[?#].*$/, "").replace(/\/(index\.html)?$/, "/");
  return `${base}chat/`;
}

function assistantChannel() {
  if (IS_EXTENSION_ENTRY) return "chrome";
  return window.matchMedia?.("(max-width: 767px)")?.matches ? "mobile" : "web";
}

function isAssistantOpen() {
  return localStorage.getItem(assistantOpenKey()) === "1";
}

function hasSeenAssistantWelcome() {
  return localStorage.getItem(assistantWelcomeKey()) === "1" || hasConversationStarted();
}

function hasConversationStarted() {
  const cached = Array.isArray(conversationMessagesState) ? conversationMessagesState : readJson(conversationKey(), []);
  return (Array.isArray(cached) && cached.length > 0) || !!getAssistantPendingCommand();
}

function conversationMessages() {
  if (!Array.isArray(conversationMessagesState)) {
    const cached = readJson(conversationKey(), []);
    conversationMessagesState = Array.isArray(cached) ? cached : [];
  }
  return conversationMessagesState.length ? conversationMessagesState : [assistantGreeting()];
}

function saveConversationMessages(messages = []) {
  conversationMessagesState = Array.isArray(messages) ? messages.slice(-50) : [];
  writeJson(conversationKey(), conversationMessagesState);
}

function messageFromCloud(row = {}) {
  return {
    id: row.client_message_id || row.id || uid("msg"),
    role: row.role || "assistant",
    text: row.content || "",
    at: row.created_at || new Date().toISOString(),
    card: row.card || null,
    syncStatus: "synced"
  };
}

function applyCloudConversation(bundle = {}) {
  const rows = Array.isArray(bundle.messages) ? bundle.messages : [];
  const cloudMessages = rows.map(messageFromCloud);
  const cloudIds = new Set(cloudMessages.map(msg => msg.id));
  const localMessages = Array.isArray(conversationMessagesState) ? conversationMessagesState : readJson(conversationKey(), []);
  const pendingLocal = (Array.isArray(localMessages) ? localMessages : [])
    .filter(msg => ["pending_sync", "failed"].includes(msg?.syncStatus) && !cloudIds.has(msg.id));
  saveConversationMessages([...cloudMessages, ...pendingLocal].sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0)));
  conversationPendingState = bundle.state?.pending_action || null;
  if (conversationPendingState) writeJson(conversationPendingKey(), conversationPendingState);
  else localStorage.removeItem(conversationPendingKey());
}

function markConversationMessageSyncStatus(id, syncStatus) {
  if (!id) return;
  const next = conversationMessages().map(msg => msg.id === id ? { ...msg, syncStatus } : msg);
  saveConversationMessages(next);
}

function addConversationMessage(role, text, meta = {}) {
  const messages = conversationMessages();
  const message = { id: uid("msg"), role, text: String(text || ""), at: new Date().toISOString(), syncStatus: "pending_sync", ...meta };
  messages.push(message);
  saveConversationMessages(messages);
  DataService.saveConversationMessage(message)
    .then(saved => markConversationMessageSyncStatus(message.id, saved ? "synced" : "failed"))
    .catch(error => {
      markConversationMessageSyncStatus(message.id, "failed");
      console.warn("Conversation message cloud sync deferred", { error, supabase: error.supabase || null });
    });
}

function removeConversationMessage(id) {
  if (!id) return;
  saveConversationMessages(conversationMessages().filter(msg => msg.id !== id));
}

function assistantThinkingMessage() {
  return { id: uid("thinking"), transient: true, role: "assistant", text: "Mr. KM 正在整理工時...", at: new Date().toISOString() };
}

function addAssistantThinkingMessage() {
  const message = assistantThinkingMessage();
  const messages = conversationMessages();
  messages.push(message);
  saveConversationMessages(messages);
  return message.id;
}

function scrollAssistantToBottom() {
  requestAnimationFrame(() => {
    const thread = document.getElementById("assistantThread");
    if (thread) thread.scrollTop = thread.scrollHeight;
  });
}

function getAssistantPendingCommand() {
  if (conversationPendingState === undefined) conversationPendingState = readJson(conversationPendingKey(), null);
  return conversationPendingState || null;
}

function setAssistantPendingCommand(command = null) {
  if (!command) {
    conversationPendingState = null;
    localStorage.removeItem(conversationPendingKey());
    return DataService.saveConversationState(null).catch(error => console.warn("Conversation state cloud sync deferred", { error, supabase: error.supabase || null }));
  }
  conversationPendingState = command;
  writeJson(conversationPendingKey(), command);
  return DataService.saveConversationState(command).catch(error => console.warn("Conversation state cloud sync deferred", { error, supabase: error.supabase || null }));
}

function clearAssistantPendingCommand() {
  conversationPendingState = null;
  localStorage.removeItem(conversationPendingKey());
  return DataService.saveConversationState(null).catch(error => console.warn("Conversation state cloud sync deferred", { error, supabase: error.supabase || null }));
}

function refreshConversationFromCloud(renderAfter = true) {
  if (!hasGoogleOAuthSession() || migrationRequired || migrationRunning) return;
  if (conversationRefreshTimer) clearTimeout(conversationRefreshTimer);
  conversationRefreshTimer = setTimeout(() => {
    DataService.loadConversation().finally(() => {
      if (!renderAfter || !(isAssistantOpen() || IS_EXTENSION_ENTRY || isStandaloneChatRoute())) return;
      const widget = document.querySelector(".floating-assistant-widget");
      if (widget && !IS_EXTENSION_ENTRY && !isStandaloneChatRoute() && typeof RenderEngine !== "undefined") {
        RenderEngine.partial("conversation-refresh", () => {
          const holder = document.createElement("div");
          holder.innerHTML = floatingAssistantWidget();
          const next = holder.firstElementChild;
          if (!next) return false;
          widget.replaceWith(next);
          bindWorklogAssistant();
          return true;
        });
        return;
      }
      render("conversation-refresh-fallback");
    });
  }, 150);
}

const chineseNumberMap = { "零": 0, "一": 1, "二": 2, "兩": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10 };

function parseNumberToken(value = "") {
  const text = String(value || "").trim();
  if (!text) return null;
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text);
  if (text === "半") return 0.5;
  if (text === "十") return 10;
  if (text.length === 1 && text in chineseNumberMap) return chineseNumberMap[text];
  const tenMatch = text.match(/^十([一二兩三四五六七八九])$/);
  if (tenMatch) return 10 + chineseNumberMap[tenMatch[1]];
  const compound = text.match(/^([一二兩三四五六七八九])十([一二兩三四五六七八九])?$/);
  if (compound) return chineseNumberMap[compound[1]] * 10 + (compound[2] ? chineseNumberMap[compound[2]] : 0);
  return null;
}

const assistantWeekdayIndex = { "日": 0, "天": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6 };
const assistantWeekdayLabels = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

function taipeiDateKeyFromDate(value = new Date()) {
  const parts = taipeiDateTimeParts(value);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function shiftTaipeiDateKey(dateKey = "", days = 0) {
  const match = String(dateKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return taipeiDateKeyFromDate(new Date());
  const shifted = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + Number(days || 0), 12));
  return shifted.toISOString().slice(0, 10);
}

function taipeiWeekdayIndex(dateKey = "") {
  const match = String(dateKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(`${dateKey}T12:00:00${BUSINESS_UTC_OFFSET}`);
  const label = new Intl.DateTimeFormat("zh-TW-u-ca-gregory", { timeZone: BUSINESS_TIME_ZONE, weekday: "short" }).format(date);
  return ["週日", "週一", "週二", "週三", "週四", "週五", "週六"].indexOf(label);
}

function assistantDateLabel(dateKey = "") {
  const weekday = taipeiWeekdayIndex(dateKey);
  return weekday == null ? String(dateKey || "") : `${dateKey}（${assistantWeekdayLabels[weekday]}）`;
}

function validTaipeiDateKey(year, month, day) {
  const candidate = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12));
  if (candidate.getUTCFullYear() !== Number(year) || candidate.getUTCMonth() !== Number(month) - 1 || candidate.getUTCDate() !== Number(day)) return "";
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseAssistantExplicitDate(text = "", fallbackDateKey = "") {
  const raw = String(text || "");
  const fallbackYear = Number(String(fallbackDateKey || "").slice(0, 4)) || Number(taipeiDateKeyFromDate(new Date()).slice(0, 4));
  const full = raw.match(/(\d{4})\s*[年/-]\s*(\d{1,2})\s*[月/-]\s*(\d{1,2})\s*(?:日|號)?/);
  if (full) return validTaipeiDateKey(full[1], full[2], full[3]);
  const monthDay = raw.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*(?:日|號)?/);
  if (monthDay) return validTaipeiDateKey(fallbackYear, monthDay[1], monthDay[2]);
  const slashDay = raw.match(/(?:^|[^\d])(\d{1,2})\s*[/-]\s*(\d{1,2})(?!\d)/);
  if (slashDay) return validTaipeiDateKey(fallbackYear, slashDay[1], slashDay[2]);
  return "";
}

function assistantDateWeekdaySignal(text = "") {
  const match = String(text || "").match(/(下)?(?:星期|週|周|禮拜|礼拜)\s*([日天一二三四五六])/);
  if (!match) return null;
  return { expected: assistantWeekdayIndex[match[2]], nextWeek: Boolean(match[1]) };
}

function assistantDateWeekdayMismatch(text = "", dateKey = "") {
  const signal = assistantDateWeekdaySignal(text);
  return Boolean(signal && signal.expected !== taipeiWeekdayIndex(dateKey));
}

function parseAssistantDate(text = "", now = new Date()) {
  const raw = String(text || "");
  const todayKey = taipeiDateKeyFromDate(now);
  const explicit = parseAssistantExplicitDate(raw, todayKey);
  if (explicit) return explicit;
  const weekday = assistantDateWeekdaySignal(raw);
  if (weekday) {
    const currentIndex = taipeiWeekdayIndex(todayKey);
    let distance = (weekday.expected - currentIndex + 7) % 7;
    if (weekday.nextWeek) distance += 7;
    else if (distance === 0) distance = 7;
    return shiftTaipeiDateKey(todayKey, distance);
  }
  if (/後天|後日/.test(raw)) return shiftTaipeiDateKey(todayKey, 2);
  if (/明天|明日/.test(raw)) return shiftTaipeiDateKey(todayKey, 1);
  if (/昨天|昨日/.test(raw)) return shiftTaipeiDateKey(todayKey, -1);
  if (/下星期|下週|下周|下禮拜|下礼拜/.test(raw)) return shiftTaipeiDateKey(todayKey, 7);
  return todayKey;
}

function parseAssistantTimeToken(period = "", hourToken = "", minuteToken = "") {
  let hour = parseNumberToken(hourToken);
  if (hour == null) return null;
  let minute = minuteToken === "半" ? 30 : Number(minuteToken || 0);
  if (/下午|晚上|晚間/.test(period) && hour < 12) hour += 12;
  if (/中午/.test(period) && hour < 12) hour += 12;
  if (/凌晨/.test(period) && hour === 12) hour = 0;
  return { hour, minute: Number.isFinite(minute) ? minute : 0 };
}

function parseAssistantTimeRange(text = "", dateKey = key()) {
  const pattern = /(上午|下午|晚上|晚間|中午|凌晨)?\s*([0-9一二兩三四五六七八九十]{1,3})\s*(?:點|:)\s*(半|\d{1,2})?\s*(?:到|至|-|~)\s*(上午|下午|晚上|晚間|中午|凌晨)?\s*([0-9一二兩三四五六七八九十]{1,3})\s*(?:點|:)?\s*(半|\d{1,2})?/;
  const match = String(text).match(pattern);
  if (!match) return null;
  const start = parseAssistantTimeToken(match[1] || "", match[2], match[3] || "");
  const end = parseAssistantTimeToken(match[4] || match[1] || "", match[5], match[6] || "");
  if (!start || !end) return null;
  const startMinutes = start.hour * 60 + start.minute;
  let endMinutes = end.hour * 60 + end.minute;
  if (endMinutes <= startMinutes && end.hour < 12) endMinutes += 12 * 60;
  const hoursValue = Math.max(0.5, Math.round((endMinutes - startMinutes) / 30) / 2);
  return { at: `${dateKey}T${String(start.hour).padStart(2, "0")}:${String(start.minute).padStart(2, "0")}`, hours: hoursValue };
}

function parseAssistantSingleStart(text = "", dateKey = key()) {
  const pattern = /(上午|下午|晚上|晚間|中午|凌晨)?\s*([0-9一二兩三四五六七八九十]{1,3})\s*(?:點|:)\s*(半|\d{1,2})?/;
  const match = String(text).match(pattern);
  if (!match) return null;
  const start = parseAssistantTimeToken(match[1] || "", match[2], match[3] || "");
  if (!start) return null;
  return `${dateKey}T${String(start.hour).padStart(2, "0")}:${String(start.minute).padStart(2, "0")}`;
}

function parseAssistantDuration(text = "") {
  const raw = String(text || "");
  if (/半天|半日/.test(raw)) return 4;
  if (/整天|整日|全天|一整天|一天/.test(raw)) return 8;
  const numberAndHalf = raw.match(/([0-9]+|[一二兩三四五六七八九十]+)\s*(?:個)?半\s*(?:小時|鐘頭|h|H)/);
  if (numberAndHalf) return parseNumberToken(numberAndHalf[1]) + 0.5;
  if (/(一個|1個)?半\s*(?:小時|鐘頭|h|H)/.test(raw)) return 0.5;
  const half = raw.match(/半\s*(?:小時|鐘頭|h|H)/);
  if (half) return 0.5;
  const match = raw.match(/([0-9]+(?:\.[0-9]+)?|[一二兩三四五六七八九十]+)\s*(?:小時|鐘頭|h|H)/);
  if (!match) return null;
  return parseNumberToken(match[1]);
}

function parseAssistantPeriodDuration(text = "", hasSpecificTime = false) {
  const raw = String(text || "");
  if (/整天|整日|全天|一整天|一天/.test(raw)) return 8;
  const explicitWholePeriod = /整個|一整個|整段|都在|整/.test(raw);
  if (hasSpecificTime && !explicitWholePeriod) return null;
  if (/上午|早上/.test(raw) && (explicitWholePeriod || !hasSpecificTime)) return 3;
  if (/下午/.test(raw) && (explicitWholePeriod || !hasSpecificTime)) return 5;
  return null;
}

function parseAssistantVagueStart(text = "", dateKey = key()) {
  const raw = String(text || "");
  if (/上午/.test(raw)) return `${dateKey}T09:00`;
  if (/下午/.test(raw)) return `${dateKey}T13:00`;
  if (/晚上|晚間/.test(raw)) return `${dateKey}T18:00`;
  return null;
}

function assistantFallbackText() {
  return assistantUnknownResponse();
}

async function knowledgeAssistantAnswer(query = "") {
  const text = String(query || "").trim();
  const api = globalThis.KnowledgeAPI;
  if (!text || !api || typeof api.search !== "function") return null;
  try {
    const result = await api.search(text, { limit: 5 });
    const items = Array.isArray(result?.items) ? result.items.filter(item => item && item.title) : [];
    if (!items.length) return null;
    const lines = items.map(item => {
      const source = item.reference?.sourceTitle || item.reference?.title || "藏書閣";
      const excerpt = String(item.summary || "").trim();
      return `• ${item.title}${excerpt ? `：${excerpt}` : ""}\n  來源：${source}`;
    });
    return `🪶 我從藏書閣找到與「${text}」相關的工作知識：\n\n${lines.join("\n")}\n\n這些是文件中的可追溯摘要；如果你希望我把它整理成正式工作，請告訴我是否加入「我的工作」。`;
  } catch (error) {
    console.warn("Knowledge context lookup unavailable; using assistant fallback", { error });
    return null;
  }
}

function pickAssistantResponse(pool = []) {
  if (!pool.length) return "";
  return pool[Math.floor(Math.random() * pool.length)];
}

const assistantSuggestionPool = [
  "如果需要，我可以陪您一起回想今天還有哪些工作要補。",
  "也可以直接告訴我下一筆工作，例如：今天下午兩點到四點開會。",
  "若今天還有請假、會議或教育訓練，我可以一起幫您整理。"
];

const assistantGreetingPool = [
  "👋 您好！我是 Mr. KM。\n\n今天我們一起完成工作吧。",
  "您好，我是 Mr. KM，您的工作搭檔與 Knowledge Manager。\n\n今天需要先建立工時、補登工時月曆，還是整理一個待辦事項？",
  "👋 您好。\n\n我已經在這裡了。可以直接告訴我今天要記錄的工作，例如：今天下午三點到四點開會。"
];

const assistantMorningPool = [
  "☀️ 早安！今天我們一起完成工作吧。\n\n要先建立今天第一筆工時，還是補登工時月曆？",
  "早安，我是 Mr. KM。\n\n我可以先協助您整理今天的工時、工時月曆或待辦事項。"
];

const assistantNightPool = [
  "🌙 晚安。\n\n如果今天還有工時沒記錄，明天也可以再找我補登。",
  "晚安。\n\n今天辛苦了。若還有工時或請假要補登，之後直接告訴我即可。"
];

const assistantThanksPool = [
  "😊 不客氣！\n\n今天還有需要我幫忙建立工時嗎？",
  "不客氣。\n\n如果還有工時、工時月曆或待辦事項，也可以直接告訴我。"
];

const assistantGoodbyePool = [
  "好的，我在這裡。\n\n需要補登工時時，再直接找我。",
  "收到。祝您工作順利。"
];

const assistantUnknownPool = [
  "😊 這個問題我目前還無法直接判斷。\n\n不過如果它和今天的工作有關，我可以先幫您記成工時或待辦事項。",
  "這部分我還在學習中。\n\n如果今天有相關工作，例如研究、開會或整理資料，我可以先幫您留下工作紀錄。",
  "目前這件事超出我能處理的範圍。\n\n但如果您要把它變成今天的工作安排，我可以接著協助建立工時或待辦事項。"
];

const assistantCapabilityPool = [
  "我是 Mr. KM，您的工作搭檔與 Knowledge Manager。\n\n目前我最擅長協助您處理：\n\n• 工時：新增、補登、查詢今日 / 本週進度\n• 工時月曆：把自然語言整理成正式工時紀錄\n• 待辦事項：先建立待辦草稿\n\n您可以直接用一句話告訴我，例如：今天下午三點到四點開會。",
  "我是您的 Mr. KM，不是通用聊天機器人。\n\n我會逐步理解您的工作身分、WorkLog、工時月曆、待辦事項與個人知識。若不確定怎麼開始，可以直接說：「我今天做了什麼？」或「幫我補一筆下午開會」。"
];

function assistantWithSuggestion(text = "") {
  return `${text}\n\n${pickAssistantResponse(assistantSuggestionPool)}`;
}

function assistantUnknownResponse() {
  return assistantWithSuggestion(pickAssistantResponse(assistantUnknownPool));
}

function formatEntryLine(entry) {
  const start = String(entry.at || "").slice(11, 16) || "--:--";
  const end = timeFromMinutes(entryEndMinutes(entry));
  return `${start}–${end}（${formatHumanDuration(entry.hours)}） ${entry.title || "未命名工時"}`;
}

function worklogContextAnswer(scope = "today") {
  const targetDate = new Date();
  const list = scope === "week" ? weekEntries(targetDate) : entriesForDate(targetDate);
  const done = hours(list);
  const target = scope === "week" ? 40 : 8;
  const remaining = Math.max(0, Math.round((target - done) * 10) / 10);
  const scopeLabel = scope === "week" ? "本週" : "今天";
  if (!list.length) {
    return `${scopeLabel}目前還沒有工時紀錄。\n\n如果您已經有開會、處理文件、採購、教育訓練或請假，我可以陪您一起補上。`;
  }
  const lines = list.map(e => `• ${formatEntryLine(e)}`).join("\n");
  const next = remaining > 0
    ? `${scopeLabel}距離 ${formatHumanDuration(target)}還有 ${formatHumanDuration(remaining)}。\n\n要不要一起回想${scope === "week" ? "這週" : "今天"}還有哪些工作需要補齊？`
    : `${scopeLabel}已達到 ${target} 小時。若還有需要補充的紀錄，我也可以繼續幫您整理。`;
  return `我幫您看了一下，${scopeLabel}目前已登記 ${formatHumanDuration(done)}：\n\n${lines}\n\n${next}`;
}

function todayWorkListAnswer() {
  const list = entriesForDate(new Date());
  if (!list.length) {
    return "今天目前尚未看到已建立的工作紀錄。\n\n如果今天有會議、採購、文件整理、教育訓練或請假，我可以一起幫您補齊。";
  }
  const lines = list.map(e => `• ${formatEntryLine(e)}`).join("\n");
  const done = hours(list);
  const remaining = Math.max(0, Math.round((8 - done) * 10) / 10);
  return `今天目前我看到：\n\n${lines}\n\n共 ${formatHumanDuration(done)}。${remaining > 0 ? `\n\n距離今天 8 小時還有 ${formatHumanDuration(remaining)}。需要我陪您一起回想剩下的工作嗎？` : "\n\n今天工時已經達標了。若還有其他紀錄，也可以繼續補上。"}`;
}

function parseConversationIntent(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return null;
  if (/你(可以|能)(做|幫|協助)什麼|你會什麼|功能|怎麼用/.test(raw)) return { type: "capability" };
  if (/^(早安|早|早上好)(啊|呀|喔|哦|！|!|。)?$/i.test(raw)) return { type: "greeting", subtype: "morning" };
  if (/^(晚安|晚上好)(啊|呀|喔|哦|！|!|。)?$/i.test(raw)) return { type: "greeting", subtype: "night" };
  if (/^(你好|您好|哈囉|嗨|hi|hello|hey)(啊|呀|喔|哦|！|!|。)?$/i.test(raw)) return { type: "greeting", subtype: "hello" };
  if (/^(謝謝|感謝|thanks|thank you|thx)(你|您)?(啦|喔|哦|！|!|。)?$/i.test(raw)) return { type: "thanks" };
  if (/^(掰掰|拜拜|再見|bye|goodbye)(啦|喔|哦|！|!|。)?$/i.test(raw)) return { type: "goodbye" };
  if (/^(收到|ok|okay|好的|好|嗯|了解|知道了)(啦|喔|哦|！|!|。)?$/i.test(raw)) return { type: "ack" };
  return null;
}

function executeConversationIntent(intent = null) {
  if (!intent) return null;
  if (intent.type === "capability") return assistantResult(pickAssistantResponse(assistantCapabilityPool));
  if (intent.type === "greeting" && intent.subtype === "morning") return assistantResult(assistantWithSuggestion(pickAssistantResponse(assistantMorningPool)));
  if (intent.type === "greeting" && intent.subtype === "night") return assistantResult(pickAssistantResponse(assistantNightPool));
  if (intent.type === "greeting") return assistantResult(assistantWithSuggestion(pickAssistantResponse(assistantGreetingPool)));
  if (intent.type === "thanks") return assistantResult(pickAssistantResponse(assistantThanksPool));
  if (intent.type === "goodbye") return assistantResult(pickAssistantResponse(assistantGoodbyePool));
  if (intent.type === "ack") return assistantResult(assistantWithSuggestion("收到。"));
  return null;
}

function pendingConversationGuidance(pending = null) {
  if (!pending) return "";
  if (isDurationPending(pending)) return "這筆紀錄還缺少時間長度。您可以直接回覆：30m、1h、1.5h、2h，或輸入自訂時間。";
  if (pending.action === "awaiting_work_context") return "這筆工時還缺少工作分類。請直接回覆：採購、行政、專案或其他適合的分類。";
  if (pending.action === "confirm_add_entry") return "目前有一筆工時等待確認。您可以按「確認建立」，或按「取消」重新開始。";
  if (pending.action === "confirm_calendar") return "目前有一筆工時月曆紀錄等待確認。您可以按「確認建立」，或按「取消」重新開始。";
  if (pending.action === "calendar_worklog_offer") return "目前有一筆工時月曆紀錄等待確認。您可以按「確認建立」，或按「取消」重新開始。";
  return "目前有一個尚未完成的動作，請先確認或取消後再繼續。";
}

function assistantEntryTitle(raw = "", entryType = "work") {
  const text = String(raw || "");
  const cleaned = extractAssistantDescription(text);
  if (/開會|會議/.test(text) && !cleaned) return "會議";
  return cleaned || (entryType === "leave" ? "請假" : "工時紀錄");
}

function includesAny(text = "", words = []) {
  const raw = String(text || "");
  return words.some(word => raw.includes(word));
}

function stripAssistantSlots(raw = "") {
  return String(raw || "")
    .replace(/(\d{1,2})[/-](\d{1,2})/g, "")
    .replace(/(\d{1,2})\s*月\s*(\d{1,2})\s*(?:日|號)?/g, "")
    .replace(/今天|今日|明天|明日|後天|後日|昨天|昨日|下星期|下週|下周|下禮拜|下礼拜/g, "")
    .replace(/(?:下)?(?:星期|週|周|禮拜|礼拜)\s*[日天一二三四五六]/g, "")
    .replace(/上午|下午|晚上|晚間|中午|凌晨/g, "")
    .replace(/[0-9一二兩三四五六七八九十半]+點(半|\d{1,2})?\s*(到|至|-|~)\s*(上午|下午|晚上|晚間|中午|凌晨)?\s*[0-9一二兩三四五六七八九十半]+點?(半|\d{1,2})?/g, "")
    .replace(/[0-9一二兩三四五六七八九十半]+點(半|\d{1,2})?/g, "")
    .replace(/[0-9一二兩三四五六七八九十半]+(?:\.[0-9]+)?\s*(?:小時|h|H)/g, "")
    .replace(/半天|半日|整天|整日|全天|一整天|一天/g, "")
    .replace(/^(我|幫我|請幫我|麻煩|請|要|想要|需要|有|新增|建立|記錄|紀錄|補|提醒我|提醒)/g, "")
    .replace(/(工時|一下|一筆|一個|預計|大概|約|大約|的|了|有|都在|忘了)/g, "")
    .replace(/[，,。.!！?？]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractAssistantDescription(raw = "") {
  const text = String(raw || "");
  if (/開會/.test(text)) return "會議";
  const cleaned = stripAssistantSlots(text);
  return cleaned || "";
}

function parseAssistantSlots(raw = "") {
  const dateKey = parseAssistantDate(raw);
  const range = parseAssistantTimeRange(raw, dateKey);
  const singleStart = parseAssistantSingleStart(raw, dateKey);
  const vagueStart = parseAssistantVagueStart(raw, dateKey);
  const duration = parseAssistantDuration(raw) || parseAssistantPeriodDuration(raw, Boolean(range || singleStart));
  const entryType = entryTypeFromDescription(raw);
  const description = assistantEntryTitle(raw, entryType);
  return { dateKey, range, singleStart, vagueStart, duration, entryType, description, dateWeekdayMismatch: assistantDateWeekdayMismatch(raw, dateKey) };
}

function inferAssistantIntent(raw = "", slots = {}) {
  const text = String(raw || "");
  const hasTime = Boolean(slots.range || slots.singleStart || slots.vagueStart);
  const hasDuration = Boolean(slots.duration);
  const isLeave = slots.entryType === "leave";
  const taskWords = ["提醒我", "提醒", "待辦", "todo", "Todo", "建立待辦", "新增待辦"];
  const unsupportedWords = ["股票", "投資", "基金", "ETF", "新聞", "天氣", "匯率", "餐廳", "旅遊"];
  if (includesAny(text, unsupportedWords)) return "unknown";
  if (isLeave) return "leave";
  if (includesAny(text, taskWords)) return "task";
  if (/新增.+案件|建立.+案件/.test(text) && !hasTime && !hasDuration) return "task";
  if (hasTime || hasDuration || includesAny(text, ["工時", "補", "記錄", "紀錄", "開會", "會議", "驗收", "寫程式", "拜訪", "處理", "整理", "請款", "採購", "教育訓練"])) return "worklog";
  return "unknown";
}

function buildAssistantEntry(command = {}) {
  return createEntry({
    title: command.title,
    at: command.at,
    date: String(command.at || "").slice(0, 10),
    hours: command.hours,
    entryType: command.entryType || "work",
    source: "manual"
  });
}

function inferWorkSemantics(title = "", raw = "") {
  const text = `${title} ${raw}`.trim();
  const rules = [
    { pattern: /採購|請購|詢價|議價|供應商|驗收|交貨/, category: "採購", nature: "案件管理", tags: ["採購", "案件"] },
    { pattern: /請款|發票|應付|付款|費用/, category: "財務行政", nature: "費用管理", tags: ["請款", "費用"] },
    { pattern: /會議|開會|討論|訪談|面試/, category: "協作", nature: "會議", tags: ["會議", "協作"] },
    { pattern: /教育訓練|訓練|研習|課程/, category: "學習發展", nature: "教育訓練", tags: ["訓練"] },
    { pattern: /程式|開發|測試|除錯|系統|部署/, category: "資訊", nature: "專案執行", tags: ["IT", "專案"] },
    { pattern: /報表|資料|文件|整理|歸檔|公文|Mail|信件/, category: "行政", nature: "資料處理", tags: ["行政", "文件"] },
    { pattern: /專案|進度|上櫃|掛牌|企劃|計畫/, category: "專案", nature: "專案管理", tags: ["專案"] },
    { pattern: /客戶|拜訪|客服|聯繫/, category: "客戶服務", nature: "對外協作", tags: ["客戶", "聯繫"] },
    { pattern: /特休|請假|休假|病假|事假/, category: "請假", nature: "Leave", tags: ["請假"] }
  ];
  const matched = rules.filter(rule => rule.pattern.test(text));
  if (!matched.length) return { category: "一般工作", tags: [], nature: "一般工作", confidence: 0.45 };
  const first = matched[0];
  return {
    category: first.category,
    tags: [...new Set(matched.flatMap(rule => rule.tags))],
    nature: first.nature,
    confidence: matched.length > 1 ? 0.94 : 0.82
  };
}

function assistantCommandFromParts({ raw = "", dateKey = key(), at = "", hours = 1, entryType = "work", timeSource = "" } = {}) {
  const hasHours = hours !== undefined && hours !== null && hours !== "";
  const title = assistantEntryTitle(raw, entryType);
  return {
    title,
    raw,
    dateKey,
    at,
    hours: hasHours ? Number(hours) : 1,
    entryType,
    timeSource: timeSource || (at ? "explicit" : ""),
    semantics: inferWorkSemantics(title, raw),
    dateWeekdayMismatch: assistantDateWeekdayMismatch(raw, dateKey)
  };
}

function resolveAssistantCommandTime(command = {}) {
  const dateKey = command.dateKey || String(command.at || "").slice(0, 10) || key();
  const explicitAt = command.timeSource === "explicit" ? command.at : "";
  const resolved = resolveWorklogTime({
    raw: command.raw || "",
    dateKey,
    hours: Number(command.hours || 1),
    explicitAt
  });
  return { ...command, dateKey: resolved.dateKey, at: resolved.at, timeResolution: resolved.reason };
}

function assistantConfirmationPayload(command = {}) {
  const item = buildAssistantEntry(command);
  return {
    title: item.title,
    date: item.date,
    dateLabel: assistantDateLabel(item.date),
    start: String(item.at || "").slice(11, 16),
    end: timeFromMinutes(entryEndMinutes(item)),
    hours: item.hours,
    entryType: item.entryType,
    at: item.at,
    category: command.semantics?.category || "一般工作",
    tags: command.semantics?.tags || [],
    nature: command.semantics?.nature || "一般工作",
    timeResolution: command.timeResolution || "",
    dateWeekdayMismatch: Boolean(command.dateWeekdayMismatch)
  };
}

function isWorkNatureCalendar(command = {}) {
  return /會議|開會|教育訓練|訓練|拜訪|客戶|專案|工作/.test(String(command.title || ""));
}

function isDurationPending(pending = null) {
  return ["awaiting_duration", "add_entry_duration", "calendar_duration"].includes(String(pending?.action || ""));
}

function durationPendingIntent(pending = null) {
  if (pending?.intent) return pending.intent;
  if (pending?.command?.entryType === "leave") return "leave";
  return "worklog";
}

function assistantDurationQuestion(intent = "worklog", command = {}) {
  if (intent === "leave") return "請問是全天、半天，還是幾個小時？";
  return "請問大約花了多久？";
}

function shouldPromptWorkProfileToday() {
  if (isWorkProfileReady(workProfile)) return false;
  const today = key(new Date());
  const prompted = normalizeWorkProfile(workProfile || {}, profile).lastProfilePromptDate || localStorage.getItem(scopedLocalKey(WORK_PROFILE_PROMPT_KEY));
  return prompted !== today;
}

function startWorkProfileConversation() {
  const next = normalizeWorkProfile({ ...(workProfile || {}), lastProfileCheckDate: key(new Date()), lastProfilePromptDate: key(new Date()) }, profile);
  workProfile = next;
  localStorage.setItem(scopedLocalKey(WORK_PROFILE_PROMPT_KEY), key(new Date()));
  saveAll();
  setAssistantPendingCommand({ action: "collect_work_profile", step: "ecp_owner", profileDraft: next });
  return assistantResult("您好，為了讓之後建立工時可以直接匯入 ECP，我們先完成您的工作身分。\n\n我會一步一步協助您，花不到一分鐘即可。\n\n請問您的 ECP 負責人？");
}

function handleWorkProfileConversationReply(text = "", pending = {}) {
  const draft = normalizeWorkProfile(pending.profileDraft || workProfile || {}, profile);
  const value = String(text || "").trim();
  if (/稍後|下次|先不要/.test(value)) {
    setAssistantPendingCommand(null);
    return assistantResult("好的，先不打擾。您仍可建立工時；匯出 ECP 前我會再提醒完成工作身分。");
  }
  if (pending.step === "ecp_owner") {
    draft.ecpResponsiblePerson = value;
    setAssistantPendingCommand({ action: "collect_work_profile", step: "ecp_department", profileDraft: draft });
    return assistantResult("收到。請問您的 ECP 部門？");
  }
  if (pending.step === "ecp_department") {
    draft.ecpDepartment = value;
    setAssistantPendingCommand({ action: "collect_work_profile", step: "default_task", profileDraft: draft });
    return assistantResult("收到。請問您目前主要使用的工作任務？");
  }
  if (pending.step === "default_task") {
    draft.defaultTask = value;
    draft.taskEffectiveMonth = monthKey();
    draft.taskVerifiedAt = new Date().toISOString();
    const normalized = normalizeWorkProfile(draft, profile);
    setAssistantPendingCommand({ action: "confirm_work_profile", profileDraft: normalized });
    return assistantResult("請確認您的工作身分：", { type: "work_profile_confirm", payload: normalized });
  }
  return null;
}

async function confirmWorkProfileFromConversation(draft = {}) {
  applyWorkProfileToProfile(normalizeWorkProfile(draft, profile));
  saveAll();
  await DataService.saveProfileSettingsOnly({ requireCloud: true });
  await DataService.saveEcpTasksOnly({ requireCloud: true });
  await clearAssistantPendingCommand();
  localStorage.setItem(scopedLocalKey(WORKLOG_WELCOME_KEY), "1");
}

function assistantResult(text = "", card = null) {
  return card ? { text, card } : { text };
}

function assistantCommandErrorDebug({ input = "", parsedIntent = null, parsedCommand = null, entryPayload = null, error = null } = {}) {
  return {
    input,
    parsedIntent,
    parsedCommand,
    entryPayload,
    error,
    code: error?.supabase?.code || error?.code || "",
    message: error?.supabase?.message || error?.message || "",
    details: error?.supabase?.details || error?.details || "",
    hint: error?.supabase?.hint || error?.hint || ""
  };
}

function hasExplicitAssistantDuration(raw = "") {
  const dateKey = parseAssistantDate(raw);
  return Boolean(parseAssistantDuration(raw) || parseAssistantPeriodDuration(raw, Boolean(parseAssistantSingleStart(raw, dateKey) || parseAssistantTimeRange(raw, dateKey))) || parseAssistantTimeRange(raw, dateKey));
}

async function callWorkLogDomainLLM(raw = "") {
  if (!hasGoogleOAuthSession()) return null;
  try {
    await ensureFreshAuthSession(false);
    const res = await fetch(`${AUTH_CONFIG.supabaseUrl}/functions/v1/${WORKLOG_LLM_FUNCTION}`, {
      method: "POST",
      headers: cloudHeaders(),
      body: JSON.stringify({
        input: String(raw || ""),
        today: taipeiDateKeyFromDate(new Date()),
        selectedDate: taipeiDateKeyFromDate(selected),
        timezone: "Asia/Taipei",
        scope: ["WorkLog", "Task"]
      })
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn("WorkLog Domain LLM unavailable; fallback to local parser", { status: res.status, body });
      return null;
    }
    const data = await res.json();
    return data?.draft || data || null;
  } catch (error) {
    console.warn("WorkLog Domain LLM failed; fallback to local parser", { error });
    return null;
  }
}

function normalizeClock(value = "") {
  const match = String(value || "").match(/^(\d{1,2}):(\d{1,2})/);
  if (!match) return "";
  return `${String(Number(match[1])).padStart(2, "0")}:${String(Number(match[2])).padStart(2, "0")}`;
}

function hoursBetween(start = "", end = "") {
  const s = minutesFromTime(start);
  let e = minutesFromTime(end);
  if (e <= s) e += 24 * 60;
  return Math.max(0.5, Math.round((e - s) / 30) / 2);
}

function intentFromDomainDraft(raw = "", draft = null) {
  if (!draft || typeof draft !== "object") return null;
  const intent = String(draft.intent || "").toLowerCase();
  const localSlots = parseAssistantSlots(raw);
  const dateKey = String(draft.date || "").match(/^\d{4}-\d{2}-\d{2}$/) ? draft.date : localSlots.dateKey;
  const startTime = normalizeClock(draft.startTime || draft.start_time || "");
  const endTime = normalizeClock(draft.endTime || draft.end_time || "");
  const explicitDuration = hasExplicitAssistantDuration(raw);
  const draftDuration = Number(draft.durationHours || draft.duration_hours || draft.hours || 0);
  const duration = explicitDuration ? (draftDuration || (startTime && endTime ? hoursBetween(startTime, endTime) : localSlots.duration || 0)) : (localSlots.duration || 0);
  const entryType = intent === "leave" ? "leave" : entryTypeFromDescription(draft.description || raw);
  const title = String(draft.description || draft.title || extractAssistantDescription(raw) || (entryType === "leave" ? "請假" : "工時紀錄")).trim();
  const hasExplicitTime = Boolean(localSlots.range || localSlots.singleStart || localSlots.vagueStart);
  const at = hasExplicitTime && startTime ? `${dateKey}T${startTime}` : (localSlots.range?.at || localSlots.singleStart || localSlots.vagueStart || (entryType === "leave" ? `${dateKey}T09:00` : ""));
  const parsedCommand = {
    title,
    raw,
    dateKey,
    at,
    hours: duration,
    entryType,
    timeSource: hasExplicitTime || entryType === "leave" ? "explicit" : "",
    semantics: inferWorkSemantics(title, raw),
    dateWeekdayMismatch: assistantDateWeekdayMismatch(raw, dateKey)
  };
  if (intent === "task") return { type: "task_draft", parsedCommand: { title, raw, llmDraft: draft } };
  if (intent === "calendar") {
    const command = { ...parsedCommand, entryType: "work" };
    if (!command.hours) return { type: "need_duration", parsedCommand: command, llmDraft: draft };
    const resolvedCommand = resolveAssistantCommandTime(command);
    return { type: "confirm_add_entry", parsedCommand: resolvedCommand, entryPayload: assistantConfirmationPayload(resolvedCommand), llmDraft: draft };
  }
  if (intent === "worklog" || intent === "leave") {
    if (!parsedCommand.hours) return { type: "need_duration", parsedCommand, llmDraft: draft };
    const hoursValue = parsedCommand.hours;
    if (!hoursValue) return { type: "need_duration", parsedCommand, llmDraft: draft };
    const command = resolveAssistantCommandTime({ ...parsedCommand, hours: hoursValue });
    return { type: "confirm_add_entry", parsedCommand: command, entryPayload: assistantConfirmationPayload(command), llmDraft: draft };
  }
  return null;
}

function parseWorklogIntentLocal(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return { type: "empty" };
  if (/(今天|今日).*(哪些工作|有什麼工作|做了什麼|做哪些|工作)|我.*今天.*(做了什麼|有哪些工作)|還有.*工作|其他工作/.test(raw)) return { type: "query_today_work" };
  if (/(今天|今日).*(工時|完成|登記|記錄|紀錄|多少)|工時.*(今天|今日)/.test(raw)) return { type: "query_today" };
  if (/(本週|本周|這週|這周).*(工時|完成|登記|記錄|紀錄|多少)|工時.*(本週|本周|這週|這周)/.test(raw)) return { type: "query_week" };
  if (/刪除|移除/.test(raw)) return { type: /最後|上一筆|剛剛/.test(raw) ? "delete_last" : "unsupported_delete" };
  if (/修改|改成|調整/.test(raw)) return { type: /最後|上一筆|剛剛/.test(raw) ? "update_last" : "unsupported_update", hours: parseAssistantDuration(raw) };
  const slots = parseAssistantSlots(raw);
  const intent = inferAssistantIntent(raw, slots);
  if (intent === "task") {
    return { type: "task_draft", parsedCommand: { title: slots.description || stripAssistantSlots(raw) || "待辦", raw } };
  }
  if (intent === "calendar") {
    const at = slots.range?.at || slots.singleStart || slots.vagueStart || "";
    const parsedCommand = assistantCommandFromParts({ raw, dateKey: slots.dateKey, at, hours: slots.range?.hours || slots.duration || 0, entryType: "work" });
    if (!parsedCommand.hours) return { type: "need_duration", parsedCommand };
    const resolvedCommand = resolveAssistantCommandTime(parsedCommand);
    return { type: "confirm_add_entry", parsedCommand: resolvedCommand, entryPayload: assistantConfirmationPayload(resolvedCommand) };
  }
  if (intent === "worklog" || intent === "leave") {
    const { dateKey, range, singleStart, vagueStart, duration, entryType } = slots;
    if (range) {
      const parsedCommand = assistantCommandFromParts({ raw, dateKey, at: range.at, hours: range.hours, entryType });
      return { type: "confirm_add_entry", parsedCommand, entryPayload: assistantConfirmationPayload(parsedCommand) };
    }
    const start = singleStart || vagueStart;
    if (start && !duration && entryType !== "leave") {
      const parsedCommand = assistantCommandFromParts({ raw, dateKey, at: start, hours: 0, entryType });
      return { type: "need_duration", parsedCommand };
    }
    if (entryType === "leave" && !duration && !/半天|半日|整天|整日|全天|一整天|一天/.test(raw)) {
      const parsedCommand = assistantCommandFromParts({ raw, dateKey, at: start || `${dateKey}T09:00`, hours: 0, entryType, timeSource: "explicit" });
      return { type: "need_duration", parsedCommand };
    }
    if (!duration && !start) {
      const parsedCommand = assistantCommandFromParts({ raw, dateKey, at: "", hours: 0, entryType });
      return { type: "need_duration", parsedCommand };
    }
    const hoursValue = duration || (entryType === "leave" ? 8 : 0);
    const at = start || (entryType === "leave" ? `${dateKey}T09:00` : "");
    const parsedCommand = assistantCommandFromParts({ raw, dateKey, at, hours: hoursValue, entryType, timeSource: at ? "explicit" : "" });
    const resolvedCommand = resolveAssistantCommandTime(parsedCommand);
    return { type: "confirm_add_entry", parsedCommand: resolvedCommand, entryPayload: assistantConfirmationPayload(resolvedCommand) };
  }
  return { type: "unsupported" };
}

async function parseWorklogIntent(text = "") {
  const localFirst = String(text || "").trim();
  if (!localFirst) return { type: "empty" };
  if (/(今天|今日).*(哪些工作|有什麼工作|做了什麼|做哪些|工作)|我.*今天.*(做了什麼|有哪些工作)|還有.*工作|其他工作/.test(localFirst)) return parseWorklogIntentLocal(localFirst);
  if (/(今天|今日).*(工時|完成|登記|記錄|紀錄|多少)|工時.*(今天|今日)/.test(localFirst)) return parseWorklogIntentLocal(localFirst);
  if (/(本週|本周|這週|這周).*(工時|完成|登記|記錄|紀錄|多少)|工時.*(本週|本周|這週|這周)/.test(localFirst)) return parseWorklogIntentLocal(localFirst);
  if (/刪除|移除|修改|改成|調整/.test(localFirst)) return parseWorklogIntentLocal(localFirst);
  const llmDraft = await callWorkLogDomainLLM(localFirst);
  const llmIntent = intentFromDomainDraft(localFirst, llmDraft);
  return llmIntent || parseWorklogIntentLocal(localFirst);
}

async function saveAssistantEntry(command = {}) {
  if (!session || !hasGoogleOAuthSession()) throw new Error("尚未完成 Google Login");
  const resolvedCommand = resolveAssistantCommandTime(command);
  const item = buildAssistantEntry(resolvedCommand);
  const error = validateEntry(item);
  if (error) throw new Error(error);
  if (!confirmOvertimeEntry(item)) return { cancelled: true };
  const saved = await persistEntry(item, { requireCloud: true });
  if (!saved) throw new Error("DataService.saveEntry 回傳失敗");
  return { saved, item, command: resolvedCommand };
}

async function executeWorklogCommand(intent) {
  if (intent.type === "empty") return assistantResult("請直接告訴我想記錄的工時，例如：今天下午三點到四點開會。");
  if (intent.type === "query_today_work") return assistantResult(todayWorkListAnswer());
  if (intent.type === "query_today") return assistantResult(worklogContextAnswer("today"));
  if (intent.type === "query_week") return assistantResult(worklogContextAnswer("week"));
  if (intent.type === "delete_last") {
    const list = dayEntries();
    const last = list[list.length - 1];
    if (!last) return assistantResult("今天目前沒有可刪除的工時。");
    await DataService.deleteEntry(last);
    return assistantResult(`已刪除最後一筆工時：${last.title}。`);
  }
  if (intent.type === "update_last") {
    const list = dayEntries();
    const last = list[list.length - 1];
    if (!last) return assistantResult("今天目前沒有可修改的工時。");
    if (!intent.hours) return assistantResult("請告訴我要把最後一筆改成幾小時。");
    const item = createEntry({ ...last, hours: intent.hours, id: last.id, cloudId: last.cloudId });
    const error = validateEntry(item); if (error) return assistantResult(error);
    await persistEntry(item, { requireCloud: true });
    return assistantResult(`已將最後一筆「${last.title}」調整為 ${formatHumanDuration(intent.hours)}。`);
  }
  if (intent.type === "unsupported_delete") return assistantResult("刪除工時目前請指定「刪除最後一筆」，或先到我的工作列表操作。");
  if (intent.type === "unsupported_update") return assistantResult("修改工時目前請指定「修改最後一筆為 X 小時」，或先到我的工作列表操作。");
  if (intent?.parsedCommand?.dateWeekdayMismatch) {
    const command = resolveAssistantCommandTime(intent.parsedCommand);
    await setAssistantPendingCommand({ action: "confirm_date", command });
    return assistantResult("我解析到的日期與你輸入的星期不一致，請先確認日期。", { type: "date_confirmation", payload: assistantConfirmationPayload(command) });
  }
  if (intent.type === "need_duration") {
    const pendingIntent = intent.parsedCommand?.entryType === "leave" ? "leave" : "worklog";
    await setAssistantPendingCommand({ action: "awaiting_duration", intent: pendingIntent, command: intent.parsedCommand });
    return assistantResult(assistantDurationQuestion(pendingIntent, intent.parsedCommand), { type: "duration_prompt", intent: pendingIntent, command: intent.parsedCommand });
  }
  if (intent.type === "calendar_need_duration") {
    await setAssistantPendingCommand({ action: "awaiting_duration", intent: "worklog", command: intent.parsedCommand });
    return assistantResult(assistantDurationQuestion("worklog", intent.parsedCommand), { type: "duration_prompt", intent: "worklog", command: intent.parsedCommand });
  }
  if (intent.type === "task_draft") {
    return assistantResult("我先幫您整理成待辦事項紀錄：", { type: "task_draft", payload: intent.parsedCommand });
  }
  if (intent.type === "confirm_calendar") {
    const command = resolveAssistantCommandTime(intent.parsedCommand);
    await setAssistantPendingCommand({ action: "confirm_add_entry", command });
    return assistantResult("請確認這筆工時：", { type: "confirm_entry", payload: assistantConfirmationPayload(command) });
  }
  if (intent.type === "confirm_pending_calendar") {
    const result = await saveAssistantEntry(intent.parsedCommand);
    await clearAssistantPendingCommand();
    if (result.cancelled) return assistantResult("已取消儲存。");
    return assistantResult("還需要新增其他工時嗎？", { type: "entry_created", payload: assistantConfirmationPayload(result.item) });
  }
  if (intent.type === "create_worklog_from_calendar") {
    const result = await saveAssistantEntry(intent.parsedCommand);
    await clearAssistantPendingCommand();
    if (result.cancelled) return assistantResult("已取消儲存工時。");
    return assistantResult("已同步建立工時。", { type: "entry_created", payload: assistantConfirmationPayload(result.item) });
  }
  if (intent.type === "confirm_add_entry") {
    const command = resolveAssistantCommandTime({
      ...intent.parsedCommand,
      semantics: intent.parsedCommand?.semantics || inferWorkSemantics(intent.parsedCommand?.title, intent.parsedCommand?.raw)
    });
    if (command.entryType !== "leave" && Number(command.semantics?.confidence || 0) < 0.6) {
      await setAssistantPendingCommand({ action: "awaiting_work_context", command });
      return assistantResult("我理解這是一筆工時，但還不確定工作分類。請告訴我是採購、行政、專案或其他哪一類工作？");
    }
    const item = buildAssistantEntry(command);
    const error = validateEntry(item);
    if (error) throw new Error(error);
    await setAssistantPendingCommand({ action: "confirm_add_entry", command });
    return assistantResult("請確認這筆工時：", { type: "confirm_entry", payload: assistantConfirmationPayload(command) });
  }
  if (intent.type === "confirm_pending_entry") {
    const result = await saveAssistantEntry(intent.parsedCommand);
    await clearAssistantPendingCommand();
    if (result.cancelled) return assistantResult("已取消儲存。");
    return assistantResult("還需要新增其他工時嗎？", { type: "entry_created", payload: assistantConfirmationPayload(result.item) });
  }
  return assistantResult(assistantFallbackText());
}

function userBadge() {
  if (!session) return "";
  return `<div class="identity-badge"><span>👤 ${escapeHtml(session.name)}</span><small>${escapeHtml(session.status || session.email || "")}</small><button class="mini" data-logout="1">登出</button></div>`;
}

function headerWorkIdentityStatus() {
  if (!session) return "";
  const missing = workProfileMissingFields(workProfile);
  const ready = !missing.length;
  const detail = ready ? normalizeWorkProfile(workProfile).defaultTask || "查看工作身分" : `缺少：${missing.join("、")}`;
  return `<button class="work-identity-header-status ${ready ? "ready" : "incomplete"}" type="button" data-open-workspace="settings" title="${escapeHtml(detail)}"><span>${ready ? "🟢" : "🟡"} 工作身分</span><small>${ready ? "已完成" : "未完成"}</small></button>`;
}

function header() {
  return `<div class="top"><div class="brand-row"><button class="mini adaptive-menu" data-toggle-sidebar="1">☰</button><div class="brand-stack"><h1><span class="brand-mark" aria-hidden="true">🪶</span> Zhuge AI OS</h1><span class="brand-companion">by Mr. KM</span></div></div><div class="header-right">${headerWorkIdentityStatus()}</div></div>`;
}

/*
 * Root Dashboard and module workspaces intentionally have different shells.
 * The root brand/hero belongs only to the portal; child views get a compact
 * context bar on narrow screens so the sidebar can still be opened without
 * re-introducing the Root Hero into the WorkLog workspace.
 */
function workspaceContextBar() {
  const workspace = workspaceDef(activeWorkspace);
  return `<div class="workspace-context-bar"><div class="workspace-context-inner"><button class="mini adaptive-menu" data-toggle-sidebar="1" aria-label="開啟工作模組選單">☰</button><div class="workspace-context-title"><span class="workspace-breadcrumb"><span class="workspace-breadcrumb-root">Zhuge AI OS</span><span class="workspace-breadcrumb-separator" aria-hidden="true">›</span><span aria-hidden="true">${workspace.icon}</span><span>${escapeHtml(workspace.label)}</span></span></div>${headerWorkIdentityStatus()}</div></div>`;
}

function authScreen() {
  const oauthError = getStoredOAuthError();
  const errorBlock = oauthError ? `<div class="empty" role="alert" style="margin:14px 0;border-color:#d97878"><b>Google 登入未完成</b><div class="muted">${escapeHtml(oauthError.message || "請稍後再試")}</div><small>錯誤代碼：${escapeHtml(oauthError.code || "unknown")}</small></div>` : "";
  return `<div class="wrap"><div class="card"><section class="panel" style="margin-top:18px"><h1>🪶 Zhuge AI OS</h1><div class="muted">by Mr. KM</div><p>Zhuge AI OS 是一套 AI 工作管理平台，整合 Google Login、WorkLog、Google Drive 與知識管理，協助使用者管理每日工作、工作紀錄與知識整理。</p><p class="muted">請使用 Google 帳號登入 Zhuge AI OS，登入後即可使用 WorkLog、Google Drive 整合及 AI 工作管理功能。</p>${errorBlock}<button class="btn full" id="googleLoginBtn">使用 Google 登入</button><nav class="auth-public-links" aria-label="公開產品資訊"><a href="../../product/">產品介紹</a><a href="../../privacy/">隱私權政策</a><a href="../../terms/">服務條款</a><a href="../../support/">支援</a><a href="mailto:qq.1025@gmail.com">聯絡支援</a></nav></section></div></div>`;
}

function worklogWelcomeSeen() {
  return localStorage.getItem(scopedLocalKey(WORKLOG_WELCOME_KEY)) === "1";
}

function needsWorklogWelcome() {
  return !!session && (!isWorkProfileReady(workProfile) || localStorage.getItem(scopedLocalKey(WORK_IDENTITY_COMPLETION_KEY)) === "1");
}

function worklogWelcomeScreen() {
  const completionPending = localStorage.getItem(scopedLocalKey(WORK_IDENTITY_COMPLETION_KEY)) === "1";
  if (completionPending && isWorkProfileReady(workProfile)) {
    return `<div class="wrap"><div class="card"><section class="panel welcome-panel work-identity-complete" style="margin-top:18px"><h1>🎉 工作身分建立完成！</h1><p>之後您只需要用自然語言，例如：</p><div class="work-identity-example">今天下午開會兩小時</div><p>我就可以協助您：</p><ul class="work-identity-list"><li>✅ 建立工時</li><li>✅ 寫入工時月曆</li><li>✅ 建立待辦事項</li></ul><div class="form-actions"><button class="btn" data-enter-ai-os="1">開始使用</button></div></section></div></div>`;
  }
  const step = localStorage.getItem(scopedLocalKey(WORK_IDENTITY_SETUP_STEP_KEY)) || "welcome";
  const draft = normalizeWorkProfile(readJson(scopedLocalKey(WORK_IDENTITY_SETUP_DRAFT_KEY), workProfile || {}), profile);
  const progress = {
    owner: ["Step 1 / 4", "■□□□", "ECP 負責人", "setupEcpOwner", draft.ecpResponsiblePerson, "例如：陳彥達-UU"],
    department: ["Step 2 / 4", "■■□□", "ECP 負責部門", "setupEcpDepartment", draft.ecpDepartment, "例如：UU管理部"],
    task: ["Step 3 / 4", "■■■□", "目前工作任務（Current Active Task）", "setupEcpTask", draft.defaultTask, "例如：202607管理部月工作-採購及管理(含臨時交辦)"],
    confirm: ["Step 4 / 4", "■■■■"]
  };
  if (step === "welcome") {
    return `<div class="wrap"><div class="card"><section class="panel welcome-panel work-identity-welcome" style="margin-top:18px"><h1>👋 歡迎來到 ZhuGe AI OS</h1><p class="work-identity-tagline">一句話記錄工作，一步步建立專屬於你的 AI 工作助理。</p><p>我是 Mr. KM，您的工作搭檔與 Knowledge Manager。</p><p>未來我會逐漸學習您的工作方式，成為最了解您的 AI 助理。</p><p>開始之前，我們先花不到一分鐘，建立您的工作身分。</p><div class="muted">工作身分是 ZhuGe AI OS 對您工作角色的理解基礎，未來 Knowledge Brain、Recommendation Engine 與 Suggestion Engine 都會以此作為 Context。</div><div class="form-actions"><button class="btn" data-work-identity-start="1">開始設定</button></div></section></div></div>`;
  }
  if (step === "confirm") {
    const [label, bars] = progress.confirm;
    return `<div class="wrap"><div class="card"><section class="panel welcome-panel work-profile-setup" style="margin-top:18px"><div class="setup-progress"><span>建立工作身分</span><b>${label}</b><em>${bars}</em></div><h1>請確認您的工作身分</h1><div class="work-profile-confirm"><div>負責人：<b>${escapeHtml(draft.ecpResponsiblePerson || "尚未填寫")}</b></div><div>部門：<b>${escapeHtml(draft.ecpDepartment || "尚未填寫")}</b></div><div>目前工作任務：<b>${escapeHtml(draft.defaultTask || "尚未填寫")}</b></div></div><div class="form-actions"><button class="btn2" data-work-identity-back="task">修改</button><button class="btn" data-confirm-work-profile-setup="1">確認</button></div></section></div></div>`;
  }
  const cfg = progress[step] || progress.owner;
  return `<div class="wrap"><div class="card"><section class="panel welcome-panel work-profile-setup" style="margin-top:18px"><div class="setup-progress"><span>建立工作身分</span><b>${escapeHtml(cfg[0])}</b><em>${escapeHtml(cfg[1])}</em></div><h1>${escapeHtml(cfg[2])}</h1><p class="muted">我會一步一步協助您完成。這些資訊會讓未來工時與 ECP 匯出更順。</p><label>${escapeHtml(cfg[2])}</label><input class="input" id="${escapeHtml(cfg[3])}" value="${escapeHtml(cfg[4])}" placeholder="${escapeHtml(cfg[5])}"><div class="form-actions"><button class="btn2" data-work-identity-prev="1">返回</button><button class="btn" data-work-identity-next="${escapeHtml(step)}">下一步</button></div></section></div></div>`;
}

function migrationScreen() {
  const p = migrationPreview || legacyInventory();
  return `<div class="wrap"><div class="card"><div class="top"><div><div class="muted">☁ RC3.4A Cloud Sync</div><h1>資料上雲確認</h1><div class="muted">系統偵測到 RC3.3 本機資料。請確認後執行一次性搬移，完成後正式資料將以 Supabase 為準，LocalStorage 僅保留安全備份與快取。</div></div><div class="header-right">${userBadge()}</div></div><section class="panel" style="margin-top:18px"><h2>Migration Preview</h2><div class="dashboard-grid"><div class="entry"><b>工時</b><div class="muted">${p.entries} 筆</div></div><div class="entry"><b>工作模型</b><div class="muted">${p.workModels} 筆</div></div><div class="entry"><b>ECP 任務</b><div class="muted">${p.ecpTasks} 筆</div></div><div class="entry"><b>待辦</b><div class="muted">${p.tasks || 0} 筆</div></div><div class="entry"><b>ECP 設定</b><div class="muted">${p.ecpSettings ? "有" : "無"}</div></div><div class="entry"><b>AI Feedback</b><div class="muted">${p.feedback} 筆，本階段僅盤點</div></div><div class="entry"><b>藏書閣</b><div class="muted">${p.library} 筆，本階段僅盤點</div></div></div>${migrationError ? `<div class="empty" style="margin-top:12px"><b>Migration 失敗</b><div class="muted">${escapeHtml(migrationError)}</div></div>` : ""}<div class="form-actions"><button class="btn2" data-logout="1">先不要，登出</button><button class="btn" data-run-migration="1" ${migrationRunning ? "disabled" : ""}>${migrationRunning ? "搬移中..." : "開始 Cloud Sync Migration"}</button></div><div class="muted" style="margin-top:10px">失敗時不會清除 legacy LocalStorage。請確認 Supabase Phase 1 SQL 與 Tasks Cloud SQL 已套用。</div></section></div></div>`;
}

function zhugeDashboard() {
  return zhugeRootDashboardMarkup(session);
}

function workspaceDef(id) {
  return workspaceRegistry[id] || { icon: "□", label: id, comingSoon: true };
}

function normalizeWorkspaceState() {
  openTabs = openTabs.filter(id => workspaceRegistry[id]);
  recentWorkspaces = recentWorkspaces.filter(id => openTabs.includes(id));
  if (!hasOsShellState && session) { openTabs = []; activeWorkspace = "dashboard"; recentWorkspaces = []; hasOsShellState = true; }
  if (activeWorkspace !== "dashboard" && !openTabs.includes(activeWorkspace)) activeWorkspace = recentWorkspaces[0] || "dashboard";
  if (!openTabs.length) activeWorkspace = "dashboard";
}

function rememberWorkspace(id) {
  recentWorkspaces = [id, ...recentWorkspaces.filter(x => x !== id)].filter(x => openTabs.includes(x));
}

function openWorkspace(id) {
  if (!workspaceRegistry[id]) return;
  if (workspaceRegistry[id].comingSoon) return;
  const route = typeof AppRouter !== "undefined" ? AppRouter.resolve(id, view) : { workspace: id, view };
  if (id === "dashboard") {
    activeWorkspace = route.workspace;
    openTabs = [];
    recentWorkspaces = [];
    view = "center";
    saveAll();
    render("workspace-change");
    return;
  }
  if (!openTabs.includes(id)) openTabs.push(id);
  activeWorkspace = route.workspace;
  rememberWorkspace(id);
  if (id === "worklog") view = "center";
  if (id === "library") { view = "library"; editingLibraryId = null; }
  if (id === "sync" || id === "settings") view = "center";
  saveAll();
  render("workspace-change");
}

function activateWorkspace(id) {
  if (!openTabs.includes(id)) return;
  activeWorkspace = id;
  rememberWorkspace(id);
  saveAll();
  render("workspace-change");
}

function closeWorkspace(id) {
  const wasActive = activeWorkspace === id;
  openTabs = openTabs.filter(x => x !== id);
  recentWorkspaces = recentWorkspaces.filter(x => x !== id);
  if (wasActive) activeWorkspace = recentWorkspaces.find(x => openTabs.includes(x)) || openTabs[openTabs.length - 1] || "dashboard";
  saveAll();
  render("workspace-change");
}

function agentStatusPanel() {
  return `<div class="agent-panel"><h3>🤖 Agent</h3>${agentStatuses.map(([icon, name, status]) => `<div class="agent-row"><span>${icon} ${name}</span><b>${escapeHtml(status)}</b></div>`).join("")}</div>`;
}

function sidebarSection(title, group) {
  return `<div class="side-section"><h3>${title}</h3>${Object.entries(workspaceRegistry).filter(([, w]) => w.group === group && !w.hidden).map(([id, w]) => w.enabled ? `<button class="side-item ${activeWorkspace === id ? "on" : ""}" data-open-workspace="${id}"><span>${w.icon} ${w.label}</span></button>` : `<div class="side-item disabled"><span>${w.icon} ${w.label}</span>${w.comingSoon ? `<small>🚧 施工中</small>` : ""}</div>`).join("")}</div>`;
}

function developerConsoleMarkup() {
  const conversationLastSync = conversationSync.lastSyncedAt ? fmt(conversationSync.lastSyncedAt) : "尚未同步";
  const conversationStatus = conversationSync.status === "synced" ? "🟢 已同步" : conversationSync.status === "syncing" ? "🟡 同步中" : conversationSync.status === "failed" ? "🔴 同步失敗" : "🟡 尚未同步";
  const cards = [
    ["conversation", "Conversation", conversationStatus, conversationLastSync],
    ["build", "Build", BUILD_TIME ? "🟢 正常" : "🟡 未提供", BUILD_TIME],
    ["version", "Version", VERSION ? "🟢 正常" : "🟡 未提供", `v${VERSION}`],
    ["schema", "Database Schema", PRIORITY_ENGINE_SCHEMA_SQL ? "🟢 已套用" : "🟡 尚未設定", ""]
  ];
  return `<section class="developer-console" aria-label="System Information"><h3 class="dashboard-section-label">System Information</h3><div class="developer-console-content control-grid system-info-grid">${cards.map(([id, title, status, detail]) => `<article class="service-card system-info-card" data-system-info-card="${id}"><div class="system-info-card-main"><div class="system-info-card-head"><div><h3>${escapeHtml(title)}</h3><b>${escapeHtml(status)}</b></div></div>${detail ? `<div class="muted system-info-card-detail">${escapeHtml(detail)}</div>` : ""}</div></article>`).join("")}</div></section>`;
}

function osSidebar() {
  const checked = new Date().toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false });
  const syncTime = cloudSync.lastSyncedAt ? fmt(cloudSync.lastSyncedAt) : "尚未同步";
  return `<aside class="os-sidebar"><div class="sidebar-brand"><div class="brand-row"><div class="brand-stack" data-open-workspace="dashboard" role="button" tabindex="0" aria-label="返回 Zhuge AI OS 首頁"><h1><span class="brand-mark" aria-hidden="true">🪶</span> Zhuge AI OS</h1><span class="brand-companion">by Mr. KM</span></div></div><button class="mini sidebar-close" data-close-sidebar="1" aria-label="關閉選單">×</button><button class="mini sidebar-menu-mark" type="button" data-toggle-sidebar="1" aria-label="營帳選單">☰</button></div>${agentStatusPanel()}${sidebarSection("🏕️ 營帳", "camp")}${sidebarSection("⚙️ 系統", "system")}<div class="developer-build-info"><div class="sidebar-sync-summary" id="developerCloudSyncStatus" data-retry-cloud-sync="1"><strong>${escapeHtml(sidebarSyncStatusLabel())}</strong><span>最後同步</span><time>${escapeHtml(syncTime)}</time></div><div class="sidebar-version-summary"><span>Version</span><strong>v${escapeHtml(VERSION)}</strong></div><div class="sidebar-build-summary"><span>Build</span><strong>${escapeHtml(BUILD_TIME)}</strong></div></div></aside>`;
}

function workspaceTabs() {
  if (!openTabs.length) return `<div class="workspace-tabs empty"><span>🪶 Zhuge AI OS</span><span class="muted">工作模組入口</span></div>`;
  if (openTabs.length === 1) {
    const w = workspaceDef(openTabs[0]);
    return `<div class="workspace-title">${w.icon} ${w.label}</div>`;
  }
  return `<div class="workspace-tabs">${openTabs.map(id => { const w = workspaceDef(id); const close = openTabs.length > 1 ? `<span class="tab-close" data-close-workspace="${id}">×</span>` : ""; return `<button class="workspace-tab ${activeWorkspace === id ? "active" : ""}" data-activate-workspace="${id}"><span>${w.icon} ${w.label}</span>${close}</button>`; }).join("")}</div>`;
}

function comingSoonWorkspace(id) {
  const w = workspaceDef(id);
  return `<section class="panel coming-soon"><h2>${w.icon} ${w.label}</h2><div class="empty"><b>施工中</b><div class="muted">${w.label} 將於後續版本實作。</div></div></section>`;
}

function workMemorySourcesFor(name = "") {
  const target = String(name || "").trim();
  if (!target) return [];
  const formal = activeWorkMemoryObjects().find(item => item.name === target);
  const formalSources = (formal?.sourceReferences || []).map(reference => reference.label || reference.title || reference.name || "").filter(Boolean);
  if (formalSources.length) return [...new Set(formalSources)];
  const sources = [];
  for (const raw of library || []) {
    const item = normalizedLibraryItem(raw);
    const related = arrayFromInput(item.relatedWorkModels);
    const capabilities = knowledgeCapabilityItems(item, 12);
    const candidates = knowledgeCandidatesForSource(item).map(candidate => candidate.title);
    const haystack = [...related, ...capabilities, ...candidates].map(x => String(x || ""));
    if (haystack.some(value => value === target || value.includes(target) || target.includes(value))) sources.push(item.title || item.filename || item.knowledgeId);
  }
  return [...new Set(sources)].filter(Boolean);
}

function workMemorySourceLibraryItem(sourceName = "") {
  const target = String(sourceName || "").trim();
  if (!target) return null;
  return library.find(raw => {
    const item = normalizedLibraryItem(raw);
    return [item.title, item.filename, item.knowledgeId, item.id, item.cloudId].some(value => String(value || "").trim() === target);
  }) || null;
}

function workMemoryUsageFor(name = "") {
  const target = String(name || "").trim();
  const matched = (entries || []).filter(entry => String(entry.title || "").includes(target) || target.includes(String(entry.title || "")));
  const latest = matched.map(entry => entry.at || `${entry.date || ""}T00:00`).sort().pop() || "";
  return { count: matched.length, latest };
}

function workMemoryCategoryFor(name = "") {
  const text = String(name || "");
  if (/請假|特休|病假|事假|補休|公假|婚假|喪假|育嬰|生理|家庭照顧/.test(text)) return "請假";
  if (/會議|面試|訪談|討論|協調/.test(text)) return "會議";
  if (/教育|訓練|課程|研習/.test(text)) return "教育訓練";
  if (/採購|供應商|詢價|議價|驗收|請款|發票/.test(text)) return "採購";
  return profile?.role || "一般工作";
}

function workMemoryFamiliarityScore(count = 0, sourceCount = 0) {
  return Math.min(5, Math.max(1, Math.ceil((count + sourceCount * 2) / 3)));
}

function workMemoryFamiliarityLabel(score = 1) {
  if (score >= 5) return "非常了解";
  if (score >= 4) return "已經熟悉";
  if (score >= 3) return "開始熟悉";
  return "還在學習";
}

function workMemoryFamiliarityBars(score = 1) {
  const value = Math.min(5, Math.max(1, Number(score || 1)));
  return "■".repeat(value) + "□".repeat(5 - value);
}

function workMemoryPairKey(a = "", b = "") {
  return [String(a || "").trim(), String(b || "").trim()].sort().join("::");
}

function readWorkMemoryMergeDecisions() {
  return readJson(scopedLocalKey(WORK_MEMORY_MERGE_DECISIONS_KEY), {});
}

function saveWorkMemoryMergeDecision(a = "", b = "", decision = "ignored") {
  const decisions = readWorkMemoryMergeDecisions();
  decisions[workMemoryPairKey(a, b)] = { decision, at: new Date().toISOString() };
  localStorage.setItem(scopedLocalKey(WORK_MEMORY_MERGE_DECISIONS_KEY), JSON.stringify(decisions));
  workMemorySuggestionItemsCache = null;
}

function readWorkMemoryMergeStats() {
  return readJson(scopedLocalKey(WORK_MEMORY_MERGE_STATS_KEY), { merged: 0, renamed: 0, added: 0, ignored: 0 });
}

function bumpWorkMemoryMergeStat(name = "merged") {
  const stats = readWorkMemoryMergeStats();
  stats[name] = Number(stats[name] || 0) + 1;
  localStorage.setItem(scopedLocalKey(WORK_MEMORY_MERGE_STATS_KEY), JSON.stringify(stats));
}

function readWorkMemoryAiSuggestionDecisions() {
  return readJson(scopedLocalKey(WORK_MEMORY_AI_SUGGESTION_DECISIONS_KEY), {});
}

function saveWorkMemoryAiSuggestionDecision(key = "", decision = "ignored", detail = {}) {
  if (!key) return;
  const decisions = readWorkMemoryAiSuggestionDecisions();
  decisions[key] = { decision, detail, at: new Date().toISOString() };
  localStorage.setItem(scopedLocalKey(WORK_MEMORY_AI_SUGGESTION_DECISIONS_KEY), JSON.stringify(decisions));
  workMemorySuggestionItemsCache = null;
}

function rawKnowledgeSuggestionCandidates() {
  const rawCandidates = [];
  for (const raw of library || []) {
    const sourceItem = normalizedLibraryItem(raw);
    for (const candidate of knowledgeCandidatesForSource(sourceItem)) {
      const title = String(candidate.title || "").trim();
      if (!title) continue;
      rawCandidates.push({
        title,
        content: candidate.content || candidate.summary || "",
        triggers: arrayFromInput(candidate.triggers),
        source: sourceItem.title || sourceItem.filename || sourceItem.knowledgeId || "藏書閣",
        sourceId: sourceItem.cloudId || sourceItem.id || "",
        defaultDuration: Number(candidate.defaultDuration || 1),
        confidence: Number(candidate.confidence || 0),
        candidate,
        sourceItem
      });
    }
  }
  return rawCandidates;
}

function workMemoryRenameSuggestion(name = "") {
  const clean = String(name || "").trim();
  if (!clean) return "";
  const mappings = [
    [/^(檢查|確認|追蹤).*(請款|發票|付款)/, "費用請款"],
    [/^(檢查|確認|追蹤).*(驗收|交貨|採購)/, "採購案件管理"],
    [/^(建立|整理|更新).*(報表|分析)/, "採購分析"],
    [/^(寄送|回收|整理).*(評鑑|評估)/, "供應商績效評鑑"]
  ];
  return mappings.find(([pattern]) => pattern.test(clean))?.[1] || "";
}

function workMemoryCategorySuggestion(name = "", currentCategory = "") {
  const inferred = workMemoryCategoryFor(name);
  if (!inferred || inferred === currentCategory || inferred === "其他") return "";
  return inferred;
}

// Sprint 3: these are product-level work relationships, not string-only
// duplicates.  Keep the recommendation explainable and user-confirmed.
const WORK_MEMORY_SEMANTIC_GROUPS = Object.freeze([
  { id: "contract", canonical: "合約管理", aliases: ["合約資料整理", "合約管理"], category: "行政" },
  { id: "project", canonical: "專案進度管理", aliases: ["專案追蹤", "專案進度管理"], category: "專案" },
  { id: "procurement", canonical: "採購案件管理", aliases: ["採購分析", "採購進度追蹤"], category: "採購" },
  { id: "meeting", canonical: "會議安排", aliases: ["會議", "會議安排"], category: "會議" }
]);

function workMemorySemanticGroup(name = "") {
  const value = String(name || "").trim();
  if (!value) return null;
  return WORK_MEMORY_SEMANTIC_GROUPS.find(group => group.aliases.some(alias => {
    const left = String(alias || "").trim();
    return value === left;
  })) || null;
}

function workMemorySemanticRelationship(a = "", b = "") {
  const left = workMemorySemanticGroup(a);
  const right = workMemorySemanticGroup(b);
  if (!left || !right || left.id !== right.id || a === b) return null;
  return { ...left, score: 0.94, aliases: [...new Set([...left.aliases, a, b])] };
}

function workMemoryAiSuggestionItems(options = {}) {
  const force = options === true || options?.force === true;
  if (!force && Array.isArray(workMemorySuggestionItemsCache)) return workMemorySuggestionItemsCache;
  const decisions = readWorkMemoryAiSuggestionDecisions();
  const acceptedNames = workModels().map(name => String(name || "").trim()).filter(Boolean);
  const mergeItems = workMemoryMergeSuggestions(10).map(suggestion => {
    const key = `merge:${workMemoryPairKey(suggestion.a, suggestion.b)}`;
    if (decisions[key]?.decision) return null;
    return {
      key,
      type: "merge",
      title: `整理「${suggestion.a}」與「${suggestion.b}」`,
      content: suggestion.description,
      reason: `我發現「${suggestion.a}」與「${suggestion.b}」相似度約 ${Math.round(suggestion.score * 100)}%，可能屬於同一項工作。`,
      suggestion: `建議主要名稱：${suggestion.keep}`,
      source: suggestion.sources.join("、") || "我的工作",
      defaultDuration: "",
      mergeSuggestion: suggestion
    };
  }).filter(Boolean);
  const prepared = SuggestionIntelligence.prepareCandidates(rawKnowledgeSuggestionCandidates(), acceptedNames);
  const knowledgeItems = prepared.items.map(item => {
    const key = `candidate:${SuggestionIntelligence.normalize(item.title)}`;
    const legacyKeys = item.rawCandidates.map(raw => `candidate:${raw.candidate?.cloudId || raw.candidate?.id || raw.sourceId}:${raw.title}`);
    if (decisions[key]?.decision || legacyKeys.some(legacyKey => decisions[legacyKey]?.decision)) return null;
    const representative = item.rawCandidates[0] || {};
    return {
      key,
      type: "candidate",
      title: item.title,
      content: item.content || `我從工作資料裡整理出這項可能的工作。`,
      reason: item.reason,
      suggestion: item.title,
      source: item.sources.join("、") || "藏書閣",
      defaultDuration: item.defaultDuration,
      candidate: representative.candidate,
      sourceItem: representative.sourceItem,
      originalTitles: item.originalTitles,
      generalized: item.generalized
    };
  }).filter(Boolean);
  const renameItems = activeWorkMemoryObjects().map(model => {
    const suggestedName = workMemoryRenameSuggestion(model.name);
    if (!suggestedName || suggestedName === model.name) return null;
    const key = `rename:${model.name}:${suggestedName}`;
    if (decisions[key]?.decision) return null;
    return {
      key,
      type: "rename",
      title: `將「${model.name}」重新命名`,
      content: `我建議使用更能代表完整工作的名稱：「${suggestedName}」。`,
      reason: `「${model.name}」看起來比較像單一步驟，我整理後認為它屬於「${suggestedName}」。`,
      suggestion: suggestedName,
      source: "我的工作",
      renameFrom: model.name,
      renameTo: suggestedName,
      defaultDuration: ""
    };
  }).filter(Boolean);
  const categoryItems = activeWorkMemoryObjects().map(model => {
    const suggestedCategory = workMemoryCategorySuggestion(model.name, model.category);
    if (!suggestedCategory) return null;
    const key = `category:${model.name}:${suggestedCategory}`;
    if (decisions[key]?.decision) return null;
    return {
      key,
      type: "category",
      title: `整理「${model.name}」的分類`,
      content: `我建議將這項工作歸入「${suggestedCategory}」。`,
      reason: `依照工作名稱與目前理解，我認為這個分類更容易讓之後的建議找到它。`,
      suggestion: suggestedCategory,
      source: "我的工作",
      workName: model.name,
      categoryFrom: model.category || "其他",
      categoryTo: suggestedCategory,
      defaultDuration: ""
    };
  }).filter(Boolean);
  workMemorySuggestionItemsCache = [...mergeItems, ...renameItems, ...categoryItems, ...knowledgeItems];
  return workMemorySuggestionItemsCache;
}

function preferredWorkMemoryName(a = "", b = "") {
  const usageA = workMemoryUsageFor(a).count + workMemorySourcesFor(a).length * 2;
  const usageB = workMemoryUsageFor(b).count + workMemorySourcesFor(b).length * 2;
  if (usageA !== usageB) return usageA > usageB ? a : b;
  return String(a || "").length <= String(b || "").length ? a : b;
}

function workMemoryMergeSuggestions(limit = 3) {
  const models = workModels();
  const decisions = readWorkMemoryMergeDecisions();
  const suggestions = [];
  for (let i = 0; i < models.length; i++) {
    for (let j = i + 1; j < models.length; j++) {
      const a = models[i], b = models[j];
      if (decisions[workMemoryPairKey(a, b)]?.decision === "ignored") continue;
      const semantic = workMemorySemanticRelationship(a, b);
      const score = Math.max(SuggestionIntelligence.similarity(a, b), semantic?.score || 0);
      if (score < 0.72) continue;
      const keep = semantic?.canonical || preferredWorkMemoryName(a, b);
      const merge = keep === a ? b : keep === b ? a : (preferredWorkMemoryName(a, b) === a ? b : a);
      const sourceLabels = [...new Set([...workMemorySourcesFor(a), ...workMemorySourcesFor(b), workMemoryUsageFor(a).count || workMemoryUsageFor(b).count ? "歷史工時" : ""].filter(Boolean))];
      suggestions.push({
        a,
        b,
        keep,
        merge,
        score,
        canonical: keep,
        aliases: semantic?.aliases || [...new Set([a, b])],
        category: semantic?.category || workMemoryCategoryFor(keep),
        description: `${keep} 可涵蓋 ${merge}；我建議先預覽合併內容，確認後才會整理正式工作。`,
        sources: sourceLabels.length ? sourceLabels : ["我的工作"]
      });
    }
  }
  return suggestions.sort((x, y) => y.score - x.score).slice(0, limit);
}

function workMemoryMergeSuggestionForNames(names = []) {
  const members = [...new Set(arrayFromInput(names).map(name => String(name || "").trim()).filter(Boolean))];
  if (members.length < 2) return null;
  const models = activeWorkMemoryObjects();
  const selected = members.map(name => models.find(model => model.name === name)).filter(Boolean);
  if (selected.length < 2) return null;
  const semanticGroups = selected.map(model => workMemorySemanticGroup(model.name)).filter(Boolean);
  const sharedSemantic = semanticGroups.length === selected.length && semanticGroups.every(group => group.id === semanticGroups[0].id)
    ? semanticGroups[0]
    : null;
  const canonical = sharedSemantic?.canonical || selected.reduce((preferred, model) => preferredWorkMemoryName(preferred, model.name), selected[0].name);
  const scoreValues = [];
  for (let index = 0; index < members.length; index += 1) {
    for (let nextIndex = index + 1; nextIndex < members.length; nextIndex += 1) {
      scoreValues.push(Math.max(SuggestionIntelligence.similarity(members[index], members[nextIndex]), workMemorySemanticRelationship(members[index], members[nextIndex])?.score || 0));
    }
  }
  const sourceLabels = [...new Set(selected.flatMap(model => workMemorySourcesFor(model.name)).concat(selected.some(model => workMemoryUsageFor(model.name).count) ? ["歷史工時"] : []))];
  const aliases = [...new Set(selected.flatMap(model => model.aliases || []).concat(members).filter(name => name && name !== canonical))];
  return {
    a: members[0],
    b: members[1],
    members,
    keep: canonical,
    merge: members.find(name => name !== canonical) || members[1],
    canonical,
    aliases,
    category: sharedSemantic?.category || workMemoryCategoryFor(canonical),
    score: scoreValues.length ? scoreValues.reduce((sum, value) => sum + value, 0) / scoreValues.length : 0,
    sources: sourceLabels.length ? sourceLabels : ["我的工作"],
    description: `${canonical} 可涵蓋 ${members.filter(name => name !== canonical).join("、")}；我建議先預覽合併內容，確認後才會整理正式工作。`
  };
}

function workMemoryMergePreviewMarkup(suggestion = {}) {
  const members = [...new Set(arrayFromInput(suggestion.members || [suggestion.a, suggestion.b]).filter(Boolean))];
  const sourceLabels = arrayFromInput(suggestion.sources).filter(Boolean);
  const aliases = arrayFromInput(suggestion.aliases).filter(Boolean);
  const sourceCopy = sourceLabels.length ? sourceLabels.join("、") : "我的工作";
  const aliasCopy = aliases.length ? aliases.join("、") : "合併後由 Mr. KM 持續整理";
  const workCards = members.slice(0, 6).map((name, index) => `<div class="merge-work-card"><span>工作 ${String.fromCharCode(65 + index)}</span><strong>${escapeHtml(name)}</strong></div>`).join("");
  return `<div class="companion-card-section work-memory-merge-preview"><b>合併前預覽</b><div class="merge-visual-flow"><div class="merge-member-grid">${workCards}</div><div class="merge-flow-arrow merge-flow-arrow-down" aria-hidden="true">↓</div><div class="merge-work-card merge-result"><span>合併結果</span><strong>${escapeHtml(suggestion.canonical || suggestion.keep || "")}</strong><small>分類：${escapeHtml(suggestion.category || "其他")}</small></div></div><div>相似度：<strong>${Math.round(Number(suggestion.score || 0) * 100)}%</strong></div><div>保留別名：${escapeHtml(aliasCopy)}</div><div>來源與關聯：${escapeHtml(sourceCopy)}</div><small>歷史工時、Knowledge 關聯、來源與啟用狀態會一起保留；只有你確認後才會合併。</small></div>`;
}

function workMemoryItems() {
  return activeWorkMemoryObjects().map(model => {
    const usage = workMemoryUsageFor(model.name);
    const sources = workMemorySourcesFor(model.name);
    return {
      ...model,
      name: model.name,
      description: model.description || `我目前把「${model.name}」理解為你會記錄到工時中的一項工作。`,
      category: model.category || workMemoryCategoryFor(model.name),
      sources,
      familiarityScore: model.familiarity || workMemoryFamiliarityScore(usage.count, sources.length),
      recentUsedAt: model.lastUsedAt || usage.latest,
      enabled: model.isActive,
      usageCount: usage.count
    };
  });
}

function workMemoryItemsForView() {
  const query = String(workMemoryQuery || "").trim().toLocaleLowerCase("zh-TW");
  const filtered = workMemoryItems().filter(item => {
    if (workMemoryCategoryFilter !== "all" && item.category !== workMemoryCategoryFilter) return false;
    if (!query) return true;
    return [item.name, item.description, item.category, ...(item.aliases || []), ...(item.sources || [])]
      .join(" ").toLocaleLowerCase("zh-TW").includes(query);
  });
  return filtered.sort((a, b) => {
    if (workMemorySort === "usage") return Number(b.usageCount || 0) - Number(a.usageCount || 0) || a.name.localeCompare(b.name, "zh-Hant");
    // Categories are metadata filters only; sorting always spans the entire
    // Work Memory workspace.
    return a.name.localeCompare(b.name, "zh-Hant");
  });
}

function workMemoryMergeCompletedBanner() {
  if (!workMemoryMergeCompletedNotice) return "";
  const rebuilding = workMemorySuggestionRebuildInProgress;
  return `<div class="entry work-memory-merge-completed" role="status"><b>✓ Merge Completed</b><div class="muted">${escapeHtml(workMemoryMergeCompletedNotice)}</div><div class="actions compact"><button class="btn" type="button" data-rebuild-work-memory-suggestions="1" ${rebuilding ? "disabled aria-busy=\"true\"" : ""}>${rebuilding ? "⏳ 重新分析中…" : "🔄 重新分析 AI"}</button><button class="btn2" type="button" data-dismiss-work-memory-merge-notice="1" ${rebuilding ? "disabled" : ""}>關閉</button></div></div>`;
}

function setWorkMemoryMergeNotice(message = "") {
  workMemoryMergeCompletedNotice = String(message || "");
  try {
    if (workMemoryMergeCompletedNotice) sessionStorage.setItem(WORK_MEMORY_MERGE_NOTICE_SESSION_KEY, workMemoryMergeCompletedNotice);
    else sessionStorage.removeItem(WORK_MEMORY_MERGE_NOTICE_SESSION_KEY);
  } catch {}
}

async function rebuildWorkMemorySuggestions() {
  if (workMemorySuggestionRebuildInProgress) return;
  workMemorySuggestionRebuildInProgress = true;
  render();
  try {
    await DataService.reloadWorkModels();
    workMemorySuggestionItemsCache = null;
    const items = workMemoryAiSuggestionItems({ force: true });
    setWorkMemoryMergeNotice("");
    toast(`AI 建議已重新分析（${items.length} 項）`);
    return items;
  } catch (error) {
    console.error("Rebuild Work Memory suggestions failed", error);
    toast("Work Memory 尚未完成 Cloud 重新同步，請稍後再試");
    return [];
  } finally {
    workMemorySuggestionRebuildInProgress = false;
    render();
  }
}

function workMemoryPage(options = {}) {
  const compact = !!options.compact;
  const items = workMemoryItemsForView();
  const aiSuggestionCount = workMemoryAiSuggestionItems().length;
  const aiSuggestionButton = aiSuggestionCount
    ? `<button class="btn" data-open-workspace="aiSuggestions">🪶 查看 AI 建議（${aiSuggestionCount}）</button>`
    : `<button class="btn2" disabled>目前沒有新的 AI 建議</button>`;
  const headActions = workMemoryMergeMode
    ? `<button class="btn2" data-cancel-work-memory-merge="1">取消合併</button><button class="btn" data-next-work-memory-merge="1" ${workMemoryMergeSelection.length < 2 ? "disabled" : ""}>下一步（${workMemoryMergeSelection.length}）</button>`
    : `<button class="btn" data-add-work-memory="1">＋ 新增工作</button>${aiSuggestionButton}`;
  const cloudNotice = workMemoryFoundationNotInitialized
    ? `<div class="empty work-memory-cloud-notice"><b>🟡 Work Memory Cloud 尚未初始化</b><div class="muted">目前畫面只顯示本機快取，不能視為正式記憶。請先執行 ${escapeHtml(WORK_MEMORY_SCHEMA_SQL)}。</div></div>`
    : "";
  const cards = items.length ? `<section class="work-memory-folder"><div class="work-memory-folder-head"><div><span class="work-memory-folder-icon">📁</span><b>我的工作</b><small>${items.length} 項工作</small></div><span class="muted">分類僅作標籤與篩選</span></div><div class="work-memory-card-grid">${items.map(item => { const selected = workMemoryMergeSelection.includes(item.name); const cardAction = workMemoryMergeMode ? `<button class="btn2 ${selected ? "selected" : ""}" type="button" data-toggle-work-memory-merge="${escapeHtml(item.name)}">${selected ? "✓ 已選取" : "＋ 選取合併"}</button>` : `<div class="work-memory-card-actions"><button class="btn2" type="button" data-edit-work-memory="${escapeHtml(item.name)}">✏️ 編輯</button><button class="btn2" type="button" data-start-work-memory-merge="${escapeHtml(item.name)}">🔀 合併</button></div>`; return `<article class="work-memory-card work-memory-confirmed-card ${selected ? "is-merge-selected" : ""}"><div class="work-memory-card-top"><span class="work-memory-confirmed-label">已採用工作</span><span class="status-dot ${item.enabled ? "ok" : "off"}" title="${item.enabled ? "已啟用" : "已停用"}"></span></div><b class="work-memory-card-title">${escapeHtml(item.name)}</b><small>${escapeHtml(item.description)}</small><div class="work-memory-card-meta"><span>熟悉度 ${escapeHtml(workMemoryFamiliarityBars(item.familiarityScore))}</span><span>${item.usageCount ? `使用 ${item.usageCount} 次` : "尚未使用"}</span></div>${cardAction}</article>`; }).join("")}</div></section>` : `<div class="empty"><b>${workMemoryItems().length ? "找不到符合條件的工作" : "目前還沒有已採用工作"}</b><div class="muted">${workMemoryItems().length ? "請調整搜尋或分類條件。" : "你可以新增工作，或查看 Mr. KM 整理好的 AI 建議。"}</div></div>`;
  const editingItem = items.find(item => item.name === editingWorkMemoryName);
  const editor = editingItem ? `<div class="quick-add-dialog work-memory-editor"><div class="quick-add-card"><div class="panel-head"><div><h3>✏️ 編輯工作</h3><div class="muted">修改後，Mr. KM 會依照新的內容提供工時建議。</div></div><button class="btn2" type="button" data-cancel-work-memory-edit="1">關閉</button></div><label>工作名稱</label><input class="input" id="workMemoryEditName" value="${escapeHtml(editingItem.name)}"><label>工作說明</label><textarea id="workMemoryEditDescription">${escapeHtml(editingItem.description)}</textarea><label>分類</label><input class="input" id="workMemoryEditCategory" value="${escapeHtml(editingItem.category)}"><label>啟用狀態</label><select class="input" id="workMemoryEditEnabled"><option value="1" ${editingItem.enabled ? "selected" : ""}>啟用</option><option value="0" ${editingItem.enabled ? "" : "selected"}>停用</option></select><div class="form-actions"><button class="btn2 danger" type="button" data-delete-work-memory="${escapeHtml(editingItem.name)}">刪除</button><button class="btn" type="button" data-save-work-memory-edit="${escapeHtml(editingItem.name)}">儲存修改</button></div></div></div>` : "";
  const categories = [...new Set(workMemoryItems().map(item => item.category || "其他"))].sort((a, b) => a.localeCompare(b, "zh-Hant"));
  const filters = `<div class="work-memory-toolbar"><input class="input" type="search" data-work-memory-search placeholder="搜尋我的工作、別名或來源" value="${escapeHtml(workMemoryQuery)}"><select class="input" data-work-memory-category><option value="all" ${workMemoryCategoryFilter === "all" ? "selected" : ""}>全部分類</option>${categories.map(category => `<option value="${escapeHtml(category)}" ${category === workMemoryCategoryFilter ? "selected" : ""}>${escapeHtml(category)}</option>`).join("")}</select><select class="input" data-work-memory-sort><option value="name" ${workMemorySort === "name" ? "selected" : ""}>名稱</option><option value="usage" ${workMemorySort === "usage" ? "selected" : ""}>最近使用</option></select></div>`;
  const mergePreview = workMemoryMergeSuggestions(2);
  const mergeNotice = mergePreview.length && !workMemoryMergeMode ? `<div class="work-memory-ai-notice"><b>🪶 我發現 ${mergePreview.length} 組工作可能可以整理</b><span>${mergePreview.map(item => `${escapeHtml(item.a)} ↔ ${escapeHtml(item.b)}`).join("、")}</span><button class="btn2" data-open-workspace="aiSuggestions">查看 AI 建議</button></div>` : "";
  const mergeModeNotice = workMemoryMergeMode ? `<div class="work-memory-merge-mode"><b>🔀 手動合併工作</b><span>請選擇至少兩項工作；下一步會使用與 AI 建議相同的 Merge Preview。</span><strong>已選 ${workMemoryMergeSelection.length} 項</strong></div>` : "";
  const manualPreview = workMemoryManualMergeSuggestion ? `<div class="work-memory-manual-merge-preview">${workMemoryMergePreviewMarkup(workMemoryManualMergeSuggestion)}<div class="merge-preview-actions"><button class="btn green" data-confirm-work-memory-merge="1">✅ 採用合併</button><button class="btn2" data-cancel-work-memory-merge="1">先保留</button></div></div>` : "";
  const content = `<div class="panel-head"><div><h2>🪶 我的工作</h2><div class="muted">這裡只放你已經確認的工作，也是工時建議的正式來源。</div></div><div class="actions compact work-memory-head-actions">${headActions}</div></div>${workMemoryMergeCompletedBanner()}${cloudNotice}${mergeModeNotice}${manualPreview}${mergeNotice}${filters}<div class="work-memory-count muted">顯示 ${items.length} / ${workMemoryItems().length} 項工作</div><div class="work-memory-folder-grid">${cards}</div>${editor}`;
  return compact ? `<div class="work-memory-page">${content}</div>` : `<section class="panel work-memory-page" style="margin-top:18px">${content}</section>`;
}

function aiSuggestionWorkspace() {
  const suggestions = workMemoryAiSuggestionItems();
  const cards = suggestions.length ? suggestions.map(item => {
    const relatedName = item.type === "merge" ? item.mergeSuggestion?.keep : item.title;
    const usage = workMemoryUsageFor(relatedName || "");
    const sources = [...new Set(String(item.source || "").split("、").map(value => value.trim()).filter(Boolean))];
    const familiarityScore = workMemoryFamiliarityScore(usage.count, sources.length);
    const familiarityLabel = workMemoryFamiliarityLabel(familiarityScore);
    const recent = usage.latest ? fmt(usage.latest) : "尚未使用";
    const sourceList = sources.length ? sources.map(source => `<li><button class="work-memory-source-link" data-work-memory-source-name="${escapeHtml(source)}" data-work-memory-source-work="${escapeHtml(item.title)}">📄 ${escapeHtml(source)}</button></li>`).join("") : `<li><span class="work-memory-source-empty">尚未連結來源資料</span></li>`;
    const mergePreview = item.type === "merge" ? workMemoryMergePreviewMarkup(item.mergeSuggestion) : "";
    const actionLabel = item.type === "merge" ? "🔀 合併" : item.type === "rename" ? "✏️ 重新命名" : item.type === "category" ? "🏷️ 分類" : "🔀 整理到既有工作";
    return `<div class="entry ai-suggestion-workspace-card companion-card"><details class="ai-suggestion-details"><summary><span class="ai-suggestion-summary-title">🪶 ${escapeHtml(item.title)}</span>${item.type === "merge" ? `<span class="ai-suggestion-summary-score">相似度 ${Math.round(Number(item.mergeSuggestion?.score || 0) * 100)}%</span>` : ""}<span class="ai-suggestion-summary-cta">查看建議內容</span></summary><div class="ai-suggestion-details-body"><div class="entry-main"><div class="work-memory-title"><b>${escapeHtml(item.title)}</b><span>${item.type === "merge" ? "整理建議" : item.type === "rename" ? "命名建議" : item.type === "category" ? "分類建議" : "新增建議"}</span></div><div class="companion-card-section"><b>🪶 我為什麼建議？</b><p class="muted">${escapeHtml(item.reason)}</p></div>${mergePreview}<div class="companion-card-section"><b>建議內容</b><div class="source-path">${escapeHtml(item.suggestion)}</div>${item.defaultDuration ? `<small>預設工時：約 ${escapeHtml(formatHumanDuration(item.defaultDuration))}</small>` : ""}</div><div class="companion-card-section"><b>🪶 我是從這些資料學會的：</b><ul class="knowledge-result-list work-memory-source-list">${sourceList}</ul></div><div class="companion-card-grid"><div><span>最近一次陪你完成</span><b>${escapeHtml(recent)}</b></div><div><span>熟悉程度</span><b>${escapeHtml(workMemoryFamiliarityBars(familiarityScore))}</b><small>${escapeHtml(familiarityLabel)}</small></div></div><div class="companion-card-section"><b>採用後，我可以：</b><ul class="knowledge-result-list"><li>✓ 推薦相關工時</li><li>✓ 提醒補工時</li><li>✓ 整理相近工作</li><li>✓ 引用這份經驗協助建立工時</li></ul></div></div><div class="actions compact ai-suggestion-actions"><button class="btn2" data-edit-ai-suggestion="${escapeHtml(item.key)}">✏️ 編輯</button><button class="btn2" data-merge-ai-suggestion="${escapeHtml(item.key)}">${actionLabel}</button><button class="btn green" data-adopt-ai-suggestion="${escapeHtml(item.key)}">✅ 採用</button><button class="btn2" data-ignore-ai-suggestion="${escapeHtml(item.key)}">🙈 忽略</button></div></div></details></div>`;
  }).join("") : `<div class="empty"><b>目前沒有新的 AI 建議</b><div class="muted">如果之後我從文件、歷史工時或相近工作裡發現值得整理的地方，會在這裡提出建議。</div></div>`;
  return `<section class="panel work-memory-ai-suggestions" style="margin-top:18px"><div class="panel-head"><div><h2>🪶 AI 建議</h2><div class="muted">這裡是我的提案，不是正式工作。只有你採用後，才會加入「我的工作」。</div></div><button class="btn2" data-open-workspace="settings">返回我的工作</button></div>${workMemoryMergeCompletedBanner()}<div class="entry"><b>AI 建議，使用者決定</b><div class="muted">我可以提出、整理、合併或提醒；真正決定是否採用的人永遠是你。</div></div><div class="library-list">${cards}</div></section>`;
}

function worklogWorkspace() {
  return view === "capture" ? capture() : center();
}

function workspaceContent() {
  if (activeWorkspace === "dashboard") return zhugeDashboard();
  if (activeWorkspace === "worklog") return profile ? worklogWorkspace() : onboardingWorkspace();
  if (activeWorkspace === "tasks") return taskWorkspace();
  if (activeWorkspace === "library") {
    if (view === "libraryForm") return libraryForm(editingLibraryId);
    if (view === "libraryLearning") return libraryLearningView();
    if (view === "libraryIntelligence") return libraryIntelligenceView(viewingKnowledgeId);
    return libraryView();
  }
  if (activeWorkspace === "aiSuggestions") return aiSuggestionWorkspace();
  if (activeWorkspace === "sync") return sync();
  if (activeWorkspace === "settings") return settings();
  return comingSoonWorkspace(activeWorkspace);
}

function osShell() {
  normalizeWorkspaceState();
  const isRootDashboard = activeWorkspace === "dashboard";
  // The authenticated Dashboard owns the single Root Hero inside its content.
  // The global shell banner is reserved for the unauthenticated landing view;
  // child workspaces use only their compact context bar on narrow screens.
  const shellHeader = isRootDashboard ? "" : workspaceContextBar();
  return `<div class="os-shell workspace-${escapeHtml(activeWorkspace)} ${sidebarOpen ? "sidebar-open" : ""}">${shellHeader}<div class="os-body">${osSidebar()}<div class="sidebar-backdrop" data-close-sidebar="1"></div><main class="os-main">${workspaceTabs()}<div class="workspace-canvas">${workspaceContent()}</div></main></div>${floatingAssistantWidget()}</div>`;
}

function onboardingWorkspace() {
  return `<section class="panel" style="margin-top:18px"><div class="panel-head"><div><h2>🪶 初次認識工時營帳</h2><div class="muted">建立「我的工作」後，我就能提供更貼近你的工時建議。</div></div></div><div class="profile-grid"><div><label>你的職務</label><select id="role" class="input">${roles.map(r => `<option>${r}</option>`).join("")}</select></div><div><label>每日工時</label><select class="input"><option>09:00~18:00，午休 12:00~13:00</option></select></div></div><label>我的工作</label><div class="row two" id="tagOptions">${tagButtons(tagsForRole("採購"))}</div><label>SOP 狀態</label><select id="sop" class="input"><option>目前沒有 SOP，先用職務模型</option><option>有 SOP，之後上傳</option></select><label>工作來源</label><div class="row two">${["Google Drive", "手動紀錄"].map(s => `<button class="btn2 src-btn" data-src="${s}">${s}</button>`).join("")}</div><button class="btn full" id="saveProfile">建立我的工作</button></section>`;
}

function onboarding() {
  return `<div class="wrap"><div class="card"><div class="top"><div><div class="muted">🪶 初次認識</div><h1>你好，我是 Mr. KM</h1><div class="muted">我想先了解你的工作，之後才能產生更貼近你的每日工作建議卡。</div></div><div class="header-right">${userBadge()}<div class="tag">${VERSION}</div></div></div><section class="panel" style="margin-top:18px"><div class="profile-grid"><div><label>你的職務</label><select id="role" class="input">${roles.map(r => `<option>${r}</option>`).join("")}</select></div><div><label>每日工時</label><select class="input"><option>09:00~18:00，午休 12:00~13:00</option></select></div></div><label>我的工作</label><div class="row two" id="tagOptions">${tagButtons(tagsForRole("採購"))}</div><label>SOP 狀態</label><select id="sop" class="input"><option>目前沒有 SOP，先用職務模型</option><option>有 SOP，之後上傳</option></select><label>工作來源</label><div class="row two">${["Google Drive", "手動紀錄"].map(s => `<button class="btn2 src-btn" data-src="${s}">${s}</button>`).join("")}</div><button class="btn full" id="saveProfile">建立我的工作</button></section></div></div>`;
}

function calendarPanel() {
  const base = selectedMonthDate(1);
  const y = base.getFullYear(), m = base.getMonth(), first = new Date(y, m, 1), last = new Date(y, m + 1, 0);
  const selectedInMonth = monthKey(selected) === selectedMonth;
  const monthLabel = `${y}/${String(m + 1).padStart(2, "0")}`;
  let html = `<div class="panel-layout"><div class="panel-head panel-fixed-header"><h2>${monthLabel}</h2><div class="actions compact"><button class="btn2" data-month-nav="-1">上一月</button><button class="btn2" data-today="1">今天</button><button class="btn2" data-month-nav="1">下一月</button></div></div><div class="panel-scroll-content calendar-scroll-content"><div class="cal">${["日", "一", "二", "三", "四", "五", "六"].map(x => `<div class="muted cal-head">${x}</div>`).join("")}`;
  const leadingDays = first.getDay();
  for (let offset = 0; offset < 42; offset++) {
    const cellDate = new Date(y, m, 1 - leadingDays + offset);
    const d = cellDate.getDate();
    const inCurrentMonth = cellDate.getMonth() === m;
    const dk = key(cellDate);
    const h = entries.filter(e => e.date === dk).reduce((s, e) => s + Number(e.hours || 0), 0);
    const isToday = dk === key(new Date());
    const selectedDay = inCurrentMonth && selectedInMonth && d === selected.getDate();
    html += `<div class="day ${inCurrentMonth ? "" : "outside-month"} ${isToday ? "today" : ""} ${selectedDay ? "sel" : ""}"${inCurrentMonth ? ` data-day="${d}"` : ` aria-disabled="true"`}><b>${d}</b><div class="bar"><div class="fill" style="width:${Math.min(100, h / 8 * 100)}%"></div></div><small>${h ? formatHumanDuration(h) : ""}</small></div>`;
  }
  html += `</div></div><div class="panel-fixed-footer calendar-panel-footer"><div class="month-summary"><b>${monthLabel} 工時</b><span>${formatHumanDuration(hours(monthEntries()))}</span></div><button class="btn full" data-export-month="1">⬇️ 下載 ${monthLabel} ECP 匯入檔</button></div></div>`;
  return html;
}

function addDays(d, days) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function startOfWeek(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay());
  return x;
}

function startOfWorkWeek(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay();
  x.setDate(x.getDate() + (day === 0 ? -6 : 1 - day));
  return x;
}

function workdaysInMonth(year, month) {
  const last = new Date(year, month + 1, 0).getDate();
  let count = 0;
  for (let day = 1; day <= last; day++) {
    const d = new Date(year, month, day);
    if (d.getDay() !== 0 && d.getDay() !== 6) count++;
  }
  return count;
}

function remainingWorkdaysInMonth(date = new Date()) {
  const year = date.getFullYear(), month = date.getMonth();
  const last = new Date(year, month + 1, 0).getDate();
  let count = 0;
  for (let day = date.getDate(); day <= last; day++) {
    const d = new Date(year, month, day);
    if (d.getDay() !== 0 && d.getDay() !== 6) count++;
  }
  return count;
}


function weekEntries(d = new Date()) {
  const start = startOfWorkWeek(d);
  const end = addDays(start, 4);
  return entries.filter(entry => {
    const entryDate = safeDate(`${entry.date || ""}T00:00:00`);
    return entryDate >= start && entryDate <= end;
  });
}

function workHoursHealth(avgDailyNeed) {
  if (avgDailyNeed <= 8) return { label: "🟢 正常", className: "good" };
  if (avgDailyNeed <= 10) return { label: "🟡 稍落後", className: "warn" };
  return { label: "🔴 建議補時", className: "bad" };
}

function todaySummaryPanel() {
  const today = new Date();
  const monthDate = selectedMonthDate(1);
  const year = monthDate.getFullYear(), month = monthDate.getMonth();
  const monthlyDone = hours(monthEntries());
  const monthlyTarget = workdaysInMonth(year, month) * 8;
  const monthProgress = monthlyTarget ? Math.min(100, Math.round(monthlyDone / monthlyTarget * 100)) : 0;
  const remaining = Math.max(0, monthlyTarget - monthlyDone);
  const remainingDays = year === today.getFullYear() && month === today.getMonth() ? remainingWorkdaysInMonth(today) : workdaysInMonth(year, month);
  const avgDailyNeed = remainingDays ? Math.round(remaining / remainingDays * 10) / 10 : 0;
  const health = workHoursHealth(avgDailyNeed);
  const todayDone = hours(entriesForDate(today));
  const weekDone = hours(weekEntries(today));
  const weekProgress = Math.min(100, Math.round(weekDone / 40 * 100));
  const todayProgress = Math.min(100, Math.round(todayDone / 8 * 100));
  const summaryOpen = readScopedUiFlag(MOBILE_SUMMARY_OPEN_KEY, true);
  return `<section class="panel mobile-summary-module summary-dashboard ${summaryOpen ? "summary-open" : "summary-collapsed"}"><div class="summary-dashboard-head"><button class="summary-heading-toggle" type="button" data-toggle-mobile-summary="1" aria-expanded="${summaryOpen}"><span>📊 工時摘要 <i>（點擊${summaryOpen ? "收合" : "展開"}）</i></span><small>${summaryOpen ? "⌃" : "⌄"}</small></button></div><div class="summary-grid"><div class="summary-tile"><span>本月進度</span><b>${formatHumanDuration(monthlyDone)} / ${formatHumanDuration(monthlyTarget)}</b><em>${monthProgress}%</em></div><div class="summary-tile"><span>本週進度</span><b>${formatHumanDuration(weekDone)} / 40h</b><em>${weekProgress}%</em></div><div class="summary-tile"><span>今日進度</span><b>${formatHumanDuration(todayDone)} / 8h</b><em>${todayProgress}%</em></div><div class="summary-tile summary-forecast ${health.className}"><span>達標預測</span><b>${health.label}</b></div></div></section>`;
}

function mobileCalendarPanel() {
  const isOpen = readScopedUiFlag(MOBILE_CALENDAR_OPEN_KEY, false);
  const today = new Date();
  const base = selectedMonthDate(1);
  const y = base.getFullYear(), m = base.getMonth();
  const first = new Date(y, m, 1);
  const start = startOfWeek(first);
  const last = new Date(y, m + 1, 0);
  const end = addDays(last, 6 - last.getDay());
  const days = [];
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) days.push(d);
  const dayMarkup = (d, out = false) => {
    const h = hours(entriesForDate(d));
    const isToday = key(d) === key(today);
    const isSelected = key(d) === key(selected);
    return `<button class="mobile-day ${isToday ? "today" : ""} ${isSelected ? "sel" : ""} ${out ? "out" : ""}" data-mobile-date="${key(d)}"><b>${d.getDate()}</b><small>${h ? formatHumanDuration(h) : ""}</small></button>`;
  };
  if (!isOpen) {
    const weekStart = startOfWeek(selected);
    const weekEnd = addDays(weekStart, 6);
    const weekDays = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
    const range = `${String(weekStart.getMonth() + 1).padStart(2, "0")}/${String(weekStart.getDate()).padStart(2, "0")} ~ ${String(weekEnd.getMonth() + 1).padStart(2, "0")}/${String(weekEnd.getDate()).padStart(2, "0")}`;
    return `<div class="mobile-calendar-head"><div><h2>工時月曆</h2><span class="muted">${y} / ${String(m + 1).padStart(2, "0")}</span></div></div><div class="mobile-week-navigation"><button class="btn2" type="button" data-mobile-week-nav="-1" aria-label="上週">‹</button><button class="btn2 mobile-current-week" type="button" data-mobile-week-nav="0">本週 ${range}</button><button class="btn2" type="button" data-mobile-week-nav="1" aria-label="下週">›</button></div><div class="mobile-week-head">${["日", "一", "二", "三", "四", "五", "六"].map(label => `<span>${label}</span>`).join("")}</div><div class="mobile-week-grid">${weekDays.map(d => dayMarkup(d)).join("")}</div><button class="mobile-calendar-expand" type="button" data-toggle-mobile-calendar="1">⌄ 點擊展開月曆</button>`;
  }
  return `<div class="mobile-calendar-head"><div><h2>工時月曆</h2><span class="muted">${y} / ${String(m + 1).padStart(2, "0")}</span></div><button class="btn2" data-toggle-mobile-calendar="1">收合月曆</button></div><div class="mobile-month-navigation"><button class="btn2" type="button" data-mobile-month-nav="-1">← 上一月</button><button class="btn2" type="button" data-mobile-month-nav="0">本月</button><button class="btn2" type="button" data-mobile-month-nav="1">下一月 →</button></div><div class="mobile-month-scroll"><div class="mobile-week-head">${["日", "一", "二", "三", "四", "五", "六"].map(label => `<span>${label}</span>`).join("")}</div><div class="mobile-month-grid">${days.map(d => dayMarkup(d, d.getMonth() !== m)).join("")}</div></div>`;
}

function mobileHomeActionPanel() {
  const todayDone = hours(entriesForDate(new Date()));
  const remaining = Math.max(0, Math.round((8 - todayDone) * 10) / 10);
  const message = remaining > 0 ? `💬 今天還有 ${formatHumanDuration(remaining)} 尚未記錄` : "💬 今天工時已完成 ✅";
  return `<section class="panel mobile-home-action"><button class="btn full" data-action="add">＋ 新增工時</button><div class="mobile-today-metrics"><div><span>今日工時</span><b>${formatHumanDuration(todayDone)} / 8h</b></div><div><span>剩餘工時</span><b>${formatHumanDuration(remaining)}</b></div></div><div class="muted">${message}</div></section>`;
}

function todayPanel() {
  const list = selectedDayEntries();
  const h = hours(list);
  const selectedIsToday = key(selected) === key(new Date());
  const selectedLabel = selectedIsToday ? "今天" : `${selected.getMonth() + 1}/${selected.getDate()}`;
  return `<div class="panel-head panel-fixed-header"><h2>我的工時</h2><div class="tag">${selectedLabel}｜${formatHumanDuration(h)} / 8h</div></div><div class="panel-scroll-content today-entry-list">${list.length ? list.map(e => `<div class="entry"><div class="entry-main"><b>${escapeHtml(e.title)}</b><div class="muted">${escapeHtml(formatWorklogTimeRange(e))}｜${formatHumanDuration(e.hours)}${e.ecpTask ? `｜🏷 任務` : ""}${e.taskTitleSnapshot ? `｜🔗 ${escapeHtml(e.taskTitleSnapshot)}` : ""}</div></div><div class="actions compact entry-actions"><button class="btn amber" data-edit-id="${e.id}">編輯</button><button class="btn red" data-del-id="${e.id}">刪除</button></div></div>`).join("") : `<div class="empty today-empty-state"><b>${selectedIsToday ? "今天" : selectedLabel}尚未建立工時</b></div>`}</div><div class="panel-fixed-footer today-panel-footer"><button class="btn full today-add-bottom" data-action="add">＋ 新增工時</button></div>`;
}

function suggestionBatchSize(viewportWidth = window.innerWidth) {
  return Number(viewportWidth || 0) <= 767 ? 6 : 8;
}

function suggestionBatchState(total = 0, requestedStart = 0, viewportWidth = window.innerWidth) {
  const size = suggestionBatchSize(viewportWidth);
  const batchCount = Math.max(1, Math.ceil(Number(total || 0) / size));
  const requestedBatch = Math.floor(Math.max(0, Number(requestedStart || 0)) / size);
  const batchIndex = Math.min(requestedBatch, batchCount - 1);
  const start = batchIndex * size;
  const end = Math.min(Number(total || 0), start + size);
  return { size, batchCount, batchIndex, start, end, remaining: Math.max(0, Number(total || 0) - end) };
}

function suggestionPriority(model = {}) {
  const title = String(model.name || "");
  const now = Date.now();
  const todayWeekday = new Date().getDay();
  const matchingEntries = entries.filter(entry => {
    const entryTitle = String(entry.title || "");
    return entryTitle.includes(title) || title.includes(entryTitle);
  });
  const recentUsage = matchingEntries.filter(entry => now - new Date(entry.at || entry.date || 0).getTime() <= 90 * 86400000).length;
  const weekdayUsage = matchingEntries.filter(entry => new Date(entry.at || entry.date || 0).getDay() === todayWeekday).length;
  const references = Array.isArray(model.sourceReferences) ? model.sourceReferences : [];
  const knowledgeReferences = references.filter(reference => String(reference?.type || "").includes("knowledge"));
  const confidence = references.reduce((highest, reference) => Math.max(highest, Number(reference?.confidence || 0)), 0);
  const lastUsedTime = new Date(model.lastUsedAt || 0).getTime();
  const recencyScore = Number.isFinite(lastUsedTime) && lastUsedTime > 0
    ? Math.max(0, 12 - Math.floor((now - lastUsedTime) / 86400000))
    : 0;
  const missingHours = Math.max(0, 8 - hours(dayEntries()));
  const metrics = suggestionMetricsFor(model);
  const roleProfile = roleProfileFor(model);
  const primaryRoleMatch = roleProfile.primaryRole === profile?.role ? 1 : 0;
  const secondaryRoleWeight = roleProfile.secondaryRoles.reduce((sum, item) => sum + Number(item?.ratio || 0), 0);
  const usageFrequency = metrics.suggestionCount ? metrics.addedCount / metrics.suggestionCount : 0;
  const currentMinutes = new Date().getHours() * 60 + new Date().getMinutes();
  const commonTimeScore = Object.entries(metrics.commonTimes).reduce((highest, [clock, count]) => {
    const distance = Math.abs(minutesFromTime(clock) - currentMinutes);
    return Math.max(highest, distance <= 90 ? Math.min(8, Number(count || 0) * 2) : 0);
  }, 0);
  const score = (Number(feedback[title] || 0) * 24)
    + (recentUsage * 7)
    + (weekdayUsage * 8)
    + (metrics.addedCount * 10)
    + (metrics.editedCount * 2)
    - (metrics.deletedCount * 5)
    + (metrics.recent7Days * 8)
    + (metrics.recent30Days * 3)
    + (usageFrequency * 18)
    + commonTimeScore
    + (primaryRoleMatch * 10)
    + (secondaryRoleWeight * 6)
    + (Number(model.familiarity || 1) * 4)
    + (knowledgeReferences.length * 3)
    + (confidence * 10)
    + recencyScore
    + (missingHours > 0 ? 5 : 0);
  let reason = "這是你已確認的「我的工作」，可直接加入今天工時。";
  if (weekdayUsage > 0) reason = `你曾在相同星期記錄這項工作 ${weekdayUsage} 次。`;
  else if (recentUsage > 0) reason = `你最近 90 天曾記錄這項工作 ${recentUsage} 次。`;
  else if (knowledgeReferences.length > 0) reason = "這項工作來自 Mr. KM 最近學到並經你確認的工作內容。";
  return { score, reason };
}

function makeSuggestions() {
  if (!profile) return [];
  const suggestions = activeWorkMemoryObjects()
    .map(model => {
      const ranking = suggestionPriority(model);
      const learnedConfidence = (model.sourceReferences || []).reduce((highest, reference) => Math.max(highest, Number(reference?.confidence || 0)), 0);
      return {
        id: model.name,
        title: model.name,
        note: "",
        hours: 1,
        at: resolveWorklogTime({ dateKey: key(), hours: 1 }).at,
        ecpTask: defaultEcpTaskName(model.name),
        sourceLabel: `📂 來源：${model.name}`,
        priority: model.priority || "p2",
        aiScore: ranking.score,
        reason: ranking.reason,
        confidence: learnedConfidence > 0 ? learnedConfidence : 0.85,
        sortOrder: model.sortOrder
      };
    });
  return typeof PriorityEngine !== "undefined"
    ? PriorityEngine.rank(suggestions, { includeCompleted: true })
    : suggestions;
}

function suggestionCardMarkup(item = {}) {
  const relatedTask = Array.isArray(tasks) ? tasks.find(task => task.status !== "completed" && (task.title === item.title || task.title.includes(item.title) || item.title.includes(task.title))) : null;
  const workflow = relatedTask ? `<span class="suggestion-workflow-state">狀態：${escapeHtml(taskStatusLabel(relatedTask.status))}｜進度：${taskProgressValue(relatedTask.progress)}%</span>` : "";
  return `<div class="suggestion-scan-item"><div class="suggestion-scan-body"><h3>${escapeHtml(item.title)}</h3><div class="suggestion-card-meta"><span>${escapeHtml(item.sourceLabel || `📂 來源：${item.title}`)}</span>${workflow}</div><details class="suggestion-reason"><summary>ℹ︎ 為什麼推薦？</summary><p>${escapeHtml(item.reason || "這是你已確認的「我的工作」，可直接加入今天工時。")}</p></details><div class="actions suggestion-actions"><button class="btn green" data-accept="${escapeHtml(item.id)}">加入工時</button><button class="btn2" data-adjust="${escapeHtml(item.id)}">調整</button></div></div></div>`;
}

function suggestionPanel() {
  const suggestions = makeSuggestions();
  if (!suggestions.length) return `<div class="suggestion-panel-head panel-fixed-header"><h2>🪶 Mr. KM 建議</h2></div><div class="panel-scroll-content"><div class="empty"><b>目前沒有建議</b><div class="muted">可能工時已滿，或「我的工作」尚未建立。</div></div></div>`;
  const state = suggestionBatchState(suggestions.length, aiTodaySuggestionIndex);
  aiTodaySuggestionIndex = state.start;
  const batch = suggestions.slice(state.start, state.end);
  return `<div class="suggestion-panel-head panel-fixed-header"><h2>🪶 Mr. KM 建議</h2><b data-suggestion-total>${suggestions.length} 項待處理</b><span data-suggestion-batch-status>第 ${state.batchIndex + 1} / ${state.batchCount} 批</span></div><div class="panel-scroll-content ai-suggestion-scan-list" data-suggestion-batch-list>${batch.map(suggestionCardMarkup).join("")}</div><div class="suggestion-scan-footer panel-fixed-footer"><span class="muted" data-suggestion-remaining>${state.remaining > 0 ? `還有 ${state.remaining} 項` : "✓ 已看完這批建議"}</span><div class="suggestion-batch-actions"><button class="btn2 ${state.batchIndex === 0 ? "is-disabled" : ""}" type="button" data-suggestion-prev-batch aria-disabled="${state.batchIndex === 0}">上一批</button><button class="btn2 ${state.batchIndex >= state.batchCount - 1 ? "is-disabled" : ""}" type="button" data-suggestion-next-batch aria-disabled="${state.batchIndex >= state.batchCount - 1}">下一批</button></div></div>`;
}

function bindSuggestionCardActions(root = document) {
  root.querySelectorAll("[data-accept]").forEach(button => {
    recordSuggestionMetric(button.dataset.accept, "suggested");
    button.onclick = () => acceptSuggestion(button.dataset.accept);
  });
  root.querySelectorAll("[data-adjust]").forEach(button => button.onclick = () => adjustSuggestion(button.dataset.adjust));
}

function renderSuggestionBatchOnly() {
  const panel = document.querySelector(".suggestion-module");
  const list = panel?.querySelector("[data-suggestion-batch-list]");
  if (!panel || !list) return;
  const suggestions = makeSuggestions();
  const state = suggestionBatchState(suggestions.length, aiTodaySuggestionIndex);
  const panelScrollTop = panel.scrollTop;
  const listScrollTop = list.scrollTop;
  aiTodaySuggestionIndex = state.start;
  localStorage.setItem(AI_TODAY_SUGGESTION_INDEX_KEY, String(aiTodaySuggestionIndex));
  list.innerHTML = suggestions.slice(state.start, state.end).map(suggestionCardMarkup).join("");
  const total = panel.querySelector("[data-suggestion-total]");
  const status = panel.querySelector("[data-suggestion-batch-status]");
  const remaining = panel.querySelector("[data-suggestion-remaining]");
  const previous = panel.querySelector("[data-suggestion-prev-batch]");
  const next = panel.querySelector("[data-suggestion-next-batch]");
  if (total) total.textContent = `${suggestions.length} 項待處理`;
  if (status) status.textContent = `第 ${state.batchIndex + 1} / ${state.batchCount} 批`;
  if (remaining) remaining.textContent = state.remaining > 0 ? `還有 ${state.remaining} 項` : "✓ 已看完這批建議";
  if (previous) {
    previous.setAttribute("aria-disabled", String(state.batchIndex === 0));
    previous.classList.toggle("is-disabled", state.batchIndex === 0);
  }
  if (next) {
    next.setAttribute("aria-disabled", String(state.batchIndex >= state.batchCount - 1));
    next.classList.toggle("is-disabled", state.batchIndex >= state.batchCount - 1);
  }
  bindSuggestionCardActions(list);
  panel.scrollTop = panelScrollTop;
  list.scrollTop = listScrollTop;
}

function moveSuggestionBatch(direction = 1) {
  const suggestions = makeSuggestions();
  const state = suggestionBatchState(suggestions.length, aiTodaySuggestionIndex);
  const nextBatch = Math.min(state.batchCount - 1, Math.max(0, state.batchIndex + Number(direction || 0)));
  aiTodaySuggestionIndex = nextBatch * state.size;
  renderSuggestionBatchOnly();
}

function mobileWorklogTabs() {
  const suggestionCount = makeSuggestions().length;
  const tabs = [
    { id: "time", label: "工時" },
    { id: "suggestions", label: `Mr. KM 建議 <span class="mobile-worklog-badge">${suggestionCount}</span>` }
  ];
  return `<nav class="mobile-worklog-tabs" aria-label="工時工作區捷徑">${tabs.map(tab => `<button class="mobile-worklog-tab ${mobileWorklogTab === tab.id ? "active" : ""}" type="button" data-mobile-worklog-tab="${tab.id}">${tab.label}</button>`).join("")}</nav>`;
}

function renderAssistantCard(card = null) {
  if (!card) return "";
  if (card.type === "quick_suggestions") {
  return `<div class="assistant-command-card assistant-quick-card"><div class="assistant-card-title">可以從這裡開始</div><div class="assistant-quick-row"><button class="btn2" type="button" data-assistant-quick="worklog">💼 建立工時</button><button class="btn2" type="button" data-assistant-quick="calendar">🗓 補登工時</button><button class="btn2" type="button" data-assistant-quick="task">✅ 建立待辦事項</button></div></div>`;
  }
  if (card.type === "confirm_entry") {
    const p = card.payload || {};
    return `<div class="assistant-command-card"><div class="assistant-card-title">請確認這筆工時</div><div class="assistant-card-grid"><span>日期</span><b>${escapeHtml(p.dateLabel || p.date || "")}</b><span>時間</span><b>${escapeHtml(p.start || "")}–${escapeHtml(p.end || "")}</b><span>工時</span><b>${escapeHtml(formatHumanDuration(p.hours))}</b><span>描述</span><b>${escapeHtml(p.title || "")}</b><span>分類</span><b>${escapeHtml(p.category || "一般工作")}</b><span>性質</span><b>${escapeHtml(p.nature || "一般工作")}</b></div><div class="assistant-card-actions"><button class="btn green" type="button" data-assistant-confirm-entry="1">確認建立</button><button class="btn2" type="button" data-assistant-cancel-command="1">取消</button></div></div>`;
  }
  if (card.type === "date_confirmation") {
    const p = card.payload || {};
    return `<div class="assistant-command-card"><div class="assistant-card-title">⚠️ 日期與星期需要確認</div><div class="assistant-card-grid"><span>日期</span><b>${escapeHtml(p.dateLabel || p.date || "")}</b><span>時間</span><b>${escapeHtml(p.start || "")}–${escapeHtml(p.end || "")}</b><span>工時</span><b>${escapeHtml(formatHumanDuration(p.hours))}</b><span>內容</span><b>${escapeHtml(p.title || "")}</b></div><p class="muted">我發現你輸入的日期與星期可能不一致。請確認上面的日期後再建立。</p><div class="assistant-card-actions"><button class="btn green" type="button" data-assistant-confirm-date="1">確認日期</button><button class="btn2" type="button" data-assistant-cancel-command="1">取消</button></div></div>`;
  }
  if (card.type === "duration_prompt") {
    const title = card.intent === "leave" ? "請選擇請假時間" : "請選擇預計時間";
    return `<div class="assistant-command-card"><div class="assistant-card-title">${escapeHtml(title)}</div><div class="assistant-duration-row">${[0.5, 1, 1.5, 2].map(h => `<button class="btn2" type="button" data-assistant-duration="${h}">${formatHumanDuration(h)}</button>`).join("")}<button class="btn2" type="button" data-assistant-custom-duration="1">自訂</button></div></div>`;
  }
  if (card.type === "entry_created") {
    const p = card.payload || {};
    return `<div class="assistant-command-card assistant-created-card"><div class="assistant-card-title">✅ 已建立工時</div><div class="assistant-card-grid"><span>描述</span><b>${escapeHtml(p.title || "")}</b><span>日期</span><b>${escapeHtml(p.dateLabel || p.date || "")}</b><span>時間</span><b>${escapeHtml(p.start || "")}–${escapeHtml(p.end || "")}</b><span>工時</span><b>${escapeHtml(formatHumanDuration(p.hours))}</b></div></div>`;
  }
  if (card.type === "task_draft") {
    const p = card.payload || {};
    return `<div class="assistant-command-card"><div class="assistant-card-title">✅ 待辦事項建議</div><div class="assistant-card-grid"><span>待辦事項</span><b>${escapeHtml(p.title || "待辦")}</b><span>狀態</span><b>等待你確認</b></div><div class="assistant-card-actions"><button class="btn green" type="button" data-assistant-create-task="1">建立待辦事項</button><button class="btn2" type="button" data-assistant-edit-task="1">調整</button></div></div>`;
  }
  if (card.type === "calendar_draft") {
    const p = card.payload || {};
    return `<div class="assistant-command-card"><div class="assistant-card-title">🗓 工時月曆紀錄</div><div class="assistant-card-grid"><span>日期</span><b>${escapeHtml(p.dateLabel || p.date || "")}</b><span>時間</span><b>${escapeHtml(p.start || "")}–${escapeHtml(p.end || "")}</b><span>內容</span><b>${escapeHtml(p.title || "")}</b><span>狀態</span><b>待確認建立工時</b></div></div>`;
  }
  if (card.type === "confirm_calendar") {
    const p = card.payload || {};
    return `<div class="assistant-command-card"><div class="assistant-card-title">請確認這筆工時</div><div class="assistant-card-grid"><span>日期</span><b>${escapeHtml(p.dateLabel || p.date || "")}</b><span>時間</span><b>${escapeHtml(p.start || "")}–${escapeHtml(p.end || "")}</b><span>工時</span><b>${escapeHtml(formatHumanDuration(p.hours))}</b><span>內容</span><b>${escapeHtml(p.title || "")}</b></div><div class="assistant-card-actions"><button class="btn green" type="button" data-assistant-confirm-calendar="1">確認建立</button><button class="btn2" type="button" data-assistant-cancel-command="1">取消</button></div></div>`;
  }
  if (card.type === "calendar_created") {
    const p = card.payload || {};
    return `<div class="assistant-command-card assistant-created-card"><div class="assistant-card-title">✅ 已建立工時</div><div class="assistant-card-grid"><span>內容</span><b>${escapeHtml(p.title || "")}</b><span>日期</span><b>${escapeHtml(p.dateLabel || p.date || "")}</b><span>時間</span><b>${escapeHtml(p.start || "")}–${escapeHtml(p.end || "")}</b><span>工時</span><b>${escapeHtml(formatHumanDuration(p.hours))}</b></div></div>`;
  }
  if (card.type === "work_profile_confirm") {
    const p = normalizeWorkProfile(card.payload || {}, profile);
    return `<div class="assistant-command-card"><div class="assistant-card-title">請確認您的工作身分</div><div class="assistant-card-grid"><span>負責人</span><b>${escapeHtml(p.ecpResponsiblePerson || "")}</b><span>部門</span><b>${escapeHtml(p.ecpDepartment || "")}</b><span>目前工作任務</span><b>${escapeHtml(p.defaultTask || "")}</b></div><div class="assistant-card-actions"><button class="btn green" type="button" data-assistant-confirm-work-profile="1">確認</button><button class="btn2" type="button" data-assistant-edit-work-profile="1">修改</button><button class="btn2" type="button" data-assistant-later-work-profile="1">稍後</button></div></div>`;
  }
  return "";
}

function renderAssistantMessage(msg = {}) {
  const roleClass = msg.role === "user" ? "user" : "bot";
  const time = chatMessageTime(msg.at);
  return `<div class="assistant-msg ${roleClass} ${msg.transient ? "thinking" : ""}"><div class="assistant-msg-time">${escapeHtml(time)}</div>${escapeHtml(msg.text)}${renderAssistantCard(msg.card)}</div>`;
}

function chatMessageTime(value = "") {
  if (!value) return "";
  const p = taipeiDateTimeParts(value);
  return `${p.hour}:${p.minute}`;
}

function chatDividerLabel(value = "") {
  const p = taipeiDateTimeParts(value || new Date().toISOString());
  const today = taipeiDateTimeParts(new Date().toISOString());
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const y = taipeiDateTimeParts(yesterday.toISOString());
  const date = `${p.year}-${p.month}-${p.day}`;
  if (date === `${today.year}-${today.month}-${today.day}`) return "今天";
  if (date === `${y.year}-${y.month}-${y.day}`) return "昨天";
  return `${p.year}/${p.month}/${p.day}`;
}

function renderAssistantThread(messages = []) {
  let last = "";
  return messages.map(msg => {
    const label = chatDividerLabel(msg.at);
    const divider = label !== last ? `<div class="assistant-date-divider"><span>${escapeHtml(label)}</span></div>` : "";
    last = label;
    return divider + renderAssistantMessage(msg);
  }).join("");
}

function assistantNudgeText() {
  const done = profile ? hours(entriesForDate(new Date())) : 0;
  const remaining = Math.max(0, Math.round((8 - done) * 10) / 10);
  if (!profile) return "💬 Mr. KM";
  if (remaining <= 0) return "💬 今天工時已完成 ✅";
  return `💬 今天還有 ${formatHumanDuration(remaining)} 尚未紀錄`;
}

function assistantWelcomePanel(mode = "floating") {
  const modeClass = mode === "extension" ? "extension-assistant" : (mode === "standalone" ? "standalone-assistant" : "floating-assistant");
  return `<section class="panel assistant-panel ${modeClass}"><div class="assistant-welcome"><h2>🪶 Zhuge AI OS</h2><div class="muted">by Mr. KM</div><p>歡迎，今天也讓我陪你一起完成工作吧。</p><p>我會協助你用一句自然語言建立工時、寫入工時月曆，並在月底匯出 ECP。</p><button class="btn full" type="button" data-start-assistant="1">開始</button>${mode === "floating" ? `<button class="btn2 full" type="button" data-close-assistant="1">稍後</button>` : ""}</div></section>`;
}

function worklogAssistantPanel(mode = "web") {
  const messages = conversationMessages();
  const visibleMessages = messages.filter(msg => !msg.transient);
  const starter = !visibleMessages.length ? renderAssistantMessage({
    role: "assistant",
    text: "您好，我是 Mr. KM。\n\n今天想完成什麼？",
    card: { type: "quick_suggestions" }
  }) : "";
  const intro = mode === "extension"
    ? `<div class="muted">您可以直接告訴我：今天下午三點到四點開會、明天下午請特休、今天補一小時工時。</div>`
    : `<div class="muted">今天想完成什麼？</div>`;
  const title = "🪶 Mr. KM";
  const modeClass = mode === "extension" ? "extension-assistant" : (mode === "floating" ? "floating-assistant" : (mode === "standalone" ? "standalone-assistant" : "assistant-module"));
  const installAction = mode === "standalone"
    ? (CHROME_EXTENSION_STORE_URL
      ? `<a class="assistant-icon-action" href="${escapeHtml(CHROME_EXTENSION_STORE_URL)}" target="_blank" rel="noopener" title="安裝 Chrome 擴充功能" aria-label="安裝 Chrome 擴充功能">🧩</a>`
      : `<button class="assistant-icon-action disabled" type="button" disabled title="安裝 Chrome 擴充功能（即將推出）" aria-label="安裝 Chrome 擴充功能（即將推出）">🧩</button>`)
    : "";
  const osAction = mode === "extension" || mode === "standalone"
    ? `<a class="assistant-icon-action" href="${escapeHtml(appHomeUrl())}" target="${mode === "extension" ? "_blank" : "_self"}" rel="noopener" title="開啟 ZhuGe AI OS" aria-label="開啟 ZhuGe AI OS">🖥</a>`
    : "";
  const fullscreenAction = mode === "floating"
    ? `<a class="assistant-icon-action" href="${escapeHtml(standaloneChatUrl())}" title="全螢幕開啟" aria-label="全螢幕開啟">↗</a>`
    : "";
  const close = mode === "floating" ? `<button class="assistant-icon-action" type="button" data-close-assistant="1" title="關閉" aria-label="關閉">×</button>` : "";
  const headerActions = `<div class="assistant-header-actions">${installAction}${osAction}${fullscreenAction}${close}</div>`;
  const statusNotice = conversationSync.status === "uninitialized"
    ? `<div class="assistant-sync-warning">Conversation 尚未初始化，聊天目前僅儲存在此瀏覽器。</div>`
    : (conversationSync.status === "failed" ? `<div class="assistant-sync-warning">Conversation 同步失敗：${escapeHtml(conversationSync.error || "請稍後再試")}</div>` : "");
  return `<section class="panel assistant-panel ${modeClass}"><div class="panel-head assistant-chat-head"><div><h2>${title}</h2>${intro}</div>${headerActions}</div>${statusNotice}<div class="assistant-thread" id="assistantThread">${starter}${renderAssistantThread(messages)}</div><div class="assistant-input-row chat-composer"><textarea class="input" id="assistantInput" rows="1" placeholder="例如：今天下午三點到四點開會"></textarea><button class="assistant-send" id="assistantSend" type="button" disabled title="送出" aria-label="送出">➤</button></div></section>`;
}

function extensionAssistantScreen() {
  return `<div class="wrap extension-quick-entry"><div class="card">${hasSeenAssistantWelcome() ? worklogAssistantPanel("extension") : assistantWelcomePanel("extension")}</div></div>`;
}

function standaloneChatScreen() {
  const body = hasSeenAssistantWelcome() ? worklogAssistantPanel("standalone") : assistantWelcomePanel("standalone");
  return `<main class="standalone-chat-page">${body}</main>`;
}

function floatingAssistantWidget() {
  if (!session) return "";
  if (!isAssistantOpen()) return `<div class="floating-assistant-widget collapsed"><button class="floating-assistant-button" type="button" data-open-assistant="1"><span>${escapeHtml(assistantNudgeText())}</span></button></div>`;
  const body = hasSeenAssistantWelcome() ? worklogAssistantPanel("floating") : assistantWelcomePanel("floating");
  return `<div class="floating-assistant-widget open">${body}</div>`;
}

function aiStatusBar() {
  const googleStatus = session ? "🟢 Google 已串接" : "⚪ Google 尚未串接";
  const knowledgeStatus = knowledgeFoundationNotInitialized ? "🟡 Knowledge 等待初始化" : "🟢 Knowledge 已完成";
  const driveStatus = googleConnectionLabel().includes("🟢") ? "🟢 Google Drive 已同步" : "🟡 Google Drive 等待同步";
  return `<section class="ai-status-bar" aria-label="AI Services"><strong>AI Services</strong><div class="ai-status-items"><span class="ai-service-badge">${escapeHtml(googleStatus)}</span><span class="ai-service-badge">${escapeHtml(knowledgeStatus)}</span><span class="ai-service-badge">${escapeHtml(driveStatus)}</span></div></section>`;
}

function center() {
  return `<div class="daily-workspace"><div class="workbench-grid">${todaySummaryPanel()}${mobileWorklogTabs()}<section class="panel module calendar-module" id="mobile-worklog-time"><div class="desktop-calendar">${calendarPanel()}</div><div class="mobile-calendar">${mobileCalendarPanel()}</div></section><section class="panel module today-module">${todayPanel()}</section><section class="panel module suggestion-module" id="mobile-worklog-suggestions">${suggestionPanel()}</section></div>${aiStatusBar()}</div>`;
}

function workProfileStatusCard() {
  const missing = workProfileMissingFields(workProfile);
  const ready = !missing.length;
  const task = normalizeWorkProfile(workProfile).defaultTask || "尚未設定";
  return `<section class="panel work-profile-status ${ready ? "ready" : "incomplete"}"><button class="work-identity-status-button" type="button" data-open-workspace="settings"><span>${ready ? "🟢" : "🟠"} 工作身分</span><b>${ready ? "已完成" : "尚未完成"}</b></button><div class="work-identity-detail"><div class="muted">${ready ? "✓ 已完成" : `⚠ 尚未完成：${missing.join("、")}`}</div><div class="source-path">目前工作任務：${escapeHtml(task)}</div></div><button class="btn2 work-identity-settings" data-open-workspace="settings">設定</button></section>`;
}

function workDescriptionSuggestions(query = "") {
  const source = workModels().map(x => String(x || "").trim()).filter(Boolean);
  const unique = [...new Set(source)];
  const q = query.trim().toLowerCase();
  return unique.filter(x => !q || x.toLowerCase().includes(q));
}

function descriptionSuggestionChips(query = "") {
  const list = workDescriptionSuggestions(query);
  return `<div class="history-suggestions" id="descriptionSuggestions">${list.map(x => `<button class="btn2 suggestion-chip" type="button" data-title-suggestion="${escapeHtml(x)}">${escapeHtml(x)}</button>`).join("")}<button class="btn2 suggestion-chip add-chip" type="button" data-open-work-description-dialog="1">＋新增</button></div><div class="quick-add-dialog" id="workDescriptionDialog" style="display:none"><div class="quick-add-card"><h3>新增工作描述</h3><label>名稱：</label><input class="input" id="newWorkDescription" maxlength="${WORKLOG_DESCRIPTION_MAX_LENGTH}" placeholder="例如：請假-特休、會議、主管交辦"><div class="form-actions"><button class="btn2" type="button" data-cancel-work-description="1">取消</button><button class="btn" type="button" data-add-work-description="1">新增</button></div></div></div>`;
}

function capture(editId = null, seed = null) {
  editId = editId || editingEntryId;
  seed = seed || captureSeed;
  const e = editId ? entries.find(x => x.id === editId) : null;
  const title = e ? e.title : (seed ? seed.title : "");
  const note = e ? (e.note || "") : (seed ? seed.note || "" : "");
  const taskUuid = e?.taskUuid || seed?.taskUuid || "";
  const taskTitleSnapshot = e?.taskTitleSnapshot || seed?.taskTitleSnapshot || "";
  const ecpTask = e ? (e.ecpTask || "") : (seed ? seed.ecpTask || defaultEcpTaskName(seed.title) : defaultEcpTaskName(title));
  const isSuggestion = Boolean(seed?.suggestionId || seed?.source === "ai-card");
  const startAt = e?.at || seed?.at || captureDefaultStart(seed?.hours || 1);
  return `<section class="panel capture-panel" style="margin-top:18px"><div class="panel-head"><div><h2>${e ? "編輯工時" : isSuggestion ? "確認加入工時" : "➕ 快速紀錄"}</h2>${isSuggestion ? `<div class="muted">這筆建議需要確認時間或內容，確認後才會正式寫入工時月曆。</div>` : ""}</div></div><div class="form capture-form"><label>日期 / 開始時間</label><input class="input" id="dt" type="datetime-local" value="${startAt}"><div class="worklog-description-label"><label for="title">工作描述（必填）</label><output id="titleCount" aria-live="polite">${worklogDescriptionLength(title)}/${WORKLOG_DESCRIPTION_MAX_LENGTH}</output></div><input class="input" id="title" maxlength="${WORKLOG_DESCRIPTION_MAX_LENGTH}" value="${escapeHtml(title)}" placeholder="例如：採購案件處理、特休" autocomplete="off">${descriptionSuggestionChips(title)}<label>ECP 任務（選填）</label><select id="ecpTaskSelect" class="input">${ecpTaskOptions(ecpTask)}</select><div class="work-model-add ecp-task-quick-add" id="ecpTaskQuickAdd" style="display:none"><input class="input" id="newEcpTaskCapture" placeholder="新增 ECP 任務，例如：採購案件處理"><button class="btn2" data-add-capture-ecp-task="1" type="button">＋ 新增</button></div><label>工時</label><div class="row hours">${[0.5, 1, 1.5, 2, 3, 4, 5, 8].map(h => `<button class="btn2 hour ${Number(seed?.hours || e?.hours || 1) === h ? "selected" : ""}" data-h="${h}">${formatHumanDuration(h)}</button>`).join("")}</div><label>備註（選填）</label><input class="input" id="note" value="${escapeHtml(note)}" placeholder="補充說明，不參與 ECP 匯出"><div class="form-actions capture-actions"><button class="btn2" data-capture-cancel="1">取消</button><button class="btn" id="saveEntry">${isSuggestion ? "確認建立" : "儲存"}</button></div></div></section>`;
}

function sync() {
  const googleState = googleConnectionLabel();
  const driveAuthorized = googleState.includes("🟢");
  const driveAction = driveAuthorized ? "" : `<div class="service-action-group"><span class="muted">尚未授權 Google Drive</span><span class="muted">授權後即可讀取您指定的工作文件。</span><button class="btn2 service-action" type="button" data-google-drive-authorize>授權 Google Drive</button></div>`;
  const services = [
    ["Google 帳號", session ? "🟢 已登入" : "⚪ 尚未登入", ""],
    ["Google Drive", googleState, driveAction],
    ["Cloud Sync", cloudSyncLabel(), ""],
    ["AI 引擎", "🟢 正常", ""],
    ["Supabase", session ? "🟢 已連線" : "⚪ 尚未登入", ""],
    ["本機資料", "🟢 正常", ""]
  ];
  return `<section class="panel control-center" style="margin-top:18px"><div class="panel-head"><div><h2>🔗 控制台</h2><div class="muted">AI OS 健康狀態。</div></div></div><h3 class="dashboard-section-label">Operational Status</h3><div class="control-grid">${services.map(([name, state, action]) => `<div class="service-card"><div><h3>${escapeHtml(name)}</h3><b>${escapeHtml(state)}</b></div>${action}</div>`).join("")}</div>${developerConsoleMarkup()}</section>`;
}

function nextKnowledgeId() {
  const max = library
    .map(item => String(item.knowledgeId || "").match(/^KB-(\d{6})$/)?.[1])
    .filter(Boolean)
    .map(Number)
    .reduce((n, v) => Math.max(n, v), 0);
  return `KB-${String(max + 1).padStart(6, "0")}`;
}

function knowledgeStatusFromLegacy(item = {}) {
  const status = item.status || item.readingStatus || "";
  if (status.includes("已驗證")) return "⭐ 已驗證";
  if (status.includes("已建立知識")) return "🟢 AI 已建立知識";
  if (status.includes("已閱讀") || status.includes("已完成")) return "🔵 AI 已閱讀";
  return "🟡 已上傳";
}

function aiStatusFromLegacy(item = {}) {
  const ai = item.aiStatus || item.readingStatus || "";
  if (ai.includes("已驗證")) return "已驗證";
  if (ai.includes("已建立知識")) return "AI 已建立知識";
  if (ai.includes("已閱讀") || ai.includes("已完成")) return "AI 已閱讀";
  if (ai.includes("等待")) return "等待 AI 閱讀";
  return "未建立";
}

function arrayFromInput(value) {
  if (Array.isArray(value)) return value.map(x => String(x).trim()).filter(Boolean);
  return String(value || "").split(/[,\n，]/).map(x => x.trim()).filter(Boolean);
}

function normalizeKnowledgeScope(value = "personal") {
  const raw = String(value || "personal").trim();
  const map = { Personal: "personal", Role: "role", Company: "company", Public: "public" };
  const normalized = map[raw] || raw.toLowerCase();
  return KNOWLEDGE_SCOPES.includes(normalized) ? normalized : "personal";
}

function normalizeKnowledgeProcessingStatus(value = "uploaded") {
  const raw = String(value || "uploaded").trim();
  const legacyMap = {
    "🟡 已上傳": "uploaded",
    "🔵 AI 已閱讀": "processed",
    "🟢 AI 已建立知識": "knowledge_built",
    "⭐ 已驗證": "verified",
    "未建立": "uploaded",
    "等待 AI 閱讀": "uploaded"
  };
  const normalized = legacyMap[raw] || raw;
  return KNOWLEDGE_PROCESSING_STATUS.includes(normalized) ? normalized : "uploaded";
}

function sanitizeStorageFileName(name = "") {
  const cleaned = String(name || "knowledge-source")
    .replace(/[\\/:*?"<>|#%{}^~\\[\\]`]/g, "-")
    .replace(/\s+/g, "_")
    .slice(0, 140);
  return cleaned || "knowledge-source";
}

function inferKnowledgeSourceType(name = "") {
  const lower = String(name || "").toLowerCase();
  if (/\.pdf$/.test(lower)) return "pdf";
  if (/\.(doc|docx)$/.test(lower)) return "word";
  if (/\.(xls|xlsx|csv)$/.test(lower)) return "excel";
  if (/\.(ppt|pptx)$/.test(lower)) return "powerpoint";
  if (/\.(md|markdown|txt)$/.test(lower)) return "markdown";
  if (/^https?:\/\//.test(lower)) return "url";
  return "file";
}

function normalizeKnowledgeSourceType(value = "", fallbackName = "") {
  const raw = String(value || "").trim();
  const map = { "上傳文件": "file", "PDF": "pdf", "網址": "url", legacy: "legacy_metadata" };
  const normalized = map[raw] || raw.toLowerCase();
  return KNOWLEDGE_SOURCE_TYPES.includes(normalized) ? normalized : inferKnowledgeSourceType(fallbackName);
}

function processingStatusLabel(status = "uploaded") {
  const labels = {
    uploaded: "🟡 已上傳",
    queued: "⚪ 等待整理",
    processing: "🔄 整理中",
    processed: "🔵 已整理",
    knowledge_built: "🟢 已建立知識",
    verified: "⭐ 已確認",
    failed: "🔴 整理失敗",
    archived: "⚫ 已封存"
  };
  return labels[status] || status;
}

function knowledgeSupportLevelLabel(level = "") {
  const labels = {
    full: "完整文字整理",
    "xml-text": "文件文字整理",
    "basic-text-layer": "基礎文字整理",
    basic: "基礎整理"
  };
  return labels[level] || "尚未整理";
}

function knowledgeSourceTypeLabel(type = "") {
  const labels = {
    file: "檔案",
    pdf: "PDF",
    word: "Word",
    excel: "Excel",
    powerpoint: "PowerPoint",
    markdown: "文字文件",
    url: "網址",
    legacy_metadata: "舊版資料"
  };
  return labels[type] || type || "未指定";
}

function knowledgeSourceProviderLabel(provider = "upload") {
  return provider === "google_drive" ? "Google Drive 文件" : "使用者上傳文件";
}

function knowledgeActionLabel(status = "uploaded") {
  return ["processed", "verified", "failed"].includes(status) ? "重新學習" : "開始學習";
}

function canViewKnowledgeResult(status = "uploaded") {
  return ["processed", "verified", "failed"].includes(status);
}

function knowledgeUnitTypeLabel(type = "reference") {
  const labels = {
    rule: "規則",
    checklist: "檢查事項",
    process: "流程",
    form: "表單",
    recommendation: "建議工作",
    reference: "摘要",
    exception: "注意事項",
    faq: "常見問題"
  };
  return labels[type] || type;
}

function knowledgeOutcomeCounts(item = {}) {
  const units = knowledgeUnitsForSource(item);
  const candidates = knowledgeCandidatesForSource(item);
  return {
    summary: units.filter(unit => unit.unitType === "reference").length,
    process: units.filter(unit => unit.unitType === "process" || unit.unitType === "checklist").length,
    rule: units.filter(unit => unit.unitType === "rule" || unit.unitType === "exception").length,
    recommendation: candidates.length
  };
}

function knowledgeCapabilityItems(item = {}, limit = 4) {
  const summary = item.intelligenceSummary || {};
  const units = knowledgeUnitsForSource(item);
  const candidates = knowledgeCandidatesForSource(item);
  const items = [
    ...(Array.isArray(summary.works) ? summary.works.map(work => work.name) : []),
    ...candidates.map(candidate => candidate.title),
    ...units.filter(unit => ["process", "checklist", "rule", "recommendation"].includes(unit.unitType)).map(unit => unit.title),
    ...arrayFromInput(summary.topics || [])
  ].map(x => String(x || "").trim()).filter(Boolean);
  return [...new Set(items)].slice(0, limit);
}

function knowledgeLearnedLabel(status = "uploaded") {
  if (status === "verified" || status === "knowledge_built") return "🟢 Mr. KM 已學會";
  if (status === "processed") return "🔵 等待確認理解";
  if (status === "processing") return "🔄 Mr. KM 正在整理";
  if (status === "queued") return "⚪ 等待 Mr. KM 閱讀";
  if (status === "failed") return "🔴 整理失敗";
  if (status === "archived") return "⚫ 已封存";
  return "🟡 等待 Mr. KM 閱讀";
}

function roleDisplayName(code = "") {
  return roleNameMap[code] || code || "待確認職務";
}

function normalizedLibraryItem(item = {}) {
  const now = new Date().toISOString();
  const storagePath = item.storagePath || item.storage_path || "";
  const filename = item.filename || item.sourceName || item.source_name || item.location || "";
  const title = item.title || item.name || filename || "";
  const createdAt = item.createdAt || item.created_at || now;
  return {
    id: item.id || uid("kb"),
    cloudId: item.cloudId || item.cloud_id || undefined,
    organizationId: item.organizationId || item.organization_id || null,
    tenantId: item.tenantId || item.tenant_id || null,
    knowledgeId: item.knowledgeId || item.knowledge_id || "",
    title,
    name: title,
    description: item.description || "",
    category: KNOWLEDGE_CATEGORIES.includes(item.category) ? item.category : "其他",
    scope: normalizeKnowledgeScope(item.scope),
    sourceType: normalizeKnowledgeSourceType(item.sourceType || item.source_type || item.type, filename),
    sourceProvider: item.sourceProvider || item.source_provider || "upload",
    externalFileId: item.externalFileId || item.external_file_id || "",
    sourceModifiedAt: item.sourceModifiedAt || item.source_modified_at || "",
    sourceMetadata: item.sourceMetadata || item.source_metadata || {},
    sourceName: item.sourceName || item.source_name || filename,
    sourceUrl: item.sourceUrl || item.source_url || "",
    mimeType: item.mimeType || item.mime_type || "",
    fileSize: Number(item.fileSize || item.file_size || 0) || 0,
    applicableAgents: arrayFromInput(item.applicableAgents || item.applicable_agents || ["採購 Agent"]),
    relatedRoles: arrayFromInput(item.relatedRoles || item.related_roles || (profile?.role ? [roleCode(profile.role)] : [])),
    relatedWorkModels: arrayFromInput(item.relatedWorkModels || item.related_work_models),
    tags: arrayFromInput(item.tags),
    triggers: arrayFromInput(item.triggers),
    processingStatus: normalizeKnowledgeProcessingStatus(item.processingStatus || item.processing_status || item.status || item.aiStatus || item.ai_status),
    extractedText: item.extractedText || item.extracted_text || "",
    intelligenceSummary: item.intelligenceSummary || item.intelligence_summary || {},
    intelligenceError: item.intelligenceError || item.intelligence_error || "",
    processedAt: item.processedAt || item.processed_at || "",
    verifiedAt: item.verifiedAt || item.verified_at || "",
    status: normalizeKnowledgeProcessingStatus(item.processingStatus || item.processing_status || item.status || item.aiStatus || item.ai_status),
    aiStatus: normalizeKnowledgeProcessingStatus(item.processingStatus || item.processing_status || item.status || item.aiStatus || item.ai_status),
    version: item.version || "v1.0",
    sourceVersion: item.sourceVersion || item.source_version || item.version || "v1.0",
    knowledgeVersion: item.knowledgeVersion || item.knowledge_version || "v1.0",
    indexedAt: item.indexedAt || item.indexed_at || "",
    createdAt,
    updatedAt: item.updatedAt || item.updated_at || createdAt,
    filename,
    storagePath,
    type: normalizeKnowledgeSourceType(item.type || item.sourceType || item.source_type, filename),
    readingStatus: normalizeKnowledgeProcessingStatus(item.processingStatus || item.processing_status || item.status || item.aiStatus || item.ai_status),
    location: filename,
    purpose: item.purpose || ""
  };
}

function knowledgeFromCloud(row = {}) {
  return normalizedLibraryItem({
    id: row.legacy_id || row.id,
    cloudId: row.id,
    knowledgeId: row.knowledge_id,
    title: row.title,
    description: row.description,
    category: row.category,
    scope: row.scope,
    organizationId: row.organization_id,
    tenantId: row.tenant_id,
    sourceType: row.source_type,
    sourceProvider: row.source_provider,
    externalFileId: row.external_file_id,
    sourceModifiedAt: row.source_modified_at,
    sourceMetadata: row.source_metadata || {},
    sourceName: row.source_name,
    sourceUrl: row.source_url,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    applicableAgents: row.applicable_agents || [],
    relatedRoles: row.related_roles || [],
    relatedWorkModels: row.related_work_models || [],
    tags: row.tags || [],
    triggers: row.triggers || [],
    processingStatus: row.processing_status,
    extractedText: row.extracted_text || "",
    intelligenceSummary: row.intelligence_summary || {},
    intelligenceError: row.intelligence_error || "",
    processedAt: row.processed_at || "",
    verifiedAt: row.verified_at || "",
    status: row.processing_status,
    aiStatus: row.processing_status,
    version: row.version,
    sourceVersion: row.source_version,
    knowledgeVersion: row.knowledge_version,
    indexedAt: row.indexed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    filename: row.filename,
    storagePath: row.storage_path
  });
}

function selectOptions(options = [], selected = "") {
  return options.map(option => `<option value="${escapeHtml(option)}" ${option === selected ? "selected" : ""}>${escapeHtml(option)}</option>`).join("");
}

function checkboxGroup(options = [], selected = [], name = "") {
  const set = new Set(selected || []);
  return `<div class="work-model-list">${options.map(option => {
    const label = name === "libRoles" ? roleDisplayName(option) : option;
    return `<label class="work-model-check"><input type="checkbox" name="${escapeHtml(name)}" value="${escapeHtml(option)}" ${set.has(option) ? "checked" : ""}><span>${escapeHtml(label)}</span></label>`;
  }).join("")}</div>`;
}

function formatKnowledgeTime(value = "") {
  if (!value) return "";
  return fmt(value);
}

function formatFileSize(bytes = 0) {
  const n = Number(bytes || 0);
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 102.4) / 10} KB`;
  return `${Math.round(n / 1024 / 102.4) / 10} MB`;
}

function legacyKnowledgeItems() {
  return readJson("wl_library", []).filter(item => item && !item.p5Migrated);
}

function hasLegacyKnowledgeMigrationDone() {
  return localStorage.getItem(scopedLocalKey(LEGACY_KNOWLEDGE_MIGRATION_KEY)) === "1";
}

function knowledgeInitializationNotice() {
  return `<div class="empty"><b>📚 藏書閣尚未初始化</b><div class="muted">藏書閣資料庫、檔案儲存空間或文件整理資料表尚未建立。這不影響工時、對話、月曆與登入。</div><div class="source-path">請先執行：docs/supabase/20260712_p5_1_knowledge_repository_schema.sql</div><div class="source-path">若已完成 P5.1，請再執行：docs/supabase/20260713_p5_2_knowledge_intelligence_v1_schema.sql</div><div class="source-path">Sprint 2 若要使用 Google Drive，請再執行：docs/supabase/20260724_sprint_2_knowledge_integration_schema.sql</div><div class="muted">完成 SQL 與 Storage Policy 建立後，重新整理頁面即可啟用藏書閣。</div></div>`;
}

function knowledgeCardSummary(item = {}) {
  const summary = item.intelligenceSummary || {};
  const topics = arrayFromInput(summary.topics || []);
  const counts = knowledgeOutcomeCounts(item);
  const status = item.processingStatus;
  const summaryLine = summary.documentName
    ? `主要主題：${topics.slice(0, 5).join("、") || "尚未擷取"}`
    : (status === "uploaded" ? "我還沒開始閱讀。按「開始學習」後，我會整理成可用於工時建議的工作。" : "");
  const errorLine = status === "failed" && item.intelligenceError ? `<div class="source-path">錯誤：${escapeHtml(item.intelligenceError)}</div>` : "";
  return `<div class="source-path">${escapeHtml(summaryLine)}</div><div class="source-path">我整理出｜理解：${counts.summary}｜流程：${counts.process}｜規則：${counts.rule}｜可協助工作：${counts.recommendation}</div>${errorLine}`;
}

function knowledgeLibraryItemsForView() {
  const query = String(knowledgeLibraryQuery || "").trim().toLocaleLowerCase("zh-TW");
  const category = String(knowledgeLibraryCategory || "all");
  const items = (library || []).map(normalizedLibraryItem).filter(item => {
    if (category !== "all" && item.category !== category) return false;
    if (!query) return true;
    const summary = item.intelligenceSummary || {};
    const haystack = [
      item.title, item.description, item.category, item.sourceName, item.sourceProvider,
      item.sourceType, ...item.tags, ...item.triggers, ...knowledgeCapabilityItems(item, 12),
      ...arrayFromInput(summary.topics || [])
    ].join(" ").toLocaleLowerCase("zh-TW");
    return haystack.includes(query);
  });
  const compareText = (a, b) => String(a || "").localeCompare(String(b || ""), "zh-Hant");
  return items.sort((a, b) => {
    if (knowledgeLibrarySort === "title_asc") return compareText(a.title, b.title);
    if (knowledgeLibrarySort === "category") return compareText(a.category, b.category) || compareText(a.title, b.title);
    if (knowledgeLibrarySort === "status") return compareText(knowledgeLearnedLabel(a.processingStatus), knowledgeLearnedLabel(b.processingStatus)) || compareText(a.title, b.title);
    return new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
  });
}

function knowledgeVersionHistory(item = {}) {
  const history = item.sourceMetadata?.versionHistory;
  return Array.isArray(history) ? history : [];
}

function knowledgeLearningProgress(step = "idle") {
  const steps = [
    ["reading", "📄 正在讀取文件"],
    ["analyzing", "🔍 正在分析內容"],
    ["understanding", "🧠 正在理解工作流程"],
    ["organizing", "📝 正在建立 Knowledge"],
    ["complete", "✅ 等待你的確認"]
  ];
  const activeIndex = Math.max(0, steps.findIndex(([key]) => key === step));
  return steps.map(([key, label], index) => {
    const state = step === "error" ? "error" : index < activeIndex ? "done" : index === activeIndex ? "active" : "pending";
    return `<li class="knowledge-progress-step ${state}"><span>${state === "done" ? "✓" : state === "active" ? "⏳" : state === "error" ? "!" : "○"}</span>${label}</li>`;
  }).join("");
}

function libraryView() {
  const addButton = knowledgeFoundationNotInitialized ? "" : `<button class="btn" data-add-library="1">🪶 教我新的工作</button>`;
  const legacyItems = legacyKnowledgeItems();
  const legacyBlock = !knowledgeFoundationNotInitialized && legacyItems.length && !hasLegacyKnowledgeMigrationDone()
    ? `<div class="empty knowledge-migration-preview"><b>偵測到舊版藏書：${legacyItems.length} 筆</b><div class="muted">舊版資料搬移需由使用者確認。若舊資料沒有原始檔，將先搬移資料摘要，原始檔可後續編輯補上傳。</div><button class="btn2" data-preview-legacy-knowledge="1">預覽 / 搬移舊版藏書</button></div>`
    : "";
  const visibleItems = knowledgeLibraryItemsForView();
  const filters = !knowledgeFoundationNotInitialized ? `<div class="knowledge-library-toolbar"><label class="knowledge-search-field"><span class="sr-only">搜尋藏書閣</span><input class="input" type="search" data-library-search placeholder="搜尋文件、工作或標籤" value="${escapeHtml(knowledgeLibraryQuery)}"></label><select class="input" data-library-category aria-label="依分類篩選"><option value="all" ${knowledgeLibraryCategory === "all" ? "selected" : ""}>全部分類</option>${KNOWLEDGE_CATEGORIES.map(category => `<option value="${escapeHtml(category)}" ${category === knowledgeLibraryCategory ? "selected" : ""}>${escapeHtml(category)}</option>`).join("")}</select><select class="input" data-library-sort aria-label="排序"><option value="updated_desc" ${knowledgeLibrarySort === "updated_desc" ? "selected" : ""}>最近更新</option><option value="title_asc" ${knowledgeLibrarySort === "title_asc" ? "selected" : ""}>名稱 A–Z</option><option value="category" ${knowledgeLibrarySort === "category" ? "selected" : ""}>分類</option><option value="status" ${knowledgeLibrarySort === "status" ? "selected" : ""}>學習狀態</option></select></div>` : "";
  const body = knowledgeFoundationNotInitialized
    ? knowledgeInitializationNotice()
    : (visibleItems.length ? visibleItems.map(item => {
      const viewDisabled = canViewKnowledgeResult(item.processingStatus) ? "" : "disabled";
      const capabilities = knowledgeCapabilityItems(item, 3);
      const capabilityList = capabilities.length
        ? capabilities.map(capability => `<li>✓ ${escapeHtml(capability)}</li>`).join("")
        : `<li>${item.processingStatus === "uploaded" ? "等你把這份文件交給我學習" : "我還沒整理出可用於工時的工作"}</li>`;
      const counts = knowledgeOutcomeCounts(item);
      const providerLabel = knowledgeSourceProviderLabel(item.sourceProvider);
      const sourceAction = item.sourceProvider === "google_drive" ? "重新整理" : knowledgeActionLabel(item.processingStatus);
      const sourceLink = item.sourceUrl ? `<a class="source-path" href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener">查看 Google Drive 來源 ↗</a>` : "";
      const previewButton = item.storagePath ? `<button class="btn2" data-preview-library="${item.id}">預覽原始檔</button>` : sourceLink;
      return `<article class="entry knowledge-card knowledge-card-tile knowledge-card-status-${escapeHtml(item.processingStatus || "uploaded")}"><div class="entry-main"><div class="knowledge-card-title"><b>🪶 ${escapeHtml(item.title)}</b><span class="knowledge-card-category">${escapeHtml(item.category)}</span></div><div class="knowledge-card-status-line"><span class="knowledge-status-dot"></span><span>${escapeHtml(knowledgeLearnedLabel(item.processingStatus))}</span><span>｜${escapeHtml(providerLabel)}｜${escapeHtml(knowledgeSourceTypeLabel(item.sourceType))}</span></div><small class="knowledge-card-description">${escapeHtml(item.description || "這份文件會幫我更懂你的工作。")}</small><div class="source-path"><b>我目前理解出的工作：</b></div><ul class="knowledge-result-list">${capabilityList}</ul><div class="source-path">理解 ${counts.summary}｜流程 ${counts.process}｜規則 ${counts.rule}｜可協助工作 ${counts.recommendation}</div>${item.processingStatus === "failed" && item.intelligenceError ? `<div class="source-path knowledge-error-copy">我讀不懂的原因：${escapeHtml(item.intelligenceError)}</div>` : ""}</div><div class="knowledge-card-toolbar"><button class="btn2" ${viewDisabled} data-view-knowledge-result="${item.id}">查看我的理解</button>${item.processingStatus === "processed" ? `<button class="btn green" data-verify-library="${item.id}">✓ 接受我的理解</button>` : ""}<details class="knowledge-card-more"><summary aria-label="更多操作">⋯ 更多</summary><div class="knowledge-card-more-menu"><button class="btn2" data-refresh-library="${item.id}">${escapeHtml(sourceAction)}</button>${previewButton}<button class="btn2" data-edit-library="${item.id}">✏️ 調整我的理解</button><button class="btn2" data-archive-library="${item.id}">封存</button><button class="btn2 danger" data-del-library="${item.id}">刪除</button></div></details></div></article>`;
    }).join("") : `<div class="empty"><b>${library.length ? "找不到符合條件的知識" : "還沒有教我新的工作"}</b><div class="muted">${library.length ? "請調整搜尋或分類條件。" : "請上傳 SOP、Excel 或文件，讓我開始理解你每天會做哪些工作。"}</div>${library.length ? "" : `<button class="btn" data-add-library="1">🪶 教我新的工作</button>`}</div>`);
  return `<section class="panel" style="margin-top:18px"><div class="panel-head"><div><h2>📚 教 Mr. KM 學會你的工作</h2><div class="muted">上傳 SOP、Excel 或文件後，我會整理出可用於工時建議的工作。之後，我會依照你的工作，提供更貼近的工時建議。</div></div>${addButton}</div>${legacyBlock}${filters}<div class="knowledge-library-count muted">顯示 ${visibleItems.length} / ${library.length} 份知識</div><div class="library-list knowledge-card-grid">${body}</div></section>`;
}

function libraryLearningView() {
  const item = normalizedLibraryItem(learningKnowledgeDraft || library.find(x => x.id === viewingKnowledgeId || x.cloudId === viewingKnowledgeId) || {});
  const title = item.title || "新的工作知識";
  const fileName = item.filename || item.sourceName || "您提供的文件";
  const step = knowledgeLearningStep || "reading";
  const heading = step === "complete" ? "🪶 我讀完了" : step === "error" ? "🪶 這次學習遇到問題" : "🪶 Mr. KM 正在閱讀";
  const message = step === "complete" ? "我已整理好理解結果，接下來請你確認。" : step === "error" ? (knowledgeLearningError || "請稍後再試，或調整文件後重新學習。") : "我正在把它轉換成之後可以協助你完成工時的工作。";
  const active = !["complete", "error"].includes(step);
  const leaveAction = active ? `<button class="btn2" type="button" data-library-learning-back="1">返回藏書閣</button>` : `<button class="btn2" type="button" data-library-back="1">返回藏書閣</button>`;
  return `<section class="panel knowledge-learning-panel ${active ? "is-learning" : ""}" style="margin-top:18px"><div class="panel-head"><div><h2>${heading}</h2><div class="muted" aria-live="polite">${escapeHtml(message)}</div></div>${leaveAction}</div>${active ? `<div class="knowledge-learning-warning" role="status"><span class="knowledge-spinner" aria-hidden="true"></span><b>文件仍在閱讀中，請勿離開此頁</b><small>離開可能中斷處理；完成後我會請你確認我的理解。</small></div>` : ""}<div class="entry"><div class="entry-main"><b>${escapeHtml(title)}</b><div class="source-path">${escapeHtml(fileName)}</div><small>${escapeHtml(item.description || "我會先理解內容，再請你確認我理解得對不對。")}</small></div></div><div class="entry"><b>目前進度</b><ul class="knowledge-result-list knowledge-progress-list" aria-live="polite">${knowledgeLearningProgress(step)}</ul></div><div class="muted">${step === "complete" ? "請按返回查看我的理解。" : step === "error" ? "請查看錯誤後重新學習或返回藏書閣。" : "請稍候，完成後我會請你確認我的理解。"}</div></section>`;
}

function libraryIntelligenceView(id = null) {
  const item = normalizedLibraryItem(library.find(x => x.id === id || x.cloudId === id));
  if (!item.title) return `<section class="panel" style="margin-top:18px"><button class="btn2" data-library-back="1">返回</button><div class="empty">找不到知識來源</div></section>`;
  const summary = item.intelligenceSummary || {};
  const units = knowledgeUnitsForSource(item);
  const candidates = knowledgeCandidatesForSource(item);
  const isFailed = item.processingStatus === "failed";
  const isCompleted = ["processed", "verified", "knowledge_built"].includes(item.processingStatus);
  const resultHeading = isFailed ? "🪶 我暫時讀不懂這份文件" : (isCompleted ? "🪶 我讀完了" : "🪶 我正在理解這份工作");
  const resultPrompt = isCompleted && !isFailed ? `<div class="entry knowledge-companion-summary"><b>🪶 我閱讀完了。</b><div class="muted">我先把文件整理成你真正會做的工作，並和「我的工作」比對過；只有你接受後，新的工作才會加入。</div></div>` : "";
  const list = value => arrayFromInput(value).map(x => `<li>${escapeHtml(x)}</li>`).join("") || "<li>尚未整理</li>";
  const discoveredWorks = Array.isArray(summary.works) ? summary.works : [];
  const workMemoryReferences = Array.isArray(summary.workMemoryReferences) ? summary.workMemoryReferences : [];
  const candidateNames = new Set(candidates.map(candidate => String(candidate.title || "").trim()).filter(Boolean));
  const reviewWorks = discoveredWorks.length ? discoveredWorks : candidates.map(candidate => ({ name: candidate.title, purpose: candidate.content, processes: [], systems: [], departments: [], outputs: [], frequency: "依需求", triggers: candidate.triggers || [], keywords: [] }));
  const readableSummary = reviewWorks.length
    ? `我目前理解出 ${reviewWorks.length} 項工作：${reviewWorks.slice(0, 6).map(work => work.name).join("、")}。`
    : (isFailed ? "我這次沒有可靠讀懂內容，請查看原因後再讓我重新學習。" : "我還在整理這份文件。");
  const knownWorkCount = reviewWorks.filter(work => !candidateNames.has(work.name)).length;
  const newWorkCount = reviewWorks.filter(work => candidateNames.has(work.name)).length;
  const companionSummary = reviewWorks.length
    ? `我理解這份文件主要包含 ${reviewWorks.length} 個工作。其中 ${knownWorkCount} 個已經在「我的工作」，另外 ${newWorkCount} 個想請你確認。`
    : readableSummary;
  const processItems = units.filter(unit => ["process", "checklist"].includes(unit.unitType)).map(unit => unit.title);
  const ruleItems = units.filter(unit => ["rule", "exception"].includes(unit.unitType)).map(unit => unit.title);
  const focusItems = [...summary.topics || [], ...processItems.slice(0, 4), ...ruleItems.slice(0, 4)].slice(0, 10);
  const workDnaCards = reviewWorks.length ? reviewWorks.map(work => {
    const reference = workMemoryReferences.find(item => item.candidate === work.name || item.generalizedAs === work.name);
    const isNew = candidateNames.has(work.name);
    const decision = isNew
      ? `<label class="inline-check"><input type="checkbox" class="knowledge-work-candidate" value="${escapeHtml(work.name)}" checked> <span>建議加入「我的工作」</span></label>`
      : `<span class="work-dna-existing">✓ 已引用「${escapeHtml(reference?.workMemory || work.name)}」</span>`;
    const dnaList = (values, empty = "尚未辨識") => arrayFromInput(values).map(value => escapeHtml(value)).join("、") || empty;
    const primaryRole = profile?.role || "採購";
    const secondaryRoles = [...new Set([
      ...arrayFromInput(work.relatedRoles || work.related_roles).map(roleDisplayName),
      ...arrayFromInput(item.relatedRoles).map(roleDisplayName),
      ...arrayFromInput(work.departments)
    ])].filter(role => role && role !== primaryRole && role !== "待確認職務").slice(0, 3);
    const primaryRatio = secondaryRoles.length ? 70 : 100;
    const secondaryRatio = secondaryRoles.length ? Math.round(30 / secondaryRoles.length) : 0;
    const secondaryLabel = secondaryRoles.length ? secondaryRoles.map(role => `${escapeHtml(role)} ${secondaryRatio}%`).join("、") : "目前無次要職務";
    return `<div class="work-dna-card"><div class="work-dna-head"><div><b>${escapeHtml(work.name)}</b></div>${decision}</div><div class="work-dna-primary"><div><span>工作目的</span><b>${escapeHtml(work.purpose || "尚未整理")}</b></div><div><span>主要內容</span><b>${escapeHtml(work.description || work.purpose || "尚未整理")}</b></div><div><span>主要系統</span><b>${dnaList(work.systems)}</b></div></div><details class="work-dna-process"><summary>▼ 查看 Work DNA</summary><div class="work-dna-grid"><div><span>Primary Role</span><b>${escapeHtml(primaryRole)} ${primaryRatio}%</b></div><div><span>Secondary Role</span><b>${secondaryLabel}</b></div><div><span>工作頻率</span><b>${escapeHtml(work.frequency || "依需求")}</b></div><div><span>涉及部門</span><b>${dnaList(work.departments)}</b></div><div><span>輸出成果</span><b>${dnaList(work.outputs)}</b></div><div><span>Trigger</span><b>${dnaList(work.triggers)}</b></div><div><span>Keyword</span><b>${dnaList(work.keywords)}</b></div><div><span>Confidence</span><b>${Math.round(Number(work.confidence || 0) * 100) || "待確認"}${Number(work.confidence || 0) ? "%" : ""}</b></div></div><div><b>Flow</b><ol>${arrayFromInput(work.processes).map(step => `<li>${escapeHtml(step)}</li>`).join("") || "<li>尚未整理出可靠流程</li>"}</ol></div><div class="muted">Evidence 請見下方「查看我理解工作的依據」。</div></details></div>`;
  }).join("") : `<div class="empty"><b>我還沒有辨識出完整的工作</b><div class="muted">這次內容可能只有零散步驟；為避免把「確認、檢查、追蹤」誤當成工作，我不會產生低品質建議。</div></div>`;
  const autoMeta = `<div class="entry"><b>我先幫你判斷</b><div class="source-path">工作來源類型：${escapeHtml(KNOWLEDGE_SCOPE_LABELS[item.scope] || item.scope || "待確認")}</div><div class="source-path">適用對象：${escapeHtml(item.applicableAgents.join("、") || "待確認")}</div><div class="source-path">適用職務：${escapeHtml(item.relatedRoles.map(roleDisplayName).join("、") || "待確認")}</div><div class="source-path">標籤：${escapeHtml(item.tags.join("、") || "待確認")}</div><div class="source-path">我的工作：${escapeHtml(item.relatedWorkModels.join("、") || "待確認")}</div></div>`;
  const acceptWorkActions = !isFailed && candidates.length
    ? `<button class="btn green" data-accept-all-knowledge-work="${item.id}">✓ 全部正確</button><button class="btn2" data-accept-selected-knowledge-work="${item.id}">接受勾選</button>`
    : "";
  const reprocessAttribute = item.sourceProvider === "google_drive" ? "data-refresh-library" : "data-reprocess-library";
  const reprocessLabel = item.sourceProvider === "google_drive" ? "重新整理" : knowledgeActionLabel(item.processingStatus);
  const history = knowledgeVersionHistory(item);
  const versionHistoryBlock = `<details class="knowledge-version-history"><summary>🕘 Knowledge 版本（目前 ${escapeHtml(item.knowledgeVersion || item.version || "v1.0")}）</summary><div class="knowledge-version-current">目前版本：<b>${escapeHtml(item.knowledgeVersion || item.version || "v1.0")}</b></div>${history.length ? history.slice().reverse().map(entry => `<div class="knowledge-version-row"><div><b>${escapeHtml(entry.version || "舊版本")}</b><small>${escapeHtml(formatKnowledgeTime(entry.savedAt || ""))}</small></div><button class="btn2" data-rollback-library="${escapeHtml(item.id)}" data-version="${escapeHtml(entry.version || "")}">還原</button></div>`).join("") : `<div class="muted">重新學習後，這裡會保留最近版本供回復。</div>`}</details>`;
  const resultActions = isFailed
    ? `<button class="btn2" ${reprocessAttribute}="${item.id}">${reprocessLabel}</button><button class="btn2" data-edit-library="${item.id}">✏️ 調整我的理解</button>`
    : `${acceptWorkActions}<button class="btn2" data-verify-library="${item.id}">✓ 確認理解</button><button class="btn2" ${reprocessAttribute}="${item.id}">🔁 重新學習</button><button class="btn2" data-edit-library="${item.id}">✏️ 調整我的理解</button>`;
  return `<section class="panel" style="margin-top:18px"><div class="panel-head"><div><h2>${escapeHtml(resultHeading)}</h2><div class="muted">${escapeHtml(item.knowledgeId)}｜${escapeHtml(knowledgeLearnedLabel(item.processingStatus))}</div></div><button class="btn2" data-library-back="1">返回藏書閣</button></div>${resultPrompt}<div class="entry"><div class="entry-main"><b>${escapeHtml(item.title)}</b><div class="source-path">我閱讀到的品質：${escapeHtml(knowledgeSupportLevelLabel(summary.supportLevel))}</div>${item.intelligenceError ? `<div class="source-path">我讀不懂的原因：${escapeHtml(item.intelligenceError)}</div>` : ""}</div><div class="actions compact"><button class="btn2" ${reprocessAttribute}="${item.id}">${reprocessLabel}</button></div></div><div class="entry"><b>我目前的理解</b><p class="muted">${escapeHtml(companionSummary)}</p></div><div class="work-dna-list">${workDnaCards}</div><details class="work-evidence-panel"><summary>查看我理解工作的依據</summary><div class="profile-grid"><div class="entry"><b>文件中的流程證據</b><ul class="knowledge-result-list">${list(processItems)}</ul></div><div class="entry"><b>文件中的規則證據</b><ul class="knowledge-result-list">${list(ruleItems)}</ul></div></div><div class="entry"><b>文件重點</b><ul class="knowledge-result-list">${list(focusItems)}</ul></div>${autoMeta}<section class="panel" style="margin-top:12px"><h3>可追溯內容（${units.length}）</h3>${units.length ? units.map(unit => `<div class="entry"><div class="entry-main"><b>${escapeHtml(unit.title)}</b><div class="muted">${escapeHtml(knowledgeUnitTypeLabel(unit.unitType))}｜${escapeHtml(unit.pageReference || unit.sectionReference || "")}</div><small>${escapeHtml(unit.summary || unit.content)}</small><div class="library-tag-line">${unit.triggers.map(tag => `<span>${escapeHtml(tag)}</span>`).join("")}</div></div><div class="actions compact"><button class="btn2 danger" data-remove-knowledge-unit="${unit.id}">移除</button></div></div>`).join("") : `<div class="empty">目前沒有可追溯內容。</div>`}</section></details>${versionHistoryBlock}<div class="form-actions">${resultActions}</div></section>`;
}

function libraryForm(id = null) {
  const item = normalizedLibraryItem(id ? library.find(x => x.id === id) : {});
  if (!id) {
    return `<section class="panel" style="margin-top:18px"><div class="panel-head"><div><h2>🪶 教我新的工作</h2><div class="muted">請提供文件，其餘分類、標籤與工作拆解先交給我理解。</div></div><button class="btn2" data-library-back="1">返回</button></div><div class="entry"><b>一份文件，就是一次教學</b><div class="muted">你只需要提供內容；我會先理解，再請你確認我理解得對不對。</div></div><label>這次要教我的主題 <span class="muted">必填</span></label><input id="libTitle" class="input" value="" placeholder="例如：採購工作提醒事項 SOP"><label>說明 <span class="muted">選填</span></label><textarea id="libDesc" placeholder="可以簡單告訴我這份文件和什麼工作有關，也可以留空。"></textarea><label>提供一份文件</label><div class="upload-drop"><input id="libFile" type="file"><span>請選擇 PDF / Word / Excel / PowerPoint / TXT</span></div><div class="form-actions"><button class="btn2" type="button" data-select-drive="1">從 Google Drive 選取</button><span id="driveSelectionStatus" class="muted">也可以指定一份 Google Drive 文件</span></div><div class="library-ai-preview"><b>🪶 我會先讀，再請你確認</b><div class="muted">我會整理我理解的工作、流程、規則與之後可以協助你的工時建議。</div></div><div class="form-actions"><button class="btn2" data-library-cancel="1">取消</button><button class="btn" id="saveLibrary">🪶 開始學習</button></div></section>`;
  }
  return `<section class="panel" style="margin-top:18px"><div class="panel-head"><div><h2>✏️ 調整我的理解</h2><div class="muted">只有需要修正我自動判斷時，才需要調整這些內容。</div></div><button class="btn2" data-library-back="1">返回</button></div><label>知識編號</label><input id="libKnowledgeId" class="input" value="${escapeHtml(item.knowledgeId || "儲存後產生")}" readonly><label>主題</label><input id="libTitle" class="input" value="${escapeHtml(item.title || "")}" placeholder="例如：採購請購 SOP"><label>說明</label><textarea id="libDesc" placeholder="這份文件想讓我理解什麼工作？">${escapeHtml(item.description || "")}</textarea><label>分類</label><select id="libCategory" class="input">${selectOptions(KNOWLEDGE_CATEGORIES, item.category)}</select><label>工作來源類型</label><select id="libScope" class="input">${KNOWLEDGE_SCOPES.map(scope => `<option value="${escapeHtml(scope)}" ${scope === item.scope ? "selected" : ""}>${escapeHtml(KNOWLEDGE_SCOPE_LABELS[scope])}</option>`).join("")}</select><div class="muted">這些是我自動理解後的資料，通常不需要手動調整。</div><label>適用對象</label>${checkboxGroup(KNOWLEDGE_AGENTS, item.applicableAgents, "libAgents")}<label>適用職務</label>${checkboxGroup(KNOWLEDGE_ROLE_OPTIONS, item.relatedRoles, "libRoles")}<label>我的工作</label>${checkboxGroup(workModels(), item.relatedWorkModels, "libWorkModels")}<label>標籤</label><input id="libTags" class="input" value="${escapeHtml(item.tags.join("、"))}" placeholder="採購、請購、供應商、SOP"><label>觸發關鍵字</label><input id="libTriggers" class="input" value="${escapeHtml(item.triggers.join("、"))}" placeholder="供應商會議、新供應商、年度評鑑"><label>版本</label><input id="libVersion" class="input" value="${escapeHtml(item.version || "v1.0")}" placeholder="v1.0"><label>來源版本</label><input id="libSourceVersion" class="input" value="${escapeHtml(item.sourceVersion || item.version || "v1.0")}" placeholder="v1.0"><label>整理狀態</label><div class="readonly-status">${escapeHtml(processingStatusLabel(item.processingStatus || "uploaded"))}</div><label>重新上傳檔案 <span class="muted">選填</span></label><div class="upload-drop"><input id="libFile" type="file"><span>${escapeHtml(item.filename || "不重新上傳，則保留原始檔案")}</span></div><div class="form-actions"><button class="btn2" data-library-cancel="1">取消</button><button class="btn" id="saveLibrary">儲存調整</button></div></section>`;
}

function settings() {
  const tasks = ecpTasks();
  const wp = normalizeWorkProfile(workProfile || {}, profile);
  const profileStatus = isWorkProfileReady(wp) ? "✓ 已完成" : `⚠ 尚未完成：${workProfileMissingFields(wp).join("、")}`;
  return `<section class="panel" style="margin-top:18px"><h2>⚙️ 設定</h2><div class="entry"><b>目前使用者</b><div class="muted">${escapeHtml(session.name)}｜${escapeHtml(session.status || session.email || "")}</div></div><div class="entry"><b>工作身分</b><div class="muted">${escapeHtml(profileStatus)}</div><div class="source-path">目前工作任務：${escapeHtml(wp.defaultTask || "尚未設定")}｜有效月份：${escapeHtml(wp.taskEffectiveMonth || "尚未設定")}</div></div><div class="entry"><b>Smart Auto Save</b><div class="muted">設定一修改即更新本機狀態，約 2 秒後自動同步 Cloud。</div></div><label>角色</label><select id="roleSet" class="input">${roles.map(r => `<option ${profile && profile.role === r ? "selected" : ""}>${r}</option>`).join("")}</select><div class="work-model-section">${workMemoryPage({ compact: true })}</div><div class="work-model-section"><label>ECP 設定</label><label>ECP 負責人</label><input class="input" id="ecpOwner" value="${escapeHtml(profile?.ecpOwner || "")}" placeholder="例如：陳彥達-UU"><label>ECP 負責部門</label><input class="input" id="ecpDepartment" value="${escapeHtml(profile?.ecpDepartment || "")}" placeholder="例如：UU管理部"><label>目前工作任務（Current Active Task）</label>${ecpTaskList(tasks)}<div class="work-model-add"><input class="input" id="newEcpTask" placeholder="新增 ECP 任務，例如：採購案件處理"><button class="btn2" id="addEcpTask" type="button">＋ 新增 ECP 任務</button></div><div class="muted">目前工作任務會作為 ECP 匯出的任務欄位來源；快速紀錄仍可選「不指定 ECP 任務」。</div></div><button class="btn gray full" id="resetProfile">重新初次認識</button><button class="btn red full" id="logoutBtn">登出</button><div class="entry"><b>版本</b><div class="muted">${VERSION}</div></div></section>`;
}

function currentViewHtml() {
  if (view === "center") return center();
  if (view === "capture") return capture();
  if (view === "library") return libraryView();
  if (view === "libraryIntelligence") return libraryIntelligenceView(viewingKnowledgeId);
  if (view === "sync") return sync();
  return settings();
}

function replaceRootContent(markup = "") {
  root.replaceChildren();
  root.insertAdjacentHTML("afterbegin", markup);
}

function render(reason = "state-update") {
  if (renderInProgress) {
    renderQueued = true;
    return;
  }
  renderInProgress = true;
  const performFullRender = () => {
    normalizeEntries();
    if (IS_EXTENSION_ENTRY) { replaceRootContent(extensionAssistantScreen()); bindWorklogAssistant(); return; }
    clearInvalidAuthState();
    if (!session) { replaceRootContent(authScreen()); bindAuth(); return; }
    if (migrationRequired) { replaceRootContent(migrationScreen()); bindMigration(); bindGlobal(); return; }
    if (isStandaloneChatRoute()) { replaceRootContent(standaloneChatScreen()); bindWorklogAssistant(); bindGlobal(); return; }
    if (needsWorklogWelcome()) { replaceRootContent(worklogWelcomeScreen()); bindWorklogWelcome(); bindGlobal(); return; }
    replaceRootContent(osShell());
    bind();
    bindGlobal();
  };
  try {
    if (typeof RenderEngine !== "undefined") RenderEngine.full(reason, performFullRender);
    else performFullRender();
  } finally {
    renderInProgress = false;
    if (renderQueued) {
      renderQueued = false;
      const flush = () => render("queued-update");
      if (typeof queueMicrotask === "function") queueMicrotask(flush);
      else Promise.resolve().then(flush);
    }
  }
}

function bindAuth() {
  const button = document.getElementById("googleLoginBtn");
  if (!button) return;
  button.onclick = () => {
    // Browser Back may restore the pre-OAuth auth screen from bfcache even
    // though the Google/Supabase session is still valid.
    if (hasGoogleOAuthSession()) {
      clearStoredOAuthError();
      activeModule = "dashboard";
      activeWorkspace = "dashboard";
      openTabs = [];
      recentWorkspaces = [];
      view = "center";
      saveAll();
      render();
      return;
    }
    signInWithGoogle();
  };
}

function bindMigration() {
  document.querySelectorAll("[data-run-migration]").forEach(b => b.onclick = () => DataService.runMigration());
}

function bindDashboard() {
  document.querySelectorAll("[data-root-account-toggle]").forEach(button => {
    button.onclick = event => {
      event.stopPropagation();
      const container = button.closest("[data-root-identity]");
      const menu = container?.querySelector("[data-root-account-menu]");
      if (!menu) return;
      const willOpen = menu.hidden;
      menu.hidden = !willOpen;
      button.setAttribute("aria-expanded", willOpen ? "true" : "false");
    };
  });
  document.querySelectorAll("[data-root-account-menu]").forEach(menu => {
    menu.onclick = event => event.stopPropagation();
  });
  document.querySelectorAll("[data-google-drive-authorize]").forEach(button => {
    button.onclick = () => {
      button.disabled = true;
      button.textContent = "前往授權…";
      signInWithGoogle();
    };
  });
}

function bindWorklogWelcome() {
  const draftKey = scopedLocalKey(WORK_IDENTITY_SETUP_DRAFT_KEY);
  const stepKey = scopedLocalKey(WORK_IDENTITY_SETUP_STEP_KEY);
  const readDraft = () => normalizeWorkProfile(readJson(draftKey, workProfile || {}), profile);
  const writeDraft = draft => writeJson(draftKey, normalizeWorkProfile(draft, profile));
  const setStep = step => { localStorage.setItem(stepKey, step); render(); };
  document.querySelectorAll("[data-work-identity-start]").forEach(b => b.onclick = () => setStep("owner"));
  document.querySelectorAll("[data-work-identity-back]").forEach(b => b.onclick = () => setStep(b.dataset.workIdentityBack || "owner"));
  document.querySelectorAll("[data-work-identity-prev]").forEach(b => b.onclick = () => {
    const step = localStorage.getItem(stepKey) || "owner";
    setStep(step === "department" ? "owner" : (step === "task" ? "department" : "welcome"));
  });
  document.querySelectorAll("[data-work-identity-next]").forEach(b => b.onclick = () => {
    const step = b.dataset.workIdentityNext || "owner";
    const draft = readDraft();
    if (step === "owner") {
      const value = document.getElementById("setupEcpOwner")?.value.trim() || "";
      if (!value) return toast("請輸入 ECP 負責人");
      writeDraft({ ...draft, ecpResponsiblePerson: value });
      return setStep("department");
    }
    if (step === "department") {
      const value = document.getElementById("setupEcpDepartment")?.value.trim() || "";
      if (!value) return toast("請輸入 ECP 負責部門");
      writeDraft({ ...draft, ecpDepartment: value });
      return setStep("task");
    }
    if (step === "task") {
      const value = document.getElementById("setupEcpTask")?.value.trim() || "";
      if (!value) return toast("請輸入目前工作任務");
      writeDraft({ ...draft, defaultTask: value, taskEffectiveMonth: monthKey(), taskVerifiedAt: new Date().toISOString() });
      return setStep("confirm");
    }
  });
  document.querySelectorAll("[data-confirm-work-profile-setup]").forEach(b => b.onclick = async () => {
    const draft = readDraft();
    const next = normalizeWorkProfile({
      ...draft,
      taskEffectiveMonth: monthKey(),
      taskVerifiedAt: new Date().toISOString(),
      lastProfileCheckDate: key(new Date())
    }, profile);
    if (!isWorkProfileReady(next)) return toast(`尚未完成工作身分：${workProfileMissingFields(next).join("、")}`);
    applyWorkProfileToProfile(next);
    localStorage.setItem(scopedLocalKey(WORKLOG_WELCOME_KEY), "1");
    activeWorkspace = "worklog";
    openTabs = ["worklog"];
    recentWorkspaces = ["worklog"];
    hasOsShellState = true;
    saveAll();
    try {
      await DataService.saveProfileSettingsOnly({ requireCloud: true });
      await DataService.saveEcpTasksOnly({ requireCloud: true });
      localStorage.setItem(scopedLocalKey(WORK_IDENTITY_COMPLETION_KEY), "1");
      localStorage.removeItem(stepKey);
      localStorage.removeItem(draftKey);
      toast("工作身分已完成");
    } catch (error) {
      const diagnostic = workProfileSyncDiagnostic(error);
      console.error("Work Profile setup sync failed", { error, diagnostic, supabase: error.supabase || error?.cause?.supabase || null });
      toast("工作身分同步失敗，已產生診斷結果");
      showWorkProfileSyncDiagnostic(error);
      return;
    }
    render();
  });
  document.querySelectorAll("[data-enter-ai-os]").forEach(b => b.onclick = () => {
    localStorage.removeItem(scopedLocalKey(WORK_IDENTITY_COMPLETION_KEY));
    activeWorkspace = "worklog";
    openTabs = ["worklog"];
    recentWorkspaces = ["worklog"];
    hasOsShellState = true;
    saveAll();
    render();
  });
}

function bindWorklogAssistant() {
  document.querySelectorAll("[data-open-assistant]").forEach(button => button.onclick = () => {
    localStorage.setItem(assistantOpenKey(), "1");
    refreshConversationFromCloud(true);
  });
  document.querySelectorAll("[data-close-assistant]").forEach(button => button.onclick = () => {
    localStorage.setItem(assistantOpenKey(), "0");
    render();
  });
  document.querySelectorAll("[data-start-assistant]").forEach(button => button.onclick = () => {
    localStorage.setItem(assistantWelcomeKey(), "1");
    localStorage.setItem(assistantOpenKey(), "1");
    render();
  });
  const input = document.getElementById("assistantInput");
  const send = document.getElementById("assistantSend");
  if (!input || !send) return;
  const addAssistantResult = result => {
    const normalized = typeof result === "string" ? { text: result } : (result || { text: "" });
    addConversationMessage("assistant", normalized.text || "", normalized.card ? { card: normalized.card } : {});
  };
  const updateSendState = () => {
    const hasText = input.value.trim().length > 0;
    send.disabled = !hasText;
    send.classList.toggle("ready", hasText);
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
  };
  updateSendState();
  input.addEventListener("input", updateSendState);
  scrollAssistantToBottom();
  const completePendingDuration = async (hoursValue, userLabel = "") => {
    const pending = getAssistantPendingCommand();
    if (!pending?.command || !hoursValue || !isDurationPending(pending)) return toast("找不到待補充時間的草稿");
    const parsedCommand = resolveAssistantCommandTime({ ...pending.command, hours: hoursValue });
    const entryPayload = assistantConfirmationPayload(parsedCommand);
    if (userLabel) addConversationMessage("user", userLabel);
    const thinkingId = addAssistantThinkingMessage();
    render();
    await new Promise(resolve => setTimeout(resolve, 250));
    removeConversationMessage(thinkingId);
    await setAssistantPendingCommand({ action: "confirm_add_entry", command: parsedCommand });
    addConversationMessage("assistant", "請確認這筆工時：", { card: { type: "confirm_entry", payload: entryPayload } });
    render();
  };
  const submit = async () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    updateSendState();
    addConversationMessage("user", text);
    const thinkingId = addAssistantThinkingMessage();
    render();
    await new Promise(resolve => setTimeout(resolve, 350));
    let parsedIntent = null;
    try {
      const pending = getAssistantPendingCommand();
      const durationReply = isDurationPending(pending) ? parseAssistantDuration(text) : null;
      if (durationReply) {
        removeConversationMessage(thinkingId);
        const parsedCommand = resolveAssistantCommandTime({ ...pending.command, hours: durationReply });
        const entryPayload = assistantConfirmationPayload(parsedCommand);
        await setAssistantPendingCommand({ action: "confirm_add_entry", command: parsedCommand });
        addAssistantResult({ text: "請確認這筆工時：", card: { type: "confirm_entry", payload: entryPayload } });
        render();
        return;
      }
      if (pending?.action === "awaiting_work_context" && pending.command) {
        removeConversationMessage(thinkingId);
        const category = text.replace(/^(這是|屬於|分類為|分類是)\s*/, "").trim() || "一般工作";
        const parsedCommand = {
          ...pending.command,
          semantics: {
            ...(pending.command.semantics || {}),
            category,
            nature: pending.command.semantics?.nature === "一般工作" ? category : pending.command.semantics?.nature,
            tags: [...new Set([...(pending.command.semantics?.tags || []), category])],
            confidence: 1
          }
        };
        const entryPayload = assistantConfirmationPayload(parsedCommand);
        await setAssistantPendingCommand({ action: "confirm_add_entry", command: parsedCommand });
        addAssistantResult({ text: "了解，我會依這個工作性質記錄。請確認這筆工時：", card: { type: "confirm_entry", payload: entryPayload } });
        render();
        return;
      }
      if (pending?.action === "collect_work_profile") {
        const response = handleWorkProfileConversationReply(text, pending);
        removeConversationMessage(thinkingId);
        addAssistantResult(response);
        render();
        return;
      }
      const conversationIntent = parseConversationIntent(text);
      if (pending && conversationIntent) {
        removeConversationMessage(thinkingId);
        addAssistantResult(pendingConversationGuidance(pending));
        render();
        return;
      }
      if (!pending && conversationIntent) {
        const conversationResponse = executeConversationIntent(conversationIntent);
        if (conversationResponse) {
          removeConversationMessage(thinkingId);
          addAssistantResult(conversationResponse);
          render();
          return;
        }
      }
      const contextIntent = parseWorklogIntentLocal(text);
      if (!pending && ["query_today_work", "query_today", "query_week"].includes(contextIntent.type)) {
        const response = await executeWorklogCommand(contextIntent);
        removeConversationMessage(thinkingId);
        addAssistantResult(response);
        render();
        return;
      }
      if (!pending && /股票|投資|基金|ETF|新聞|天氣|匯率|餐廳|旅遊/.test(text)) {
        removeConversationMessage(thinkingId);
        addAssistantResult(assistantUnknownResponse());
        render();
        return;
      }
      if (shouldPromptWorkProfileToday()) {
        removeConversationMessage(thinkingId);
        addAssistantResult(startWorkProfileConversation());
        render();
        return;
      }
      parsedIntent = await parseWorklogIntent(text);
      if (!pending && parsedIntent?.type === "unsupported") {
        const knowledgeResponse = await knowledgeAssistantAnswer(text);
        if (knowledgeResponse) {
          removeConversationMessage(thinkingId);
          addAssistantResult(knowledgeResponse);
          render();
          return;
        }
      }
      const response = await executeWorklogCommand(parsedIntent);
      removeConversationMessage(thinkingId);
      addAssistantResult(response);
    } catch (error) {
      removeConversationMessage(thinkingId);
      console.error("WorkLog assistant command failed", assistantCommandErrorDebug({
        input: text,
        parsedIntent,
        parsedCommand: parsedIntent?.parsedCommand || null,
        entryPayload: parsedIntent?.entryPayload || null,
        error
      }));
      addConversationMessage("assistant", `工時建立失敗：${error?.message || "未知錯誤"}`);
    }
    render();
  };
  send.onclick = submit;
  input.onkeydown = e => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };
  document.querySelectorAll("[data-assistant-duration]").forEach(button => button.onclick = async () => {
    const hoursValue = Number(button.dataset.assistantDuration || 0);
    await completePendingDuration(hoursValue, hoursValue === 0.5 ? "30m" : `${hoursValue}h`);
  });
  document.querySelectorAll("[data-assistant-custom-duration]").forEach(button => button.onclick = () => {
    input.placeholder = "請輸入工時，例如：一個半小時、1.5h、半天";
    input.focus();
  });
  document.querySelectorAll("[data-assistant-quick]").forEach(button => button.onclick = () => {
    const kind = button.dataset.assistantQuick || "";
    const map = {
      worklog: {
        user: "建立工時",
        assistant: "可以。請直接告訴我日期、時間與工作內容，例如：今天下午兩點到四點開會。"
      },
      calendar: {
        user: "補登工時",
        assistant: "可以。請告訴我日期、時間與工作內容，例如：明天上午處理紀念品。"
      },
      task: {
        user: "建立待辦事項",
        assistant: "可以。請告訴我要提醒或整理的待辦事項，例如：提醒我寄採購資料。"
      }
    };
    const item = map[kind];
    if (!item) return;
    addConversationMessage("user", item.user);
    addConversationMessage("assistant", item.assistant);
    render();
  });
  document.querySelectorAll("[data-assistant-cancel-command]").forEach(button => button.onclick = () => {
    clearAssistantPendingCommand();
    addConversationMessage("user", "取消");
    addConversationMessage("assistant", "已取消這筆工時建立。");
    render();
  });
  document.querySelectorAll("[data-assistant-confirm-date]").forEach(button => button.onclick = async () => {
    const pending = getAssistantPendingCommand();
    const command = pending?.command ? { ...pending.command, dateWeekdayMismatch: false } : null;
    if (!command) return toast("找不到待確認的日期");
    await setAssistantPendingCommand({ action: "confirm_add_entry", command });
    addConversationMessage("user", "確認日期");
    addConversationMessage("assistant", "日期已確認，請確認這筆工時：", { card: { type: "confirm_entry", payload: assistantConfirmationPayload(command) } });
    render();
  });
  document.querySelectorAll("[data-assistant-create-task]").forEach(button => button.onclick = () => {
    const message = button.closest(".assistant-command-card");
    const title = message?.querySelector(".assistant-card-grid b")?.textContent?.trim() || "待辦";
    createTask(title);
    addConversationMessage("assistant", `已建立待辦事項：「${title}」。`);
    activeWorkspace = "tasks";
    if (!openTabs.includes("tasks")) openTabs.push("tasks");
    rememberWorkspace("tasks");
    saveAll();
    render();
  });
  document.querySelectorAll("[data-assistant-edit-task]").forEach(button => button.onclick = () => {
    activeWorkspace = "tasks";
    if (!openTabs.includes("tasks")) openTabs.push("tasks");
    rememberWorkspace("tasks");
    render();
  });
  document.querySelectorAll("[data-assistant-confirm-entry]").forEach(button => button.onclick = async () => {
    const pending = getAssistantPendingCommand();
    const parsedCommand = pending?.command || null;
    const entryPayload = parsedCommand ? assistantConfirmationPayload(parsedCommand) : null;
    addConversationMessage("user", "確認建立");
    const thinkingId = addAssistantThinkingMessage();
    render();
    await new Promise(resolve => setTimeout(resolve, 350));
    try {
      if (!parsedCommand) throw new Error("找不到待確認的工時");
      const response = await executeWorklogCommand({ type: "confirm_pending_entry", parsedCommand, entryPayload });
      removeConversationMessage(thinkingId);
      addAssistantResult(response);
    } catch (error) {
      removeConversationMessage(thinkingId);
      console.error("WorkLog assistant command failed", assistantCommandErrorDebug({
        input: "assistant_confirm_entry",
        parsedIntent: { type: "confirm_pending_entry", parsedCommand, entryPayload },
        parsedCommand,
        entryPayload,
        error
      }));
      addConversationMessage("assistant", `工時建立失敗：${error?.message || "未知錯誤"}`);
    }
    render();
  });
  document.querySelectorAll("[data-assistant-confirm-calendar]").forEach(button => button.onclick = async () => {
    const pending = getAssistantPendingCommand();
    const parsedCommand = pending?.command || null;
    const entryPayload = parsedCommand ? assistantConfirmationPayload(parsedCommand) : null;
    addConversationMessage("user", "確認建立");
    const thinkingId = addAssistantThinkingMessage();
    render();
    await new Promise(resolve => setTimeout(resolve, 300));
    try {
      if (!parsedCommand) throw new Error("找不到待確認的工時");
      const response = await executeWorklogCommand({ type: "confirm_pending_calendar", parsedCommand, entryPayload });
      removeConversationMessage(thinkingId);
      addAssistantResult(response);
    } catch (error) {
      removeConversationMessage(thinkingId);
      console.error("WorkLog calendar entry command failed", assistantCommandErrorDebug({
        input: "assistant_confirm_calendar",
        parsedIntent: { type: "confirm_pending_calendar", parsedCommand, entryPayload },
        parsedCommand,
        entryPayload,
        error
      }));
      addConversationMessage("assistant", `工時建立失敗：${error?.message || "未知錯誤"}`);
    }
    render();
  });
  document.querySelectorAll("[data-assistant-calendar-to-worklog]").forEach(button => button.onclick = async () => {
    const pending = getAssistantPendingCommand();
    const parsedCommand = pending?.command || null;
    const entryPayload = parsedCommand ? assistantConfirmationPayload(parsedCommand) : null;
    addConversationMessage("user", "建立工時");
    const thinkingId = addAssistantThinkingMessage();
    render();
    await new Promise(resolve => setTimeout(resolve, 300));
    try {
      if (!parsedCommand) throw new Error("找不到可同步建立的工時");
      const response = await executeWorklogCommand({ type: "create_worklog_from_calendar", parsedCommand, entryPayload });
      removeConversationMessage(thinkingId);
      addAssistantResult(response);
    } catch (error) {
      removeConversationMessage(thinkingId);
      console.error("Calendar to WorkLog command failed", assistantCommandErrorDebug({
        input: "assistant_calendar_to_worklog",
        parsedIntent: { type: "create_worklog_from_calendar", parsedCommand, entryPayload },
        parsedCommand,
        entryPayload,
        error
      }));
      addConversationMessage("assistant", `工時建立失敗：${error?.message || "未知錯誤"}`);
    }
    render();
  });
  document.querySelectorAll("[data-assistant-calendar-no-worklog]").forEach(button => button.onclick = () => {
    clearAssistantPendingCommand();
    addConversationMessage("user", "不用");
    addConversationMessage("assistant", "好的，已取消這筆工時建立。");
    render();
  });
  document.querySelectorAll("[data-assistant-confirm-work-profile]").forEach(button => button.onclick = async () => {
    const pending = getAssistantPendingCommand();
    const draft = pending?.profileDraft || workProfile || {};
    addConversationMessage("user", "確認");
    const thinkingId = addAssistantThinkingMessage();
    render();
    try {
      await confirmWorkProfileFromConversation(draft);
      removeConversationMessage(thinkingId);
      addConversationMessage("assistant", "工作身分已完成。之後建立工時與匯出 ECP 會使用這份設定。");
    } catch (error) {
      removeConversationMessage(thinkingId);
      console.error("Work Profile conversation sync failed", { error, supabase: error.supabase || null, draft });
      addConversationMessage("assistant", `工作身分同步失敗：${error?.message || "請稍後再試"}`);
    }
    render();
  });
  document.querySelectorAll("[data-assistant-edit-work-profile]").forEach(button => button.onclick = () => {
    const pending = getAssistantPendingCommand();
    setAssistantPendingCommand({ action: "collect_work_profile", step: "ecp_owner", profileDraft: pending?.profileDraft || workProfile || {} });
    addConversationMessage("user", "修改");
    addConversationMessage("assistant", "好的，我們重新確認一次。請問您的 ECP 負責人？");
    render();
  });
  document.querySelectorAll("[data-assistant-later-work-profile]").forEach(button => button.onclick = () => {
    clearAssistantPendingCommand();
    const next = normalizeWorkProfile({ ...(workProfile || {}), lastProfilePromptDate: key(new Date()) }, profile);
    workProfile = next;
    saveAll();
    addConversationMessage("user", "稍後");
    addConversationMessage("assistant", "好的，您仍可先建立工時。匯出 ECP 前，我會提醒補齊工作身分。");
    render();
  });
}

function bindGlobal() {
  document.querySelectorAll("[data-logout]").forEach(b => b.onclick = () => doLogout());
  document.querySelectorAll("[data-retry-cloud-sync]").forEach(b => b.onclick = () => {
    if (cloudSync.status === "failed") DataService.retryAutoSave();
  });
}
function createTask(title = "", note = "", dueDate = "", options = {}) {
  const normalized = normalizeTask({
    title,
    note,
    dueDate,
    priority: options.priority || "p2",
    userPinned: options.userPinned === true,
    status: options.status || "not_started",
    progress: options.progress || 0
  });
  if (!normalized.title) return null;
  const existing = tasks.find(task => normalizeTaskStatus(task.status, task) !== "completed" && task.title === normalized.title);
  if (existing) return existing;
  tasks = [normalized, ...tasks];
  saveTasks();
  return normalized;
}

function legacyBindTasks() {
  document.querySelectorAll("[data-task-new]").forEach(button => button.onclick = () => { editingTaskId = null; taskSearch = ""; render(); });
  document.querySelectorAll("[data-task-filter]").forEach(button => button.onclick = () => { taskFilter = button.dataset.taskFilter || "all"; render(); });
  const search = document.getElementById("taskSearch");
  const submitSearch = () => { taskSearch = search?.value?.trim() || ""; render(); };
  document.querySelector("[data-task-search-submit]")?.addEventListener("click", submitSearch);
  search?.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); submitSearch(); } });
  document.querySelectorAll("[data-task-cancel]").forEach(button => button.onclick = () => { editingTaskId = null; render(); });
  document.querySelectorAll("[data-task-save]").forEach(button => button.onclick = () => {
    const title = document.getElementById("taskTitle")?.value?.trim() || "";
    if (!title) return toast("請輸入待辦事項名稱");
    const note = document.getElementById("taskNote")?.value?.trim() || "";
    const dueDate = document.getElementById("taskDueDate")?.value || "";
    const priority = document.querySelector("input[name=taskPriority]:checked")?.value || "p2";
    const userPinned = document.getElementById("taskPinned")?.checked === true;
    if (editingTaskId) {
      tasks = tasks.map(task => task.id === editingTaskId ? normalizeTask({ ...task, title, note, dueDate, priority, userPinned, updatedAt: new Date().toISOString() }) : task);
      toast("待辦事項已更新");
    } else {
      createTask(title, note, dueDate, { priority, userPinned });
      toast("待辦事項已建立");
    }
    editingTaskId = null;
    saveTasks();
    render();
  });
  document.querySelectorAll("[data-task-toggle]").forEach(button => button.onclick = () => {
    tasks = tasks.map(task => task.id === button.dataset.taskToggle ? normalizeTask({ ...task, status: task.status === "completed" ? "not_started" : "completed", progress: task.status === "completed" ? 0 : 100, completedAt: task.status === "completed" ? "" : new Date().toISOString(), updatedAt: new Date().toISOString() }) : task);
    saveTasks();
    toast("待辦事項狀態已更新");
    render();
  });
  document.querySelectorAll("[data-task-edit]").forEach(button => button.onclick = () => { editingTaskId = button.dataset.taskEdit; render(); });
  document.querySelectorAll("[data-task-delete]").forEach(button => button.onclick = () => {
    const task = tasks.find(item => item.id === button.dataset.taskDelete);
    if (!task || !confirm(`確定刪除待辦事項「${task.title}」？`)) return;
    tasks = tasks.filter(item => item.id !== task.id);
    saveTasks();
    toast("待辦事項已刪除");
    render();
  });
}

// Sprint 7 task lifecycle bindings. Search and drafts update locally without
// writing task records; only explicit save/start/complete actions sync Cloud.
function bindTasks() {
  document.querySelectorAll("[data-task-new]").forEach(button => button.onclick = () => { editingTaskId = null; taskDraft = loadTaskDraft("new") || null; render(); });
  document.querySelectorAll("[data-task-filter]").forEach(button => button.onclick = () => { taskFilter = button.dataset.taskFilter || "all"; render(); });
  const search = document.getElementById("taskSearch");
  if (search) {
    search.addEventListener("compositionstart", () => { taskSearchComposing = true; });
    search.addEventListener("compositionend", () => { taskSearchComposing = false; taskSearch = search.value || ""; render(); });
    search.addEventListener("input", () => { if (!taskSearchComposing) { taskSearch = search.value || ""; render(); } });
  }
  document.querySelector("[data-task-search-clear]")?.addEventListener("click", () => { taskSearch = ""; render(); });
  document.querySelectorAll("[data-task-journal]").forEach(button => button.onclick = () => {
    if (taskJournalTaskId === button.dataset.taskJournal) {
      taskJournalTaskId = null;
      taskJournalDraft = null;
      taskJournalLoading = false;
      render("journal-close");
    } else openTaskJournal(button.dataset.taskJournal);
  });
  document.querySelector("[data-journal-close]")?.addEventListener("click", () => { taskJournalTaskId = null; taskJournalDraft = null; render("journal-close"); });
  document.getElementById("taskJournalContent")?.addEventListener("input", event => { taskJournalDraft = { ...(taskJournalDraft || {}), content: event.target.value }; });
  document.getElementById("taskJournalUpdateStatus")?.addEventListener("change", event => {
    taskJournalDraft = { ...(taskJournalDraft || {}), updateStatus: event.target.checked };
    document.querySelector("[data-journal-status-fields]")?.classList.toggle("is-hidden", !event.target.checked);
  });
  document.getElementById("taskJournalStatus")?.addEventListener("change", event => { taskJournalDraft = { ...(taskJournalDraft || {}), status: event.target.value }; });
  document.getElementById("taskJournalUpdateProgress")?.addEventListener("change", event => {
    taskJournalDraft = { ...(taskJournalDraft || {}), updateProgress: event.target.checked };
    document.querySelector("[data-journal-progress-fields]")?.classList.toggle("is-hidden", !event.target.checked);
  });
  document.getElementById("taskJournalProgress")?.addEventListener("input", event => {
    const value = taskProgressValue(event.target.value);
    taskJournalDraft = { ...(taskJournalDraft || {}), progress: value };
    const output = document.getElementById("taskJournalProgressOutput");
    if (output) output.value = `${value}%`;
  });
  document.querySelector("[data-journal-save]")?.addEventListener("click", () => saveTaskJournal(taskJournalTaskId));
  document.querySelectorAll("[data-task-cancel]").forEach(button => button.onclick = () => { clearTaskDraft(editingTaskId || "new"); editingTaskId = null; render(); });
  const draftField = (field, value) => saveTaskDraft(editingTaskId || "new", { ...(loadTaskDraft(editingTaskId || "new") || {}), [field]: value });
  document.getElementById("taskTitle")?.addEventListener("input", event => draftField("title", event.target.value));
  document.getElementById("taskNote")?.addEventListener("input", event => draftField("note", event.target.value));
  document.getElementById("taskDueDate")?.addEventListener("input", event => draftField("dueDate", event.target.value));
  document.getElementById("taskStatus")?.addEventListener("change", event => draftField("status", event.target.value));
  document.getElementById("taskProgress")?.addEventListener("input", event => { draftField("progress", event.target.value); const output = document.getElementById("taskProgressOutput"); if (output) output.value = `${taskProgressValue(event.target.value)}%`; });
  document.querySelectorAll("input[name=taskPriority]").forEach(input => input.addEventListener("change", event => draftField("priority", event.target.value)));
  document.getElementById("taskPinned")?.addEventListener("change", event => draftField("userPinned", event.target.checked));
  document.querySelectorAll("[data-task-save]").forEach(button => button.onclick = () => {
    const title = document.getElementById("taskTitle")?.value?.trim() || "";
    if (!title) return toast("請輸入待辦事項名稱");
    const note = document.getElementById("taskNote")?.value?.trim() || "";
    const dueDate = document.getElementById("taskDueDate")?.value || "";
    const status = normalizeTaskStatus(document.getElementById("taskStatus")?.value || "not_started");
    const progress = status === "completed" ? 100 : taskProgressValue(document.getElementById("taskProgress")?.value || 0);
    const priority = document.querySelector("input[name=taskPriority]:checked")?.value || "p2";
    const userPinned = document.getElementById("taskPinned")?.checked === true;
    if (editingTaskId) tasks = tasks.map(task => task.id === editingTaskId ? normalizeTask({ ...task, title, note, dueDate, priority, userPinned, status, progress, updatedAt: new Date().toISOString() }) : task);
    else createTask(title, note, dueDate, { priority, userPinned, status, progress });
    clearTaskDraft(editingTaskId || "new");
    editingTaskId = null;
    saveTasks();
    toast("待辦事項已儲存");
    render();
  });
  document.querySelectorAll("[data-task-start]").forEach(button => button.onclick = () => {
    const task = tasks.find(item => item.id === button.dataset.taskStart);
    if (!task || task.status === "completed") return;
    const next = normalizeTask({ ...task, status: task.status === "not_started" ? "in_progress" : task.status, progress: Math.max(1, task.progress || 0), startedAt: task.startedAt || new Date().toISOString(), updatedAt: new Date().toISOString() });
    tasks = tasks.map(item => item.id === task.id ? next : item);
    saveTasks();
    captureSeed = { title: next.title, note: next.note, taskUuid: next.id, taskTitleSnapshot: next.title, source: "task" };
    editingEntryId = null;
    activeWorkspace = "worklog";
    if (!openTabs.includes("worklog")) openTabs.push("worklog");
    rememberWorkspace("worklog");
    view = "capture";
    saveAll({ skipSync: true });
    render();
  });
  document.querySelectorAll("[data-task-toggle]").forEach(button => button.onclick = () => {
    const task = tasks.find(item => item.id === button.dataset.taskToggle);
    if (!task) return;
    if (task.status === "completed") {
      tasks = tasks.map(item => item.id === task.id ? normalizeTask({ ...item, status: "not_started", progress: 0, completedAt: "", completedNote: "", completedBy: "", completionSource: "manual", updatedAt: new Date().toISOString() }) : item);
      saveTasks(); toast("待辦事項已恢復"); render();
    } else { taskCompletionDialogId = task.id; render(); }
  });
  document.querySelector("[data-task-completion-cancel]")?.addEventListener("click", () => { taskCompletionDialogId = null; render(); });
  document.querySelector("[data-task-completion-confirm]")?.addEventListener("click", async () => {
    const task = tasks.find(item => item.id === taskCompletionDialogId);
    if (!task) return;
    const completedNote = document.getElementById("taskCompletionNote")?.value?.trim() || "";
    const completedAt = new Date().toISOString();
    const createWorklog = document.getElementById("taskCompletionCreateWorklog")?.checked === true;
    const createCompletionRecord = document.getElementById("taskCompletionCreateRecord")?.checked !== false;
    const existingWorklogHours = taskWorklogHours(task);
    tasks = tasks.map(item => item.id === task.id ? normalizeTask({ ...item, status: "completed", progress: 100, completedAt, completedNote, completedBy: currentUserUuid(), completionSource: "manual", updatedAt: completedAt }) : item);
    taskCompletionDialogId = null;
    try {
      if (typeof DataService !== "undefined" && taskCloudUuid(task)) {
        await DataService.saveTasksNow(tasks);
        if (createWorklog && existingWorklogHours <= 0) {
          const elapsedHours = taskCompletionElapsedHours(task, completedAt);
          if (elapsedHours > 0) {
            await persistEntry(createEntry({
              date: completedAt.slice(0, 10),
              at: task.startedAt || completedAt,
              title: task.title,
              note: completedNote ? `結案：${completedNote}` : "完成待辦事項",
              hours: elapsedHours,
              source: "task-completion",
              taskUuid: taskCloudUuid(task),
              taskTitleSnapshot: task.title
            }), { requireCloud: true });
          }
        }
        if (createCompletionRecord) await DataService.saveWorkJournalEntry({
          taskUuid: taskCloudUuid(task),
          entryType: "completion",
          content: completedNote || "工作已完成。",
          status: "completed",
          progress: 100,
          metadata: { source: "completion-dialog", completedAt, createWorklog, existingWorklogHours }
        });
      } else saveTasks();
      toast(createCompletionRecord ? "待辦事項已完成，結案紀錄已寫入 Work Journal" : "待辦事項已完成");
    } catch (error) {
      console.error("Completion Journal save failed", error);
      toast(error.message || "完成同步失敗，請稍後再試");
    }
    render("task-completed");
  });
  document.querySelectorAll("[data-task-edit]").forEach(button => button.onclick = () => { editingTaskId = button.dataset.taskEdit; taskDraft = loadTaskDraft(editingTaskId) || null; render(); });
  document.querySelectorAll("[data-task-delete]").forEach(button => button.onclick = () => {
    const task = tasks.find(item => item.id === button.dataset.taskDelete);
    if (!task || !confirm(`確定刪除待辦事項「${task.title}」？`)) return;
    tasks = tasks.filter(item => item.id !== task.id);
    saveTasks(); toast("待辦事項已刪除"); render();
  });
}

function taskJournalPanel(task = null) {
  if (!task || taskJournalTaskId !== task.id) return "";
  const timeline = workJournalForTask(task);
  const rows = taskJournalLoading
    ? `<div class="task-journal-loading">🌀 正在從 Cloud 載入工作紀錄…</div>`
    : timeline.length
      ? timeline.map(entry => `<article class="task-journal-entry"><span class="task-journal-dot" aria-hidden="true">●</span><div class="task-journal-entry-body"><div class="task-journal-entry-head"><b>${escapeHtml(journalEntryTypeLabel(entry.entryType))}</b><time>${escapeHtml(fmt(entry.createdAt))}</time></div><div>${escapeHtml(entry.content)}</div></div></article>`).join("")
      : `<div class="empty">尚無工作推進紀錄。留下今天做到哪裡的第一筆紀錄。</div>`;
  const defaultStatus = normalizeTaskStatus(task.status, task);
  const defaultProgress = taskProgressValue(task.progress);
  const updateStatus = taskJournalDraft?.updateStatus === true;
  const updateProgress = taskJournalDraft?.updateProgress === true;
  return `<section class="task-journal-panel" aria-label="Work Journal"><div class="task-journal-head"><div><h3>▾ 工作推進紀錄（${timeline.length}）</h3><div class="muted">${escapeHtml(task.title)} · Timeline</div></div><div class="task-journal-head-actions"><span class="task-journal-cloud-badge">☁ Cloud</span><button class="btn2" type="button" data-journal-close>收合</button></div></div><div class="task-journal-timeline">${rows}</div><div class="task-journal-form"><label for="taskJournalContent">＋ 新增推進紀錄</label><textarea class="input" id="taskJournalContent" rows="3" placeholder="例如：已確認現場有留電源，並已通知廠商。">${escapeHtml(taskJournalDraft?.content || "")}</textarea><label class="task-journal-check"><input type="checkbox" id="taskJournalUpdateProgress" ${updateProgress ? "checked" : ""}> 同時更新目前進度</label><div class="task-journal-optional-field ${updateProgress ? "" : "is-hidden"}" data-journal-progress-fields><label class="task-progress-label">目前進度 <output id="taskJournalProgressOutput">${taskProgressValue(taskJournalDraft?.progress ?? defaultProgress)}%</output></label><input class="task-progress-range" id="taskJournalProgress" type="range" min="0" max="100" step="5" value="${taskProgressValue(taskJournalDraft?.progress ?? defaultProgress)}"></div><label class="task-journal-check"><input type="checkbox" id="taskJournalUpdateStatus" ${updateStatus ? "checked" : ""}> 同時更新目前狀態</label><div class="task-journal-optional-field ${updateStatus ? "" : "is-hidden"}" data-journal-status-fields><select class="input" id="taskJournalStatus">${taskStatusOptions(taskJournalDraft?.status || defaultStatus)}</select></div><div class="form-actions"><button class="btn" type="button" data-journal-save>儲存推進紀錄</button></div></div></section>`;
}

// Sprint 7.1: workflow-aware task editor. It keeps the Sprint 7.0 layout and
// adds only shared Status/Progress data to the existing list/editor surface.
function taskWorkspace() {
  const editing = tasks.find(task => task.id === editingTaskId) || null;
  const list = taskListItems();
  const draft = loadTaskDraft(editingTaskId || "new") || {};
  const value = (key, fallback = "") => editing ? (draft[key] ?? editing[key] ?? fallback) : (draft[key] ?? fallback);
  const form = `<section class="task-form"><div class="panel-head"><div><h3>${editing ? "✏️ 編輯待辦事項" : "＋ 新增待辦事項"}</h3><div class="muted">進度描述工作目前在哪個階段；完成說明只在結案時填寫。</div></div></div><label>待辦事項名稱</label><input class="input" id="taskTitle" value="${escapeHtml(value("title"))}" placeholder="例如：寄出採購資料"><label>備註（選填）</label><textarea class="input" id="taskNote" rows="3" placeholder="補充說明">${escapeHtml(value("note"))}</textarea><label>狀態</label><select class="input" id="taskStatus">${taskStatusOptions(normalizeTaskStatus(value("status", editing?.status || "not_started")))}</select><label class="task-progress-label">進度 <output id="taskProgressOutput">${taskProgressValue(value("progress", editing?.progress || 0))}%</output></label><input class="task-progress-range" id="taskProgress" type="range" min="0" max="100" step="5" value="${taskProgressValue(value("progress", editing?.progress || 0))}"><label>期限（選填）</label><input class="input task-date-input" id="taskDueDate" type="date" value="${escapeHtml(value("dueDate"))}"><fieldset class="task-priority-fieldset"><legend>Priority</legend><div class="task-priority-options">${taskPriorityOptions(value("priority", editing?.priority || "p2"))}</div><label class="task-pin-option"><input type="checkbox" id="taskPinned" ${value("userPinned", editing?.userPinned) ? "checked" : ""}> 📌 置頂</label></fieldset><div class="form-actions"><button class="btn2" type="button" data-task-cancel="1" ${editing ? "" : "disabled"}>取消</button><button class="btn" type="button" data-task-save="1">${editing ? "儲存修改" : "建立待辦事項"}</button></div></section>`;
  const rows = list.length ? list.map(task => {
    const timeline = workJournalForTask(task);
    const latest = timeline[timeline.length - 1];
    const latestMarkup = latest ? `<div class="task-latest-journal"><div class="task-latest-journal-label">🟢 最新更新</div><div class="task-latest-journal-line"><div class="task-latest-journal-content">${escapeHtml(latest.content)}</div><time>${escapeHtml(fmt(latest.createdAt))}</time></div></div>` : "";
    const journalToggleLabel = `${taskJournalTaskId === task.id ? "▾" : "▸"} 工作推進紀錄（${timeline.length}）`;
    const worklogHours = taskWorklogHours(task);
    return `<article class="entry task-row ${task.status === "completed" ? "task-completed" : ""} ${taskJournalTaskId === task.id ? "task-journal-open" : ""}" data-task-card="${escapeHtml(task.id)}"><div class="task-row-core"><header class="task-row-header"><div class="task-row-title">${taskPriorityBadge(task)} ${taskWorkflowBadge(task)} <b>${task.status === "completed" ? "✅" : "⬜"} ${escapeHtml(task.title)}</b></div><div class="task-row-actions actions compact"><button class="btn2" type="button" data-task-journal="${escapeHtml(task.id)}">${journalToggleLabel}</button><button class="btn2" type="button" data-task-toggle="${escapeHtml(task.id)}">${task.status === "completed" ? "恢復" : "完成"}</button><button class="btn2" type="button" data-task-edit="${escapeHtml(task.id)}">編輯</button><button class="btn2 danger" type="button" data-task-delete="${escapeHtml(task.id)}">刪除</button></div></header><div class="task-row-content"><div class="task-progress-track" aria-label="進度 ${task.progress}%"><span style="width:${task.progress}%"></span></div><small>${task.dueDate ? `期限：${escapeHtml(task.dueDate)}` : "無期限"}｜${escapeHtml(typeof PriorityEngine !== "undefined" ? PriorityEngine.getReason(task) : "依目前工作優先順序。")} ${task.note ? `｜${escapeHtml(task.note)}` : ""}${worklogHours > 0 ? `｜⏱ ${escapeHtml(formatHumanDuration(worklogHours))}` : ""}</small>${latestMarkup}${task.status === "completed" && task.completedNote ? `<div class="task-completion-note">完成說明：${escapeHtml(task.completedNote)}</div>` : ""}</div></div>${taskJournalPanel(task)}</article>`;
  }).join("") : `<div class="empty"><b>${taskSearch ? "找不到符合的待辦事項" : "目前還沒有待辦事項"}</b><div class="muted">可以建立今天第一個待辦事項。</div></div>`;
  const completionTask = taskCompletionDialogId ? tasks.find(task => task.id === taskCompletionDialogId) : null;
  const completionExistingHours = completionTask ? taskWorklogHours(completionTask) : 0;
  const completionElapsedHours = completionTask ? taskCompletionElapsedHours(completionTask) : 0;
  const completionDisplayHours = completionExistingHours || completionElapsedHours;
  const completionCanCreateWorklog = Boolean(completionTask && taskCloudUuid(completionTask) && completionDisplayHours > 0);
  const dialog = completionTask ? `<div class="quick-add-dialog task-completion-dialog" role="dialog" aria-modal="true"><div class="quick-add-card"><h3>完成待辦事項</h3><p>完成是這件工作的最後一步；Journal 會保留結案結果，既有工時不會重複建立。</p><label for="taskCompletionNote">完成說明</label><textarea class="input" id="taskCompletionNote" rows="4" placeholder="例如：已完成安裝並驗收，客戶確認無誤。"></textarea><div class="task-completion-summary"><span>耗時</span><strong>${completionDisplayHours > 0 ? escapeHtml(formatHumanDuration(completionDisplayHours)) : "尚無關聯工時"}</strong></div><label class="task-completion-option"><input type="checkbox" id="taskCompletionCreateWorklog" ${completionCanCreateWorklog ? "checked" : ""} ${completionCanCreateWorklog ? "" : "disabled"}> 建立工時紀錄${completionExistingHours > 0 ? "（沿用既有工時）" : ""}</label><label class="task-completion-option"><input type="checkbox" id="taskCompletionCreateRecord" checked> 建立 Completion Record</label><div class="muted task-completion-hint">${completionCanCreateWorklog ? "已有關聯工時時不會重複建立。" : "請先透過工作紀錄建立工時，完成時才能帶入實際耗時。"}</div><div class="form-actions"><button class="btn2" type="button" data-task-completion-cancel>取消</button><button class="btn" type="button" data-task-completion-confirm>儲存並完成</button></div></div></div>` : "";
  return `<section class="panel tasks-workspace lifecycle-task-workspace" style="margin-top:18px"><div class="panel-head"><div><h2>✅ 待辦事項</h2><div class="muted">目前 ${tasks.length} 項｜未完成 ${tasks.filter(task => task.status !== "completed").length} 項</div></div><button class="btn2" type="button" data-task-new="1">＋ 新增待辦事項</button></div><div class="task-workspace-grid"><section class="task-list-section"><div class="task-toolbar"><div class="task-filters">${["all", "open", "completed"].map(filter => `<button class="btn2 ${taskFilter === filter ? "selected" : ""}" type="button" data-task-filter="${filter}">${filter === "all" ? "全部" : filter === "open" ? "進行中" : "已完成"}</button>`).join("")}</div><div class="task-search"><span aria-hidden="true">🔍</span><input class="input" id="taskSearch" value="${escapeHtml(taskSearch)}" placeholder="搜尋待辦事項"><button class="btn2 task-search-clear" type="button" data-task-search-clear aria-label="清除搜尋">✕</button></div></div><div class="task-list">${rows}</div></section>${form}</div>${dialog}</section>`;
}

function doLogout() { if (typeof RealtimeService !== "undefined") RealtimeService.stop(); clearStoredAuthSession(); clearStoredCodeVerifier(); session = null; tasks = []; workJournalEntries = []; taskJournalTaskId = null; taskJournalDraft = null; activeModule = "dashboard"; activeWorkspace = "dashboard"; openTabs = []; recentWorkspaces = []; view = "center"; saveAll(); toast("已登出"); render(); }

function bindOnboarding() {
  let tags = [], src = [];
  const bindTagButtons = () => {
    document.querySelectorAll(".tag-btn").forEach(b => b.onclick = () => { tags.includes(b.dataset.tag) ? tags = tags.filter(x => x !== b.dataset.tag) : tags.push(b.dataset.tag); b.classList.toggle("selected", tags.includes(b.dataset.tag)); });
  };
  bindTagButtons();
  document.getElementById("role").onchange = e => {
    tags = [];
    document.getElementById("tagOptions").innerHTML = tagButtons(tagsForRole(e.target.value));
    bindTagButtons();
  };
  document.querySelectorAll(".src-btn").forEach(b => b.onclick = () => { src.includes(b.dataset.src) ? src = src.filter(x => x !== b.dataset.src) : src.push(b.dataset.src); b.classList.toggle("selected", src.includes(b.dataset.src)); });
  document.getElementById("saveProfile").onclick = async () => {
    const role = document.getElementById("role").value;
    profile = { role, tags: tags.length ? tags : tagsForRole(role), sources: src.length ? src : ["Google Drive", "手動紀錄"], workHours: "09:00~18:00", lunch: "12:00~13:00", sop: document.getElementById("sop").value };
    setWorkModels(profile.tags);
    saveAll();
    await DataService.saveProfileSettingsOnly();
    await DataService.saveWorkModelsOnly();
    toast("已建立我的工作"); render();
  };
}

function bind() {
  document.querySelectorAll("[data-toggle-sidebar]").forEach(b => b.onclick = () => { sidebarOpen = !sidebarOpen; render(); });
  document.querySelectorAll("[data-close-sidebar]").forEach(b => b.onclick = () => { sidebarOpen = false; render(); });
  document.querySelectorAll("[data-open-workspace]").forEach(b => b.onclick = () => { sidebarOpen = false; openWorkspace(b.dataset.openWorkspace); });
  document.querySelectorAll("[data-activate-workspace]").forEach(b => b.onclick = () => activateWorkspace(b.dataset.activateWorkspace));
  document.querySelectorAll("[data-close-workspace]").forEach(b => b.onclick = e => { e.stopPropagation(); closeWorkspace(b.dataset.closeWorkspace); });
  document.querySelectorAll("[data-month-nav]").forEach(b => b.onclick = async () => {
    const base = selectedMonthDate(1);
    base.setMonth(base.getMonth() + Number(b.dataset.monthNav || 0));
    await setSelectedMonth(monthKey(base), 1);
  });
  document.querySelectorAll("[data-day]").forEach(b => b.onclick = () => { selected = selectedMonthDate(Number(b.dataset.day)); selectedMonth = monthKey(selected); saveAll(); render(); });
  document.querySelectorAll("[data-mobile-date]").forEach(b => b.onclick = async () => {
    const nextDate = new Date(`${b.dataset.mobileDate}T00:00:00`);
    const nextMonth = monthKey(nextDate);
    selected = nextDate;
    if (nextMonth !== selectedMonth) await setSelectedMonth(nextMonth, nextDate.getDate());
    else { selectedMonth = nextMonth; saveAll(); render(); }
  });
  document.querySelectorAll("[data-toggle-mobile-summary]").forEach(b => b.onclick = () => {
    writeScopedUiFlag(MOBILE_SUMMARY_OPEN_KEY, !readScopedUiFlag(MOBILE_SUMMARY_OPEN_KEY, true));
    render();
  });
  document.querySelectorAll("[data-toggle-mobile-calendar]").forEach(b => b.onclick = () => {
    const next = !readScopedUiFlag(MOBILE_CALENDAR_OPEN_KEY, false);
    mobileCalendarOpen = next;
    writeScopedUiFlag(MOBILE_CALENDAR_OPEN_KEY, next);
    render();
  });
  document.querySelectorAll("[data-mobile-week-nav]").forEach(button => button.onclick = async () => {
    const direction = Number(button.dataset.mobileWeekNav || 0);
    selected = direction === 0 ? new Date() : addDays(selected, direction * 7);
    const nextMonth = monthKey(selected);
    if (nextMonth !== selectedMonth) await setSelectedMonth(nextMonth, selected.getDate());
    else { saveAll(); render(); }
  });
  document.querySelectorAll("[data-mobile-month-nav]").forEach(button => button.onclick = async () => {
    const direction = Number(button.dataset.mobileMonthNav || 0);
    const next = direction === 0 ? new Date() : selectedMonthDate(1);
    if (direction !== 0) next.setMonth(next.getMonth() + direction);
    await setSelectedMonth(monthKey(next), direction === 0 ? next.getDate() : 1);
  });
  document.querySelectorAll("[data-mobile-worklog-tab]").forEach(b => b.onclick = () => {
    mobileWorklogTab = b.dataset.mobileWorklogTab || "time";
    document.querySelectorAll("[data-mobile-worklog-tab]").forEach(tab => tab.classList.toggle("active", tab === b));
    const target = document.getElementById(mobileWorklogTab === "suggestions" ? "mobile-worklog-suggestions" : "mobile-worklog-time");
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  document.querySelectorAll("[data-action=add]").forEach(b => b.onclick = () => { editingEntryId = null; captureSeed = null; activeWorkspace = "worklog"; if (!openTabs.includes("worklog")) openTabs.push("worklog"); rememberWorkspace("worklog"); view = "capture"; saveAll(); render(); });
  const today = document.querySelector("[data-today]"); if (today) today.onclick = async () => { selected = new Date(); await setSelectedMonth(monthKey(selected), selected.getDate()); };
  const exportBtn = document.querySelector("[data-export-month]"); if (exportBtn) exportBtn.onclick = () => exportEcpImportFile();
  bindSuggestionCardActions(document);
  bindDashboard();
  document.querySelectorAll("[data-suggestion-prev-batch]").forEach(button => button.onclick = () => {
    if (button.getAttribute("aria-disabled") === "true") return;
    moveSuggestionBatch(-1);
  });
  document.querySelectorAll("[data-suggestion-next-batch]").forEach(button => button.onclick = () => {
    if (button.getAttribute("aria-disabled") === "true") return;
    moveSuggestionBatch(1);
  });
  document.querySelectorAll("[data-del-id]").forEach(b => b.onclick = async () => {
    const removed = entries.find(e => e.id === b.dataset.delId);
    if (!removed) return;
    try {
      await DataService.deleteEntry(removed);
      if (removed.source === "ai-card") recordSuggestionMetric(removed.title, "deleted", removed);
      saveAll({ skipSync: true });
      toast("已刪除");
      render();
    } catch (error) {
      console.error("Delete entry failed", error);
      toast("刪除同步失敗，請稍後再試");
    }
  });
  document.querySelectorAll("[data-edit-id]").forEach(b => b.onclick = () => { editingEntryId = b.dataset.editId; captureSeed = null; activeWorkspace = "worklog"; if (!openTabs.includes("worklog")) openTabs.push("worklog"); rememberWorkspace("worklog"); view = "capture"; saveAll(); render(); });
  bindLibrary();
  if (activeWorkspace === "workMemory" || activeWorkspace === "settings" || activeWorkspace === "aiSuggestions") bindWorkMemory();
  if (activeWorkspace === "tasks") bindTasks();
  if (activeWorkspace === "worklog" && view === "capture") bindCapture();
  bindWorklogAssistant();
  if (activeWorkspace === "worklog" && !profile) bindOnboarding();
  if (activeWorkspace === "library" && view === "libraryForm") bindLibraryForm(editingLibraryId);
  if (activeWorkspace === "settings") bindSettings();
}

async function persistWorkMemory(nextModels = [], message = "我的工作已更新", options = {}) {
  setWorkModels(nextModels);
  saveAll({ skipSync: true });
  try {
    await DataService.saveWorkModelsOnly({ requireCloud: true });
    const cloudModels = options.reloadCloud === false ? workMemoryObjects() : await DataService.reloadWorkModels();
    toast(message);
    render();
    return { success: true, models: cloudModels };
  } catch (error) {
    console.error("Persist Work Memory failed", { error, models: workMemoryObjects() });
    toast(workMemoryFoundationNotInitialized ? "Work Memory Cloud 尚未初始化" : "我的工作尚未同步，請稍後重試");
    render();
    return { success: false, error, models: workMemoryObjects() };
  }
}

function verifyWorkMemoryMergeResult(beforeActiveCount = 0, members = [], canonical = "", cloudModels = []) {
  const rows = (Array.isArray(cloudModels) ? cloudModels : workMemoryObjects())
    .map((item, index) => normalizeWorkMemoryObject(item, index))
    .filter(item => item.name);
  const active = rows.filter(item => item.isActive !== false);
  const activeNames = [...new Set(active.map(item => item.name))];
  const sourceNames = [...new Set(arrayFromInput(members).filter(name => String(name) !== String(canonical)))];
  const deactivated = sourceNames.filter(name => rows.some(item => item.name === name && item.isActive === false));
  const canonicalIsNew = !arrayFromInput(members).some(name => String(name) === String(canonical));
  const expectedAfterActiveCount = Math.max(0, Number(beforeActiveCount || 0) - sourceNames.length + (canonicalIsNew ? 1 : 0));
  const success = activeNames.includes(String(canonical || "").trim())
    && deactivated.length === sourceNames.length
    && activeNames.length === expectedAfterActiveCount;
  return {
    success,
    beforeActiveCount: Number(beforeActiveCount || 0),
    afterActiveCount: activeNames.length,
    canonical: String(canonical || "").trim(),
    deactivated,
    activeNames,
    error: success ? "" : "Cloud Merge 驗證未通過"
  };
}

function closestWorkMemoryMatch(name = "", excludeNames = [], models = workModels()) {
  const clean = String(name || "").trim();
  const excluded = new Set(arrayFromInput(excludeNames));
  return models
    .filter(model => !excluded.has(model))
    .map(model => ({ name: model, score: SuggestionIntelligence.similarity(clean, model) }))
    .sort((a, b) => b.score - a.score)[0] || null;
}

function confirmWorkMemorySimilarity(name = "", options = {}) {
  const match = closestWorkMemoryMatch(name, options.excludeNames || [], options.models || workModels());
  const threshold = Number(SuggestionIntelligence?.thresholds?.workMemoryMatch || 0.84);
  if (!match || match.score < threshold) return { action: "create", match: null };
  const percent = Math.round(match.score * 100);
  const choice = prompt(`🪶 我發現：\n\n「${name}」\n和既有工作「${match.name}」很接近（${percent}%）。\n\n請輸入：\n1 使用既有工作\n2 合併到既有工作\n3 仍建立新工作`, "1");
  if (choice == null) return { action: "cancel", match };
  if (String(choice).trim() === "2") return { action: "merge", match };
  if (String(choice).trim() === "3") return { action: "create", match };
  return { action: "existing", match };
}

function workMemoryObjectByName(name = "") {
  return activeWorkMemoryObjects().find(item => item.name === String(name || "").trim()) || null;
}

async function rememberWorkMemoryAlias(targetName = "", alias = "", source = "") {
  const objects = workMemoryObjects();
  const index = objects.findIndex(item => item.name === targetName);
  if (index < 0 || objects[index].isActive === false) return false;
  const target = { ...objects[index] };
  target.aliases = [...new Set([...target.aliases, alias].filter(Boolean))];
  if (source) {
    const labels = new Set(target.sourceReferences.map(reference => reference.label || ""));
    if (!labels.has(source)) target.sourceReferences = [...target.sourceReferences, { type: "work_memory", label: source }];
  }
  objects[index] = target;
  await persistWorkMemory(objects, `我已把這項理解整理到「${targetName}」`);
  return true;
}

async function acceptWorkMemoryMergeSuggestion(suggestion, nextName = "", nextDescription = "") {
  if (!suggestion) return { success: false, error: "找不到合併建議" };
  const keepName = String(nextName || suggestion.keep || "").trim();
  if (!keepName) { toast("請輸入要保留的工作名稱"); return { success: false, error: "缺少 canonical name" }; }
  const beforeActiveCount = activeWorkMemoryObjects().length;
  const objects = activeWorkMemoryObjects();
  const members = [...new Set(arrayFromInput(suggestion.members || [suggestion.a, suggestion.b]).filter(Boolean))];
  const selectedObjects = objects.filter(item => members.includes(item.name));
  const keepObject = selectedObjects.find(item => item.name === suggestion.keep || item.name === keepName) || normalizeWorkMemoryObject({ name: keepName, category: suggestion.category });
  // Keep the source rows as inactive history records.  They must disappear
  // from the ordinary Workspace, but remain available to rollback/history and
  // must be persisted to Cloud with is_active=false.
  const deactivatedSources = selectedObjects.map(item => ({ ...item, isActive: false }));
  const inactiveHistory = workMemoryObjects().filter(item => item.isActive === false && item.name !== keepName && !members.includes(item.name));
  const mergedObjects = objects.filter(item => !members.includes(item.name));
  const allSourceReferences = [...selectedObjects.flatMap(item => item.sourceReferences || []), ...(suggestion.sources || []).map(label => ({ type: "merge", label }))];
  const allKeywords = [...new Set(selectedObjects.flatMap(item => item.keywords || []))];
  const allAliases = [...new Set(selectedObjects.flatMap(item => item.aliases || []).concat(members).filter(name => name && name !== keepName))];
  const nextObject = normalizeWorkMemoryObject({
    ...keepObject,
    name: keepName,
    description: nextDescription || keepObject.description || selectedObjects.map(item => item.description).find(Boolean) || suggestion.description || "",
    category: suggestion.category || keepObject.category || selectedObjects.map(item => item.category).find(Boolean) || "一般工作",
    aliases: [...new Set([...allAliases, ...(suggestion.aliases || [])].filter(name => name && name !== keepName))],
    keywords: allKeywords,
    sourceReferences: allSourceReferences,
    isActive: selectedObjects.some(item => item.isActive)
  }, 0, keepObject);
  const next = [nextObject, ...mergedObjects, ...deactivatedSources, ...inactiveHistory];
  for (let index = 0; index < members.length; index += 1) {
    for (let nextIndex = index + 1; nextIndex < members.length; nextIndex += 1) saveWorkMemoryMergeDecision(members[index], members[nextIndex], "accepted");
  }
  bumpWorkMemoryMergeStat(nextName && nextName !== suggestion.keep ? "renamed" : "merged");
  const persisted = await persistWorkMemory(next, "我已記住這次整理方式", { reloadCloud: true });
  if (!persisted.success) {
    workMemoryManualMergeSuggestion = suggestion;
    setWorkMemoryMergeNotice("");
    toast("Merge 尚未同步完成，請確認 Cloud 後再試");
    render();
    return { success: false, error: persisted.error?.message || "Cloud save failed" };
  }
  const transaction = verifyWorkMemoryMergeResult(beforeActiveCount, members, keepName, persisted.models);
  if (!transaction.success) {
    workMemoryManualMergeSuggestion = suggestion;
    setWorkMemoryMergeNotice("");
    toast("Merge Cloud 驗證失敗，尚未顯示完成");
    render();
    return transaction;
  }
  if (transaction.success) {
    setWorkMemoryMergeNotice(`已將 ${members.join("、")} 整理為「${keepName}」。`);
    render();
  }
  return transaction;
}

async function adoptAiSuggestion(item, override = {}) {
  if (!item) return;
  if (item.type === "rename" || item.type === "category") {
    const objects = workMemoryObjects();
    const index = objects.findIndex(model => model.name === (item.renameFrom || item.workName || ""));
    if (index < 0 || objects[index].isActive === false) return toast("找不到要整理的正式工作");
    const next = [...objects];
    const current = { ...next[index] };
    if (item.type === "rename") {
      const nextName = String(override.name || item.renameTo || "").trim();
      if (!nextName) return toast("請輸入新的工作名稱");
      current.name = nextName;
      current.aliases = [...new Set([...(current.aliases || []), item.renameFrom].filter(Boolean))];
      bumpWorkMemoryMergeStat("renamed");
    } else {
      current.category = String(override.category || item.categoryTo || "其他").trim() || "其他";
      bumpWorkMemoryMergeStat("renamed");
    }
    next[index] = normalizeWorkMemoryObject({ ...current, updatedAt: new Date().toISOString() }, index, current);
    saveWorkMemoryAiSuggestionDecision(item.key, "adopted", { type: item.type, name: current.name, category: current.category });
    await persistWorkMemory(next, item.type === "rename" ? "我已依照你的決定重新命名工作" : "我已依照你的決定整理工作分類");
    return;
  }
  if (item.type === "merge") {
    await acceptWorkMemoryMergeSuggestion(item.mergeSuggestion, override.name || "", override.description || "");
    saveWorkMemoryAiSuggestionDecision(item.key, "adopted", { type: item.type, name: override.name || item.mergeSuggestion?.keep || "" });
    // The merge persistence render happens before this suggestion decision is
    // recorded; render once more so the suggestion count is immediately fresh.
    render();
    return;
  }
  const name = String(override.name || item.title || "").trim();
  if (!name) return toast("請輸入要加入「我的工作」的名稱");
  const similarity = confirmWorkMemorySimilarity(name);
  if (similarity.action === "cancel") return;
  if (["existing", "merge"].includes(similarity.action)) {
    if (similarity.action === "merge") await rememberWorkMemoryAlias(similarity.match.name, name, item.source || "AI 建議");
    saveWorkMemoryAiSuggestionDecision(item.key, similarity.action === "merge" ? "merged" : "adopted", { type: item.type, name: similarity.match.name });
    toast(similarity.action === "merge" ? `我已把這項理解整理到「${similarity.match.name}」` : `我會繼續使用既有工作「${similarity.match.name}」`);
    render();
    return;
  }
  const nextObject = normalizeWorkMemoryObject({
    name,
    description: override.description || item.content || "",
    category: override.category || workMemoryCategoryFor(name),
    source: "ai_suggestion",
    sourceReferences: item.source ? [{ type: "ai_suggestion", label: item.source }] : [],
    keywords: arrayFromInput(item.triggers || item.candidate?.triggers || []),
    familiarity: 1,
    isActive: true
  });
  saveWorkMemoryAiSuggestionDecision(item.key, "adopted", { type: item.type, name });
  await persistWorkMemory([...workMemoryObjects(), nextObject], "我已把這項建議加入「我的工作」");
}

async function mergeAiSuggestion(item) {
  if (!item) return;
  if (item.type === "merge") {
    await adoptAiSuggestion(item);
    return;
  }
  const models = workModels();
  if (!models.length) return toast("目前還沒有可合併的正式工作，請先採用或新增一項工作");
  const target = prompt(`要把「${item.title}」合併到哪一項已確認工作？\n\n目前我的工作：\n${models.join("\n")}`, models[0]);
  const clean = String(target || "").trim();
  if (!clean || !models.includes(clean)) return toast("請輸入既有的工作名稱");
  await rememberWorkMemoryAlias(clean, item.title, item.source || "AI 建議");
  saveWorkMemoryAiSuggestionDecision(item.key, "merged", { into: clean, title: item.title });
  bumpWorkMemoryMergeStat("merged");
  toast(`我已記住「${item.title}」併入「${clean}」`);
}

function resetWorkMemoryManualMerge() {
  workMemoryMergeMode = false;
  workMemoryMergeSelection = [];
  workMemoryManualMergeSuggestion = null;
}

function startWorkMemoryManualMerge(name = "") {
  const clean = String(name || "").trim();
  if (!clean || !workMemoryObjectByName(clean)) return toast("找不到這項工作");
  editingWorkMemoryName = null;
  workMemoryManualMergeSuggestion = null;
  workMemoryMergeMode = true;
  workMemoryMergeSelection = [clean];
  render();
}

function toggleWorkMemoryManualMerge(name = "") {
  const clean = String(name || "").trim();
  if (!clean) return;
  workMemoryMergeSelection = workMemoryMergeSelection.includes(clean)
    ? workMemoryMergeSelection.filter(value => value !== clean)
    : [...workMemoryMergeSelection, clean];
  render();
}

function prepareWorkMemoryManualMerge() {
  const suggestion = workMemoryMergeSuggestionForNames(workMemoryMergeSelection);
  if (!suggestion) return toast("請至少選擇兩項工作");
  workMemoryMergeMode = false;
  workMemoryManualMergeSuggestion = suggestion;
  render();
}

function bindWorkMemory() {
  const aiSuggestions = workMemoryAiSuggestionItems();
  const search = document.querySelector("[data-work-memory-search]");
  const renderWorkMemorySearch = () => {
    if (workMemorySearchRenderTimer) clearTimeout(workMemorySearchRenderTimer);
    workMemorySearchRenderTimer = setTimeout(() => {
      workMemorySearchRenderTimer = null;
      render();
      const next = document.querySelector("[data-work-memory-search]");
      if (next) {
        next.focus();
        const caret = next.value.length;
        next.setSelectionRange(caret, caret);
      }
    }, 120);
  };
  if (search) {
    search.oncompositionstart = () => { workMemorySearchComposing = true; };
    search.oncompositionend = event => {
      workMemorySearchComposing = false;
      workMemoryQuery = event.target.value || "";
      renderWorkMemorySearch();
    };
    search.oninput = event => {
      workMemoryQuery = event.target.value || "";
      if (!workMemorySearchComposing) renderWorkMemorySearch();
    };
  }
  const categoryFilter = document.querySelector("[data-work-memory-category]");
  if (categoryFilter) categoryFilter.onchange = event => { workMemoryCategoryFilter = event.target.value || "all"; render(); };
  const sort = document.querySelector("[data-work-memory-sort]");
  if (sort) sort.onchange = event => { workMemorySort = event.target.value || "name"; render(); };
  document.querySelectorAll("[data-rebuild-work-memory-suggestions]").forEach(button => button.onclick = () => rebuildWorkMemorySuggestions());
  document.querySelectorAll("[data-dismiss-work-memory-merge-notice]").forEach(button => button.onclick = () => { setWorkMemoryMergeNotice(""); render(); });
  document.querySelectorAll("[data-start-work-memory-merge]").forEach(button => button.onclick = () => startWorkMemoryManualMerge(button.dataset.startWorkMemoryMerge));
  document.querySelectorAll("[data-toggle-work-memory-merge]").forEach(button => button.onclick = () => toggleWorkMemoryManualMerge(button.dataset.toggleWorkMemoryMerge));
  document.querySelectorAll("[data-next-work-memory-merge]").forEach(button => button.onclick = () => prepareWorkMemoryManualMerge());
  document.querySelectorAll("[data-cancel-work-memory-merge]").forEach(button => button.onclick = () => { resetWorkMemoryManualMerge(); render(); });
  document.querySelectorAll("[data-confirm-work-memory-merge]").forEach(button => button.onclick = async () => {
    const suggestion = workMemoryManualMergeSuggestion;
    if (!suggestion) return toast("找不到這次合併預覽");
    resetWorkMemoryManualMerge();
    await acceptWorkMemoryMergeSuggestion(suggestion);
  });
  const add = document.querySelector("[data-add-work-memory]");
  if (add) add.onclick = async () => {
    const name = prompt("想讓我記住哪一項工作？");
    const clean = String(name || "").trim();
    if (!clean) return;
    const similarity = confirmWorkMemorySimilarity(clean);
    if (similarity.action === "cancel") return;
    if (["existing", "merge"].includes(similarity.action)) {
      if (similarity.action === "merge") await rememberWorkMemoryAlias(similarity.match.name, clean, "手動新增");
      toast(similarity.action === "merge" ? `我已整理到既有工作「${similarity.match.name}」` : `「${similarity.match.name}」已經在我的工作中`);
      if (similarity.action !== "merge") render();
      return;
    }
    const next = [...workMemoryObjects(), normalizeWorkMemoryObject({ name: clean, category: workMemoryCategoryFor(clean), source: "manual", isActive: true })];
    bumpWorkMemoryMergeStat("added");
    await persistWorkMemory(next, "我已記住這項工作");
  };
  document.querySelectorAll("[data-edit-work-memory]").forEach(button => button.onclick = () => {
    editingWorkMemoryName = button.dataset.editWorkMemory || null;
    render();
  });
  document.querySelectorAll("[data-cancel-work-memory-edit]").forEach(button => button.onclick = () => {
    editingWorkMemoryName = null;
    render();
  });
  document.querySelectorAll("[data-save-work-memory-edit]").forEach(button => button.onclick = async () => {
    const originalName = button.dataset.saveWorkMemoryEdit || "";
    const name = String(document.getElementById("workMemoryEditName")?.value || "").trim();
    const description = String(document.getElementById("workMemoryEditDescription")?.value || "").trim();
    const category = String(document.getElementById("workMemoryEditCategory")?.value || "其他").trim();
    const enabled = document.getElementById("workMemoryEditEnabled")?.value !== "0";
    if (!name) return toast("請輸入工作名稱");
    const similarity = name === originalName ? { action: "create" } : confirmWorkMemorySimilarity(name, { excludeNames: [originalName] });
    if (similarity.action === "cancel") return;
    const targetName = ["existing", "merge"].includes(similarity.action) ? similarity.match.name : name;
    const objects = workMemoryObjects();
    const original = objects.find(model => model.name === originalName);
    const target = objects.find(model => model.name === targetName);
    const updated = normalizeWorkMemoryObject({
      ...(target || original || {}),
      name: targetName,
      description,
      category,
      isActive: enabled,
      aliases: similarity.action === "merge" ? [...new Set([...(target?.aliases || []), ...(original?.aliases || []), originalName, name].filter(alias => alias && alias !== targetName))] : (original?.aliases || []),
      updatedAt: new Date().toISOString()
    }, 0, target || original);
    const next = objects.filter(model => model.name !== originalName && model.name !== targetName).concat(updated);
    editingWorkMemoryName = null;
    await persistWorkMemory(next, similarity.action === "merge" ? "我已依照你的決定整理這項工作" : "工作內容已更新");
  });
  document.querySelectorAll("[data-delete-work-memory]").forEach(button => button.onclick = async () => {
    const originalName = button.dataset.deleteWorkMemory || "";
    if (!confirm(`確認刪除「${originalName}」？`)) return;
    const item = workMemoryObjectByName(originalName);
    if (!item) return toast("找不到這項工作，請重新整理後再試");
    editingWorkMemoryName = null;
    try {
      await DataService.deleteWorkModel(item);
      toast("已刪除這項工作");
      render();
    } catch (error) {
      toast(error.message || "刪除工作失敗");
    }
  });
  document.querySelectorAll("[data-work-memory-source-name]").forEach(button => button.onclick = () => {
    const sourceName = button.dataset.workMemorySourceName || "";
    const source = workMemorySourceLibraryItem(sourceName);
    if (!source) {
      alert(`我目前只能先告訴你這項工作的來源：\n\n${sourceName || "尚未連結來源文件"}`);
      return;
    }
    activeWorkspace = "library";
    if (!openTabs.includes("library")) openTabs.push("library");
    rememberWorkspace("library");
    viewingKnowledgeId = source.id || source.cloudId;
    view = "libraryIntelligence";
    saveAll();
    render();
  });
  document.querySelectorAll("[data-adopt-ai-suggestion]").forEach(button => button.onclick = async () => {
    await adoptAiSuggestion(aiSuggestions.find(item => item.key === button.dataset.adoptAiSuggestion));
  });
  document.querySelectorAll("[data-edit-ai-suggestion]").forEach(button => button.onclick = async () => {
    const item = aiSuggestions.find(suggestion => suggestion.key === button.dataset.editAiSuggestion);
    if (!item) return;
    const name = item.type === "rename"
      ? prompt("新的工作名稱", item.renameTo)
      : prompt("建議加入「我的工作」的名稱", item.type === "merge" ? item.mergeSuggestion?.keep : item.title);
    if (!String(name || "").trim() && item.type !== "category") return;
    const description = prompt("工作說明", item.content || item.reason || "") || "";
    const category = item.type === "category" || item.type === "candidate" ? (prompt("分類", item.categoryTo || workMemoryCategoryFor(name)) || "") : "";
    await adoptAiSuggestion(item, { name, description, category });
  });
  document.querySelectorAll("[data-merge-ai-suggestion]").forEach(button => button.onclick = async () => {
    const item = aiSuggestions.find(item => item.key === button.dataset.mergeAiSuggestion);
    if (item?.type === "rename") {
      const name = prompt("新的工作名稱", item.renameTo);
      if (String(name || "").trim()) await adoptAiSuggestion(item, { name });
      return;
    }
    if (item?.type === "category") {
      const category = prompt("新的分類", item.categoryTo);
      if (String(category || "").trim()) await adoptAiSuggestion(item, { category });
      return;
    }
    await mergeAiSuggestion(item);
  });
  document.querySelectorAll("[data-ignore-ai-suggestion]").forEach(button => button.onclick = () => {
    const item = aiSuggestions.find(suggestion => suggestion.key === button.dataset.ignoreAiSuggestion);
    if (!item) return;
    if (item.type === "merge" && item.mergeSuggestion) saveWorkMemoryMergeDecision(item.mergeSuggestion.a, item.mergeSuggestion.b, "ignored");
    saveWorkMemoryAiSuggestionDecision(item.key, "ignored", { type: item.type, title: item.title });
    bumpWorkMemoryMergeStat("ignored");
    toast("我先把這則建議收起來，不會一直提醒");
    render();
  });
}


function createEntry(input = {}) {
  const requestedDate = input.date || String(input.at || "").slice(0, 10) || key();
  const resolved = resolveWorklogTime({
    raw: input.raw || "",
    dateKey: requestedDate,
    hours: input.hours || 1,
    explicitAt: input.at || "",
    excludeId: input.id || null
  });
  const at = resolved.at;
  const date = String(at || requestedDate).slice(0, 10);
  const entryType = normalizeEntryType(input.entryType || input.type || "work");
  return {
    id: input.id || uid(),
    date,
    at,
    title: String(input.title || "").trim(),
    note: String(input.note || "").trim(),
    ecpTask: isLeaveType(entryType) ? "" : (input.ecpTask == null ? defaultEcpTaskName(input.title || "") : String(input.ecpTask || "").trim()),
    hours: Number(input.hours || 1),
    entryType,
    type: eventTypeLabel(entryType),
    source: input.source || "manual",
    status: input.status || "completed",
    cloudId: input.cloudId || undefined,
    taskUuid: input.taskUuid || input.task_uuid || "",
    taskTitleSnapshot: input.taskTitleSnapshot || input.task_title_snapshot || ""
  };
}

async function persistEntry(item, options = {}) {
  try {
    return await DataService.saveEntry(item);
  } catch (error) {
    if (options.requireCloud) throw error;
    toast("工時同步失敗，請稍後再試");
    return null;
  }
}

async function acceptSuggestion(id) {
  const s = makeSuggestions().find(x => x.id === id);
  if (!s) return;
  const defaultHours = 1;
  const resolved = resolveWorklogTime({ dateKey: key(), hours: defaultHours });
  const item = createEntry({
    date: resolved.dateKey,
    at: resolved.at,
    title: s.title,
    note: s.note,
    ecpTask: s.ecpTask,
    hours: defaultHours,
    source: "ai-card"
  });
  const requiresConfirmation = resolved.reason !== "earliest_gap"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(resolved.at || ""))
    || !Number.isFinite(defaultHours)
    || defaultHours <= 0
    || Number(s.confidence ?? 0.85) < 0.65
    || worklogTimeConflicts(item)
    || Boolean(validateEntry(item));
  if (!requiresConfirmation) {
    const saved = await persistEntry(item);
    if (!saved) return;
    recordSuggestionMetric(s.id, "added", saved);
    feedback[s.id] = (feedback[s.id] || 0) + 1;
    saveAll({ skipSync: true });
    view = "center";
    render();
    showCreatedWorklogToast(saved);
    return;
  }
  editingEntryId = null;
  captureSeed = { ...s, at: resolved.at, timeResolution: resolved.reason, source: "ai-card", suggestionId: s.id, confirmationOnly: true };
  activeWorkspace = "worklog";
  if (!openTabs.includes("worklog")) openTabs.push("worklog");
  rememberWorkspace("worklog");
  view = "capture";
  saveAll();
  render();
}

function adjustSuggestion(id) {
  const s = makeSuggestions().find(x => x.id === id);
  if (!s) return;
  const defaultHours = 1;
  const resolved = resolveWorklogTime({ dateKey: key(), hours: defaultHours });
  editingEntryId = null;
  captureSeed = { ...s, hours: defaultHours, at: resolved.at, timeResolution: resolved.reason, source: "ai-card", suggestionId: s.id, wasAdjusted: true };
  activeWorkspace = "worklog";
  if (!openTabs.includes("worklog")) openTabs.push("worklog");
  rememberWorkspace("worklog");
  view = "capture";
  saveAll();
  render();
}

function bindCapture(editId = null) {
  editId = editId || editingEntryId;
  const editingEntry = editId ? entries.find(e => e.id === editId) : null;
  const suggestionSeed = !editingEntry && captureSeed ? { ...captureSeed } : null;
  let selectedH = editingEntry ? Number(editingEntry.hours) : Number(suggestionSeed?.hours || 1);
  // A suggestion seed may already carry an automatically resolved time. Keep
  // it recalculable until the user edits the datetime field, so changing 1h
  // to 30m can stay in the current day's remaining tail.
  let automaticTime = !editingEntry && (!suggestionSeed?.at || suggestionSeed?.timeResolution === "earliest_gap" || suggestionSeed?.autoScheduled);
  document.querySelectorAll("[data-capture-back],[data-capture-cancel]").forEach(b => b.onclick = () => { view = "center"; editingEntryId = null; captureSeed = null; saveAll(); render(); });
  const titleInput = document.getElementById("title");
  const updateDescriptionCount = () => {
    const output = document.getElementById("titleCount");
    if (!output || !titleInput) return;
    const length = worklogDescriptionLength(titleInput.value);
    output.textContent = `${length}/${WORKLOG_DESCRIPTION_MAX_LENGTH}`;
    output.classList.toggle("is-limit", length >= WORKLOG_DESCRIPTION_MAX_LENGTH);
  };
  const bindDescriptionSuggestions = () => {
    document.querySelectorAll("[data-title-suggestion]").forEach(b => b.onclick = () => {
      titleInput.value = b.dataset.titleSuggestion;
      updateDescriptionCount();
    });
    document.querySelectorAll("[data-open-work-description-dialog]").forEach(b => b.onclick = () => {
      const dialog = document.getElementById("workDescriptionDialog");
      const input = document.getElementById("newWorkDescription");
      if (dialog) dialog.style.display = "grid";
      if (input) {
        input.value = "";
        setTimeout(() => input.focus(), 0);
      }
    });
    document.querySelectorAll("[data-cancel-work-description]").forEach(b => b.onclick = () => {
      const dialog = document.getElementById("workDescriptionDialog");
      const input = document.getElementById("newWorkDescription");
      if (input) input.value = "";
      if (dialog) dialog.style.display = "none";
    });
    document.querySelectorAll("[data-add-work-description]").forEach(b => b.onclick = async () => {
      const dialog = document.getElementById("workDescriptionDialog");
      const input = document.getElementById("newWorkDescription");
      const name = input?.value.trim() || "";
      if (!name) return toast("請輸入工作描述名稱");
      if (worklogDescriptionLength(name) > WORKLOG_DESCRIPTION_MAX_LENGTH) return toast(`工作描述不可超過 ${WORKLOG_DESCRIPTION_MAX_LENGTH} 個字元`);
      b.disabled = true;
      try {
        await saveWorkModel(name);
        titleInput.value = name;
        updateDescriptionCount();
        const box = document.getElementById("descriptionSuggestions");
        if (box) {
          box.outerHTML = descriptionSuggestionChips(titleInput.value);
          bindDescriptionSuggestions();
        }
        const nextDialog = document.getElementById("workDescriptionDialog");
        if (nextDialog) nextDialog.style.display = "none";
        if (dialog) dialog.style.display = "none";
        toast("已選取工作描述並同步");
      } catch (error) {
        console.error("Add work description failed", error);
        toast("工作描述同步失敗，請稍後再試");
      } finally {
        b.disabled = false;
      }
    });
    const input = document.getElementById("newWorkDescription");
    if (input) input.onkeydown = e => {
      if (e.key === "Enter") {
        e.preventDefault();
        document.querySelector("[data-add-work-description]")?.click();
      }
      if (e.key === "Escape") document.querySelector("[data-cancel-work-description]")?.click();
    };
  };
  bindDescriptionSuggestions();
  if (titleInput) titleInput.oninput = () => {
    updateDescriptionCount();
    const box = document.getElementById("descriptionSuggestions");
    if (box) {
      box.outerHTML = descriptionSuggestionChips(titleInput.value);
      bindDescriptionSuggestions();
    }
  };
  updateDescriptionCount();
  const ecpTaskSelect = document.getElementById("ecpTaskSelect");
  const quickAdd = document.getElementById("ecpTaskQuickAdd");
  if (ecpTaskSelect) ecpTaskSelect.onchange = () => {
    if (quickAdd) quickAdd.style.display = ecpTaskSelect.value === "__add__" ? "grid" : "none";
  };
  const addEcpTaskBtn = document.querySelector("[data-add-capture-ecp-task]");
  if (addEcpTaskBtn) addEcpTaskBtn.onclick = async () => {
    const input = document.getElementById("newEcpTaskCapture");
    const name = input.value.trim();
    if (!name) return toast("請輸入 ECP 任務名稱");
    const tasks = ecpTasks();
    setEcpTasks(tasks.includes(name) ? tasks : [...tasks, name]);
    saveAll();
    await DataService.saveEcpTasksOnly();
    ecpTaskSelect.innerHTML = ecpTaskOptions(name);
    ecpTaskSelect.value = name;
    input.value = "";
    if (quickAdd) quickAdd.style.display = "none";
    toast("已新增 ECP 任務");
  };
  const dateTimeInput = document.getElementById("dt");
  if (dateTimeInput) {
    dateTimeInput.oninput = () => { automaticTime = false; };
    dateTimeInput.onchange = () => { automaticTime = false; };
  }
  document.querySelectorAll(".hour").forEach(b => b.onclick = () => {
    selectedH = Number(b.dataset.h);
    document.querySelectorAll(".hour").forEach(x => x.classList.remove("selected"));
    b.classList.add("selected");
    if (automaticTime && dateTimeInput) {
      dateTimeInput.value = captureDefaultStart(selectedH);
    }
  });
  document.getElementById("saveEntry").onclick = async () => {
    const at = document.getElementById("dt").value;
    const description = document.getElementById("title").value.trim();
    const entryType = editingEntry ? normalizeEntryType(editingEntry.entryType || editingEntry.type || entryTypeFromDescription(description)) : entryTypeFromDescription(description);
    const selectedEcpTask = isLeaveType(entryType) ? "" : (document.getElementById("ecpTaskSelect").value === "__add__" ? "" : document.getElementById("ecpTaskSelect").value.trim());
    const linkedTaskUuid = editingEntry?.taskUuid || suggestionSeed?.taskUuid || "";
    const linkedTask = linkedTaskUuid ? tasks.find(task => task.id === linkedTaskUuid) : null;
    const item = createEntry({ id: editingEntry ? editingEntry.id : undefined, date: at.slice(0, 10), at, title: description, ecpTask: selectedEcpTask, hours: selectedH, entryType, note: document.getElementById("note").value.trim(), source: editingEntry ? editingEntry.source : (suggestionSeed?.source || "manual"), cloudId: editingEntry?.cloudId, taskUuid: linkedTaskUuid, taskTitleSnapshot: editingEntry?.taskTitleSnapshot || linkedTask?.title || "" });
    const error = validateEntry(item); if (error) return toast(error);
    if (monthKey(item.date) !== selectedMonth && !confirm(`此筆工時日期為 ${monthKey(item.date)}，目前畫面月份為 ${selectedMonth}。是否仍要儲存？`)) return;
    if (!confirmOvertimeEntry(item)) return;
    const saved = await persistEntry(item);
    if (!saved) return;
    if (suggestionSeed?.suggestionId) {
      if (suggestionSeed.wasAdjusted) recordSuggestionMetric(suggestionSeed.suggestionId, "edited", item);
      recordSuggestionMetric(suggestionSeed.suggestionId, "added", item);
      feedback[suggestionSeed.suggestionId] = (feedback[suggestionSeed.suggestionId] || 0) + 1;
    } else if (editingEntry?.source === "ai-card") {
      recordSuggestionMetric(editingEntry.title, "edited", item);
    }
    view = "center"; editingEntryId = null; captureSeed = null; toast("已儲存工時"); render();
  };
}

async function runLegacyKnowledgeMigrationPreview() {
  const legacy = legacyKnowledgeItems().map(normalizedLibraryItem);
  if (!legacy.length) return toast("沒有可搬移的舊版藏書資料");
  const message = `即將搬移舊版藏書資料：${legacy.length} 筆。\n\n注意：舊版資料通常只保留資料摘要 / 檔名，不一定有原始檔案。此次會先建立雲端知識資料；原始檔可後續編輯補上傳。\n\n舊版備份不會刪除。是否繼續？`;
  if (!confirm(message)) return;
  try {
    for (const item of legacy) {
      await DataService.saveKnowledgeSource({
        ...item,
        knowledgeId: "",
        sourceType: item.storagePath ? inferKnowledgeSourceType(item.storagePath) : "legacy_metadata",
        sourceName: item.filename || item.sourceName || item.title,
        processingStatus: "uploaded"
      }, { requireCloud: true });
    }
    localStorage.setItem(scopedLocalKey(LEGACY_KNOWLEDGE_MIGRATION_KEY), "1");
    toast("舊版藏書搬移完成");
    await DataService.loadAll();
    render();
  } catch (error) {
    console.error("Legacy knowledge migration failed", { error, supabase: error.supabase || null });
    toast(error.message || "舊版藏書搬移失敗，舊資料已保留");
  }
}

function bindLibrary() {
  document.querySelectorAll("[data-library-learning-back]").forEach(button => button.onclick = () => {
    if (["reading", "analyzing", "understanding", "organizing"].includes(knowledgeLearningStep)) {
      if (!confirm("文件仍在閱讀中，離開可能中斷處理，是否確定離開？")) return;
    }
    learningKnowledgeDraft = null;
    viewingKnowledgeId = null;
    knowledgeLearningError = "";
    view = "library";
    saveAll();
    render();
  });
  const search = document.querySelector("[data-library-search]");
  const renderKnowledgeSearch = () => {
    if (knowledgeLibrarySearchRenderTimer) clearTimeout(knowledgeLibrarySearchRenderTimer);
    knowledgeLibrarySearchRenderTimer = setTimeout(() => {
      knowledgeLibrarySearchRenderTimer = null;
      render();
      const next = document.querySelector("[data-library-search]");
      if (next) {
        next.focus();
        const caret = next.value.length;
        next.setSelectionRange(caret, caret);
      }
    }, 120);
  };
  if (search) {
    search.oncompositionstart = () => { knowledgeLibrarySearchComposing = true; };
    search.oncompositionend = event => {
      knowledgeLibrarySearchComposing = false;
      knowledgeLibraryQuery = event.target.value || "";
      renderKnowledgeSearch();
    };
    search.oninput = event => {
      knowledgeLibraryQuery = event.target.value || "";
      if (!knowledgeLibrarySearchComposing) renderKnowledgeSearch();
    };
  }
  const category = document.querySelector("[data-library-category]");
  if (category) category.onchange = event => { knowledgeLibraryCategory = event.target.value || "all"; render(); };
  const sort = document.querySelector("[data-library-sort]");
  if (sort) sort.onchange = event => { knowledgeLibrarySort = event.target.value || "updated_desc"; render(); };
  document.querySelectorAll("[data-library-back]").forEach(b => b.onclick = () => {
    editingLibraryId = null;
    viewingKnowledgeId = null;
    knowledgeDriveSelectionDraft = null;
    activeWorkspace = "library";
    view = "library";
    saveAll();
    render();
  });
  const add = document.querySelector("[data-add-library]"); if (add) add.onclick = () => { editingLibraryId = null; knowledgeDriveSelectionDraft = null; activeWorkspace = "library"; view = "libraryForm"; saveAll(); render(); };
  document.querySelectorAll("[data-edit-library]").forEach(b => b.onclick = () => { editingLibraryId = b.dataset.editLibrary; knowledgeDriveSelectionDraft = null; activeWorkspace = "library"; view = "libraryForm"; saveAll(); render(); });
  document.querySelectorAll("[data-view-knowledge-result]").forEach(b => b.onclick = () => { viewingKnowledgeId = b.dataset.viewKnowledgeResult; activeWorkspace = "library"; view = "libraryIntelligence"; saveAll(); render(); });
  document.querySelectorAll("[data-reprocess-library]").forEach(b => b.onclick = async () => {
    const item = library.find(x => x.id === b.dataset.reprocessLibrary);
    if (!item) return;
    learningKnowledgeDraft = item;
    viewingKnowledgeId = item.id;
    knowledgeLearningStep = "reading";
    knowledgeLearningError = "";
    view = "libraryLearning";
    render();
    try {
      knowledgeDebugLog("warn", "Knowledge Process Call Stack Debug", {
        functionName: "bindLibrary[data-reprocess-library].onclick",
        knowledgeId: item.knowledgeId,
        id: item.id,
        cloudId: item.cloudId,
        callStack: new Error("Knowledge reprocess button stack").stack
      });
      await KnowledgeIntelligence.processSource(item, {
        onProgress: step => { knowledgeLearningStep = step; render(); }
      });
      knowledgeLearningStep = "complete";
      viewingKnowledgeId = item.id;
      view = "libraryIntelligence";
      saveAll();
      render();
    } catch (error) {
      knowledgeLearningStep = "error";
      knowledgeLearningError = error.message || "重新學習失敗";
      console.error("Knowledge reprocess failed", { error, item });
      render();
    }
  });
  document.querySelectorAll("[data-refresh-library]").forEach(b => b.onclick = async () => {
    const item = library.find(x => x.id === b.dataset.refreshLibrary || x.cloudId === b.dataset.refreshLibrary);
    if (!item || !globalThis.KnowledgeIngestionAPI) return toast("Knowledge ingestion 尚未就緒");
    b.disabled = true;
    try {
      learningKnowledgeDraft = item;
      viewingKnowledgeId = item.id;
      knowledgeLearningStep = "reading";
      knowledgeLearningError = "";
      view = "libraryLearning";
      render();
      await KnowledgeIngestionAPI.refreshSource(item, {
        onProgress: step => { knowledgeLearningStep = step; render(); }
      });
      knowledgeLearningStep = "complete";
      learningKnowledgeDraft = null;
      view = "libraryIntelligence";
      toast("我已重新整理這份來源");
      render();
    } catch (error) {
      knowledgeLearningStep = "error";
      knowledgeLearningError = error.message || "重新整理失敗";
      learningKnowledgeDraft = item;
      console.error("Knowledge source refresh failed", { error, item });
      toast(error.message || "重新整理失敗");
      render();
    } finally {
      b.disabled = false;
    }
  });
  document.querySelectorAll("[data-rollback-library]").forEach(b => b.onclick = async () => {
    const item = library.find(x => x.id === b.dataset.rollbackLibrary || x.cloudId === b.dataset.rollbackLibrary);
    if (!item) return toast("找不到這份知識來源");
    const version = b.dataset.version || "";
    if (!confirm(`確認將「${item.title}」還原至 ${version}？`)) return;
    try {
      await DataService.rollbackKnowledgeVersion(item, version);
      viewingKnowledgeId = item.id || item.cloudId;
      toast(`已還原至 ${version}`);
      render();
    } catch (error) {
      console.error("Knowledge rollback failed", { error, item, version });
      toast(error.message || "版本還原失敗");
    }
  });
  document.querySelectorAll("[data-verify-library]").forEach(b => b.onclick = async () => {
    const item = library.find(x => x.id === b.dataset.verifyLibrary || x.cloudId === b.dataset.verifyLibrary);
    if (!item) return toast("找不到這份學習結果，請重新整理後再試");
    try {
      await KnowledgeIntelligence.verifySource(item);
      viewingKnowledgeId = null;
      activeWorkspace = "library";
      view = "library";
      saveAll();
      toast("我已記住：你的確認是正確的");
      render();
    } catch (error) {
      console.error("Knowledge verify failed", { error, item });
      toast(error.message || "確認理解失敗");
    }
  });
  document.querySelectorAll("[data-accept-all-knowledge-work],[data-accept-selected-knowledge-work]").forEach(b => b.onclick = async () => {
    const id = b.dataset.acceptAllKnowledgeWork || b.dataset.acceptSelectedKnowledgeWork;
    const selectedOnly = !!b.dataset.acceptSelectedKnowledgeWork;
    const item = library.find(x => x.id === id || x.cloudId === id);
    if (!item) return;
    const candidates = knowledgeCandidatesForSource(item);
    const selected = selectedOnly
      ? [...document.querySelectorAll(".knowledge-work-candidate:checked")].map(input => input.value.trim()).filter(Boolean)
      : candidates.map(candidate => String(candidate.title || "").trim()).filter(Boolean);
    const names = [...new Set(selected)];
    if (!names.length) return toast("請先選擇要加入「我的工作」的項目");
    try {
      const nextObjects = [...workMemoryObjects()];
      const nextModels = nextObjects.filter(model => model.isActive).map(model => model.name);
      for (const name of names) {
        const similarity = confirmWorkMemorySimilarity(name, { models: nextModels });
        if (similarity.action === "cancel") continue;
        if (["existing", "merge"].includes(similarity.action)) {
          if (similarity.action === "merge") {
            const targetIndex = nextObjects.findIndex(model => model.name === similarity.match.name);
            if (targetIndex >= 0) {
              const target = { ...nextObjects[targetIndex] };
              target.aliases = [...new Set([...target.aliases, name].filter(Boolean))];
              target.sourceReferences = [...target.sourceReferences, { type: "knowledge", label: item.title || "文件學習", knowledgeId: item.knowledgeId || "" }];
              nextObjects[targetIndex] = target;
            }
          }
          continue;
        }
        if (!nextModels.includes(name)) {
          const candidate = candidates.find(value => String(value.title || "").trim() === name);
          nextModels.push(name);
          nextObjects.push(normalizeWorkMemoryObject({
            name,
            description: candidate?.content || candidate?.summary || "",
            category: workMemoryCategoryFor(name),
            source: "knowledge",
            sourceReferences: [{ type: "knowledge", label: item.title || item.filename || "藏書閣", knowledgeId: item.knowledgeId || "", sourceId: item.cloudId || item.id || "" }],
            keywords: arrayFromInput(candidate?.triggers || []),
            isActive: true,
            familiarity: 1
          }));
        }
      }
      setWorkModels(nextObjects);
      saveAll({ skipSync: true });
      await DataService.saveWorkModelsOnly();
      await KnowledgeIntelligence.verifySource(item).catch(error => console.warn("Knowledge verify after Work Memory accept failed", { error, item }));
      toast(`我已把 ${names.length} 項工作加入「我的工作」`);
      activeWorkspace = "settings";
      if (!openTabs.includes("settings")) openTabs.push("settings");
      rememberWorkspace("settings");
      view = "center";
      render();
    } catch (error) {
      console.error("Accept knowledge work into Work Memory failed", { error, item, names });
      toast(error.message || "加入我的工作失敗，請稍後再試");
    }
  });
  document.querySelectorAll("[data-remove-knowledge-unit]").forEach(b => b.onclick = async () => {
    if (!confirm("確認移除此工作知識？")) return;
    await DataService.removeKnowledgeUnit(b.dataset.removeKnowledgeUnit);
    toast("已移除工作知識");
    render();
  });
  document.querySelectorAll("[data-remove-knowledge-candidate]").forEach(b => b.onclick = async () => {
    if (!confirm("確認移除此建議工作候選？")) return;
    await DataService.removeKnowledgeRecommendationCandidate(b.dataset.removeKnowledgeCandidate);
    toast("已移除建議工作候選");
    render();
  });
  document.querySelectorAll("[data-preview-library],[data-download-library]").forEach(b => b.onclick = async () => {
    const id = b.dataset.previewLibrary || b.dataset.downloadLibrary;
    const item = normalizedLibraryItem(library.find(x => x.id === id));
    if (!item.storagePath) return toast("此知識來源尚無正式檔案");
    try {
      const url = await KnowledgeRepository.signedSourceUrl(item.storagePath, 300);
      window.open(url, "_blank", "noopener");
    } catch (error) {
      console.error("Knowledge file preview failed", { error, supabase: error.supabase || null, item });
      toast("原始檔預覽失敗，請確認 Storage 已初始化");
    }
  });
  document.querySelectorAll("[data-archive-library]").forEach(b => b.onclick = async () => {
    const item = library.find(x => x.id === b.dataset.archiveLibrary);
    if (!item) return;
    const archived = await DataService.saveKnowledgeSource({ ...normalizedLibraryItem(item), processingStatus: "archived" });
    if (!archived) return toast("封存同步失敗");
    toast("已封存知識來源");
    render();
  });
  document.querySelectorAll("[data-del-library]").forEach(b => b.onclick = async () => {
    const item = library.find(x => x.id === b.dataset.delLibrary);
    if (!item) return;
    if (!confirm("確認刪除此知識來源？本階段會先保留原始檔作稽核。")) return;
    const deleted = await DataService.deleteKnowledgeSource(item);
    if (!deleted) return toast("知識刪除同步失敗，請稍後再試");
    saveAll();
    toast("已刪除知識");
    render();
  });
  const legacy = document.querySelector("[data-preview-legacy-knowledge]");
  if (legacy) legacy.onclick = () => runLegacyKnowledgeMigrationPreview();
}

function bindLibraryForm(id = null) {
  document.querySelectorAll("[data-library-back],[data-library-cancel]").forEach(b => b.onclick = () => { editingLibraryId = null; viewingKnowledgeId = null; knowledgeDriveSelectionDraft = null; view = "library"; saveAll(); render(); });
  document.querySelectorAll("[data-select-drive]").forEach(button => button.onclick = async () => {
    if (!globalThis.KnowledgeIngestionAPI) return toast("Google Drive ingestion 尚未就緒");
    button.disabled = true;
    try {
      const selectedDriveFile = await KnowledgeIngestionAPI.selectDriveFile();
      if (!selectedDriveFile) return;
      knowledgeDriveSelectionDraft = selectedDriveFile;
      const title = document.getElementById("libTitle");
      if (title && !title.value.trim()) title.value = selectedDriveFile.name || "";
      const status = document.getElementById("driveSelectionStatus");
      if (status) status.textContent = `已選取：${selectedDriveFile.name || selectedDriveFile.id}`;
      toast("已選取 Google Drive 文件");
    } catch (error) {
      console.error("Google Drive Picker failed", { error });
      toast(error.message || "Google Drive 選取失敗");
    } finally {
      button.disabled = false;
    }
  });
  document.getElementById("saveLibrary").onclick = async () => {
    const existing = id ? normalizedLibraryItem(library.find(x => x.id === id)) : {};
    const file = document.getElementById("libFile")?.files?.[0] || null;
    const driveFile = knowledgeDriveSelectionDraft;
    const fileName = file?.name || driveFile?.name || existing.filename || "";
    const titleValue = document.getElementById("libTitle")?.value.trim() || "";
    const descriptionValue = document.getElementById("libDesc")?.value.trim() || "";
    const textSeed = `${titleValue} ${descriptionValue} ${fileName}`;
    const defaultRole = profile?.role ? roleCode(profile.role) : "PROCUREMENT";
    const inferredTags = arrayFromInput(textSeed.replace(/\.[^.]+$/, "").replace(/[()（）]/g, "、")).slice(0, 8);
    const valueOf = (id, fallback = "") => document.getElementById(id)?.value?.trim() || fallback;
    const checkedValues = name => [...document.querySelectorAll(`input[name=${name}]:checked`)].map(x => x.value);
    const item = normalizedLibraryItem({
      ...existing,
      id: id || existing.id || uid("kb"),
      knowledgeId: existing.knowledgeId || "",
      title: titleValue,
      description: descriptionValue,
      category: valueOf("libCategory", existing.category || (/SOP|流程|提醒|事項/i.test(textSeed) ? "SOP" : "其他")),
      scope: valueOf("libScope", existing.scope || "personal"),
      applicableAgents: checkedValues("libAgents").length ? checkedValues("libAgents") : (existing.applicableAgents || [`${roleDisplayName(defaultRole)} Agent`]),
      relatedRoles: checkedValues("libRoles").length ? checkedValues("libRoles") : (existing.relatedRoles || [defaultRole]),
      relatedWorkModels: checkedValues("libWorkModels").length ? checkedValues("libWorkModels") : (existing.relatedWorkModels || []),
      tags: document.getElementById("libTags") ? arrayFromInput(document.getElementById("libTags").value) : (existing.tags?.length ? existing.tags : inferredTags),
      triggers: document.getElementById("libTriggers") ? arrayFromInput(document.getElementById("libTriggers").value) : (existing.triggers?.length ? existing.triggers : inferredTags.slice(0, 6)),
      processingStatus: existing.processingStatus || "uploaded",
      version: valueOf("libVersion", existing.version || "v1.0"),
      sourceVersion: valueOf("libSourceVersion", existing.sourceVersion || existing.version || "v1.0"),
      sourceProvider: driveFile ? "google_drive" : (existing.sourceProvider || "upload"),
      externalFileId: driveFile?.id || existing.externalFileId || "",
      sourceModifiedAt: driveFile?.modifiedTime || existing.sourceModifiedAt || "",
      sourceMetadata: driveFile ? { parents: driveFile.parents || [], driveId: driveFile.driveId || "", md5Checksum: driveFile.md5Checksum || "", webViewLink: driveFile.webViewLink || "" } : (existing.sourceMetadata || {}),
      sourceUrl: driveFile?.webViewLink || existing.sourceUrl || "",
      filename: fileName,
      storagePath: existing.storagePath || "",
      sourceType: driveFile ? (driveFile.mimeType === "application/pdf" ? "pdf" : inferKnowledgeSourceType(fileName)) : inferKnowledgeSourceType(fileName || existing.sourceName || existing.sourceUrl),
      sourceName: fileName || existing.sourceName || "",
      mimeType: file?.type || existing.mimeType || "",
      fileSize: file?.size || existing.fileSize || 0,
      createdAt: existing.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    if (!item.title) return toast("請輸入 知識標題");
    if (!id && !file && !driveFile) return toast("請上傳檔案或從 Google Drive 選取文件");
    let saved = null;
    try {
      if (!id && globalThis.KnowledgeIngestionAPI) {
        const onSourceSaved = async source => {
          learningKnowledgeDraft = source;
          knowledgeLearningStep = "reading";
          knowledgeLearningError = "";
          viewingKnowledgeId = source.id;
          editingLibraryId = null;
          activeWorkspace = "library";
          view = "libraryLearning";
          knowledgeDriveSelectionDraft = null;
          saveAll();
          render();
        };
        const onProgress = step => { knowledgeLearningStep = step; render(); };
        const result = driveFile
          ? await KnowledgeIngestionAPI.addDriveFile({ file: driveFile, onSourceSaved, onProgress })
          : await KnowledgeIngestionAPI.addUpload({ file, title: titleValue, description: descriptionValue, onSourceSaved, onProgress });
        saved = result?.source || result;
        learningKnowledgeDraft = null;
        viewingKnowledgeId = saved?.id || saved?.cloudId || viewingKnowledgeId;
        editingLibraryId = null;
        view = "libraryIntelligence";
        saveAll();
        render();
        return;
      }
      saved = await DataService.saveKnowledgeSource(item, { file, requireCloud: true });
      if (file) {
        learningKnowledgeDraft = saved;
        knowledgeLearningStep = "reading";
        knowledgeLearningError = "";
        viewingKnowledgeId = saved.id;
        editingLibraryId = null;
        activeWorkspace = "library";
        view = "libraryLearning";
        saveAll();
        render();
        await KnowledgeIntelligence.processSource(saved, { file, onProgress: step => { knowledgeLearningStep = step; render(); } });
        knowledgeLearningStep = "complete";
        learningKnowledgeDraft = null;
        viewingKnowledgeId = saved.id;
        editingLibraryId = null; view = "libraryIntelligence"; saveAll(); render();
      } else {
        editingLibraryId = null; view = "library"; saveAll(); toast("知識來源已儲存"); render();
      }
    } catch (error) {
      console.error("Knowledge Source save failed", { error, supabase: error.supabase || null });
      learningKnowledgeDraft = null;
      knowledgeLearningStep = "error";
      knowledgeLearningError = error.message || "Mr. KM 學習失敗";
      if (saved?.id) {
        viewingKnowledgeId = saved.id;
        view = "libraryIntelligence";
        saveAll();
        render();
      }
      toast(error.message || "Mr. KM 學習失敗，請稍後再試");
    }
  };
}

function bindSettings() {
  const queueSettingsAutoSave = scopes => DataService.queueAutoSave(scopes);
  const renderModelChecks = (models, selectedModels = models) => {
    const list = document.getElementById("workModelList");
    if (list) list.innerHTML = workModelChecks(models, selectedModels);
    bindWorkModelOptions();
  };
  const currentSelectedWorkModels = () => [...document.querySelectorAll(".work-model-option:checked")].map(x => x.value.trim()).filter(Boolean);
  const syncSelectedWorkModels = () => {
    const selected = new Set(currentSelectedWorkModels());
    const objects = workMemoryObjects().map(item => ({ ...item, isActive: selected.has(item.name) }));
    for (const name of selected) if (!objects.some(item => item.name === name)) objects.push(normalizeWorkMemoryObject({ name, category: workMemoryCategoryFor(name), source: "manual", isActive: true }));
    setWorkModels(objects);
    queueSettingsAutoSave("workModels");
  };
  const bindWorkModelOptions = () => {
    document.querySelectorAll(".work-model-option").forEach(input => input.onchange = () => syncSelectedWorkModels());
  };
  const renderEcpTasks = tasks => {
    const list = document.getElementById("ecpTaskList");
    if (list) {
      list.outerHTML = ecpTaskList(tasks);
      bindEcpTaskRemove();
    }
  };
  const currentEcpTasks = () => [...document.querySelectorAll("#ecpTaskList .ecp-task-item span")].map(x => x.textContent.trim()).filter(Boolean);
  const bindEcpTaskRemove = () => {
    document.querySelectorAll("[data-remove-ecp-task]").forEach(b => b.onclick = () => {
      const next = currentEcpTasks().filter(task => task !== b.dataset.removeEcpTask);
      renderEcpTasks(next);
      setEcpTasks(next);
      workProfile = normalizeWorkProfile({ ...(workProfile || {}), defaultTask: next[0] || "" }, profile);
      queueSettingsAutoSave(["profile", "ecpTasks"]);
    });
  };
  bindEcpTaskRemove();
  const roleSet = document.getElementById("roleSet");
  bindWorkModelOptions();
  if (roleSet) roleSet.onchange = e => {
    profile.role = e.target.value;
    const existing = workMemoryObjects();
    const models = existing.length ? existing : tagsForRole(e.target.value).map(name => normalizeWorkMemoryObject({ name, category: workMemoryCategoryFor(name), source: "manual", isActive: true }));
    setWorkModels(models);
    renderModelChecks(workModels(), workModels());
    queueSettingsAutoSave(["profile", "workModels"]);
    render();
  };
  const add = document.getElementById("addWorkModel");
  if (add) add.onclick = () => {
    const input = document.getElementById("newWorkModel");
    const name = input.value.trim();
    if (!name) return toast("請輸入我的工作名稱");
    const current = [...document.querySelectorAll(".work-model-option")].map(x => x.value);
    const selected = [...document.querySelectorAll(".work-model-option:checked")].map(x => x.value);
    const models = current.includes(name) ? current : [...current, name];
    renderModelChecks(models, [...new Set([...selected, name])]);
    syncSelectedWorkModels();
    input.value = "";
    toast("已新增到我的工作，將自動同步");
  };
  const addEcp = document.getElementById("addEcpTask");
  if (addEcp) addEcp.onclick = () => {
    const input = document.getElementById("newEcpTask");
    const name = input.value.trim();
    if (!name) return toast("請輸入 ECP 任務名稱");
    const tasks = currentEcpTasks();
    const nextTasks = tasks.includes(name) ? tasks : [...tasks, name];
    renderEcpTasks(nextTasks);
    setEcpTasks(nextTasks);
    workProfile = normalizeWorkProfile({ ...(workProfile || {}), defaultTask: name, taskEffectiveMonth: monthKey(), taskVerifiedAt: new Date().toISOString() }, profile);
    queueSettingsAutoSave(["profile", "ecpTasks"]);
    input.value = "";
    toast("已新增 ECP 任務，將自動同步");
  };
  const ecpOwner = document.getElementById("ecpOwner");
  const ecpDepartment = document.getElementById("ecpDepartment");
  [ecpOwner, ecpDepartment].filter(Boolean).forEach(input => input.oninput = () => {
    profile.ecpOwner = ecpOwner?.value.trim() || "";
    profile.ecpDepartment = ecpDepartment?.value.trim() || "";
    workProfile = normalizeWorkProfile({ ...(workProfile || {}), ecpResponsiblePerson: profile.ecpOwner, ecpDepartment: profile.ecpDepartment }, profile);
    queueSettingsAutoSave("profile");
  });
  document.getElementById("resetProfile").onclick = () => { profile = null; saveAll(); render(); };
  document.getElementById("logoutBtn").onclick = () => doLogout();
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u16(view, offset) { return view.getUint16(offset, true); }
function u32(view, offset) { return view.getUint32(offset, true); }
function setU16(view, offset, value) { view.setUint16(offset, value, true); }
function setU32(view, offset, value) { view.setUint32(offset, value, true); }

function parseZip(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (u32(view, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("找不到 XLSX ZIP 結尾資料");
  const total = u16(view, eocd + 10);
  let ptr = u32(view, eocd + 16);
  const decoder = new TextDecoder();
  const entries = [];
  for (let i = 0; i < total; i++) {
    if (u32(view, ptr) !== 0x02014b50) throw new Error("XLSX ZIP 中央目錄格式錯誤");
    const method = u16(view, ptr + 10);
    const compressedSize = u32(view, ptr + 20);
    const uncompressedSize = u32(view, ptr + 24);
    const nameLen = u16(view, ptr + 28);
    const extraLen = u16(view, ptr + 30);
    const commentLen = u16(view, ptr + 32);
    const localOffset = u32(view, ptr + 42);
    const name = decoder.decode(bytes.slice(ptr + 46, ptr + 46 + nameLen));
    if (u32(view, localOffset) !== 0x04034b50) throw new Error(`XLSX ZIP local header 錯誤：${name}`);
    const localNameLen = u16(view, localOffset + 26);
    const localExtraLen = u16(view, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    if (method !== 0) throw new Error(`Template 必須使用未壓縮 ZIP entry：${name}`);
    const data = bytes.slice(dataStart, dataStart + compressedSize);
    if (data.length !== uncompressedSize) throw new Error(`Template entry 長度不一致：${name}`);
    entries.push({ name, data });
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function writeZip(entries) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const data = entry.data instanceof Uint8Array ? entry.data : encoder.encode(String(entry.data));
    const crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    setU32(localView, 0, 0x04034b50);
    setU16(localView, 4, 20);
    setU16(localView, 6, 0x0800);
    setU16(localView, 8, 0);
    setU32(localView, 14, crc);
    setU32(localView, 18, data.length);
    setU32(localView, 22, data.length);
    setU16(localView, 26, nameBytes.length);
    local.set(nameBytes, 30);
    localParts.push(local, data);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    setU32(centralView, 0, 0x02014b50);
    setU16(centralView, 4, 20);
    setU16(centralView, 6, 20);
    setU16(centralView, 8, 0x0800);
    setU16(centralView, 10, 0);
    setU32(centralView, 16, crc);
    setU32(centralView, 20, data.length);
    setU32(centralView, 24, data.length);
    setU16(centralView, 28, nameBytes.length);
    setU32(centralView, 42, offset);
    central.set(nameBytes, 46);
    centralParts.push(central);
    offset += local.length + data.length;
  }
  const centralOffset = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  setU32(eocdView, 0, 0x06054b50);
  setU16(eocdView, 8, entries.length);
  setU16(eocdView, 10, entries.length);
  setU32(eocdView, 12, centralSize);
  setU32(eocdView, 16, centralOffset);
  return new Blob([...localParts, ...centralParts, eocd], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

async function fetchResource(path) {
  const candidates = [path, `../${path}`, `../../${path}`, `/${path}`];
  for (const url of candidates) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
    } catch {}
  }
  throw new Error(`找不到資源：${path}`);
}

async function loadExportProfile(path) {
  const res = await fetchResource(path);
  return res.json();
}

async function loadTemplateEntries(path) {
  const res = await fetchResource(path);
  return parseZip(await res.arrayBuffer());
}

function findZipEntry(entries, name) {
  const entry = entries.find(e => e.name === name);
  if (!entry) throw new Error(`Template 缺少檔案：${name}`);
  return entry;
}

function xmlText(entries, name) {
  return new TextDecoder().decode(findZipEntry(entries, name).data);
}

function updateZipText(entries, name, text) {
  findZipEntry(entries, name).data = new TextEncoder().encode(text);
}

function parseXml(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Template XML 解析失敗");
  return doc;
}

function spreadsheetNs(doc, tag) {
  return doc.createElementNS("http://schemas.openxmlformats.org/spreadsheetml/2006/main", tag);
}

function columnName(index) {
  let name = "";
  while (index > 0) {
    const mod = (index - 1) % 26;
    name = String.fromCharCode(65 + mod) + name;
    index = Math.floor((index - mod) / 26);
  }
  return name;
}

function columnIndexFromRef(ref) {
  return ref.replace(/[0-9]/g, "").split("").reduce((sum, ch) => sum * 26 + ch.charCodeAt(0) - 64, 0);
}

function cellText(cell) {
  const inlineText = cell.getElementsByTagNameNS("http://schemas.openxmlformats.org/spreadsheetml/2006/main", "t")[0];
  const v = cell.getElementsByTagNameNS("http://schemas.openxmlformats.org/spreadsheetml/2006/main", "v")[0];
  return (inlineText?.textContent ?? v?.textContent ?? "").trim();
}

function resolveSheetPath(entries, sheetName) {
  const workbook = parseXml(xmlText(entries, "xl/workbook.xml"));
  const sheets = [...workbook.getElementsByTagNameNS("http://schemas.openxmlformats.org/spreadsheetml/2006/main", "sheet")];
  const sheet = sheets.find(s => s.getAttribute("name") === sheetName);
  if (!sheet) throw new Error(`Template 找不到 Sheet：${sheetName}`);
  const relId = sheet.getAttribute("r:id") || sheet.getAttribute("id");
  const rels = parseXml(xmlText(entries, "xl/_rels/workbook.xml.rels"));
  const relationships = [...rels.getElementsByTagName("Relationship")];
  const rel = relationships.find(r => r.getAttribute("Id") === relId);
  if (!rel) throw new Error(`Template 找不到 Sheet 關聯：${sheetName}`);
  return `xl/${rel.getAttribute("Target").replace(new RegExp("^/"), "")}`.replace("xl/xl/", "xl/");
}

function buildHeaderMap(sheetDoc, headerRow) {
  const rows = [...sheetDoc.getElementsByTagNameNS("http://schemas.openxmlformats.org/spreadsheetml/2006/main", "row")];
  const row = rows.find(r => Number(r.getAttribute("r")) === headerRow);
  if (!row) throw new Error(`Template 找不到 Header Row：${headerRow}`);
  const map = {};
  [...row.getElementsByTagNameNS("http://schemas.openxmlformats.org/spreadsheetml/2006/main", "c")].forEach(cell => {
    const header = cellText(cell);
    if (header) map[header] = columnIndexFromRef(cell.getAttribute("r"));
  });
  return map;
}

function makeInlineStringCell(doc, ref, value) {
  const cell = spreadsheetNs(doc, "c");
  cell.setAttribute("r", ref);
  cell.setAttribute("t", "inlineStr");
  if (value !== "") {
    const is = spreadsheetNs(doc, "is");
    const t = spreadsheetNs(doc, "t");
    t.textContent = String(value);
    is.appendChild(t);
    cell.appendChild(is);
  }
  return cell;
}

function makeNumberCell(doc, ref, value) {
  const cell = spreadsheetNs(doc, "c");
  cell.setAttribute("r", ref);
  cell.setAttribute("t", "n");
  const v = spreadsheetNs(doc, "v");
  v.textContent = String(Number(value || 0));
  cell.appendChild(v);
  return cell;
}

function exportFieldValue(rule, row) {
  if (!rule || rule.type === "blank") return "";
  if (rule.type === "literal") return rule.value || "";
  if (rule.type === "field") return row[rule.field] ?? "";
  return "";
}

function clearDataRows(sheetDoc, dataStartRow) {
  const sheetData = sheetDoc.getElementsByTagNameNS("http://schemas.openxmlformats.org/spreadsheetml/2006/main", "sheetData")[0];
  [...sheetData.getElementsByTagNameNS("http://schemas.openxmlformats.org/spreadsheetml/2006/main", "row")]
    .filter(row => Number(row.getAttribute("r")) >= dataStartRow)
    .forEach(row => sheetData.removeChild(row));
  return sheetData;
}

function writeRowsByHeaderName(sheetDoc, profile, rows) {
  const headerMap = buildHeaderMap(sheetDoc, profile.headerRow);
  const missing = Object.keys(profile.fieldMapping).filter(header => !(header in headerMap));
  if (missing.length) throw new Error(`Template 缺少欄位：${missing.join("、")}`);
  const sheetData = clearDataRows(sheetDoc, profile.dataStartRow);
  rows.forEach((data, i) => {
    const rowNumber = profile.dataStartRow + i;
    const row = spreadsheetNs(sheetDoc, "row");
    row.setAttribute("r", rowNumber);
    Object.entries(profile.fieldMapping).forEach(([header, rule]) => {
      const col = headerMap[header];
      const ref = `${columnName(col)}${rowNumber}`;
      const value = exportFieldValue(rule, data);
      row.appendChild(header === "時數" ? makeNumberCell(sheetDoc, ref, value) : makeInlineStringCell(sheetDoc, ref, value));
    });
    sheetData.appendChild(row);
  });
  const dimension = sheetDoc.getElementsByTagNameNS("http://schemas.openxmlformats.org/spreadsheetml/2006/main", "dimension")[0];
  if (dimension) {
    const maxCol = Math.max(...Object.values(headerMap));
    const lastRow = Math.max(profile.headerRow, profile.dataStartRow + rows.length - 1);
    dimension.setAttribute("ref", `A1:${columnName(maxCol)}${lastRow}`);
  }
}

function formatEcpDateTime(value) {
  const p = taipeiDateTimeParts(value);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

function addHoursToDate(value, h) {
  const d = safeDate(value);
  d.setMinutes(d.getMinutes() + Math.round(Number(h || 0) * 60));
  return d;
}

function workLogRowsForEcp() {
  return monthEntries().map(entry => ({
    title: entry.title || "",
    ecpTask: entry.ecpTask || "",
    startAt: formatEcpDateTime(entry.at),
    endAt: formatEcpDateTime(addHoursToDate(entry.at, entry.hours)),
    hours: Number(entry.hours || 0),
    ecpOwner: profile?.ecpOwner || "",
    ecpDepartment: profile?.ecpDepartment || ""
  }));
}

function profileFileName(profileConfig, month = selectedMonth) {
  return profileConfig.filename.replace("{YYYYMM}", monthKey(month).replace("-", ""));
}

async function exportByProfile(rows, profileConfig, month = selectedMonth) {
  const entries = await loadTemplateEntries(profileConfig.template);
  const sheetPath = resolveSheetPath(entries, profileConfig.sheet);
  const sheetDoc = parseXml(xmlText(entries, sheetPath));
  writeRowsByHeaderName(sheetDoc, profileConfig, rows);
  updateZipText(entries, sheetPath, new XMLSerializer().serializeToString(sheetDoc));
  const blob = writeZip(entries);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = profileFileName(profileConfig, month);
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function exportEcpImportFile() {
  try {
    const missing = workProfileMissingFields(workProfile);
    if (missing.length) return toast(`尚未完成工作身分。還缺少：${missing.join("、")}。完成後即可匯出 ECP。`);
    const rows = workLogRowsForEcp();
    if (!rows.length) return toast("本月份尚無工時資料可匯出。");
    const profileConfig = await loadExportProfile(ECP_EXPORT_PROFILE_PATH);
    await exportByProfile(rows, profileConfig, selectedMonth);
    toast("已下載 ECP 匯入檔");
  } catch (error) {
    console.error(error);
    toast(`ECP 匯出失敗：${error.message || "請稍後再試"}`);
  }
}

async function boot() {
  try {
    const googleAuth = await getGoogleAuthUser();
    if (googleAuth) {
      session = googleSessionFromUser(googleAuth.user, googleAuth.authSession);
      loadTasksForSession();
      if (authCallbackCaptured) { activeModule = "dashboard"; activeWorkspace = "dashboard"; openTabs = []; recentWorkspaces = []; view = "center"; hasOsShellState = true; }
      saveAll();
      await DataService.init();
      if (typeof RealtimeService !== "undefined") await RealtimeService.start();
    } else if (hasGoogleOAuthSession()) {
      loadTasksForSession();
      await DataService.init();
      if (typeof RealtimeService !== "undefined") await RealtimeService.start();
    }
  } catch {
    clearStoredAuthSession();
    if (session?.provider === "google-oauth") {
      session = null;
      saveAll();
    }
  }
  render();
}

boot();

window.addEventListener("focus", () => refreshConversationFromCloud(true));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refreshConversationFromCloud(true);
});
window.addEventListener("popstate", () => {
  if (!hasGoogleOAuthSession()) return;
  clearStoredOAuthError();
  refreshAuthenticatedSurface("browser-back");
});
window.addEventListener("pageshow", event => {
  if (event.persisted && hasGoogleOAuthSession()) {
    clearStoredOAuthError();
    refreshAuthenticatedSurface("browser-pageshow");
  }
  refreshConversationFromCloud(true);
});

lastSuggestionBatchSize = suggestionBatchSize();
window.addEventListener("resize", () => {
  clearTimeout(suggestionBatchResizeTimer);
  suggestionBatchResizeTimer = setTimeout(() => {
    const nextSize = suggestionBatchSize();
    if (nextSize === lastSuggestionBatchSize) return;
    lastSuggestionBatchSize = nextSize;
    renderSuggestionBatchOnly();
  }, 120);
});

window.addEventListener("beforeunload", event => {
  if (autoSaveInFlight || autoSaveDirtyScopes.size || cloudSync.status === "syncing" || cloudSync.status === "pending") {
    event.preventDefault();
    event.returnValue = "資料仍在同步中，請稍候...";
    return event.returnValue;
  }
});
