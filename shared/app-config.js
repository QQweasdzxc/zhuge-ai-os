// P5.2A-1 Foundation Split: configuration and static constants.
const VERSION = "0.9.0-alpha.9.13";
const RELEASE_VERSION = VERSION;
const BUILD_TIME = "20260901-1709";
const DEPLOY_SOURCE = `worklog-app.js?v=${BUILD_TIME}`;
const KNOWLEDGE_DEBUG_MODE = (() => {
  try { return new URLSearchParams(location.search).has("debugKnowledge") || localStorage.getItem("zhuge_debug_knowledge") === "1"; }
  catch { return false; }
})();
const DRIVE_DEBUG_MODE = (() => {
  try { return new URLSearchParams(location.search).has("debugDrive") || localStorage.getItem("zhuge_debug_drive") === "1"; }
  catch { return false; }
})();
const GOOGLE_DRIVE_OAUTH_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const WORKLOG_DESCRIPTION_MAX_LENGTH = 50;
// Google Picker configuration is intentionally public-client configuration. Keep secrets out of this file.
// Set these values per deployment; an empty value keeps the Picker action disabled with a clear message.
const GOOGLE_PICKER_API_KEY = "AIzaSyBqKb6rxJLvtT9Rb1sLJU6zuNDOTlEh10U";
const GOOGLE_PICKER_APP_ID = "887242434449";
const PDFJS_LIB_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.269/build/pdf.mjs";
const PDFJS_WORKER_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.269/build/pdf.worker.mjs";
const root = document.getElementById("app");
const IS_EXTENSION_ENTRY = document.body?.classList.contains("extension");
const WEB_APP_URL = "https://qqweasdzxc.github.io/zhuge-ai-os/";
const CHROME_EXTENSION_STORE_URL = "";
const AUTH_SESSION_KEY = "zhuge_ai_os_google_auth_session_v1";
const AUTH_PROVIDER_KEY = "zhuge_ai_os_auth_provider_v1";
const AUTH_LINK_PENDING_KEY = "zhuge_ai_os_google_identity_link_pending_v1";
const AUTH_CODE_VERIFIER_KEY = "zhuge_ai_os_pkce_code_verifier_v1";
const OAUTH_ERROR_KEY = "zhuge_ai_os_oauth_error_v1";
const AI_OS_SESSION_KEY = "zhuge_ai_os_session_v1";
const WORKLOG_WELCOME_KEY = "zhuge_worklog_welcome_seen_v1";
const WORK_PROFILE_PROMPT_KEY = "zhuge_work_profile_prompt_date_v1";
const WORK_IDENTITY_SETUP_STEP_KEY = "zhuge_work_identity_setup_step_v1";
const WORK_IDENTITY_SETUP_DRAFT_KEY = "zhuge_work_identity_setup_draft_v1";
const WORK_IDENTITY_COMPLETION_KEY = "zhuge_work_identity_completion_pending_v1";
const MOBILE_SUMMARY_OPEN_KEY = "zhuge_mobile_summary_open_v1";
const MOBILE_CALENDAR_OPEN_KEY = "zhuge_mobile_calendar_open_v1";
const MOBILE_WORKLOG_TAB_KEY = "zhuge_mobile_worklog_tab_v1";
const AI_TODAY_SUGGESTION_INDEX_KEY = "zhuge_ai_today_suggestion_index_v1";
const WORK_MEMORY_MERGE_DECISIONS_KEY = "zhuge_work_memory_merge_decisions_v1";
const WORK_MEMORY_MERGE_STATS_KEY = "zhuge_work_memory_merge_stats_v1";
const WORK_MEMORY_AI_SUGGESTION_DECISIONS_KEY = "zhuge_work_memory_ai_suggestion_decisions_v1";
const TASKS_KEY = "zhuge_worklog_tasks_v1";
const TASKS_SCHEMA_SQL = "docs/supabase/20260728_sprint_6_1_priority_cloud_first_schema.sql";
const PRIORITY_ENGINE_SCHEMA_SQL = "docs/supabase/20260728_sprint_6_2_ai_priority_engine.sql";
const WORK_LIFECYCLE_SCHEMA_SQL = "docs/supabase/20260729_sprint_7_work_lifecycle.sql";
const TASK_WORKFLOW_SCHEMA_SQL = "docs/supabase/20260729_sprint_7_1_task_workflow.sql";
const WORK_JOURNAL_SCHEMA_SQL = "docs/supabase/20260729_sprint_7_2_work_journal.sql";
const LEGACY_WORK_MEMORY_METADATA_KEY = "zhuge_work_memory_merge_notes_v1";
const WORK_MEMORY_CLOUD_MIGRATION_KEY = "p5_6_work_memory_cloud_migrated_v1";
const WORK_MEMORY_SCHEMA_SQL = "docs/supabase/20260714_p5_6_work_memory_cloud_foundation_schema.sql";
const WORKLOG_CHAT_KEY = "zhuge_worklog_chat_v1";
const WORKLOG_CHAT_PENDING_KEY = "zhuge_worklog_chat_pending_v1";
const ZHUGE_ASSISTANT_WELCOME_KEY = "zhuge_assistant_welcome_seen_v1";
const ZHUGE_ASSISTANT_OPEN_KEY = "zhuge_assistant_open_v1";
const ACTIVE_MODULE_KEY = "zhuge_active_module_v1";
const OS_OPEN_TABS_KEY = "zhuge_os_open_tabs_v1";
const OS_ACTIVE_WORKSPACE_KEY = "zhuge_os_active_workspace_v1";
const OS_RECENT_WORKSPACES_KEY = "zhuge_os_recent_workspaces_v1";
const AUTH_CONFIG = {
  supabaseUrl: "https://lenpbbhwxyyfwgvjcozf.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxlbnBiYmh3eHl5Zndndmpjb3pmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyOTM1ODksImV4cCI6MjA5NTg2OTU4OX0.TAFfLoMC8Tqr4r7nlAtsOke3YcjBIBmr5fN1a6iwSFQ"
};
const WORKLOG_LLM_FUNCTION = "worklog-llm";


