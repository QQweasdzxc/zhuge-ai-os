// P5.2A-1 Foundation Split: shared runtime state.
// TASK-001: run only the versioned, prefix-scoped browser cache migration
// before any module reads its state.  Supabase remains the business-data SSOT.
try {
  if (globalThis.ZhugeStorageMigration) {
    globalThis.ZhugeStorageMigration.run({
      versionKey: "zhuge_storage_schema_version",
      targetVersion: globalThis.ZhugeStorageMigration.STORAGE_SCHEMA_VERSION,
      allowedPrefixes: ["zhuge_", "wl_", "ai_os_"],
      migrations: {}
    });
  }
} catch (error) {
  console.warn("Storage migration deferred; cloud data is unaffected.", error?.message || error);
}
let activeModule = localStorage.getItem(ACTIVE_MODULE_KEY) || "dashboard";
let authCallbackCaptured = false;
let view = localStorage.getItem("wl_view") || "center";
if (view === "warroom") view = "library";
if (view === "capture") view = "center";
let hasOsShellState = localStorage.getItem(OS_OPEN_TABS_KEY) !== null;
let openTabs = readJson(OS_OPEN_TABS_KEY, []);
let activeWorkspace = localStorage.getItem(OS_ACTIVE_WORKSPACE_KEY) || "dashboard";
let recentWorkspaces = readJson(OS_RECENT_WORKSPACES_KEY, []);
let selected = new Date();
let selectedMonth = monthKey(selected);
let entries = [];
let tasks = [];
let editingTaskId = null;
let taskFilter = "open";
let taskSearch = "";
let taskSearchComposing = false;
let taskCompletionDialogId = null;
let taskDrawerOpen = false;
let taskDraft = null;
// Sprint 7.2: Work Journal is an independent cloud-backed 1:N domain.
let workJournalEntries = [];
let taskJournalTaskId = null;
let taskJournalDraft = null;
let taskJournalEditingEntryId = null;
let taskJournalLoading = false;
let profile = readJson("wl_profile", null);
let workProfile = readJson("wl_work_profile", null);
let feedback = readJson("wl_feedback", {});
let session = readJson(AI_OS_SESSION_KEY, null);
let library = [];
let knowledgeUnits = [];
let knowledgeRecommendationCandidates = [];
let viewingKnowledgeId = null;
let editingLibraryId = null;
let editingWorkMemoryName = null;
let workMemoryFoundationNotInitialized = false;
let learningKnowledgeDraft = null;
let knowledgeDriveSelectionDraft = null;
let knowledgeLibraryQuery = "";
let knowledgeLibrarySort = "updated_desc";
let knowledgeLibraryCategory = "all";
let knowledgeLibrarySearchComposing = false;
let knowledgeLibrarySearchRenderTimer = null;
let knowledgeLearningStep = "idle";
let knowledgeLearningError = "";
let workMemoryQuery = "";
let workMemoryCategoryFilter = "all";
let workMemorySort = "name";
let workMemoryMergeMode = false;
let workMemoryMergeSelection = [];
let workMemoryManualMergeSuggestion = null;
const WORK_MEMORY_MERGE_NOTICE_SESSION_KEY = "zhuge_work_memory_merge_notice_session_v1";
let workMemoryMergeCompletedNotice = (() => {
  try { return sessionStorage.getItem(WORK_MEMORY_MERGE_NOTICE_SESSION_KEY) || ""; }
  catch { return ""; }
})();
let workMemorySuggestionItemsCache = null;
let workMemorySuggestionRebuildInProgress = false;
let workMemorySearchComposing = false;
let workMemorySearchRenderTimer = null;
let editingEntryId = null;
let captureSeed = null;
let sidebarOpen = false;
let mobileCalendarOpen = false;
let mobileWorklogTab = "time";
let aiTodaySuggestionIndex = Number(localStorage.getItem(AI_TODAY_SUGGESTION_INDEX_KEY) || 0);
let suggestionBatchResizeTimer = null;
let lastSuggestionBatchSize = 0;
let conversationMessagesState = null;
let conversationPendingState = undefined;
let conversationRefreshTimer = null;
const AI_REASON_QUEUE_SIZE = 5;
let renderInProgress = false;
let renderQueued = false;

// Sprint 5.5: AppState is a read/write facade over the existing canonical
// bindings. Keeping the bindings intact preserves the validated runtime while
// giving every new module one documented state contract.
const AppState = Object.freeze({
  get activeModule() { return activeModule; },
  set activeModule(value) { activeModule = value; },
  get view() { return view; },
  set view(value) { view = value; },
  get activeWorkspace() { return activeWorkspace; },
  set activeWorkspace(value) { activeWorkspace = value; },
  get openTabs() { return openTabs.slice(); },
  get recentWorkspaces() { return recentWorkspaces.slice(); },
  get selectedDate() { return selected; },
  get selectedMonth() { return selectedMonth; },
  snapshot() {
    return {
      activeModule,
      view,
      activeWorkspace,
      openTabs: openTabs.slice(),
      recentWorkspaces: recentWorkspaces.slice(),
      selectedMonth
    };
  }
});
