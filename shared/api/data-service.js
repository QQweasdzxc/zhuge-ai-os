// P5.2A-1 Foundation Split: LocalCache, DataService, migration, and cloud sync orchestration.
let cloudSync = readJson("wl_cloud_sync_status_v1", { status: "idle", lastSyncedAt: "", error: "" });
let conversationSync = readJson("zhuge_conversation_sync_status_v1", { status: "unknown", lastSyncedAt: "", error: "" });
let dataServiceReady = false;
let dataServiceHydrating = false;
let dataServiceSyncing = false;
let dataServiceInitializationState = "idle";
let dataServiceInitializationError = "";
let dataServiceInitializationFailures = [];
let autoSaveTimer = null;
let autoSaveInFlight = false;
const autoSaveDirtyScopes = new Set();
let knowledgeFoundationNotInitialized = cloudSync.status === "knowledge_uninitialized";
let taskFoundationNotInitialized = false;
let conversationFoundationNotInitialized = false;
let migrationRequired = false;
let migrationPreview = null;
let migrationRunning = false;
let migrationError = "";

function setConversationSyncStatus(status, error = "") {
  conversationSync = { status, error, lastSyncedAt: status === "synced" ? new Date().toISOString() : conversationSync.lastSyncedAt || "" };
  writeJson("zhuge_conversation_sync_status_v1", conversationSync);
  refreshCloudSyncStatusDisplay();
}

const LocalCache = {
  // Cloud SSOT: browser storage is not a source of truth for business data.
  load(name, fallback) { return fallback; },
  save() {},
  saveAll() {},
  hydrate() { return false; }
};


