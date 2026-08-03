// P5.2A-1 Foundation Split: Supabase-backed repositories.
const SupabaseRepository = {
  async requestError(path, options, res) {
    const body = await res.text().catch(() => "");
    let parsedBody = null;
    try { parsedBody = body ? JSON.parse(body) : null; } catch { parsedBody = null; }
    let payload = null;
    try { payload = options.body ? JSON.parse(options.body) : null; } catch { payload = options.body || null; }
    const details = {
      path,
      method: options.method || "GET",
      status: res.status,
      statusText: res.statusText,
      code: parsedBody?.code || "",
      message: parsedBody?.message || body || res.statusText,
      details: parsedBody?.details || "",
      hint: parsedBody?.hint || "",
      body,
      payload: summarizeKnowledgePayloadForLog(payload),
      user_uuid: currentUserUuid(),
      has_access_token: !!currentAccessToken(),
      access_token_expires_at: currentAccessTokenExpiresAtMs() ? new Date(currentAccessTokenExpiresAtMs()).toISOString() : ""
    };
    console.error("Supabase request failed", details);
    const error = new Error(`Supabase ${res.status}: ${details.message}`);
    error.supabase = details;
    return error;
  },
  shouldRefreshAfter(error) {
    const text = `${error?.supabase?.code || ""} ${error?.supabase?.message || ""} ${error?.supabase?.body || ""}`;
    return error?.supabase?.status === 401 && /jwt expired|PGRST303|expired/i.test(text);
  },
  async request(path, options = {}) {
    await ensureFreshAuthSession(false);
    const run = () => fetch(`${AUTH_CONFIG.supabaseUrl}/rest/v1/${path}`, {
      ...options,
      headers: cloudHeaders(options.headers || {})
    });
    let res = await run();
    if (!res.ok) {
      const firstError = await this.requestError(path, options, res);
      if (this.shouldRefreshAfter(firstError)) {
        await refreshAuthSession(true);
        res = await run();
        if (!res.ok) throw await this.requestError(path, options, res);
      } else {
        throw firstError;
      }
    }
    if (res.status === 204) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  },
  select(table, query = "") {
    return this.request(`${table}${query}`, { method: "GET" });
  },
  insert(table, payload) {
    return this.request(`${table}`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(payload) });
  },
  remove(table, query = "") {
    return this.request(`${table}${query}`, { method: "DELETE", headers: { Prefer: "return=representation" } });
  },
  async patch(table, query, payload) {
    const isKnowledgeSourcesPatch = table === "knowledge_sources";
    if (isKnowledgeSourcesPatch) {
      knowledgeDebugLog("warn", "Knowledge Sources PATCH Actual Call Debug", {
        table,
        query,
        callStack: new Error("knowledge_sources PATCH call stack").stack,
        payloadDebug: knowledgePatchPayloadDebug(payload)
      });
    }
    try {
      const result = await this.request(`${table}${query}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(payload) });
      if (isKnowledgeSourcesPatch) {
        knowledgeDebugLog("warn", "Knowledge Sources PATCH Actual Call Success", {
          table,
          query,
          returnedRows: Array.isArray(result) ? result.length : (result ? 1 : 0)
        });
      }
      return result;
    } catch (error) {
      if (isKnowledgeSourcesPatch) {
        knowledgeDebugLog("error", "Knowledge Sources PATCH Actual Call Failed", {
          table,
          query,
          callStack: new Error("knowledge_sources PATCH failed stack").stack,
          payloadDebug: knowledgePatchPayloadDebug(payload),
          supabase: error.supabase || null,
          error
        });
      }
      throw error;
    }
  },
  async storageRequest(path, options = {}) {
    await ensureFreshAuthSession(false);
    const run = () => fetch(`${AUTH_CONFIG.supabaseUrl}/storage/v1/${path}`, {
      ...options,
      headers: {
        apikey: AUTH_CONFIG.supabaseAnonKey,
        Authorization: `Bearer ${currentAccessToken() || AUTH_CONFIG.supabaseAnonKey}`,
        ...(options.headers || {})
      }
    });
    let res = await run();
    if (!res.ok) {
      const firstError = await this.requestError(`storage/v1/${path}`, options, res);
      if (this.shouldRefreshAfter(firstError)) {
        await refreshAuthSession(true);
        res = await run();
        if (!res.ok) throw await this.requestError(`storage/v1/${path}`, options, res);
      } else {
        throw firstError;
      }
    }
    if (res.status === 204) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  },
  encodeStoragePath(path = "") {
    return String(path || "").split("/").map(part => encodeURIComponent(part)).join("/");
  },
  async uploadKnowledgeFile(path = "", file = null) {
    if (!file) throw new Error("請選擇要上傳的正式檔案");
    return this.storageRequest(`object/${KNOWLEDGE_BUCKET}/${this.encodeStoragePath(path)}`, {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "x-upsert": "false"
      },
      body: file
    });
  },
  knowledgeStorageExtension(name = "") {
    const match = String(name || "").toLowerCase().match(/\.([a-z0-9]{1,12})$/);
    return match ? `.${match[1]}` : "";
  },
  knowledgeStorageObjectPath(file = null) {
    const uuid = currentUserUuid();
    if (!uuid) throw new Error("Cloud Sync 尚未就緒");
    const randomId = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^a-zA-Z0-9-]/g, "");
    return `${uuid}/${randomId}${this.knowledgeStorageExtension(file?.name || "")}`;
  },
  objectPathFromUploadResponse(response = {}, requestedPath = "") {
    const candidates = [
      response?.path,
      response?.fullPath,
      response?.full_path,
      response?.Key,
      response?.key,
      response?.name
    ].map(value => String(value || "").trim()).filter(Boolean);
    for (const raw of candidates) {
      let path = raw;
      const storagePrefix = `/storage/v1/object/${KNOWLEDGE_BUCKET}/`;
      const bucketPrefix = `${KNOWLEDGE_BUCKET}/`;
      if (path.includes(storagePrefix)) path = path.split(storagePrefix).pop();
      if (path.startsWith(bucketPrefix)) path = path.slice(bucketPrefix.length);
      path = path.replace(/^\/+/, "");
      if (path && path !== KNOWLEDGE_BUCKET) return path;
    }
    console.error("Knowledge Storage upload response missing object path", { response, requestedPath, storageBucket: KNOWLEDGE_BUCKET });
    throw new Error("Storage Upload 未回傳正式 Object Path，請稍後再試");
  },
  async deleteKnowledgeFile(path = "") {
    if (!path) return null;
    return this.storageRequest(`object/${KNOWLEDGE_BUCKET}/${this.encodeStoragePath(path)}`, { method: "DELETE" });
  },
  async signedKnowledgeFileUrl(path = "", expiresIn = 300) {
    if (!path) throw new Error("此知識來源尚無正式檔案");
    console.info("Knowledge Storage Download Debug", {
      databaseStoragePath: path,
      downloadStoragePath: path,
      storageBucket: KNOWLEDGE_BUCKET,
      storageObjectKey: path
    });
    const data = await this.storageRequest(`object/sign/${KNOWLEDGE_BUCKET}/${this.encodeStoragePath(path)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn })
    });
    const url = data?.signedURL || data?.signedUrl || data?.signed_url || "";
    if (!url) throw new Error("Storage 未回傳預覽連結");
    return url.startsWith("http") ? url : `${AUTH_CONFIG.supabaseUrl}/storage/v1${url}`;
  },
  async allocateKnowledgeId() {
    const rows = await this.request("rpc/next_knowledge_id", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({}) });
    if (typeof rows === "string") return rows;
    if (Array.isArray(rows)) return rows?.[0]?.next_knowledge_id || rows?.[0] || "";
    return rows?.next_knowledge_id || rows || "";
  },
  async upsertUserProfile(profileValue) {
    const work = parseWorkTimeRange(profileValue?.workHours);
    const lunch = parseWorkTimeRange(profileValue?.lunch || "12:00~13:00");
    const payload = {
      user_uuid: currentUserUuid(),
      display_name: session.name || "",
      email: session.email || "",
      role_code: roleCode(profileValue?.role || "採購"),
      work_start_time: work.start,
      work_end_time: work.end,
      lunch_start_time: lunch.start,
      lunch_end_time: lunch.end,
      timezone: "Asia/Taipei"
    };
    return this.request("user_profiles?on_conflict=user_uuid", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(payload) });
  },
  async loadUserProfile() {
    const rows = await this.select("user_profiles", "?select=*&limit=1");
    return rows?.[0] || null;
  },
  async upsertExportSettings(profileValue) {
    const payload = { user_uuid: currentUserUuid(), export_profile: "ecp", ecp_owner: profileValue?.ecpOwner || "", ecp_department: profileValue?.ecpDepartment || "" };
    return this.request("user_export_settings?on_conflict=user_uuid,export_profile", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(payload) });
  },
  async loadExportSettings() {
    const rows = await this.select("user_export_settings", "?select=*&export_profile=eq.ecp&limit=1");
    return rows?.[0] || null;
  },
  async upsertWorkProfile(value = {}) {
    const p = normalizeWorkProfile(value);
    const payload = {
      user_uuid: currentUserUuid(),
      ecp_responsible_person: p.ecpResponsiblePerson,
      ecp_department: p.ecpDepartment,
      default_task: p.defaultTask,
      default_work_model: p.defaultWorkModel,
      profile_completed: !!p.profileCompleted,
      profile_completed_at: p.profileCompletedAt || null,
      last_profile_check_date: p.lastProfileCheckDate || null,
      last_profile_prompt_date: p.lastProfilePromptDate || null,
      task_effective_month: p.taskEffectiveMonth || null,
      task_verified_at: p.taskVerifiedAt || null,
      expires_at: p.expiresAt || null
    };
    return this.request("user_work_profiles?on_conflict=user_uuid", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(payload) });
  },
  async loadWorkProfile() {
    const rows = await this.select("user_work_profiles", "?select=*&limit=1");
    return rows?.[0] || null;
  },
  async syncNameList(table, names, extra = {}) {
    const rows = await this.select(table, "?select=id,name,is_active,sort_order");
    const current = rows || [];
    const wanted = [...new Set((names || []).map(x => String(x).trim()).filter(Boolean))];
    for (const [index, name] of wanted.entries()) {
      const existing = current.find(row => row.name === name);
      const payload = { user_uuid: currentUserUuid(), name, is_active: true, sort_order: index, ...extra };
      if (existing) await this.patch(table, `?id=eq.${encodeURIComponent(existing.id)}`, payload);
      else await this.insert(table, payload);
    }
    for (const row of current) {
      if (row.is_active && !wanted.includes(row.name)) await this.patch(table, `?id=eq.${encodeURIComponent(row.id)}`, { is_active: false });
    }
    return this.select(table, "?select=*&is_active=eq.true&order=sort_order.asc,name.asc");
  },
  loadWorkModels() {
    return this.select("user_work_models", "?select=id,user_uuid,role_code,name,description,category,aliases,source,source_references,keywords,is_active,familiarity,last_used_at,sort_order,created_at,updated_at&order=sort_order.asc,name.asc");
  },
  async saveWorkModels(items, profileValue = profile) {
    const current = await this.loadWorkModels() || [];
    const normalized = (items || []).map((item, index) => normalizeWorkMemoryObject(item, index)).filter(item => item.name);
    const retainedIds = new Set();
    const retainedNames = new Set();
    for (const [index, item] of normalized.entries()) {
      const existing = current.find(row => (item.id && row.id === item.id) || row.name === item.name);
      const payload = {
        user_uuid: currentUserUuid(),
        role_code: roleCode(profileValue?.role || "採購"),
        name: item.name,
        description: item.description || "",
        category: item.category || "一般工作",
        aliases: item.aliases || [],
        source: item.source || "manual",
        source_references: item.sourceReferences || [],
        keywords: item.keywords || [],
        is_active: item.isActive !== false,
        familiarity: Math.min(5, Math.max(1, Number(item.familiarity || 1))),
        last_used_at: item.lastUsedAt || null,
        sort_order: index
      };
      if (existing) {
        await this.patch("user_work_models", `?id=eq.${encodeURIComponent(existing.id)}`, payload);
        retainedIds.add(existing.id);
      } else {
        const inserted = await this.insert("user_work_models", payload);
        if (inserted?.[0]?.id) retainedIds.add(inserted[0].id);
      }
      retainedNames.add(item.name);
    }
    for (const row of current) {
      if (!retainedIds.has(row.id) && !retainedNames.has(row.name) && row.is_active) {
        await this.patch("user_work_models", `?id=eq.${encodeURIComponent(row.id)}`, { is_active: false });
      }
    }
    return this.loadWorkModels();
  },
  deleteWorkModel(item = {}) {
    const id = item.id || item.cloudId;
    if (!id) throw new Error("缺少 Work Memory ID，無法刪除");
    return this.remove("user_work_models", `?id=eq.${encodeURIComponent(id)}`);
  },
  loadEcpTasks() {
    return this.select("user_ecp_tasks", "?select=*&is_active=eq.true&order=sort_order.asc,name.asc");
  },
  saveEcpTasks(names) {
    return this.syncNameList("user_ecp_tasks", names);
  },
  async ensureAssistantConversation() {
    if (!currentUserUuid() || !currentAccessToken()) throw new Error("Cloud Sync 尚未就緒");
    const payload = {
      user_uuid: currentUserUuid(),
      thread_key: "main",
      title: "Mr. KM",
      status: "active",
      updated_at: new Date().toISOString()
    };
    const rows = await this.request("assistant_conversations?on_conflict=user_uuid,thread_key", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(payload) });
    return rows?.[0] || null;
  },
  async loadAssistantConversation() {
    const conversation = await this.ensureAssistantConversation();
    const conversationId = conversation?.id;
    const messages = conversationId
      ? await this.select("assistant_messages", `?select=*&conversation_id=eq.${encodeURIComponent(conversationId)}&order=created_at.desc&limit=50`)
      : [];
    const states = await this.select("assistant_conversation_states", "?select=*&state_key=eq.main&limit=1");
    return { conversation, messages: (messages || []).slice().reverse(), state: states?.[0] || null };
  },
  async saveAssistantMessage(message = {}, channel = assistantChannel()) {
    if (!message || message.transient || message.role === "system") return null;
    const conversation = await this.ensureAssistantConversation();
    if (!conversation?.id) throw new Error("Conversation 尚未就緒");
    const payload = {
      user_uuid: currentUserUuid(),
      conversation_id: conversation.id,
      client_message_id: message.id || uid("msg"),
      role: message.role || "assistant",
      content: String(message.text || ""),
      card: message.card || null,
      channel,
      created_at: message.at || new Date().toISOString()
    };
    const rows = await this.request("assistant_messages?on_conflict=user_uuid,client_message_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(payload) });
    return rows?.[0] || null;
  },
  async saveAssistantState(command = null, channel = assistantChannel()) {
    if (!currentUserUuid() || !currentAccessToken()) throw new Error("Cloud Sync 尚未就緒");
    const conversation = await this.ensureAssistantConversation();
    const payload = {
      user_uuid: currentUserUuid(),
      conversation_id: conversation?.id || null,
      state_key: "main",
      state_type: command ? (command.action || "pending_action") : "idle",
      pending_action: command || null,
      channel,
      updated_at: new Date().toISOString()
    };
    const rows = await this.request("assistant_conversation_states?on_conflict=user_uuid,state_key", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(payload) });
    return rows?.[0] || null;
  },
  async hasCloudCoreData() {
    const checks = await Promise.allSettled([
      this.select("user_profiles", "?select=user_uuid&limit=1"),
      this.select("user_work_models", "?select=id&limit=1"),
      this.select("user_ecp_tasks", "?select=id&limit=1"),
      this.select("user_export_settings", "?select=id&limit=1"),
      this.select("work_entries", "?select=id&status=neq.deleted&limit=1")
    ]);
    return checks.some(result => result.status === "fulfilled" && Array.isArray(result.value) && result.value.length > 0);
  },
  async loadEntries(month = monthKey()) {
    const rows = await this.select("work_entries", `?select=*&work_date=gte.${month}-01&work_date=lt.${nextMonthKey(month)}-01&status=neq.deleted&order=started_at.asc`);
    return rows || [];
  },
  async loadMigration(key = CLOUD_MIGRATION_KEY) {
    const rows = await this.select("sync_migrations", `?select=*&migration_key=eq.${encodeURIComponent(key)}&limit=1`);
    return rows?.[0] || null;
  },
  async completeMigration(sourceHash, key = CLOUD_MIGRATION_KEY) {
    const payload = { user_uuid: currentUserUuid(), migration_key: key, source_hash: sourceHash, completed_at: new Date().toISOString() };
    return this.request("sync_migrations?on_conflict=user_uuid,migration_key", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(payload) });
  },
  async saveEntry(entry) {
    if (!currentUserUuid() || !currentAccessToken()) throw new Error("Cloud Sync 尚未就緒");
    const ecpRows = await this.loadEcpTasks();
    const ecpTask = ecpRows.find(row => row.name === entry.ecpTask);
    const existing = entry.cloudId ? [{ id: entry.cloudId }] : await this.select("work_entries", `?select=id&legacy_id=eq.${encodeURIComponent(entry.id)}&limit=1`);
    const started = parseTaipeiBusinessDateTime(entry.at);
    const ended = new Date(started.getTime() + Math.round(Number(entry.hours || 0) * 60) * 60000);
    const payload = {
      user_uuid: currentUserUuid(),
      work_date: entry.date || String(entry.at || "").slice(0, 10),
      started_at: started.toISOString(),
      ended_at: ended.toISOString(),
      hours: Number(entry.hours || 0),
      title: entry.title || "",
      note: entry.note || "",
      event_type: eventTypeCode(entry.entryType || entry.type || "work"),
      status: entry.status || "completed",
      source: entry.source || "manual",
      ecp_task_id: ecpTask?.id || null,
      ecp_task_name_snapshot: entry.ecpTask || "",
      legacy_id: entry.id
    };
    const saved = existing?.[0]?.id
      ? await this.patch("work_entries", `?id=eq.${encodeURIComponent(existing[0].id)}`, payload)
      : await this.insert("work_entries", payload);
    if (!saved?.[0]?.id) {
      console.error("Supabase saveEntry returned empty response", { payload, saved, user_uuid: currentUserUuid(), has_access_token: !!currentAccessToken() });
      throw new Error("Supabase work_entries 未回傳儲存結果");
    }
    return saved[0];
  },
  async deleteEntry(entry) {
    if (!currentUserUuid() || !currentAccessToken()) throw new Error("Cloud Sync 尚未就緒");
    const existing = entry.cloudId ? [{ id: entry.cloudId }] : await this.select("work_entries", `?select=id&legacy_id=eq.${encodeURIComponent(entry.id)}&limit=1`);
    if (!existing?.[0]?.id) return null;
    return this.patch("work_entries", `?id=eq.${encodeURIComponent(existing[0].id)}`, { status: "deleted", deleted_at: new Date().toISOString() });
  },
  loadKnowledgeSources() {
    return this.select("knowledge_sources", "?select=*&deleted_at=is.null&order=created_at.desc");
  },
  async saveKnowledgeSource(item, file = null) {
    if (!currentUserUuid() || !currentAccessToken()) throw new Error("Cloud Sync 尚未就緒");
    const isNew = !item.cloudId;
    const knowledgeId = item.knowledgeId || (isNew ? await this.allocateKnowledgeId() : "");
    if (!knowledgeId) throw new Error("無法產生 Knowledge ID");
    const version = item.version || "v1.0";
    const sourceProvider = item.sourceProvider || item.source_provider || "upload";
    const persistBinary = sourceProvider !== "google_drive";
    let storagePath = item.storagePath || "";
    let uploadedPath = "";
    let uploadResponse = null;
    if (file && persistBinary) {
      const requestedStoragePath = this.knowledgeStorageObjectPath(file);
      uploadResponse = await this.uploadKnowledgeFile(requestedStoragePath, file);
      storagePath = this.objectPathFromUploadResponse(uploadResponse, requestedStoragePath);
      uploadedPath = storagePath;
      console.info("Knowledge Storage Upload Debug", {
        knowledgeId,
        filename: file.name || item.filename || "",
        requestedStoragePath,
        storageBucket: KNOWLEDGE_BUCKET,
        uploadResponse,
        resolvedStoragePath: storagePath
      });
    }
    const payload = {
      user_uuid: currentUserUuid(),
      organization_id: item.organizationId || null,
      tenant_id: item.tenantId || null,
      knowledge_id: knowledgeId,
      title: item.title,
      description: item.description || "",
      category: item.category || "其他",
      scope: normalizeKnowledgeScope(item.scope),
      source_type: item.sourceType || inferKnowledgeSourceType(file?.name || item.filename || storagePath),
      source_provider: sourceProvider,
      external_file_id: item.externalFileId || item.external_file_id || null,
      source_modified_at: item.sourceModifiedAt || item.source_modified_at || null,
      source_metadata: item.sourceMetadata || item.source_metadata || {},
      source_name: item.sourceName || file?.name || item.filename || "",
      source_url: item.sourceUrl || "",
      storage_path: storagePath,
      mime_type: (persistBinary ? file?.type : "") || item.mimeType || "",
      file_size: (persistBinary ? file?.size : 0) || item.fileSize || null,
      applicable_agents: item.applicableAgents || [],
      related_roles: item.relatedRoles || [],
      related_work_models: item.relatedWorkModels || [],
      tags: item.tags || [],
      triggers: item.triggers || [],
      processing_status: item.processingStatus || "uploaded",
      extracted_text: item.extractedText || item.extracted_text || null,
      intelligence_summary: item.intelligenceSummary || item.intelligence_summary || {},
      intelligence_error: item.intelligenceError || item.intelligence_error || null,
      processed_at: item.processedAt || item.processed_at || null,
      verified_at: item.verifiedAt || item.verified_at || null,
      version,
      source_version: item.sourceVersion || version,
      knowledge_version: item.knowledgeVersion || item.knowledge_version || "v1.0",
      indexed_at: item.indexedAt || item.indexed_at || null,
      filename: file?.name || item.filename || "",
      legacy_id: item.id || null,
      created_by: currentUserUuid(),
      updated_by: currentUserUuid(),
      updated_at: new Date().toISOString()
    };
    const existing = item.cloudId ? [{ id: item.cloudId }] : await this.select("knowledge_sources", `?select=id&legacy_id=eq.${encodeURIComponent(item.id)}&limit=1`);
    try {
      const saved = existing?.[0]?.id
        ? await this.patch("knowledge_sources", `?id=eq.${encodeURIComponent(existing[0].id)}`, payload)
        : await this.insert("knowledge_sources", payload);
      if (!saved?.[0]?.id) throw new Error("Supabase knowledge_sources 未回傳儲存結果");
      console.info("Knowledge Storage Database Debug", {
        knowledgeId,
        filename: payload.filename,
        uploadResponse,
        databaseStoragePath: saved[0].storage_path,
        storageBucket: KNOWLEDGE_BUCKET,
        storageObjectKey: saved[0].storage_path
      });
      return saved[0];
    } catch (error) {
      if (uploadedPath) {
        await this.deleteKnowledgeFile(uploadedPath).catch(cleanupError => console.warn("Knowledge orphan upload cleanup failed", { uploadedPath, cleanupError }));
      }
      throw error;
    }
  },
  async findKnowledgeSourceByExternalFile(sourceProvider = "", externalFileId = "") {
    if (!sourceProvider || !externalFileId) return null;
    const rows = await this.select(
      "knowledge_sources",
      `?select=*&source_provider=eq.${encodeURIComponent(sourceProvider)}&external_file_id=eq.${encodeURIComponent(externalFileId)}&deleted_at=is.null&limit=1`
    );
    return Array.isArray(rows) ? (rows[0] || null) : null;
  },
  async deleteKnowledgeSource(item) {
    if (!currentUserUuid() || !currentAccessToken()) throw new Error("Cloud Sync 尚未就緒");
    const existing = item.cloudId ? [{ id: item.cloudId }] : await this.select("knowledge_sources", `?select=id&legacy_id=eq.${encodeURIComponent(item.id)}&limit=1`);
    if (!existing?.[0]?.id) return null;
    return this.patch("knowledge_sources", `?id=eq.${encodeURIComponent(existing[0].id)}`, { deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  },
  async updateKnowledgeSourceProcessing(item, patch = {}) {
    if (!currentUserUuid() || !currentAccessToken()) throw new Error("Cloud Sync 尚未就緒");
    const sourceId = item.cloudId || item.id;
    if (!sourceId) throw new Error("Knowledge Source 缺少 Cloud ID");
    const payload = {
      ...(patch.processingStatus ? { processing_status: patch.processingStatus } : {}),
      ...(patch.extractedText !== undefined ? { extracted_text: patch.extractedText } : {}),
      ...(patch.intelligenceSummary !== undefined ? { intelligence_summary: patch.intelligenceSummary || {} } : {}),
      ...(patch.intelligenceError !== undefined ? { intelligence_error: patch.intelligenceError || null } : {}),
      ...(patch.sourceMetadata !== undefined ? { source_metadata: patch.sourceMetadata || {} } : {}),
      ...(patch.processedAt !== undefined ? { processed_at: patch.processedAt || null } : {}),
      ...(patch.verifiedAt !== undefined ? { verified_at: patch.verifiedAt || null } : {}),
      indexed_at: patch.indexedAt !== undefined ? (patch.indexedAt || null) : undefined,
      knowledge_version: patch.knowledgeVersion !== undefined ? (patch.knowledgeVersion || "v1.0") : undefined,
      updated_at: new Date().toISOString(),
      updated_by: currentUserUuid()
    };
    Object.keys(payload).forEach(key => payload[key] === undefined && delete payload[key]);
    const query = `?id=eq.${encodeURIComponent(sourceId)}`;
    knowledgeDebugLog("info", "PATCH Payload Debug", {
      operation: "PATCH",
      table: "knowledge_sources",
      query: `?id=eq.${sourceId}`,
      ...knowledgePatchPayloadDebug(payload)
    });
    const patchOrder = [
      "extracted_text",
      "intelligence_summary",
      "intelligence_error",
      "source_metadata",
      "processed_at",
      "verified_at",
      "indexed_at",
      "knowledge_version",
      "processing_status"
    ].filter(field => Object.prototype.hasOwnProperty.call(payload, field));
    const metaPayload = {
      updated_at: payload.updated_at,
      updated_by: payload.updated_by
    };
    let rows = null;
    for (let index = 0; index < patchOrder.length; index += 1) {
      const field = patchOrder[index];
      const fieldPayload = { [field]: payload[field], ...metaPayload };
      knowledgeDebugLog("info", "Knowledge PATCH Step Debug", {
        step: index + 1,
        field,
        table: "knowledge_sources",
        query: `?id=eq.${sourceId}`,
        fieldDebug: knowledgePayloadFieldDebug(payload[field])
      });
      try {
        rows = await this.patch("knowledge_sources", query, fieldPayload);
        knowledgeDebugLog("info", "Knowledge PATCH Step Success", {
          step: index + 1,
          field,
          status: "success"
        });
      } catch (error) {
        knowledgeDebugLog("error", "Knowledge PATCH Step Failed", {
          step: index + 1,
          field,
          fieldDebug: knowledgePayloadFieldDebug(payload[field]),
          supabase: error.supabase || null,
          error
        });
        throw error;
      }
    }
    if (!patchOrder.length) rows = await this.patch("knowledge_sources", query, payload);
    return rows?.[0] || null;
  },
  loadKnowledgeUnits(sourceId = "") {
    const filter = sourceId ? `&knowledge_source_id=eq.${encodeURIComponent(sourceId)}` : "";
    return this.select("knowledge_units", `?select=*&status=neq.archived${filter}&order=priority.asc,created_at.asc`);
  },
  async replaceKnowledgeUnits(source, units = []) {
    if (!currentUserUuid() || !currentAccessToken()) throw new Error("Cloud Sync 尚未就緒");
    const sourceId = source.cloudId || source.id;
    if (!sourceId) throw new Error("Knowledge Source 缺少 Cloud ID");
    const existing = await this.loadKnowledgeUnits(sourceId).catch(() => []);
    for (const row of existing || []) {
      await this.patch("knowledge_units", `?id=eq.${encodeURIComponent(row.id)}`, { status: "archived" });
    }
    const payloads = units.map(unit => ({
      user_uuid: currentUserUuid(),
      knowledge_source_id: sourceId,
      unit_type: unit.unitType || unit.unit_type || "reference",
      title: unit.title || "Knowledge Unit",
      content: unit.content || "",
      summary: unit.summary || "",
      section_reference: unit.sectionReference || unit.section_reference || "",
      page_reference: unit.pageReference || unit.page_reference || "",
      triggers: unit.triggers || [],
      applicable_roles: unit.applicableRoles || unit.applicable_roles || [],
      applicable_agents: unit.applicableAgents || unit.applicable_agents || [],
      related_work_models: unit.relatedWorkModels || unit.related_work_models || [],
      suggested_skills: unit.suggestedSkills || unit.suggested_skills || [],
      priority: unit.priority || "medium",
      confidence: unit.confidence == null ? null : Number(unit.confidence),
      version: unit.version || source.version || "v1.0",
      status: unit.status || "active"
    }));
    if (!payloads.length) return [];
    knowledgeDebugLog("info", "Knowledge INSERT Payload Debug", {
      operation: "INSERT",
      table: "knowledge_units",
      rowCount: payloads.length,
      sampleKeys: Object.keys(payloads[0] || {}),
      rows: payloads.map((row, index) => ({ index: index + 1, ...knowledgePatchPayloadDebug(row) }))
    });
    return this.insert("knowledge_units", payloads);
  },
  updateKnowledgeUnitStatus(id = "", status = "archived") {
    return this.patch("knowledge_units", `?id=eq.${encodeURIComponent(id)}`, { status });
  },
  loadKnowledgeRecommendationCandidates(sourceId = "") {
    const filter = sourceId ? `&knowledge_source_id=eq.${encodeURIComponent(sourceId)}` : "";
    return this.select("knowledge_recommendation_candidates", `?select=*&status=neq.archived${filter}&order=priority.asc,created_at.asc`);
  },
  async replaceKnowledgeRecommendationCandidates(source, candidates = [], units = []) {
    if (!currentUserUuid() || !currentAccessToken()) throw new Error("Cloud Sync 尚未就緒");
    const sourceId = source.cloudId || source.id;
    if (!sourceId) throw new Error("Knowledge Source 缺少 Cloud ID");
    const existing = await this.loadKnowledgeRecommendationCandidates(sourceId).catch(() => []);
    for (const row of existing || []) {
      await this.patch("knowledge_recommendation_candidates", `?id=eq.${encodeURIComponent(row.id)}`, { status: "archived" });
    }
    const unitByLocalId = new Map((units || []).map(unit => [unit.localId || unit.id || unit.title, unit]));
    const payloads = candidates.map(candidate => {
      const unit = unitByLocalId.get(candidate.sourceUnitLocalId || candidate.source_unit_local_id || candidate.sourceUnitId || candidate.source_unit_id || candidate.title);
      return {
        user_uuid: currentUserUuid(),
        knowledge_source_id: sourceId,
        knowledge_unit_id: candidate.knowledgeUnitId || candidate.knowledge_unit_id || unit?.cloudId || unit?.id || null,
        type: "recommendation",
        title: candidate.title || "建議工作",
        content: candidate.content || candidate.summary || "",
        source_knowledge_id: source.knowledgeId || source.knowledge_id || "",
        source_unit_id: candidate.sourceUnitId || candidate.source_unit_id || unit?.cloudId || unit?.id || null,
        default_duration: Number(candidate.defaultDuration || candidate.default_duration || 1),
        applicable_role: candidate.applicableRole || candidate.applicable_role || "",
        triggers: candidate.triggers || [],
        related_work_models: candidate.relatedWorkModels || candidate.related_work_models || [],
        status: candidate.status || "candidate",
        priority: candidate.priority || "medium",
        confidence: candidate.confidence == null ? null : Number(candidate.confidence),
        version: candidate.version || source.version || "v1.0"
      };
    });
    if (!payloads.length) return [];
    knowledgeDebugLog("info", "Knowledge INSERT Payload Debug", {
      operation: "INSERT",
      table: "knowledge_recommendation_candidates",
      rowCount: payloads.length,
      sampleKeys: Object.keys(payloads[0] || {}),
      rows: payloads.map((row, index) => ({ index: index + 1, ...knowledgePatchPayloadDebug(row) }))
    });
    return this.insert("knowledge_recommendation_candidates", payloads);
  },
  updateKnowledgeRecommendationCandidateStatus(id = "", status = "archived") {
    return this.patch("knowledge_recommendation_candidates", `?id=eq.${encodeURIComponent(id)}`, { status });
  }
};

const ConversationRepository = {
  load() {
    return SupabaseRepository.loadAssistantConversation();
  },
  saveMessage(message = {}, channel = assistantChannel()) {
    return SupabaseRepository.saveAssistantMessage(message, channel);
  },
  saveState(command = null, channel = assistantChannel()) {
    return SupabaseRepository.saveAssistantState(command, channel);
  }
};

const KnowledgeRepository = {
  loadSources() {
    return SupabaseRepository.loadKnowledgeSources();
  },
  saveSource(item = {}, file = null) {
    return SupabaseRepository.saveKnowledgeSource(item, file);
  },
  findSourceByExternalFile(sourceProvider = "", externalFileId = "") {
    return SupabaseRepository.findKnowledgeSourceByExternalFile(sourceProvider, externalFileId);
  },
  deleteSource(item = {}) {
    return SupabaseRepository.deleteKnowledgeSource(item);
  },
  signedSourceUrl(path = "", expiresIn = 300) {
    return SupabaseRepository.signedKnowledgeFileUrl(path, expiresIn);
  },
  updateSourceProcessing(item = {}, patch = {}) {
    knowledgeDebugLog("warn", "Knowledge Process Call Stack Debug", {
      functionName: "KnowledgeRepository.updateSourceProcessing",
      knowledgeId: item.knowledgeId,
      id: item.id,
      cloudId: item.cloudId,
      patchKeys: Object.keys(patch || {}),
      callStack: new Error("KnowledgeRepository.updateSourceProcessing stack").stack
    });
    return SupabaseRepository.updateKnowledgeSourceProcessing(item, patch);
  },
  loadUnits(sourceId = "") {
    return SupabaseRepository.loadKnowledgeUnits(sourceId);
  },
  replaceUnits(source = {}, units = []) {
    return SupabaseRepository.replaceKnowledgeUnits(source, units);
  },
  updateUnitStatus(id = "", status = "archived") {
    return SupabaseRepository.updateKnowledgeUnitStatus(id, status);
  },
  loadRecommendationCandidates(sourceId = "") {
    return SupabaseRepository.loadKnowledgeRecommendationCandidates(sourceId);
  },
  replaceRecommendationCandidates(source = {}, candidates = [], units = []) {
    return SupabaseRepository.replaceKnowledgeRecommendationCandidates(source, candidates, units);
  },
  updateRecommendationCandidateStatus(id = "", status = "archived") {
    return SupabaseRepository.updateKnowledgeRecommendationCandidateStatus(id, status);
  }
};