const roles = ["採購", "行政", "人資", "業務", "行銷", "IT", "自訂"];
const defaultTags = ["採購案件處理", "發票請款", "驗收請款", "供應商聯繫", "Mail處理", "資料整理", "會議", "專案追蹤"];
const defaultEcpTasks = ["採購案件處理", "驗收請款", "發票請款", "供應商聯繫", "採購進度追蹤"];
const roleTagMap = {
  "採購": ["採購案件處理", "發票請款", "驗收請款", "供應商聯繫", "採購進度追蹤", "合約資料整理", "會議", "專案追蹤"],
  "行政": ["庶務行政", "文件整理", "會議安排", "費用請款", "資產管理", "跨部門聯繫", "Mail處理", "資料整理"],
  "人資": ["招募作業", "面試安排", "員工資料維護", "出勤確認", "教育訓練", "薪資資料整理", "制度公告", "跨部門溝通"],
  "業務": ["客戶聯繫", "報價追蹤", "商機更新", "合約確認", "客戶會議", "銷售資料整理", "回款追蹤", "專案追蹤"],
  "行銷": ["活動規劃", "內容製作", "社群排程", "廣告成效追蹤", "市場資料整理", "素材確認", "跨部門溝通", "專案追蹤"],
  "IT": ["系統維護", "帳號權限處理", "問題排查", "需求訪談", "系統更新", "資料備份", "資安檢查", "技術文件整理"],
  "自訂": ["自訂工作", "Mail處理", "資料整理", "會議", "專案追蹤", "跨部門溝通", "文件整理", "待辦追蹤"]
};
const roleCodeMap = { "採購": "PROCUREMENT", "行政": "ADMIN", "人資": "HR", "財務": "FINANCE", "業務": "SALES", "行銷": "MARKETING", "IT": "IT", "自訂": "CUSTOM" };
const roleNameMap = Object.fromEntries(Object.entries(roleCodeMap).map(([name, code]) => [code, name]));
const entryTypeOptions = [
  { value: "work", label: "工作" },
  { value: "leave", label: "請假" }
];
const leaveTypeVocabulary = ["特休", "病假", "事假", "公假", "婚假", "喪假", "補休", "育嬰假", "生理假", "家庭照顧假", "請假"];
const eventTypeCodeMap = {
  work: "WORK", meeting: "WORK", training: "WORK", leave: "LEAVE", holiday: "LEAVE",
  "工作": "WORK", "會議": "MEETING", "教育訓練": "TRAINING", "特休": "LEAVE", "事假": "LEAVE", "病假": "LEAVE", "請假": "LEAVE", "假日": "LEAVE", "出差": "BUSINESS_TRIP"
};
const eventTypeNameMap = { WORK: "work", MEETING: "work", TRAINING: "work", LEAVE: "leave", BUSINESS_TRIP: "work" };
const KNOWLEDGE_BUCKET = "knowledge-sources";
const LEGACY_KNOWLEDGE_MIGRATION_KEY = "knowledge_repository_p5_legacy_wl_library_v1";
const ECP_EXPORT_PROFILE_PATH = "resources/profiles/ecp-profile.json";
const CLOUD_MIGRATION_KEY = "localstorage_rc33_to_rc34a_v1";
const KNOWLEDGE_CATEGORIES = ["SOP", "制度", "法規", "專案", "表單", "教材", "會議", "其他"];
const KNOWLEDGE_AGENTS = ["採購 Agent", "人資 Agent", "投資 Agent", "旅遊 Agent"];
const KNOWLEDGE_SCOPES = ["personal", "role", "company", "public"];
const KNOWLEDGE_SCOPE_LABELS = { personal: "👤 個人知識", role: "💼 職務知識", company: "🏢 部門知識", public: "🌍 公開知識" };
const KNOWLEDGE_PROCESSING_STATUS = ["uploaded", "queued", "processing", "processed", "knowledge_built", "verified", "failed", "archived"];
const KNOWLEDGE_SOURCE_TYPES = ["file", "pdf", "word", "excel", "powerpoint", "markdown", "url", "legacy_metadata"];
const KNOWLEDGE_ROLE_OPTIONS = ["PROCUREMENT", "HR", "IT", "ADMIN", "FINANCE", "SALES", "MARKETING", "CUSTOM"];
const WORK_PROFILE_SCHEMA_SQL = "docs/supabase/20260712_p4_5_user_work_profile_schema.sql";
const workspaceRegistry = {
  dashboard: { icon: "🪶", label: "Zhuge AI OS", group: "system", enabled: true, hidden: true, root: true },
  // Keep the WorkLog icon aligned with the canonical AI Board navigation.
  // Active state is the only per-workspace visual delta in the shared rail.
  worklog: { icon: "✏️", label: "WorkLog", group: "camp", enabled: true },
  "tasks-new": { icon: "✅", label: "工作待辦", group: "camp-child", enabled: true, externalHref: "../../app/Board/worktodo/" },
  investment: { icon: "📈", label: "Investment", group: "camp", enabled: true, externalHref: "../investment/" },
  leisure: { icon: "🎮", label: "休閒小站", group: "leisure", enabled: true, externalHref: "../leisure/" },
  "ai-board": { icon: "🤖", label: "AI Board", group: "ai-board", enabled: true, externalHref: "../../app/Board/ai/" },
  "ai-board-board": { icon: "📋", label: "工作看板", group: "ai-board-child", enabled: true, externalHref: "../../app/Board/ai/?view=board" },
  "ai-board-principles": { icon: "📘", label: "工程準則", group: "ai-board-child", enabled: true, externalHref: "../../app/Board/ai/?view=principles" },
  "ai-board-system-map": { icon: "🗺️", label: "系統藍圖", group: "ai-board-child", enabled: true, externalHref: "../../app/Board/ai/?view=system-map" },
  procurement: { icon: "🚧", label: "施工中", group: "construction", comingSoon: true },
  hr: { icon: "🚧", label: "施工中", group: "construction", comingSoon: true },
  travel: { icon: "🚧", label: "施工中", group: "construction", comingSoon: true },
  library: { icon: "📚", label: "Knowledge", group: "system", enabled: true },
  aiSuggestions: { icon: "🪶", label: "AI 建議", group: "system", enabled: true, hidden: true },
  sync: { icon: "🔗", label: "控制台", group: "system", enabled: true },
  settings: { icon: "⚙️", label: "設定", group: "system", enabled: true }
};
const agentStatuses = [
  ["🪶", "工時 Agent", "🟢 在線"],
  ["📈", "投資 Agent", "🟡 SIT"]
];