const DataService = {
  workModelsState: null,
  ecpTasksState: null,
  getInitializationState() {
    return Object.freeze({
      state: dataServiceInitializationState,
      error: dataServiceInitializationError,
      failedLoads: [...dataServiceInitializationFailures]
    });
  },
  async waitUntilHydrated(timeoutMs = 10000) {
    const started = Date.now();
    while (dataServiceHydrating) {
      if (Date.now() - started >= timeoutMs) throw new Error("雲端資料初始化逾時");
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  },
  async init() {
    if (!hasGoogleOAuthSession()) {
      dataServiceInitializationState = "unauthorized";
      dataServiceInitializationError = "";
      dataServiceInitializationFailures = [];
      return;
    }
    dataServiceInitializationState = "loading";
    dataServiceInitializationError = "";
    dataServiceInitializationFailures = [];
    dataServiceReady = true;
    try {
      await this.prepareMigration();
      if (migrationRequired) {
        dataServiceInitializationState = "migration_required";
        return;
      }
      await this.loadAll();
    } catch (error) {
      dataServiceInitializationState = "error";
      dataServiceInitializationError = error?.message || "工作空間初始化失敗";
      throw error;
    }
  },
  setStatus(status, error = "") {
    cloudSync = { status, error, lastSyncedAt: status === "synced" ? new Date().toISOString() : cloudSync.lastSyncedAt || "" };
    writeJson("wl_cloud_sync_status_v1", cloudSync);
    refreshCloudSyncStatusDisplay();
  },
  queueAutoSave(scopes = []) {
    const list = Array.isArray(scopes) ? scopes : [scopes];
    list.filter(Boolean).forEach(scope => autoSaveDirtyScopes.add(scope));
    LocalCache.saveAll();
    if (!hasGoogleOAuthSession()) {
      this.setStatus("failed", "尚未登入 Zhuge AI OS，無法同步設定");
      return;
    }
    if (dataServiceHydrating || migrationRequired || migrationRunning) {
      this.setStatus("pending");
      return;
    }
    this.setStatus("pending");
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => this.flushAutoSaveQueue(), 2000);
  },
  async flushAutoSaveQueue() {
    if (autoSaveInFlight) return;
    if (!autoSaveDirtyScopes.size) return;
    if (!hasGoogleOAuthSession()) {
      this.setStatus("failed", "尚未登入 Zhuge AI OS，無法同步設定");
      return;
    }
    if (dataServiceHydrating || migrationRequired || migrationRunning) {
      if (autoSaveTimer) clearTimeout(autoSaveTimer);
      autoSaveTimer = setTimeout(() => this.flushAutoSaveQueue(), 2000);
      return;
    }
    autoSaveInFlight = true;
    dataServiceReady = true;
    const scopes = new Set(autoSaveDirtyScopes);
    autoSaveDirtyScopes.clear();
    this.setStatus("syncing");
    try {
      if (scopes.has("profile") && profile) {
        syncWorkProfileFromProfile();
        await SupabaseRepository.upsertUserProfile(profile);
        await SupabaseRepository.upsertExportSettings(profile);
        await SupabaseRepository.upsertWorkProfile(workProfile);
      }
      if (scopes.has("workModels")) {
        const rows = await SupabaseRepository.saveWorkModels(workMemoryObjects(), profile);
        setWorkModels(Array.isArray(rows) ? rows : workMemoryObjects());
      }
      if (scopes.has("ecpTasks")) {
        const rows = await SupabaseRepository.saveEcpTasks(ecpTasks());
        setEcpTasks(Array.isArray(rows) ? rows.map(row => row.name).filter(Boolean) : ecpTasks());
      }
      if (scopes.has("tasks")) {
        const rows = await SupabaseRepository.saveTasks(tasks);
        setTasksFromCloud(rows);
      }
      LocalCache.saveAll();
      this.setStatus(autoSaveDirtyScopes.size ? "pending" : "synced");
      if (autoSaveDirtyScopes.size) {
        if (autoSaveTimer) clearTimeout(autoSaveTimer);
        autoSaveTimer = setTimeout(() => this.flushAutoSaveQueue(), 2000);
      }
    } catch (error) {
      scopes.forEach(scope => autoSaveDirtyScopes.add(scope));
      console.error("Smart Auto Save failed", { error, supabase: error.supabase || null, scopes: [...scopes] });
      if (scopes.has("workModels") && isWorkMemoryNotInitializedError(error)) {
        workMemoryFoundationNotInitialized = true;
        this.setStatus("work_memory_uninitialized", `請先執行 ${WORK_MEMORY_SCHEMA_SQL}`);
      } else if (scopes.has("tasks") && isTasksNotInitializedError(error)) {
        taskFoundationNotInitialized = true;
        this.setStatus("tasks_uninitialized", `請先執行 ${PRIORITY_ENGINE_SCHEMA_SQL}`);
      } else this.setStatus("failed", error.message || "Smart Auto Save failed");
    } finally {
      autoSaveInFlight = false;
    }
  },
  retryAutoSave() {
    if (!autoSaveDirtyScopes.size) {
      autoSaveDirtyScopes.add("profile");
      autoSaveDirtyScopes.add("workModels");
      autoSaveDirtyScopes.add("ecpTasks");
      autoSaveDirtyScopes.add("tasks");
    }
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => this.flushAutoSaveQueue(), 0);
  },
  async migrateLegacyWorkMemoryMetadata(cloudRows = []) {
    const legacyKey = scopedLocalKey(LEGACY_WORK_MEMORY_METADATA_KEY);
    const markerKey = scopedLocalKey(WORK_MEMORY_CLOUD_MIGRATION_KEY);
    const legacy = readJson(legacyKey, {});
    if (localStorage.getItem(markerKey) === "1" || !legacy || typeof legacy !== "object" || !Object.keys(legacy).length) return cloudRows;
    const objects = (cloudRows || []).map((row, index) => normalizeWorkMemoryObject(row, index));
    const cachedObjects = (Array.isArray(this.workModelsState) ? this.workModelsState : []).map((row, index) => normalizeWorkMemoryObject(row, index));
    for (const name of Object.keys(legacy)) {
      if (objects.some(object => object.name === name)) continue;
      const cached = cachedObjects.find(object => object.name === name);
      objects.push(normalizeWorkMemoryObject({ ...(cached || {}), name, source: "migrated", isActive: cached?.isActive !== false }, objects.length));
    }
    let changed = false;
    for (const object of objects) {
      const note = legacy[object.name];
      if (!note || typeof note !== "object") continue;
      const cloudMetadataWasEmpty = !object.description && (!object.category || object.category === "一般工作") && !object.aliases.length && !object.sourceReferences.length;
      if (!object.description && note.description) { object.description = String(note.description); changed = true; }
      if ((!object.category || object.category === "一般工作") && note.category) { object.category = String(note.category); changed = true; }
      const aliases = [...new Set([...object.aliases, ...arrayFromInput(note.aliases)])];
      if (aliases.length !== object.aliases.length) { object.aliases = aliases; changed = true; }
      const existingLabels = new Set(object.sourceReferences.map(reference => reference.label || ""));
      for (const label of arrayFromInput(note.from)) {
        if (!existingLabels.has(label)) {
          object.sourceReferences.push({ type: "legacy", label });
          existingLabels.add(label);
          changed = true;
        }
      }
      if (typeof note.enabled === "boolean" && object.isActive !== note.enabled && cloudMetadataWasEmpty) {
        object.isActive = note.enabled;
        changed = true;
      }
    }
    const rows = changed ? await SupabaseRepository.saveWorkModels(objects, profile) : cloudRows;
    localStorage.removeItem(legacyKey);
    localStorage.setItem(markerKey, "1");
    console.info("Work Memory legacy metadata migrated to Cloud", { migratedItems: Object.keys(legacy).length, updatedRows: changed ? objects.length : 0 });
    return rows;
  },
  async loadConversation() {
    if (!hasGoogleOAuthSession() || migrationRequired || migrationRunning) return null;
    setConversationSyncStatus("syncing");
    try {
      const bundle = await ConversationRepository.load();
      conversationFoundationNotInitialized = false;
      applyCloudConversation(bundle);
      setConversationSyncStatus("synced");
      return bundle;
    } catch (error) {
      if (isConversationNotInitializedError(error)) {
        conversationFoundationNotInitialized = true;
        setConversationSyncStatus("uninitialized", "Conversation 尚未初始化，聊天目前僅儲存在此瀏覽器。");
        console.warn("Conversation Foundation not initialized", {
          tables: ["assistant_conversations", "assistant_messages", "assistant_conversation_states"],
          setupSql: "docs/supabase/20260711_p4_1_conversation_foundation_schema.sql",
          error
        });
        return null;
      }
      setConversationSyncStatus("failed", error?.supabase?.message || error?.message || "Conversation load failed");
      console.error("Conversation load failed", { error, supabase: error.supabase || null });
      return null;
    }
  },
  async saveConversationMessage(message = {}) {
    if (!hasGoogleOAuthSession() || dataServiceHydrating || migrationRequired || migrationRunning) return null;
    setConversationSyncStatus("pending");
    try {
      const saved = await ConversationRepository.saveMessage(message, assistantChannel());
      conversationFoundationNotInitialized = false;
      setConversationSyncStatus("synced");
      console.info("Conversation message synced", {
        user_uuid: currentUserUuid(),
        conversation_id: saved?.conversation_id || "",
        client_message_id: message.id || "",
        channel: assistantChannel(),
        role: message.role || ""
      });
      return saved;
    } catch (error) {
      if (isConversationNotInitializedError(error)) {
        conversationFoundationNotInitialized = true;
        setConversationSyncStatus("uninitialized", "Conversation 尚未初始化，聊天目前僅儲存在此瀏覽器。");
        console.warn("Conversation message saved locally; Conversation Foundation not initialized", {
          setupSql: "docs/supabase/20260711_p4_1_conversation_foundation_schema.sql",
          error
        });
        return null;
      }
      setConversationSyncStatus("failed", error?.supabase?.message || error?.message || "Conversation message sync failed");
      console.error("Conversation message sync failed", {
        user_uuid: currentUserUuid(),
        conversation_id: "",
        client_message_id: message.id || "",
        channel: assistantChannel(),
        role: message.role || "",
        status: error?.supabase?.status || "",
        code: error?.supabase?.code || error?.code || "",
        message: error?.supabase?.message || error?.message || "",
        details: error?.supabase?.details || error?.details || "",
        hint: error?.supabase?.hint || error?.hint || "",
        error,
        supabase: error.supabase || null
      });
      return null;
    }
  },
  async saveConversationState(command = null) {
    if (!hasGoogleOAuthSession() || dataServiceHydrating || migrationRequired || migrationRunning) return null;
    setConversationSyncStatus("pending");
    try {
      const saved = await ConversationRepository.saveState(command, assistantChannel());
      conversationFoundationNotInitialized = false;
      setConversationSyncStatus("synced");
      return saved;
    } catch (error) {
      if (isConversationNotInitializedError(error)) {
        conversationFoundationNotInitialized = true;
        setConversationSyncStatus("uninitialized", "Conversation 尚未初始化，聊天目前僅儲存在此瀏覽器。");
        console.warn("Conversation state saved locally; Conversation Foundation not initialized", {
          setupSql: "docs/supabase/20260711_p4_1_conversation_foundation_schema.sql",
          error
        });
        return null;
      }
      setConversationSyncStatus("failed", error?.supabase?.message || error?.message || "Conversation state sync failed");
      console.error("Conversation state sync failed", {
        user_uuid: currentUserUuid(),
        channel: assistantChannel(),
        status: error?.supabase?.status || "",
        code: error?.supabase?.code || error?.code || "",
        message: error?.supabase?.message || error?.message || "",
        details: error?.supabase?.details || error?.details || "",
        hint: error?.supabase?.hint || error?.hint || "",
        error,
        supabase: error.supabase || null,
        command
      });
      return null;
    }
  },
  async loadCriticalData(month = selectedMonth) {
    if (!dataServiceReady || !hasGoogleOAuthSession()) return { tasks: false, entries: false };
    const requestedMonth = monthKey(month);
    const result = { tasks: false, entries: false, errors: [] };

    try {
      const taskRows = await SupabaseRepository.loadTasks();
      setTasksFromCloud(Array.isArray(taskRows) ? taskRows : []);
      result.tasks = true;
    } catch (error) {
      result.errors.push(`tasks: ${error?.supabase?.message || error.message || error}`);
      console.error("Critical Cloud tasks load failed", { error, supabase: error?.supabase || null });
    }

    try {
      const entryRows = await SupabaseRepository.loadEntries(requestedMonth);
      if (requestedMonth === selectedMonth) {
        setEntries(Array.isArray(entryRows) ? entryRows.map(entryFromCloud) : []);
        result.entries = true;
      }
    } catch (error) {
      result.errors.push(`entries: ${error?.supabase?.message || error.message || error}`);
      console.error("Critical Cloud entries load failed", { error, month: requestedMonth, supabase: error?.supabase || null });
    }

    if ((result.tasks || result.entries) && typeof render === "function") render("critical-cloud-data-loaded");
    return result;
  },
  async loadAll() {
    if (!dataServiceReady || dataServiceHydrating) return;
    dataServiceHydrating = true;
    dataServiceInitializationState = "loading";
    dataServiceInitializationError = "";
    dataServiceInitializationFailures = [];
    this.setStatus("syncing");
    const errors = [];
    const failedLoads = new Set();
    try {
      const safeLoad = async (label, loader, fallback) => {
        try { return await loader(); }
        catch (error) {
          if (["knowledge", "knowledge_units", "knowledge_candidates"].includes(label) && isKnowledgeNotInitializedError(error)) {
            knowledgeFoundationNotInitialized = true;
            failedLoads.add(label);
            console.warn("Knowledge Foundation not initialized", {
              table: label,
              setupSql: label === "knowledge_candidates" ? "docs/supabase/20260713_p5_2_knowledge_intelligence_v1_schema.sql" : "docs/supabase/20260712_p5_1_knowledge_repository_schema.sql",
              error
            });
            return fallback;
          }
          if (label === "work_profile" && isWorkProfileNotInitializedError(error)) {
            failedLoads.add(label);
            console.warn("Work Profile Foundation not initialized", {
              table: "user_work_profiles",
              setupSql: WORK_PROFILE_SCHEMA_SQL,
              error
            });
            return fallback;
          }
          if (label === "work_models" && isWorkMemoryNotInitializedError(error)) {
            workMemoryFoundationNotInitialized = true;
            failedLoads.add(label);
            console.warn("Work Memory Cloud Foundation not initialized", { setupSql: WORK_MEMORY_SCHEMA_SQL, error });
            return fallback;
          }
          if (label === "tasks" && isTasksNotInitializedError(error)) {
            taskFoundationNotInitialized = true;
            failedLoads.add(label);
            console.warn("Task Cloud Foundation not initialized", { setupSql: PRIORITY_ENGINE_SCHEMA_SQL, error });
            return fallback;
          }
          errors.push(`${label}: ${error.message || error}`);
          failedLoads.add(label);
          console.error(`Cloud Sync ${label} load failed`, error);
          return fallback;
        }
      };
      const cloudProfile = await safeLoad("profile", () => SupabaseRepository.loadUserProfile(), null);
      const exportSettings = await safeLoad("export_settings", () => SupabaseRepository.loadExportSettings(), null);
      const cloudWorkProfile = await safeLoad("work_profile", () => SupabaseRepository.loadWorkProfile(), null);
      let workModelsRows = await safeLoad("work_models", () => SupabaseRepository.loadWorkModels(), []);
      const ecpTaskRows = await safeLoad("ecp_tasks", () => SupabaseRepository.loadEcpTasks(), []);
      const critical = await this.loadCriticalData(selectedMonth);
      if (!critical.tasks) failedLoads.add("tasks");
      else taskFoundationNotInitialized = false;
      if (!critical.entries) failedLoads.add("entries");
      critical.errors.forEach(error => errors.push(error));
      // Optional domains are isolated: their failure must not hide Tasks or Work Entries.
      const journalRows = await safeLoad("work_journal", () => SupabaseRepository.loadWorkJournal(), []);
      const knowledgeRows = await safeLoad("knowledge", () => KnowledgeRepository.loadSources(), []);
      const knowledgeUnitRows = await safeLoad("knowledge_units", () => KnowledgeRepository.loadUnits(), []);
      const knowledgeCandidateRows = await safeLoad("knowledge_candidates", () => KnowledgeRepository.loadRecommendationCandidates(), []);
      await this.loadConversation();
      if (!failedLoads.has("work_models")) {
        workMemoryFoundationNotInitialized = false;
        workModelsRows = await this.migrateLegacyWorkMemoryMetadata(workModelsRows || []);
        this.workModelsState = (workModelsRows || []).map((row, index) => normalizeWorkMemoryObject(row, index));
      }
      if (cloudProfile || exportSettings || !failedLoads.has("work_models") || !failedLoads.has("ecp_tasks")) {
        profile = profileFromCloud(cloudProfile, exportSettings, workModelsRows || [], ecpTaskRows || [], {
          workModelsLoaded: !failedLoads.has("work_models"),
          ecpTasksLoaded: !failedLoads.has("ecp_tasks")
        });
        if (failedLoads.has("work_models")) this.workModelsState = Array.isArray(profile?.tags) ? profile.tags.map((name, index) => normalizeWorkMemoryObject(name, index)) : [];
        this.ecpTasksState = Array.isArray(profile?.ecpTasks) ? [...profile.ecpTasks] : [];
      }
      workProfile = workProfileFromCloud(cloudWorkProfile, exportSettings, ecpTaskRows || [], profile);
      applyWorkProfileToProfile(workProfile);
      if (!failedLoads.has("work_journal") && typeof setWorkJournalFromCloud === "function") {
        setWorkJournalFromCloud(journalRows);
      }
      if (!failedLoads.has("knowledge")) {
        knowledgeFoundationNotInitialized = false;
        setLibrary(Array.isArray(knowledgeRows) ? knowledgeRows.map(knowledgeFromCloud) : []);
      }
      if (!failedLoads.has("knowledge_units")) {
        knowledgeUnits = Array.isArray(knowledgeUnitRows) ? knowledgeUnitRows.map(knowledgeUnitFromCloud) : [];
      }
      if (!failedLoads.has("knowledge_candidates")) {
        knowledgeRecommendationCandidates = Array.isArray(knowledgeCandidateRows) ? knowledgeCandidateRows.map(knowledgeRecommendationCandidateFromCloud) : [];
      }
      LocalCache.saveAll();
      const coreFailures = [...failedLoads].filter(label => ["profile", "export_settings", "tasks", "entries"].includes(label));
      const initializationFailures = [...failedLoads].filter(label => [
        "profile", "export_settings", "work_profile", "work_models", "ecp_tasks", "tasks", "entries"
      ].includes(label));
      dataServiceInitializationFailures = initializationFailures;
      if (initializationFailures.length) {
        dataServiceInitializationState = "error";
        dataServiceInitializationError = errors.filter(error => initializationFailures.some(label => error.startsWith(`${label}:`))).join(" | ") || `工作空間初始化失敗：${initializationFailures.join(", ")}`;
      } else {
        dataServiceInitializationState = "ready";
        dataServiceInitializationError = "";
      }
      if (coreFailures.length) this.setStatus("failed", errors.filter(error => coreFailures.some(label => error.startsWith(`${label}:`))).join(" | ") || `核心資料載入失敗：${coreFailures.join(", ")}`);
      else this.setStatus("synced");
    } catch (error) {
      console.error("Cloud Sync load failed", error);
      dataServiceInitializationState = "error";
      dataServiceInitializationError = error.message || "工作空間初始化失敗";
      dataServiceInitializationFailures = ["load_all"];
      this.setStatus("failed", error.message || "Cloud Sync failed");
    } finally {
      dataServiceHydrating = false;
    }
  },
  async prepareMigration() {
    const inventory = legacyInventory();
    migrationRequired = false;
    migrationPreview = null;
    if (!inventory.hasCoreData) return false;
    try {
      const existing = await SupabaseRepository.loadMigration();
      if (existing?.completed_at) return false;
      const hasCloudData = await SupabaseRepository.hasCloudCoreData();
      if (hasCloudData) {
        console.info("Cloud Sync: cloud data exists; skip legacy migration prompt and use Supabase as source of truth");
        return false;
      }
      migrationPreview = inventory;
      migrationRequired = true;
      migrationError = "";
      this.setStatus("migration_required");
      return true;
    } catch (error) {
      console.error("Cloud Sync migration check failed", error);
      migrationError = error.message || "Migration check failed";
      this.setStatus("failed", migrationError);
      return false;
    }
  },
  async runMigration() {
    if (!migrationPreview || migrationRunning) return;
    migrationRunning = true;
    migrationError = "";
    this.setStatus("migrating");
    try {
      entries = readJson("wl_entries", []);
      const legacyTasks = readJson("zhuge_worklog_tasks_v1", []).map(normalizeTask).filter(item => item.title);
      if (!tasks.length && legacyTasks.length) tasks = legacyTasks;
      profile = readJson("wl_profile", profile);
      normalizeEntries();
      if (profile) {
        syncWorkProfileFromProfile();
        await SupabaseRepository.upsertUserProfile(profile);
        await SupabaseRepository.upsertExportSettings(profile);
        await SupabaseRepository.upsertWorkProfile(workProfile);
        await SupabaseRepository.saveWorkModels(workMemoryObjects(), profile);
        await SupabaseRepository.saveEcpTasks(ecpTasks());
        await SupabaseRepository.saveTasks(tasks);
      }
      for (const entry of entries.filter(e => e.status !== "deleted")) {
        const saved = await SupabaseRepository.saveEntry(entry);
        if (saved?.id) entry.cloudId = saved.id;
      }
      const sourceHash = await sha256Text(JSON.stringify({
        entries: readJson("wl_entries", []),
        profile: readJson("wl_profile", null),
        key: CLOUD_MIGRATION_KEY
      }));
      await SupabaseRepository.completeMigration(sourceHash);
      migrationRequired = false;
      migrationPreview = null;
      await this.loadAll();
      LocalCache.saveAll();
      this.setStatus("synced");
      toast("Cloud Sync Migration 完成");
    } catch (error) {
      console.error("Cloud Sync migration failed", error);
      migrationError = error.message || "Migration failed";
      this.setStatus("failed", migrationError);
      toast("Migration 失敗，legacy data 已保留");
    } finally {
      migrationRunning = false;
      render("migration-complete");
    }
  },
  async syncAll() {
    if (!dataServiceReady || dataServiceHydrating || dataServiceSyncing || !hasGoogleOAuthSession()) return;
    dataServiceSyncing = true;
    this.setStatus("syncing");
    try {
      if (profile) {
        syncWorkProfileFromProfile();
        await SupabaseRepository.upsertUserProfile(profile);
        await SupabaseRepository.upsertExportSettings(profile);
        await SupabaseRepository.upsertWorkProfile(workProfile);
        await SupabaseRepository.saveWorkModels(workMemoryObjects(), profile);
        await SupabaseRepository.saveEcpTasks(ecpTasks());
        await SupabaseRepository.saveTasks(tasks);
      }
      for (const entry of entries.filter(e => e.status !== "deleted")) {
        const saved = await SupabaseRepository.saveEntry(entry);
        if (saved?.id) entry.cloudId = saved.id;
      }
      LocalCache.saveAll();
      this.setStatus("synced");
    } catch (error) {
      console.error("Cloud Sync save failed", error);
      this.setStatus("failed", error.message || "Cloud Sync failed");
    } finally {
      dataServiceSyncing = false;
    }
  },
  async deleteEntry(entry) {
    if (!dataServiceReady || !hasGoogleOAuthSession()) throw new Error("Cloud Sync 尚未就緒");
    if (dataServiceHydrating || migrationRequired || migrationRunning) throw new Error("Cloud Sync 正在初始化");
    this.setStatus("syncing");
    try {
      await SupabaseRepository.deleteEntry(entry);
      setEntries(entries.filter(e => e.id !== entry.id));
      this.setStatus("synced");
    } catch (error) {
      console.error("Cloud Sync delete failed", { error, supabase: error.supabase || null, entry });
      this.setStatus("failed", error.message || "Cloud Sync delete failed");
      throw error;
    }
  },
  async saveEntry(item) {
    if (!dataServiceReady || !hasGoogleOAuthSession()) throw new Error("Cloud Sync 尚未就緒");
    if (dataServiceHydrating || migrationRequired || migrationRunning) throw new Error("Cloud Sync 正在初始化");
    this.setStatus("syncing");
    try {
      const saved = await SupabaseRepository.saveEntry(item);
      const cloudEntry = saved ? entryFromCloud(saved) : item;
      const nextEntries = entries.filter(e => e.id !== item.id && e.cloudId !== cloudEntry.cloudId);
      nextEntries.push({ ...item, ...cloudEntry, id: item.id || cloudEntry.id, cloudId: cloudEntry.cloudId || saved?.id });
      setEntries(nextEntries);
      selected = safeDate(item.at);
      selectedMonth = monthKey(selected);
      this.setStatus("synced");
      return nextEntries.find(e => e.id === (item.id || cloudEntry.id));
    } catch (error) {
      console.error("Cloud Sync save entry failed", { error, supabase: error.supabase || null, item });
      this.setStatus("failed", error.message || "Entry sync failed");
      throw error;
    }
  },
  async saveTasksNow(items = tasks) {
    if (!dataServiceReady || !hasGoogleOAuthSession()) throw new Error("Cloud Sync 尚未就緒");
    if (dataServiceHydrating || migrationRequired || migrationRunning) throw new Error("Cloud Sync 正在初始化");
    this.setStatus("syncing");
    try {
      const rows = await SupabaseRepository.saveTasks(items);
      setTasksFromCloud(rows);
      LocalCache.saveAll();
      this.setStatus("synced");
      return rows;
    } catch (error) {
      this.setStatus("failed", error.message || "Task sync failed");
      throw error;
    }
  },
  async loadWorkJournal(taskUuid = "") {
    if (!hasGoogleOAuthSession() || dataServiceHydrating || migrationRunning) throw new Error("Cloud Sync 尚未就緒");
    const rows = await SupabaseRepository.loadWorkJournal(taskUuid);
    if (!taskUuid && typeof setWorkJournalFromCloud === "function") setWorkJournalFromCloud(rows);
    return Array.isArray(rows) ? rows : [];
  },
  async saveWorkJournalEntry(entry = {}) {
    if (!dataServiceReady || !hasGoogleOAuthSession()) throw new Error("Cloud Sync 尚未就緒");
    if (dataServiceHydrating || migrationRequired || migrationRunning) throw new Error("Cloud Sync 正在初始化");
    this.setStatus("syncing");
    try {
      const saved = await SupabaseRepository.saveWorkJournalEntry(entry);
      if (!saved) throw new Error("Work Journal 未回傳儲存結果");
      if (typeof upsertWorkJournalEntry === "function") upsertWorkJournalEntry(saved);
      LocalCache.saveAll();
      this.setStatus("synced");
      return saved;
    } catch (error) {
      this.setStatus("failed", error.message || "Work Journal sync failed");
      throw error;
    }
  },
  async loadMonthEntries(month = selectedMonth) {
    if (!hasGoogleOAuthSession() || migrationRequired || migrationRunning) return false;
    const requestedMonth = monthKey(month);
    try {
      await this.waitUntilHydrated();
      this.setStatus("syncing");
      const entryRows = await SupabaseRepository.loadEntries(requestedMonth);
      // Ignore stale responses when the user has already moved to another month.
      if (requestedMonth !== selectedMonth) return false;
      setEntries(Array.isArray(entryRows) ? entryRows.map(entryFromCloud) : []);
      this.setStatus("synced");
      return true;
    } catch (error) {
      console.error("Cloud month entries load failed", { error, month: requestedMonth });
      this.setStatus("failed", error?.supabase?.message || error.message || "月份工時載入失敗");
      return false;
    }
  },
  async saveWorkModelsOnly(options = {}) {
    try {
      LocalCache.saveAll();
      if (hasGoogleOAuthSession() && !dataServiceHydrating && !migrationRunning) {
        dataServiceReady = true;
        this.setStatus("syncing");
        const rows = await SupabaseRepository.saveWorkModels(workMemoryObjects(), profile);
        setWorkModels(Array.isArray(rows) ? rows : workMemoryObjects());
        LocalCache.saveAll();
        this.setStatus("synced");
      } else {
        const reason = !hasGoogleOAuthSession() ? "尚未登入 Zhuge AI OS" : "Cloud Sync 正在初始化";
        console.warn("Work Memory saved to cache; cloud sync deferred", { reason, models: workMemoryObjects().map(item => item.name) });
        if (options.requireCloud) throw new Error(reason);
      }
    } catch (error) {
      console.error("Save Work Memory failed", { error, supabase: error.supabase || null, models: workMemoryObjects().map(item => item.name) });
      if (isWorkMemoryNotInitializedError(error)) {
        workMemoryFoundationNotInitialized = true;
        this.setStatus("work_memory_uninitialized", `請先執行 ${WORK_MEMORY_SCHEMA_SQL}`);
      } else this.setStatus("failed", error.message || "Work Memory sync failed");
      if (options.requireCloud) throw error;
    }
  },
  async reloadWorkModels() {
    if (!hasGoogleOAuthSession() || dataServiceHydrating || migrationRunning) throw new Error("Cloud Sync 尚未就緒");
    this.setStatus("syncing");
    try {
      const rows = await SupabaseRepository.loadWorkModels();
      setWorkModels(Array.isArray(rows) ? rows : []);
      LocalCache.saveAll();
      this.setStatus("synced");
      return Array.isArray(rows) ? rows : [];
    } catch (error) {
      this.setStatus("failed", error.message || "Work Memory reload failed");
      throw error;
    }
  },
  async deleteWorkModel(item = {}) {
    if (!hasGoogleOAuthSession() || dataServiceHydrating || migrationRunning) throw new Error("Cloud Sync 尚未就緒");
    this.setStatus("syncing");
    try {
      await SupabaseRepository.deleteWorkModel(item);
      const remaining = workMemoryObjects().filter(model => model.id !== item.id && model.name !== item.name);
      setWorkModels(remaining);
      LocalCache.saveAll();
      this.setStatus("synced");
      return true;
    } catch (error) {
      console.error("Delete Work Memory failed", { error, supabase: error.supabase || null, item });
      this.setStatus("failed", error.message || "Delete Work Memory failed");
      throw error;
    }
  },
  async saveEcpTasksOnly(options = {}) {
    try {
      LocalCache.saveAll();
      if (hasGoogleOAuthSession() && !dataServiceHydrating && !migrationRunning) {
        dataServiceReady = true;
        this.setStatus("syncing");
        const rows = await SupabaseRepository.saveEcpTasks(ecpTasks());
        setEcpTasks(Array.isArray(rows) ? rows.map(row => row.name).filter(Boolean) : ecpTasks());
        LocalCache.saveAll();
        this.setStatus("synced");
      } else {
        const reason = !hasGoogleOAuthSession() ? "尚未登入 Zhuge AI OS" : "Cloud Sync 正在初始化";
        console.warn("ECP tasks saved to cache; cloud sync deferred", { reason, tasks: ecpTasks() });
        if (options.requireCloud) throw new Error(reason);
      }
    } catch (error) {
      console.error("Save ECP tasks failed", { error, supabase: error.supabase || null, tasks: ecpTasks() });
      this.setStatus("failed", error.message || "ECP task sync failed");
      if (options.requireCloud) throw error;
    }
  },
  async saveProfileSettingsOnly(options = {}) {
    try {
      LocalCache.saveAll();
      if (hasGoogleOAuthSession() && !dataServiceHydrating && !migrationRunning && profile) {
        dataServiceReady = true;
        this.setStatus("syncing");
        syncWorkProfileFromProfile();
        await SupabaseRepository.upsertUserProfile(profile);
        await SupabaseRepository.upsertExportSettings(profile);
        await SupabaseRepository.upsertWorkProfile(workProfile);
        LocalCache.saveAll();
        this.setStatus("synced");
      } else {
        const reason = !hasGoogleOAuthSession() ? "尚未登入 Zhuge AI OS" : "Cloud Sync 正在初始化";
        console.warn("Profile settings saved to cache; cloud sync deferred", { reason });
        if (options.requireCloud) throw new Error(reason);
      }
    } catch (error) {
      console.error("Save profile settings failed", { error, supabase: error.supabase || null });
      this.setStatus("failed", error.message || "Profile sync failed");
      if (options.requireCloud) throw error;
    }
  },
  async saveKnowledgeSource(item, options = {}) {
    const normalized = normalizedLibraryItem(item);
    try {
      if (hasGoogleOAuthSession() && !dataServiceHydrating && !migrationRunning) {
        dataServiceReady = true;
        this.setStatus("syncing");
        const saved = await KnowledgeRepository.saveSource(normalized, options.file || null);
        const cloudItem = knowledgeFromCloud(saved);
        setLibrary([cloudItem, ...library.filter(x => x.id !== normalized.id && x.cloudId !== cloudItem.cloudId)]);
        LocalCache.saveAll();
        this.setStatus("synced");
        return cloudItem;
      }
      throw new Error("Cloud Sync 尚未就緒，Knowledge Source 不可只儲存在本機");
    } catch (error) {
      console.error("Save knowledge source failed", { error, supabase: error.supabase || null, item: normalized });
      if (isKnowledgeNotInitializedError(error)) {
        knowledgeFoundationNotInitialized = true;
        this.setStatus("knowledge_uninitialized", "Knowledge Library 尚未初始化");
        throw new Error("Knowledge Library 尚未初始化，請先執行 P5 Knowledge Repository schema SQL");
      }
      this.setStatus("failed", error.message || "Knowledge sync failed");
      throw error;
    }
  },
  async deleteKnowledgeSource(item, options = {}) {
    const normalized = normalizedLibraryItem(item);
    try {
      if (hasGoogleOAuthSession() && !dataServiceHydrating && !migrationRunning) {
        dataServiceReady = true;
        this.setStatus("syncing");
        await KnowledgeRepository.deleteSource(normalized);
      } else if (options.requireCloud) {
        throw new Error("Cloud Sync 尚未就緒");
      }
      setLibrary(library.filter(x => x.id !== normalized.id));
      LocalCache.saveAll();
      this.setStatus("synced");
      return true;
    } catch (error) {
      console.error("Delete knowledge source failed", { error, supabase: error.supabase || null, item: normalized });
      if (isKnowledgeNotInitializedError(error)) {
        knowledgeFoundationNotInitialized = true;
        this.setStatus("knowledge_uninitialized", "Knowledge Library 尚未初始化");
        if (options.requireCloud) throw new Error("Knowledge Library 尚未初始化，請先執行 knowledge foundation schema SQL");
        return false;
      }
      this.setStatus("failed", error.message || "Knowledge delete failed");
      if (options.requireCloud) throw error;
      return false;
    }
  },
  async updateKnowledgeProcessing(item, patch = {}) {
    const normalized = normalizedLibraryItem(item);
    knowledgeDebugLog("warn", "Knowledge Process Call Stack Debug", {
      functionName: "DataService.updateKnowledgeProcessing",
      knowledgeId: normalized.knowledgeId,
      id: normalized.id,
      cloudId: normalized.cloudId,
      patchKeys: Object.keys(patch || {}),
      callStack: new Error("DataService.updateKnowledgeProcessing stack").stack
    });
    try {
      if (!hasGoogleOAuthSession() || dataServiceHydrating || migrationRunning) throw new Error("Cloud Sync 尚未就緒");
      dataServiceReady = true;
      this.setStatus("syncing");
      const saved = await KnowledgeRepository.updateSourceProcessing(normalized, patch);
      const cloudItem = knowledgeFromCloud(saved);
      setLibrary([cloudItem, ...library.filter(x => x.id !== normalized.id && x.cloudId !== cloudItem.cloudId)]);
      LocalCache.saveAll();
      this.setStatus("synced");
      return cloudItem;
    } catch (error) {
      console.error("Knowledge processing update failed", { error, supabase: error.supabase || null, item: normalized, patch });
      if (isKnowledgeNotInitializedError(error)) {
        knowledgeFoundationNotInitialized = true;
        this.setStatus("knowledge_uninitialized", "Knowledge Intelligence 尚未初始化");
        throw new Error("Knowledge Intelligence 尚未初始化，請先執行 P5.2 SQL");
      }
      this.setStatus("failed", error.message || "Knowledge processing update failed");
      throw error;
    }
  },
  async saveKnowledgeIntelligenceResult(item, result = {}) {
    const normalized = normalizedLibraryItem(item);
    const rawExtractedText = result.extractedText || "";
    const sanitizedExtractedText = sanitizeKnowledgeString(rawExtractedText);
    const sanitizeStats = knowledgeSanitizationStats(rawExtractedText, sanitizedExtractedText);
    const sanitizedSummary = sanitizeKnowledgeValue(result.summary || {});
    const sanitizedUnits = sanitizeKnowledgeValue(result.units || []);
    const sanitizedCandidates = sanitizeKnowledgeValue(result.candidates || []);
    const existingHistory = Array.isArray(normalized.sourceMetadata?.versionHistory)
      ? normalized.sourceMetadata.versionHistory
      : [];
    const currentVersion = String(normalized.knowledgeVersion || "v1.0");
    const versionMatch = currentVersion.match(/^v(\d+)(?:\.(\d+))?$/i);
    const hasPriorKnowledge = Boolean(normalized.extractedText || Object.keys(normalized.intelligenceSummary || {}).length || existingHistory.length);
    const nextKnowledgeVersion = !hasPriorKnowledge
      ? currentVersion
      : versionMatch
        ? `v${Number(versionMatch[1])}.${Number(versionMatch[2] || 0) + 1}`
        : "v1.1";
    const sourceKey = normalized.cloudId || normalized.id;
    const currentUnits = (typeof knowledgeUnits !== "undefined" ? knowledgeUnits : [])
      .filter(unit => String(unit.knowledgeSourceId || unit.knowledge_source_id || "") === String(sourceKey));
    const currentCandidates = (typeof knowledgeRecommendationCandidates !== "undefined" ? knowledgeRecommendationCandidates : [])
      .filter(candidate => String(candidate.knowledgeSourceId || candidate.knowledge_source_id || "") === String(sourceKey));
    const versionHistory = [...existingHistory];
    if (normalized.extractedText || Object.keys(normalized.intelligenceSummary || {}).length || currentUnits.length || currentCandidates.length) {
      versionHistory.push({
        version: currentVersion,
        savedAt: normalized.updatedAt || normalized.processedAt || new Date().toISOString(),
        extractedText: normalized.extractedText || "",
        intelligenceSummary: normalized.intelligenceSummary || {},
        units: currentUnits,
        candidates: currentCandidates
      });
    }
    const sourceMetadata = {
      ...(normalized.sourceMetadata || {}),
      versionHistory: versionHistory.slice(-10),
      lastLearningAt: new Date().toISOString()
    };
    knowledgeDebugLog("warn", "Knowledge Process Call Stack Debug", {
      functionName: "DataService.saveKnowledgeIntelligenceResult",
      knowledgeId: normalized.knowledgeId,
      id: normalized.id,
      cloudId: normalized.cloudId,
      resultKeys: Object.keys(result || {}),
      callStack: new Error("DataService.saveKnowledgeIntelligenceResult stack").stack
    });
    try {
      if (!hasGoogleOAuthSession() || dataServiceHydrating || migrationRunning) throw new Error("Cloud Sync 尚未就緒");
      dataServiceReady = true;
      this.setStatus("syncing");
      const processedAt = new Date().toISOString();
      knowledgeDebugLog("info", "Knowledge Intelligence Supabase Write Debug", {
        operation: "PATCH",
        table: "knowledge_sources",
        query: `?id=eq.${normalized.cloudId || normalized.id || ""}`,
        ...sanitizeStats,
        intelligenceSummaryKeys: Object.keys(sanitizedSummary || {}),
        knowledgeUnitsCount: sanitizedUnits.length,
        recommendationCandidatesCount: sanitizedCandidates.length
      });
      const source = await KnowledgeRepository.updateSourceProcessing(normalized, {
        processingStatus: "processed",
        extractedText: sanitizedExtractedText,
        intelligenceSummary: sanitizedSummary,
        sourceMetadata,
        intelligenceError: null,
        processedAt,
        indexedAt: processedAt,
        knowledgeVersion: nextKnowledgeVersion
      });
      const cloudItem = knowledgeFromCloud(source);
      const savedUnits = await KnowledgeRepository.replaceUnits(cloudItem, sanitizedUnits);
      const units = (savedUnits || []).map(knowledgeUnitFromCloud);
      const savedCandidates = await KnowledgeRepository.replaceRecommendationCandidates(cloudItem, sanitizedCandidates, units);
      const candidates = (savedCandidates || []).map(knowledgeRecommendationCandidateFromCloud);
      setLibrary([cloudItem, ...library.filter(x => x.id !== normalized.id && x.cloudId !== cloudItem.cloudId)]);
      knowledgeUnits = [...knowledgeUnits.filter(x => x.knowledgeSourceId !== cloudItem.cloudId), ...units];
      knowledgeRecommendationCandidates = [...knowledgeRecommendationCandidates.filter(x => x.knowledgeSourceId !== cloudItem.cloudId), ...candidates];
      LocalCache.saveAll();
      this.setStatus("synced");
      return { source: cloudItem, units, candidates };
    } catch (error) {
      console.error("Save Knowledge Intelligence result failed", {
        error,
        supabase: error.supabase || null,
        item: normalized,
        debug: {
          ...sanitizeStats,
          intelligenceSummaryKeys: Object.keys(sanitizedSummary || {}),
          knowledgeUnitsCount: sanitizedUnits.length,
          recommendationCandidatesCount: sanitizedCandidates.length
        }
      });
      if (isKnowledgeNotInitializedError(error)) {
        knowledgeFoundationNotInitialized = true;
        this.setStatus("knowledge_uninitialized", "Knowledge Intelligence 尚未初始化");
        throw new Error("Knowledge Intelligence 尚未初始化，請先執行 P5.2 SQL");
      }
      this.setStatus("failed", error.message || "Knowledge Intelligence sync failed");
      throw error;
    }
  },
  async rollbackKnowledgeVersion(item, requestedVersion = "") {
    const normalized = normalizedLibraryItem(item);
    const history = Array.isArray(normalized.sourceMetadata?.versionHistory)
      ? normalized.sourceMetadata.versionHistory
      : [];
    const snapshot = history.find(entry => String(entry.version || "") === String(requestedVersion))
      || history[Number(requestedVersion)]
      || null;
    if (!snapshot) throw new Error("找不到要還原的 Knowledge 版本");
    if (!hasGoogleOAuthSession() || dataServiceHydrating || migrationRunning) throw new Error("Cloud Sync 尚未就緒");
    const remainingHistory = history.filter(entry => entry !== snapshot);
    const metadata = {
      ...(normalized.sourceMetadata || {}),
      versionHistory: remainingHistory,
      rollbackFrom: normalized.knowledgeVersion || normalized.version || "",
      rollbackAt: new Date().toISOString()
    };
    const source = await KnowledgeRepository.updateSourceProcessing(normalized, {
      processingStatus: "processed",
      extractedText: snapshot.extractedText || "",
      intelligenceSummary: snapshot.intelligenceSummary || {},
      sourceMetadata: metadata,
      intelligenceError: null,
      processedAt: new Date().toISOString(),
      indexedAt: new Date().toISOString(),
      knowledgeVersion: snapshot.version || "v1.0"
    });
    const cloudItem = knowledgeFromCloud(source);
    const savedUnits = await KnowledgeRepository.replaceUnits(cloudItem, snapshot.units || []);
    const units = (savedUnits || []).map(knowledgeUnitFromCloud);
    const savedCandidates = await KnowledgeRepository.replaceRecommendationCandidates(cloudItem, snapshot.candidates || [], units);
    const candidates = (savedCandidates || []).map(knowledgeRecommendationCandidateFromCloud);
    setLibrary([cloudItem, ...library.filter(x => x.id !== normalized.id && x.cloudId !== cloudItem.cloudId)]);
    knowledgeUnits = [...knowledgeUnits.filter(x => x.knowledgeSourceId !== cloudItem.cloudId), ...units];
    knowledgeRecommendationCandidates = [...knowledgeRecommendationCandidates.filter(x => x.knowledgeSourceId !== cloudItem.cloudId), ...candidates];
    LocalCache.saveAll();
    return { source: cloudItem, units, candidates };
  },
  async verifyKnowledgeSource(item) {
    const verifiedAt = new Date().toISOString();
    const saved = await this.updateKnowledgeProcessing(item, { processingStatus: "verified", verifiedAt });
    knowledgeRecommendationCandidates = knowledgeRecommendationCandidates.map(candidate =>
      candidate.knowledgeSourceId === saved.cloudId ? { ...candidate, status: "verified" } : candidate
    );
    LocalCache.saveAll();
    return saved;
  },
  async removeKnowledgeUnit(id = "") {
    if (!id) return null;
    await KnowledgeRepository.updateUnitStatus(id, "archived");
    knowledgeUnits = knowledgeUnits.filter(unit => unit.id !== id && unit.cloudId !== id);
    LocalCache.saveAll();
    return true;
  },
  async removeKnowledgeRecommendationCandidate(id = "") {
    if (!id) return null;
    await KnowledgeRepository.updateRecommendationCandidateStatus(id, "archived");
    knowledgeRecommendationCandidates = knowledgeRecommendationCandidates.filter(candidate => candidate.id !== id && candidate.cloudId !== id);
    LocalCache.saveAll();
    return true;
  }
};

function mergeEntries(localEntries, cloudEntries) {
  const map = new Map();
  localEntries.forEach(entry => map.set(entry.id, entry));
  cloudEntries.forEach(entry => map.set(entry.id, { ...(map.get(entry.id) || {}), ...entry }));
  return [...map.values()].sort((a, b) => new Date(a.at) - new Date(b.at));
}
