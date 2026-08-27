/* Sprint 7: Cloud-first realtime projection for Tasks and WorkLog. */
(function (global) {
  let client = null;
  let channel = null;
  let refreshTimer = null;
  let refreshInFlight = false;

  function scheduleRefresh(table) {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      if (refreshInFlight || !hasGoogleOAuthSession()) return;
      refreshInFlight = true;
      try {
        if (table === "user_tasks") {
          const rows = await SupabaseRepository.loadTasks({ includeArchived: true });
          setTasksFromCloud(rows);
        } else if (table === "work_entries") {
          const rows = await SupabaseRepository.loadEntries(selectedMonth);
          setEntries(Array.isArray(rows) ? rows.map(entryFromCloud) : []);
        } else if (table === "work_journal_entries") {
          const rows = await SupabaseRepository.loadWorkJournal();
          setWorkJournalFromCloud(rows);
        } else if (table === "worktodo_checklist_items" || table === "worktodo_attachments") {
          if (typeof refreshWorkTodoDrawerCapabilities === "function") await refreshWorkTodoDrawerCapabilities();
        }
        LocalCache.saveAll();
        if (typeof refreshRealtimeSurface === "function") refreshRealtimeSurface(table);
        else if (typeof refreshCloudSyncStatusDisplay === "function") refreshCloudSyncStatusDisplay();
      } catch (error) {
        console.warn("Realtime refresh deferred", { table, error: error?.message || error });
      } finally {
        refreshInFlight = false;
      }
    }, 180);
  }

  async function start() {
    if (channel || !hasGoogleOAuthSession() || !global.supabase?.createClient) return false;
    const token = currentAccessToken();
    const userId = currentUserUuid();
    if (!token || !userId) return false;
    client = global.supabase.createClient(AUTH_CONFIG.supabaseUrl, AUTH_CONFIG.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
    await client.realtime.setAuth(token);
    channel = client.channel(`zhuge-work-lifecycle-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "work_entries", filter: `user_uuid=eq.${userId}` }, () => scheduleRefresh("work_entries"))
      .on("postgres_changes", { event: "*", schema: "public", table: "worktodo_checklist_items", filter: `user_uuid=eq.${userId}` }, () => scheduleRefresh("worktodo_checklist_items"))
      .on("postgres_changes", { event: "*", schema: "public", table: "worktodo_attachments", filter: `user_uuid=eq.${userId}` }, () => scheduleRefresh("worktodo_attachments"));
    const status = await new Promise(resolve => {
      channel.subscribe(value => resolve(value));
    });
    if (status !== "SUBSCRIBED") {
      console.warn("Realtime subscription unavailable", { status });
      await stop();
      return false;
    }
    return true;
  }

  async function stop() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = null;
    if (client && channel) await client.removeChannel(channel);
    channel = null;
    client = null;
  }

  global.RealtimeService = Object.freeze({ start, stop, isActive: () => !!channel });
})(window);
