(() => {
  const STATUS = [
    { key: 'inbox', label: 'Inbox', zh: '收件匣' },
    { key: 'ready', label: 'Ready', zh: '待執行' },
    { key: 'inprogress', label: 'In Progress', zh: '進行中' },
    { key: 'qa', label: 'QA', zh: '待驗收' },
    { key: 'done', label: 'Done', zh: '已完成' },
  ];

  const state = {
    client: null,
    tasks: [],
    filtered: [],
    subscription: null,
    view: 'board',
    dragTaskId: null,
    polling: null,
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    board: $('board'),
    taskCountSide: $('taskCountSide'),
    statusBanner: $('statusBanner'),
    connectionDot: $('connectionDot'),
    connectionLabel: $('connectionLabel'),
    connectionBtn: $('connectionBtn'),
    refreshBtn: $('refreshBtn'),
    newTaskBtn: $('newTaskBtn'),
    globalSearch: $('globalSearch'),
    moduleFilter: $('moduleFilter'),
    priorityFilter: $('priorityFilter'),
    assigneeFilter: $('assigneeFilter'),
    clearFiltersBtn: $('clearFiltersBtn'),
    boardView: $('boardView'),
    allView: $('allView'),
    allTasksBody: $('allTasksBody'),
    allCount: $('allCount'),
    modalBackdrop: $('modalBackdrop'),
    taskDrawer: $('taskDrawer'),
    closeDrawerBtn: $('closeDrawerBtn'),
    cancelTaskBtn: $('cancelTaskBtn'),
    taskForm: $('taskForm'),
    deleteTaskBtn: $('deleteTaskBtn'),
    taskId: $('taskId'),
    taskTitle: $('taskTitle'),
    taskModule: $('taskModule'),
    taskStatus: $('taskStatus'),
    taskPriority: $('taskPriority'),
    taskAssignee: $('taskAssignee'),
    taskSource: $('taskSource'),
    taskDescription: $('taskDescription'),
    taskCreatedBy: $('taskCreatedBy'),
    createdAtText: $('createdAtText'),
    updatedAtText: $('updatedAtText'),
    drawerTitle: $('drawerTitle'),
    connectionModal: $('connectionModal'),
    closeConnectionBtn: $('closeConnectionBtn'),
    supabaseUrl: $('supabaseUrl'),
    supabaseKey: $('supabaseKey'),
    connectionTest: $('connectionTest'),
    testConnectionBtn: $('testConnectionBtn'),
    saveConnectionBtn: $('saveConnectionBtn'),
    clearConnectionBtn: $('clearConnectionBtn'),
  };

  function escapeHtml(value = '') {
    return String(value).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  function prettyDate(value) {
    if (!value) return '—';
    try {
      return new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
    } catch { return value; }
  }

  function setBanner(message = '', type = 'info') {
    els.statusBanner.textContent = message;
    els.statusBanner.className = `status-banner ${message ? type : 'hidden'}`;
  }

  function setConnectionStatus(mode, text) {
    els.connectionDot.className = 'dot' + (mode === 'ok' ? ' ok' : mode === 'loading' ? ' loading' : '');
    els.connectionLabel.textContent = text;
  }

  function getConfig() {
    return {
      url: localStorage.getItem('zhuge_board_supabase_url') || '',
      key: localStorage.getItem('zhuge_board_supabase_key') || '',
    };
  }

  function saveConfig(url, key) {
    localStorage.setItem('zhuge_board_supabase_url', url.trim());
    localStorage.setItem('zhuge_board_supabase_key', key.trim());
  }

  function clearConfig() {
    localStorage.removeItem('zhuge_board_supabase_url');
    localStorage.removeItem('zhuge_board_supabase_key');
  }

  function openConnection() {
    const cfg = getConfig();
    els.supabaseUrl.value = cfg.url;
    els.supabaseKey.value = cfg.key;
    els.connectionTest.textContent = '';
    els.connectionTest.className = 'connection-test';
    els.connectionModal.classList.remove('hidden');
    els.modalBackdrop.classList.remove('hidden');
  }

  function closeConnection() {
    els.connectionModal.classList.add('hidden');
    if (els.taskDrawer.classList.contains('hidden')) els.modalBackdrop.classList.add('hidden');
  }

  async function createClientFromConfig() {
    const { url, key } = getConfig();
    if (!url || !key) {
      state.client = null;
      state.tasks = [];
      setConnectionStatus('off', '尚未連線 Supabase');
      setBanner('請先設定 Supabase Project URL 與 Anon / Publishable Key。Prototype 不顯示假資料。', 'info');
      render();
      return false;
    }
    if (!window.supabase?.createClient) {
      setBanner('Supabase JS 載入失敗，請確認網路連線。', 'error');
      return false;
    }

    setConnectionStatus('loading', '連線中...');
    state.client = window.supabase.createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    return true;
  }

  async function testConnection(url, key) {
    if (!url || !key) throw new Error('Project URL 與 Key 都必須填寫。');
    const client = window.supabase.createClient(url.trim(), key.trim(), {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await client.from('board_tasks').select('id,title,status').limit(1);
    if (error) throw error;
    return Array.isArray(data);
  }

  async function loadTasks({ quiet = false } = {}) {
    if (!state.client) return;
    if (!quiet) setBanner('正在從 Supabase 載入 board_tasks...', 'info');
    const { data, error } = await state.client
      .from('board_tasks')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) {
      setConnectionStatus('off', 'Supabase 讀取失敗');
      setBanner(`讀取 board_tasks 失敗：${error.message}`, 'error');
      return;
    }
    state.tasks = data || [];
    setConnectionStatus('ok', `Supabase 已連線｜${state.tasks.length} 筆`);
    if (!quiet) setBanner(`已讀取 ${state.tasks.length} 筆真實資料。`, 'ok');
    buildFilters();
    applyFilters();
  }

  function normalizeStatus(status) {
    const s = (status || '').toLowerCase().replace(/\s|_|-/g, '');
    if (s === 'inprogress' || s === 'doing') return 'inprogress';
    if (s === 'review' || s === 'readyforqa' || s === 'qa') return 'qa';
    if (s === 'todo' || s === 'backlog' || s === 'inbox') return s === 'inbox' ? 'inbox' : 'ready';
    if (s === 'complete' || s === 'completed' || s === 'done') return 'done';
    if (s === 'ready') return 'ready';
    return 'inbox';
  }

  function buildFilters() {
    const modules = [...new Set(state.tasks.map(t => t.module).filter(Boolean))].sort();
    const assignees = [...new Set(state.tasks.map(t => t.assignee).filter(Boolean))].sort();
    const moduleCurrent = els.moduleFilter.value;
    const assigneeCurrent = els.assigneeFilter.value;

    els.moduleFilter.innerHTML = '<option value="">所有模組</option>' + modules.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
    els.assigneeFilter.innerHTML = '<option value="">所有負責人</option>' + assignees.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
    els.moduleFilter.value = modules.includes(moduleCurrent) ? moduleCurrent : '';
    els.assigneeFilter.value = assignees.includes(assigneeCurrent) ? assigneeCurrent : '';
  }

  function applyFilters() {
    const q = els.globalSearch.value.trim().toLowerCase();
    const moduleValue = els.moduleFilter.value;
    const priorityValue = els.priorityFilter.value;
    const assigneeValue = els.assigneeFilter.value;

    state.filtered = state.tasks.filter(t => {
      const hay = [t.title, t.description, t.module, t.priority, t.assignee, t.source]
        .filter(Boolean).join(' ').toLowerCase();
      return (!q || hay.includes(q))
        && (!moduleValue || t.module === moduleValue)
        && (!priorityValue || (t.priority || '').toLowerCase() === priorityValue)
        && (!assigneeValue || t.assignee === assigneeValue);
    });
    render();
  }

  function taskCard(task) {
    const priority = (task.priority || 'medium').toLowerCase();
    return `
      <article class="task-card" draggable="true" data-id="${escapeHtml(task.id)}">
        <div class="card-top">
          <h3 class="card-title">${escapeHtml(task.title)}</h3>
          <span class="priority ${escapeHtml(priority)}">${escapeHtml(priority)}</span>
        </div>
        ${task.description ? `<p class="card-desc">${escapeHtml(task.description)}</p>` : ''}
        <div class="card-meta">
          ${task.module ? `<span class="chip">${escapeHtml(task.module)}</span>` : ''}
          ${task.source ? `<span class="chip">來源：${escapeHtml(task.source)}</span>` : ''}
        </div>
        <div class="card-foot">
          <span class="source">${escapeHtml(prettyDate(task.updated_at || task.created_at))}</span>
          <span class="assignee">${escapeHtml(task.assignee || '未指派')}</span>
        </div>
      </article>`;
  }

  function renderBoard() {
    els.board.innerHTML = STATUS.map(col => {
      const tasks = state.filtered.filter(t => normalizeStatus(t.status) === col.key);
      return `
        <section class="column" data-status="${col.key}">
          <div class="column-head">
            <div class="column-title"><span>${col.label}</span><span class="count">${tasks.length}</span></div>
          </div>
          <div class="column-sub">${col.zh}</div>
          <div class="cards">
            ${tasks.length ? tasks.map(taskCard).join('') : '<div class="empty-card">目前沒有工作</div>'}
          </div>
        </section>`;
    }).join('');

    document.querySelectorAll('.task-card').forEach(card => {
      card.addEventListener('click', () => openTask(card.dataset.id));
      card.addEventListener('dragstart', e => {
        state.dragTaskId = card.dataset.id;
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      card.addEventListener('dragend', () => {
        state.dragTaskId = null;
        card.classList.remove('dragging');
        document.querySelectorAll('.column').forEach(c => c.classList.remove('drag-over'));
      });
    });

    document.querySelectorAll('.column').forEach(column => {
      column.addEventListener('dragover', e => {
        e.preventDefault();
        column.classList.add('drag-over');
      });
      column.addEventListener('dragleave', e => {
        if (!column.contains(e.relatedTarget)) column.classList.remove('drag-over');
      });
      column.addEventListener('drop', async e => {
        e.preventDefault();
        column.classList.remove('drag-over');
        const taskId = state.dragTaskId;
        const newStatus = column.dataset.status;
        if (!taskId) return;
        const task = state.tasks.find(t => String(t.id) === String(taskId));
        if (!task || normalizeStatus(task.status) === newStatus) return;
        await updateTaskStatus(task, newStatus);
      });
    });
  }

  function renderAll() {
    els.allCount.textContent = state.filtered.length;
    els.allTasksBody.innerHTML = state.filtered.map(task => `
      <tr data-id="${escapeHtml(task.id)}">
        <td><strong>${escapeHtml(task.title)}</strong></td>
        <td>${escapeHtml(task.module || '—')}</td>
        <td>${escapeHtml(STATUS.find(s => s.key === normalizeStatus(task.status))?.zh || task.status || '—')}</td>
        <td>${escapeHtml(task.priority || '—')}</td>
        <td>${escapeHtml(task.assignee || '—')}</td>
        <td>${escapeHtml(prettyDate(task.updated_at || task.created_at))}</td>
      </tr>`).join('');
    els.allTasksBody.querySelectorAll('tr').forEach(row => row.addEventListener('click', () => openTask(row.dataset.id)));
  }

  function render() {
    els.taskCountSide.textContent = state.tasks.length;
    renderBoard();
    renderAll();
  }

  async function updateTaskStatus(task, status) {
    if (!state.client) return openConnection();
    const previous = task.status;
    task.status = status;
    applyFilters();

    const { error } = await state.client
      .from('board_tasks')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', task.id);

    if (error) {
      task.status = previous;
      applyFilters();
      setBanner(`狀態更新失敗：${error.message}`, 'error');
      return;
    }
    setBanner(`「${task.title}」已移動到 ${STATUS.find(s => s.key === status)?.zh || status}。`, 'ok');
    await loadTasks({ quiet: true });
  }

  function openTask(id = null) {
    const task = id ? state.tasks.find(t => String(t.id) === String(id)) : null;
    els.taskId.value = task?.id || '';
    els.taskTitle.value = task?.title || '';
    els.taskModule.value = task?.module || 'Engineering';
    els.taskStatus.value = task ? normalizeStatus(task.status) : 'inbox';
    els.taskPriority.value = (task?.priority || 'medium').toLowerCase();
    els.taskAssignee.value = task?.assignee || '';
    els.taskSource.value = task?.source || '';
    els.taskDescription.value = task?.description || '';
    els.taskCreatedBy.value = task?.created_by || '';
    els.createdAtText.textContent = prettyDate(task?.created_at);
    els.updatedAtText.textContent = prettyDate(task?.updated_at);
    els.drawerTitle.textContent = task ? task.title : '新增工作';
    els.deleteTaskBtn.classList.toggle('hidden', !task);
    els.taskDrawer.classList.remove('hidden');
    els.taskDrawer.setAttribute('aria-hidden', 'false');
    els.modalBackdrop.classList.remove('hidden');
  }

  function closeTask() {
    els.taskDrawer.classList.add('hidden');
    els.taskDrawer.setAttribute('aria-hidden', 'true');
    if (els.connectionModal.classList.contains('hidden')) els.modalBackdrop.classList.add('hidden');
  }

  async function saveTask(e) {
    e.preventDefault();
    if (!state.client) return openConnection();

    const payload = {
      title: els.taskTitle.value.trim(),
      module: els.taskModule.value.trim() || 'Engineering',
      status: els.taskStatus.value,
      priority: els.taskPriority.value,
      assignee: els.taskAssignee.value.trim() || null,
      source: els.taskSource.value.trim() || null,
      description: els.taskDescription.value.trim() || null,
      updated_at: new Date().toISOString(),
    };
    if (!payload.title) return;

    const id = els.taskId.value;
    let error;
    if (id) {
      ({ error } = await state.client.from('board_tasks').update(payload).eq('id', id));
    } else {
      ({ error } = await state.client.from('board_tasks').insert(payload));
    }

    if (error) {
      setBanner(`儲存失敗：${error.message}`, 'error');
      return;
    }
    closeTask();
    await loadTasks({ quiet: true });
    setBanner(id ? '工作已更新。' : '工作已新增。', 'ok');
  }

  async function deleteTask() {
    const id = els.taskId.value;
    if (!id || !state.client) return;
    const task = state.tasks.find(t => String(t.id) === String(id));
    if (!confirm(`確定刪除「${task?.title || '這筆工作'}」？`)) return;

    const { error } = await state.client.from('board_tasks').delete().eq('id', id);
    if (error) return setBanner(`刪除失敗：${error.message}`, 'error');
    closeTask();
    await loadTasks({ quiet: true });
    setBanner('工作已刪除。', 'ok');
  }

  async function startRealtimeAndPolling() {
    if (state.subscription) {
      try { await state.client.removeChannel(state.subscription); } catch {}
    }
    if (state.polling) clearInterval(state.polling);

    if (state.client) {
      try {
        state.subscription = state.client
          .channel('zhuge-board-tasks')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'board_tasks' }, () => loadTasks({ quiet: true }))
          .subscribe();
      } catch {}
      state.polling = setInterval(() => loadTasks({ quiet: true }), 10000);
    }
  }

  async function connectAndLoad() {
    const created = await createClientFromConfig();
    if (!created) return;
    await loadTasks();
    await startRealtimeAndPolling();
  }

  function switchView(view) {
    state.view = view;
    document.querySelectorAll('.nav-item[data-view]').forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));
    els.boardView.classList.toggle('hidden', view !== 'board');
    els.allView.classList.toggle('hidden', view !== 'all');
    $('pageTitle').textContent = view === 'board' ? '工程看板' : '全部工作';
  }

  // Events
  els.connectionBtn.addEventListener('click', openConnection);
  els.closeConnectionBtn.addEventListener('click', closeConnection);
  els.testConnectionBtn.addEventListener('click', async () => {
    els.connectionTest.textContent = '測試中...';
    els.connectionTest.className = 'connection-test';
    try {
      await testConnection(els.supabaseUrl.value, els.supabaseKey.value);
      els.connectionTest.textContent = '✓ 連線成功，board_tasks 可讀取。';
      els.connectionTest.className = 'connection-test ok';
    } catch (err) {
      els.connectionTest.textContent = `✕ ${err.message || err}`;
      els.connectionTest.className = 'connection-test error';
    }
  });
  els.saveConnectionBtn.addEventListener('click', async () => {
    saveConfig(els.supabaseUrl.value, els.supabaseKey.value);
    closeConnection();
    await connectAndLoad();
  });
  els.clearConnectionBtn.addEventListener('click', () => {
    clearConfig();
    state.client = null;
    state.tasks = [];
    closeConnection();
    setConnectionStatus('off', '尚未連線 Supabase');
    setBanner('Supabase 連線已清除。', 'info');
    render();
  });

  els.refreshBtn.addEventListener('click', () => loadTasks());
  els.newTaskBtn.addEventListener('click', () => openTask());
  els.closeDrawerBtn.addEventListener('click', closeTask);
  els.cancelTaskBtn.addEventListener('click', closeTask);
  els.taskForm.addEventListener('submit', saveTask);
  els.deleteTaskBtn.addEventListener('click', deleteTask);
  els.modalBackdrop.addEventListener('click', () => {
    if (!els.taskDrawer.classList.contains('hidden')) closeTask();
    if (!els.connectionModal.classList.contains('hidden')) closeConnection();
  });

  [els.globalSearch, els.moduleFilter, els.priorityFilter, els.assigneeFilter].forEach(el => {
    el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', applyFilters);
  });
  els.clearFiltersBtn.addEventListener('click', () => {
    els.globalSearch.value = '';
    els.moduleFilter.value = '';
    els.priorityFilter.value = '';
    els.assigneeFilter.value = '';
    applyFilters();
  });

  document.querySelectorAll('.nav-item[data-view]').forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));

  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      els.globalSearch.focus();
    }
    if (e.key === 'Escape') {
      if (!els.connectionModal.classList.contains('hidden')) closeConnection();
      else if (!els.taskDrawer.classList.contains('hidden')) closeTask();
    }
  });

  // Initial
  render();
  connectAndLoad();
  if (!getConfig().url || !getConfig().key) {
    setTimeout(openConnection, 250);
  }
})();
